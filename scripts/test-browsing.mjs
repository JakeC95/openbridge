import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rename, rm, stat, symlink, utimes } from "node:fs/promises";
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
const directory = await mkdtemp(join(tmpdir(), "openbridge-browsing-"));
// Exercise the real metadata worker, including service caching and persistence, without a prior app build.
await build({ entryPoints: ["src/main/shared-facts-worker.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: join(directory, "shared-facts-worker.js") });
const result = await build({
  stdin: { contents: `
    export { LibraryIndex } from './src/main/library-index';
    export { LibraryService } from './src/main/library';
    export { inspectSharedHdr, scanSharedRoot } from './src/main/shared-library';
    export { scanLocalModel } from './src/main/model-preview';
    export { listSharedModelPackage, inspectSharedModelDependencies, legacyFbxCompanion, copySharedModelPackage, copySharedSelection } from './src/main/shared-package';
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
    export { poliigonSkyCondition, skyConditionLabel } from './src/shared/sky-conditions';
    export { allSourceCategory, allSourcePath, allCategoryNodes, polyHavenHdriCategoryRoots } from './src/renderer/all-sources';
    export { modelTextureMaterialKey, modelPartMaterialKey } from './src/shared/model-preview';
    export { rankSearchEntries, searchTextScore, searchIntentBoost, searchSpecificityPenalty } from './src/renderer/search-ranking';
  `, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false,
  banner: { js: 'import { createRequire as fixtureRequire } from "node:module"; const require = fixtureRequire(process.cwd() + "/package.json");' },
  define: { __dirname: JSON.stringify(directory), __OPENBRIDGE_REPOSITORY__: '""', __OPENBRIDGE_CONFIG__: JSON.stringify({
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
  check("material keys keep tree trunk and needles separate from 16-bit map tokens", () => {
    const key = api.modelTextureMaterialKey;
    assert.equal(key("TreeFraserFirLarge001_Trunk01_COL_8K_METALNESS.png"), "TreeFraserFirLarge001 Trunk01");
    assert.equal(key("TreeFraserFirLarge001_Needles01_MASK_8K_METALNESS.png"), "TreeFraserFirLarge001 Needles01");
    assert.equal(key("TreeFraserFirLarge001_Needles01_NRM16_8K_LOD4_METALNESS.png"), "TreeFraserFirLarge001 Needles01");
    assert.equal(key("TreeFraserFirLarge001_Trunk01_DISP16_8K_METALNESS.png"), "TreeFraserFirLarge001 Trunk01");
    assert.equal(key("Metal01_COL_1K.png"), "Metal01");
    assert.equal(api.modelPartMaterialKey("TreeFraserFirLarge001_Trunk01_Geo_LOD4.fbx"), "TreeFraserFirLarge001 Trunk01");
  });
  check("global search ranks exact tokens and query intent above provider turn-taking", () => {
    const entries = [
      { item: "mega-branch", provider: "megascans", groupIndex: 0, match: { name: "Desert Western Tree Branch Juniper", typeLabel: "3D Plant" } },
      { item: "poly-fir", provider: "polyhaven", groupIndex: 3, match: { name: "Fir Tree 01", typeLabel: "3D Model" }, free: true, popularity: 5000 },
      { item: "poli-tree-texture", provider: "poliigon", groupIndex: 0, match: { name: "Tree End 005", typeLabel: "Surface" } },
      { item: "poly-sunset", provider: "polyhaven", groupIndex: 1, match: { name: "Evening Sunset Sky", typeLabel: "HDRI" }, free: true },
      { item: "bk-tree-1", provider: "blenderkit", groupIndex: 0, match: { name: "Tree", typeLabel: "3D Model" }, free: true },
      { item: "bk-tree-2", provider: "blenderkit", groupIndex: 1, match: { name: "Tree", typeLabel: "3D Model" }, free: true },
      { item: "bk-tree-lod", provider: "blenderkit", groupIndex: 2, match: { name: "Tree LOD 0", typeLabel: "3D Model" }, free: true },
      { item: "tree-small", provider: "polyhaven", groupIndex: 2, match: { name: "Tree Small 02", typeLabel: "3D Model" }, free: true },
      { item: "tree-stump", provider: "megascans", groupIndex: 3, match: { name: "Tree Stump 01", typeLabel: "3D Plant" } }
    ];
    const tree = api.rankSearchEntries("tree", entries);
    assert.equal(tree[0], "bk-tree-1");
    assert.notEqual(tree[1], "bk-tree-2");
    assert.ok(tree.indexOf("bk-tree-2") > 3);
    assert.ok(tree.indexOf("bk-tree-lod") > 4);
    assert.ok(tree.indexOf("tree-small") < tree.indexOf("tree-stump"));
    assert.ok(tree.indexOf("poli-tree-texture") < tree.indexOf("poly-sunset"));
    assert.ok(api.searchSpecificityPenalty("tree", { name: "Tree Stump 01" }) < 0);
    assert.ok(api.searchSpecificityPenalty("tree", { name: "Tree Trunk Juniper" }) < 0);
    assert.equal(api.searchSpecificityPenalty("tree stump", { name: "Tree Stump 01" }), 0);
    const sunset = api.rankSearchEntries("sunset", entries);
    assert.equal(sunset[0], "poly-sunset");
    assert.equal(api.searchTextScore("fir tree", { name: "Fir Tree 01" }) > api.searchTextScore("fir tree", { name: "Tree 01" }), true);
    assert.ok(api.searchIntentBoost("sunset", "HDRI") > api.searchIntentBoost("sunset", "Surface"));
    assert.ok(api.searchIntentBoost("brick", "Surface") > api.searchIntentBoost("brick", "HDRI"));
  });
  check("deep global search ranking preserves every result and stays deterministic", () => {
    const entries = Array.from({ length: 600 }, (_, item) => ({
      item, provider: `provider-${item % 6}`, groupIndex: Math.floor(item / 6),
      match: { name: item % 20 === 0 ? "Oak Tree" : `Oak Tree ${item}`, typeLabel: "3D Model" }
    }));
    const ranked = api.rankSearchEntries("oak tree", entries);
    assert.equal(ranked[0], 0);
    assert.notEqual(ranked[1] % 20, 0);
    assert.equal(new Set(ranked).size, entries.length);
    assert.deepEqual(api.rankSearchEntries("oak tree", entries), ranked);
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
  const pagedIndex = new LibraryIndex(join(directory, "paged-refresh.sqlite"), logger);
  const previousStore = useStore.getState();
  const previousApi = window.openbridge;
  try {
    const rows = Array.from({ length: 625 }, (_, value) => makeAsset(`shared:refresh:${value.toString(16).padStart(32, "0")}`, "3d", ["3d"], {
      name: `Item ${String(value).padStart(4, "0")}`, repo: "shared", tags: ["obj"],
      technical: { ...assetTechnicalFacts({}), maxTris: value + 1 }
    }));
    pagedIndex.upsertMany([...rows, makeAsset("outside-refresh", "3d", ["3d"])].map(asset => ({ asset, folderMtime: 1, jsonMtime: 1 })));
    useStore.setState({ localProvider: "shared", localQuery: "", localRepo: "all", localType: "3d",
      localSort: "triangles", localCategoryPath: [], localFavoritesOnly: false, groupSharedVariants: false,
      sharedRoot: "refresh", sharedFormat: "obj", sharedTag: "", sharedCollection: "", localPack: null,
      localReady: [], localMaxTris: null, localColor: "", localState: "", localInterior: "", libraryLoading: false });
    const scope = libraryFilterQuery(useStore.getState());
    const original = pagedIndex.query({ ...scope, limit: 600 });
    useStore.setState({ libraryAssets: original.assets, libraryHasMore: true });
    pagedIndex.saveSharedTechnical(rows[0].id, rows[0].path, { ...rows[0].technical, maxTris: 99999 });
    const calls = [];
    window.openbridge = { ...previousApi, queryLibrary: async query => { calls.push(query); return pagedIndex.query(query); } };
    await useStore.getState().refreshLocalLibrary();
    check("metadata refresh keeps 600 loaded rows in bounded pages and reapplies their current sort/filter scope", () => {
      const refreshed = useStore.getState();
      assert.equal(refreshed.libraryAssets.length, 600);
      assert.equal(refreshed.libraryHasMore, true);
      assert.equal(refreshed.libraryFilteredTotal, 625);
      assert.equal(refreshed.libraryAssets[0].id, rows[0].id);
      assert.equal(refreshed.libraryAssets[0].technical.maxTris, 99999);
      assert.deepEqual(refreshed.libraryAssets.map(asset => asset.id), pagedIndex.query({ ...scope, limit: 600 }).assets.map(asset => asset.id));
      assert.deepEqual(calls.map(query => [query.offset, query.limit]), [[0, 300], [300, 300]]);
      assert.ok(calls.every(query => query.provider === "shared" && query.sharedRoot === "refresh" && query.sort === "triangles" && query.sharedFormat === "obj"));
      assert.equal(refreshed.libraryLoading, false);
    });
    let release;
    window.openbridge.queryLibrary = query => new Promise(resolve => { release = () => resolve(pagedIndex.query(query)); });
    const before = useStore.getState().libraryAssets;
    const pendingRefresh = useStore.getState().refreshLocalLibrary();
    useStore.setState({ localQuery: "changed scope" });
    release();
    await pendingRefresh;
    check("background metadata refresh cannot overwrite a newly changed scope", () => {
      assert.equal(useStore.getState().libraryAssets, before);
      assert.equal(useStore.getState().localQuery, "changed scope");
    });
  } finally { pagedIndex.close(); useStore.setState(previousStore); window.openbridge = previousApi; }

  const stalledLibrary = new LibraryService(() => "", () => "", () => "", () => null, () => null,
    join(directory, "stalled-preflight.sqlite"), logger);
  try {
    let started = false;
    stalledLibrary.sharedFile = () => { started = true; return new Promise(() => {}); };
    const pendingInspection = stalledLibrary.inspectSharedMetadata("shared:stalled:" + "0".repeat(32));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, true);
    stalledLibrary.close();
    await assert.rejects(pendingInspection, { name: "AbortError" });
    check("closing Library cancels a stalled shared-file preflight before its metadata worker starts", () => {});
  } finally { stalledLibrary.close(); }

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
  let configuredLibrary = libraryRoot;
  const scanLogs = [];
  library = new LibraryService(
    () => configuredLibrary,
    () => join(directory, "poliigon-library"),
    () => join(directory, "polyhaven-library"),
    () => null,
    () => null,
    join(directory, "library.sqlite"),
    { ...logger, info(message, data) { if (message === "Library scan complete") scanLogs.push(data); } }
  );
  const initial = await Promise.all([library.scan(true), library.snapshot(true), library.snapshot()]);
  check("concurrent Library consumers share one full scan", () => {
    assert.equal(scanLogs.length, 1);
    assert.equal(initial[0].assets.length, 2);
    assert.strictEqual(initial[1], initial[2]);
  });
  const jsonPath = join(folder, "fixture.json");
  const jsonTimes = await stat(jsonPath);
  const folderTimes = await stat(folder);
  await writeFile(jsonPath, JSON.stringify({ id: "fixture", name: "Refreshed download", type: "surface", components: [{ type: "albedo" }] }));
  await utimes(jsonPath, jsonTimes.atime, jsonTimes.mtime);
  await utimes(folder, folderTimes.atime, folderTimes.mtime);
  library.invalidate([folder]);
  await library.snapshot();
  check("completed-download refresh reindexes the changed folder and skips its neighbors", () => {
    assert.equal(library.query({ repo: "downloaded" }).assets[0].name, "Refreshed download");
    assert.equal(scanLogs.at(-1).changed, 1);
    assert.equal(scanLogs.at(-1).skipped, 1);
  });
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
  const obsolete = library.snapshot(true);
  configuredLibrary = join(directory, "new-empty-library");
  library.invalidate();
  const switched = await Promise.all([obsolete, library.snapshot()]);
  check("an in-flight Library scan cannot publish an obsolete root", () => {
    assert.equal(switched[0].libraryPath, configuredLibrary);
    assert.equal(switched[1].libraryPath, configuredLibrary);
    assert.equal(library.query({}).total, 0);
  });
  const sharedRoot = join(directory, "Studio models");
  const sharedImages = join(directory, "Studio HDRIs");
  const nested = join(sharedRoot, "Versions # café");
  await mkdir(nested, { recursive: true });
  await mkdir(sharedImages);
  const model = join(nested, "Chair.obj");
  const beside = join(nested, "Table.obj");
  const hdr = join(sharedImages, "Day.hdr");
  const flat = join(sharedImages, "Flat.hdr");
  await writeFile(model, "mtllib Chair.mtl\nv 0 0 0\n");
  const chairLod = join(nested, "Chair_LOD1.obj");
  await writeFile(chairLod, "v 0 0 0\n");
  await writeFile(beside, "v 1 0 0\n");
  await mkdir(join(sharedRoot, "Textures"));
  const texture = join(sharedRoot, "Textures", "Wood # colour.png");
  await writeFile(texture, "fixture texture");
  await writeFile(join(nested, "Chair.mtl"), "newmtl Wood\nmap_Kd -s 1 1 1 ../Textures/Wood # colour.png\n");
  await writeFile(join(nested, "Chair_preview.jpg"), "fixture");
  await writeFile(hdr, "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 32 +X 64\n");
  await writeFile(flat, "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 32 +X 32\n");
  if (process.platform !== "win32") await symlink(beside, join(sharedRoot, "Linked.obj"));
  let roots = [
    { id: "models", name: "Studio models", path: sharedRoot, kind: "models" },
    { id: "hdris", name: "Studio HDRIs", path: sharedImages, kind: "hdris" }
  ];
  const shared = new LibraryService(
    () => configuredLibrary, () => "", () => "", () => null, () => null,
    join(directory, "shared.sqlite"), logger, () => ({}), () => roots
  );
  try {
    const snapshot = await shared.snapshot(true);
    const assets = shared.query({ provider: "shared" }).assets;
    const chair = assets.find(asset => asset.path === model);
    assert.ok(chair);
    check("shared models and HDRIs index independently from provider assets", () => {
      assert.equal(assets.length, 5);
      assert.equal(snapshot.counts.shared, 5);
      assert.equal(snapshot.counts.megascans, 0);
      assert.equal(shared.query({ provider: "megascans" }).total, 0);
      assert.equal(shared.query({ provider: "shared", query: "chair" }).total, 2);
      assert.equal(shared.query({ provider: "shared", type: "hdri" }).total, 2);
      assert.equal(chair.repo, "shared");
    });
    const saved = shared.saveSharedOrganization(chair.id, {
      tags: ["Furniture", " furniture "], collections: ["Studio props"], notes: "Approved by production."
    });
    check("shared notes, tags and collections are searchable and filterable", () => {
      assert.deepEqual(saved.tags, ["Furniture"]);
      assert.equal(shared.query({ query: "production" }).assets[0].id, chair.id);
      assert.equal(shared.query({ provider: "megascans", query: "production" }).total, 0);
      assert.equal(shared.query({ provider: "shared", sharedCollection: "studio props", sharedTag: "furniture" }).total, 1);
      assert.deepEqual(shared.query({ provider: "shared" }).sharedOrganization.collections, ["Studio props"]);
    });
    const cleanIndex = new LibraryService(() => "", () => "", () => "", () => null, () => null,
      join(directory, "rebuilt-shared.sqlite"), logger, () => ({}), () => roots);
    try {
      await cleanIndex.snapshot(true);
      check("shared organization survives rebuilding the file index", () => {
        assert.deepEqual(cleanIndex.getSharedOrganization(chair.id), saved);
      });
    } finally { cleanIndex.close(); }
    check("shared variant matching keeps unrelated neighbors separate", () => {
      assert.deepEqual(shared.sharedVariants(chair.id).map(item => item.path), [chairLod]);
      assert.equal(shared.query({ provider: "shared", groupSharedVariants: true }).total, 4);
      assert.equal(shared.query({ provider: "shared", groupSharedVariants: true, query: "lod1" }).assets[0].path, chairLod);
    });
    const copyRoot = join(directory, "Project copies");
    await mkdir(copyRoot);
    const materialFile = join(nested, "Chair.mtl");
    const completeMaterial = await readFile(materialFile, "utf8");
    await writeFile(materialFile, "newmtl Wood\nmap_Bump ../Textures/Missing.png\nmap_Kd -s 1 1 1 ../Textures/Wood # colour.png\n");
    const availableDependencies = await api.inspectSharedModelDependencies(sharedRoot, model);
    const canonicalTexture = await realpath(texture);
    const incompleteManifest = await api.scanLocalModel(nested, chair.id, "shared", "3d", model, availableDependencies.files);
    check("a missing MTL map preserves valid referenced textures outside the model directory for preview", () => {
      assert.equal(availableDependencies.files.length, 3);
      assert.ok(availableDependencies.files.includes(canonicalTexture));
      assert.equal(availableDependencies.complete, false);
      assert.deepEqual(availableDependencies.maps.map(map => ({ type: map.type, material: map.material, role: map.role })),
        [{ type: "basecolor", material: "Wood", role: "map_Kd" }]);
      assert.equal(availableDependencies.notes.length, 1);
      assert.match(availableDependencies.notes[0], /Missing\.png/);
      const validTextureUrl = new URL("../Textures/Wood%20%23%20colour.png", incompleteManifest.meshes[0].mtlUrl).href;
      assert.ok(incompleteManifest.allowedFileUrls.includes(validTextureUrl));
      assert.ok(!incompleteManifest.allowedFileUrls.some(url => url.endsWith("Missing.png")));
    });
    await assert.rejects(() => api.copySharedModelPackage(sharedRoot, model, copyRoot), /Missing model dependency: Missing\.png/);
    const incompleteCopies = await readdir(copyRoot);
    check("copying an incomplete model package still reports its missing resource", () => {
      assert.deepEqual(incompleteCopies, []);
    });
    await writeFile(materialFile, completeMaterial);
    const resources = await shared.sharedDependencies(chair.id);
    const localMaps = await shared.previews(chair.id);
    check("shared resources retain explicit MTL semantics and expose only referenced browser maps", () => {
      assert.equal(resources.complete, true);
      assert.equal(resources.files.length, 3);
      assert.equal(resources.maps[0].type, "basecolor");
      assert.equal(resources.maps[0].material, "Wood");
      assert.match(resources.maps[0].name, /Textures\/Wood # colour.png$/);
      assert.ok(resources.maps[0].url.startsWith("file:"));
      assert.equal(localMaps.maps.length, 1);
      assert.equal(localMaps.maps[0].map.type, "basecolor");
      assert.ok(!resources.files.some(file => file.name.startsWith("../")));
    });
    await writeFile(materialFile, "newmtl Wood\nmap_Kd -s 1 1 1 ../Textures/Wood # colour.png\nmap_Bump Q:/authoring/private/height.png\n");
    const portablePreview = await api.inspectSharedModelDependencies(sharedRoot, model);
    check("authored absolute references are omitted without hiding valid local material maps", () => {
      assert.equal(portablePreview.maps.length, 1);
      assert.equal(portablePreview.maps[0].type, "basecolor");
      assert.equal(portablePreview.complete, false);
      assert.ok(!portablePreview.files.some(file => file.includes("authoring")));
      assert.match(portablePreview.notes[0], /absolute or remote/);
    });
    await assert.rejects(() => api.copySharedModelPackage(sharedRoot, model, copyRoot), /absolute or remote/);
    await writeFile(materialFile, completeMaterial);
    const copied = await api.copySharedModelPackage(sharedRoot, model, copyRoot);
    check("shared OBJ package preserves relative MTL and texture paths", () => assert.equal(copied.files, 3));
    assert.equal(await readFile(join(copied.folder, "Textures", "Wood # colour.png"), "utf8"), "fixture texture");
    assert.match(await readFile(join(copied.folder, "Versions # café", "Chair.obj"), "utf8"), /^mtllib Chair/);
    const unsafe = join(nested, "Unsafe.gltf");
    await writeFile(unsafe, JSON.stringify({ buffers: [{ uri: "../../outside.bin" }] }));
    await assert.rejects(() => api.listSharedModelPackage(sharedRoot, unsafe), /outside its shared root/);
    const escapedPreview = await api.inspectSharedModelDependencies(sharedRoot, unsafe);
    assert.deepEqual(escapedPreview.files, [await realpath(unsafe)]);
    assert.equal(escapedPreview.complete, false);
    assert.match(escapedPreview.notes[0], /outside its shared root/);
    await rm(unsafe);
    await writeFile(join(nested, "model.bin"), "mesh data");
    const gltf = join(nested, "Fixture.gltf");
    await writeFile(gltf, JSON.stringify({ buffers: [{ uri: "model.bin" }], images: [{ uri: "data:image/png;base64,eA==" }] }));
    await writeFile(gltf, JSON.stringify({ buffers: [{ uri: "model.bin" }],
      images: [{ uri: "../Textures/Wood%20%23%20colour.png" }, { uri: "data:image/png;base64,eA==" }],
      textures: [{ source: 0 }], materials: [{ name: "Packed PBR", pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } }, normalTexture: { index: 0 } }] }));
    const gltfResources = await api.inspectSharedModelDependencies(sharedRoot, gltf);
    check("glTF material slots preserve packed map channel assignments without filename guesses", () => {
      assert.deepEqual(gltfResources.maps.map(map => map.type), ["metalness", "roughness", "normal"]);
      assert.ok(gltfResources.maps.every(map => map.material === "Packed PBR"));
      assert.equal(gltfResources.complete, true);
    });
    const gltfFiles = await api.listSharedModelPackage(sharedRoot, gltf);
    const gltfExpected = await Promise.all([gltf, join(nested, "model.bin"), texture].map(file => realpath(file)));
    check("shared glTF package includes local buffers and rejects escaping references", () =>
      assert.deepEqual(gltfFiles, gltfExpected));
    const glb = join(nested, "Fixture.glb");
    const json = Buffer.from(JSON.stringify({ buffers: [{ uri: "model.bin" }] }));
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(header.length + json.length, 8);
    header.writeUInt32LE(json.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    await writeFile(glb, Buffer.concat([header, json]));
    assert.deepEqual(await api.listSharedModelPackage(sharedRoot, glb), [await realpath(glb), gltfExpected[1]]);
    if (process.platform !== "win32") {
      const external = join(directory, "outside.bin");
      const linked = join(nested, "linked.bin");
      await writeFile(external, "private fixture");
      await symlink(external, linked);
      await writeFile(gltf, JSON.stringify({ buffers: [{ uri: "linked.bin" }] }));
      await assert.rejects(() => api.listSharedModelPackage(sharedRoot, gltf), /linked model dependency/);
      const linkedPreview = await api.inspectSharedModelDependencies(sharedRoot, gltf);
      assert.deepEqual(linkedPreview.files, [await realpath(gltf)]);
      assert.equal(linkedPreview.complete, false);
      assert.match(linkedPreview.notes[0], /linked model dependency/);
    }
    await rm(gltf);
    await rm(glb);
    const progress = [];
    const controller = new AbortController();
    const selection = await api.copySharedSelection(copyRoot,
      [{ id: "missing", name: "Missing" }, { id: "chair", name: "Chair" }, { id: "table", name: "Table" }],
      async id => {
        if (id === "missing") throw new Error("Source offline");
        return { root: sharedRoot, path: id === "chair" ? model : beside };
      }, controller.signal, completed => {
        progress.push(completed);
        if (completed === 2) controller.abort();
      });
    check("bulk shared copying reports per-asset failures and stops without discarding completed packages", () => {
      assert.equal(selection.copied, 1);
      assert.equal(selection.cancelled, true);
      assert.deepEqual(selection.failures, [{ name: "Missing", message: "Source offline" }]);
      assert.deepEqual(progress, [1, 2]);
      assert.ok(selection.folder);
    });
    check("shared library filters by file format using the indexed extension", () => {
      assert.equal(shared.query({ provider: "shared", sharedFormat: "obj" }).total, 3);
      assert.equal(shared.query({ provider: "shared", sharedRoot: "hdris", sharedFormat: "obj" }).total, 0);
      assert.equal(shared.query({ provider: "shared", sharedRoot: "hdris" }).total, 2);
      assert.deepEqual(shared.query({ provider: "shared" }).sharedOrganization.formats, ["hdr", "obj"]);
    });
    const preview = await shared.previews(chair.id);
    const source = await shared.sharedFile(chair.id);
    const manifest = await api.scanLocalModel(nested, chair.id, "shared", "3d", source.path);
    check("shared preview resolves exactly one indexed model and same-directory sidecars", () => {
      assert.equal(preview.renders.length, 1);
      assert.match(preview.renders[0].url, /%23/);
      assert.equal(manifest.meshes.length, 1);
      assert.equal(manifest.meshes[0].label, "Chair.obj");
      assert.match(manifest.meshes[0].mtlUrl, /Chair\.mtl$/);
      assert.ok(!manifest.allowedFileUrls.some(url => url.endsWith("Table.obj")));
    });
    const panorama = await api.inspectSharedHdr(hdr);
    const still = await api.inspectSharedHdr(flat);
    const oversized = join(directory, "Oversized.hdr");
    await writeFile(oversized, "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 8192 +X 16384\n");
    const oversizedInfo = await api.inspectSharedHdr(oversized);
    check("oversized HDR header facts remain available without allocating decoded pixels", () => {
      assert.equal(oversizedInfo.width, 16384);
      assert.equal(oversizedInfo.height, 8192);
      assert.equal(oversizedInfo.previewAvailable, false);
      assert.match(oversizedInfo.reason, /8K/);
    });
    const removal = await shared.removeAssets([chair.id]);
    check("shared HDR inspection distinguishes flat images and deletion leaves files untouched", () => {
      assert.deepEqual(panorama, { width: 64, height: 32, panorama: true, previewAvailable: true });
      assert.equal(still.panorama, false);
      assert.equal(removal.removed, 0);
    });
    await stat(model);
    const remapped = join(directory, "Remapped share");
    await rename(sharedRoot, remapped);
    configuredLibrary = join(directory, "separate-managed-root");
    const offline = await shared.snapshot(true);
    await assert.rejects(() => shared.sharedFile(chair.id), /unavailable/);
    roots = roots.map(root => root.id === "models" ? { ...root, path: remapped } : root);
    const remap = await shared.snapshot(true);
    check("shared index survives unmount and managed-root changes and preserves IDs on remap", () => {
      assert.equal(offline.sharedLibraries[0].state, "unavailable");
      assert.equal(offline.counts.shared, 5);
      assert.equal(remap.sharedLibraries[0].state, "ready");
      assert.equal(remap.counts.shared, 5);
      assert.equal(shared.getAsset(chair.id).path, join(remapped, "Versions # café", "Chair.obj"));
    });
    roots = roots.filter(root => root.id === "hdris");
    await shared.snapshot(true);
    check("unregistering a shared source removes only its index rows", () => {
      assert.equal(shared.query({ provider: "shared" }).total, 2);
    });
    await stat(join(remapped, "Versions # café", "Chair.obj"));
  } finally {
    shared.close();
  }

  const kit = join(directory, "Cover fixtures");
  const modelFolder = join(kit, "model");
  const coverFolder = join(kit, "preview");
  await Promise.all([mkdir(modelFolder, { recursive: true }), mkdir(coverFolder, { recursive: true })]);
  await Promise.all([
    writeFile(join(modelFolder, "Building_A_v001.abc"), "fixture"),
    writeFile(join(modelFolder, "Building_B.abc"), "fixture"),
    writeFile(join(modelFolder, "Building_C.abc"), "fixture"),
    writeFile(join(coverFolder, "Building_A..jpg"), "fixture"),
    writeFile(join(coverFolder, "Building_B.jpg"), "fixture"),
    writeFile(join(coverFolder, "Building_B.png"), "fixture")
  ]);
  const kitAssets = [];
  await api.scanSharedRoot({ id: "cover-kit", name: "Cover fixtures", kind: "models", path: kit }, {
    cancelled: () => false, loadCheckpoint: () => null, checkpoint: () => {},
    publish: assets => kitAssets.push(...assets)
  });
  check("package covers match exact stems and explicit versions while rejecting ambiguous images", () => {
    assert.equal(kitAssets.find(asset => asset.name === "Building_A_v001").preview, join(coverFolder, "Building_A..jpg"));
    assert.equal(kitAssets.find(asset => asset.name === "Building_B").preview, null);
    assert.equal(kitAssets.find(asset => asset.name === "Building_C").preview, null);
  });

  const splitPackage = join(directory, "Split package");
  const objFolder = join(splitPackage, "OBJ");
  const fbxFolder = join(splitPackage, "FBX");
  const mapsFolder = join(splitPackage, "TEXTURES");
  await Promise.all([objFolder, fbxFolder, mapsFolder].map(path => mkdir(path, { recursive: true })));
  const sourceObj = join(objFolder, "014_Scanline.obj");
  const sourceFbx = join(fbxFolder, "014.FBX");
  const sourceMtl = join(objFolder, "Model.mtl");
  const sourceMap = join(mapsFolder, "Color.JPG");
  const oldHeader = Buffer.alloc(27);
  oldHeader.write("Kaydara FBX Binary  \0\x1a\0", "binary");
  oldHeader.writeUInt32LE(6100, 23);
  await Promise.all([
    writeFile(sourceFbx, oldHeader),
    writeFile(sourceObj, "mtllib Model.mtl\n"),
    writeFile(sourceMtl, "newmtl Paint\nmap_Kd -s 4 1 1 color.jpg\n"),
    writeFile(sourceMap, "texture")
  ]);
  const canonicalPackage = await realpath(splitPackage);
  const companion = await api.legacyFbxCompanion(canonicalPackage, await realpath(sourceFbx));
  const dependencies = await api.inspectSharedModelDependencies(splitPackage, sourceObj);
  const sourceMapPath = await realpath(sourceMap);
  check("legacy FBX preview finds its matching OBJ and uniquely resolves its sibling texture case", () => {
    assert.equal(companion.legacy, true);
    assert.equal(companion.path, dependencies.files[0]);
    assert.equal(dependencies.maps[0].path, sourceMapPath);
    assert.equal(dependencies.complete, false);
    assert.match(dependencies.textureAliases[0][0], /OBJ\/color\.jpg$/);
    assert.match(dependencies.textureAliases[0][1], /TEXTURES\/Color\.JPG$/);
  });
  await assert.rejects(api.listSharedModelPackage(splitPackage, sourceObj), /Missing model dependency/);
  await writeFile(join(objFolder, "014.obj"), "ambiguous candidate");
  assert.equal((await api.legacyFbxCompanion(canonicalPackage, await realpath(sourceFbx))).path, null);
  const lodMesh = join(fbxFolder, "Rock_LOD0.fbx");
  const media = join(fbxFolder, "Rock_LOD0.fbm");
  await mkdir(media);
  await Promise.all([
    writeFile(lodMesh, "fixture"),
    writeFile(join(fbxFolder, "Rock_2K_Albedo.jpg"), "texture"),
    writeFile(join(fbxFolder, "RockOther_2K_Albedo.jpg"), "unrelated"),
    writeFile(join(media, "External.jpg"), "authored image")
  ]);
  const manifest = await api.scanLocalModel(await realpath(fbxFolder), "rock", "shared", "3d", await realpath(lodMesh));
  check("shared LOD meshes find asset maps and allow only their own FBX media aliases", () => {
    assert.equal(manifest.textures.length, 1);
    assert.match(manifest.textures[0].url, /Rock_2K_Albedo\.jpg$/);
    assert.equal(manifest.textureAliases.length, 1);
    assert.match(manifest.textureAliases[0][1], /Rock_LOD0\.fbm\/External\.jpg$/);
    assert.ok(manifest.allowedFileUrls.includes(manifest.textureAliases[0][1]));
  });

  const factsRoot = join(directory, "Metadata source");
  await mkdir(factsRoot);
  const factsImageRoot = join(directory, "Metadata images");
  await mkdir(factsImageRoot);
  const factsModel = join(factsRoot, "Fixture_LOD2_v003.obj");
  const factsHdr = join(factsImageRoot, "Panorama.hdr");
  const factsNative = join(factsRoot, "Native.mb");
  const factsSource = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl Paint\nf 1 2 3 4\n";
  await writeFile(factsModel, factsSource);
  await writeFile(factsHdr, "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 32 +X 64\n");
  await writeFile(factsNative, "unsupported native model fixture");
  const factsTime = new Date(Date.now() - 10000);
  await utimes(factsModel, factsTime, factsTime);
  const factsDatabase = join(directory, "facts-shared.sqlite");
  const openFactsLibrary = () => new LibraryService(() => "", () => "", () => "", () => null, () => null,
    factsDatabase, logger, () => ({}), () => [
      { id: "facts", name: "Metadata source", path: factsRoot, kind: "models" },
      { id: "facts-images", name: "Metadata images", path: factsImageRoot, kind: "hdris" }
    ]);
  let factsLibrary = openFactsLibrary();
  try {
    await factsLibrary.snapshot(true);
    const sourceAsset = factsLibrary.query({ provider: "shared", sharedFormat: "obj" }).assets[0];
    const imageAsset = factsLibrary.query({ provider: "shared", sharedFormat: "hdr" }).assets[0];
    const nativeAsset = factsLibrary.query({ provider: "shared", sharedFormat: "mb" }).assets[0];
    check("shared viewer-format filtering excludes native scenes and HDR images without reading sources", () => {
      const viewer = factsLibrary.query({ provider: "shared", sharedFormat: "viewer" });
      assert.equal(viewer.total, 1);
      assert.equal(viewer.assets[0].id, sourceAsset.id);
      assert.deepEqual(factsLibrary.ids({ provider: "shared", sharedFormat: "viewer" }), [sourceAsset.id]);
    });
    check("previews-first sorting puts supported models above newer native scenes", () => {
      assert.deepEqual(factsLibrary.ids({ provider: "shared", type: "3d", sort: "previews" }), [sourceAsset.id, nativeAsset.id]);
    });
    const pendingFacts = factsLibrary.inspectSharedMetadata(sourceAsset.id);
    assert.equal(factsLibrary.inspectSharedMetadata(sourceAsset.id), pendingFacts);
    const modelFacts = await pendingFacts;
    const imageFacts = await factsLibrary.inspectSharedMetadata(imageAsset.id);
    const nativeFacts = await factsLibrary.inspectSharedMetadata(nativeAsset.id);
    check("shared metadata worker deduplicates requests and persists evidenced facts with filename labels", () => {
      assert.equal(modelFacts.model.triangles, 2);
      assert.equal(modelFacts.model.vertices, 4);
      assert.equal(modelFacts.model.bounds.unit, "unknown");
      assert.equal(modelFacts.lod, 2);
      assert.equal(modelFacts.version, "003");
      assert.equal(imageFacts.image.width, 64);
      assert.equal(nativeFacts.model.status, "unsupported");
      assert.deepEqual(factsLibrary.getAsset(sourceAsset.id).technical.local, modelFacts);
      assert.deepEqual(factsLibrary.getAsset(sourceAsset.id).technical.lodTriangles, [{ label: "LOD2", tris: 2 }]);
    });
    check("shared source facts participate in common triangle filtering and metric sorting without invented readiness", () => {
      assert.equal(factsLibrary.query({ provider: "shared", maxTris: 1 }).total, 0);
      assert.deepEqual(factsLibrary.query({ provider: "shared", maxTris: 2 }).assets.map(asset => asset.id), [sourceAsset.id]);
      assert.equal(factsLibrary.query({ provider: "shared", sort: "triangles" }).assets[0].id, sourceAsset.id);
      assert.equal(factsLibrary.query({ provider: "shared", sort: "resolution" }).assets[0].id, imageAsset.id);
      assert.equal(factsLibrary.getAsset(imageAsset.id).technical.resolution, 64);
      for (const ready of ["closed", "scale-fixed", "tileable", "modular"])
        assert.equal(factsLibrary.query({ provider: "shared", ready: [ready] }).total, 0);
    });
    factsLibrary.close();
    factsLibrary = openFactsLibrary();
    await factsLibrary.snapshot(true);
    const cachedFacts = await factsLibrary.inspectSharedMetadata(sourceAsset.id);
    check("shared facts survive restart and unchanged full reindex and reuse their inspection timestamp", () => {
      assert.deepEqual(cachedFacts, modelFacts);
      assert.deepEqual(factsLibrary.getAsset(imageAsset.id).technical.local, imageFacts);
    });
    // Change geometry without changing byte length: mtime alone must invalidate persisted facts.
    await writeFile(factsModel, factsSource.replaceAll("v 1", "v 2"));
    const nextTime = new Date(factsTime.getTime() + 5000);
    await utimes(factsModel, nextTime, nextTime);
    await factsLibrary.snapshot(true);
    check("same-size model edits invalidate common metrics and file facts during reindex", () => {
      assert.equal(factsLibrary.getAsset(sourceAsset.id).technical, undefined);
      assert.equal(factsLibrary.query({ provider: "shared", maxTris: 2 }).total, 0);
      assert.deepEqual(factsLibrary.getAsset(imageAsset.id).technical.local, imageFacts);
    });
    const changedFacts = await factsLibrary.inspectSharedMetadata(sourceAsset.id);
    assert.equal(changedFacts.model.bounds.max[0], 2);
    assert.notEqual(changedFacts.mtimeMs, modelFacts.mtimeMs);
    // Preserve timestamp while adding another face: byte length must independently invalidate facts.
    await writeFile(factsModel, factsSource + "f 1 2 3\n");
    await utimes(factsModel, nextTime, nextTime);
    await factsLibrary.snapshot(true);
    check("size changes invalidate shared facts even when the source timestamp is preserved", () => {
      assert.equal(factsLibrary.getAsset(sourceAsset.id).technical, undefined);
    });
    const resizedFacts = await factsLibrary.inspectSharedMetadata(sourceAsset.id);
    check("reinspection replaces stale geometry and restores common triangle queries", () => {
      assert.equal(resizedFacts.model.triangles, 3);
      assert.equal(factsLibrary.query({ provider: "shared", maxTris: 2 }).total, 0);
      assert.equal(factsLibrary.query({ provider: "shared", maxTris: 3 }).total, 1);
    });
    await assert.rejects(() => factsLibrary.inspectSharedMetadata("shared:facts:missing"), /no longer indexed|not found|unavailable/i);
  } finally { factsLibrary.close(); }

  const transitions = [];
  let doneScanning;
  const done = new Promise(resolve => { doneScanning = resolve; });
  const background = new LibraryService(() => "", () => "", () => "", () => null, () => null,
    join(directory, "background-shared.sqlite"), logger, () => ({}), () => roots,
    () => {
      const snapshot = background.sharedSnapshot();
      transitions.push(snapshot.sharedLibraries[0]?.state);
      if (snapshot.sharedLibraries[0]?.state === "ready") doneScanning(snapshot);
    }
  );
  try {
    const initial = await background.snapshot(true);
    const settled = await Promise.race([done, new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error("Shared background scan timed out")), 5000);
      timeout.unref();
    })]);
    check("shared background scans yield the initial Library before progressively publishing indexed files", () => {
      assert.equal(initial.sharedLibraries[0].state, "scanning");
      assert.ok(transitions.includes("scanning"));
      assert.equal(settled.sharedLibraries[0].state, "ready");
      assert.equal(settled.counts.shared, 2);
    });
  } finally { background.close(); }
  const resumable = { ...roots[0], id: "resumable" };
  await mkdir(join(resumable.path, "Unfinished"));
  const cursorPath = join(directory, "cursor-shared.sqlite");
  const openResumable = () => new LibraryService(() => "", () => "", () => "", () => null, () => null,
    cursorPath, logger, () => ({}), () => [resumable]);
  const beforeStop = openResumable();
  let processed;
  try {
    await beforeStop.snapshot(true);
    processed = beforeStop.query({ provider: "shared" }).assets.map(asset => asset.path);
  } finally { beforeStop.close(); }
  const cursor = new LibraryIndex(cursorPath, logger);
  try {
    const canonicalRoot = await realpath(resumable.path);
    const mount = await stat(canonicalRoot);
    const key = JSON.stringify([resumable, canonicalRoot, mount.dev, mount.ino]);
    cursor.saveSharedTraversal(resumable.id, key, { pending: ["Unfinished"], partial: false });
    cursor.markSharedSeen(resumable.id, processed);
  } finally { cursor.close(); }
  await writeFile(join(resumable.path, "Deferred.hdr"), "#?RADIANCE\n");
  await writeFile(join(resumable.path, "Unfinished", "Resumed.hdr"), "#?RADIANCE\n");
  const afterRestart = openResumable();
  try {
    await afterRestart.snapshot(true);
    check("shared scan resumes the durable frontier across restart and retains completed directories", () => {
      assert.equal(afterRestart.query({ provider: "shared" }).total, 3);
      assert.equal(afterRestart.query({ provider: "shared", query: "resumed" }).total, 1);
      assert.equal(afterRestart.query({ provider: "shared", query: "deferred" }).total, 0);
    });
    await afterRestart.snapshot(true);
    check("a later completed rescan discovers new files in earlier directories", () => {
      assert.equal(afterRestart.query({ provider: "shared", query: "deferred" }).total, 1);
    });
  } finally { afterRestart.close(); }
  check("HDRI sky conditions ignore contradictory provider tags", () => {
    const condition = api.poliigonSkyCondition;
    assert.equal(condition({ name: "Clear Day HDRI", tags: ["clear sky"], categories: ["HDRIS / Sky / Clear"] }), "clear");
    assert.equal(condition({ name: "Mostly Clear Sunset", tags: ["cloudy sky"], categories: ["HDRIS / Sky / Sunset"] }), "clear");
    assert.equal(condition({ name: "Overcast Day HDRI", tags: [], categories: ["HDRIS / Sky / Overcast"] }), "overcast");
    assert.equal(condition({ name: "Hazy Sunset Field", tags: [], categories: ["HDRIS / Environment"] }), "fog");
    assert.equal(condition({ name: "Overcast Stormy Plain HDRI", tags: ["cloudy sky"], categories: [] }), "rain");
    assert.equal(condition({ name: "Snowy Field Clear Winters Day", tags: ["snow", "clear sky"], categories: ["HDRIS / Sky / Clear"] }), "clear");
    assert.notEqual(condition({ name: "Whiterock Mudflats Shaded Cloudy Day", tags: ["overcast sky"], categories: ["HDRIS / Sky / Clear", "HDRIS / Sky / Partly Cloudy"] }), "clear");
    assert.equal(condition({ name: "Interior Lobby Glazed Partition HDRI", tags: ["neutral daylight"], categories: ["HDRIS / Environment"] }), null);
  });

  check("combined HDRI categories use normalised conditions, not tag buckets", () => {
    const clear = api.allSourceCategory("hdri:clear");
    assert.deepEqual(clear.polyhavenWeather, ["clear"]);
    assert.deepEqual(clear.poliigonWeather, ["clear"]);
    assert.equal(clear.polyhavenCategories, undefined);
    assert.equal(clear.poliigonPaths, undefined);
    assert.deepEqual(api.allSourcePath("hdri:clear"), ["hdri", "hdri:skies", "hdri:clear"]);

    const overcast = api.allSourceCategory("hdri:overcast");
    assert.deepEqual(overcast.polyhavenWeather, ["overcast"]);
    assert.deepEqual(overcast.poliigonWeather, ["overcast"]);

    const clearDay = api.allSourceCategory("hdri:clear-day");
    assert.deepEqual(clearDay.polyhavenWeather, ["clear"]);
    assert.deepEqual(clearDay.poliigonWeather, ["clear"]);
    assert.equal(clearDay.polyhavenTimeStart, 7);
    assert.equal(clearDay.polyhavenTimeEnd, 17);
    assert.equal(clearDay.poliigonTimeStart, 7);
    assert.equal(clearDay.poliigonTimeEnd, 17);

    const dynamic = api.allSourceCategory("hdri:ph:Interiors/Residential/Living Rooms & Lounges");
    assert.deepEqual(dynamic.polyhavenCategoryPaths, ["Interiors/Residential/Living Rooms & Lounges"]);
    assert.deepEqual(api.allSourcePath("hdri:ph:Interiors/Residential/Living Rooms & Lounges"), [
      "hdri",
      "hdri:interiors",
      "hdri:ph:Interiors/Residential",
      "hdri:ph:Interiors/Residential/Living Rooms & Lounges"
    ]);

    const categories = [
      { key: "Interiors", label: "Interiors", count: 10, children: [
        { key: "Interiors/Residential", label: "Residential", count: 2, children: [] }
      ] }
    ];
    const tree = api.allCategoryNodes(categories);
    const hdri = tree.find(node => node.key === "hdri");
    const interiors = hdri.children.find(node => node.key === "hdri:interiors");
    assert.equal(interiors.children[0].key, "hdri:ph:Interiors/Residential");
    assert.deepEqual(api.polyHavenHdriCategoryRoots(categories).map(node => node.key), ["Interiors"]);
  });

  console.log(`\n${checks} browsing regression checks passed.`);
} finally {
  index.close(); metadata.close(); library?.close();
  await rm(directory, { recursive: true, force: true });
}
