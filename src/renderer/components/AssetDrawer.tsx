import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Dropdown } from "./Dropdown";
import type {
  CatalogHit,
  DownloadMapFormat,
  DownloadMapOption,
  DownloadOptions,
  ExtendedAsset,
  MapPreview,
  MeshFormat
} from "../../shared/types";
import {
  assetTechnicalFacts,
  downloadPlan,
  lodMeshBytes,
  mapTechnicalDetails
} from "../../shared/asset-metadata";
import { formatMeasurementText } from "../../shared/measurements";
import {
  aclResolution,
  hitId,
  hitPreview,
  hitThumb,
  typeLabel
} from "../catalog-utils";
import {
  MAP_FORMAT_OPTIONS,
  buildDownloadOptions,
  canUseExr,
  formatBytes,
  lodInfo,
  mapTypeLabel,
  variationCount
} from "../download-options";
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  FolderIcon,
  UserIcon
} from "../icons";

const RESOLUTIONS = [1024, 2048, 4096, 8192];

function bytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function is3d(asset: ExtendedAsset | undefined, type: string | undefined): boolean {
  const categories = asset?.categories ?? [];
  return (
    categories[0]?.toLowerCase().startsWith("3d") ||
    (type ?? "").toLowerCase().startsWith("3d")
  );
}

function isPlant(asset: ExtendedAsset | undefined, type: string | undefined): boolean {
  const categories = asset?.categories ?? [];
  return categories[0]?.toLowerCase() === "3dplant" || (type ?? "").toLowerCase() === "3dplant";
}

function updateMapOption(
  options: DownloadOptions,
  type: string,
  patch: Partial<DownloadMapOption>
): DownloadOptions {
  return {
    ...options,
    components: options.components.map(component =>
      component.type === type ? { ...component, ...patch } : component
    )
  };
}

export function AssetDrawer() {
  const selection = useStore(state => state.selection);
  const auth = useStore(state => state.auth);
  const settings = useStore(state => state.settings);
  const acquired = useStore(state => state.acquired);
  const downloads = useStore(state => state.downloads);
  const close = useStore(state => state.closeSelection);
  const login = useStore(state => state.login);
  const openHit = useStore(state => state.openHit);
  const startDownload = useStore(state => state.startDownload);
  const acquire = useStore(state => state.acquire);
  const cancelDownload = useStore(state => state.cancelDownload);
  const validateJson = useStore(state => state.validateJson);
  const toast = useStore(state => state.toast);

  const hit = selection?.hit;
  const local = selection?.local;
  const extended = selection?.extended;
  const assetId = hit ? hitId(hit) : local?.id ?? "";
  const owned = acquired.includes(assetId);
  const progress = downloads[assetId];

  const [options, setOptions] = useState<DownloadOptions | null>(null);
  const [tab, setTab] = useState<"textures" | "models">("textures");
  const [previewMode, setPreviewMode] = useState<"render" | "maps">("render");
  const [mapPreviews, setMapPreviews] = useState<MapPreview[]>([]);
  const [mapIndex, setMapIndex] = useState(0);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [related, setRelated] = useState<CatalogHit[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  const assetType = extended?.type ?? hit?.type ?? local?.type ?? "";
  const threeD = is3d(extended, assetType);
  const plant = isPlant(extended, assetType);
  const maxResolution = aclResolution(extended);
  const resolutionOptions = RESOLUTIONS.filter(value => !maxResolution || value <= maxResolution);
  const lods = useMemo(() => lodInfo(extended, threeD), [extended, threeD]);
  const maxVariation = useMemo(() => variationCount(extended), [extended]);

  useEffect(() => {
    if (!selection) {
      setOptions(null);
      return;
    }
    const built = buildDownloadOptions(extended, settings);
    setOptions(built);
    setTab(threeD ? "textures" : "textures");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, extended, settings]);

  useEffect(() => {
    setPreviewMode("render");
    setMapPreviews([]);
    setMapIndex(0);
    setMapsError(null);
    setMapsLoading(false);
  }, [assetId]);

  useEffect(() => {
    const inline = (extended?.similarAssets ?? []).filter(
      item => item && (item.id || item.objectID) && hitId(item) !== assetId
    );
    if (inline.length > 0) {
      setRelated(inline.slice(0, 8));
      setRelatedLoading(false);
      return;
    }
    if (!extended) {
      setRelated([]);
      setRelatedLoading(false);
      return;
    }

    let cancelled = false;
    const assetCategories = extended.assetCategories as Record<string, unknown> | undefined;
    const topCategory =
      assetCategories && typeof assetCategories === "object"
        ? Object.keys(assetCategories)[0]
        : extended.categories?.[0];
    const tags = (extended.tags ?? []).slice(0, 3);
    setRelatedLoading(true);

    const search = async (
      query: string,
      categoryPath: string[] | undefined
    ): Promise<CatalogHit[]> => {
      const result = await window.openbridge.catalog.search({
        query,
        categoryPath,
        page: 0,
        hitsPerPage: 24
      });
      return result.hits.filter(
        item => item && (item.id || item.objectID) && hitId(item) !== assetId
      );
    };

    void (async () => {
      try {
        const categoryPath = topCategory ? [topCategory] : undefined;
        const merged = new Map<string, CatalogHit>();
        const add = (hits: CatalogHit[]): void => {
          for (const item of hits) {
            const id = hitId(item);
            if (id && id !== assetId) merged.set(id, item);
          }
        };

        add(await search(tags.slice(0, 2).join(" "), categoryPath));
        if (merged.size < 8 && tags[0]) {
          add(await search(tags[0], categoryPath));
        }
        if (merged.size < 8) {
          add(await search("", categoryPath));
        }

        if (!cancelled) setRelated([...merged.values()].slice(0, 8));
      } catch {
        if (!cancelled) setRelated([]);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetId, extended]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (previewMode !== "maps" || mapPreviews.length === 0) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setMapIndex(index => (index - 1 + mapPreviews.length) % mapPreviews.length);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setMapIndex(index => (index + 1) % mapPreviews.length);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, mapPreviews.length, previewMode]);

  if (!selection) return null;

  const preview = local
    ? local.preview
      ? window.openbridge.toFileUrl(local.preview)
      : null
    : hit
      ? hitPreview(hit)
      : null;
  const activeMap = previewMode === "maps" ? mapPreviews[mapIndex] : undefined;
  const activePreview = activeMap?.url ?? (previewMode === "maps" ? null : preview);

  async function openMaps(): Promise<void> {
    if (local) return;
    if (!auth.loggedIn) {
      await login();
      if (!useStore.getState().auth.loggedIn) return;
    }
    setPreviewMode("maps");
    if (mapPreviews.length > 0 || mapsLoading) return;
    setMapsLoading(true);
    setMapsError(null);
    try {
      const maps = await window.openbridge.catalog.mapPreviews(assetId);
      setMapPreviews(maps);
      setMapIndex(0);
      if (maps.length === 0) {
        setMapsError("No texture map previews are available for this asset");
      }
    } catch (error) {
      setMapsError(error instanceof Error ? error.message : String(error));
    } finally {
      setMapsLoading(false);
    }
  }

  function stepMap(delta: number): void {
    if (mapPreviews.length === 0) return;
    setMapIndex(index => (index + delta + mapPreviews.length) % mapPreviews.length);
  }

  const name = local?.name ?? hit?.name ?? extended?.name ?? assetId;
  const categories = extended?.categories ?? hit?.categories ?? local?.categories ?? [];
  const tags = extended?.tags ?? hit?.tags ?? local?.tags ?? [];
  const points = extended?.points ?? hit?.points ?? 0;
  const active =
    progress && ["queued", "requesting", "downloading", "extracting", "paused"].includes(progress.status);

  const update = (next: DownloadOptions) => {
    setOptions(next);
  };

  const patch = (next: Partial<DownloadOptions>) => {
    if (!options) return;
    update({ ...options, ...next });
  };

  async function download() {
    if (!options) return;
    if (!auth.loggedIn) {
      await login();
      return;
    }
    await startDownload(options);
  }

  async function exportLocal() {
    if (!local) return;
    const folder = await window.openbridge.chooseDirectory();
    if (!folder) return;
    try {
      const written = await window.openbridge.exportAssetToFolder(local.id, folder);
      toast(`Wrote ${written}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function resetDefaults() {
    const defaults = buildDownloadOptions(extended, settings, {});
    update(defaults);
  }

  const plan = options ? downloadPlan(extended, options) : null;
  const technical = assetTechnicalFacts(extended);
  const lodBytes = lodMeshBytes(extended, options?.meshFormat ?? "fbx");
  const selectedMaps = options?.components.filter(component => component.selected).length ?? 0;
  const selectedLods = options
    ? lods.filter(lod => (plant && options.downloadAllPlantLods) || options.lods[lod.index]).length
    : 0;

  const averageColor =
    typeof extended?.averageColor === "string" &&
    extended.averageColor.toLowerCase() !== "#000000"
      ? extended.averageColor
      : null;
  const texelDensity = technical.texelDensity
    ? /^\d+$/.test(technical.texelDensity)
      ? `${technical.texelDensity} px/m`
      : technical.texelDensity
    : null;
  const techRows: Array<[string, string]> = [];
  if (technical.dimensions) techRows.push(["Dimensions", formatMeasurementText(technical.dimensions)]);
  if (technical.scanArea) techRows.push(["Scan area", formatMeasurementText(technical.scanArea)]);
  if (technical.height && !technical.dimensions) techRows.push(["Height", formatMeasurementText(technical.height)]);
  if (texelDensity && Number.parseFloat(texelDensity) > 0) {
    techRows.push(["Texel density", texelDensity]);
  }
  if (technical.tileable !== null) {
    techRows.push([
      "Tileable",
      technical.tilingDirections.length > 0
        ? `Yes (${technical.tilingDirections.join(", ")})`
        : technical.tileable
          ? "Yes"
          : "No"
    ]);
  }
  if (technical.meshType) techRows.push(["Mesh type", technical.meshType]);
  if (technical.lodCount > 0) techRows.push(["LODs", String(technical.lodCount)]);
  if (technical.maxTris > 0) {
    techRows.push(["Max triangles", technical.maxTris.toLocaleString()]);
  }
  if (technical.variationCount > 1) {
    techRows.push(["Variations", String(technical.variationCount)]);
  }
  if (technical.billboardCount > 0) {
    techRows.push(["Billboards", String(technical.billboardCount)]);
  }
  if (technical.resolution) {
    techRows.push(["Max resolution", `${technical.resolution / 1024}K`]);
  }
  if (technical.mapCount > 0) techRows.push(["Map types", String(technical.mapCount)]);

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={name}>
        <div className="drawer-head">
          <span className="drawer-type">{typeLabel(assetType)}</span>
          <button type="button" className="icon-btn" onClick={close} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer-scroll">
          <div className="drawer-preview">
            {!local && (
              <div className="preview-switch">
                <button
                  type="button"
                  className={previewMode === "render" ? "active" : ""}
                  onClick={() => setPreviewMode("render")}
                >
                  Render
                </button>
                <button
                  type="button"
                  className={previewMode === "maps" ? "active" : ""}
                  onClick={() => void openMaps()}
                  title={auth.loggedIn ? "Texture maps" : "Sign in to preview maps"}
                >
                  Maps
                </button>
              </div>
            )}

            {activePreview ? (
              <img src={activePreview} alt={activeMap?.label ?? ""} referrerPolicy="no-referrer" />
            ) : previewMode === "maps" ? (
              <span className="map-preview-status">
                {mapsLoading ? "Loading texture maps..." : mapsError ?? "No texture maps"}
              </span>
            ) : (
              <span>{typeLabel(assetType)}</span>
            )}

            {previewMode === "render" && (
              <div className="drawer-flags">
                {owned && <span className="asset-flag owned">OWNED</span>}
                {points === 0 && <span className="asset-flag free">FREE</span>}
              </div>
            )}

            {previewMode === "maps" && activeMap && (
              <div className="map-nav">
                <div className="map-nav-label">
                  <strong>{activeMap.label}</strong>
                  {activeMap.resolution && <span>{activeMap.resolution}</span>}
                </div>
                <div className="map-nav-actions">
                  <button
                    type="button"
                    onClick={() => stepMap(-1)}
                    title="Previous map"
                    aria-label="Previous map"
                  >
                    ‹
                  </button>
                  <span>
                    {mapIndex + 1} / {mapPreviews.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepMap(1)}
                    title="Next map"
                    aria-label="Next map"
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
          </div>

          <h2 className="drawer-title" title={name}>{name}</h2>
          <p className="drawer-id">{assetId}</p>

          {selection.loading && <div className="loading-line">Loading asset details...</div>}
          {selection.error && <div className="error-box small">{selection.error}</div>}

          <div className="meta-grid">
            <span>Type</span>
            <strong>{typeLabel(assetType)}</strong>
            <span>Categories</span>
            <strong>{categories.join(" - ") || "-"}</strong>
            <span>Tags</span>
            <strong>{tags.slice(0, 12).join(", ") || "-"}</strong>
            {hit?.biome && hit.biome !== "undefined" && (
              <>
                <span>Biome</span>
                <strong>{hit.biome}</strong>
              </>
            )}
            {hit?.region && hit.region !== "undefined" && (
              <>
                <span>Region</span>
                <strong>{hit.region}</strong>
              </>
            )}
            {extended?.acl?.exrAccess && (
              <>
                <span>EXR access</span>
                <strong>{extended.acl.exrAccess}</strong>
              </>
            )}
          </div>

          {(techRows.length > 0 || averageColor) && (
            <section className="technical-panel">
              <div className="technical-head">
                <h3>Technical</h3>
                {averageColor && (
                  <span className="color-swatch" title={`Average color ${averageColor}`}>
                    <i style={{ background: averageColor }} />
                    {averageColor}
                  </span>
                )}
              </div>
              <div className="technical-grid">
                {techRows.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(relatedLoading || related.length > 0) && (
            <div className="related-assets">
              <h3>Related assets</h3>
              {relatedLoading ? (
                <p className="hint">Finding similar assets...</p>
              ) : (
                <div className="related-grid">
                  {related.map(item => {
                    const relatedId = hitId(item);
                    const thumb = hitThumb(item);
                    return (
                      <button
                        type="button"
                        className="related-card"
                        key={relatedId}
                        onClick={() => void openHit(item)}
                        title={item.name}
                      >
                        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span />}
                        <strong>{item.name}</strong>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {local ? (
            <div className="download-box">
              <h3>Local asset</h3>
              <p className="path-box" title={local.path}>
                {local.path}
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-primary btn-wide"
                  onClick={() => void window.openbridge.openPath(local.path)}
                >
                  <FolderIcon /> Open folder
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void exportLocal()}>
                  Export megascansAsset.json...
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void validateJson(local.id)}
                >
                  Validate asset JSON
                </button>
              </div>
            </div>
          ) : (
            <div className="download-box">
              <div className="download-heading">
                <h3>Download settings</h3>
                <button type="button" className="text-btn" onClick={resetDefaults}>
                  Reset to default
                </button>
              </div>

              {!options ? (
                <div className="loading-line">Preparing options...</div>
              ) : (
                <>
                  <div className="form-row compact">
                    <label>Resolution</label>
                    <Dropdown
                      className="select-dropdown"
                      value={String(
                        Math.min(
                          options.resolution,
                          resolutionOptions[resolutionOptions.length - 1] ?? options.resolution
                        )
                      )}
                      onChange={value => patch({ resolution: Number(value) })}
                      ariaLabel="Download resolution"
                      options={resolutionOptions.map(value => ({
                        value: String(value),
                        label: `${value / 1024}K`
                      }))}
                    />
                  </div>

                  <div className="download-tabs">
                    <button
                      type="button"
                      className={tab === "textures" ? "download-tab active" : "download-tab"}
                      onClick={() => setTab("textures")}
                    >
                      Textures
                    </button>
                    {threeD && (
                      <button
                        type="button"
                        className={tab === "models" ? "download-tab active" : "download-tab"}
                        onClick={() => setTab("models")}
                      >
                        Models & Extras
                      </button>
                    )}
                  </div>

                  {tab === "textures" ? (
                    <div className="map-options">
                      {options.components.map(component => {
                        const exrAllowed = canUseExr(extended, component.type);
                        const mapDetails = mapTechnicalDetails(extended, component, options.resolution);
                        const mapFacts = [
                          mapDetails.resolution,
                          mapDetails.formats.join("/"),
                          mapDetails.bitDepth ? `${mapDetails.bitDepth}-bit` : null,
                          mapDetails.bytes > 0 ? formatBytes(mapDetails.bytes) : null
                        ].filter(Boolean).join(" · ");
                        return (
                          <div className="map-row" key={component.type}>
                            <div className="map-row-main">
                              <label className="toggle inline">
                                <input
                                  type="checkbox"
                                  checked={component.selected}
                                  onChange={event =>
                                    update(
                                      updateMapOption(options, component.type, {
                                        selected: event.target.checked
                                      })
                                    )
                                  }
                                />
                                <span>{mapTypeLabel(component.type)}</span>
                              </label>
                              {mapFacts && <span className="map-facts">{mapFacts}</span>}
                            </div>
                            <Dropdown
                              className="select-dropdown small"
                              value={component.mimeType}
                              onChange={value =>
                                update(
                                  updateMapOption(options, component.type, {
                                    mimeType: value as DownloadMapFormat
                                  })
                                )
                              }
                              ariaLabel={`${mapTypeLabel(component.type)} format`}
                              options={MAP_FORMAT_OPTIONS.map(option => ({
                                value: option.value,
                                label: option.label,
                                disabled: option.value !== "image/jpeg" && !exrAllowed
                              }))}
                            />
                          </div>
                        );
                      })}

                      {threeD && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={options.uniqueMapsPerLod}
                            onChange={event => patch({ uniqueMapsPerLod: event.target.checked })}
                          />
                          <span>Unique maps per LOD when available</span>
                        </label>
                      )}
                      <p className="hint">
                        All settings are preferred options and will be downloaded when available.
                      </p>
                    </div>
                  ) : (
                    <div className="model-options">
                      <div className="form-row compact">
                        <label>Mesh format</label>
                        <Dropdown
                          className="select-dropdown"
                          value={options.meshFormat}
                          onChange={value => patch({ meshFormat: value as MeshFormat })}
                          ariaLabel="Mesh format"
                          options={[
                            { value: "fbx", label: "FBX" },
                            { value: "abc", label: "ABC" }
                          ]}
                        />
                      </div>

                      {threeD && lods.length > 0 && (
                        <div className="lod-options">
                          <span className="label">LODs</span>
                          {plant && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.downloadAllPlantLods}
                                onChange={event =>
                                  patch({ downloadAllPlantLods: event.target.checked })
                                }
                              />
                              <span>Download all LODs for 3D Plants</span>
                            </label>
                          )}
                          {(!plant || !options.downloadAllPlantLods) &&
                            lods.map(lod => (
                              <label className="toggle inline lod-row" key={lod.index}>
                                <input
                                  type="checkbox"
                                  checked={options.lods[lod.index] ?? true}
                                  onChange={event => {
                                    const next = options.lods.slice();
                                    next[lod.index] = event.target.checked;
                                    patch({ lods: next });
                                  }}
                                />
                                <span>LOD {lod.index}</span>
                                <em>
                                  {lod.tris ? `${lod.tris.toLocaleString()} tris` : ""}
                                  {lodBytes[lod.index] > 0
                                    ? ` · ${formatBytes(lodBytes[lod.index])}`
                                    : ""}
                                </em>
                              </label>
                            ))}
                          {plant && options.downloadAllPlantLods && (
                            <p className="hint">
                              All {lods.length} available LODs will be downloaded.
                            </p>
                          )}
                        </div>
                      )}

                      {plant && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={options.billboards}
                            onChange={event => patch({ billboards: event.target.checked })}
                          />
                          <span>Billboards</span>
                        </label>
                      )}

                      {(technical.hasHighpoly ||
                        technical.hasZtool ||
                        technical.hasBrushes) && (
                        <>
                          <span className="label">Extras</span>
                          {technical.hasHighpoly && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.highpoly}
                                onChange={event => patch({ highpoly: event.target.checked })}
                              />
                              <span>Highpoly Source</span>
                            </label>
                          )}
                          {technical.hasZtool && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.ztool}
                                onChange={event => patch({ ztool: event.target.checked })}
                              />
                              <span>Source ZTool</span>
                            </label>
                          )}
                          {technical.hasBrushes && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.brushes}
                                onChange={event => patch({ brushes: event.target.checked })}
                              />
                              <span>Brushes</span>
                            </label>
                          )}
                        </>
                      )}

                      {maxVariation > 1 && technical.variationDimensions.length <= 1 && (
                        <div className="form-row compact">
                          <label>Mesh variation</label>
                          <Dropdown
                            className="select-dropdown"
                            value={String(options.variation)}
                            onChange={value => patch({ variation: Number(value) })}
                            ariaLabel="Mesh variation"
                            options={Array.from({ length: maxVariation }, (_, index) => ({
                              value: String(index + 1),
                              label: `Var ${index + 1}`
                            }))}
                          />
                        </div>
                      )}
                      {technical.variationDimensions.length > 1 && (
                        <div className="variation-explorer">
                          <span className="label">Variation dimensions</span>
                          <div className="variation-chips">
                            {technical.variationDimensions.map(item => {
                              const dims = formatMeasurementText(
                                [item.length, item.width, item.height].filter(Boolean).join(" x ")
                              );
                              return (
                                <button
                                  type="button"
                                  key={item.variation}
                                  className={
                                    options.variation === item.variation
                                      ? "variation-chip active"
                                      : "variation-chip"
                                  }
                                  onClick={() => patch({ variation: item.variation })}
                                >
                                  <strong>Var {item.variation}</strong>
                                  {dims && <em>{dims}</em>}
                                </button>
                              );
                            })}
                          </div>
                          <p className="hint">Mesh variation is independent of LOD selection.</p>
                        </div>
                      )}
                      <p className="hint">
                        All settings are preferred options and will be downloaded when available.
                      </p>
                    </div>
                  )}

                  {plan && (
                    <div className="download-plan">
                      <div className="download-plan-head">
                        <strong>Download plan</strong>
                        <span>
                          {plan.bytes > 0
                            ? `~${formatBytes(plan.bytes)}${plan.partial ? "+" : ""}`
                            : "Size unavailable"}
                        </span>
                      </div>
                      <div className="download-plan-row">
                        <span>Textures</span>
                        <strong>
                          {plan.mapCount} maps · {plan.mapFiles} files
                          {plan.textureBytes > 0 ? ` · ${formatBytes(plan.textureBytes)}` : ""}
                        </strong>
                      </div>
                      {threeD && (
                        <div className="download-plan-row">
                          <span>Mesh</span>
                          <strong>
                            {plan.lodCount} LOD{plan.lodCount === 1 ? "" : "s"} · {plan.meshFiles} files
                            {plan.meshBytes > 0 ? ` · ${formatBytes(plan.meshBytes)}` : ""}
                          </strong>
                        </div>
                      )}
                      {technical.hasHighpoly && options.highpoly && (
                        <div className="download-plan-row">
                          <span>Highpoly</span>
                          <strong>included</strong>
                        </div>
                      )}
                      {technical.hasZtool && options.ztool && (
                        <div className="download-plan-row">
                          <span>ZTool</span>
                          <strong>included</strong>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="download-summary">
                    <span>
                      {plan?.bytes ? `~${formatBytes(plan.bytes)}${plan.partial ? "+" : ""}` : "Size unavailable"} - {selectedMaps} maps
                      {threeD ? ` - ${selectedLods} LOD${selectedLods === 1 ? "" : "s"}` : ""}
                    </span>
                    {threeD && <span>{options.meshFormat.toUpperCase()}</span>}
                  </div>
                </>
              )}

              {!auth.loggedIn ? (
                <button type="button" className="btn btn-primary btn-wide" onClick={() => void login()}>
                  <UserIcon /> Sign in with Epic to download
                </button>
              ) : active && progress ? (
                <div className="active-download">
                  <div className="download-top">
                    <strong>{progress.message ?? progress.status}</strong>
                    <span>
                      {bytes(progress.received)} / {bytes(progress.total)}
                    </span>
                  </div>
                  <div className="progress">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                    />
                  </div>
                  <div className="button-row horizontal">
                    {progress.status === "paused" ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void window.openbridge.downloads.resume(assetId)}
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void window.openbridge.downloads.pause(assetId)}
                      >
                        Pause
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void cancelDownload(assetId)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : !owned && points > 0 ? (
                <button type="button" className="btn btn-accent btn-wide" onClick={() => void acquire()}>
                  Acquire - {points.toLocaleString()} pts
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-accent btn-wide"
                  onClick={() => void download()}
                  disabled={!options}
                >
                  <DownloadIcon /> {points === 0 && !owned ? "Download free" : "Download"}
                </button>
              )}

              {progress?.status === "complete" && (
                <div className="complete-box">
                  <CheckIcon />
                  <span>Saved to {progress.path}</span>
                  {progress.path && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => void window.openbridge.openPath(progress.path!)}
                    >
                      Open folder
                    </button>
                  )}
                </div>
              )}

              {progress?.status === "error" && (
                <div className="error-box small">{progress.message}</div>
              )}

              {!owned && points > 0 && (
                <p className="hint">
                  Acquired assets are downloaded only for accounts that own them. Free assets are
                  acquired automatically.
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

