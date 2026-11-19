# Shared asset library design

Status: proposed. The current Library supports provider-specific layouts and managed downloads.
This design adds existing model and HDRI folders as named Library sources. Users register each
root in Settings and browse files in place alongside their downloaded assets.

## 1. Index existing folders

- Give each root a stable ID, label, type and machine-specific path. A Linux mount and a Windows
  UNC path or mapped drive can represent the same root. Store asset locators relative to that
  root. Keep filename spelling and report case collisions that prevent resolution on Windows.
- Add shared assets as a local origin in Library. Keep catalogue provider IDs and download
  dispatch separate. Use SQLite and FTS for search, counts and paging, with the index on local
  storage. Reconcile each root or scanned branch only after a successful scan. A disconnected
  mount or a permissions error should preserve the last good index and mark it unavailable.
- Start with bounded, cancellable background scans. Read names, timestamps and sizes first.
  Probe geometry, images and dependencies when needed. Avoid full-file hashing and scanning
  archives on startup. Exclude staging and cache folders by configurable rules. Prevent
  symlinks and Windows reparse points from escaping registered roots.
- Support both standalone files and nested asset folders. Use explicit manifests where they
  exist. Group versions, LODs, maps, UDIMs, renders and variants when filenames or metadata
  support the grouping. Keep ambiguous files separate and allow explicit grouping and relinking.
  Count independent assets in the same folder separately.

## 2. Reuse model and HDRI previews

- Use the existing 3D viewer for supported interchange files such as GLB, glTF, FBX, OBJ and
  USD. Offer available variants, versions and LODs. Build manifests from indexed file IDs and
  validate dependency paths before loading. Preserve relative paths so textures and OBJ
  materials resolve correctly even when other assets have files with the same name.
- Offer **Open in DCC** for native project files or interchange files the viewer cannot
  inspect, such as Maya scenes and Alembic caches. An artist can publish a viewer-friendly
  proxy beside a native scene. The indexer does not execute embedded scripts or unpack
  archives. Show missing dependencies and unsupported formats in the inspector.
- Use the local HDR worker and existing flat, panorama and exposure viewers for supported HDR
  and EXR files. Check image dimensions and projection before offering panorama mode. Prefer
  an existing preview or an appropriate smaller variant for oversized files. Add optional
  bounded proxy generation later, with linear colour retained for exposure controls. Tiled,
  multipart, deep or oversized EXRs can still be opened or exported in their original form.
- Keep thumbnails and proxies under local app data. Invalidate cached previews when their
  source changes. Show which file and resolution a preview uses.

## 3. Bring Library workflows across

| Workflow | Shared folder equivalent |
| --- | --- |
| Search, filters and saved searches | Search names, valid metadata and tags. Filter by root, type, format and available map, LOD or HDR resolution. Use global quick matches and saved searches without an account. |
| Grid, list, comparison and inspector | Reuse the Library views, multi-select and preview controls. Show measured or declared dimensions, triangles, maps, file sizes and formats when known. |
| Favorites, tags, notes and collections | Store user metadata separately from the rebuildable index so it survives re-scans and offline shares. Team-wide metadata can follow once permissions and concurrent edits are defined. |
| Health, missing assets and duplicates | Report offline roots, missing references, unsupported previews, empty files and duplicate candidates. Make the distinction between a missing file and a disconnected share visible. |
| Copy, export and open | Reveal the source, open it in a DCC, or copy selected variants and dependencies into a project with progress and conflict handling. Build exports from the selected file manifest and preserve the legacy Bridge export for managed assets. |
| Acquisition, credits and downloads | Use file availability, local versions, copy and export status. Ownership, purchases and provider signing remain catalogue operations. |

The first release treats registered roots as read-only. Organization happens in OpenBridge,
and copy or export writes only to an explicit destination. Removing an item from a collection
does not delete source files. Shared renames, moves and deletes can follow once permissions,
path validation, audit and conflict handling are defined.

## Pilot and acceptance checks

1. Register one model root and one HDRI root. Sample a nested project, a loose interchange
   model with textures, a native-only scene, a multi-resolution HDRI and an oversized EXR.
2. Verify quick matches, filters, comparison, 3D materials, HDR exposure and native-file
   handoff on representative assets. Verify that missing facts remain unknown.
3. Restart, rebuild the index, remap a root and disconnect and reconnect the share. Confirm
   cached results and user organization survive. Exercise cancellation and measure scanning
   and preview latency with the share in use.
4. Exercise spaces, Unicode, duplicate basenames, case differences, sidecar references and
   references outside the root. Use synthetic fixtures for CI on Windows and Linux.
5. Copy a selected package to a disposable project. Verify its dependencies, check the
   original tree for changes, and confirm provider-managed downloads and exports still work.

## Implementation starting points

- `src/main/library.ts` and `src/main/library-index.ts` handle scans and FTS. Root-scoped
  reconciliation is needed before mount changes can be tracked independently.
- `src/main/model-preview.ts` and `src/renderer/components/ModelViewer.tsx` handle local models
  and rendering. Shared model loading needs exact indexed files and validated dependencies.
- `src/main/hdr-decode-worker.ts`, `src/renderer/components/HdrCanvas.tsx` and
  `src/renderer/components/PanoramaCanvas.tsx` provide the existing decode and viewing paths.
- `src/renderer/views/LibraryView.tsx` and `src/main/exporter.ts` are the starting points for
  local browsing and file operations. Add shared source capabilities before exposing actions.
