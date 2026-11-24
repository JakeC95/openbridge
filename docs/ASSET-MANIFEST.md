# Asset ingest manifest

`asset.json` is the canonical DCC-independent ingest record. Store it in the
asset’s own presentation/index folder (one asset per folder). Files stay in
place: a `root` is a registered library root ID and `path` is relative to that
root, not to the manifest. Keep private manifests, original graphs, and audit
evidence out of the public repo. `presentation.json` remains the preview/UI
record and must never supply production geometry or textures.

## Contract

The runtime schema and cross-reference validation are in
[`src/shared/asset-manifest.ts`](../src/shared/asset-manifest.ts). The
[synthetic example](../scripts/fixtures/asset-manifest.mjs) demonstrates one
manifest with a geometry cache, a native rig, a distinct FBX variant, source
and preview files, native shader values, and a portable look.

| Section | Record |
| --- | --- |
| `variants`, `files`, `representations` | Distinct asset variants and per-variant source/cache/rig/preview representations. Prefer the original Alembic; select an FBX only when the same variant and expected data are verified. Use `selection` for pack roots, and retain LOD, units, axes, bounds, hierarchy, part IDs, UVs and motion when known. `retained`/`losses` describe that representation, not the whole asset. |
| `bindingSets` | Exact source selectors mapped to stable material IDs. Mark coverage incomplete when not substantiated. Reference a separately inventoried assignment table for a large face-level mapping; don't inline millions of face IDs. |
| `materials`, `textures` | Preserve native renderer, shader and graph references and original controls. Define a portable surface separately. Each input can specify packed component, UV set, alpha semantics and sampling. Texture sets list literal UDIM tile IDs or sequence files. Preserve unsupported inputs instead of dropping them. |
| `evidence`, `handoffs` | Link facts to verified, inferred, translated, missing, or unsupported evidence. Readiness is specific to variant, DCC, and renderer. Choose the exact representation and link verified acceptance evidence for `ready`; `review`, `blocked`, and `unverified` are not send approval. |

In `textures[].encoding`, `space` is the **file encoding**, not the display
view or desired working space. Preserve any custom OCIO config, gamma, or
downstream transform; use `null` where encoding is unknown. A normal or scalar
channel is data even when stored in an RGB file. Do not use file extensions to
guess color encoding and do not silently reapply a transform already baked in.
Adapter-specific details not yet standardized can be preserved in `extensions`
or native parameters, but never assume another adapter implements them.

## Validation and adapter workflow

1. Inspect the actual sources during ingest; record fingerprints (`bytes`,
   integer `mtimeMs`, optionally `sha256` for deeper audits) and linked
   evidence. The manifest is descriptive, not a copy or versioning system.
2. Validate shape and references. Keep missing facts explicit. Missing
   source geometry, variant differences, unsupported bindings, and unapproved
   color assumptions must not become `ready` just because the preview works.
3. At handoff, use the selected route and check only its dependencies. The
   resolver canonicalizes paths inside registered roots, rejects preview
   dependencies, and checks size/mtime against the ingest fingerprint where
   provided. SHA-256 is recorded for deeper audits, not recomputed at send.
4. Compile a small renderer/DCC request. The Houdini/Arnold adapter currently
   supports original static Alembic, complete inline source-material or
   object-path assignments, and its four supported map roles. It rejects
   selected pack roots, unsupported shader features, UDIMs, custom OCIO
   transforms, and FBX with explicit errors; the manifest retains them.
   The second-target test demonstrates native Maya representation selection
   from the same record; it is not a live Maya adapter.

The legacy `.houdini.json` is only a pilot compatibility path for assets
without a canonical manifest. If `asset.json` exists, OpenBridge prefers it
and does not bypass its errors or blocked state via the legacy sidecar.

Validate a private record with `node scripts/validate-asset-manifest.mjs path/to/asset.json`
and run `npm run test:asset-manifest` for regressions. Before enabling send for an asset, verify
the actual adapter result and its saved scene. Follow the artist's review
requirements before approving production look or farm compatibility.
