# Send to Houdini · Linux pilot

## Production input policy

**GLB is for OpenBridge previews only.** Never use a preview GLB, geometry
extracted from one, or textures recovered from one in a DCC handoff. Prefer
the asset's original Alembic geometry; use the original FBX when it represents
the same asset and variant and its bindings can be verified. If neither
qualifies, report the missing source rather than silently substituting.

During ingest, record the DCC-independent handoff data in a per-asset JSON
manifest: exact source paths and selected objects/variant, verified units and
axis, stable assignment keys, source texture paths and roles (including color
spaces, packed channels, and UDIM tiles), material parameters, and explicit
limitations. Validate that manifest against the actual geometry and files.
Keep it separate from preview presentation data; target DCC adapters consume
the same source facts and build their own renderer graphs.

The current connector predates this policy: Alembic is supported, OBJ is
retained for the synthetic pilot, and production FBX is not yet implemented.
An existing successful preview or demonstration HIP is not handoff acceptance.

For FBX, use a **File SOP** as the source reader, not Houdini's whole-scene
FBX importer. Keep variant selection, unit conversion and renderer
assignment downstream in the same SOP network, and verify counts and
bindings against the original FBX. The File SOP may extract embedded media
beside its input. Do not enable production FBX Send until that behavior is
handled without writing into the source library. In a scratch review only,
an explicitly labeled byte-identical FBX copy can isolate that side effect.

This is an opt-in prototype for Houdini 20.5 / Python 3.10 or 3.11 and Arnold. It reads
geometry and textures in place. It does not copy, publish, convert, or version
the asset. A saved HIP follows those paths; moving or editing the files can
change later renders. Do not use a disposable preview cache as a source.

## Connector

Create `openbridge.json` under your Houdini user `packages` directory, pointing
at `integrations/houdini` in a stable location:

```json
{ "hpath": "/path/to/OpenBridge/integrations/houdini" }
```

Restart Houdini with HtoA loaded. The connector starts through `uiready.py`
in interactive Houdini only, without replacing the studio scene-load hook.
It uses a private per-user Unix socket and changes the scene only on
Houdini's UI thread.

Click in the desired Network Editor before
switching to OpenBridge. **Send to Houdini** creates a Geometry object at
`/obj` or a disconnected subnet in an editable SOP network. It does not wire
into existing nodes. If several sessions are running, choose the destination
in the session picker. Check the scene before retrying a timed-out send.

The default uses the scene's supported render driver when unambiguous
(including drivers nested in object-level lookdev ROP networks), then
`OPENBRIDGE_JOB_RENDERER` from the Houdini environment. The artist can override
with Arnold. V-Ray selection is recognized but its adapter is not implemented.

## Asset recipe

Shared Library models in an asset folder with a canonical
[`asset.json`](ASSET-MANIFEST.md) show the action. Send requires an approved
Houdini/Arnold route and reports unsupported features before contacting Houdini.
The following `<indexed filename>.houdini.json` format is retained only for
pilot compatibility when the canonical record is absent. Relative legacy
paths resolve next to the indexed file.

```json
{
  "schemaVersion": 1,
  "geometry": "production.obj",
  "metersPerUnit": 1,
  "upAxis": "Y",
  "materials": [
    {
      "group": "",
      "maps": {
        "base_color": { "path": "textures/color.png", "fileColorSpace": "srgb" },
        "specular_roughness": { "path": "textures/roughness.png", "fileColorSpace": "raw" }
      }
    }
  ]
}
```

An empty group means all faces and is only valid for a single material.
Otherwise, supply the exact primitive group names Houdini reads from the OBJ.
For an Alembic source, use the exact authored `shop_materialpath` string from
the unpacked faces as `group`; the importer checks the remapped material on
each face after cooking. Every primitive must be covered exactly once.
Unpack on the Alembic SOP and generate primitive groups from transform
node names there, without adding an Unpack SOP. Full Alembic paths remain
the source keys for object bindings; the visible group names are for browsing.
Use polygon soups for object-path bindings, but keep polygons separate
when remapping authored face material assignments.
The Arnold surface builder handles base color, roughness, metalness and
tangent-space normal textures. A material without a base-color texture needs
an explicit `baseColor` RGB value; `roughness` can be specified as a constant.
`fileColorSpace` describes file encoding, not the working space or display
view. The Arnold adapter resolves it against the active OCIO config, checks
the processor to the scene-linear role and rejects color transforms on
normal, roughness and metalness data. Record evidence for the encoding; don't
derive it solely from the file extension or set everything to ACEScg.
Do not add a sidecar for an asset whose
verified look requires unsupported channels or geometry formats.
Before rendering from production paths, check HtoA's texture-cache settings:
Arnold can generate `.tx` files next to referenced images during rendering.
The importer itself does not write to the library.

## Acceptance

Run `hython scripts/test-houdini-handoff.py` with HtoA loaded. This is a graph/
persistence test, not a render approval. Separately verify the packaged app
button and the receiving UI, then review an Arnold render of an audited
production source and run a farm smoke render from the saved HIP. Only then
mark that asset Houdini-ready. Preview readiness is separate. Existing
prepared local entries and downloaded providers are not automatically eligible.

The packaged acceptance fixture uses a synthetic asset and a stand-in socket
receiver. The Houdini test independently checks the real Arnold nodes and file
references in a saved scene. Neither test substitutes for a live send and a
renderer-specific look review of a real asset. For the next renderer adapter,
check OCIO roles and connected shader inputs against the renderer's actual node
definitions; a successfully cooked graph alone does not establish visual parity.

For a real asset, verify the source geometry, physical scale, up axis,
per-face bindings, and each map's role before adding a recipe. An asset whose
indexed entry contains only a preview can point to separate production files
once those paths are registered and audited. Keep private recipes and
acceptance evidence out of the public repository.
