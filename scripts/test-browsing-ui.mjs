import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

// Uses an isolated Electron profile and a fixture preload; never opens the real app/library/session.
const directory = await mkdtemp(join(tmpdir(), "openbridge-ui-"));
const publicImagePath = join(directory, "public-panorama.png");
const modelPath = join(directory, "fixture.obj");
await writeFile(modelPath, "v -1 -1 0\nv 1 -1 0\nv 0 1 0\nf 1 2 3\n");
const pngChunk = (name, body) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(Buffer.concat([type, body]))); return Buffer.concat([size, type, body, crc]); };
const pngHeader = Buffer.alloc(13); pngHeader.writeUInt32BE(2); pngHeader.writeUInt32BE(1, 4); pngHeader[8] = 8; pngHeader[9] = 6;
await writeFile(publicImagePath, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", pngHeader), pngChunk("IDAT", deflateSync(Buffer.from([0,180,120,60,255,140,80,30,255]))), pngChunk("IEND", Buffer.alloc(0))]));
const require = createRequire(import.meta.url);
// Hosted runners expose a small virtual desktop, so clamp every requested size to the work area.
// Set OPENBRIDGE_UI_WIDTH/HEIGHT to reproduce a narrower layout locally.
const viewportWidth = Number(process.env.OPENBRIDGE_UI_WIDTH) || 1440;
const viewportHeight = Number(process.env.OPENBRIDGE_UI_HEIGHT) || 1000;
const preload = `
const { contextBridge } = require('electron');
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="sienna"/></svg>');
const publicImage = ${JSON.stringify(pathToFileURL(publicImagePath).href)};
const highImage = type => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="4096"><rect width="4096" height="4096" fill="'+(type==='normal'?'royalblue':'forestgreen')+'"/></svg>');
let previewMode = 'success';
let modelFails = false;
let surfaceMode = false;
let paged = false;
const categories = [{key:'3d',label:'3D Assets',count:80,children:[{key:'nature',label:'Nature',count:80,children:[]}]}];
const hits = Array.from({length:80}, (_, i) => ({id:'asset'+i,objectID:'asset'+i,name:'Asset '+i,type:'3d',tags:['wood'],previews:{images:{preview:image,thumbJpg:image}}}));
const assets = hits.map(hit=>({id:hit.id,name:hit.name,type:'3d',categories:['3d','nature'],tags:['wood'],repo:'downloaded',path:'fixture/'+hit.id,jsonPath:'fixture/'+hit.id+'.json',preview:null,thumb:null,mtime:1,previewRelativeSize:'1x1',searchStr:'wood'}));
const counts = {all:80,downloaded:80,custom:0,dhi:0};
const status = {available:true,count:80,generatedAt:1,version:1,importedAt:1};
const pack = {id:'forest-pack',name:'Forest',count:80};
const calls = [];
const noop = () => () => {};
let publicEnabled = false;
let publicMany = false;
const publicHit = provider => ({id:'fixture-'+provider,provider,name:provider+' fixture',type:surfaceMode?'surface':provider==='blenderkit'?'hdr':'hdri',typeLabel:surfaceMode?'Surface':'HDRI',categories:[surfaceMode?'Surfaces/Brick':'HDRIs/Outdoor'],category:surfaceMode?'Surfaces/Brick':'HDRIs/Outdoor',tags:['clear'],description:'Public provider fixture',authors:{'Fixture Author':'Creator'},attributes:provider==='ambientcg'?{technique:'hdri-bracketed-panorama',collections:['Fixture collection'],colors:['112233','445566'],downloadStats:{total:12,lastMonth:5,lastWeek:2,lastDay:1}}:provider==='blenderkit'?{canDownload:true,rating:9.5,ratingCount:4,verification:'validated',versionNumber:2,sourceApp:'blender 5.1.1',downloadBytes:18017740}:{fileFormat:'32-bit Float OpenEXR (.exr)',dynamicRange:'12 EV',whiteBalance:'5400 K',captureDate:'November 12, 2025 at 03:05 PM',location:'Fixture location',downloadSize:'312 MB',colorChecker:'https://example.invalid/colorchecker.exr'},maxResolution:2048,resolutions:['2K'],dimensions:null,dimensionsMm:null,polycount:null,texelDensity:null,publishedAt:1,downloadCount:1,thumbnail:image,previews:surfaceMode?[{type:'albedo',label:'Albedo',url:'https://example.invalid/fixture_albedo.png'},{type:'normal',label:'Normal',url:'https://example.invalid/fixture_normal.png'}]:provider==='ambientcg'?[{type:'hdr-source',label:'HDR panorama LQ',url:'https://example.invalid/fixture_LQ.exr?1'},{type:'hdr-source',label:'HDR panorama HQ',url:'https://example.invalid/fixture_HQ.exr?2'}]:[{type:'preview',label:'Preview',url:image}],timeOfDay:12,weather:'clear',mapCodes:surfaceMode?['albedo','normal','roughness','displacement']:[],mapFormats:['exr'],modelFormats:[],lodCount:0,license:'CC0-1.0',free:true,websiteUrl:'https://example.invalid',filesHash:'fixture',enriched:true,files:[{role:'hdri',name:'fixture.exr',url:'https://example.invalid/fixture.exr',bytes:4,resolution:'2K',format:'exr'}]});
 const progressListeners = new Set();
 const progressListener = item => progressListeners.forEach(callback=>callback(item));
const downloadItem = {assetId:'asset0',name:'Asset 0',status:'downloading',received:12582912,total:41943040,ratio:0.3,
  message:'Downloading 3 files',diagnostics:{receiveBytesPerSecond:6500000,writeBytesPerSecond:5800000,activeTransfers:3,
  sources:[{host:'d2xsxph8kpxj0f.cloudfront.net',provider:'CloudFront',edgeCode:'LHR61-P1',location:'London, UK',locationKind:'edge',country:'United Kingdom',countryCode:'gb'},
    {host:'megascans-cdn.example',provider:'Cloudflare',edgeCode:'AMS',location:'Amsterdam, Netherlands',locationKind:'edge',country:'Netherlands',countryCode:'nl'}]}};
const api = {
  getSettings: async()=>({libraryPath:'fixture',downloadDefaults:{}}),
  auth:{state:async()=>({loggedIn:true,email:'',roles:[],planId:'',expiresAt:null}),profile:async()=>({}),onChanged:noop},
  versions:async()=>({app:'fixture',electron:'fixture',chrome:'fixture',node:'fixture'}),
  catalogMetadata:async()=>status, catalogPacks:async()=>[pack], catalogMetadataLookup:async()=>[],
  librarySnapshot:async()=>({refs:assets.map(a=>({id:a.id,path:a.path})),counts,total:80,scannedAt:1,libraryPath:'fixture'}),
  queryLibrary:async query=>{calls.push({kind:'library',query});return {assets,total:80,counts,offset:0,limit:300,hasMore:false,tookMs:1,categories,packs:[pack]}},
  queryLibraryIds:async query=>{calls.push({kind:'localIds',query});return assets.map(a=>a.id)},
  localPreviews:async()=>({renders:[{type:'render',label:'Render',url:image}],maps:[{type:'albedo',label:'Set A / Albedo',url:image},{type:'normal',label:'Set A / Normal',url:image}]}),
  toFileUrl:path=>image,
  model:{manifest:async request=>{calls.push({kind:'model',request});if(modelFails)throw new Error('Fixture preview unavailable');const mesh={url:${JSON.stringify(pathToFileURL(modelPath).href)},format:'obj',label:'Fixture',lod:0,quality:null,bytes:32,triangles:1};return {assetId:request.assetId,name:'Fixture',provider:request.provider,source:'local',meshes:[mesh],defaultMesh:mesh,textures:[],availableQualities:[1024,2048],availableLods:[0],alpha:false,notes:[],unsupported:[]};}},
  catalog:{categories:async()=>categories, acquired:async()=>[],favorites:async()=>['asset0'],cancel:async()=>{},
    search:async query=>{calls.push({kind:'catalog',query}); if(paged) await new Promise(resolve=>setTimeout(resolve,180)); return {hits:paged ? hits.slice(query.page*40,query.page*40+40) : hits,nbHits:80,page:paged ? query.page : 0,nbPages:paged ? 2 : 1,hitsPerPage:paged ? 40 : 80,facets:{biome:{forest:80},region:{Europe:80},resolution:{'4096':80},color:{Green:80},environment:{natural:80},theme:{wood:80}}}},
    ids:async query=>{calls.push({kind:'catalogIds',query});return {entries:hits.map(h=>({id:h.id})),nbHits:80}},
     extended:async id=>({id,name:id,type:'3d',categories:['3d','nature'],tags:['wood'],similarAssets:[hits[1]],
       meta:[{key:'length',value:'0.21'},{key:'width',value:'0.13'},{key:'height',value:'0.10'}]}),
    mapPreviews:async()=>[{type:'albedo',label:'Set A / Albedo',url:image,map:{type:'albedo'}},{type:'normal',label:'Set A / Normal',url:image,map:{type:'normal'}}],
    highResolutionPreview:async(id,map)=>{
      calls.push({kind:'highResolution',id,map});
      const mode=previewMode;
      await new Promise(resolve=>setTimeout(resolve,mode==='slow'?1500:map.type==='normal'?100:450));
      if(mode==='failure')throw new Error('Fixture server unavailable');
      return {type:map.type,label:map.type,url:highImage(map.type),resolution:'4096'};
    }
  },
   smartThumbnail:async source=>source,
   public:{status:async()=>({state:'ready',count:1,refreshedAt:1}),refresh:async()=>({state:'ready',count:1,refreshedAt:1}),categories:async()=>[],onStatus:noop,
     search:async query=>{calls.push({kind:'publicSearch',query});const hit=publicHit(query.provider);const available=publicEnabled&&!query.types?.includes('__none__')&&query.ids?.length!==0;const all=publicMany?Array.from({length:96},(_,index)=>({...hit,id:hit.id+'-'+index,name:hit.name+' '+index})):[hit];const offset=query.offset??0,limit=query.limit??60;return {hits:available?all.slice(offset,offset+limit):[],total:available?all.length:0,hasMore:available&&offset+limit<all.length,offset,limit,tookMs:1,facets:{types:[{value:hit.type,count:1}],licenses:[{value:hit.license,count:1}],resolutions:[{value:'2K',count:1},{value:'4K',count:1}],mapTypes:[],modelFormats:[],categories:[],weather:[{value:'clear',count:1}],free:1}}},
     ids:async query=>[publicHit(query.provider).id],extended:async(provider,id)=>({...publicHit(provider),id,raw:{}}),
     previews:async(provider,id)=>{const assetId=provider+':'+id;const base={type:'JPG',label:'Panorama preview',url:publicImage,assetId,panorama:true,map:{type:'JPG'},exposure:{assetId,mapType:'JPG'}};const hdr={type:'HDR',label:'HDR · live exposure',url:publicImage,assetId,panorama:true,exposure:{assetId,mapType:'HDR'}};if(surfaceMode)return {renders:[{type:'preview',label:'Render',url:image}],maps:['albedo','normal','roughness','displacement'].flatMap(type=>['1K','2K'].map(tier=>({type,label:type,resolution:tier,url:'https://example.invalid/fixture_'+type+'_'+tier+'.png'}))),hdrAvailable:false};return {renders:[{type:'preview',label:'Render',url:image}],maps:provider==='openhdri'?[base]:[base,hdr],hdrAvailable:provider!=='openhdri',note:provider==='openhdri'?'OpenHDRI publishes 16K EXRs only. Live HDR exposure is disabled because 16K exceeds the safe 8K preview budget for most systems.':undefined}},
     highResolutionPreview:async(provider,id,type)=>{calls.push({kind:'publicHighResolution',provider,id,type});return {type,label:type,url:publicImage}},
     hdrPreview:async(provider,id)=>{calls.push({kind:'publicHdr',provider,id});return {width:2,height:1,resolution:'fixture',data:new Uint16Array(8).fill(15360)}},
     cancelPreviews:async(provider,id)=>{calls.push({kind:'publicCancelPreviews',provider,id})}},
   blenderkitAuth:{state:async()=>({hasKey:true}),setKey:async()=>({hasKey:true}),test:async()=>({ok:true,userName:'Fixture user',plan:'Fixture plan'}),clear:async()=>({hasKey:false}),onChanged:noop},
  poliigon:{
    status:async()=>({state:'ready',count:0,published:0,refreshedAt:1}),
    refresh:async()=>({state:'ready',count:0,published:0,refreshedAt:1}),
    categories:async()=>[],
    search:async()=>({hits:[],total:0,offset:0,limit:40,hasMore:false,tookMs:1,
      facets:{types:[],resolutions:[],creationMethods:[],mapTypes:[],weather:[],free:0}}),
    ids:async()=>[],extended:async()=>null,mapPreviews:async()=>[],highResolutionMapPreview:async()=>({}),hdrPreview:async()=>({}),
    onStatus:noop,
    auth:{state:async()=>({loggedIn:false,userName:'',userId:null,planName:'',planPaused:false,isUnlimited:false,credits:null,onDemandCredits:null,ownedCount:0,expiresAt:null}),
      login:async()=>({loggedIn:false}),loginBrowser:async()=>({loggedIn:false}),cancelBrowserLogin:async()=>{},logout:async()=>{},
      refresh:async()=>null,owned:async()=>[],recentDownloads:async()=>[],syncOwned:async()=>[],onChanged:noop}
  },
  polyhaven:{
    status:async()=>({state:'ready',count:0,enriched:0,refreshedAt:1}),
    refresh:async()=>({state:'ready',count:0,enriched:0,refreshedAt:1}),
    categories:async()=>[],
    search:async()=>({hits:[],total:0,offset:0,limit:40,hasMore:false,tookMs:1,
      facets:{types:[],resolutions:[],mapTypes:[],categories:[],collections:[],attributes:{}}}),
    ids:async()=>[],extended:async()=>null,mapPreviews:async()=>[],highResolutionMapPreview:async()=>({}),hdrPreview:async()=>({}),
    onStatus:noop
  },
   downloads:{start:async(id,options,provider)=>{calls.push({kind:'publicDownload',id,options,provider})},startMany:async()=>({queued:1,skipped:0}),list:async()=>[downloadItem],onProgress:callback=>{progressListeners.add(callback);return()=>progressListeners.delete(callback)},
     pauseAll:async()=>progressListener({...downloadItem,status:'paused'}),resumeAll:async()=>progressListener(downloadItem),
     overview:async()=>({history:[{id:1,assetId:'finished',name:'Completed asset',path:'fixture/finished',bytes:83886080,completedAt:1}],
       session:{receivedBytes:12582912,completed:1,averageBytesPerSecond:3200000,peakBytesPerSecond:6500000},
       disk:{libraryPath:'fixture',totalBytes:549755813888,freeBytes:214748364800,measuredLibraryBytes:85899345920,measuredAssets:40,totalAssets:80}})}, sync:{status:async()=>({running:false,acquired:80,missing:0}),onStatus:noop},
  onLibraryUpdated:noop,onNotification:noop,onSearchPaste:noop,onLibraryHealthProgress:noop,
  openLogs:async()=>{},contextMenu:{asset:async()=>{},search:async()=>{}}
};
contextBridge.exposeInMainWorld('openbridge',api);
contextBridge.exposeInMainWorld('fixtureCalls',()=>calls);
contextBridge.exposeInMainWorld('fixturePublicEnabled',()=>{publicEnabled=true});
contextBridge.exposeInMainWorld('fixturePublicMany',()=>{publicMany=true});
contextBridge.exposeInMainWorld('fixturePaged',value=>{paged=value});
contextBridge.exposeInMainWorld('fixturePreviewMode',mode=>{previewMode=mode});
contextBridge.exposeInMainWorld('fixtureModelFail',value=>{modelFails=value});
contextBridge.exposeInMainWorld('fixtureSurface',value=>{surfaceMode=value});
contextBridge.exposeInMainWorld('fixturePauseDownload',()=>progressListener({...downloadItem,status:'paused',message:'Paused',
  diagnostics:{...downloadItem.diagnostics,activeTransfers:0,receiveBytesPerSecond:0,writeBytesPerSecond:0}}));
contextBridge.exposeInMainWorld('fixtureDownloading',()=>progressListener(downloadItem));
contextBridge.exposeInMainWorld('fixtureProgress',value=>progressListener({...downloadItem,diagnostics:{...downloadItem.diagnostics,receiveBytesPerSecond:value,writeBytesPerSecond:value*0.9}}));
`;
const main = `
const { app, BrowserWindow, screen } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
app.whenReady().then(async()=>{
 const area = screen.getPrimaryDisplay().workAreaSize;
 const width = Math.min(${viewportWidth}, area.width);
 const height = Math.min(${viewportHeight}, area.height);
 const win = new BrowserWindow({show:false,width,height,webPreferences:{preload:${JSON.stringify(join(directory, "preload.cjs"))},contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false,offscreen:true}});
  const errors=[];
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
  try {
   // Keep fixture thumbnail URLs testable without relying on any remote server.
   const providerImage = await readFile(${JSON.stringify(publicImagePath)});
   win.webContents.session.protocol.handle('https', () => new Response(providerImage, { headers:{'content-type':'image/png'} }));
   await win.loadFile(${JSON.stringify(resolve("out/renderer/index.html"))});
  const results = await win.webContents.executeJavaScript('('+${JSON.stringify(async function run() {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const until = async (condition, message) => {
      const start=Date.now(); while(!condition()) { assert(Date.now()-start<5000,message); await wait(25); }
    };
    const root = () => document.querySelector('.view-slot:not([hidden])');
    const clickText = (scope, text) => {
      assert(scope, 'Missing scope for button: '+text);
      const element = [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text);
      assert(element, 'Missing button: '+text); element.click();
    };
    const focusProvider = async label => {
      let summary = [...document.querySelectorAll('.browse-menu > summary')].find(item => item.textContent.trim() === 'Sources');
      if (!summary) {
        const all = [...document.querySelectorAll('.provider-switch button')].find(item => item.textContent.trim() === 'All');
        all?.click(); await wait(300);
        summary = [...document.querySelectorAll('.browse-menu > summary')].find(item => item.textContent.trim() === 'Sources');
      }
      assert(summary, 'Sources menu missing');
      summary.click(); await wait(50);
      const item = [...document.querySelectorAll('.browse-menu-panel button.source-summary')]
        .find(entry => entry.querySelector('span')?.textContent === label);
      assert(item, 'Focus source missing: '+label); item.click(); await wait(400);
    };
     const navigate = label => {
       const name=label.replace(/\d+$/, '');
       const button=[...document.querySelectorAll('.nav-item')].find(item=>item.querySelector('span')?.textContent===name);
       assert(button,'Missing navigation: '+name);button.click();
     };
    const choose = async (label, text) => {
      let trigger=root().querySelector('[aria-label="'+label+'"]');
      if(!trigger && /^Sort/.test(label)) trigger=[...root().querySelectorAll('.filter-row .dropdown-trigger')].find(item=>/^Sort/.test(item.getAttribute('aria-label')||''));
      assert(trigger,'Missing dropdown: '+label); trigger.click(); await wait(120);
      const menus=[...document.querySelectorAll('[role="listbox"]')];
      clickText(menus.at(-1),text); await wait(350);
    };
     await wait(350);
     assert(document.querySelector('.getting-started'),'Getting started guidance missing');
     document.querySelector('[aria-label="Dismiss getting started"]').click();
     assert(document.querySelectorAll('.discover .asset-card').length > 0,'Catalogue did not render');
     clickText(root(),'List / compare view');await wait(40);
     const compareChecks=root().querySelectorAll('.asset-list input[type="checkbox"]');
     assert(compareChecks.length>=2,'Catalogue list missing');compareChecks[0].click();compareChecks[1].click();
     clickText(root(),'Compare selected');await wait(20);
     assert(root().querySelector('.comparison-workbench')?.textContent.includes('Dimensions'),'Comparison missing');
     assert(root().querySelectorAll('.comparison-card img').length===2,'Comparison should show asset previews');
     clickText(root(),'Grid view');await wait(40);
     const catalogueCards=()=>[...root().querySelectorAll('.asset-card')];
     catalogueCards()[0].click();await wait(100);
     assert(document.querySelector('.drawer'),'Ordinary click must still open the drawer');
     document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true,bubbles:true}));await wait(30);
     if(innerWidth<=1180) assert(getComputedStyle(document.querySelector('.drawer-backdrop')).pointerEvents==='none','Shift should permit selecting visible cards behind backdrop');
     catalogueCards()[3].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await wait(80);
     document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
     assert(!document.querySelector('.drawer'),'Shift selection should close the drawer');
     assert(root().querySelectorAll('.asset-card.selected').length===4,'Shift-click should select the inclusive range from the opened card');
     assert(root().querySelector('.bulk-bar')?.textContent.includes('4 selected'),'Shift-click should expose bulk actions');
     clickText(root(),'List / compare view');await wait(50);
     assert(root().querySelectorAll('.comparison-card').length===4,'Bulk selection must open directly in comparison');
     assert(root().querySelectorAll('.asset-list input:checked').length===4,'Comparison lost the grid selection');
     clickText(root(),'Grid view');await wait(50);
     assert(root().querySelectorAll('.asset-card.selected').length===4,'Returning to grid must retain the bulk selection');
     catalogueCards()[5].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await wait(40);
     assert(root().querySelectorAll('.asset-card.selected').length===6,'Additional shift-click should extend the range');
     clickText(root(),'List / compare view');await wait(40);
     assert(root().querySelector('.compare-notice')?.textContent.includes('2 selected assets are not shown'),'Comparison must explain the four-item limit');
     clickText(root(),'Grid view');await wait(40);
     clickText(root(),'Done');await wait(30);
     catalogueCards()[1].click();await wait(50);
     assert(document.querySelector('.drawer'),'Ordinary click should open after selection mode');
     catalogueCards()[2].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));await wait(50);
     assert(root().querySelectorAll('.asset-card.selected').length===2,'Shift+Enter should start a fresh range, not reuse old selections');
     clickText(root(),'Done');await wait(30);
     catalogueCards()[1].click();await wait(50);
     document.querySelector('.drawer [title="Close"]').click();await wait(30);
     window.fixturePaged(true);
     const pagingInput=document.querySelector('.topbar input');
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(pagingInput,'paging fixture');
     pagingInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(900);
     const pagingScroll=document.querySelector('.discover .asset-area');
     await choose('Sort loaded catalogue results','Name A–Z');
     const auto=root().querySelector('.auto-load-toggle input');
     pagingScroll.scrollTop=pagingScroll.scrollHeight-pagingScroll.clientHeight-120;
     await wait(80);
     const visibleAnchor=[...pagingScroll.querySelectorAll('[data-grid-key]')].find(card=>card.getBoundingClientRect().bottom>pagingScroll.getBoundingClientRect().top);
     assert(visibleAnchor,'Paging anchor missing');const anchorKey=visibleAnchor.dataset.gridKey;
     const beforePage=visibleAnchor.getBoundingClientRect().top;
     assert(auto,'Paging fixture did not show load more');auto.click();
     await until(()=>window.fixtureCalls().some(call=>call.kind==='catalog' && call.query.page===1),'Auto load did not request page 2');
     await wait(400);
     const afterAnchor=[...pagingScroll.querySelectorAll('[data-grid-key]')].find(card=>card.dataset.gridKey===anchorKey);
     assert(afterAnchor && Math.abs(afterAnchor.getBoundingClientRect().top-beforePage)<5,'Auto loading moved the visible asset: '+anchorKey+' from '+beforePage+' to '+(afterAnchor?.getBoundingClientRect().top ?? 'not rendered'));
     await choose('Sort loaded catalogue results','Sort: Relevance');
     window.fixturePaged(false);
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(pagingInput,'');
     pagingInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(900);
     const scroll=document.querySelector('.discover .asset-area');scroll.scrollTop=650;await wait(50);
    const position=scroll.scrollTop;
    navigate('Library80'); await wait(100);
    navigate('Discover80'); await wait(100);
    assert(scroll.scrollTop===position && position>0,'Catalogue scroll position was lost: '+position+' -> '+scroll.scrollTop);
     navigate('Library80'); await wait(100);
     assert(document.querySelector('.sidebar-section-title').textContent==='Local categories','Local categories missing');
     const searchInput=document.querySelector('.topbar input');
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(searchInput,'wood');
     searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(650);
     assert(window.fixtureCalls().filter(call=>call.kind==='library').at(-1).query.query==='wood','Scoped library search did not query');
     clickText(document.querySelector('.search-scope'),'Catalogue');await wait(100);
     assert(document.querySelector('.topbar input').value==='','Catalogue inherited library query');
     clickText(document.querySelector('.search-scope'),'Library');await wait(100);
     assert(document.querySelector('.topbar input').value==='wood','Scope switch lost library query');
    await choose('Sort local library','Name A–Z');
    await choose('Local asset type','3D Assets');
     clickText(root(),'Filters'); await wait(30);
     assert(root().querySelectorAll('.facet-tab').length===5,'Library does not use the shared workbench');
    clickText(root(),'Closed mesh'); await wait(200);
    clickText(root(),'Select'); await wait(20);
    clickText(root(),'Select all 80'); await wait(50);
    const calls=window.fixtureCalls();
    const ids=calls.filter(call=>call.kind==='localIds').at(-1).query;
    assert(ids.sort==='name' && ids.type==='3d' && ids.ready.includes('closed'),'Local selection omitted filters');
    clickText(root(),'Done'); await wait(50);
     root().querySelector('.asset-card').click(); await wait(150);
     assert(document.querySelector('.drawer'),'Local drawer missing');
     assert(document.querySelector('.asset-scale-unavailable')?.closest('[hidden]')===null,'Missing local bounds should show an unavailable state in Overview');
     clickText(document.querySelector('.inspector-tabs'),'Overview');await wait(40);
     assert(document.querySelectorAll('.topbar input').length===1,'Library topbar search missing');
     assert(!root().querySelector('.search-wrap'),'Library has a duplicate in-view search');
     const drawerRect=document.querySelector('.drawer').getBoundingClientRect();
     const gridRect=root().querySelector('.virtual-grid').getBoundingClientRect();
     if(innerWidth>1180) assert(gridRect.right<=drawerRect.left+1,'Docked drawer overlays the grid');
     else assert(getComputedStyle(document.querySelector('.drawer-backdrop')).display!=='none','Narrow drawer lost backdrop');
     const footer=document.querySelector('.drawer-footer').getBoundingClientRect();
     assert(footer.bottom<=innerHeight && footer.height>0,'Drawer footer not visible');
    clickText(document.querySelector('.drawer'),'Maps'); await wait(50);
    const label = document.querySelector('.map-nav-label').getBoundingClientRect();
    const expand = document.querySelector('.preview-expand-action').getBoundingClientRect();
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    assert(!overlaps(label, expand), 'Map name overlaps Expand action');
    const oldOverlay = document.querySelector('.expand-preview > span');
    assert(!oldOverlay || !overlaps(label, oldOverlay.getBoundingClientRect()), 'Expand hint overlays map name');
    const picker = document.querySelector('.preview-picker .dropdown-control').getBoundingClientRect();
    assert(!overlaps(picker, expand), 'Map picker overlaps Expand action');
    document.querySelector('.expand-preview').click(); await wait(80);
    assert(document.querySelector('.image-viewer'),'Expanded preview missing');
    assert(document.getElementById('root').inert,'Background is not inert');
    clickText(document.querySelector('.image-viewer'),'+'); await wait(40);
    assert(document.querySelector('.image-viewer-toolbar').textContent.includes('150%'),'Zoom did not update');
    clickText(document.querySelector('.image-viewer'),'Next image'); await wait(40);
    assert(document.querySelector('.image-viewer select').value==='1','Image cycling failed');
    clickText(document.querySelector('.image-viewer'),'Close preview'); await wait(40);
    assert(!document.getElementById('root').inert,'Background remained inert');
    document.querySelector('.drawer [title="Close"]').click();
    navigate('Discover80');await wait(80);
    await focusProvider('Megascans');
    clickText(root(),'Filters');await wait(20);
    const facetPanel=document.querySelector('.facet-panel');
    assert(facetPanel,'Catalogue filter panel missing');
    assert(facetPanel.querySelectorAll('.facet-tab').length===6,'Filter groups are not presented as a workbench');
    const activeTab=facetPanel.querySelector('.facet-tab.active');
    assert(activeTab && activeTab.textContent.includes('Biome'),'Biome filter group is not selected by default');
    const forest=[...root().querySelectorAll('.facet-option')].find(item=>/^forest/i.test(item.textContent.trim()));
    assert(forest,'Facet missing');forest.click();await wait(80);
    assert(facetPanel.querySelector('.facet-tab.active').textContent.includes('1'),'Selected facet count missing from the group rail');
    clickText(root(),'Select');await wait(20);clickText(root(),'Select all 80');await wait(50);
    const catalogIds=window.fixtureCalls().filter(call=>call.kind==='catalogIds').at(-1).query;
    assert(catalogIds.facetFilters.biome.includes('forest'),'Catalogue selection omitted facets');
    clickText(root(),'Done'); await wait(50);
     root().querySelector('.asset-card').click();await wait(100);
     assert(document.querySelector('.drawer-footer .footer-resolution'),'Quick resolution missing');
     clickText(document.querySelector('.inspector-tabs'),'Technical');await wait(40);
     assert(document.querySelector('.inspector-tabs .active').textContent==='Technical','Inspector section failed');
     assert(document.querySelector('.asset-scale-panel').closest('[hidden]'),'Scale reference should be hidden in Technical');
     clickText(document.querySelector('.inspector-tabs'),'Overview');await wait(40);
     const scaleBox=document.querySelector('.scale-bounds');
     assert(scaleBox && !scaleBox.closest('[hidden]'),'Overview size comparison missing');
     const human=document.querySelector('.scale-human');
     const humanHeight=1.78*human.transform.baseVal.consolidate().matrix.a;
     assert(Math.abs(Number(scaleBox.getAttribute('height'))/humanHeight-.1/1.78)<1e-8,'Human and bounding box use different scales');
     assert(document.querySelector('.asset-scale-legend').textContent.includes('1.78 m tall'),'Human height reference missing');
     clickText(document.querySelector('.inspector-tabs'),'Download');await wait(40);
     assert(document.querySelector('.download-box:not([hidden])'),'Download settings missing');
     const inspectorScroll=document.querySelector('.drawer-scroll');inspectorScroll.scrollTop=inspectorScroll.scrollHeight;await wait(40);
     assert(document.querySelector('.drawer-footer').getBoundingClientRect().bottom<=innerHeight,'Footer scrolled offscreen');
     clickText(document.querySelector('.inspector-tabs'),'Overview');inspectorScroll.scrollTop=0;
    document.querySelector('.drawer [aria-label="Next asset"]').click();await wait(100);
    assert(document.querySelector('.drawer-id').textContent==='asset1','Next asset failed');
    clickText(document.querySelector('.drawer'),'Back');await wait(50);
    assert(document.querySelector('.drawer-id').textContent==='asset0','Drawer Back failed');
    clickText(document.querySelector('.drawer'),'Maps');await wait(80);
    const signingBefore=window.fixtureCalls().filter(call=>call.kind==='highResolution').length;
    document.querySelector('.expand-preview').click();await wait(70);
    assert(document.querySelector('.preview-loading .spinner'),'High-res signing has no loading animation');
    assert(document.querySelector('.image-viewer-canvas').getAttribute('aria-busy')==='true','Viewer not marked busy');
    assert(document.querySelector('.image-viewer-canvas img').naturalWidth===512,'Original preview should stay visible while upgrading');
    clickText(document.querySelector('.image-viewer'),'Next image');await wait(240);
    await until(()=>document.querySelector('.image-viewer-canvas img')?.naturalWidth===4096,'High-res image decode timed out');
    assert(document.querySelector('.image-viewer-canvas img').naturalWidth===4096,'Maximum-resolution image did not replace thumbnail');
    const normalSource=document.querySelector('.image-viewer-canvas img').src;
    await wait(350);
    assert(document.querySelector('.image-viewer-canvas img').src===normalSource,'Late previous-map request overwrote current map');
    assert(!document.querySelector('.preview-loading'),'Loading animation did not finish after decode');
    assert(document.querySelector('.image-viewer-footer').textContent.includes('4,096'),'Actual image dimensions missing');
    assert(window.fixtureCalls().filter(call=>call.kind==='highResolution').length===signingBefore+2,'Viewer downloaded maps beyond the selected images');
    clickText(document.querySelector('.image-viewer'),'Close preview');await wait(50);
    window.fixturePreviewMode('failure');
    document.querySelector('.expand-preview').click();await wait(220);
    await until(()=>document.querySelector('.preview-load-error'),'High-res failure was not reported');
    assert(document.querySelector('.preview-load-error'),'Server failure did not provide a fallback/retry');
    assert(document.querySelector('.image-viewer-canvas img').naturalWidth===512,'Failure discarded the original preview');
    window.fixturePreviewMode('success');
    clickText(document.querySelector('.image-viewer'),'Retry high-res');await wait(240);
    await until(()=>document.querySelector('.image-viewer-canvas img')?.naturalWidth===4096,'High-res retry decode timed out');
    assert(!document.querySelector('.preview-load-error'),'Retry error did not clear');
    assert(document.querySelector('.image-viewer-canvas img').naturalWidth===4096,'Retry did not load high-res image');
    clickText(document.querySelector('.image-viewer'),'Close preview');await wait(50);
    document.querySelector('.drawer [title="Close"]').click();
    const columnCount=()=>getComputedStyle(root().querySelector('.virtual-grid-window')).gridTemplateColumns.split(' ').length;
    const comfortableColumns=columnCount();
    await choose('Thumbnail size','Compact');
    const compactColumns=columnCount();
    assert(compactColumns>comfortableColumns,'Compact density did not add columns: '+comfortableColumns+' -> '+compactColumns);
    assert(compactColumns>=3,'Compact density produced too few columns: '+compactColumns);
    const summary=[...root().querySelectorAll('summary')].find(item=>item.textContent.startsWith('Packs'));summary.click();await wait(30);
    const packButton=[...summary.parentElement.querySelectorAll('button')].find(item=>item.textContent.startsWith('Forest'));packButton.click();await wait(100);
    assert(root().querySelector('.asset-heading').textContent.includes('Forest'),'Pack results heading missing');
    assert(window.fixtureCalls().filter(call=>call.kind==='catalog').at(-1).query.pack.id==='forest-pack','Pack membership filter missing');
     navigate('Downloads1'); await wait(120);
     assert(document.querySelector('.downloads-rail').textContent.includes('Completed asset'),'Durable history rail missing');
     assert(document.querySelector('.downloads-rail').textContent.includes('200.0 GB free'),'Real disk space missing');
     const queueSearch=document.querySelector('[aria-label="Search downloads"]');
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(queueSearch,'does-not-exist');
     queueSearch.dispatchEvent(new Event('input',{bubbles:true}));await wait(40);
     assert(document.querySelector('.downloads-queue').textContent.includes('No matching downloads'),'Queue search did not filter');
     clickText(document.querySelector('.downloads-queue'),'Clear search and status');await wait(40);
     document.querySelector('.activity-pill').click();await wait(30);
     assert(document.querySelector('.activity-popover'),'Mini queue missing');
     document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(30);
     assert(!document.querySelector('.activity-popover'),'Escape did not dismiss mini queue');
    const stats = document.querySelector('.download-stats');
    assert(stats,'Live download statistics missing');
    assert(stats.textContent.includes('6.2 MB/s'),'Download speed missing or misformatted: '+stats.textContent);
    assert(stats.textContent.includes('5.5 MB/s'),'Disk write speed missing: '+stats.textContent);
    assert(stats.textContent.includes('2 sources'),'Multiple sources were not summarised');
    const badge = stats.querySelector('.download-source-badge');
    assert(badge,'Friendly server badge missing');
    assert(badge.textContent.includes('Amazon CloudFront · London'),'Friendly server name missing: '+badge.textContent);
    assert(badge.textContent.includes('+1'),'Additional source count missing from the badge');
    const flag = badge.querySelector('img.download-flag');
    assert(flag && flag.alt === 'United Kingdom','Country flag missing from the default server badge');
    const spark = stats.querySelector('.download-spark');
    assert(spark && spark.querySelector('svg'),'60-second speed graph missing');
    assert(spark.textContent.includes('60 s'),'Speed graph window label missing');
    assert(spark.querySelector('svg').getAttribute('aria-label').includes('last 60 seconds'),'Speed graph lacks an accessible description');
    const details = stats.querySelector('.download-source-details');
    assert(details && !details.open,'Source details should be collapsed by default');
    assert(details.querySelector('summary').textContent.includes('2 sources'),'Source summary is not compact');
    details.querySelector('summary').click(); await wait(30);
    const detailText = details.textContent;
    assert(detailText.includes('d2xsxph8kpxj0f.cloudfront.net') && detailText.includes('London, UK'),'CDN edge location missing');
    assert(detailText.includes('Amsterdam, Netherlands'),'Second source location missing');
    assert(detailText.includes('not IP geolocation'),'Location provenance note missing');
    const card = stats.closest('.download-row');
    assert(stats.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1,'Statistics overflow their card');
    assert(!document.body.textContent.includes('Signature='),'Statistics leaked a signed URL');
    window.fixturePauseDownload();
    await wait(120);
    assert(!document.querySelector('.download-stats'),'Live statistics should hide when paused');
    return 'PASS Electron browsing UI: browsing, filter parity, navigation, preview layout, high-res loading/decoding, stale-image guards, failure/retry and compact download statistics';
  }.toString())}+ ')()');
  assert.equal(errors.length,0,errors.join(' | '));
  console.log(results);
  {
    const { mkdir, writeFile } = require('node:fs/promises');
    const { join } = require('node:path');
     const output = process.env.OPENBRIDGE_UI_SCREENSHOTS;
     if (output) await mkdir(output, { recursive: true });
     if (output) {
       win.setSize(Math.min(1920,width),Math.min(1080,height));
       await win.webContents.executeJavaScript(\`document.querySelectorAll('.nav-item')[0].click();\`);
       await new Promise(resolve=>setTimeout(resolve,200));
       await win.webContents.executeJavaScript(\`(()=>{const root=document.querySelector('.discover');root.querySelector('.facet-panel [aria-label="Close filters"]')?.click();const select=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Select');if(select)select.click();})()\`);
       await new Promise(resolve=>setTimeout(resolve,100));
       for (let i=0;i<3;i++) {
         await win.webContents.executeJavaScript(\`(()=>{const card=document.querySelectorAll('.discover .asset-card')[__INDEX__];if(card && !card.classList.contains('selected'))card.click()})()\`.replace('__INDEX__',String(i)));
         await new Promise(resolve=>setTimeout(resolve,40));
       }
       await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.discover button')].find(b=>b.textContent.trim()==='List / compare view').click();\`);
       await new Promise(resolve=>setTimeout(resolve,200));
       win.webContents.invalidate();await writeFile(join(output,'comparison.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`(()=>{const root=document.querySelector('.discover');[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Grid view')?.click();[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Done')?.click();})()\`);
     }
     for (const requestedWidth of [2560,1920,1100,1024]) {
       win.setSize(Math.min(requestedWidth,area.width),Math.min(1080,area.height));
       await win.webContents.executeJavaScript(\`document.querySelectorAll('.nav-item')[0].click();window.fixtureDownloading();\`);
       await new Promise(resolve=>setTimeout(resolve,200));
       await win.webContents.executeJavaScript(\`document.querySelector('.discover .asset-area').scrollTop=500;document.querySelector('.discover .asset-card').click();\`);
       await new Promise(resolve=>setTimeout(resolve,350));
       const fit=await win.webContents.executeJavaScript(\`(()=>{
         const drawer=document.querySelector('.drawer').getBoundingClientRect();
         const grid=document.querySelector('.discover .virtual-grid').getBoundingClientRect();
         const footer=document.querySelector('.drawer-footer').getBoundingClientRect();
         const header=document.querySelector('.topbar').getBoundingClientRect();
         return {docked:innerWidth>1180,overlap:grid.right>drawer.left+1,footer:footer.bottom<=innerHeight+1&&footer.height>0,
           aligned:Math.abs(drawer.top-header.bottom)<=1,
           cards:document.querySelectorAll('.discover .asset-card').length,scrolled:document.querySelector('.discover .asset-area').scrollTop>0};
       })()\`);
       assert.equal(fit.footer,true,'Sticky footer outside viewport at '+requestedWidth);
       assert.equal(fit.aligned,true,'Drawer is not aligned with the topbar at '+requestedWidth);
       assert.ok(fit.cards>0&&fit.scrolled,'Reflow blanked or reset scrolled grid at '+requestedWidth);
       if(fit.docked)assert.equal(fit.overlap,false,'Drawer covers grid at '+requestedWidth);
       if(output)await writeFile(join(output,'workspace-drawer-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.inspector-tabs button')].find(b=>b.textContent==='Overview').click();document.querySelector('.asset-scale-panel').scrollIntoView({block:'center'});\`);
       await new Promise(resolve=>setTimeout(resolve,120));
       if(output)await writeFile(join(output,'workspace-scale-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.inspector-tabs button')].find(b=>b.textContent==='Download').click();\`);
       await new Promise(resolve=>setTimeout(resolve,100));
       if(output)await writeFile(join(output,'workspace-settings-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`document.querySelector('.drawer [title="Close"]').click();document.querySelectorAll('.nav-item')[1].click();\`);
       await new Promise(resolve=>setTimeout(resolve,180));
       if(output)await writeFile(join(output,'workspace-library-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`document.querySelector('.activity-pill').click();\`);
       await new Promise(resolve=>setTimeout(resolve,50));
       if(output)await writeFile(join(output,'workspace-activity-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`document.querySelector('.activity-pill').click();document.querySelectorAll('.nav-item')[2].click();\`);
       await new Promise(resolve=>setTimeout(resolve,180));
       if(output)await writeFile(join(output,'workspace-downloads-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
     }
     console.log('PASS docked/overlay drawer, sticky footer and mid-scroll reflow at workspace widths');
     await win.webContents.executeJavaScript(\`document.querySelectorAll('.nav-item')[1].click();\`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await win.webContents.executeJavaScript(\`document.querySelector('.library .asset-card').click();\`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.drawer button')].find(button=>button.textContent.trim()==='Maps').click();\`);
    for (const [name, requestedWidth, requestedHeight, drawer] of [['maps-wide',1440,1000,480],['maps-narrow',1024,768,320],['maps-long-label',1024,768,320],['render-narrow',1024,768,320]]) {
      win.setSize(Math.min(requestedWidth,width),Math.min(requestedHeight,height));
      await win.webContents.executeJavaScript(\`document.documentElement.style.setProperty('--drawer', '\${drawer}px');\`);
      if (name === 'maps-long-label') await win.webContents.executeJavaScript(\`document.querySelector('.map-nav-label strong').textContent='Texture set foliage / Billboard / Translucency variation 24';\`);
      if (name === 'render-narrow') await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.drawer button')].find(button=>button.textContent.trim()==='Render').click();\`);
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 200));
      const layout = await win.webContents.executeJavaScript(\`(() => {
        const label=document.querySelector('.map-nav-label'), action=document.querySelector('.preview-expand-action');
        const picker=document.querySelector('.preview-picker .dropdown-control'), navigation=document.querySelector('.map-nav-actions');
        const overlaps=(a,b)=>{a=a.getBoundingClientRect();b=b.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;};
        return { labelOverlap:label ? overlaps(label,action) || overlaps(label,navigation) : false,
          pickerOverlap:overlaps(picker,action) };
      })()\`);
      assert.equal(layout.labelOverlap,false,name+': map controls overlap');
      assert.equal(layout.pickerOverlap,false,name+': picker/expand overlap');
      if (output) await writeFile(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    console.log('PASS preview layout at wide/narrow widths and with long map names');
    if (output) {
      await win.webContents.executeJavaScript(\`document.querySelector('.drawer [title="Close"]').click();document.querySelectorAll('.nav-item')[0].click();\`);
      await new Promise(resolve => setTimeout(resolve, 150));
      await win.webContents.executeJavaScript(\`document.querySelector('.discover .asset-card').click();\`);
      await new Promise(resolve => setTimeout(resolve, 150));
      await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.drawer button')].find(button=>button.textContent.trim()==='Maps').click();window.fixturePreviewMode('slow');\`);
      await new Promise(resolve => setTimeout(resolve, 100));
      await win.webContents.executeJavaScript(\`document.querySelector('.expand-preview').click();\`);
      await new Promise(resolve => setTimeout(resolve, 150));
      win.webContents.invalidate();
      await writeFile(join(output,'highres-loading.png'),(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(\`new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{if(document.querySelector('.image-viewer-canvas img')?.naturalWidth===4096)resolve(true);else if(Date.now()-start>5000)reject(new Error('High-res screenshot timed out'));else setTimeout(poll,25)};poll();})\`);
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 100));
      await writeFile(join(output,'highres-loaded.png'),(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(\`(()=>{const close=[...document.querySelectorAll('.image-viewer button')].find(button=>button.textContent.trim()==='Close preview');close?.click();document.querySelector('.drawer [title="Close"]')?.click();window.fixtureDownloading();document.querySelectorAll('.nav-item')[2].click();})()\`);
      await new Promise(resolve => setTimeout(resolve, 200));
      for (const [name, width, height, open] of [['downloads-wide',1440,1000,false],['downloads-sources',1440,1000,true],['downloads-narrow',1024,768,false]]) {
        win.setSize(width,height);
        await win.webContents.executeJavaScript(\`{const details=document.querySelector('.download-source-details');if(details)details.open=\${open};}\`);
        win.webContents.invalidate();
        await new Promise(resolve => setTimeout(resolve, 200));
        const fit = await win.webContents.executeJavaScript(\`(() => {
          const stats=document.querySelector('.download-stats'), card=document.querySelector('.download-row'), body=document.querySelector('.download-body');
          if(!stats) return { missing:true };
          const s=stats.getBoundingClientRect(), c=card.getBoundingClientRect(), b=body.getBoundingClientRect();
          return { inside:s.right<=c.right+1 && s.left>=c.left-1, body:s.right<=b.right+1, height:s.height,
            summary:document.querySelector('.download-source-summary')?.textContent || '' };
        })()\`);
        assert.equal(fit.missing,undefined,name+': download statistics missing');
        assert.equal(fit.inside,true,name+': statistics escape the download card');
        assert.equal(fit.body,true,name+': statistics escape the download body');
        if (output) await writeFile(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
      }
      console.log('PASS download statistics layout at wide/narrow widths with source details open');
    }
  }
   await win.webContents.executeJavaScript('('+${JSON.stringify(async function publicProviderUi() {
     const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
     const assert = (value, message) => { if (!value) throw new Error(message); };
     const button = (scope, text) => [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text);
     const until = async (condition, message) => {
       const deadline = performance.now() + 5000;
       while (!condition()) { if (performance.now() > deadline) throw new Error(message); await wait(25); }
     };
     const focusProvider = async label => {
       let summary = [...document.querySelectorAll('.browse-menu > summary')].find(item => item.textContent.trim() === 'Sources');
       if (!summary) {
         const all = [...document.querySelectorAll('.provider-switch button')].find(item => item.textContent.trim() === 'All');
         all?.click(); await wait(300);
         summary = [...document.querySelectorAll('.browse-menu > summary')].find(item => item.textContent.trim() === 'Sources');
       }
       assert(summary, 'Sources menu missing');
       summary.click(); await wait(50);
       const item = [...document.querySelectorAll('.browse-menu-panel button.source-summary')]
         .find(entry => entry.querySelector('span')?.textContent === label);
       assert(item, 'Focus source missing: '+label); item.click(); await wait(400);
     };
     window.fixturePublicEnabled();
     const discover = [...document.querySelectorAll('.nav-item')].find(item => item.querySelector('span')?.textContent === 'Discover'); discover.click(); await wait(200);
     for (const [provider, label] of [['ambientcg','ambientCG'],['blenderkit','BlenderKit'],['openhdri','OpenHDRI']]) {
       await focusProvider(label); await wait(400);
        const card = document.querySelector('[data-asset-id="'+provider+':fixture-'+provider+'"]');
        assert(card, label+': focused catalogue card missing');
        const title = card.querySelector('.asset-meta strong');
        const bounds = title?.getBoundingClientRect();
        assert(title?.textContent === provider+' fixture' && bounds.height > 0 &&
          bounds.bottom <= card.getBoundingClientRect().bottom + 1 &&
          Number(getComputedStyle(title.parentElement).opacity) > 0,
          label+': card title must be visible inside the thumbnail without hovering');
       if(provider==='openhdri'){
         const thumb=card.querySelector('.asset-thumb img');
         assert(thumb?.src.includes('/api/image/fixture-openhdri.jpg?w=512&q=80&f=png'),'OpenHDRI card must request the current PNG thumbnail, not a stale AVIF URL');
         assert(thumb.classList.contains('openhdri-thumb'),'OpenHDRI card is missing the top-2:1 visual crop class');
         const style=getComputedStyle(thumb);
         assert(style.objectFit==='cover','OpenHDRI card must cover-crop the material-ball strip immediately');
         assert(style.objectPosition==='50% 0%'||style.objectPosition.includes('top'),'OpenHDRI card crop must align to the top');
       }
       if(provider==='ambientcg'){
         const thumb=card.querySelector('.asset-thumb img');
         assert(thumb?.src.includes('/fixture_LQ.jpg'),'ambientCG card must use the LQ panorama JPG, not the sphere render: '+thumb?.src);
       }
       card.click(); await wait(200);
       const drawer = document.querySelector('.drawer'); assert(drawer?.textContent.includes(provider+' fixture'), label+': drawer missing');
       assert(drawer.textContent.includes('CC0-1.0'),label+': licence missing');
       assert(drawer.textContent.includes('Fixture Author'),label+': creator missing');
       drawer.querySelector('.expand-preview').click(); await wait(200);
       const viewer=document.querySelector('.image-viewer'); assert(viewer,label+': preview viewer missing');
       if(provider==='openhdri'){
         await wait(250);
         assert(!viewer.querySelector('[aria-label="HDR exposure controls"]'),'OpenHDRI must not offer 16K live HDR exposure');
         assert(!window.fixtureCalls().some(call=>call.kind==='publicHdr'&&call.provider==='openhdri'),'OpenHDRI must not request a 16K HDR source');
         assert(drawer.textContent.includes('16K')&&drawer.textContent.includes('8K'),'OpenHDRI 16K/8K explanation missing');
       } else {
         const picker=viewer.querySelector('select');picker.value='1';picker.dispatchEvent(new Event('change',{bubbles:true}));await wait(300);
         assert(window.fixtureCalls().some(call=>call.kind==='publicHdr'&&call.provider===provider),label+': HDR loader was not routed');
         assert(viewer.querySelector('[aria-label="HDR exposure controls"]'),label+': live exposure controls missing');
       }
       button(viewer,'Close preview').click(); await wait(100);
       assert(document.querySelector('.drawer'),label+': closing viewer incorrectly closed drawer');
       button(drawer.querySelector('.drawer-footer'),'Download').click(); await wait(100);
       const call = window.fixtureCalls().find(call=>call.kind==='publicDownload'&&call.provider===provider);
       assert(call?.options.resolution==='2K'&&call.options.format==='exr',label+': download variant not preserved');
       button(drawer,'Technical').click();await wait(80);assert(drawer.textContent.includes('Catalogue ID'),label+': grouped technical facts missing');
       if(provider==='ambientcg') assert(drawer.textContent.includes('Technique')&&drawer.textContent.includes('Hdri Bracketed Panorama')&&drawer.textContent.includes('Download stats'),label+': ambientCG technique/stats missing');
       if(provider==='blenderkit') assert(drawer.textContent.includes('Rating')&&drawer.textContent.includes('9.5/10')&&drawer.textContent.includes('Validated'),label+': BlenderKit rating/verification missing');
       if(provider==='openhdri') assert(drawer.textContent.includes('Location')&&drawer.textContent.includes('Fixture location')&&drawer.textContent.includes('Dynamic range')&&drawer.textContent.includes('White balance'),label+': OpenHDRI capture metadata missing');
       button(drawer,'Related').click();await wait(150);assert(drawer.textContent.includes('Related'),label+': related tab missing');
       drawer.querySelector('[aria-label="Close"]').click();
     }
     const providerSwitcher=document.querySelector('.provider-switch');
     assert(providerSwitcher.scrollWidth<=providerSwitcher.clientWidth+1,'Provider switch overflows the sidebar');
     button(providerSwitcher,'All').click(); await wait(300);
     const allRoot=document.querySelector('.view-slot:not([hidden])');
     button(allRoot,'Filters').click();await wait(150);
     const facetTabs=[...allRoot.querySelectorAll('.facet-tab')].map(tab=>tab.textContent);
     assert(facetTabs.some(label=>label.includes('ambientCG · Resolution')),'Combined filters are missing ambientCG facets');
     assert(facetTabs.some(label=>label.includes('BlenderKit · Licence')),'Combined filters are missing BlenderKit facets');
     for (const label of ['Filter by asset type across all sources','Filter by ownership or favorites','Filter by physical size']) {
       const trigger = document.querySelector('[aria-label="'+label+'"]');
       if (!trigger) continue;
       trigger.click(); await wait(50);
       document.querySelector('[role="listbox"] [role="option"]')?.click(); await wait(150);
     }
     await wait(300);
     for (const provider of ['ambientcg','blenderkit','openhdri']) assert(document.querySelector('[data-asset-id="'+provider+':fixture-'+provider+'"]'),provider+': missing from All-source merged grid');
     window.fixturePublicMany(); await focusProvider('ambientCG'); await wait(350);
     const root=document.querySelector('.public-provider-view');
     assert(root.scrollHeight>root.clientHeight+200,'Public catalogue must scroll independently with a large result set');
     const nativeSelects=[...root.querySelectorAll('select.native-select')];
     assert(nativeSelects.length>=4,'Public filter controls are missing');
     for(const select of nativeSelects){
       const style=getComputedStyle(select);
       assert(style.backgroundColor!=='rgb(255, 255, 255)',select.getAttribute('aria-label')+': native select still uses a white platform background');
       assert(style.color!==style.backgroundColor,select.getAttribute('aria-label')+': native select text is invisible');
     }
     button(root,'Filters').click();await wait(150);
     const resolutionTab=[...root.querySelectorAll('.facet-tab')].find(tab=>tab.textContent.includes('Resolution'));
     assert(resolutionTab,'Public filter workbench has no Resolution group');resolutionTab.click();await wait(80);
     const resolutionOptions=[...root.querySelectorAll('.facet-option')].filter(option=>/^2K|^4K/.test(option.textContent.trim()));
     assert(resolutionOptions.length>=2,'Public Resolution facets are missing');resolutionOptions[0].click();await wait(100);resolutionOptions[1].click();await wait(150);
     const multiFacet=window.fixtureCalls().filter(call=>call.kind==='publicSearch'&&call.query.provider==='ambientcg').at(-1);
     assert(Array.isArray(multiFacet.query.resolutions)&&multiFacet.query.resolutions.includes('2K')&&multiFacet.query.resolutions.includes('4K'),'Public facets must preserve multiple selected values');
     button(root,'Clear filters').click();await wait(150);
     const cards=[...root.querySelectorAll('.asset-card')]; assert(cards.length>=6,'Public range fixture missing cards');
     cards[0].click(); await wait(150);
     const rangeTarget=root.querySelector('[data-asset-id="ambientcg:fixture-ambientcg-5"]');assert(rangeTarget,'Public range target missing after drawer reflow');
     rangeTarget.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true})); await wait(150);
     assert(root.textContent.includes('6 selected'),'Public Shift-click must select the inclusive loaded range: '+JSON.stringify({first:cards[0].dataset.assetId,selection:root.textContent.match(/\d+ selected/g)}));
     assert(!document.querySelector('.drawer'),'Shift selection must close the inspector');
     button(root,'Done').click(); await wait(100);
      const setInput=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      setInput(document.querySelector('[aria-label="Search ambientCG"]'),'fixture search'); await wait(500);
      const savedPanel=root.querySelector('.public-saved-searches');
      assert(!savedPanel.open,'Saved-search editor should not take space by default');
      savedPanel.querySelector('summary').click();
      setInput(root.querySelector('[aria-label="Save public search as"]'),'Fixture saved search');await wait(80);button(root,'Save search').click();await wait(100);
     const saved=root.querySelector('[aria-label="Public saved searches"]');assert(saved.options.length===2,'Public saved search missing');
     button(root,'Clear search and filters').click();await wait(100);saved.value=saved.options[1].value;saved.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);
     const recent=window.fixtureCalls().filter(call=>call.kind==='publicSearch'&&call.query.provider==='ambientcg').at(-1);
     assert(recent.query.query==='fixture search','Saved search did not restore its query');
     button(root,'List / compare').click();await wait(150);assert(root.querySelector('.asset-list-view'),'Public list/compare view missing');
     button(root,'Grid view').click();await wait(200);
     const startFresh=button(document,'Start fresh');assert(startFresh,'Global Start fresh action missing');startFresh.click();await wait(300);
      const resetCall=window.fixtureCalls().filter(call=>call.kind==='publicSearch'&&call.query.provider==='ambientcg').at(-1);
      assert(!resetCall.query.query&&!resetCall.query.resolutions?.length,'Start fresh did not reset the focused public source');
      button(document.querySelector('.provider-switch'),'All').click(); await wait(300);
      const globalInput=document.querySelector('[aria-label="Search all asset sources"]');      globalInput.focus(); setInput(globalInput,'oak'); await wait(40);
      globalInput.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true})); await wait(20);
      assert(document.getElementById(globalInput.getAttribute('aria-activedescendant'))?.classList.contains('global-search-action'),'Arrow Up from the search input should select the last action');
      globalInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})); await wait(20);
      assert(globalInput.getAttribute('aria-expanded')==='true','IME confirmation must not submit the query');
      globalInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await wait(20);
      assert(document.activeElement===globalInput && !document.querySelector('.global-search-panel'),'Escape should dismiss suggestions without moving focus');
      globalInput.blur();
      const openhdriToggle=button(document.querySelector('.provider-switch'),'OpenHDRI');
      openhdriToggle.click(); await wait(350);
      assert(openhdriToggle.getAttribute('aria-pressed')==='false','Clicking a provider did not disable it');
      assert(![...document.querySelectorAll('.asset-card')].some(card=>card.dataset.assetId?.startsWith('openhdri:')),'Disabled provider still shows cards');
      assert(document.querySelector('.provider-switch-note'),'Hidden-source note missing');
      openhdriToggle.click(); await wait(350);
      assert(openhdriToggle.getAttribute('aria-pressed')==='true','Second click did not re-enable the provider');
      await focusProvider('ambientCG'); await wait(250);
      window.fixtureSurface(true);
      await focusProvider('ambientCG'); await wait(300);
      document.querySelector('[data-asset-id^="ambientcg:fixture-ambientcg"]').click(); await wait(200);
      const surfaceDrawer=document.querySelector('.drawer');
      button(surfaceDrawer,'Sphere').click();
      await until(()=>surfaceDrawer.querySelector('.surface-preview .model-viewer-canvas'),'Sphere surface preview did not render');
      const sphereCanvas=surfaceDrawer.querySelector('.model-viewer-canvas');
      assert(sphereCanvas.width>0,'Sphere canvas has no drawing buffer');
      assert(!surfaceDrawer.querySelector('.image-viewer'),'Image viewer opened instead of the sphere');
      const inlineQuality=surfaceDrawer.querySelector('.model-preview-controls select');
      assert(inlineQuality && inlineQuality.options.length>1,'Inline sphere quality selector missing');
      inlineQuality.value='2048';inlineQuality.dispatchEvent(new Event('change',{bubbles:true}));await wait(300);
      assert(inlineQuality.value==='2048','Inline quality selector did not apply');
      button(surfaceDrawer,'Full screen').click();
      await until(()=>document.querySelector('.model-viewer-overlay'),'Sphere fullscreen missing');
      assert(document.querySelector('.model-viewer-overlay input[aria-label="Surface displacement strength"]'),'Displacement strength control missing');
      assert(document.querySelector('.model-viewer-quality-bar select'),'Fullscreen quality selector missing');
      const wire=document.querySelector('.model-viewer-overlay input[type=checkbox]');
      wire.click(); await until(()=>document.querySelector('.model-viewer-overlay .model-viewer-canvas')?.dataset.surfaceDisplaced==='true','Wireframe did not displace the sphere geometry');
      const strength=document.querySelector('.model-viewer-overlay input[aria-label="Surface displacement strength"]');
      strength.value='150';strength.dispatchEvent(new Event('input',{bubbles:true}));await wait(80);
      assert(document.querySelector('.model-viewer-overlay .model-viewer-canvas')?.dataset.surfaceDisplaced==='true','Displacement update dropped the displaced wireframe');
      wire.click(); await wait(80);
      assert(!document.querySelector('.model-viewer-overlay .model-viewer-canvas')?.dataset.surfaceDisplaced,'Wireframe-off did not restore the base sphere');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      await until(()=>!document.querySelector('.model-viewer-overlay'),'Escape did not close the sphere fullscreen');
      window.fixtureSurface(false);
   }.toString())}+')()');
   const publicScreenshots=process.env.OPENBRIDGE_UI_SCREENSHOTS;
   if(publicScreenshots){await writeFile(join(publicScreenshots,'public-provider-filters.png'),(await win.webContents.capturePage()).toPNG());}
   console.log('PASS new provider focused/All browsing, real-preview routing, safe HDR limits, range selection, saved searches, list/compare and independent scrolling');
   win.setSize(Math.min(1024,area.width), Math.min(768,area.height));
   await new Promise(resolve=>setTimeout(resolve,150));
   const compact = await win.webContents.executeJavaScript(\`(()=>{
     const sidebar=document.querySelector('.sidebar');
     const controls=document.querySelector('.public-provider-controls');
     const primary=[...controls.querySelector('.public-provider-row').children].map(x=>x.getBoundingClientRect());
     const providers=[...sidebar.querySelectorAll('.provider-switch button')];
     const fits=providers.every(button=>button.clientWidth>=button.scrollWidth-1);
     const container=controls.getBoundingClientRect();
     return {width:innerWidth, sidebar:sidebar.getBoundingClientRect().width, fits, grid:document.querySelector('.public-provider-view .asset-card').getBoundingClientRect().top,
       controlHeight:container.height, rows:new Set(primary.map(r=>Math.round(r.bottom))).size,
       within:primary.every(r=>r.left>=container.left&&r.right<=container.right)};
   })()\`);
   assert.ok(compact.sidebar<=208&&compact.fits&&compact.within,'Narrow workspace overflow: '+JSON.stringify(compact));
   if(compact.width>=1000){assert.equal(compact.rows,1,'Primary provider controls should fit on one row: '+JSON.stringify(compact));assert.ok(compact.controlHeight<=130&&compact.grid<=340,'Asset grid starts too far below the narrow toolbar: '+JSON.stringify(compact));}
   if(publicScreenshots){await writeFile(join(publicScreenshots,'public-provider-1024.png'),(await win.webContents.capturePage()).toPNG());await writeFile(join(publicScreenshots,'surface-sphere.png'),(await win.webContents.capturePage()).toPNG());}
   await win.webContents.executeJavaScript("document.querySelector('.drawer [aria-label=Close]')?.click()");
   console.log('PASS compact 1024px workspace: readable providers, single-row primary filters, and no horizontal overflow');
    const modelSmoke = await win.webContents.executeJavaScript('('+${JSON.stringify(async function runModelSmoke() {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return 'SKIP 3D lifecycle: WebGL2 unavailable';
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const until = async (condition, message) => {
        const deadline = performance.now() + 5000;
        while (!condition()) {
          if (performance.now() > deadline) throw new Error(message);
          await wait(25);
        }
      };
      const button = (root, text) => [...root.querySelectorAll('button')].find(item => item.textContent.trim() === text || item.getAttribute('aria-label') === text || item.title === text);
      const focusProvider = async label => {
        let summary = [...document.querySelectorAll('.browse-menu > summary')].find(item => item.textContent.trim() === 'Sources');
        if (!summary) {
          const all = [...document.querySelectorAll('.provider-switch button')].find(item => item.textContent.trim() === 'All');
          all?.click(); await wait(300);
          summary = [...document.querySelectorAll('.browse-menu > summary')].find(item => item.textContent.trim() === 'Sources');
        }
        if (!summary) throw new Error('Sources menu missing');
        summary.click(); await wait(50);
        const item = [...document.querySelectorAll('.browse-menu-panel button.source-summary')]
          .find(entry => entry.querySelector('span')?.textContent === label);
        if (!item) throw new Error('Focus source missing: '+label);
        item.click(); await wait(400);
      };
      const originalFetch = window.fetch;
      let lightingFetches = 0;
      window.fetch = (...args) => {
        if ((args[0]?.url ?? String(args[0])).includes('monochrome_studio_02_1k')) lightingFetches++;
        return originalFetch(...args);
      };
      await focusProvider('Megascans');
      const card = () => document.querySelector('.view-slot:not([hidden]) .asset-card');
      await until(card, 'Missing model fixture card');
      card().click();
      const drawer = () => document.querySelector('.drawer');
      await until(() => drawer() && button(drawer(), '3D'), 'Missing 3D preview tab');
      button(drawer(), '3D').click();
      const canvas = () => drawer()?.querySelector('.model-viewer-canvas');
      await until(() => canvas() && !drawer().querySelector('.model-viewer-status'), '3D fixture did not render');
      const context = canvas().getContext('webgl2');
      const textures = () => drawer().querySelector('.model-preview-controls select');
      textures().value = '2048';
      textures().dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => window.fixtureCalls().some(call => call.kind === 'model' && call.request.quality === 2048)
        && !drawer().querySelector('.model-viewer-status, .model-preview-panel[aria-busy="true"]'), '3D quality switch did not complete');
      await wait(100);
      if (lightingFetches !== 1) throw new Error('Expected one studio HDR load across quality changes, got '+lightingFetches);
      const expand = button(drawer(), 'Full screen');
      expand.focus();
      expand.click();
      const expanded = () => document.querySelector('.model-viewer-overlay');
      await until(() => expanded()?.querySelector('.model-viewer-canvas') && !expanded().querySelector('.model-viewer-status'), 'Fullscreen model did not render');
      const close = button(expanded(), 'Close 3D viewer');
      if (document.activeElement !== close || !document.getElementById('root').inert) throw new Error('Fullscreen did not take keyboard focus');
      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      if (document.activeElement === close || !expanded().contains(document.activeElement)) throw new Error('Shift+Tab did not wrap within fullscreen');
      const fullscreenTextures = expanded().querySelector('.model-viewer-quality-bar select');
      window.fixtureModelFail(true);
      fullscreenTextures.value = '1024';
      fullscreenTextures.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => expanded().querySelector('.model-switch-error'), 'Fullscreen did not show quality-switch failure');
      if (fullscreenTextures.value !== '2048' || !expanded().querySelector('.model-viewer-canvas') || !canvas()) throw new Error('Failed switch discarded the working preview or showed the wrong tier');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await until(() => !expanded(), 'Escape did not close fullscreen');
      if (document.activeElement !== expand || document.getElementById('root').inert) throw new Error('Fullscreen did not restore focus');
      button(drawer(), 'Close').click();
      await until(() => context.isContextLost(), 'Closing the model did not release its WebGL context');
      const thumbnail = card().querySelector('.asset-thumb-img');
      thumbnail.dispatchEvent(new Event('error'));
      await until(() => card().querySelector('.preview-unavailable'), 'Failed thumbnail did not get a placeholder');
      return 'PASS 3D lighting reuse, fullscreen focus, failed switch recovery, WebGL release and thumbnail fallback';
    }.toString())}+')()');
    console.log(modelSmoke);
   app.exit(0);
 } catch(error) { console.error('RENDERER_ERRORS',errors);console.error(error.stack || error.message);app.exit(1); }
}).catch(error=>{console.error(error.message);app.exit(1)});
`;
try {
  await writeFile(join(directory, "preload.cjs"), preload);
  await writeFile(join(directory, "main.cjs"), main);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [join(directory, "main.cjs")], { env, stdio: "inherit" });
  const timeout = setTimeout(() => { child.kill(); }, 60_000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject); child.on("exit", code => resolve(code ?? 1));
  });
  clearTimeout(timeout);
  if (code !== 0) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
