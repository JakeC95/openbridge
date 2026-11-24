# Send to Houdini · Linux pilot

This is an opt-in prototype for Houdini 20.5 / Python 3.11 and Arnold. It reads
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

The default uses the scene's supported render driver when unambiguous, then
`OPENBRIDGE_JOB_RENDERER` from the Houdini environment. The artist can override
with Arnold. V-Ray selection is recognized but its adapter is not implemented.

## Asset recipe

Only shared Library models with a `<indexed filename>.houdini.json` sidecar
show the action. This is not `presentation.json`: the preview is never an
implicit import source. Paths must resolve to regular files in registered
shared roots. Relative paths resolve next to the indexed file.

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
        "base_color": { "path": "textures/color.png", "colorSpace": "sRGB - Texture" },
        "specular_roughness": { "path": "textures/roughness.png", "colorSpace": "Raw" }
      }
    }
  ]
}
```

An empty group means all faces and is only valid for a single material.
Otherwise, supply the exact primitive group names Houdini reads from the OBJ.
Every primitive must be covered exactly once. The initial surface builder
handles base color, roughness and metalness. Use color-space names valid in
the target Houdini/OCIO configuration. Do not add a sidecar for an asset whose
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
