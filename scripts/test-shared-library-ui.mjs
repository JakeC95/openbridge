import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = await mkdtemp(join(tmpdir(), "openbridge-shared-"));
const profile = join(root, "profile");
const fixtures = join(root, "Fixture # café");
const models = join(fixtures, "models");
const hdris = join(fixtures, "hdris");
await Promise.all([mkdir(models, { recursive: true }), mkdir(hdris, { recursive: true }), mkdir(profile)]);
await writeFile(join(models, "Pilot chair.obj"), "mtllib Chair.mtl\nusemtl Paint\nv -1 -1 0\nv 1 -1 0\nv 0 1 0\nf 1 2 3\n");
await writeFile(join(hdris, "Pilot sky.hdr"), Buffer.concat([
  Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n"),
  Buffer.from(Array.from({ length: 8 }, () => [151, 129, 102, 128]).flat())
]));
function chunk(type, payload) {
  const name = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  let value=0xffffffff;
  for(const byte of Buffer.concat([name,payload])) { value ^= byte; for(let i=0;i<8;i++) value=(value>>>1)^((value&1)?0xedb88320:0); }
  crc.writeUInt32BE((value^0xffffffff)>>>0);
  return Buffer.concat([len,name,payload,crc]);
}
const pngHead=Buffer.alloc(13); pngHead.writeUInt32BE(1); pngHead.writeUInt32BE(1,4); pngHead[8]=8; pngHead[9]=6;
await writeFile(join(models,"Paint color.png"),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",pngHead),chunk("IDAT",deflateSync(Buffer.from([0,200,120,60,255]))),chunk("IEND",Buffer.alloc(0))]));
await writeFile(join(models,"Chair.mtl"),"newmtl Paint\nmap_Kd Paint color.png\n");
const sharedLibraryRoots = [
  { id: "fixture-models", name: "Fixture models", path: models, kind: "models" },
  { id: "fixture-hdris", name: "Fixture HDRIs", path: hdris, kind: "hdris" }
];
await writeFile(join(profile, "settings.json"), JSON.stringify({
  sharedLibraryRoots, libraryRoot: join(root, "provider downloads"), libraryPath: join(root, "provider downloads", "Megascans"),
  apiPort: 39401, discoveryPort: 39402, autoSyncEnabled: false
}));
const destination = join(root, "Copy test destination");
await mkdir(destination);
const wrapper = join(root, "fixture-main.cjs");
await writeFile(wrapper, `require("electron").dialog.showOpenDialog = async () => ({
  canceled: false, filePaths: [${JSON.stringify(destination)}]
}); require(${JSON.stringify(resolve("out/main/index.js"))});`);
const electron = resolve("node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
const child = spawn(electron, [wrapper, `--user-data-dir=${profile}`, "--remote-debugging-port=0",
  ...(process.env.OPENBRIDGE_UI_SOFTWARE_GL === "1" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [])],
{ env: {...process.env, TMPDIR: root, OPENBRIDGE_STATE_DIR: join(root, "state")},
  detached: process.platform !== "win32", stdio: "ignore" });
let ok = false;
let ws;
try {
  async function until(callback, label, ms = 90000) {
    const end = Date.now()+ms;
    while (Date.now()<end) {
      try { const result=await callback(); if(result) return result; } catch {}
      await sleep(250);
    }
    throw Error(label);
  }
  async function browserData() {
    const port=(await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];
    return `http://127.0.0.1:${port}`;
  }
  const appUrl=await until(browserData,"Electron did not expose its isolated test connection");
  const page=await until(async()=>(await(await fetch(appUrl+"/json/list")).json()).find(page=>page.url.endsWith("renderer/index.html")),"App window did not start");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Electron test connection timed out")),15000);
    ws.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});
    ws.addEventListener("error",error=>{clearTimeout(timer);reject(error);},{once:true});
  });
  let seq=0;
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const id=++seq;
    const cleanup=()=>{clearTimeout(timer);ws.removeEventListener("message",receive);ws.removeEventListener("close",closed);};
    const closed=()=>{cleanup();reject(Error("Electron test connection closed"));};
    const timer=setTimeout(()=>{cleanup();reject(Error("Electron test evaluation timed out"));},30000);
    const receive=event=>{
      const data=JSON.parse(event.data);
      if(data.id!==id) return;
      cleanup();
      if(data.result?.exceptionDetails) reject(Error(data.result.exceptionDetails.exception?.description ?? "Renderer exception"));
      else resolve(data.result?.result?.value);
    };
    ws.addEventListener("message",receive);
    ws.addEventListener("close",closed,{once:true});
    ws.send(JSON.stringify({ id, method:"Runtime.evaluate", params:{expression,awaitPromise:true,returnByValue:true} }));
  });
  await until(async()=>{
    const states=await evaluate(`window.openbridge.librarySnapshot().then(snapshot => snapshot.sharedLibraries)`);
    return states.length===2 && states.every(root=>root.state==="ready");
  },"The two fixture roots did not finish indexing");
  await until(()=>evaluate(`[...document.querySelectorAll(".nav-item")].some(n=>n.textContent.includes("Library"))`),"Library navigation did not mount");
  const fixture=await evaluate(`(async()=>{
    const api=window.openbridge;
    const chair=(await api.queryLibrary({provider:"shared",query:"Pilot chair"})).assets[0];
    const sky=(await api.queryLibrary({provider:"shared",query:"Pilot sky"})).assets[0];
    const model=await api.model.manifest({provider:"shared",assetId:chair.id,quality:1024,lod:"highest"});
    const hdr=await api.sharedLibrary.hdr(sky.id);
    if (model.meshes.length!==1 || hdr.width!==4 || hdr.height!==2 || hdr.data.length!==32) throw Error("Invalid geometry or HDR decode");
    [...document.querySelectorAll('.nav-item')].find(n=>n.textContent.includes("Library")).click();
    return {chair:chair.id,sky:sky.id};
  })()`);
  const metadata = await evaluate(`(async()=>{
    const api=window.openbridge;
    const chair=await api.sharedLibrary.inspectFile("${fixture.chair}");
    const sky=await api.sharedLibrary.inspectFile("${fixture.sky}");
    const report=await api.sharedLibrary.inspectSelection(["${fixture.chair}","${fixture.sky}"],{provider:"shared"});
    const persisted=(await api.queryLibrary({provider:"shared",sort:"resolution"})).assets;
    return {chair,sky,report,first:persisted[0].id,stored:persisted.find(a=>a.id==="${fixture.chair}").technical.maxTris};
  })()`);
  assert.equal(metadata.chair.model.triangles,1);
  assert.equal(metadata.chair.model.vertices,3);
  assert.equal(metadata.chair.model.bounds.unit,"unknown");
  assert.equal(metadata.sky.image.width,4);
  assert.equal(metadata.sky.image.height,2);
  assert.equal(metadata.report.inspected,2);
  assert.equal(metadata.report.failures.length,0);
  assert.equal(metadata.stored,1);
  assert.equal(metadata.first,fixture.sky);
  console.log("Actual metadata worker persisted model/HDR facts and resolution sorting");
  console.log("Shared OBJ manifest and linear HDR worker decoded fixture data");
  await until(()=>evaluate(`Boolean(document.querySelector('[data-asset-id="${fixture.chair}"]'))`),"Shared model fixture card was not rendered");
  await until(()=>evaluate(`Boolean(document.querySelector('[data-asset-id="${fixture.chair}"] .shared-thumbnail img')?.naturalWidth)`),"Shared model card geometry thumbnail did not decode");
  assert.equal(await evaluate(`document.querySelector('[data-asset-id="${fixture.chair}"] .shared-thumbnail img').naturalWidth`),512);
  assert.equal(await evaluate(`document.querySelector('[data-asset-id="${fixture.chair}"]').textContent.includes('Geometry preview')`),true);
  console.log("Visible shared model card rendered its cached geometry thumbnail");
  await evaluate(`document.querySelector('[data-asset-id="${fixture.chair}"]').click()`);
  await until(()=>evaluate(`Boolean(document.querySelector('.drawer .model-viewer-canvas')) && !document.querySelector('.drawer .model-viewer-status')`),"Shared 3D viewer did not finish loading");
  await evaluate(`[...document.querySelectorAll('.drawer button')].find(button=>button.textContent==='Resources').click()`);
  await until(()=>evaluate(`document.querySelector('[aria-label="Local resources"]')?.textContent.includes('Paint color.png')`),"Material resources did not load");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Local resources"]').textContent.includes('Paint')`),true);
  await until(()=>evaluate(`Boolean(document.querySelector('.shared-map-image img')?.naturalWidth)`),"Material map image did not decode");
  await evaluate(`document.querySelector('.shared-map-image').click()`);
  await until(()=>evaluate(`Boolean(document.querySelector('.image-viewer'))`),"Map fullscreen did not open");
  await evaluate(`[...document.querySelectorAll('.image-viewer button')].find(button=>button.textContent==='Close preview').click()`);
  await until(()=>evaluate(`!document.querySelector('.image-viewer')`),"Fullscreen preview did not close");
  await evaluate(`[...document.querySelectorAll('.drawer button')].find(button=>button.textContent==='3D').click()`);
  console.log("Resources displayed actual MTL material/map references and decoded fullscreen map preview");
  await until(()=>evaluate(`Boolean(document.querySelector('.shared-organization input'))`),"Organization controls did not load");
  await evaluate(`(()=>{
    const group=document.querySelector('form.shared-organization');
    const inputs=group.querySelectorAll('input');
    for(const [input,value] of [[inputs[0],"Review approved"],[inputs[1],"Pilot props"]]){
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event("input",{bubbles:true}));
    }
    group.querySelector('button[type=submit]').click();
  })()`);
  await until(()=>evaluate(`window.openbridge.sharedLibrary.organization("${fixture.chair}").then(data=>data.collections.includes("Pilot props"))`),"Saving organization from the inspector failed");
  assert.equal(await evaluate(`window.openbridge.queryLibrary({provider:"shared",query:"review",sharedCollection:"Pilot props"}).then(result=>result.total)`),1);
  await until(()=>evaluate(`document.querySelector('.drawer').textContent.includes('Stored triangles')`),"Inspected model facts did not appear");
  console.log("Inspector saved tags and a collection, and Library search found the asset");
  await evaluate(`document.querySelector('.drawer button[title=Close]').click(); document.querySelector('[data-asset-id="${fixture.sky}"]').click()`);
  await until(()=>evaluate(`[...document.querySelectorAll('.drawer button')].some(b=>b.textContent==='Open HDRI viewer')`),"HDRI preview did not become available");
  await evaluate(`[...document.querySelectorAll('.drawer button')].find(b=>b.textContent==='Open HDRI viewer').click()`);
  await until(()=>evaluate(`Boolean(document.querySelector('.image-viewer canvas'))`),"HDR exposure canvas did not appear");
  console.log("Actual Library UI rendered model and HDRI previews");
  await evaluate(`[...document.querySelectorAll('.image-viewer button')].find(button=>button.textContent==='Close preview').click()`);
  await until(()=>evaluate(`!document.querySelector('.image-viewer')`),"Fullscreen preview did not close");
  await evaluate(`document.querySelector('.drawer button[title=Close]')?.click()`);
  async function choose(label, option) {
    await until(()=>evaluate(`Boolean(document.querySelector('button[aria-label="${label}"]'))`),`Missing dropdown: ${label}`,8000);
    await evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);
    await until(()=>evaluate(`[...document.querySelectorAll('[role=option]')].some(x=>x.textContent.trim()==="${option}")`),"Dropdown option did not appear");
    await evaluate(`[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.trim()==="${option}").click()`);
  }
  await choose("Local asset source","Shared folders");
  await choose("Shared library folder","Fixture HDRIs");
  await until(()=>evaluate(`Boolean(document.querySelector('[data-asset-id="${fixture.sky}"] .shared-thumbnail img')?.naturalWidth)`),"Shared HDRI card thumbnail did not decode");
  const thumbnail=await evaluate(`(()=>{const image=document.querySelector('[data-asset-id="${fixture.sky}"] .shared-thumbnail img'); return [image.naturalWidth,image.naturalHeight];})()`);
  assert.deepEqual(thumbnail,[4,2]);
  const scopeReport=await evaluate(`window.openbridge.sharedLibrary.inspectScope({provider:'shared',sharedRoot:'fixture-hdris',sharedFormat:'hdr'})`);
  assert.equal(scopeReport.inspected,1);
  assert.equal(scopeReport.cancelled,false);
  assert.equal(scopeReport.failures.length,0);
  assert.equal(await evaluate(`window.openbridge.sharedLibrary.inspectionState().then(state=>state.progress)`),null);
  await until(()=>evaluate(`[...document.querySelectorAll('.view.library button')].some(button=>button.textContent.trim()==='Inspect matching files'&&!button.disabled)`),"Scope inspection control did not become available");
  await evaluate(`[...document.querySelectorAll('.view.library button')].find(button=>button.textContent.trim()==='Inspect matching files').click()`);
  await until(()=>evaluate(`[...document.querySelectorAll('.toast')].some(toast=>toast.textContent.includes('Inspected 1 shared files'))`),"Scope inspection did not report the filtered HDR count");
  console.log("Inspect matching files honors root/format scope and retains completed status");
  console.log("Visible shared HDRI card generated its lazy local thumbnail");
  await choose("Shared library folder","Fixture models");
  await choose("Shared file format","OBJ");
  await evaluate(`[...document.querySelectorAll('summary')].find(x=>x.textContent==="Saved searches").click()`);
  await evaluate(`(()=>{
    const field=[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith("Save current search")).querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,"Models only");
    field.dispatchEvent(new Event("input",{bubbles:true}));
  })()`);
  await until(()=>evaluate(`[...document.querySelectorAll('button')].some(x=>x.textContent==="Save search"&&!x.disabled)`),"Saving search did not become available");
  await evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent==="Save search").click()`);
  await choose("Shared library folder","Fixture HDRIs");
  await until(()=>evaluate(`[...document.querySelectorAll('[aria-label="Shared library folder"] span')].some(x=>x.textContent==="Fixture HDRIs")`),"Library root filter did not change");
  await evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent==="Apply").click()`);
  await until(()=>evaluate(`document.querySelector('button[aria-label="Shared library folder"] span')?.textContent==="Fixture models" &&
    document.querySelector('button[aria-label="Shared file format"] span')?.textContent==="OBJ"`),"Saved root and format restored incorrectly");
  console.log("Saved search restored the named root and OBJ format");
  await until(()=>evaluate(`Boolean(document.querySelector('[data-asset-id="${fixture.chair}"]')) && !document.querySelector('[data-asset-id="${fixture.sky}"]')`),"Restored model grid did not finish updating");
  await evaluate(`[...document.querySelectorAll('.view.library button')].find(x=>x.textContent==="Select").click()`);
  await until(()=>evaluate(`[...document.querySelectorAll('.view.library button')].some(x=>x.textContent==="Select loaded"&&!x.disabled)`),"Selection did not unlock after the filtered query");
  await evaluate(`[...document.querySelectorAll('.view.library button')].find(x=>x.textContent==="Select loaded").click()`);
  await until(()=>evaluate(`[...document.querySelectorAll('.view.library button')].some(x=>x.textContent==="Copy selected assets" && !x.disabled)`),"Bulk Copy did not become enabled");
  await evaluate(`document.querySelectorAll('.toast button').forEach(button=>button.click())`);
  await evaluate(`[...document.querySelectorAll('.view.library button')].find(x=>x.textContent==="Inspect metadata").click()`);
  await until(()=>evaluate(`document.querySelector('.toast')?.textContent.includes('Inspected 1')`),"Batch inspection did not report success");
  await evaluate(`[...document.querySelectorAll('.view.library button')].find(x=>x.textContent==="Copy selected assets").click()`);
  await until(()=>evaluate(`document.querySelector('.view.library').textContent.includes("Copy finished · 1 copied")`),"Bulk copy did not report success");
  const batch=(await readdir(destination))[0];
  const assetFolder=(await readdir(join(destination,batch)))[0];
  assert.match(await readFile(join(destination,batch,assetFolder,"Pilot chair.obj"),"utf8"),/v -1/);
  console.log("Bulk copy wrote the selected model into its project folder");
  ws.close();
  ok=true;
} finally {
  ws?.close();
  const ended = new Promise(resolve=>child.once("exit",resolve));
  if (process.platform === "win32" && child.pid) {
    const killer=spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{stdio:"ignore"});
    await Promise.race([new Promise(resolve=>killer.once("exit",resolve)),sleep(5000)]);
  } else if (child.pid) {
    try { process.kill(-child.pid,"SIGTERM"); } catch {}
  }
  await Promise.race([ended,sleep(1500)]);
  if(ok) await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  else console.error("Isolated test profile", root);
}
