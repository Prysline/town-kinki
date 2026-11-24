// 實際 Chrome CDP 瀏覽器操作；不使用 jsdom／假 DOM，亦不宣稱真人手動驗收。
// 此測試只讀原版 CGI 商品來源，資料寫在作業系統暫存 DATA_DIR。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
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
async function startWeb(dir,mode="solo"){
  const port=await freePort();
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:WEB_ROOT,env:{...process.env,GAME_MODE:mode,
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
  ],{stdio:"ignore",detached:process.platform!=="win32"});
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
      // Chromium 啟動多個寫入 profile 的子程序，必須結束獨立 process group。
      if(process.platform!=="win32"){
        try{process.kill(-child.pid,"SIGTERM");}catch{child.kill();}
      }else child.kill();
      await Promise.race([done,pause(5000)]);
    }
    await pause(500);
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
  let info;
  // SPA 可能在第一次捲動後又改變佈局；確認真實視窗命中點後才發送滑鼠事件。
  // 不以 HTMLElement.click() 繞過不可見或被遮住的按鈕。
  for(let attempt=0;attempt<5;attempt++){
    await evaluate(cdp,"(function(){document.querySelector("+JSON.stringify(selector)+")"+
      "?.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});return true;})()");
    await pause(200+attempt*80);
    info=await evaluate(cdp,"(function(){const e=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!e)return {error:'missing'};if(e.disabled)return {error:'disabled'};"+
      "const r=e.getBoundingClientRect();"+
      "const x=r.left+r.width/2,y=r.top+r.height/2;"+
      "if(!r.width||!r.height)return {error:'zero-size'};"+
      "if(x<0||y<0||x>=innerWidth||y>=innerHeight)"+
      "return {error:'outside-viewport',x,y,viewport:[innerWidth,innerHeight]};"+
      "const point=document.elementFromPoint(x,y);if(!point||!(e===point||e.contains(point)))"+
      "return {error:'blocked',tag:point?.tagName,id:point?.id,x,y};"+
      "return {x,y};})()");
    if(!info.error||["missing","disabled","zero-size"].includes(info.error))break;
  }
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
    await until(chrome,"document.querySelector('#solo-play-guide')?.hidden===false",
      "試玩街區開始提供新手可操作入口");
    // 真正 Chrome 滑鼠點擊新手推薦，不能只以靜態連結或直接 HTTP 當作地圖可達性。
    await click(chrome,'#solo-play-guide button[data-facility="fishing-panel"]');
    assert.equal(await evaluate(chrome,"document.activeElement?.id"),"fishing-panel");
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-shops')?.hidden"),false);
    await click(chrome,'#solo-play-guide button[data-facility="inventory-panel"]');
    assert.equal(await evaluate(chrome,"document.querySelector('#inventory-panel')?.hidden"),false);
    // 切到背包會正確隱藏狀態頁的「更新狀態」；返回狀態頁後才能測原本按鈕。
    await click(chrome,"#profile-tab-status");
    assert.equal(await evaluate(chrome,"document.querySelector('#player-summary')?.hidden"),false);
    // 21 格實體試玩街區：真實點 D5 優惠券、D7 釣場、D8 合成、D9 遊樂中心。
    for(const [cell,panel,pane] of [
      ["D5","event-panel","events"],["D7","fishing-panel","shops"],
      ["D8","crafting-panel","shops"],["D9","arcade-dice-panel","games"]
    ]){
      const selector='#town-map button[aria-label^='+JSON.stringify(cell+"：")+']';
      // 狀態輪詢可能在取到地圖格座標與送出真實滑鼠事件之間重建 192 格 DOM。
      // 遇到瞬時失焦，最多重新用實際 Chrome 滑鼠點兩次；不可用 DOM.click() 假造驗收。
      let result=null;
      for(let attempt=0;attempt<3;attempt++){
        await click(chrome,selector);
        result=await evaluate(chrome,"({focus:document.activeElement?.id||'',"+
          "paneOpen:document.querySelector('#facility-pane-"+pane+"')?.hidden===false})");
        if(result.focus===panel&&result.paneOpen)break;
      }
      assert.equal(result?.focus,panel,
        cell+" 真正地圖點擊應聚焦可操作的設施");
      assert.equal(result?.paneOpen,true,
        cell+" 的所屬設施分頁應開啟");
    }
    await click(chrome,"#facility-tab-bank");
    await fill(chrome,'#bank-form [name="amount"]',"100");
    const before=await evaluate(chrome,"(async()=>{const j=await(await fetch('/api/state')).json();return {money:j.character.money,bank:j.character.bank}})()");
    await click(chrome,'#bank-form button[value="deposit"]');
    await until(chrome,"(document.querySelector('#bank')?.textContent?.length||0)>0","銀行資料刷新");
    const after=await evaluate(chrome,"(async()=>{const j=await(await fetch('/api/state')).json();return {money:j.character.money,bank:j.character.bank}})()");
    assert.equal(after.money,before.money-100,"Chrome 存款應真實扣現金");
    assert.equal(after.bank,before.bank+100,"Chrome 存款應真實增加銀行資產");
    // 僅在隔離 Chrome 測試存檔加入兩週稅務紀錄，驗證 UI 不隱藏較早欠稅。
    const historyDb=new DatabaseSync(join(workspace,"sqlite","solo.sqlite"));
    try{
      const add=historyDb.prepare(
        "INSERT INTO bank_tax_assessments(user_id,tax_day,assessment_base,kpoint,rate_percent,gross,discount,due,paid,unpaid,created_at) VALUES(1,?,?,0,1,?,0,?,?,?,?)"
      );
      add.run("2026-01-05",5000000,50000,50000,0,50000,1000);
      add.run("2026-01-12",6000000,60000,60000,60000,0,2000);
    }finally{historyDb.close();}
    await click(chrome,"#refresh");
    await until(chrome,"document.querySelector('#bank-tax-status')?.textContent?.includes('歷史累計未繳')","銀行顯示跨週欠稅");
    const taxText=await evaluate(chrome,"document.querySelector('#bank-tax-status')?.textContent");
    assert.match(taxText,/最近結算：2026-01-12/);
    assert.match(taxText,/歷史累計未繳 50,000 元/);
    assert.match(taxText,/1 期/);
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
      assert.match(await evaluate(chrome,"document.querySelector('#bank-tax-status')?.textContent"),/歷史累計未繳 50,000 元/,
        width+"px 銀行應持續呈現歷史欠稅");
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
    rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});
  }
});




test("Chrome：原版優惠券獎車實際兌換→手機背包可辨識→公路選車出發",{
  timeout:180000
},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-coupon-road-"));
  const dataDir=join(workspace,"sqlite");
  let web=null,chrome=null;
  try{
    web=await startWeb(dataDir);
    chrome=await openChrome(join(workspace,"chrome-profile"));
    await chrome.send("Page.enable");
    await chrome.send("Runtime.enable");
    await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#create')?.hidden","新角色建立畫面");
    await evaluate(chrome,"window.confirm=()=>true");
    await fill(chrome,'#create-form [name="name"]',"Chrome券獎交通居民");
    await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","角色已建立");
    await click(chrome,"#solo-starter-create");
    await until(chrome,"document.querySelector('#solo-starter-town')?.hidden===true",
      "原版優惠券兌換所所在的 Web 試玩街區已建立");
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const id=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("Chrome券獎交通居民").user_id;
      // 臨時 SQLite 給 26 點測試用事件券：1點普通獎＋25點車，不改正式取得方式。
      db.prepare([
        "INSERT INTO character_coupons(user_id,quantity) VALUES(?,26)",
        "ON CONFLICT(user_id) DO UPDATE SET quantity=excluded.quantity"
      ].join(" ")).run(id);
    }finally{db.close();}
    await click(chrome,"#refresh");
    await click(chrome,"#facility-tab-events");
    await until(chrome,"document.querySelectorAll('#coupon-rewards .training-tile').length===30",
      "真正 30 款原版優惠券兌換選項");
    const prizes=[
      ["福引券",1],["ポルシェ",9]
    ];
    for(const [name,nth] of prizes){
      const selector="#coupon-rewards .training-tile:nth-child("+nth+")";
      assert.match(await evaluate(chrome,
        "document.querySelector("+JSON.stringify(selector)+")?.textContent"),new RegExp(name));
      await click(chrome,selector+" button");
      await until(chrome,"document.querySelector('#result-dialog')?.open && "+
        "document.querySelector('#result-dialog-message')?.textContent?.includes('已扣除')",
        "真正點擊 UI 完成兌換 "+name);
    }
    const before=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "return {money:s.character.money,bank:s.character.bank,coupons:s.couponBalance,"+
      "vehicle:s.roadTravel.choices.find(x=>x.name==='ポルシェ'),"+
      "other:s.legacyInventory.find(x=>x.name==='福引券')}})()");
    assert.equal(before.coupons,0);
    assert.equal(before.vehicle.origin,"coupon");
    assert.equal(before.vehicle.seconds,3);
    assert.ok(before.other);
    const line=before.vehicle.sourceLine;
    await viewport(chrome,375,812);
    await click(chrome,"#profile-tab-inventory");
    const vehicleSelector='#legacy-inventory-list .inventory-item[data-source-line="'+line+'"]';
    await until(chrome,"document.querySelector("+JSON.stringify(vehicleSelector)+")!==null",
      "375px 真實背包顯示本人的券獎保時捷");
    assert.match(await evaluate(chrome,
      "document.querySelector("+JSON.stringify(vehicleSelector)+")?.textContent"),
      /可用於公路旅行/);
    const otherSelector='#legacy-inventory-list .inventory-item[data-source-line="'+before.other.sourceLine+'"]';
    assert.equal(await evaluate(chrome,
      "document.querySelector("+JSON.stringify(otherSelector+" .inventory-road-link")+")===null"),
      true,"非載具福引券不可誤顯示公路捷徑");
    await click(chrome,vehicleSelector+" .inventory-road-link");
    assert.equal(await evaluate(chrome,"document.activeElement?.id"),"road-travel-panel");
    assert.equal(await evaluate(chrome,"document.querySelector('#road-travel-vehicle')?.value"),String(line));
    assert.equal(await evaluate(chrome,"document.querySelector('#road-travel-start')?.disabled"),false);
    const preview=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "return {money:s.character.money,bank:s.character.bank,coupons:s.couponBalance,"+
      "remaining:s.roadTravel.choices.find(x=>x.sourceLine==="+line+")?.remaining,"+
      "pending:s.roadTravel.pending}})()");
    assert.deepEqual(preview,{money:before.money,bank:before.bank,coupons:0,
      remaining:before.vehicle.remaining,pending:null},
      "背包選車只帶路，不再扣券、現金或車輛耐久");
    await click(chrome,"#road-travel-start");
    await until(chrome,"document.querySelector('#road-travel-status')?.textContent?.includes('公路旅程進行中')",
      "原版優惠券獎車經真正公路出發按鈕開始旅程");
    const trip=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "return {pending:s.roadTravel.pending,money:s.character.money,coupons:s.couponBalance}})()");
    assert.equal(trip.pending.vehicleSourceLine,line);
    assert.equal(trip.money,before.money);
    assert.equal(trip.coupons,0);
  }finally{
    await chrome?.stop();
    await web?.stop();
    rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});
  }
});

test("Chrome：單機百貨ギフト類ベスパ→背包辨識公路用途→選車出發",{
  timeout:180000
},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-gift-road-"));
  const dataDir=join(workspace,"sqlite");
  let web=null,chrome=null;
  try{
    web=await startWeb(dataDir);
    chrome=await openChrome(join(workspace,"chrome-profile"));
    await chrome.send("Page.enable");
    await chrome.send("Runtime.enable");
    await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#create')?.hidden","開始單機建角");
    await evaluate(chrome,"window.confirm=()=>true");
    await fill(chrome,'#create-form [name="name"]',"Chrome禮品載具居民");
    await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","單機角色建立完成");
    await click(chrome,"#solo-starter-create");
    await until(chrome,"document.querySelector('#solo-starter-town')?.hidden===true","Web 試玩街區已建立");
    const catalog=parseLegacyRetailCatalog(decodeLegacyText(
      readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))));
    const vespa=catalog.find(x=>x.originalLine===396);
    assert.ok(vespa);
    assert.equal(vespa.name,"ベスパ");
    assert.equal(vespa.category,"ギフト");
    assert.equal(vespa.effect,"無");
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      // 僅在 Chrome 臨時資料庫固定合法來源商品上架，不改正式隨機貨架。
      const listed=db.prepare("SELECT sku,position FROM retail_stock WHERE shop='depart1' ORDER BY position").all();
      assert.equal(listed.length,110);
      if(!listed.some(x=>x.sku===vespa.sku)){
        const slot=listed.find(x=>x.sku!==vespa.sku);assert.ok(slot);
        db.prepare("UPDATE retail_stock SET sku=?,remaining=5 WHERE shop='depart1' AND position=?")
          .run(vespa.sku,slot.position);
      }else db.prepare("UPDATE retail_stock SET remaining=5 WHERE shop='depart1' AND sku=?")
        .run(vespa.sku);
      db.prepare("UPDATE characters SET money=5000000 WHERE name='Chrome禮品載具居民'").run();
    }finally{db.close();}
    await click(chrome,"#refresh");
    await click(chrome,"#facility-tab-shops");
    await until(chrome,"document.querySelector('#retail-items input[value="+JSON.stringify(vespa.sku)+"]')!==null",
      "真正百貨上架原版禮品類ベスパ");
    await click(chrome,'#retail-items input[type="radio"][value='+JSON.stringify(vespa.sku)+']');
    await click(chrome,"#retail-items .shop-checkout button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('已購入')",
      "玩家使用百貨畫面購入ベスパ");
    const before=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "return {money:s.character.money,bank:s.character.bank,lines:s.roadTravel.choices.filter(x=>x.name==='ベスパ'),pending:s.roadTravel.pending}})()");
    assert.equal(before.lines.length,1);
    assert.equal(before.lines[0].origin,"retail");
    assert.equal(before.lines[0].category,"ギフト");
    assert.equal(before.pending,null);
    const line=before.lines[0].sourceLine;
    await viewport(chrome,375,812);
    await click(chrome,"#profile-tab-inventory");
    await until(chrome,"document.querySelector('#legacy-inventory-list details.inventory-secondary')!==null",
      "可展開的禮品與公路載具分類");
    await click(chrome,"#legacy-inventory-list details.inventory-secondary > summary");
    const selector='#legacy-inventory-list .inventory-gift-row[data-source-line="'+line+'"]';
    assert.match(await evaluate(chrome,
      "document.querySelector("+JSON.stringify(selector)+")?.textContent"),/可用於公路旅行/);
    const goto=selector+" button";
    await click(chrome,goto);
    assert.equal(await evaluate(chrome,"document.activeElement?.id"),"road-travel-panel");
    assert.equal(await evaluate(chrome,"document.querySelector('#road-travel-vehicle')?.value"),String(line));
    assert.equal(await evaluate(chrome,"document.querySelector('#road-travel-start')?.disabled"),false);
    const still=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "return {money:s.character.money,bank:s.character.bank,remaining:s.roadTravel.choices.find(x=>x.sourceLine==="+line+")?.remaining,pending:s.roadTravel.pending}})()");
    assert.deepEqual(still,{money:before.money,bank:before.bank,
      remaining:before.lines[0].remaining,pending:null},
      "背包跳轉與選車不可以直接扣現金或載具耐久");
    await click(chrome,"#road-travel-start");
    await until(chrome,"document.querySelector('#road-travel-status')?.textContent?.includes('公路旅程進行中')",
      "玩家從背包選擇的禮品類載具已成功出發");
    const after=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();"+
      "return {pending:s.roadTravel.pending,money:s.character.money}})()");
    assert.equal(after.pending.vehicleSourceLine,line);
    assert.equal(after.money,before.money,"使用自己持有的原版載具不額外扣現金");
  }finally{
    await chrome?.stop();
    await web?.stop();
    rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});
  }
});

test("Chrome：健身房減重→真實百貨寵物／信用卡→背包使用／分類收合→信用付款→跨重啟與手機視埠",{
  timeout:240000
},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-recent-"));
  const dataDir=join(workspace,"sqlite");
  let web=null,chrome=null;
  try{
    web=await startWeb(dataDir);
    chrome=await openChrome(join(workspace,"chrome-profile"));
    await chrome.send("Page.enable");
    await chrome.send("Runtime.enable");
    await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#create')?.hidden","顯示新角色建立頁");
    await evaluate(chrome,"window.confirm=()=>true");
    await fill(chrome,'#create-form [name="name"]',"Chrome近期驗收");
    await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","建立單機角色");
    await click(chrome,"#solo-starter-create");
    await until(chrome,"document.querySelector('#solo-starter-town')?.hidden===true","單機試玩街區已建立");

    // 先用真正的 Chrome 點擊健身房課程：不是直接 POST /api/train。
    const initial=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {character:s.character,lesson:s.trainingLessons.find(x=>x.key==='gym-3')}})()");
    assert.equal(initial.character.weight,60);
    assert.equal(initial.lesson.weightLoss,0.08);
    await click(chrome,"#facility-tab-training");
    await until(chrome,"document.querySelector('#gym-lessons .training-tile:nth-child(2) .small')?.textContent?.includes('Web 補完規則預計減重 0.08')","游泳以外的健走卡片提示 Web 減重");
    await click(chrome,"#gym-lessons .training-tile:nth-child(2) button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('體重減少 0.08')","健走完成減重結果");
    const afterGym=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {character:s.character,gymCooldownMs:s.gymCooldownMs}})()");
    assert.equal(afterGym.character.weight,59.92);
    assert.equal(afterGym.character.stats.kenkou,initial.character.stats.kenkou+3);
    assert.equal(afterGym.character.money,initial.character.money-800);
    assert.equal(afterGym.character.bodyEnergy,initial.character.bodyEnergy-8);
    assert.equal(afterGym.character.bmi,Math.round(59.92/((afterGym.character.height/100)**2)*10)/10);
    assert.ok(afterGym.gymCooldownMs>0);
    await click(chrome,"#profile-tab-status");
    assert.match(await evaluate(chrome,"document.querySelector('#measurements')?.textContent"),/59\.92/);
    assert.equal(await evaluate(chrome,"document.querySelector('#gym-lessons .training-tile:nth-child(2) button')?.disabled"),true);

    // 只改獨立測試的 SQLite 貨架；正式遊戲仍由原版貨架每日隨機抽選。
    const catalog=parseLegacyRetailCatalog(decodeLegacyText(
      readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))));
    const selected=["ガチャピン","スペシャルクレジットカード"].map(name=>{
      const item=catalog.find(x=>x.name===name);
      assert.ok(item,"原版商品必須存在："+name);
      return item;
    });
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const listed=db.prepare("SELECT sku,position FROM retail_stock WHERE shop='depart1'").all();
      assert.equal(listed.length,110);
      const targets=new Set(selected.map(item=>item.sku));
      const available=new Set(listed.map(item=>item.sku));
      const slots=listed.filter(item=>!targets.has(item.sku));
      for(const item of selected){
        if(!available.has(item.sku)){
          const slot=slots.shift();assert.ok(slot);
          db.prepare("UPDATE retail_stock SET sku=?,remaining=5 WHERE shop='depart1' AND position=?").run(item.sku,slot.position);
        }else db.prepare("UPDATE retail_stock SET remaining=5 WHERE shop='depart1' AND sku=?").run(item.sku);
      }
      db.prepare("UPDATE characters SET money=5000000,bank=3000000 WHERE name=?").run("Chrome近期驗收");
    }finally{db.close();}
    // 使用 UI 的「更新狀態」讓後端重新載入新的測試貨架。
    await click(chrome,"#refresh");
    const petSku=selected[0].sku,cardSku=selected[1].sku;
    await until(chrome,"document.querySelector('#retail-items input[value="+JSON.stringify(petSku)+"]')!==null && document.querySelector('#retail-items input[value="+JSON.stringify(cardSku)+"]')!==null","測試貨架已呈現寵物與信用卡");
    await click(chrome,"#facility-tab-shops");
    await click(chrome,'#retail-items input[type="radio"][value='+JSON.stringify(petSku)+']');
    await click(chrome,"#retail-items .shop-checkout button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('已購入')","玩家點擊購買寵物完成");

    await click(chrome,"#profile-tab-inventory");
    await until(chrome,"document.querySelector('#inventory-general-usage')?.textContent?.trim()==='1 / 25 格'","背包的一般物品顯示 1／25 格");
    const petLine=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return s.legacyInventory.find(x=>x.name==='ガチャピン')?.sourceLine})()");
    assert.ok(Number.isSafeInteger(petLine));
    const petSelector='#legacy-inventory-list .inventory-item[data-source-line="'+petLine+'"]';
    await until(chrome,"document.querySelector("+JSON.stringify(petSelector+" .inventory-item-controls button")+")?.disabled===false","加查賓背包使用按鈕可點");
    await click(chrome,petSelector+" .inventory-item-controls button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('已使用')","玩家點擊使用寵物完成");
    const afterPet=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {stats:s.character.stats,item:s.legacyItemActions.find(x=>x.sourceLine==="+petLine+")}})()");
    assert.equal(afterPet.stats.love,initial.character.stats.love+15);
    assert.equal(afterPet.stats.unique,initial.character.stats.unique+15);
    assert.equal(afterPet.stats.etti,initial.character.stats.etti+15);
    assert.equal(afterPet.item.remaining,3,"原版日制寵物使用後不扣有效天數");
    assert.equal(afterPet.item.canUse,false,"原版 120 分鐘冷卻仍存在");
    assert.equal(await evaluate(chrome,"document.querySelector("+JSON.stringify(petSelector+" .inventory-item-controls button")+")?.disabled"),true);

    await click(chrome,"#facility-tab-shops");
    await click(chrome,'#retail-items input[type="radio"][value='+JSON.stringify(cardSku)+']');
    await click(chrome,"#retail-items .shop-checkout button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('已購入')","玩家點擊購買信用卡完成");
    await click(chrome,"#profile-tab-inventory");
    await until(chrome,"document.querySelector('#inventory-general-usage')?.textContent?.trim()==='2 / 25 格'","背包容量 2／25 格");
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#legacy-inventory-list .inventory-category').length"),2,
      "寵物與日用品應分為兩個背包分類");
    const categories="#legacy-inventory-list details.inventory-category";
    await click(chrome,categories+" > summary");
    await until(chrome,"document.querySelector("+JSON.stringify(categories)+")?.open===false","分類可由滑鼠收合");
    await click(chrome,"#profile-tab-status");
    await click(chrome,"#refresh");
    await click(chrome,"#profile-tab-inventory");
    assert.equal(await evaluate(chrome,"document.querySelector("+JSON.stringify(categories)+")?.open"),false,
      "收合選擇應跨畫面同步保留");
    await click(chrome,categories+" > summary");
    await until(chrome,"document.querySelector("+JSON.stringify(categories)+")?.open===true","分類可再次展開");

    const cardLine=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return s.legacyInventory.find(x=>x.name==='スペシャルクレジットカード')?.sourceLine})()");
    assert.ok(Number.isSafeInteger(cardLine));
    const cardSelector='#legacy-inventory-list .inventory-item[data-source-line="'+cardLine+'"]';
    await click(chrome,cardSelector+" .inventory-item-controls button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('已使用')","使用特殊信用卡後能力生效");
    const afterCard=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {stats:s.character.stats,bank:s.character.bank,money:s.character.money,card:s.classroomCreditCards.find(x=>x.sourceLine==="+cardLine+")}})()");
    assert.equal(afterCard.stats.kokugo,initial.character.stats.kokugo+1);
    assert.equal(afterCard.stats.love,initial.character.stats.love+16);
    assert.ok(afterCard.card,"背包使用不應讓信用卡支付資格失效");

    // 使用真實百貨 UI 的「信用卡」付款選單，核對只扣普通存款。
    const affordable=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return s.retailGoods.find(x=>x.shop==='depart1'&&x.stock>0&&x.price>0&&x.price<=10000&&x.sku!=="+JSON.stringify(petSku)+"&&x.sku!=="+JSON.stringify(cardSku)+")?.sku||null})()");
    assert.ok(affordable,"原版百貨貨架應有可用信用卡購買的平價商品");
    await click(chrome,"#facility-tab-shops");
    await click(chrome,'#retail-items input[type="radio"][value='+JSON.stringify(affordable)+']');
    const select="#retail-items .shop-checkout select[aria-label$='付款方式']";
    const chosen=await evaluate(chrome,"(function(){const el=document.querySelector("+JSON.stringify(select)+");if(!el)return false;el.value='card:"+cardLine+"';el.dispatchEvent(new Event('change',{bubbles:true}));return el.value==='card:"+cardLine+"';})()");
    assert.equal(chosen,true,"信用卡仍列於真實百貨付款方式");
    await click(chrome,"#retail-items .shop-checkout button");
    await until(chrome,"document.querySelector('#result-dialog')?.open && document.querySelector('#result-dialog-message')?.textContent?.includes('普通存款支付')","信用卡付款成功提示");
    const afterPayment=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {bank:s.character.bank,money:s.character.money,stats:s.character.stats,purchases:s.retailPurchases.length,weight:s.character.weight,bmi:s.character.bmi}})()");
    assert.ok(afterPayment.bank<afterCard.bank);
    assert.equal(afterPayment.money,afterCard.money);
    assert.equal(afterPayment.stats.kokugo,afterCard.stats.kokugo,"信用卡結帳本身不增加能力");
    assert.equal(afterPayment.weight,59.92);

    // 375／768px 用同一份持久角色資料，檢查背包容量、分類與可點擊狀態。
    for(const width of [768,375]){
      await viewport(chrome,width,width===375?812:1024);
      await click(chrome,"#profile-tab-inventory");
      assert.match(await evaluate(chrome,"document.querySelector('#inventory-general-usage')?.textContent"),/\/ 25 格/);
      assert.ok(await evaluate(chrome,"document.querySelectorAll('#legacy-inventory-list .inventory-category').length>=2"));
      await click(chrome,"#legacy-inventory-list .inventory-category > summary");
      await click(chrome,"#legacy-inventory-list .inventory-category > summary");
      await click(chrome,"#profile-tab-status");
      assert.match(await evaluate(chrome,"document.querySelector('#measurements')?.textContent"),/59\.92/);
    }

    // Node 伺服器重啟：真正用瀏覽器重新導航，核對 UI 與後端持久資料。
    await web.stop();
    web=await startWeb(dataDir);
    await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"Boolean(document.querySelector('#game')&&!document.querySelector('#game').hidden)||Boolean(document.querySelector('#solo-lobby')&&!document.querySelector('#solo-lobby').hidden)","重啟後已找到原角色");
    const lobby=await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden");
    if(lobby)await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","重啟後繼續既有單機角色");
    await click(chrome,"#profile-tab-status");
    assert.match(await evaluate(chrome,"document.querySelector('#measurements')?.textContent"),/59\.92/);
    const resumed=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {bank:s.character.bank,money:s.character.money,stats:s.character.stats,weight:s.character.weight,bmi:s.character.bmi,purchases:s.retailPurchases.length,pet:s.legacyItemActions.find(x=>x.sourceLine==="+petLine+"),card:s.classroomCreditCards.find(x=>x.sourceLine==="+cardLine+")}})()");
    assert.equal(resumed.weight,afterPayment.weight);
    assert.equal(resumed.bmi,afterPayment.bmi);
    assert.equal(resumed.bank,afterPayment.bank);
    assert.equal(resumed.money,afterPayment.money);
    assert.equal(resumed.stats.love,afterPayment.stats.love);
    assert.equal(resumed.stats.kokugo,afterPayment.stats.kokugo);
    assert.equal(resumed.purchases,afterPayment.purchases);
    assert.ok(resumed.pet&&resumed.card,"重啟後仍持有原寵物及信用卡");
  }finally{
    await chrome?.stop();
    await web?.stop();
    rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});
  }
});

test("Chrome 多人街頭格鬥：真實按鈕送出戰鬥、展開戰報、手機視窗",{
  timeout:90000
},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-street-"));
  let web=null,chrome=null;
  try{
    web=await startWeb(join(workspace,"sqlite"),"multi");
    chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");
    await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"Boolean(document.querySelector('#auth'))","登入頁");
    const seeded=await evaluate(chrome,`(async()=>{
      const post=(path,data)=>fetch("/api/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      const stats=Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","love","unique","etti"].map(k=>[k,20]));
      const results=[];
      for(const [username,name] of [["chrome_street_a","格鬥居民甲"],["chrome_street_b","格鬥居民乙"]]){
        results.push((await post("register",{username,password:"chrome-street-pass"})).status);
        results.push((await post("character",{name,gender:"male",stats})).status);
      }
      return results;
    })()`);
    assert.deepEqual(seeded,[200,200,200,200]);
    const setCash=amount=>{
      const db=new DatabaseSync(join(workspace,"sqlite","multi.sqlite"));
      try{db.prepare("UPDATE characters SET money=?,bank=1000000 WHERE name=?").run(amount,"格鬥居民乙");}
      finally{db.close();}
    };
    setCash(14999);
    await chrome.send("Page.reload");
    await until(chrome,"!document.querySelector('#game')?.hidden && document.querySelector('#street-fight-status')?.textContent?.includes('參戰現金不足')","低於門檻顯示原因");
    assert.equal(await evaluate(chrome,"document.querySelector('#street-fight-play').disabled"),true);
    assert.match(await evaluate(chrome,"document.querySelector('#street-fight-status').textContent"),/15,000/);
    assert.match(await evaluate(chrome,"document.querySelector('#street-fight-panel').textContent"),/不是固定入場費/);
    setCash(15000);
    await chrome.send("Page.reload");
    await until(chrome,"!document.querySelector('#game')?.hidden && document.querySelector('#street-fight-play')?.disabled===false","恰好 15,000 元格鬥入口可使用");
    await evaluate(chrome,"window.confirm=()=>true");
    await click(chrome,"#street-fight-play");
    await until(chrome,"document.querySelector('#street-fight-history summary')?.textContent?.includes('平手')","顯示實際格鬥結果");
    await click(chrome,"#street-fight-history summary");
    await until(chrome,"document.querySelector('#street-fight-history details')?.open===true","戰報可展開");
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details ol li').length"),50);
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details dl dt').length"),17);
    await viewport(chrome,375,812);
    assert.ok(await evaluate(chrome,"document.querySelector('#street-fight-status')?.textContent?.length>0"));
    const saved=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return s.streetFight.history.length})()");
    assert.equal(saved,1);
  }finally{
    await chrome?.stop();await web?.stop();
    rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});
  }
});
