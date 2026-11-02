import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

// In-memory module URLs are large; keep failures readable without dumping their bundled source.
Error.stackTraceLimit = 0;

// Bundle the actual TypeScript modules in memory. All databases/files below are disposable fixtures.
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value) };
globalThis.window = { openbridge: {} };
const result = await build({
  stdin: { contents: `
    export { LibraryIndex } from './src/main/library-index';
    export { LibraryService } from './src/main/library';
    export { CatalogMetadataProvider } from './src/main/catalog-metadata';
    export { assetTechnicalFacts } from './src/shared/asset-metadata';
    export { localCategoryPath } from './src/shared/browsing';
    export { catalogFilterQuery, libraryFilterQuery } from './src/renderer/browsing-state';
    export { renderPreviews } from './src/renderer/catalog-utils';
    export { useStore } from './src/renderer/store';
    export { searchCatalog, searchCatalogIds } from './src/main/legacy-api';
    export { highResolutionPreviewPayload, highResolutionPreview } from './src/main/high-resolution-preview';
    export { buildMapPreviews, buildBillboardPreviews } from './src/main/map-previews';
    export { DownloadCompletions } from './src/main/download-completions';
    export { summarizeDownloads } from './src/renderer/download-summary';
    export { recordDownloadSpeed, clearDownloadSpeed } from './src/renderer/download-history';
    export { assetBounds, scaleDiagramLayout } from './src/shared/asset-scale';
  `, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false,
  banner: { js: 'import { createRequire as fixtureRequire } from "node:module"; const require = fixtureRequire(process.cwd() + "/package.json");' },
  define: { __OPENBRIDGE_REPOSITORY__: '""', __OPENBRIDGE_CONFIG__: JSON.stringify({
    algoliaAppId: "fixture", algoliaApiKey: "fixture", algoliaIndex: "assets"
  }) },
  plugins: [{ name: "electron-fixture", setup(bundler) {
    bundler.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
    bundler.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const app = { getPath: () => '' };
      export const net = { fetch: (...args) => globalThis.fixtureFetch(...args) };
    ` }));
  } }]
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const { LibraryIndex, LibraryService, CatalogMetadataProvider, assetTechnicalFacts, localCategoryPath,
  libraryFilterQuery, catalogFilterQuery, renderPreviews, useStore, searchCatalog, searchCatalogIds,
  highResolutionPreviewPayload, highResolutionPreview, buildMapPreviews, buildBillboardPreviews } = api;
const directory = await mkdtemp(join(tmpdir(), "openbridge-browsing-"));
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const index = new LibraryIndex(join(directory, "index.sqlite"), logger);
const metadata = new CatalogMetadataProvider(join(directory, "metadata.sqlite"), logger);
let library;
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
try {
  check("scale diagram parses metre metadata and explicit cm/mm without guessing missing axes", () => {
    const technical = assetTechnicalFacts({});
    assert.deepEqual(api.assetBounds({ ...technical, dimensions: "0.21 x 0.13 x 0.10" }), { depth: .21, width: .13, height: .1 });
    assert.deepEqual(api.assetBounds({ ...technical, dimensions: "21 × 13 × 10 cm" }), { depth: .21, width: .13, height: .1 });
    assert.deepEqual(api.assetBounds({ ...technical, dimensions: "210mm x 13cm x .1m" }), { depth: .21, width: .13, height: .1 });
    for (const dimensions of [null, "2 x 2", "-1 x 2 x 3", "0 x 2 x 3", "unknown", "2 x 2 x 2 px", "1 x NaN x 2"])
      assert.equal(api.assetBounds({ ...technical, dimensions, scanArea: "2 x 2" }), null);
    const variations = { ...technical, variationDimensions: [{ variation: 2, width: ".3", length: ".4", height: "2" }] };
    assert.equal(api.assetBounds(variations, 1), null);
    assert.equal(api.assetBounds(variations, 2).height, 2);
    assert.equal(api.assetBounds(variations).variation, 2);
  });
  check("orthographic scale uses identical pixels per metre for brick, tree and wide asset", () => {
    for (const bounds of [{ width: .13, height: .1, depth: .21 }, { width: 5, height: 18, depth: 4 }, { width: 100, height: .001, depth: 2 }]) {
      const layout = api.scaleDiagramLayout(bounds);
      assert.ok(Math.abs(layout.boxHeight / layout.humanHeight - bounds.height / 1.78) < 1e-10);
      assert.equal(layout.boxWidth, bounds.width * layout.pixelsPerMeter);
      assert.equal(layout.boxY + layout.boxHeight, layout.ground);
      assert.ok(layout.boxX + layout.boxWidth <= 396);
      assert.ok(layout.boxY >= 0 && layout.humanY >= 0);
    }
  });
  check("completion history survives reopen, repeats and queue clearing", () => {
    const path = join(directory, "completions.sqlite");
    let history = new api.DownloadCompletions(path);
    const completion = { assetId: "oak", name: "Oak", path: "fixture/oak", bytes: 1024, completedAt: 100 };
    history.record(completion); history.record({ ...completion, completedAt: 200 }); history.close();
    history = new api.DownloadCompletions(path);
    try { assert.equal(history.recent().length, 2); assert.equal(history.recent()[0].completedAt, 200); }
    finally { history.close(); }
  });
  check("aggregate download ETA is observed, smoothed and scoped to active transfers", () => {
    const now = 20000;
    const item = { assetId: "eta", status: "downloading", total: 10000, received: 1000, ratio: .1,
      diagnostics: { receiveBytesPerSecond: 100, activeTransfers: 1 } };
    assert.equal(api.summarizeDownloads([item], now).eta, null);
    for (let second = 14; second >= 0; second--) api.recordDownloadSpeed("eta", 100, now - second * 1000);
    const summary = api.summarizeDownloads([item, { ...item, assetId: "queued", status: "queued", total: 0 }], now);
    assert.equal(summary.eta, "~2 min"); assert.equal(summary.rate, 100); assert.equal(summary.queued.length, 1);
    assert.equal(api.summarizeDownloads([{ ...item, diagnostics: { receiveBytesPerSecond: 0 } }], now).eta, null);
    assert.equal(api.summarizeDownloads([{ ...item, total: 0 }], now).eta, null);
    assert.equal(api.summarizeDownloads([{ ...item, status: "paused" }], now).rate, 0);
    api.clearDownloadSpeed("eta");
  });
  const makeAsset = (id, type, categories, overrides = {}) => ({
    id, name: id, type, categories, tags: [], repo: "downloaded", path: join(directory, id),
    jsonPath: join(directory, id, "asset.json"), preview: null, thumb: null, mtime: 1,
    previewRelativeSize: "1x1", searchStr: `${id} wood forest`,
    technical: { ...assetTechnicalFacts({}), tileable: true, closedMesh: true, maxTris: 500,
      packId: "forest-pack", packName: "Forest", semantic: {
        color: ["Brown"], state: ["old"], interiorExterior: ["exterior"]
      } }, ...overrides
  });
  const assets = [
    makeAsset("oak", "3D asset", ["3d", "nature", "wood"]),
    makeAsset("bark", "surface", ["surface", "wood"], { mtime: 5 }),
    makeAsset("fern", "3dplant", ["3dplant", "nature", "fern"]),
    makeAsset("oak", "3d", ["nature", "wood"], { repo: "custom", path: join(directory, "custom-oak") })
  ];
  index.upsertMany(assets.map(asset => ({ asset, folderMtime: 1, jsonMtime: 1 })));
  check("category normalization and nested counts", () => {
    assert.deepEqual(localCategoryPath("3D asset", ["3d", "nature", "wood"]), ["3d", "nature", "wood"]);
    const found = index.query({ categoryPath: ["3d", "nature", "wood"] });
    assert.equal(found.total, 2);
    assert.equal(found.categories.find(node => node.key === "3d").children[0].count, 2);
    assert.equal(index.query({ type: "3d" }).total, 2);
    assert.equal(index.query({ type: "3dplant" }).total, 1);
  });
  check("all-filtered IDs match visible filters, including empty favorites", () => {
    const filters = libraryFilterQuery({
      localQuery: "wood", localRepo: "downloaded", localType: "3d", localCategoryPath: ["3d", "nature"],
      localSort: "name", localFavoritesOnly: true, favorites: ["oak", "bark"],
      localPack: { id: "forest-pack", name: "Forest" }, localReady: ["tileable", "closed"],
      localMaxTris: 1000, localColor: "Brown", localState: "old", localInterior: "exterior"
    });
    assert.deepEqual(index.ids(filters), ["oak"]);
    assert.deepEqual(index.query(filters).assets.map(asset => asset.id), ["oak"]);
    assert.equal(index.query({ ...filters, ids: [] }).total, 0);
    assert.equal(index.query({ ...filters, maxTris: 100 }).total, 0);
    assert.equal(index.query({ ...filters, color: "Blue" }).total, 0);
    assert.equal(index.query({ ...filters, packId: "missing" }).total, 0);
    assert.deepEqual(index.matchingAssets(["oak"], filters).map(asset => asset.repo), ["downloaded"]);
  });
  check("local pack membership is grouped, not per asset", () => {
    assert.deepEqual(index.query({}).packs, [{ id: "forest-pack", name: "Forest", count: 3 }]);
    assert.equal(index.query({ packId: "forest-pack" }).total, 4);
  });
  check("sorting happens before paging", () => {
    assert.equal(index.query({ sort: "recent", limit: 1 }).assets[0].id, "bark");
    assert.equal(index.query({ sort: "name", limit: 1 }).assets[0].id, "bark");
    assert.equal(index.query({ sort: "name", limit: 1, offset: 1 }).assets[0].id, "fern");
  });
  const packFile = join(directory, "fixture-pack.jsonl");
  await writeFile(packFile, [JSON.stringify({ format: "openbridge-catalog-metadata", version: 1 }),
    ...assets.slice(0, 3).map(asset => JSON.stringify({ id: asset.id, name: asset.name,
      technical: asset.technical }))].join("\n"));
  await metadata.importPack(packFile);
  check("catalogue pack audit, grouping and exact membership", () => {
    assert.deepEqual(metadata.packs(), [{ id: "forest-pack", name: "Forest", count: 3 }]);
    assert.deepEqual(metadata.packIds({ id: "forest-pack", name: "Forest" }).sort(), ["bark", "fern", "oak"]);
    assert.deepEqual(metadata.packIds({ name: "missing" }), []);
  });
  const calls = [];
  globalThis.fixtureFetch = async (_url, options) => {
    calls.push(new URLSearchParams(JSON.parse(options.body).params));
    return new Response(JSON.stringify({ hits: [{ id: "oak", objectID: "oak" }], nbHits: 1,
      page: 0, nbPages: 1, hitsPerPage: 48 }), { status: 200 });
  };
  const filters = catalogFilterQuery({ query: "wood", type: "3d", categoryPath: ["3D asset", "nature"],
    favoritesOnly: true, favorites: ["oak"], freeOnly: false, sizeFilter: "medium",
    facetFilters: { biome: ["forest"], region: ["Europe"] }, catalogPack: null });
  await searchCatalog(filters);
  await searchCatalogIds(filters);
  check("catalogue selection preserves every filter", () => {
    const idQuery = calls.find(call => call.get("hitsPerPage") === "1000");
    for (const key of ["query", "filters", "facetFilters", "numericFilters"]) {
      assert.equal(calls[0].get(key), idQuery.get(key));
    }
    assert.match(idQuery.get("facetFilters"), /forest/);
    const biomeCounts = calls.find(call => call.get("facets") === "biome");
    assert.ok(biomeCounts);
    assert.doesNotMatch(biomeCounts.get("facetFilters"), /forest/);
    assert.match(biomeCounts.get("facetFilters"), /Europe/);
  });
  check("render gallery uses actual image containers only", () => {
    const renders = renderPreviews({ id: "oak", previews: { images: { preview: "https://example.invalid/render.jpg" } } },
      { previews: { images: [{ uri: "https://example.invalid/side.jpg" }] },
        referencePreviews: { maps: [{ uri: "https://example.invalid/map.jpg" }] } });
    assert.equal(renders.length, 2);
    assert.equal(renders.some(item => item.url.endsWith("map.jpg")), false);
  });
  const previewAsset = {
    id: "fixture", type: "3d", version: 2, acl: { resolution: 8192 },
    components: [{ type: "normal", textureSets: ["Leaves"], uris: [{ resolutions: [
      { resolution: "2048x2048", formats: [{ mimeType: "image/jpeg" }] },
      { resolution: "4096x4096", formats: [{ mimeType: "image/jpeg" }] },
      { resolution: "8192x8192", formats: [{ mimeType: "image/x-exr" }] }
    ] }] }],
    billboards: [{ type: "normal", uris: [{ resolution: "2048x2048", formats: [{ mimeType: "image/jpeg" }] }] }],
    referencePreviews: { maps: [{ type: "normal", uri: "fixture/fixture_1K_Normal.jpg", textureSets: ["Leaves"], mimeType: "image/jpeg" }] }
  };
  const map = { type: "normal", textureSet: "Leaves", referenceUri: "fixture/fixture_1K_Normal.jpg" };
  check("maximum preview requests select JPEG tiers only, with account limits and no meshes", () => {
    const request = highResolutionPreviewPayload(previewAsset, "fixture", map);
    assert.equal(request.resolution, 4096);
    assert.equal(request.payload.components[0].mimeType, "image/jpeg");
    assert.deepEqual(request.payload.meshes, []);
    assert.equal(request.payload.billboards, false);
    assert.equal(highResolutionPreviewPayload({ ...previewAsset, acl: { resolution: 2048 } }, "fixture", map).resolution, 2048);
    const billboard = highResolutionPreviewPayload(previewAsset, "fixture", { type: "normal", billboard: true });
    assert.deepEqual(billboard.payload.components, []);
    assert.equal(billboard.payload.billboards[0].mimeType, "image/jpeg");
    assert.equal(billboard.resolution, 2048);
  });
  check("map previews preserve texture-set and billboard identity for lazy high-res requests", () => {
    assert.deepEqual(buildMapPreviews(previewAsset, "https://example.invalid/*")[0].map, map);
    assert.equal(buildBillboardPreviews({ billboards: [{ type: "normal", mimeType: "image/jpeg", uri: "https://example.invalid/billboard.jpg" }] })[0].map.billboard, true);
  });
  let signedPayload;
  const previewApi = {
    extended: async () => previewAsset,
    requestDownload: async payload => {
      signedPayload = payload;
      return { components: [
        { mimeType: "image/x-exr", type: "normal", resolution: "8192x8192", uri: "https://example.invalid/fixture_8K_Normal.exr" },
        { mimeType: "image/jpeg", type: "normal", resolution: "4096x4096", uri: "https://example.invalid/fixture_4K_Normal.jpg" }
      ] };
    }
  };
  const fullPreview = await highResolutionPreview(previewApi, "fixture", map);
  check("temporary high-res signing returns the matching JPG, not EXR", () => {
    assert.equal(fullPreview.url, "https://example.invalid/fixture_4K_Normal.jpg");
    assert.equal(fullPreview.resolution, "4096");
    assert.equal(signedPayload.components.length, 1);
  });
  await assert.rejects(() => highResolutionPreview({ ...previewApi, requestDownload: async () => ({ components: [
    { mimeType: "image/x-exr", type: "normal", uri: "https://example.invalid/normal.exr" }
  ] }) }, "fixture", map), /JPG/);
  await assert.rejects(() => highResolutionPreview(previewApi, "../invalid", map), /Invalid/);
  await assert.rejects(() => highResolutionPreview({ ...previewApi, requestDownload: async () => ({ components: [
    { mimeType: "image/jpeg", type: "normal", uri: "https://example.invalid/mislabeled.exr" }
  ] }) }, "fixture", map), /JPG/);
  // Deferred responses reproduce rapid drawer navigation without a live account or network.
  const pending = new Map();
  window.openbridge.catalog = { extended: id => new Promise(resolve => pending.set(id, resolve)), cancel: async () => {} };
  useStore.setState({ auth: { loggedIn: true }, query: "wood" });
  const first = useStore.getState().openHit({ id: "first", objectID: "first", name: "First", type: "3d" });
  const second = useStore.getState().openHit({ id: "second", objectID: "second", name: "Second", type: "3d" });
  pending.get("first")({ id: "first" }); await first;
  pending.get("second")({ id: "second" }); await second;
  check("late drawer details cannot overwrite a newer asset", () => {
    assert.equal(useStore.getState().selection.hit.id, "second");
    assert.equal(useStore.getState().selection.extended.id, "second");
    assert.deepEqual(useStore.getState().recentSearches, ["wood"]);
  });
  useStore.getState().backSelection();
  pending.get("first")({ id: "first" });
  await Promise.resolve();
  check("Back reloads an interrupted asset rather than leaving a spinner", () => {
    assert.equal(useStore.getState().selection.hit.id, "first");
    assert.equal(useStore.getState().selection.loading, false);
    assert.equal(useStore.getState().selectionHistory.length, 0);
  });
  const closed = useStore.getState().openHit({ id: "closed", objectID: "closed", name: "Closed", type: "3d" });
  useStore.getState().closeSelection(); pending.get("closed")({ id: "closed" }); await closed;
  check("closing a drawer invalidates pending detail requests", () => assert.equal(useStore.getState().selection, null));
  check("density and sorting preferences persist", () => {
    useStore.getState().setDensity("large"); useStore.getState().setLocalSort("name");
    assert.equal(storage.get("openbridge.density"), '"large"');
    assert.equal(storage.get("openbridge.localSort"), '"name"');
  });
  const libraryRoot = join(directory, "library");
  const folder = join(libraryRoot, "Downloaded", "surface", "fixture");
  await mkdir(join(folder, "textures"), { recursive: true });
  await writeFile(join(folder, "fixture.json"), JSON.stringify({ id: "fixture", name: "Fixture", type: "surface", components: [{ type: "albedo" }] }));
  await writeFile(join(folder, "preview.jpg"), "fixture");
  await writeFile(join(folder, "textures", "albedo.jpg"), "fixture");
  await writeFile(join(folder, "textures", "normal.exr"), "fixture");
  const customFolder = join(libraryRoot, "Custom", "duplicate");
  await mkdir(customFolder, { recursive: true });
  await writeFile(join(customFolder, "fixture.json"), JSON.stringify({ id: "fixture", name: "Custom copy", type: "surface" }));
  library = new LibraryService(() => libraryRoot, join(directory, "library.sqlite"), logger);
  await library.scan(true);
  const previews = await library.previews("fixture", folder);
  check("local renders and nested browser-readable maps work offline", () => {
    assert.equal(previews.renders.length, 1); assert.equal(previews.maps.length, 1);
    assert.match(previews.maps[0].url, /^file:/);
    assert.match(previews.maps[0].label, /albedo/);
    assert.equal(previews.maps[0].map.type, "albedo");
  });
  await assert.rejects(() => library.previews("fixture", directory));
  const removed = await library.removeAssets(["fixture"], { repo: "downloaded" });
  check("scoped deletion leaves duplicate IDs outside the filtered repository untouched", () => {
    assert.equal(removed.removed, 1);
    assert.equal(library.query({ repo: "custom" }).total, 1);
    assert.equal(library.query({ repo: "downloaded" }).total, 0);
  });
  console.log(`\n${checks} browsing regression checks passed.`);
} finally {
  index.close(); metadata.close(); library?.close();
  await rm(directory, { recursive: true, force: true });
}
