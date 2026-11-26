// 實際 Chrome CDP 瀏覽器操作；不使用 jsdom／假 DOM，亦不宣稱真人手動驗收。
// 此測試只讀原版 CGI 商品來源，資料寫在作業系統暫存 DATA_DIR。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { settleDailyIllnessEvent } from "../src/events.mjs";
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
// Chrome chooses and owns its debugging port; no release-and-rebind race.
// Retry only startup, never a game action, UI assertion, or completed transaction.
async function stopChromeProcess(child){
  if(child.exitCode!==null||child.signalCode!==null||!child.pid)return;
  const done=new Promise(ok=>child.once("exit",ok));
  const signal=s=>{
    if(process.platform!=="win32"){
      try{process.kill(-child.pid,s);}catch{child.kill(s);}
    }else child.kill(s);
  };
  signal("SIGTERM");
  await Promise.race([done,pause(2500)]);
  if(child.exitCode===null&&child.signalCode===null){
    signal("SIGKILL");await Promise.race([done,pause(2500)]);
  }
}
async function openChrome(browserDataDir){
  const command=chromeExecutable();
  const diagnostics=[];
  for(let attempt=1;attempt<=2;attempt++){
    const profile=browserDataDir+"-attempt-"+attempt;
    const child=spawn(command,[
      "--headless=new","--no-sandbox","--disable-dev-shm-usage",
      "--disable-gpu","--no-first-run","--no-default-browser-check",
      "--remote-allow-origins=*","--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--user-data-dir="+profile,"about:blank"
    ],{stdio:["ignore","ignore","pipe"],detached:process.platform!=="win32"});
    let stderr="",spawnError=null,ws=null,lastError="";
    child.stderr.on("data",x=>{stderr=(stderr+x).slice(-8000);});
    child.on("error",e=>{spawnError=e;});
    try{
      const deadline=Date.now()+18000;
      let socketUrl=null;
      while(Date.now()<deadline){
        if(spawnError||child.exitCode!==null||child.signalCode!==null)break;
        try{
          const port=Number(readFileSync(join(profile,"DevToolsActivePort"),"utf8").split(/\r?\n/)[0]);
          if(!Number.isInteger(port)||port<1||port>65535)throw Error("DevTools port 尚未寫入");
          const response=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(400)});
          if(!response.ok)throw Error("DevTools HTTP "+response.status);
          const entries=await response.json();
          socketUrl=entries.find(x=>x.type==="page")?.webSocketDebuggerUrl;
          if(socketUrl)break;
          lastError="DevTools page 尚未建立";
        }catch(e){lastError=e.message;}
        await pause(100);
      }
      if(!socketUrl)throw Error("Chrome DevTools 協定頁面無法開啟："+(spawnError?.message??lastError));
      ws=new WebSocket(socketUrl);
      await new Promise((ok,fail)=>{
        const timer=setTimeout(()=>fail(Error("Chrome WebSocket 啟動逾時")),4000);
        ws.addEventListener("open",()=>{clearTimeout(timer);ok();},{once:true});
        ws.addEventListener("error",()=>{clearTimeout(timer);fail(Error("Chrome WebSocket 啟動失敗"));},{once:true});
      });
      let lastId=0;
      const pending=new Map();
      const rejectPending=message=>{
        for(const slot of pending.values()){clearTimeout(slot.timer);slot.fail(Error(message));}
        pending.clear();
      };
      ws.addEventListener("close",()=>rejectPending("Chrome CDP 連線中斷"));
      ws.addEventListener("message",event=>{
        const message=JSON.parse(event.data);
        if(!message.id)return;
        const slot=pending.get(message.id);
        if(!slot)return;
        pending.delete(message.id);clearTimeout(slot.timer);
        if(message.error)slot.fail(Error(JSON.stringify(message.error)));
        else slot.ok(message.result??{});
      });
      const send=(method,params={})=>new Promise((ok,fail)=>{
        if(ws.readyState!==WebSocket.OPEN){fail(Error("Chrome CDP 未連線："+method));return;}
        const id=++lastId;
        const timer=setTimeout(()=>{pending.delete(id);fail(Error("Chrome CDP 指令逾時："+method));},15000);
        pending.set(id,{ok,fail,timer});
        try{ws.send(JSON.stringify({id,method,params}));}
        catch(e){pending.delete(id);clearTimeout(timer);fail(e);}
      });
      if(attempt>1)console.log("Chrome startup recovered on attempt "+attempt);
      return {send,async stop(){rejectPending("Chrome 已關閉");ws.close();await stopChromeProcess(child);await pause(500);}};
    }catch(e){
      if(ws&&ws.readyState!==WebSocket.CLOSED)ws.close();
      await stopChromeProcess(child);
      const detail="attempt "+attempt+"｜"+e.message+"｜exit="+child.exitCode+"｜signal="+child.signalCode+"｜stderr="+stderr;
      diagnostics.push(detail);console.log("Chrome startup diagnostic: "+detail);
    }
  }
  throw Error("Chrome 啟動兩次皆失敗（不跳過測試）\n"+diagnostics.join("\n"));
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
// The real server commits before the test simulates a lost response. Record the
// actual UI-generated request payloads; do not synthesize a replay through HTTP.
async function loseBattleResponse(cdp,path){
  await evaluate(cdp,`(()=>{const real=window.fetch.bind(window);
    window.hRetry={lost:false,requests:[]};
    window.fetch=async(input,init)=>{
      const matches=String(input)===${JSON.stringify("/api/"+path)};
      if(matches)window.hRetry.requests.push(JSON.parse(init.body));
      const response=await real(input,init);
      if(matches&&response.ok&&!window.hRetry.lost){window.hRetry.lost=true;throw Error("H測試：交易已完成但回應遺失");}
      return response;
    };return true;})()`);
}
async function verifyBattleRetry(cdp){
  const record=await evaluate(cdp,"window.hRetry");
  assert.equal(record.lost,true);assert.equal(record.requests.length,2);
  assert.ok(record.requests[0].requestId);
  assert.deepEqual(record.requests[1],record.requests[0],"UI 重試必須沿用同一請求及參數");
}
async function browserBattleState(cdp,kind){
  return evaluate(cdp,`(async()=>{const s=await(await fetch('/api/state')).json();
    return {name:s.character.name,money:s.character.money,bank:s.character.bank,kpoint:s.character.kpoint,coupons:s.couponBalance,history:s[${JSON.stringify(kind)}].history};})()`);
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
async function assertResidentEnergyBars(chrome){
  const readings=await evaluate(chrome,`["body","brain"].map(kind=>{
    const number=document.querySelector("#"+kind+"-energy");
    const bar=document.querySelector("#"+kind+"-energy-bar");
    const compact=document.querySelector("#compact-"+kind+"-bar");
    const [current,max]=number.textContent.split("/").map(Number);
    const rect=bar.getBoundingClientRect(),row=number.closest("div").getBoundingClientRect();
    return {kind,current,max,value:bar.value,compact:compact.value,width:rect.width,height:rect.height,
      fits:rect.left>=row.left-1&&rect.right<=row.right+1};
  })`);
  for(const r of readings){
    assert.ok(Number.isFinite(r.current)&&r.max>0,r.kind+" 能量數字與上限");
    assert.equal(r.value,Math.max(0,Math.min(100,r.current/r.max*100)));
    assert.equal(r.value,r.compact,r.kind+" 居民與固定能量條同步");
    assert.ok(r.width>0&&r.height>0&&r.fits,r.kind+" 能量條可見且不超出居民列");
  }
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
    await assertResidentEnergyBars(chrome);
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
      await assertResidentEnergyBars(chrome);
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
    // 原始鍵仍經 API 驗證，僅 UI 比對改為已確認的繁中顯示。
    const prizes=[
      ["福引券","抽獎券",1],["ポルシェ","保時捷",9]
    ];
    for(const [name,displayName,nth] of prizes){
      const selector="#coupon-rewards .training-tile:nth-child("+nth+")";
      assert.match(await evaluate(chrome,
        "document.querySelector("+JSON.stringify(selector)+")?.textContent"),new RegExp(displayName));
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
    const vehicleText=await evaluate(chrome,
      "document.querySelector("+JSON.stringify(vehicleSelector)+")?.textContent");
    assert.match(vehicleText,/保時捷/);
    assert.match(vehicleText,/可用於公路旅行/);
    const otherSelector='#legacy-inventory-list .inventory-item[data-source-line="'+before.other.sourceLine+'"]';
    assert.match(await evaluate(chrome,
      "document.querySelector("+JSON.stringify(otherSelector)+")?.textContent"),/抽獎券/);
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
    await click(chrome,"#home-street-fight");
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-battle').hidden"),false);
    assert.equal(await evaluate(chrome,"document.querySelector('#map-editor').hidden"),true);
    assert.equal(await evaluate(chrome,"document.querySelector('#street-fight-play').disabled"),true);
    assert.match(await evaluate(chrome,"document.querySelector('#street-fight-status').textContent"),/15,000/);
    assert.match(await evaluate(chrome,"document.querySelector('#street-fight-panel').textContent"),/不是固定入場費/);
    setCash(15000);
    await chrome.send("Page.reload");
    await until(chrome,"!document.querySelector('#game')?.hidden && document.querySelector('#street-fight-play')?.disabled===false","恰好 15,000 元格鬥入口可使用");
    await click(chrome,"#home-street-fight");
    await evaluate(chrome,"window.confirm=()=>true");
    await loseBattleResponse(chrome,"street-fight/play");
    await click(chrome,"#street-fight-play");
    await until(chrome,"window.hRetry.lost && !document.querySelector('#street-fight-play').disabled","街頭已提交，失去回應後可重試");
    const streetCommitted=await browserBattleState(chrome,"streetFight");
    assert.equal(streetCommitted.history.length,1);
    await click(chrome,"#street-fight-play");
    await until(chrome,"document.querySelector('#street-fight-history summary')?.textContent?.includes('平手')","顯示實際格鬥結果");
    await verifyBattleRetry(chrome);
    assert.deepEqual(await browserBattleState(chrome,"streetFight"),streetCommitted);
    await click(chrome,"#street-fight-history summary");
    await until(chrome,"document.querySelector('#street-fight-history details')?.open===true","戰報可展開");
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details ol li').length"),50);
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details dl dt').length"),17);
    for(const width of [1440,768,375]){
      await viewport(chrome,width,width===375?812:width===768?1024:900);
      assert.ok(await evaluate(chrome,"document.querySelector('#street-fight-status')?.textContent?.length>0"));
      if(await evaluate(chrome,"document.querySelector('#street-fight-history details')?.open"))await click(chrome,"#street-fight-history summary");
      await click(chrome,"#street-fight-history summary");
      await until(chrome,"document.querySelector('#street-fight-history details')?.open===true","街頭 "+width+"px 戰報");
      assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details ol li').length"),50);
      assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details dl dt').length"),17);
    }
    const saved=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return s.streetFight.history.length})()");
    assert.equal(saved,1);
    await web.stop();web=await startWeb(join(workspace,"sqlite"),"multi");
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#game')?.hidden&&document.querySelector('#character-name')?.textContent==='格鬥居民乙'","多人重啟保留登入與本人資料");
    assert.deepEqual(await browserBattleState(chrome,"streetFight"),streetCommitted);
    await click(chrome,"#logout");
    await until(chrome,"!document.querySelector('#auth')?.hidden","真正登出");
    await fill(chrome,'#login-form [name="username"]',"chrome_street_a");
    await fill(chrome,'#login-form [name="password"]',"chrome-street-pass");
    await click(chrome,"#login-form button[type=submit]");
    await until(chrome,"!document.querySelector('#game')?.hidden&&document.querySelector('#character-name')?.textContent==='格鬥居民甲'","另一帳號實際登入");
    const other=await browserBattleState(chrome,"streetFight");
    assert.equal(other.history.length,0);
    assert.equal(other.money,100000);
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#street-fight-history details').length"),0);
    console.log("H_STREET "+JSON.stringify({retry:true,restart:true,otherHistory:other.history.length,widths:[1440,768,375]}));
  }finally{
    await chrome?.stop();await web?.stop();
    rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});
  }
});

test("Chrome C 聯賽：實際培育、模仿者比賽、戰報與手機視窗",{timeout:90000},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-c-league-"));let web=null,chrome=null;
  try{
    web=await startWeb(join(workspace,"sqlite"));chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});await until(chrome,"!document.querySelector('#create')?.hidden","建角入口");
    await evaluate(chrome,"window.confirm=()=>true");await fill(chrome,'#create-form [name="name"]',"聯賽測試居民");await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","主畫面");
    await click(chrome,"#home-c-league");
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-battle').hidden"),false);
    await click(chrome,"#c-league-open");await until(chrome,"document.querySelector('#c-league-result')?.textContent?.includes('已進入第 1 季')","明確進入聯賽");
    await click(chrome,"#c-league-training summary");
    // The actual form submits an empty name; verify server rejection leaves no fighter or cash change.
    const beforeInvalid=await browserBattleState(chrome,"cLeague");
    await fill(chrome,"#c-league-name","");
    await evaluate(chrome,`(()=>{const real=window.fetch.bind(window);window.hInvalid=null;
      window.fetch=async(input,init)=>{const response=await real(input,init);
        if(String(input)==="/api/c-league/train")window.hInvalid={status:response.status,body:await response.clone().json()};
        return response;
      };return true;})()`);
    await click(chrome,"#c-league-train");
    await until(chrome,"window.hInvalid?.status===400&&!document.querySelector('#c-league-train').disabled","無效名稱由正式後端拒絕");
    assert.match(await evaluate(chrome,"window.hInvalid.body.error"),/名稱/);
    assert.deepEqual(await browserBattleState(chrome,"cLeague"),beforeInvalid);
    assert.equal(await evaluate(chrome,"(async()=>Boolean((await(await fetch('/api/state')).json()).cLeague.character))()"),false);
    await fill(chrome,"#c-league-name","模仿測試");await fill(chrome,'#c-league-fields input[data-stat="kenkou"]',1);
    await click(chrome,"#c-league-train");await until(chrome,"document.querySelector('#c-league-result')?.textContent?.includes('培育已儲存')","實際培育完成");
    await until(chrome,"document.querySelector('#c-league-play')?.disabled===false","比賽可用");
    await loseBattleResponse(chrome,"c-league/play");
    await click(chrome,"#c-league-play");
    await until(chrome,"window.hRetry.lost&&!document.querySelector('#c-league-play').disabled","C聯賽已提交但回應遺失");
    const cCommitted=await browserBattleState(chrome,"cLeague");assert.equal(cCommitted.history.length,1);
    await click(chrome,"#c-league-play");
    await until(chrome,"document.querySelector('#c-league-history summary')?.textContent?.includes('模仿者')","模仿者戰報");
    await verifyBattleRetry(chrome);
    assert.deepEqual(await browserBattleState(chrome,"cLeague"),cCommitted);
    assert.equal(await evaluate(chrome,"document.querySelector('#c-league-play').disabled"),true);
    const saved=await evaluate(chrome,"(async()=>{const s=await(await fetch('/api/state')).json();return {n:s.cLeague.history.length,kenkou:s.cLeague.character.stats.kenkou,mimic:s.cLeague.history[0].mimic}})()");
    assert.deepEqual(saved,{n:1,kenkou:1,mimic:true});
    assert.match(await evaluate(chrome,"document.querySelector('#c-league-result').textContent"),/勝利.*100/);
    assert.match(await evaluate(chrome,"document.querySelector('#c-league-panel').textContent"),/零能量可參賽/);
    assert.match(await evaluate(chrome,"document.querySelector('#c-league-training').textContent"),/餘額不足拒絕/);
    for(const width of [1440,768,375]){
      await viewport(chrome,width,width===375?812:width===768?1024:900);
      assert.ok(await evaluate(chrome,"document.querySelector('#c-league-status').textContent.includes('1 / 100')"));
      if(!await evaluate(chrome,"document.querySelector('#c-league-history').parentElement.open"))await click(chrome,"#c-league-panel details:has(> #c-league-history) > summary");
      if(await evaluate(chrome,"document.querySelector('#c-league-history details')?.open"))await click(chrome,"#c-league-history summary");
      await click(chrome,"#c-league-history summary");
      await until(chrome,"document.querySelector('#c-league-history details')?.open===true","C聯賽 "+width+"px 戰報");
      assert.ok(await evaluate(chrome,"document.querySelectorAll('#c-league-history ol li').length>0"));
    }
    await web.stop();web=await startWeb(join(workspace,"sqlite"));
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","C重啟保留居民");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","C重啟主畫面");
    assert.deepEqual(await browserBattleState(chrome,"cLeague"),cCommitted);
    await click(chrome,"#home-c-league");
    assert.match(await evaluate(chrome,"document.querySelector('#c-league-history summary').textContent"),/模仿者/);
    console.log("H_C_LEAGUE "+JSON.stringify({retry:true,restart:true,invalidRejected:true,widths:[1440,768,375]}));
  }finally{await chrome?.stop();await web?.stop();rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});}
});

test("Chrome 戰鬥事件 #38：真實事件結算後的彈窗與375px背包",{timeout:90000},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-event38-"));let web=null,chrome=null;
  try{
    const dataDir=join(workspace,"sqlite");web=await startWeb(dataDir);chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});await until(chrome,"!document.querySelector('#create')?.hidden","建角入口");
    await evaluate(chrome,"window.confirm=()=>true");await fill(chrome,'#create-form [name="name"]',"戰鬥事件居民");await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","主畫面");
    const state=await evaluate(chrome,"(async()=>await(await fetch('/api/state')).json())()");
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const actor=db.prepare("SELECT user_id,stats_json,last_event_day FROM characters").get();
      db.prepare("UPDATE characters SET stats_json=?,last_event_day='2000-01-01' WHERE user_id=?").run(JSON.stringify({...JSON.parse(actor.stats_json),power:1000}),actor.user_id);
      const rolls=[0,(38-.5)/44,0,.55];settleDailyIllnessEvent(db,actor.user_id,actor.last_event_day,state.gameTimeMs,()=>rolls.shift());
    }finally{db.close();}
    await chrome.send("Page.reload");await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","重載角色");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#event-popup')?.hidden&&document.querySelector('#event-popup-body').textContent.includes('聖誕老人戰鬥')","原版戰鬥事件彈窗");
    const eventText=await evaluate(chrome,"document.querySelector('#event-popup-body').textContent");
    assert.equal(eventText,"聖誕老人戰鬥：擊敗聖誕老人，獲得真人大小聖誕老人玩偶，耐久增加 10 次。");
    assert.doesNotMatch(eventText,/[\u3040-\u30ff]/);
    await click(chrome,"#event-popup-close");
    for(const width of [1440,768,375]){
      await viewport(chrome,width,width===375?812:width===768?1024:900);
      await click(chrome,"#profile-tab-inventory");
      const inventoryText=await evaluate(chrome,"document.querySelector('#legacy-inventory-list').textContent");
      assert.match(inventoryText,/Web 聖誕老人戰鬥獎勵/);
      assert.match(inventoryText,/真人大小聖誕老人玩偶/);
    }
  }finally{await chrome?.stop();await web?.stop();rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});}
});

test("階段H Chrome B聯賽與大阪：1440/768/375真實地圖點擊、回應遺失重試、獎品耐久及重啟",{timeout:180000},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-b-osaka-"));
  const dataDir=join(workspace,"sqlite");
  let web=null,chrome=null;
  const state=()=>evaluate(chrome,"(async()=>await(await fetch('/api/state')).json())()");
  const savedReceipt=(table)=>{
    assert.ok(["b_league_battles","osaka_battles"].includes(table));
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{return db.prepare("SELECT request_id,result_json FROM "+table+" ORDER BY id").all().map(r=>({requestId:r.request_id,result:JSON.parse(r.result_json)}));}
    finally{db.close();}
  };
  const enter=async(cell,panel,pane)=>{
    const selector='#town-map button[aria-label^='+JSON.stringify(cell+"：")+']';
    for(let attempt=0;attempt<3;attempt++){
      await click(chrome,selector);
      const current=await evaluate(chrome,"({focus:document.activeElement?.id,pane:document.querySelector('#facility-pane-"+pane+"')?.hidden===false})");
      if(current.focus===panel&&current.pane)return;
    }
    assert.fail("真實地圖點擊未開啟 "+cell+" "+panel);
  };
  try{
    web=await startWeb(dataDir);
    // Test-only persisted clock, anchored before any character exists.
    const db0=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
      const get=type=>Number(parts.find(x=>x.type===type)?.value??0);
      const offset=(12*3600000-((get("hour")*60+get("minute"))*60+get("second"))*1000+86400000)%86400000;
      db0.prepare("UPDATE solo_clock SET offset_ms=? WHERE id=1").run(offset);
    }finally{db0.close();}
    chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");
    await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#create')?.hidden","建角入口");
    await evaluate(chrome,"window.confirm=()=>true");
    await fill(chrome,'#create-form [name="name"]',"Chrome聯合戰鬥");
    await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","建角完成");
    await click(chrome,"#facility-tab-shops");
    assert.equal(await evaluate(chrome,"Array.from(document.querySelectorAll('#b-league-ranks button')).every(b=>b.disabled)"),true);
    await click(chrome,"#facility-tab-games");
    assert.equal(await evaluate(chrome,"Array.from(document.querySelectorAll('#osaka-modes button')).every(b=>b.disabled)"),true);
    // Only fixture preparation uses HTTP/SQLite. All battle actions below use CDP mouse clicks.
    const placed=await evaluate(chrome,`(async()=>{
      const result=[];
      for(const [column,symbol] of [[0,"Ｂリーグ"],[1,"おばちゃん"],[2,"おばちゃん強"]]){
        result.push((await fetch("/api/map/tile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({row:0,column,symbol})})).status);
      }
      return result;
    })()`);
    assert.deepEqual(placed,[200,200,200]);
    const before=await state();
    assert.equal(before.osaka.catalogReady,true);
    assert.equal(before.osaka.npcSource,"reconstructed");
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const actor=db.prepare("SELECT user_id,stats_json FROM characters").get();
      const stats=Object.fromEntries(Object.keys(JSON.parse(actor.stats_json)).map(k=>[k,5000]));
      db.prepare("UPDATE characters SET stats_json=?,body_energy=1000,brain_energy=1000,recovered_at=?,money=1000000 WHERE user_id=?").run(JSON.stringify(stats),before.gameTimeMs,actor.user_id);
      const insert=db.prepare("INSERT INTO equipment_items(user_id,sku,type,name,power,accuracy,uses,status,created_at) VALUES(?,?,?,?,1000,101,10,'equipped',?)");
      insert.run(actor.user_id,"chrome-arena-weapon","武器","Chrome武器",before.gameTimeMs);
      insert.run(actor.user_id,"chrome-arena-magic","魔法","Chrome魔法",before.gameTimeMs);
    }finally{db.close();}
    await chrome.send("Page.reload");
    await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","重載測試居民");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","主畫面");
    await evaluate(chrome,"window.confirm=()=>true");
    await enter("A1","b-league-panel","shops");
    await until(chrome,"document.querySelectorAll('#b-league-ranks button:not(:disabled)').length===5","B五級可操作");
    // Inject only a lost response AFTER the real server commits; keep the same UI request ID for retry.
    await evaluate(chrome,`(()=>{const real=window.fetch.bind(window);window.phaseHLost=false;window.fetch=async(input,init)=>{
      const res=await real(input,init);
      if(String(input)==="/api/b-league/play"&&!window.phaseHLost&&res.ok){window.phaseHLost=true;throw Error("H測試：已提交但回應遺失");}
      return res;
    };return true;})()`);
    await click(chrome,"#b-league-ranks button:last-child");
    await until(chrome,"window.phaseHLost===true && document.querySelector('#b-league-ranks button:last-child')?.disabled===false","真實交易已提交但回應遺失，原按鈕可重試");
    const first=savedReceipt("b_league_battles");assert.equal(first.length,1);
    assert.equal(first[0].result.outcome,"win");
    assert.equal(first[0].result.rounds.length,1);
    const afterCommit=await state();
    await click(chrome,"#b-league-ranks button:last-child");
    await until(chrome,"document.querySelector('#b-league-result h4')?.textContent?.includes('勝利')","同請求重試顯示勝利");
    assert.deepEqual(savedReceipt("b_league_battles"),first);
    const afterRetry=await state();
    assert.equal(afterRetry.character.money,afterCommit.character.money);
    assert.equal(afterRetry.character.kpoint,afterCommit.character.kpoint);
    assert.equal(afterRetry.equipmentItems.reduce((s,x)=>s+x.uses,0),19);
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#b-league-result ol li').length"),1);
    // Actual weak Osaka click on tablet, actual strong click on mobile after the shared cooldown.
    await viewport(chrome,768,1024);
    await enter("A2","osaka-panel","games");
    assert.match(await evaluate(chrome,"document.querySelector('#osaka-status').textContent"),/Web 重建版 NPC（非原版/);
    await loseBattleResponse(chrome,"osaka/play");
    await click(chrome,'#osaka-modes button[data-osaka-mode="week"]');
    await until(chrome,"window.hRetry.lost&&!document.querySelector('#osaka-modes button[data-osaka-mode=week]').disabled","弱大阪已提交但回應遺失");
    const weakCommitted=await browserBattleState(chrome,"osaka");
    assert.equal(weakCommitted.history.length,1);
    await click(chrome,'#osaka-modes button[data-osaka-mode="week"]');
    await until(chrome,"document.querySelector('#osaka-result h4')?.textContent?.includes('弱｜')","弱大阪戰報");
    await verifyBattleRetry(chrome);
    assert.deepEqual(await browserBattleState(chrome,"osaka"),weakCommitted);
    const weak=savedReceipt("osaka_battles");assert.equal(weak.length,1);
    assert.equal(weak[0].result.outcome,"win");
    assert.equal(weak[0].result.reward.granted,true);
    assert.equal(weak[0].result.npcSource,"reconstructed");
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#osaka-result ol li').length"),weak[0].result.rounds.length);
    await viewport(chrome,375,812);
    await enter("A3","osaka-panel","games");
    await until(chrome,"document.querySelector('#osaka-modes button[data-osaka-mode=strong]')?.disabled===false","共用5秒冷卻自然結束");
    await click(chrome,'#osaka-modes button[data-osaka-mode="strong"]');
    await until(chrome,"document.querySelector('#osaka-result h4')?.textContent?.includes('強｜')","手機強大阪戰報");
    const battles=savedReceipt("osaka_battles");assert.equal(battles.length,2);
    assert.equal(battles[1].result.outcome,"win");assert.equal(battles[1].result.reward.granted,true);
    // Same resident, same actual save: from B to Osaka to C and the existing #38 event.
    await click(chrome,"#home-c-league");
    await click(chrome,"#c-league-open");
    await until(chrome,"document.querySelector('#c-league-result')?.textContent?.includes('已進入第 1 季')","跨玩法進入C聯賽");
    if(!await evaluate(chrome,"document.querySelector('#c-league-training').open"))await click(chrome,"#c-league-training summary");
    await fill(chrome,"#c-league-name","聯合測試培育");
    await click(chrome,"#c-league-train");
    await until(chrome,"document.querySelector('#c-league-result')?.textContent?.includes('培育已儲存')","跨玩法培育");
    await click(chrome,"#c-league-play");
    await until(chrome,"document.querySelector('#c-league-history summary')?.textContent?.includes('模仿者')","跨玩法C戰報");
    const crossC=await browserBattleState(chrome,"cLeague");assert.equal(crossC.history.length,1);
    assert.deepEqual(savedReceipt("b_league_battles"),first);
    assert.deepEqual(savedReceipt("osaka_battles"),battles);
    const eventBefore=await state();
    const eventDb=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const actor=eventDb.prepare("SELECT user_id,last_event_day FROM characters").get();
      const previousDay=actor.last_event_day;
      eventDb.prepare("UPDATE characters SET last_event_day='2000-01-01' WHERE user_id=?").run(actor.user_id);
      const rolls=[0,(38-.5)/44,0,.55];
      const event=settleDailyIllnessEvent(eventDb,actor.user_id,previousDay,eventBefore.gameTimeMs,()=>rolls.shift());
      assert.equal(event.originalId,38);
      const again=settleDailyIllnessEvent(eventDb,actor.user_id,previousDay,eventBefore.gameTimeMs,()=>{throw Error("同日不應重抽")});
      assert.equal(again.checked,false);
    }finally{eventDb.close();}
    await chrome.send("Page.reload");
    await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","事件重載");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#event-popup').hidden&&document.querySelector('#event-popup-body').textContent.includes('聖誕老人戰鬥')","同角色戰鬥後事件通知");
    await click(chrome,"#event-popup-close");
    await click(chrome,"#profile-tab-inventory");
    assert.match(await evaluate(chrome,"document.querySelector('#legacy-inventory-list').textContent"),/Web 聖誕老人戰鬥獎勵/);
    const beforeRestart=await state();
    const eventHistory=beforeRestart.healthEvents.filter(x=>x.originalId===38);
    assert.equal(eventHistory.length,1);
    assert.deepEqual(beforeRestart.cLeague.history,crossC.history);
    const award=battles[1].result.reward;
    assert.ok(beforeRestart.legacyItemActions.some(x=>x.sourceLine===award.sourceLine&&x.remaining>0));
    await click(chrome,"#profile-tab-inventory");
    assert.ok(await evaluate(chrome,"Boolean(document.querySelector('#legacy-inventory-list .inventory-item[data-source-line="+JSON.stringify(String(award.sourceLine))+"]'))"));
    // Real server process restart plus browser navigation, not just state JSON reload.
    await web.stop();web=await startWeb(dataDir);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","重啟保留角色");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","重啟主畫面");
    const restored=await state();
    assert.equal(restored.character.money,beforeRestart.character.money);
    assert.equal(restored.character.kpoint,beforeRestart.character.kpoint);
    assert.deepEqual(savedReceipt("b_league_battles"),first);
    assert.deepEqual(savedReceipt("osaka_battles"),battles);
    assert.deepEqual(restored.equipmentItems,beforeRestart.equipmentItems);
    assert.deepEqual(restored.cLeague.history,crossC.history);
    assert.deepEqual(restored.healthEvents.filter(x=>x.originalId===38),eventHistory);
    assert.deepEqual(restored.legacyItemActions,beforeRestart.legacyItemActions);
    assert.equal(restored.legacyItemActions.find(x=>x.sourceLine===award.sourceLine).remaining,beforeRestart.legacyItemActions.find(x=>x.sourceLine===award.sourceLine).remaining);
    for(const width of [1440,768,375]){
      await viewport(chrome,width,width===375?812:width===768?1024:900);
      await enter("A1","b-league-panel","shops");
      assert.match(await evaluate(chrome,"document.querySelector('#b-league-result h4').textContent"),/勝利/);
      await click(chrome,"#b-league-result details:has(ol) > summary");
      await until(chrome,"!document.querySelector('#b-league-result details:has(ol)').open","B戰報收合 "+width);
      await click(chrome,"#b-league-result details:has(ol) > summary");
      await until(chrome,"document.querySelector('#b-league-result details:has(ol)').open","B戰報展開 "+width);
      assert.equal(await evaluate(chrome,"document.querySelectorAll('#b-league-result ol li').length"),1);
      await enter("A3","osaka-panel","games");
      assert.match(await evaluate(chrome,"document.querySelector('#osaka-result h4').textContent"),/強｜.*勝利/);
      await click(chrome,"#osaka-result details > summary");
      await until(chrome,"!document.querySelector('#osaka-result details').open","大阪戰報收合 "+width);
      await click(chrome,"#osaka-result details > summary");
      await until(chrome,"document.querySelector('#osaka-result details').open","大阪戰報展開 "+width);
      assert.equal(await evaluate(chrome,"document.querySelectorAll('#osaka-result ol li').length"),battles[1].result.rounds.length);
    }
    console.log("H_BROWSER "+JSON.stringify({widths:[1440,768,375],arenaReceipts:first.length,osakaReceipts:battles.length,retry:true,restart:true,npc:battles[1].result.npcSource,cLeagueReceipts:crossC.history.length,event38:eventHistory.length,osakaRetry:true}));
  }finally{await chrome?.stop();await web?.stop();rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});}
});

test("Chrome 街區編輯：1440/768/375 工具列緊鄰地圖、連續儲存不跳頁、戰鬥獨立入口與重啟", {timeout:90000},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-map-edit-"));
  const dataDir=join(workspace,"sqlite");let web=null,chrome=null;
  try{
    web=await startWeb(dataDir);chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#create')?.hidden","建角入口");
    await evaluate(chrome,"window.confirm=()=>true");await fill(chrome,'#create-form [name="name"]',"街區動線驗收");await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","主畫面");
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-battle').hidden"),true);
    assert.equal(await evaluate(chrome,"document.querySelector('#map-editor').nextElementSibling.classList.contains('map-scroll')"),true);
    assert.equal(await evaluate(chrome,"document.querySelector('#map-palette').disabled"),true);
    await click(chrome,"#map-edit-toggle");
    await until(chrome,"document.querySelector('#map-editor').classList.contains('is-editing')&&!document.querySelector('#map-palette').disabled","編輯模式已啟用");
    await evaluate(chrome,`(()=>{const real=window.fetch.bind(window),scroll=Element.prototype.scrollIntoView;
      window.mapEditTrace={requests:[],feedbackScrolls:0};
      Element.prototype.scrollIntoView=function(...args){if(this.matches(".operation-feedback,#map-edit-feedback"))window.mapEditTrace.feedbackScrolls++;return scroll.apply(this,args);};
      window.fetch=async(input,init)=>{
        if(String(input)==="/api/map/tile"){
          const payload=JSON.parse(init.body),cell=document.querySelectorAll("#town-map .map-cell")[payload.row*16+payload.column];
          window.mapEditTrace.requests.push({payload,top:cell.getBoundingClientRect().top,left:document.querySelector("#map-workspace .map-scroll").scrollLeft});
        }
        return real(input,init);
      };return true;})()`);
    const edits=[{width:1440,height:900,cell:"A1",row:0,column:0,symbol:"道横"},
      {width:768,height:1024,cell:"F8",row:5,column:7,symbol:"道縦"},
      {width:375,height:812,cell:"L16",row:11,column:15,symbol:"道１"},
      {width:375,height:812,cell:"L15",row:11,column:14,symbol:"道１"}];
    for(const edit of edits){
      await viewport(chrome,edit.width,edit.height);
      // 真實 select 的值及 change 事件；格子本身以 CDP 實體滑鼠點擊。
      const selected=await evaluate(chrome,`(()=>{const p=document.querySelector("#map-palette");p.value=${JSON.stringify(edit.symbol)};p.dispatchEvent(new Event("change",{bubbles:true}));return p.value;})()`);
      assert.equal(selected,edit.symbol);
      const selector='#town-map button[aria-label^='+JSON.stringify(edit.cell+"：")+']';
      await evaluate(chrome,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:"instant",block:"center",inline:"nearest"});true`);
      await pause(250);
      const visible=await evaluate(chrome,`(()=>{const e=document.querySelector("#map-editor"),r=e.getBoundingClientRect(),p=document.querySelector("#map-palette").getBoundingClientRect(),c=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),head=document.querySelector("#compact-status");return {top:r.top,bottom:r.bottom,paletteTop:p.top,paletteBottom:p.bottom,viewport:innerHeight,cellTop:c.top,headBottom:head.hidden?0:head.getBoundingClientRect().bottom,sticky:getComputedStyle(e).position};})()`);
      assert.equal(visible.sticky,"sticky");
      assert.ok(visible.paletteTop>=visible.headBottom-2&&visible.paletteBottom<=visible.viewport&&visible.bottom<=visible.cellTop+3,"工具列與所編輯格子應同時可見："+JSON.stringify(visible));
      await click(chrome,selector);
      await until(chrome,`document.querySelector("#map-edit-feedback").textContent.includes(${JSON.stringify(edit.cell+"：")})&&document.querySelector("#map-edit-feedback").textContent.includes("已儲存")&&document.querySelector("#town-map").getAttribute("aria-busy")==="false"`,"實際格子儲存 "+edit.cell);
      const observed=await evaluate(chrome,`(async()=>{const s=await(await fetch("/api/state")).json(),cell=document.querySelectorAll("#town-map .map-cell")[${edit.row*16+edit.column}],trace=window.mapEditTrace.requests.at(-1);return {raw:s.map.cells[${edit.row*16+edit.column}].raw,top:cell.getBoundingClientRect().top,left:document.querySelector("#map-workspace .map-scroll").scrollLeft,trace,selected:document.querySelector("#map-palette").value,feedbackScrolls:window.mapEditTrace.feedbackScrolls};})()`);
      assert.equal(observed.raw,edit.symbol);
      assert.equal(observed.selected,edit.symbol);
      assert.deepEqual(observed.trace.payload,{row:edit.row,column:edit.column,symbol:edit.symbol});
      assert.ok(Math.abs(observed.top-observed.trace.top)<=8,"儲存後格子不得跳離原視窗："+JSON.stringify(observed));
      assert.ok(Math.abs(observed.left-observed.trace.left)<=2,"水平地圖位置應保留");
      assert.equal(observed.feedbackScrolls,0);
    }
    const trace=await evaluate(chrome,"window.mapEditTrace");assert.equal(trace.requests.length,edits.length);
    await click(chrome,"#map-edit-toggle");
    assert.equal(await evaluate(chrome,"document.querySelector('#map-palette').disabled"),true);
    assert.equal(await evaluate(chrome,"document.querySelector('#map-editor').classList.contains('is-editing')"),false);
    await click(chrome,"#home-street-fight");
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-battle').hidden"),false);
    assert.match(await evaluate(chrome,"document.querySelector('#street-fight-status').textContent"),/單機沒有/);
    await click(chrome,"#home-c-league");
    assert.equal(await evaluate(chrome,"document.activeElement.id"),"c-league-panel");
    await click(chrome,"#facility-tab-jobs");
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-battle').hidden"),true);
    await web.stop();web=await startWeb(dataDir);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","重啟街區");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","重啟主畫面");
    const saved=await evaluate(chrome,`(async()=>{const s=await(await fetch("/api/state")).json();return ${JSON.stringify(edits.map(e=>e.row*16+e.column))}.map(i=>s.map.cells[i].raw);})()`);
    assert.deepEqual(saved,edits.map(e=>e.symbol));
    assert.equal(await evaluate(chrome,"document.querySelector('#facility-pane-battle').hidden"),true);
    console.log("UI_MAP_EDIT "+JSON.stringify({widths:[1440,768,375],saved:edits.length,feedbackScrolls:trace.feedbackScrolls,restart:true,battleTab:true}));
  }finally{await chrome?.stop();await web?.stop();rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});}
});

test("Chrome：三棟訓練共用付款列、各自保存選擇、信用扣款及失效不轉現金",{timeout:90000},async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-chrome-training-pay-"));
  const dataDir=join(workspace,"sqlite");let web=null,chrome=null;
  try{
    web=await startWeb(dataDir);chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");await viewport(chrome,1440,900);
    await chrome.send("Page.navigate",{url:web.url});await until(chrome,"!document.querySelector('#create')?.hidden","建角");
    await evaluate(chrome,"window.confirm=()=>true");await fill(chrome,'#create-form [name="name"]',"訓練付款驗收");await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","主畫面");
    const state=()=>evaluate(chrome,"(async()=>await(await fetch('/api/state')).json())()");
    const initial=await state();
    const purchased=Math.floor(initial.gameTimeMs/1000)-60;
    const raw=Array(33).fill("");raw[0]="日用品";raw[1]="クレジットカード";raw[9]="クレジット";raw[21]="3";raw[22]="日";raw[30]=String(purchased);
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const owner=db.prepare("SELECT user_id FROM characters").get().user_id;
      db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(owner,"000001",1,"日用品","クレジットカード","クレジット",3,"日",purchased,0,JSON.stringify(raw));
      db.prepare("UPDATE characters SET money=1000,bank=99000 WHERE user_id=?").run(owner);
    }finally{db.close();}
    await click(chrome,"#refresh");await click(chrome,"#facility-tab-training");
    const select=async(type,value)=>{
      const actual=await evaluate(chrome,`(()=>{const e=document.querySelector("#"+${JSON.stringify(type)}+"-payment");e.value=${JSON.stringify(value)};e.dispatchEvent(new Event("change",{bubbles:true}));return e.value;})()`);
      assert.equal(actual,value);
    };
    const values=()=>evaluate(chrome,"['school','gym','classroom'].map(t=>document.querySelector('#'+t+'-payment').value)");
    assert.deepEqual(await values(),["cash","cash","cash"]);
    for(const type of ["school","gym","classroom"]){
      assert.equal(await evaluate(chrome,`document.querySelectorAll("#"+${JSON.stringify(type)}+"-panel .training-payment select").length`),1);
      assert.equal(await evaluate(chrome,`document.querySelectorAll("#"+${JSON.stringify(type)}+"-lessons select").length`),0);
      assert.match(await evaluate(chrome,`document.querySelector("#"+${JSON.stringify(type)}+"-payment-balance").textContent`),/現金.*普通存款/);
      assert.equal(await evaluate(chrome,`[...document.querySelector("#"+${JSON.stringify(type)}+"-payment").options].find(o=>o.value==="credit:1").textContent`),"信用卡（普通存款扣款）");
    }
    assert.equal(await evaluate(chrome,"document.querySelector('#school-lessons button').disabled"),true);
    await select("school","credit:1");
    assert.deepEqual(await values(),["credit:1","cash","cash"]);
    assert.equal(await evaluate(chrome,"document.querySelector('#school-lessons button').disabled"),false);
    assert.equal(await evaluate(chrome,"document.querySelector('#classroom-lessons button').disabled"),true);
    await select("gym","credit:1");await select("classroom","credit:1");
    await chrome.send("Page.reload");await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","重新整理");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","重新整理主畫面");
    assert.deepEqual(await values(),["credit:1","credit:1","credit:1"]);
    await click(chrome,"#facility-tab-training");
    for(const [type,index,key,width] of [["school",1,"school-2",1440],["gym",2,"gym-3",768],["classroom",1,"classroom-2",375]]){
      await viewport(chrome,width,width===375?812:900);
      const before=await state(),lesson=before.trainingLessons.find(x=>x.key===key);
      await click(chrome,`#${type}-lessons .training-tile:nth-child(${index}) button`);
      await until(chrome,"document.querySelector('#result-dialog')?.open&&document.querySelector('#result-dialog-message').textContent.includes('普通銀行存款扣除')",type+"信用付款");
      const after=await state();
      assert.equal(after.character.money,before.character.money);
      assert.equal(after.character.bank,before.character.bank-lesson.price);
      assert.deepEqual(await values(),["credit:1","credit:1","credit:1"]);
    }
    const expired=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{
      const old=purchased-4*86400;raw[30]=String(old);
      expired.prepare("UPDATE legacy_inventory_items SET purchased_at=?,raw_fields_json=? WHERE source_line=1").run(old,JSON.stringify(raw));
    }finally{expired.close();}
    await click(chrome,"#profile-tab-status");await click(chrome,"#refresh");
    await until(chrome,"document.querySelector('#gym-payment').value==='unavailable'","失效付款方式更新");
    assert.deepEqual(await values(),["unavailable","unavailable","unavailable"]);
    await click(chrome,"#facility-tab-training");
    assert.match(await evaluate(chrome,"document.querySelector('#gym-payment-note').textContent"),/失效/);
    await select("gym","cash");
    assert.deepEqual(await values(),["unavailable","cash","unavailable"]);
    console.log("UI_TRAINING_PAYMENT "+JSON.stringify({widths:[1440,768,375],buildings:3,shared:true,reload:true,expiredBlocked:true}));
  }finally{await chrome?.stop();await web?.stop();rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});}
});
