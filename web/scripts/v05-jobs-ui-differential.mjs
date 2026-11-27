// 實際 Chrome CDP 瀏覽器操作；不使用 jsdom／假 DOM，亦不宣稱真人手動驗收。
// 此測試只讀原版 CGI 商品來源，資料寫在作業系統暫存 DATA_DIR。
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let WEB_ROOT;
const t0=Date.parse("2026-11-29T12:00:00Z");
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
  const preload="import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';import {existsSync,readFileSync,unlinkSync} from 'node:fs';Date.now=()=>"+t0+";Math.random=()=>0.5;const file="+JSON.stringify(join(dir,"v04-browser-die"))+";crypto.randomInt=(a,b)=>{const lo=b===undefined?0:a,hi=b===undefined?a:b;if(lo===0&&hi===36&&existsSync(file)){const v=Number(readFileSync(file,'utf8'));unlinkSync(file);return v;}return lo;};syncBuiltinESMExports();";
  const child=spawn(process.execPath,["--import","data:text/javascript,"+encodeURIComponent(preload),"src/server.mjs"],{
    cwd:WEB_ROOT,env:{...process.env,GAME_MODE:mode,
      HOST:"127.0.0.1",PORT:String(port),DATA_DIR:dir,GAME_TIMEZONE:"UTC"}
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

async function runBrowser(root,workspace){
  WEB_ROOT=join(root,"web");
  const dataDir=join(workspace,"sqlite");
  const transcript=[];
  let web,chrome;
  const state=()=>fetch(web.url+"/api/state").then(r=>r.json());
  const select=async(id,value)=>{
    const actual=await evaluate(chrome,"(()=>{const e=document.getElementById("+JSON.stringify(id)+");e.value="+JSON.stringify(value)+";e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()");
    assert.equal(actual,value);
  };
  async function capture(label){
    const dom=await evaluate(chrome,`(()=>{
      const e=id=>document.getElementById(id);
      return {jobs:e("jobs").innerHTML,search:e("job-search").value,filter:e("job-filter").value,
        salary:e("salary-payment").value,salaryDisabled:e("salary-payment").disabled,
        details:[...e("jobs").querySelectorAll("details")].map(x=>[x.dataset.jobKey,x.open]),
        active:[...e("jobs").querySelectorAll(".job.active")].map(x=>x.textContent),
        dialogOpen:e("result-dialog").open,dialogText:e("result-dialog").open?e("result-dialog-message").textContent:"",
        width:innerWidth};
    })()`);
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"),{readOnly:true});
    let rows;
    try{rows=db.prepare("SELECT * FROM characters ORDER BY user_id").all();}finally{db.close();}
    transcript.push({label,dom,rows});console.log("V05_UI_EXEC "+label);
  }
  try{
    web=await startWeb(dataDir);
    chrome=await openChrome(join(workspace,"chrome"));
    await chrome.send("Page.enable");await chrome.send("Runtime.enable");
    await chrome.send("Emulation.setTimezoneOverride",{timezoneId:"UTC"});
    await chrome.send("Page.addScriptToEvaluateOnNewDocument",{source:"Date.now=()=>"+t0+";"});
    await viewport(chrome,1440,900);await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#create')?.hidden","建角");
    await evaluate(chrome,"window.confirm=()=>true");
    await fill(chrome,'#create-form [name="name"]',"V05職業驗證");
    await click(chrome,"#create-submit");
    await until(chrome,"!document.querySelector('#game')?.hidden","建角完成");
    await click(chrome,"#facility-tab-jobs");
    const initial=await state();
    assert.equal(initial.jobs.length,150);
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#jobs .job').length"),150);
    assert.equal(await evaluate(chrome,"document.querySelectorAll('#jobs .job.active').length"),1);
    await capture("initial all 150");
    const police=initial.jobs.find(j=>j.originalName==="警官");
    assert.ok(police?.reason);
    await fill(chrome,"#job-search",police.name);
    const detailSelector='#jobs details[data-job-key='+JSON.stringify(police.key)+']';
    const rowExpr="document.querySelector("+JSON.stringify(detailSelector)+")?.closest('.job')";
    await until(chrome,"Boolean("+rowExpr+")","搜尋警官");
    assert.equal(await evaluate(chrome,rowExpr+".querySelector('button').disabled"),true);
    await click(chrome,detailSelector+" summary");
    assert.equal(await evaluate(chrome,"document.querySelector("+JSON.stringify(detailSelector)+").open"),true);
    await capture("locked search expanded");
    await click(chrome,"#profile-tab-status");await click(chrome,"#refresh");
    await until(chrome,"document.querySelector("+JSON.stringify(detailSelector)+")?.open===true","重繪保留展開");
    await click(chrome,"#facility-tab-jobs");await capture("expanded after refresh");
    await select("job-filter","available");
    assert.equal(await evaluate(chrome,"Boolean("+rowExpr+")"),false);await capture("available filter locked");
    await select("job-filter","all");await fill(chrome,"#job-search","__不存在的職業__");
    assert.match(await evaluate(chrome,"document.querySelector('#jobs').textContent"),/沒有符合條件的職業/);
    await capture("empty search");
    const db=new DatabaseSync(join(dataDir,"solo.sqlite"));
    try{const stats=Object.fromEntries(Object.keys(initial.character.stats).map(k=>[k,Math.max(200,police.requirements[k]??0)]));
      db.prepare("UPDATE characters SET height=180,weight=65,bmi=20.1,stats_json=?,body_energy=200,brain_energy=200").run(JSON.stringify(stats));
    }finally{db.close();}
    assert.equal((await state()).jobs.find(j=>j.key===police.key).reason,null);
    await click(chrome,"#profile-tab-status");await click(chrome,"#refresh");
    await click(chrome,"#facility-tab-jobs");await fill(chrome,"#job-search",police.name);await select("job-filter","available");
    await until(chrome,"Boolean("+rowExpr+")&&!"+rowExpr+".querySelector('button').disabled","可應徵");
    await viewport(chrome,768,900);await capture("tablet eligible");
    const index=await evaluate(chrome,"[...document.querySelectorAll('#jobs .job')].indexOf("+rowExpr+")+1");
    assert.ok(index>0);await click(chrome,"#jobs .job:nth-child("+index+") button");
    await until(chrome,"Boolean("+rowExpr+"?.classList.contains('active'))","應徵完成");
    assert.equal((await state()).character.jobId,police.key);await capture("tablet hired");
    await dismiss(chrome);await viewport(chrome,375,812);
    await select("salary-payment","bank");
    await until(chrome,"!document.querySelector('#salary-payment').disabled&&document.querySelector('#salary-payment').value==='bank'","薪資偏好");
    assert.equal((await state()).character.salaryPayment,"bank");await capture("mobile payment");
    await web.stop();web=await startWeb(dataDir);
    await chrome.send("Page.navigate",{url:web.url});
    await until(chrome,"!document.querySelector('#game')?.hidden||!document.querySelector('#solo-lobby')?.hidden","重啟");
    if(await evaluate(chrome,"!document.querySelector('#solo-lobby')?.hidden"))await click(chrome,"#solo-continue");
    await until(chrome,"!document.querySelector('#game')?.hidden","續玩");
    await click(chrome,"#facility-tab-jobs");
    const restored=await state();assert.equal(restored.character.jobId,police.key);assert.equal(restored.character.salaryPayment,"bank");
    await capture("mobile restart");
    return transcript;
  }finally{await chrome?.stop();await web?.stop();}
}
const [a,b]=process.argv.slice(2).map(x=>resolve(x));
const git=(root,...args)=>spawnSync("git",args,{cwd:root,encoding:"utf8"}).stdout.trim();
assert.equal(git(a,"rev-parse","HEAD"),"c18f56e8df68f3c8998c1ba7733500026e34424b");
assert.equal(git(a,"rev-parse","HEAD^{tree}"),"d462bbd51f94066499ff3c1e084d6fa4532ed47e");
assert.equal(git(b,"rev-parse","a524395b1c8b2704873b71b1dac7202b90dc93d0^{tree}"),"73fc99ca0aebe317d19ea870309f67c3521cf5b7");
assert.ok(git(b,"diff","--name-only","a524395b1c8b2704873b71b1dac7202b90dc93d0","HEAD").split("\n").filter(Boolean).every(p=>p.startsWith("web/docs/validation/")||p==="web/scripts/v05-jobs-ui-differential.mjs"||p===".github/workflows/v05-jobs-ui-differential.yml"));
const temp=mkdtempSync(join(tmpdir(),"town-v05-ui-diff-"));
try{
  const aa=await runBrowser(a,join(temp,"base")),bb=await runBrowser(b,join(temp,"candidate"));
  assert.equal(aa.length,bb.length);
  for(let i=0;i<aa.length;i++){assert.deepEqual(bb[i],aa[i],aa[i].label);console.log("V05_UI_DIFF_STEP "+aa[i].label);}
  console.log("V05_UI_DIFF "+JSON.stringify({steps:aa.length,dom:true,sqlite:true,widths:[1440,768,375],controlled:true,human:false}));
}finally{rmSync(temp,{recursive:true,force:true,maxRetries:50,retryDelay:200});}
