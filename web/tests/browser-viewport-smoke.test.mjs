// 實際 Chrome CDP 瀏覽器操作；不使用 jsdom／假 DOM，亦不宣稱真人手動驗收。
// 此測試只讀原版 CGI 商品來源，資料寫在作業系統暫存 DATA_DIR。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function freePort(){
  const socket=createServer();
  return new Promise((ok,fail)=>{
    socket.once("error",fail);
    socket.listen(0,"127.0.0.1",()=>{
      const port=socket.address().port;
      socket.close(()=>ok(port));
    });
  });
}
async function startWeb(dir){
  const port=await freePort();
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:WEB_ROOT,env:{...process.env,GAME_MODE:"solo",
      HOST:"127.0.0.1",PORT:String(port),DATA_DIR:dir}
  });
  let output="";
  child.stdout.on("data",x=>output+=x);
  child.stderr.on("data",x=>output+=x);
  const url="http://127.0.0.1:"+port;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    try{
      if((await fetch(url+"/api/state",{signal:AbortSignal.timeout(350)})).ok)
        return {url,async stop(){
          if(child.exitCode!==null)return;
          const done=new Promise(ok=>child.once("exit",ok));
          child.kill();
          await Promise.race([done,pause(1500)]);
        }};
    }catch{}
    await pause(100);
  }
  child.kill();
  throw new Error("瀏覽器測試所需 Web 伺服器無法啟動："+output);
}
function chromeExecutable(){
  for(const cmd of [process.env.CHROME_BIN,"google-chrome",
      "google-chrome-stable","chromium","chromium-browser"]
    .filter(Boolean)){
    const r=spawnSync(cmd,["--version"],{encoding:"utf8",timeout:5000});
    if(r.status===0)return cmd;
  }
  throw new Error("GitHub Runner 找不到 Chrome/Chromium；瀏覽器驗收不可假裝通過");
}
async function openChrome(browserDataDir){
  const command=chromeExecutable();
  const port=await freePort();
  const child=spawn(command,[
    "--headless=new","--no-sandbox","--disable-dev-shm-usage",
    "--disable-gpu","--no-first-run","--no-default-browser-check",
    "--remote-allow-origins=*","--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port="+port,
    "--user-data-dir="+browserDataDir,"about:blank"
  ],{stdio:"ignore"});
  let socketUrl=null;
  for(let i=0;i<120;i++){
    if(child.exitCode!==null)break;
    try{
      const response=await fetch("http://127.0.0.1:"+port+"/json/list",
        {signal:AbortSignal.timeout(400)});
      const entries=await response.json();
      socketUrl=entries.find(x=>x.type==="page")?.webSocketDebuggerUrl;
      if(socketUrl)break;
    }catch{}
    await pause(100);
  }
  if(!socketUrl){
    child.kill();
    throw new Error("Chrome DevTools 協定頁面無法開啟");
  }
  const ws=new WebSocket(socketUrl);
  await new Promise((ok,fail)=>{
    ws.addEventListener("open",ok,{once:true});
    ws.addEventListener("error",fail,{once:true});
  });
  let lastId=0;
  const pending=new Map();
  ws.addEventListener("message",event=>{
    const message=JSON.parse(event.data);
    if(!message.id)return;
    const slot=pending.get(message.id);
    if(!slot)return;
    pending.delete(message.id);
    if(message.error)slot.fail(new Error(JSON.stringify(message.error)));
    else slot.ok(message.result??{});
  });
  const send=(method,params={})=>new Promise((ok,fail)=>{
    const id=++lastId;
    pending.set(id,{ok,fail});
    ws.send(JSON.stringify({id,method,params}));
  });
  return {send,async stop(){
    ws.close();
    if(child.exitCode===null){
      const done=new Promise(ok=>child.once("exit",ok));
      child.kill();
      await Promise.race([done,pause(2500)]);
    }
  }};
}
async function evaluate(cdp,expression){
  const outcome=await cdp.send("Runtime.evaluate",{
    expression,awaitPromise:true,returnByValue:true,userGesture:true
  });
  if(outcome.exceptionDetails)
    throw new Error("Chrome JS 評估錯誤："+JSON.stringify(outcome.exceptionDetails));
  return outcome.result?.value;
}
async function until(cdp,expression,label){
  for(let i=0;i<80;i++){
    if(await evaluate(cdp,expression))return;
    await pause(150);
  }
  throw new Error("Chrome UI 未達指定狀態："+label);
}
async function dismiss(cdp){
  await evaluate(cdp,"(function(){const d=document.getElementById('result-dialog');if(d?.open)document.getElementById('result-dialog-close')?.click();return true;})()");
}
async function click(cdp,selector){
  await dismiss(cdp);
  // 先完成瞬間捲動，再等待前端 scroll handler 同步顯示／隱藏固定狀態列；
  // 直接在同一 JS task 捲動並取 elementFromPoint 會錯把舊遮罩狀態當成按鈕阻擋。
  await evaluate(cdp,"(function(){document.querySelector("+JSON.stringify(selector)+")"+
    "?.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});return true;})()");
  await pause(200);
  const info=await evaluate(cdp,"(function(){const e=document.querySelector("+JSON.stringify(selector)+");"+
    "if(!e)return {error:'missing'};if(e.disabled)return {error:'disabled'};"+
    "const r=e.getBoundingClientRect();"+
    "const x=r.left+r.width/2,y=r.top+r.height/2;"+
    "if(!r.width||!r.height)return {error:'zero-size'};"+
    "const point=document.elementFromPoint(x,y);if(!point||!(e===point||e.contains(point)))"+
    "return {error:'blocked',tag:point?.tagName,id:point?.id,x,y};"+
    "return {x,y};})()");
  assert.ok(!info.error,"點擊 "+selector+" 受阻："+JSON.stringify(info));
  await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:info.x,y:info.y});
  await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:info.x,y:info.y,button:"left",clickCount:1});
  await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:info.x,y:info.y,button:"left",clickCount:1});
}
async function fill(cdp,selector,value){
  const result=await evaluate(cdp,"(function(){const e=document.querySelector("+JSON.stringify(selector)+");"+
    "if(!e)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
    "setter.call(e,"+JSON.stringify(String(value))+");"+
    "e.dispatchEvent(new Event('input',{bubbles:true}));"+
    "e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  assert.ok(result,"無法填入表單："+selector);
}
async function viewport(cdp,width,height){
  await cdp.send("Emulation.setDeviceMetricsOverride",{
    width,height,deviceScaleFactor:1,mobile:width<=768,
    screenWidth:width,screenHeight:height
  });
  await pause(150);
  const actual=await evaluate(cdp,"({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})");
  assert.equal(actual.width,width,"Chrome 視埠寬度不符");
  assert.ok(actual.scroll<=actual.client+8,
    width+"px 文件寬度溢出："+JSON.stringify(actual));
}
test("Chrome：桌面→768px平板→375px手機，操作真實建角／工作／銀行／百貨／背包",{
  timeout:180000
},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-viewport-"));
  let web=null,chrome=null;
  try{
    web=await startWeb(join(workspace,"sqlite"));
    chrome=await openChrome(join(workspace,"chrome-profile"));
    await chrome.send("Page.enable");
    await chrome.send("Runtime.enable");
    await viewport(chrome,1440,900);
    const navigation=await chrome.send("Page.navigate",{url:web.url});
    assert.ok(!navigation.errorText,"實際 Chrome 無法開啟 Web 頁面："+navigation.errorText);
    await until(chrome,"!document.querySelector('#create')?.hidden","顯示建角表單");
    await evaluate(chrome,"window.confirm=()=>true");
    await fill(chrome,'#create-form [name="name"]',"Chrome測試居民");
    await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","建角後遊戲主畫面");
    // 原版單機 Web 建角後通常自動任職「日薪打工」，不能把「無其他可應徵職缺」當成沒工作。
    const alreadyWorking=await evaluate(chrome,"Boolean(document.querySelector('#jobs .job.active'))&&"+
      "!document.querySelector('#work').disabled");
    if(!alreadyWorking){
      await until(chrome,"document.querySelector('#jobs .job button:not(:disabled)')!==null","可應徵工作");
      await click(chrome,"#jobs .job button:not(:disabled)");
    }
    await until(chrome,"!document.querySelector('#work').disabled&&"+
      "document.querySelector('#current-job')?.textContent?.length>0","工作已可操作");
    await click(chrome,"#work");
    await until(chrome,"parseInt(document.querySelector('#work-count')?.textContent||'0',10)>=1","實際工作完成");
    await click(chrome,"#solo-starter-create");
    await until(chrome,"document.querySelector('#solo-starter-town')?.hidden===true","試玩街區完成");
    await click(chrome,"#facility-tab-bank");
    await fill(chrome,'#bank-form [name="amount"]',"100");
    const before=await evaluate(chrome,"(async()=>{const j=await(await fetch('/api/state')).json();return {money:j.character.money,bank:j.character.bank}})()");
    await click(chrome,'#bank-form button[value="deposit"]');
    await until(chrome,"(document.querySelector('#bank')?.textContent?.length||0)>0","銀行資料刷新");
    const after=await evaluate(chrome,"(async()=>{const j=await(await fetch('/api/state')).json();return {money:j.character.money,bank:j.character.bank}})()");
    assert.equal(after.money,before.money-100,"Chrome 存款應真實扣現金");
    assert.equal(after.bank,before.bank+100,"Chrome 存款應真實增加銀行資產");
    await click(chrome,"#facility-tab-shops");
    await until(chrome,"document.querySelectorAll('#retail-items .shop-product-row').length>0","百貨貨架 UI");
    const sku=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "const goods=(s.retailGoods||[]).filter(g=>g.shop==='depart1'&&g.stock>0&&"+
      "g.price>0&&g.price<=Math.min(10000,s.character.money)&&g.details?.usage!=='gift');"+
      "return goods.find(g=>g.details?.usage==='supported')?.sku||goods[0]?.sku||null;})()");
    assert.ok(sku,"瀏覽器測試需至少一件可負擔的真實百貨商品");
    await click(chrome,'#retail-items input[type="radio"][value='+JSON.stringify(sku)+']');
    await until(chrome,"!document.querySelector('#retail-items .shop-checkout button')?.disabled","可購買商品");
    await click(chrome,"#retail-items .shop-checkout button");
    await until(chrome,"document.querySelector('#retail-purchases li')!==null","百貨真實入帳收據");
    await click(chrome,"#profile-tab-inventory");
    assert.equal(await evaluate(chrome,"document.querySelector('#inventory-panel')?.hidden"),false);
    assert.ok((await evaluate(chrome,"document.querySelectorAll('#legacy-inventory-list .inventory-item').length"))>0,
      "百貨物品應顯示在本人背包");
    for(const width of [768,375]){
      await viewport(chrome,width,width===375?812:1024);
      await click(chrome,"#profile-tab-status");
      assert.equal(await evaluate(chrome,"document.querySelector('#player-summary')?.hidden"),false);
      await click(chrome,"#profile-tab-inventory");
      assert.equal(await evaluate(chrome,"document.querySelector('#inventory-panel')?.hidden"),false);
      await click(chrome,"#facility-tab-bank");
      assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-bank')?.hidden"),false);
      assert.ok((await evaluate(chrome,"document.querySelector('#bank-available-balance')?.textContent?.length"))>0);
    }
    await viewport(chrome,1440,900);
    await click(chrome,"#logout");
    await until(chrome,"!document.querySelector('#solo-lobby')?.hidden","返回單機首頁");
    await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","重新繼續遊戲");
    const continued=await evaluate(chrome,"(async()=>{const j=await(await fetch('/api/state')).json();"+
      "return {name:j.character.name,bank:j.character.bank,purchases:j.retailPurchases.length}})()");
    assert.equal(continued.name,"Chrome測試居民");
    assert.ok(continued.bank>=after.bank);
    assert.ok(continued.purchases>=1);
  }finally{
    await chrome?.stop();
    await web?.stop();
    rmSync(workspace,{force:true,recursive:true,maxRetries:10,retryDelay:200});
  }
});
