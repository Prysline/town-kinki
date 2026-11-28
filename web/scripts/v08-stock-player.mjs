import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
const root=resolve(process.argv[2]);
const candidate="b9a7b6c2428111799c471e9770aa94b475a35bbf";
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
assert.equal(git("rev-parse",candidate+"^{tree}"),"6b6aa003da2cba5cf59e6933df063bc09e986578");
assert.deepEqual(git("diff","--name-only",candidate,"HEAD").split("\n").filter(Boolean).sort(),[".github/workflows/v08-stock-player.yml","web/docs/validation/V08-STOCK-PLAYER.md","web/scripts/v08-stock-player.mjs"]);
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
async function api(s,path,body,status=200){
  const res=await fetch(s.url+"/api/"+path,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const result=await res.json();
  assert.equal(res.status,status,path+": "+JSON.stringify(result).slice(0,500));
  return result;
}

function stored(dir){
  const db=new DatabaseSync(join(dir,"solo.sqlite"),{readOnly:true});
  try{
    return {
      char:db.prepare("SELECT money,bank FROM characters").get(),
      market:db.prepare("SELECT * FROM stock_market").get(),
      portfolio:db.prepare("SELECT * FROM stock_portfolios").all(),
      history:db.prepare("SELECT * FROM stock_trade_history ORDER BY id").all(),
      marketHistory:db.prepare("SELECT * FROM stock_market_history ORDER BY id").all(),
      guests:db.prepare("SELECT * FROM stock_guests").all(),
      receipts:db.prepare("SELECT * FROM stock_receipts ORDER BY user_id,request_id").all(),
      fk:db.prepare("PRAGMA foreign_key_check").all()
    };
  }finally{db.close();}
}
const dir=mkdtempSync(join(tmpdir(),"town-v08-player-"));
let s;
const events=[];
try{
  s=await launch(dir);
  const start=await api(s,"character",{name:"V08自然股票",gender:"male",stats});
  assert.equal(start.character.money,100000);assert.equal(start.character.bank,0);
  async function back(label){
    const result=await api(s,"town/return",{requestId:"v08_return_"+label});
    events.push({label,event:result.stockReturnResult.market.event,guests:result.stockReturnResult.guestCount});
    assert.equal(result.character,undefined);return result;
  }
  await back("create");
  const map=await api(s,"map/tile",{row:0,column:0,symbol:"株"});
  assert.equal(map.stock.available,true);
  const worked=await api(s,"work",{});
  assert.ok(worked.result.paid>0);
  await back("work");
  const bank=await api(s,"bank",{action:"deposit",amount:40000});
  assert.equal(bank.character.money,worked.character.money-40000);
  assert.equal(bank.character.bank,40000);
  await back("bank");
  const open=await api(s,"stock/access",{action:"open",requestId:"v08_open_market"});
  const price=open.stock.market.prices[4];
  assert.ok(price>0&&price<=open.character.money&&price<=open.character.bank);
  const request={action:"buy",key:"E",quantity:1,requestId:"v08_buy_market"};
  const buy=await api(s,"stock/access",request);
  assert.equal(buy.stockResult.expired,false);
  assert.equal(buy.stockResult.record.amount,price);
  assert.equal(buy.stock.holdings[4].shares,1);
  assert.equal(buy.character.money,open.character.money-price);
  assert.equal(buy.character.bank,open.character.bank);
  const saved=stored(dir);
  const repeat=await api(s,"stock/access",request);
  assert.equal(repeat.stockResult.replayed,true);
  assert.deepEqual(stored(dir),saved);
  for(let i=0;i<3;i++)await api(s,"state");
  assert.deepEqual(stored(dir),saved);
  await s.stop();s=undefined;s=await launch(dir);
  const state=await api(s,"state");
  assert.equal(state.stock.holdings[4].shares,1);
  assert.deepEqual(stored(dir),saved);
  const returned=await back("restart");
  assert.equal(returned.stock.market.prices[4],price,"existing trading window holds price");
  const sell=await api(s,"stock/access",{action:"sell",key:"E",quantity:1,requestId:"v08_sell_market"});
  assert.equal(sell.stockResult.expired,false);
  assert.equal(sell.stock.holdings[4].shares,0);
  assert.equal(sell.character.money,open.character.money);
  assert.equal(sell.character.bank,open.character.bank);
  const after=stored(dir);assert.equal(after.history.length,2);
  assert.deepEqual(after.fk,[]);
  console.log("V08_STOCK_PLAYER "+JSON.stringify({candidate,timezone,initialCash:start.character.money,workPaid:worked.result.paid,deposit:40000,price,finalCash:sell.character.money,finalBank:sell.character.bank,marketReturns:events,naturalMarketEventHits:events.filter(e=>e.event).length,realClock:true,naturalRng:true,dbWrites:false,automated:true,human:false,restart:true,replay:true,pollReadOnly:true}));
}finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
