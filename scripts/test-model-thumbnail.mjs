import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const directory = await realpath(await mkdtemp(join(tmpdir(), "openbridge-geometry-thumbnail-")));
try {
  await build({ entryPoints: ["src/main/model-thumbnail.ts"], outfile: join(directory, "helper.cjs"), bundle: true,
    platform: "node", format: "cjs", external: ["electron"], define: { __dirname: JSON.stringify(resolve("out/main")) },
    plugins: [{ name: "thumbnail-stalled-filesystem", setup(bundler) {
      bundler.onResolve({ filter: /^node:fs\/promises$/ }, args => args.namespace === "thumbnail-fixture" ? undefined : { path: args.path, namespace: "thumbnail-fixture" });
      bundler.onLoad({ filter: /.*/, namespace: "thumbnail-fixture" }, () => ({ contents: `
        import * as fs from "node:fs/promises";
        export const { mkdir, readdir, rename, rm, stat, writeFile } = fs;
        export const lstat = (...args) => globalThis.thumbnailFixtureStall?.(args[0]) ?? fs.lstat(...args);
      ` }));
    } }]
  });
  // Minimal binary FBX with a mesh, authored material and deliberately unavailable image.
  const prop = (type, value) => {
    if (type === "S") { const text=Buffer.from(value), head=Buffer.alloc(5); head.write(type); head.writeUInt32LE(text.length,1); return Buffer.concat([head,text]); }
    const out=Buffer.alloc(9); out.write(type); out.writeBigInt64LE(BigInt(value),1); return out;
  };
  const arr = (type, values) => { const width=type==="d"?8:4, out=Buffer.alloc(13+values.length*width);out.write(type);out.writeUInt32LE(values.length,1);out.writeUInt32LE(values.length*width,9);values.forEach((value,index)=>type==="d"?out.writeDoubleLE(value,13+index*width):out.writeInt32LE(value,13+index*width));return out; };
  const n=(name,properties=[],children=[])=>({name,properties,children});
  const roots=[n("Objects",[],[
    n("Geometry",[prop("L",1),prop("S","Geometry::Fixture"),prop("S","Mesh")],[n("Vertices",[arr("d",[-1,-1,0,1,-1,0,0,1,0])]),n("PolygonVertexIndex",[arr("i",[0,1,-3])])]),
    n("Model",[prop("L",2),prop("S","Model::Fixture"),prop("S","Mesh")]),
    n("Material",[prop("L",3),prop("S","Material::Paint"),prop("S","")],[n("ShadingModel",[prop("S","phong")])]),
    n("Texture",[prop("L",4),prop("S","Texture::Image"),prop("S","")],[n("FileName",[prop("S","NeverDecode.png")])]),
    n("Video",[prop("L",5),prop("S","Video::Image"),prop("S","Clip")],[n("Filename",[prop("S","NeverDecode.png")]),n("RelativeFilename",[prop("S","NeverDecode.png")])])
  ]),n("Connections",[],[["OO",1,2],["OO",2,0],["OO",3,2],["OP",4,3,"DiffuseColor"],["OO",5,4]].map(values=>n("C",values.map(value=>prop(typeof value==="string"?"S":"L",value)))))];
  function encode(node,offset){const name=Buffer.from(node.name),properties=Buffer.concat(node.properties);let cursor=offset+13+name.length+properties.length;const children=node.children.map(child=>{const out=encode(child,cursor);cursor+=out.length;return out;});const tail=Buffer.alloc(node.children.length?13:0),header=Buffer.alloc(13);header.writeUInt32LE(cursor+tail.length);header.writeUInt32LE(node.properties.length,4);header.writeUInt32LE(properties.length,8);header[12]=name.length;return Buffer.concat([header,name,properties,...children,tail]);}
  const fbxHeader=Buffer.alloc(27);fbxHeader.write("Kaydara FBX Binary  \0\x1a\0","binary");fbxHeader.writeUInt32LE(7400,23);let offset=27;
  await writeFile(join(directory,"Fixture.fbx"),Buffer.concat([fbxHeader,...roots.map(node=>{const out=encode(node,offset);offset+=out.length;return out;}),Buffer.alloc(13+176)]));
  const main = `
const assert = require('node:assert/strict');
const { app, nativeImage, session } = require('electron');
const { writeFile, readFile, stat, open, utimes } = require('node:fs/promises');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { modelGeometryThumbnail } = require(${JSON.stringify(join(directory, "helper.cjs"))});
const directory = ${JSON.stringify(directory)};
app.setPath('userData', join(directory, 'profile'));
app.on('window-all-closed', () => {});
let windowsCreated=0; app.on('browser-window-created',()=>windowsCreated++);
app.whenReady().then(async () => {
 try {
  const source = join(directory, 'Fixture.obj');
  const geometry = 'mtllib Fixture.mtl\\nv -1 -1 0\\nv 1 -1 0\\nv 0 1 0\\nf 1 2 3\\n';
  await writeFile(source, geometry);
  await writeFile(join(directory, 'Fixture.mtl'), 'newmtl Paint\\nmap_Kd missing-large-image.png\\n');
  const url = pathToFileURL(source).href;
  const mesh = { url, format: 'obj', label: 'Fixture.obj', bytes: Buffer.byteLength(geometry), triangles: 1, lod: null, quality: null };
  const manifest = { assetId: 'fixture', provider: 'shared', name: 'Fixture', source: 'local', meshes: [mesh], defaultMesh: mesh, textures: [], availableQualities: [], availableLods: [], alpha: false, notes: [], allowedFileUrls: [url], unsupported: [] };
  const cache = join(directory, 'cache');
  const forbidden = join(directory, 'NotAllowed.txt'); await writeFile(forbidden, 'private fixture');
  await session.defaultSession.cookies.set({ url: 'https://thumbnail-fixture.invalid', name: 'account-fixture', value: 'isolated' });
  let isolationTimer;
  const isolation = new Promise((resolve, reject) => {
    isolationTimer=setTimeout(()=>reject(new Error('Thumbnail isolation probe timed out')),15000); isolationTimer.unref();
    app.once('browser-window-created', (_event, win) => {
    try {
      const preferences = win.webContents.getLastWebPreferences();
      assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
      assert.notEqual(win.webContents.session, session.defaultSession);
      win.webContents.once('did-finish-load', () => {
        const probes = 'Promise.all([fetch(' + JSON.stringify(pathToFileURL(forbidden).href) + ').then(()=>false,()=>true),fetch("https://thumbnail-fixture.invalid/blocked").then(()=>false,()=>true)])';
        Promise.all([win.webContents.executeJavaScript(probes), win.webContents.session.cookies.get({ name: 'account-fixture' })]).then(([blocked, cookies]) => {
          assert.deepEqual(blocked, [true, true]); assert.equal(cookies.length, 0); resolve();
        }).catch(reject);
      });
    } catch (error) { reject(error); }
    });
  }).finally(()=>clearTimeout(isolationTimer));
  const result = await modelGeometryThumbnail(manifest, 'fixture-v1', cache);
  await isolation;
  console.log('PASS sandbox/session isolation denies unlisted local files and remote requests');
  const image = nativeImage.createFromPath(result);
  assert.deepEqual(image.getSize(), { width: 512, height: 512 });
  const pixels = image.toBitmap(); let different = 0;
  for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 40) different++;
  assert.ok(different > 1000, 'Expected visible lit geometry, changed pixels=' + different);
  const cached = await modelGeometryThumbnail(manifest, 'fixture-v1', cache);
  assert.equal(cached, result);
  console.log('PASS sandboxed offscreen OBJ thumbnail captures nonblank512px geometry and reuses cache');
  const changed = new Date(Date.now() + 5000); await utimes(source, changed, changed);
  assert.notEqual(await modelGeometryThumbnail(manifest, 'fixture-v1', cache), result);
  console.log('PASS model source timestamp invalidates geometry thumbnail cache');
  const fbxMesh={...mesh,url:pathToFileURL(join(directory,'Fixture.fbx')).href,format:'fbx',label:'Fixture.fbx'};
  const fbxImage=await modelGeometryThumbnail({...manifest,meshes:[fbxMesh],defaultMesh:fbxMesh,allowedFileUrls:[fbxMesh.url]},'fbx-missing-image',cache);
  const fbxPixels=nativeImage.createFromPath(fbxImage).toBitmap();let fbxDifferent=0;for(let i=0;i<fbxPixels.length;i+=4)if(Math.abs(fbxPixels[i]-fbxPixels[0])+Math.abs(fbxPixels[i+1]-fbxPixels[1])+Math.abs(fbxPixels[i+2]-fbxPixels[2])>40)fbxDifferent++;
  assert.ok(fbxDifferent>1000,'Expected visible FBX clay geometry');
  console.log('PASS binary FBX geometry renders with unavailable authored image substituted');
  const bufferPath = join(directory, 'Geometry.bin');
  const geometryBuffer = Buffer.alloc(36); [-1,-1,0,1,-1,0,0,1,0].forEach((value,index)=>geometryBuffer.writeFloatLE(value,index*4)); await writeFile(bufferPath,geometryBuffer);
  const gltfPath = join(directory, 'Geometry.gltf');
  await writeFile(gltfPath, JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'Geometry.bin',byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'NeverDecode.png'}]}));
  const gltfMesh={...mesh,url:pathToFileURL(gltfPath).href,format:'gltf',label:'Geometry.gltf'};
  const gltfManifest={...manifest,meshes:[gltfMesh],defaultMesh:gltfMesh,allowedFileUrls:[gltfMesh.url,pathToFileURL(bufferPath).href]};
  const gltfImage = await modelGeometryThumbnail(gltfManifest,'gltf-missing-image',cache);
  assert.deepEqual(nativeImage.createFromPath(gltfImage).getSize(),{width:512,height:512});
  await utimes(bufferPath,changed,changed);
  assert.notEqual(await modelGeometryThumbnail(gltfManifest,'gltf-missing-image',cache),gltfImage);
  console.log('PASS geometry-only glTF skips unavailable authored images and fingerprints external geometry buffers');
  const large = join(directory, 'Large.obj'); const handle = await open(large, 'w'); await handle.truncate(97 * 1024 * 1024); await handle.close();
  const largeMesh = { ...mesh, url: pathToFileURL(large).href };
  await assert.rejects(() => modelGeometryThumbnail({ ...manifest, meshes: [largeMesh], defaultMesh: largeMesh, allowedFileUrls: [largeMesh.url] }, 'large', cache), /96 MiB/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(() => modelGeometryThumbnail(manifest, 'cancelled-before-start', cache, cancelled.signal));
  const controller = new AbortController();
  let activeWindowCreated=false;
  app.once('browser-window-created',()=>{activeWindowCreated=true;setTimeout(()=>controller.abort(),20)});
  const active = modelGeometryThumbnail(manifest, 'cancelled-active', cache, controller.signal);
  await assert.rejects(() => active);
  assert.equal(activeWindowCreated,true);
  await modelGeometryThumbnail(manifest, 'after-cancellation', cache);
  console.log('PASS thumbnail byte limits and cancellation leave the serial renderer queue usable');
  const stalledPath=join(directory,'Stalled.obj'); await writeFile(stalledPath,geometry);
  const stalledMesh={...mesh,url:pathToFileURL(stalledPath).href};
  let releaseStall;
  globalThis.thumbnailFixtureStall=path=>path===stalledPath?new Promise(resolve=>{releaseStall=()=>stat(stalledPath).then(resolve)}):null;
  const stalledController=new AbortController();
  const stalledJob=modelGeometryThumbnail({...manifest,meshes:[stalledMesh],defaultMesh:stalledMesh,allowedFileUrls:[stalledMesh.url]},'stalled-preflight',cache,stalledController.signal);
  setTimeout(()=>stalledController.abort(),40); await assert.rejects(()=>stalledJob);
  await modelGeometryThumbnail(manifest,'after-stalled-preflight',cache);
  const windowsAfterRecovery=windowsCreated;
  globalThis.thumbnailFixtureStall=null; releaseStall(); await new Promise(resolve=>setTimeout(resolve,75));
  assert.equal(windowsCreated,windowsAfterRecovery,'Cancelled preflight must not create a late renderer');
  console.log('PASS stalled filesystem preflight cancellation frees queue and prevents late window creation');
  const empty = join(directory, 'Empty.obj'); await writeFile(empty, '# no geometry');
  const emptyMesh = { ...mesh, url: pathToFileURL(empty).href };
  await assert.rejects(() => modelGeometryThumbnail({ ...manifest, meshes: [emptyMesh], defaultMesh: emptyMesh, allowedFileUrls: [emptyMesh.url] }, 'empty', cache), /no mesh geometry/);
  await modelGeometryThumbnail(manifest, 'after-render-error', cache);
  console.log('PASS isolated renderer errors do not poison subsequent thumbnail jobs');
  app.exit(0);
 } catch (error) { console.error(error.stack || error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
`;
  await writeFile(join(directory, "main.cjs"), main);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const flags = process.env.OPENBRIDGE_UI_SOFTWARE_GL === "1"
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [];
  const child = spawn(require("electron"), [...flags, join(directory, "main.cjs")], { env, stdio: "inherit", detached: process.platform !== "win32" });
  const timeout = setTimeout(() => {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
  }, 120_000);
  const code = await new Promise((complete, reject) => { child.once("error", reject); child.once("exit", code => complete(code)); });
  clearTimeout(timeout);
  if (code !== 0) process.exitCode = 1;
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }); }
