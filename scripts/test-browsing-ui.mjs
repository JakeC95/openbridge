import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

// Uses an isolated Electron profile and a fixture preload; never opens the real app/library/session.
const directory = await mkdtemp(join(tmpdir(), "openbridge-ui-"));
const require = createRequire(import.meta.url);
// Hosted runners expose a small virtual desktop, so clamp every requested size to the work area.
// Set OPENBRIDGE_UI_WIDTH/HEIGHT to reproduce a narrower layout locally.
const viewportWidth = Number(process.env.OPENBRIDGE_UI_WIDTH) || 1440;
const viewportHeight = Number(process.env.OPENBRIDGE_UI_HEIGHT) || 1000;
const preload = `
const { contextBridge } = require('electron');
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="sienna"/></svg>');
const highImage = type => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="4096"><rect width="4096" height="4096" fill="'+(type==='normal'?'royalblue':'forestgreen')+'"/></svg>');
let previewMode = 'success';
let paged = false;
const categories = [{key:'3d',label:'3D Assets',count:80,children:[{key:'nature',label:'Nature',count:80,children:[]}]}];
const hits = Array.from({length:80}, (_, i) => ({id:'asset'+i,objectID:'asset'+i,name:'Asset '+i,type:'3d',tags:['wood'],previews:{images:{preview:image,thumbJpg:image}}}));
const assets = hits.map(hit=>({id:hit.id,name:hit.name,type:'3d',categories:['3d','nature'],tags:['wood'],repo:'downloaded',path:'fixture/'+hit.id,jsonPath:'fixture/'+hit.id+'.json',preview:null,thumb:null,mtime:1,previewRelativeSize:'1x1',searchStr:'wood'}));
const counts = {all:80,downloaded:80,custom:0,dhi:0};
const status = {available:true,count:80,generatedAt:1,version:1,importedAt:1};
const pack = {id:'forest-pack',name:'Forest',count:80};
const calls = [];
const noop = () => () => {};
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
  catalog:{categories:async()=>categories, acquired:async()=>[],favorites:async()=>['asset0'],cancel:async()=>{},
    search:async query=>{calls.push({kind:'catalog',query}); if(paged) await new Promise(resolve=>setTimeout(resolve,180)); return {hits:paged ? hits.slice(query.page*40,query.page*40+40) : hits,nbHits:80,page:paged ? query.page : 0,nbPages:paged ? 2 : 1,hitsPerPage:paged ? 40 : 80,facets:{biome:{forest:80},region:{Europe:80}}}},
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
   downloads:{list:async()=>[downloadItem],onProgress:callback=>{progressListeners.add(callback);return()=>progressListeners.delete(callback)},
     pauseAll:async()=>progressListener({...downloadItem,status:'paused'}),resumeAll:async()=>progressListener(downloadItem),
     overview:async()=>({history:[{id:1,assetId:'finished',name:'Completed asset',path:'fixture/finished',bytes:83886080,completedAt:1}],
       session:{receivedBytes:12582912,completed:1,averageBytesPerSecond:3200000,peakBytesPerSecond:6500000},
       disk:{libraryPath:'fixture',totalBytes:549755813888,freeBytes:214748364800,measuredLibraryBytes:85899345920,measuredAssets:40,totalAssets:80}})}, sync:{status:async()=>({running:false,acquired:80,missing:0}),onStatus:noop},
  onLibraryUpdated:noop,onNotification:noop,onSearchPaste:noop,onLibraryHealthProgress:noop,
  openLogs:async()=>{},contextMenu:{asset:async()=>{},search:async()=>{}}
};
contextBridge.exposeInMainWorld('openbridge',api);
contextBridge.exposeInMainWorld('fixtureCalls',()=>calls);
contextBridge.exposeInMainWorld('fixturePaged',value=>{paged=value});
contextBridge.exposeInMainWorld('fixturePreviewMode',mode=>{previewMode=mode});
contextBridge.exposeInMainWorld('fixturePauseDownload',()=>progressListener({...downloadItem,status:'paused',message:'Paused',
  diagnostics:{...downloadItem.diagnostics,activeTransfers:0,receiveBytesPerSecond:0,writeBytesPerSecond:0}}));
contextBridge.exposeInMainWorld('fixtureDownloading',()=>progressListener(downloadItem));
contextBridge.exposeInMainWorld('fixtureProgress',value=>progressListener({...downloadItem,diagnostics:{...downloadItem.diagnostics,receiveBytesPerSecond:value,writeBytesPerSecond:value*0.9}}));
`;
const main = `
const { app, BrowserWindow, screen } = require('electron');
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
     const navigate = label => {
       const name=label.replace(/\d+$/, '');
       const button=[...document.querySelectorAll('.nav-item')].find(item=>item.querySelector('span')?.textContent===name);
       assert(button,'Missing navigation: '+name);button.click();
     };
    const choose = async (label, text) => {
      const trigger=root().querySelector('[aria-label="'+label+'"]');
      assert(trigger,'Missing dropdown: '+label); trigger.click(); await wait(120);
      clickText(document.querySelector('[role="listbox"]'),text); await wait(350);
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
     pagingScroll.scrollTop=pagingScroll.scrollHeight-pagingScroll.clientHeight;
     await wait(80);
     const visibleAnchor=[...pagingScroll.querySelectorAll('[data-grid-key]')].find(card=>card.getBoundingClientRect().bottom>pagingScroll.getBoundingClientRect().top);
     assert(visibleAnchor,'Paging anchor missing');const anchorKey=visibleAnchor.dataset.gridKey;
     const beforePage=visibleAnchor.getBoundingClientRect().top;
     assert(auto,'Paging fixture did not show load more');auto.click();
     await until(()=>window.fixtureCalls().some(call=>call.kind==='catalog' && call.query.page===1),'Auto load did not request page 2');
     await wait(400);
     const afterAnchor=[...pagingScroll.querySelectorAll('[data-grid-key]')].find(card=>card.dataset.gridKey===anchorKey);
     assert(afterAnchor && Math.abs(afterAnchor.getBoundingClientRect().top-beforePage)<5,'Auto loading moved the visible asset: '+anchorKey);
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
    clickText(root(),'Tileable'); await wait(200);
    clickText(root(),'Select'); await wait(20);
    clickText(root(),'Select all 80'); await wait(50);
    const calls=window.fixtureCalls();
    const ids=calls.filter(call=>call.kind==='localIds').at(-1).query;
    assert(ids.sort==='name' && ids.type==='3d' && ids.ready.includes('tileable'),'Local selection omitted filters');
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
    clickText(root(),'Filters');await wait(20);
    const facetPanel=document.querySelector('.facet-panel');
    assert(facetPanel,'Catalogue filter panel missing');
    assert(facetPanel.querySelectorAll('.facet-tab').length===6,'Filter groups are not presented as a workbench');
    const activeTab=facetPanel.querySelector('.facet-tab.active');
    assert(activeTab && activeTab.textContent.includes('Biome'),'Biome filter group is not selected by default');
    const forest=[...root().querySelectorAll('.facet-option')].find(item=>item.textContent.startsWith('forest'));
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
     clickText(document.querySelector('.inspector-tabs'),'Download settings');await wait(40);
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
    await choose('Thumbnail size','Compact thumbnails');
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
     for (const requestedWidth of [2560,1920,1100]) {
       win.setSize(Math.min(requestedWidth,area.width),Math.min(1080,area.height));
       await win.webContents.executeJavaScript(\`document.querySelectorAll('.nav-item')[0].click();window.fixtureDownloading();\`);
       await new Promise(resolve=>setTimeout(resolve,200));
       await win.webContents.executeJavaScript(\`document.querySelector('.discover .asset-area').scrollTop=500;document.querySelector('.discover .asset-card').click();\`);
       await new Promise(resolve=>setTimeout(resolve,350));
       const fit=await win.webContents.executeJavaScript(\`(()=>{
         const drawer=document.querySelector('.drawer').getBoundingClientRect();
         const grid=document.querySelector('.discover .virtual-grid').getBoundingClientRect();
         const footer=document.querySelector('.drawer-footer').getBoundingClientRect();
         return {docked:innerWidth>1180,overlap:grid.right>drawer.left+1,footer:footer.bottom<=innerHeight+1&&footer.height>0,
           cards:document.querySelectorAll('.discover .asset-card').length,scrolled:document.querySelector('.discover .asset-area').scrollTop>0};
       })()\`);
       assert.equal(fit.footer,true,'Sticky footer outside viewport at '+requestedWidth);
       assert.ok(fit.cards>0&&fit.scrolled,'Reflow blanked or reset scrolled grid at '+requestedWidth);
       if(fit.docked)assert.equal(fit.overlap,false,'Drawer covers grid at '+requestedWidth);
       if(output)await writeFile(join(output,'workspace-drawer-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.inspector-tabs button')].find(b=>b.textContent==='Overview').click();document.querySelector('.asset-scale-panel').scrollIntoView({block:'center'});\`);
       await new Promise(resolve=>setTimeout(resolve,120));
       if(output)await writeFile(join(output,'workspace-scale-'+requestedWidth+'.png'),(await win.webContents.capturePage()).toPNG());
       await win.webContents.executeJavaScript(\`[...document.querySelectorAll('.inspector-tabs button')].find(b=>b.textContent==='Download settings').click();\`);
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
  app.exit(0);
 } catch(error) { console.error(error.stack || error.message);app.exit(1); }
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
