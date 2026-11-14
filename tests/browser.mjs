// Optional local UI verification and genuine Chromium screenshots. No npm packages.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const executable=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const root=resolve(process.argv[2]||'out'),profile=mkdtempSync(join(tmpdir(),'atlas-chrome-'));
const child=spawn(executable,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
try {
  for(let i=0;i<100&&!existsSync(join(profile,'DevToolsActivePort'));i++)await pause(100);
  const port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no});
  let id=0;const pending=new Map(),errors=[],external=[];
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))external.push(m.params.request.url)};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1160,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:pathToFileURL(join(root,'dashboard','index.html')).href});
  for(let i=0;i<60;i++){if(await evaluate('!!document.querySelector("#result-count")'))break;await pause(50)}
  assert.equal(await evaluate('document.querySelector("#result-count").textContent'),'140 / 140');
  const screenshot=async name=>{for(const quality of [100,98,96,94,92,90,88]){const shot=await send('Page.captureScreenshot',{format:'jpeg',quality,captureBeyondViewport:false}),bytes=Buffer.from(shot.data,'base64');if(bytes.length<=340000){writeFileSync(join('screenshots',name),bytes);return}}throw Error('Screenshot exceeds target byte budget')};
  await screenshot('1-board.jpg');
  await evaluate('document.querySelector("[data-sort=growth]").click()');
  assert.equal(await evaluate('document.querySelector("[data-sort=growth]").textContent.includes("↓")'),true);
  const topGrowth=await evaluate('document.querySelector("tbody tr td:nth-child(4)").textContent');
  assert.ok(topGrowth.startsWith('+'));
  await evaluate('document.querySelector("#search").value="veda";document.querySelector("#search").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('document.querySelector("#result-count").textContent'),'1 / 140');
  await evaluate('document.querySelector("tbody [data-save]").click()');
  assert.equal(await evaluate('document.querySelector("#saved-count").textContent'),'1');
  await evaluate('document.querySelector("tbody tr").click()');
  assert.equal(await evaluate('document.querySelector("#detail").open'),true);
  assert.equal(await evaluate('document.querySelector("#detail-title").textContent'),'Veda');
  assert.equal(await evaluate('document.querySelectorAll(".plan-step").length'),5);
  await screenshot('2-detail.jpg');
  await evaluate('document.querySelector("#close-detail").click();document.querySelector("#shortlist-nav").click();document.querySelector("tbody [data-save]").click()');
  assert.equal(await evaluate('document.querySelectorAll("#field-map circle").length'),0);
  assert.equal(await evaluate('document.querySelector("#result-count").textContent'),'0 / 140');
  await evaluate('document.querySelector("#close-detail").click();document.querySelector("#reset").click();document.querySelector("#category").value="Lending";document.querySelector("#category").dispatchEvent(new Event("change"));document.querySelector("#scope").value="early";document.querySelector("#scope").dispatchEvent(new Event("change"))');
  assert.ok(await evaluate('document.querySelectorAll("tbody tr").length>0'));
  await screenshot('3-filter.jpg');
  await evaluate('document.querySelector("#reset").click()');
  // Visit every row via real pagination and DOM row clicks, checking its detail.
  const visited=await evaluate(`(() => {let names=[];for(let p=0;p<20;p++){const slugs=[...document.querySelectorAll('tbody tr')].map(r=>r.dataset.row);for(const slug of slugs){document.querySelector('tr[data-row="'+slug+'"]').click();if(!document.querySelector('#detail').open||document.querySelectorAll('.plan-step').length!==5)throw Error(slug);names.push(document.querySelector('#detail-title').textContent);document.querySelector('#detail').close()}const next=document.querySelector('#next');if(next.disabled)break;next.click()}return names})()`);
  assert.equal(visited.length,140);
  await evaluate('document.querySelector("#reset").click();document.querySelector("#search").value="no-such-protocol-867";document.querySelector("#search").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('document.querySelector("#result-count").textContent'),'0 / 140');
  await evaluate('document.querySelector("[data-view=model]").click()');
  assert.ok(await evaluate('document.querySelector("#workspace").textContent.includes("peers + 6")'));
  await evaluate('document.querySelector("[data-view=peers]").click()');
  assert.ok(await evaluate('document.querySelectorAll("tbody tr").length>50'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector("[data-view=radar]").click();document.querySelector("#reset").click()');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true);
  assert.deepEqual(errors,[]);
  assert.deepEqual(external,[]);
  console.log(JSON.stringify({ui:'passed',detailsVisited:visited.length,screenshots:3,consoleExceptions:errors.length,externalRequests:external.length,mobileWidth:390,profile}));
} finally {socket?.close();child.kill()}
