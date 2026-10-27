# Protocol reference

Everything here was recovered from `analysis/renderer-src/` and `analysis/main.pretty.js`. The goal is
wire compatibility with existing Bridge plugins and community scripts.

## 1. Local HTTP API

The original renderer runs an HTTP server (`app/components/SimpleHttpServer.js`):

- Bind: `127.0.0.1`
- Port: `electron-settings.bridgePortValue` or `28241`
- No authentication, no CORS headers, plain `http` module
- Responses are `application/json` (not always set as a header)

### Endpoints

| Method | Path | Response |
|---|---|---|
| GET | `/GetMegascansFolder/` | `{"folder":"<library path>"}` |
| GET | `/GetDownloadedAssets/` | JSON array of export objects for all downloaded assets |
| GET | `/GetDownloadedAssets/<query>` | same, filtered by a search string (max 10 assets) |
| GET | `/GetAllAssets/` | deprecated alias of `/GetDownloadedAssets/` |
| GET | `/Search/<query>` | deprecated alias |
| GET | `/GetSelectedAssets/` | export objects for the current UI selection |
| GET | `/GetSelectedAsset/` | deprecated alias |
| GET | `/GetCustomAssets/` | export objects for Custom/Mixer assets |
| GET | `/GetOfflineAssets/` | export objects for the offline library |
| GET | `/Reload/` | `"Assets reloaded"` |
| GET | `/getLastExport/` | JSON of `electron-settings.lastExportedAssets` |
| GET | `/clearLastExport/` | clears the last export and returns `""` |
| POST | `/log/` | body is logged, returns `"DONE LOGGING POST"` |
| POST/GET | `/analytics/` | body `{event,data}` forwarded to analytics |
| POST/GET | `/error/` | logs error and shows an in-app notification |
| any | anything else | `{possibleRequests:[...],youSent:"<url>",status:"Error : Invalid request"}` |

### Export object shape

`/GetDownloadedAssets/` and `/GetSelectedAssets/` return the same object that is sent to DCC
plugins over a socket. Built in `app/modules/exports.js` (`getAssetExportInfo`):

```jsonc
{
  "message": "export",
  "version": 1,                 // MixerJSONVersion
  "id": "xglxdjr",
  "name": "Desert Western Tree Branch Juniper S 01",
  "type": "3d",
  "category": "3d asset",
  "path": "C:\\...\\Downloaded\\3d\\...\\<asset folder>",
  "exportPath": "C:\\...\\LocalLow\\Quixel\\Megascans Bridge",
  "resolution": "8192",
  "resolutionValue": 8192,
  "textureFormat": "jpg",
  "meshFormat": "fbx",
  "exportAs": "default",        // default | usd | usdz | gltf | mdl
  "activeLOD": "lod0",
  "minLOD": "lod0",
  "previewImage": "C:\\...\\preview.jpg",
  "averageColor": [r,g,b],
  "tags": ["wood"],
  "categories": ["3d","nature"],
  "meta": [{"key":"...","value":"..."}],
  "materials": {},
  "textureSets": {},
  "workflow": "specular",
  "origin": "megascans",        // megascans | mixer-created | mixer-imported | bridge-custom
  "variation": 1,
  "isModularAsset": false,
  "guid": "<random uuid>",
  "namingConvention": "...",
  "folderNamingConvention": "...",
  "mapNameOverride": {"albedo":"albedo", "...":"..."},
  "components": [ { "type":"albedo", "format":"jpg", "resolution":"8192",
                    "name":"...", "nameOverride":"...", "path":"C:\\...",
                    "colorSpace":"sRGB", "physicalSize":"1x1",
                    "textureSets":["default"], "channelsData":[] } ],
  "meshList": [ { "type":"model", "format":"fbx", "path":"C:\\...", "name":"...", "nameOverride":"..." } ],
  "lodList":  [ { "lod":"lod0", "variation":1, "type":"model", "format":"fbx",
                  "path":"C:\\...", "name":"...", "nameOverride":"...", "lodObjectName":"..." } ],
  "meshVersion": 2,
  "packedTextures": [],
  "components-billboard": [ /* 3D plants only */ ],
  "packed-billboard": [ /* Unity billboards */ ],
  "scriptFilePath": "C:\\...\\<script>"
}
```

The renderer serializes an **array** of these objects with `JSON.stringify(...)` and writes it:

- to a DCC socket (see below), or
- to `<exportFolder>/megascansAsset.json` for `custom_export`.

## 2. Port discovery

`app/utils/bridge-active-port.js`:

- TCP server on `127.0.0.1:28852`
- On connection: writes the HTTP API port as a decimal string (default `28241`)
- This is how a DCC plugin finds the API if the user changed the port.

## 3. Mixer live link

`app/modules/MixerAPIManager.js`:

### New protocol (Mixer 2019.2+)

- Bridge **receives** on `127.0.0.1:28458`, **sends** on `127.0.0.1:28459`.
- Messages are a JSON array:

```json
[{ "message": "refresh", "id": "<assetId>", "path": "<assetPath>", "isExternal": false,
   "libraryPath": "<library>", "type": "3d", "version": 1 }]
```

- `message` is `refresh` or `delete`.
- Bridge compares `libraryPath` to the configured library and emits a UI refresh/remove event.

### Old protocol (Mixer 2019.1 and older)

- Bridge **receives** on `28456`, **sends** on `28457`.
- Payload is plain text: `<message>_<libraryPath>` (e.g. `refresh_C:\...\Megascans Library`).
- The asset object is the same fields serialized as JSON when using the newer socket.

## 4. DCC export sockets

The renderer connects to `127.0.0.1:<port>` and writes the JSON array from section 1. It expects no
reply; the socket is closed after writing. If Unreal is not running, the app shows
"Please make sure Unreal Engine is running before exporting assets."

| Tool | Port | Source |
|---|---:|---|
| Unreal Engine | `13429` | `plugin_versions_13.json` `defaultPort` |
| Unreal legacy (4.15–4.21) | `13428` | `legacyPort` |
| 3ds Max | `13292` | manifest |
| Maya | `13291` | manifest |
| Unity | `13081` | manifest |
| Blender | `28888` | manifest |
| Houdini | `13290` | manifest |
| Cinema 4D | `24420` | manifest |
| Clarisse | `24981` | manifest |
| Custom socket export | user-defined (`24981` default) | manifest |
| Mixer | `28459` (fallback `28457`) | manifest / code |

Marmoset does not use a socket: Bridge writes `<assetId>.tbmat` into the configured export folder.
3ds Max also writes `<LocalLow>/Quixel/Megascans Bridge/MaxScript.ms` plus `ConnectFile.txt`.

## 5. Download API

Request (`POST https://quixel.com/v1/downloads`, bearer token required):

```jsonc
{
  "asset": "xglxdjr",
  "components": [
    { "type": "albedo", "mimeType": "image/jpeg", "resolution": 8192 },
    { "type": "normal", "mimeType": "image/jpeg", "resolution": 8192 }
  ],
  "meshes": [
    { "type": "high", "mimeType": "application/x-fbx" }
  ],
  "billboards": false,          // 3D plants only
  "config": { "resolution": 8192, "format": "fbx", "lod": "lod0" }
}
```

Response (observed shape inferred from callers):

```jsonc
{
  "components": [
    { "uri": "https://.../Albedo_8K.jpg", "saveAs": "Albedo_8K.jpg", "contentLength": 1234567 }
  ],
  "meshes": [
    { "uri": "https://.../mesh.fbx", "saveAs": "mesh.fbx", "contentLength": 9876543 }
  ],
  "billboards": []
}
```

The URLs are pre-signed (S3/CloudFront). The original passes them to Electron's
`webContents.downloadURL()`; it does not add auth headers to the file downloads.

`GET https://rps.quixel.com/generateSignedUrl` returns `{ "url": "...*?...", "expiresIn": 300 }`.
Replace the `*` in the URL with a file name to fetch hosted previews/meshes:

```js
url.slice(0, url.indexOf(".com/*?") + 5) + fileName + url.slice(url.indexOf(".com/*?") + 6)
```

## 6. Plugin manifest

`https://d3uwib8iif8w1p.cloudfront.net/bridge/plugin_versions_13.json`

```jsonc
{
  "pluginsPath": "https://d3uwib8iif8w1p.cloudfront.net/bridge_gamedev/plugins/",
  "resourceFiles": "https://d3uwib8iif8w1p.cloudfront.net/bridge/Resources.zip",
  "plugins": {
    "unreal": {
      "name": "unreal",
      "displayName": "Unreal Engine",
      "win-version": "8.2",
      "linux-version": "8.2",
      "mac-version": "8.2",
      "pluginDirectory": "plugin",
      "defaultPort": "13429",
      "legacyPort": "13428",
      "portEditable": false,
      "supportedversions": ["5.5", "5.4", "5.3", "5.2", "5.1", "5.0", "4.27", "4.26", "4.25", "4.24", "4.23", "4.22"],
      "requiresDownload": true,
      "requiresInstall": true,
      "version": "8.2"
    }
  }
}
```

Plugin files are installed under `<library>/support/plugins/<tool>/<version>/`. A tool's export
scripts are discovered by scanning `.py` / `.ms` files for a header:

```
--tool: maya
--name: Quixel Bridge
--type: export
--renderer: Arnold 7.0
--author: Quixel
```

`--renderer` is used to build the UI list; the trailing token is parsed as a version.

## 7. Library on disk

```
<library>/
  Downloaded/
    3d/ atlas/ surface/ 3dplant/ brush/
      <asset folder>/
        *.json                     (asset JSON; ignore *_export.json, megascansassets*.json)
        *preview*.jpg|png          (or *grid*)
        *thumb*.jpg|png
        <maps, meshes, Textures/Atlas, Textures/Billboard>
    DHI/                           (MetaHumans)
    assetsData.json                (cache)
  Custom/                          (Mixer-created / imported)
  support/
    plugins/<tool>/<version>/
    utils/                         (image processor, Assimp)
```

`assetsData.json` is an array of records with at least
`id,name,type,categories,tags,path,jsonPath,preview,thumb,mtime,previewRelativeSize`.
The original rewrites it after a scan; a clone should treat it as a cache and never rely on it as
the source of truth.

## 8. Image processor invocation

```
"<library>/support/utils/<...>/ImageProcessor" "<json file>"
```

Request JSON (channel packing example):

```jsonc
{
  "message": "channel-pack",
  "resolution": 8192,
  "path": "C:\\...\\packedTextures",
  "isCutom": false,
  "components": [ { "type": "albedo", "path": "C:\\..." } ],
  "presets": [
    { "name": "ORM", "format": "png", "extension": ".png", "isGrayscale": false,
      "texType": "RGB", "numberOfChannels": 3, "typeForJSON": "orm",
      "namingConvention": "ORM", "channelsData": [] }
  ]
}
```

It prints a JSON response on stdout with `success` and `packedTextures`.

## 9. Assimp invocation

```
"<library>/support/utils/Assimp/assimp" export "<input.fbx|obj>" "<output.obj>" -config=full
```

Used only to produce an OBJ for the Three.js 3D preview.
