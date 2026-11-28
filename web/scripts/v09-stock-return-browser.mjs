import assert from "node:assert/strict";
import {spawn,spawnSync,execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
const root=resolve(process.argv[2]),candidate="b9a7b6c2428111799c471e9770aa94b475a35bbf";
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
assert.equal(git("rev-parse",candidate+"^{tree}"),"6b6aa003da2cba5cf59e6933df063bc09e986578");
assert.deepEqual(git("diff","--name-only",candidate,"HEAD").split("\n").filter(Boolean).sort(),[".github/workflows/v09-stock-return-browser.yml","web/docs/validation/V09-STOCK-RETURN-BROWSER.md","web/scripts/v09-stock-return-browser.mjs"]);
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
const cwd=join(root,"web");
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stats=Object.fromEntries("kokugo suugaku rika syakai eigo ongaku bijutu looks tairyoku kenkou speed power wanryoku kyakuryoku love unique etti".split(" ").map(k=>[k,20]));
// Use a supported game timezone that is currently far from midnight; no injected clock or RNG.
const offset=12-new Date().getUTCHours();
const timezone=offset===0?"UTC":"Etc/GMT"+(offset>0?"-":"+")+Math.abs(offset);
async function launch(dir){
  const child=spawn(process.execPath,["src/server.mjs"],{cwd,env:{...process.env,HOST:"127.0.0.1",PORT:"0",GAME_MODE:"solo",GAME_TIMEZONE:timezone,DATA_DIR:dir}});
  let output="",errors="";
  child.stdout.on("data",x=>output+=x);child.stderr.on("data",x=>errors+=x);
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit");child.kill();await exited;}};
  try{
    for(let i=0;i<120;i++){
      const url=output.match(/^TOWN Web \[solo\] (http:\/\/127\.0\.0\.1:[1-9]\d*)/m)?.[1];
      if(url)return {url,stop};
      if(child.exitCode!==null)break;
      await delay(100);
    }
    throw Error("server startup: "+output+errors);
  }catch(e){await stop();throw e;}
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

const workspace=mkdtempSync(join(tmpdir(),"town-v09-browser-"));
let web,chrome;
const dataDir=join(workspace,"sqlite");
function stored(){
 const d=new DatabaseSync(join(dataDir,"solo.sqlite"),{readOnly:true});
 try{return {char:d.prepare("SELECT money,bank FROM characters").get(),
 ledger:d.prepare("SELECT * FROM bank_ledger ORDER BY id").all(),
 market:d.prepare("SELECT * FROM stock_market").get(),
 marketHistory:d.prepare("SELECT * FROM stock_market_history ORDER BY id").all(),
 receipts:d.prepare("SELECT * FROM stock_receipts ORDER BY request_id").all(),
 guests:d.prepare("SELECT * FROM stock_guests").all(),
 fk:d.prepare("PRAGMA foreign_key_check").all()};}
 finally{d.close();}
}
const statusExpr="document.querySelector('#stock-return-status')?.textContent";
try{
 web=await launch(dataDir);chrome=await openChrome(join(workspace,"profile"));
 await chrome.send("Page.enable");await chrome.send("Runtime.enable");await viewport(chrome,1440,900);
 await chrome.send("Page.navigate",{url:web.url});
 await until(chrome,"!document.querySelector('#create')?.hidden","新建角色");
 await fill(chrome,'#create-form [name="name"]',"V09返回重試");
 await click(chrome,"#create-submit");
 await until(chrome,"!document.querySelector('#game')?.hidden","建角與城鎮返回完成");
 const initial=stored();assert.equal(initial.char.money,100000);assert.equal(initial.char.bank,0);
 assert.equal(initial.receipts.length,1);
 await click(chrome,"#facility-tab-bank");
 // Only simulate a response lost after real server commit, with actual UI-generated IDs.
 await evaluate(chrome,`(()=>{const native=window.fetch.bind(window);
   window.v09Trace={requests:[],lost:[]};
   window.fetch=async(input,init)=>{
     const match=String(input)==="/api/town/return";
     const payload=match?JSON.parse(init.body):null;
     if(match)window.v09Trace.requests.push(payload);
     const response=await native(input,init);
     if(match&&response.ok&&window.v09Trace.lost.length<2&&!window.v09Trace.lost.includes(payload.requestId)){
       await response.clone().json();
       window.v09Trace.lost.push(payload.requestId);
       throw Error("V09 committed town return response lost");
     }
     return response;
   };return true;
 })()`);
 async function deposit(amount,count){
   await fill(chrome,'#bank-form [name="amount"]',String(amount));
   await click(chrome,'#bank-form button[value="deposit"]');
   await until(chrome,"window.v09Trace.lost.length==="+count+"&&("+statusExpr+").includes('行情返回尚未確認')&&document.querySelector('#result-dialog-message')?.textContent?.includes('存款完成')","已提交存款但行情回應遺失 "+count);
 }
 await deposit(100,1);
 const first=stored();assert.equal(first.char.money,99900);assert.equal(first.char.bank,100);
 assert.equal(first.receipts.length,2);
 await deposit(200,2);
 const second=stored();assert.equal(second.char.money,99700);assert.equal(second.char.bank,300);
 assert.equal(second.receipts.length,3);
 assert.equal(second.ledger.length,initial.ledger.length+2);
 const trace=await evaluate(chrome,"window.v09Trace");
 assert.equal(trace.requests.length,2);assert.notEqual(trace.requests[0].requestId,trace.requests[1].requestId);
 // GET and a subsequent UI render must not erase the pending-return IDs.
 await click(chrome,"#refresh");await until(chrome,"("+statusExpr+").includes('行情返回尚未確認')","更新狀態保留待確認");
 await viewport(chrome,375,812);
 await click(chrome,"#town-return");
 await until(chrome,"window.v09Trace.requests.length===3&&!document.querySelector('#town-return').disabled","第一筆手動重送");
 assert.ok((await evaluate(chrome,statusExpr)).includes("行情返回尚未確認"),"第二筆仍待確認");
 assert.deepEqual(stored(),second,"重送不可再次存款、抽選、改寫訪客或市場");
 await click(chrome,"#town-return");
 await until(chrome,"window.v09Trace.requests.length===4&&!document.querySelector('#town-return').disabled&&("+statusExpr+")===''","第二筆重送完成");
 const final=await evaluate(chrome,"window.v09Trace");
 assert.deepEqual(final.requests[2],final.requests[0]);assert.deepEqual(final.requests[3],final.requests[1]);
 assert.deepEqual(stored(),second);
 assert.deepEqual(second.fk,[]);
 console.log("V09_STOCK_RETURN_BROWSER "+JSON.stringify({candidate,controlledNetwork:true,naturalRng:true,realClock:true,dbWrites:false,widths:[1440,375],deposits:2,bank:300,cash:99700,distinctPending:2,retrySameIds:true,returns:3,noDuplicate:true,pollPreservesPending:true,human:false}));
}finally{await chrome?.stop();await web?.stop();rmSync(workspace,{force:true,recursive:true,maxRetries:50,retryDelay:200});}
