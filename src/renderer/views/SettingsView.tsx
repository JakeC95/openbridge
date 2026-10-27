import { useEffect, useState } from "react";
import { useStore } from "../store";
import type {
  AppSettings,
  AssetDefaultsKind,
  DownloadPreset
} from "../../shared/types";
import {
  commonMapTypesForKind,
  mapTypesForKind,
  recommendedDownloadDefaults
} from "../../shared/download-defaults";
import { CheckIcon, FolderIcon, SyncIcon, UserIcon } from "../icons";
import { Dropdown } from "../components/Dropdown";
import { mapTypeLabel } from "../download-options";

const PRESET_SECTIONS: Array<{
  kind: AssetDefaultsKind;
  title: string;
  description: string;
  mesh: boolean;
  lods: boolean;
  plant: boolean;
}> = [
  {
    kind: "3d",
    title: "3D Assets",
    description: "Default resolution, texture format, mesh and LOD behaviour for 3D models.",
    mesh: true,
    lods: true,
    plant: false
  },
  {
    kind: "3dplant",
    title: "3D Plants",
    description: "Plant-specific LOD, billboard and mesh defaults.",
    mesh: true,
    lods: true,
    plant: true
  },
  {
    kind: "surface",
    title: "Surfaces",
    description: "Texture resolution and format defaults for surface sets.",
    mesh: false,
    lods: false,
    plant: false
  },
  {
    kind: "other",
    title: "Other 2D Assets",
    description: "Atlases, decals, imperfections, displacements and brushes.",
    mesh: false,
    lods: false,
    plant: false
  }
];

function updatePreset(
  settings: AppSettings,
  kind: AssetDefaultsKind,
  patch: Partial<DownloadPreset>
): AppSettings {
  return {
    ...settings,
    downloadDefaults: {
      ...settings.downloadDefaults,
      [kind]: { ...settings.downloadDefaults[kind], ...patch }
    }
  };
}

export function SettingsView() {
  const settings = useStore(state => state.settings);
  const auth = useStore(state => state.auth);
  const profile = useStore(state => state.profile);
  const sync = useStore(state => state.sync);
  const update = useStore(state => state.update);
  const versions = useStore(state => state.versions);
  const saveSettings = useStore(state => state.saveSettings);
  const login = useStore(state => state.login);
  const logout = useStore(state => state.logout);
  const runSync = useStore(state => state.runSync);
  const installUpdate = useStore(state => state.installUpdate);

  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (!draft) {
    return (
      <div className="view">
        <div className="empty">
          <h2>Loading settings...</h2>
        </div>
      </div>
    );
  }

  function patch(update: Partial<AppSettings>) {
    setDraft(current => (current ? { ...current, ...update } : current));
  }

  async function chooseLibrary() {
    const folder = await window.openbridge.chooseDirectory();
    if (folder) patch({ libraryPath: folder });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await saveSettings(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view settings">
      <div className="view-header">
        <div className="header-line">
          <div>
            <p className="view-subtitle">Library, download defaults, sync and updates</p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              <CheckIcon /> {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>

      <div className="view-body settings-body">
        <section className="settings-section">
          <h2>Library</h2>
          <div className="form-row">
            <label>Megascans library</label>
            <div className="path-input">
              <input value={draft.libraryPath} readOnly />
              <button type="button" className="btn btn-ghost" onClick={() => void chooseLibrary()}>
                <FolderIcon /> Change...
              </button>
            </div>
          </div>
          <p className="hint">
            This is the same library Bridge uses for downloaded Megascans assets. OpenBridge
            indexes it in place.
          </p>
        </section>

        <section className="settings-section">
          <h2>Download defaults by asset type</h2>
          <p className="hint">
            These defaults are used for single downloads and bulk downloads. Drawer changes apply
            to that download only.
          </p>

          <div className="preset-sections">
            {PRESET_SECTIONS.map(section => {
              const preset = draft.downloadDefaults[section.kind];
              return (
                <div className="preset-card" key={section.kind}>
                  <div className="preset-card-head">
                    <div>
                      <h3>{section.title}</h3>
                      <p>{section.description}</p>
                    </div>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() =>
                        patch(
                          updatePreset(
                            draft,
                            section.kind,
                            recommendedDownloadDefaults()[section.kind]
                          )
                        )
                      }
                    >
                      Reset
                    </button>
                  </div>

                  <div className="form-grid">
                    <div className="form-row">
                      <label>Resolution</label>
                      <Dropdown
                        className="select-dropdown"
                        value={String(preset.resolution)}
                        onChange={value =>
                          patch(updatePreset(draft, section.kind, { resolution: Number(value) }))
                        }
                        ariaLabel={`${section.title} default resolution`}
                        options={[1024, 2048, 4096, 8192].map(value => ({
                          value: String(value),
                          label: `${value / 1024}K`
                        }))}
                      />
                    </div>

                    <div className="form-row">
                      <label>Texture format</label>
                      <Dropdown
                        className="select-dropdown"
                        value={preset.textureFormat}
                        onChange={value =>
                          patch(
                            updatePreset(draft, section.kind, {
                              textureFormat: value as DownloadPreset["textureFormat"]
                            })
                          )
                        }
                        ariaLabel={`${section.title} default texture format`}
                        options={[
                          { value: "jpg", label: "JPG" },
                          { value: "exr", label: "EXR" }
                        ]}
                      />
                    </div>

                    {section.mesh && (
                      <div className="form-row">
                        <label>Mesh format</label>
                        <Dropdown
                          className="select-dropdown"
                          value={preset.meshFormat}
                          onChange={value =>
                            patch(
                              updatePreset(draft, section.kind, {
                                meshFormat: value as DownloadPreset["meshFormat"]
                              })
                            )
                          }
                          ariaLabel={`${section.title} default mesh format`}
                          options={[
                            { value: "fbx", label: "FBX" },
                            { value: "abc", label: "ABC" }
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  <div className="preset-maps">
                    <div className="preset-maps-head">
                      <span className="label">Default maps</span>
                      <div className="preset-maps-actions">
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() =>
                            patch(
                              updatePreset(draft, section.kind, {
                                selectedMaps: [...commonMapTypesForKind(section.kind)]
                              })
                            )
                          }
                        >
                          Common
                        </button>
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() =>
                            patch(
                              updatePreset(draft, section.kind, {
                                selectedMaps: [...mapTypesForKind(section.kind)]
                              })
                            )
                          }
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() =>
                            patch(updatePreset(draft, section.kind, { selectedMaps: [] }))
                          }
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="preset-map-grid">
                      {mapTypesForKind(section.kind).map(type => {
                        const active = preset.selectedMaps.includes(type);
                        return (
                          <button
                            type="button"
                            key={type}
                            className={active ? "map-chip active" : "map-chip"}
                            aria-pressed={active}
                            onClick={() =>
                              patch(
                                updatePreset(draft, section.kind, {
                                  selectedMaps: active
                                    ? preset.selectedMaps.filter(value => value !== type)
                                    : [...preset.selectedMaps, type]
                                })
                              )
                            }
                          >
                            {mapTypeLabel(type)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="preset-maps-note">
                      Only maps present on an asset are requested.{" "}
                      {preset.selectedMaps.length} selected.
                    </p>
                  </div>

                  {section.lods && (
                    <div className="preset-options">
                      <span className="label">Default LODs</span>
                      <div className="preset-lods">
                        {preset.lods.map((enabled, index) => (
                          <label className="toggle inline" key={index}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={event => {
                                const lods = preset.lods.slice();
                                lods[index] = event.target.checked;
                                patch(updatePreset(draft, section.kind, { lods }));
                              }}
                            />
                            <span>LOD {index}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="preset-options">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={preset.uniqueMapsPerLod}
                        onChange={event =>
                          patch(
                            updatePreset(draft, section.kind, {
                              uniqueMapsPerLod: event.target.checked
                            })
                          )
                        }
                      />
                      <span>Use unique maps per LOD when available</span>
                    </label>

                    {section.kind === "3d" && (
                      <>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={preset.highpoly}
                            onChange={event =>
                              patch(
                                updatePreset(draft, section.kind, {
                                  highpoly: event.target.checked
                                })
                              )
                            }
                          />
                          <span>Include Highpoly Source</span>
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={preset.ztool}
                            onChange={event =>
                              patch(
                                updatePreset(draft, section.kind, {
                                  ztool: event.target.checked
                                })
                              )
                            }
                          />
                          <span>Include Source ZTool</span>
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={preset.brushes}
                            onChange={event =>
                              patch(
                                updatePreset(draft, section.kind, {
                                  brushes: event.target.checked
                                })
                              )
                            }
                          />
                          <span>Include Brushes</span>
                        </label>
                      </>
                    )}

                    {section.plant && (
                      <>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={preset.downloadAllPlantLods}
                            onChange={event =>
                              patch(
                                updatePreset(draft, section.kind, {
                                  downloadAllPlantLods: event.target.checked
                                })
                              )
                            }
                          />
                          <span>Download all LODs for 3D Plants</span>
                        </label>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={preset.billboards}
                            onChange={event =>
                              patch(
                                updatePreset(draft, section.kind, {
                                  billboards: event.target.checked
                                })
                              )
                            }
                          />
                          <span>Include billboards</span>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="settings-section">
          <h2>Sync</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.autoSyncEnabled}
              onChange={event => patch({ autoSyncEnabled: event.target.checked })}
            />
            <span>Check for acquired assets missing from the library</span>
          </label>
          <p className="hint">
            This only reports differences. Downloads are always started by you.
          </p>
          <div className="form-row">
            <label>Check every</label>
            <Dropdown
              className="select-dropdown"
              value={String(draft.syncIntervalMinutes)}
              onChange={value => patch({ syncIntervalMinutes: Number(value) })}
              ariaLabel="Sync interval"
              options={[
                { value: "15", label: "15 minutes" },
                { value: "30", label: "30 minutes" },
                { value: "60", label: "1 hour" },
                { value: "240", label: "4 hours" },
                { value: "1440", label: "1 day" }
              ]}
            />
          </div>
          <div className="inline-status">
            <SyncIcon className={sync.running ? "spin" : ""} />
            <span>
              {sync.running
                ? "Checking..."
                : sync.lastSynced
                  ? `Last check ${new Date(sync.lastSynced).toLocaleString()}`
                  : "Never checked"}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => void runSync()}>
              Check now
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h2>Account</h2>
          {auth.loggedIn ? (
            <div className="account-row">
              <div className="avatar large">{auth.email.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{auth.email}</strong>
                <p>{profile?.subscription?.planId || auth.planId || "No active plan"}</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void login()}>
              <UserIcon /> Sign in with Epic
            </button>
          )}
        </section>

        <section className="settings-section">
          <h2>Updates</h2>
          <div className="inline-status">
            <span>
              OpenBridge v{versions?.app ?? "1.2.3"}
              {update?.available ? ` — version ${update.latest} is available` : ""}
              {update?.error ? ` — ${update.error}` : ""}
            </span>
            <button type="button" className="btn btn-primary" onClick={() => void installUpdate()}>
              Check and install
            </button>
          </div>
          <p className="hint">
            Updates download, install and restart OpenBridge automatically. No feed URL needed.
          </p>
        </section>

        <details className="settings-advanced">
          <summary>Advanced / legacy integration</summary>
          <div className="settings-section">
            <h2>Local services</h2>
            <div className="form-grid">
              <div className="form-row">
                <label>HTTP API port</label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={draft.apiPort}
                  onChange={event => patch({ apiPort: Number(event.target.value) })}
                />
              </div>
              <div className="form-row">
                <label>Discovery port</label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={draft.discoveryPort}
                  onChange={event => patch({ discoveryPort: Number(event.target.value) })}
                />
              </div>
            </div>
            <p className="hint">
              Only needed for Bridge plugin/discovery compatibility on <code>127.0.0.1</code>.
            </p>
          </div>

          <div className="settings-section">
            <h2>Diagnostics</h2>
            <div className="inline-status">
              <span>
                Electron {versions?.electron} — Chromium {versions?.chrome} — Node {versions?.node}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.openbridge.openLogs()}
              >
                Open log
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
