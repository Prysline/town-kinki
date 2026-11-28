import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
const root=resolve(process.argv[2]);
const candidate="b9a7b6c2428111799c471e9770aa94b475a35bbf";
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
assert.equal(git("rev-parse",candidate+"^{tree}"),"6b6aa003da2cba5cf59e6933df063bc09e986578");
assert.deepEqual(git("diff","--name-only",candidate,"HEAD").split("\n").filter(Boolean).sort(),[".github/workflows/v07-stock-tax-http.yml","web/docs/validation/V07-STOCK-TAX-HTTP.md","web/scripts/v07-stock-tax-http.mjs"]);
const t0=Date.parse("2026-11-29T23:59:50Z");
const stats=Object.fromEntries("kokugo suugaku rika syakai eigo ongaku bijutu looks tairyoku kenkou speed power wanryoku kyakuryoku love unique etti".split(" ").map(k=>[k,20]));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(root,dir,mode,now=t0){
  // Controlled test process only: deterministic clock, Math.random and crypto calls.
  // Trace the exact randomInt calls; never run this preload in a product process.
  const traceFile=join(dir,"v04-rng.jsonl");writeFileSync(traceFile,"");
  const preload="import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';import {existsSync,readFileSync,unlinkSync,appendFileSync} from 'node:fs';"+
    "const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:["+now+"]));}static now(){return "+now+";}};"+
    "const trace=(v)=>appendFileSync("+JSON.stringify(traceFile)+",JSON.stringify(v)+String.fromCharCode(10));Math.random=()=>{trace(['Math.random',0.5]);return 0.5;};let bytes=0,roll=0;const seq=[0,1,35,7,16,23];"+
    "crypto.randomBytes=(n)=>{const b=Buffer.alloc(n);for(let i=0;i<n;i++)b[i]=(++bytes)&255;trace(['randomBytes',n]);return b;};"+
    "crypto.randomInt=(a,b)=>{const lo=b===undefined?0:a,hi=b===undefined?a:b;let v=lo+seq[roll++%seq.length]%(hi-lo);const file="+JSON.stringify(join(dir,"v04-next-die"))+";if(lo===0&&hi===36&&existsSync(file)){v=Number(readFileSync(file,'utf8'));unlinkSync(file);}trace(['randomInt',lo,hi,v]);return v;};"+
    "syncBuiltinESMExports();";
  const child=spawn(process.execPath,["--import","data:text/javascript,"+encodeURIComponent(preload),"src/server.mjs"],{cwd:join(root,"web"),env:{...process.env,HOST:"127.0.0.1",PORT:"0",GAME_MODE:mode,GAME_TIMEZONE:"UTC",DATA_DIR:dir}});
  let output="",errors="";
  child.stdout.on("data",x=>output+=x);child.stderr.on("data",x=>errors+=x);
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit");child.kill();await exited;}};
  try{
    for(let i=0;i<120;i++){
      const url=output.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)/m)?.[1];
      if(url)return {url,stop,rng:()=>readFileSync(traceFile,"utf8").split("\n").filter(Boolean).map(JSON.parse)};
      if(child.exitCode!==null)break;await delay(100);
    }
    throw Error("startup "+output+errors);
  }catch(e){await stop();throw e;}
}
function dbRun(dir,mode,fn){const db=new DatabaseSync(join(dir,mode+".sqlite"));try{return fn(db);}finally{db.close();}}
function dbRead(dir,mode){return dbRun(dir,mode,db=>{
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  const rows=Object.fromEntries(schema.filter(x=>x.type==="table").map(x=>[x.name,db.prepare('SELECT * FROM "'+x.name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  return {schema,rows};
});}

const dir=mkdtempSync(join(tmpdir(),"town-v07-stock-tax-"));
let s;
const db=fn=>dbRun(dir,"solo",fn);
const read=()=>dbRead(dir,"solo");
const row=sql=>db(d=>d.prepare(sql).get());
const sql=statement=>db(d=>d.exec(statement));
async function api(path,body,status=200){
  const response=await fetch(s.url+"/api/"+path,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const value=await response.json();assert.equal(response.status,status,path+" "+JSON.stringify(value).slice(0,500));return value;
}
try{
  s=await launch(root,dir,"solo",t0);
  await api("character",{name:"V07股票週一",gender:"other",stats});
  await api("map/tile",{row:0,column:0,symbol:"株"});
  sql("UPDATE characters SET money=2000000,bank=1000000,kpoint=0");
  const sunday=await api("state");
  assert.equal(sunday.stock.available,true);
  assert.deepEqual(sunday.stock.market.prices,[25000,25000,25000,25000,25000]);
  await api("stock/access",{action:"open",requestId:"v07_sunday_open"});
  assert.equal(row("SELECT assessment_base FROM bank_tax_state").assessment_base,3000000);
  assert.equal(row("SELECT snapshot_day FROM bank_tax_state").snapshot_day,"2026-11-29");
  assert.equal(row("SELECT COUNT(*) n FROM bank_tax_assessments").n,0);
  await s.stop();s=undefined;
  s=await launch(root,dir,"solo",t0+15000);
  // No GET state after restart. First Monday request is the stock buy itself.
  const pre=read();
  sql("CREATE TRIGGER v07_fail_history BEFORE INSERT ON stock_trade_history BEGIN SELECT RAISE(ABORT,'v07 stock history fault'); END");
  const buy={action:"buy",key:"D",quantity:1,requestId:"v07_monday_buy"};
  const failed=await api("stock/access",buy,400);
  assert.match(failed.error,/v07 stock history fault/);
  sql("DROP TRIGGER v07_fail_history");
  assert.deepEqual(read(),pre,"market, bank settlement, tax, receipts, portfolio and cash all roll back");
  console.log("V07_STOCK_FAULT_ROLLBACK true");
  const purchased=await api("stock/access",buy);
  assert.equal(purchased.stockResult.expired,false);
  assert.equal(purchased.stockResult.record.amount,25000);
  assert.equal(purchased.character.money,1975000);
  assert.equal(purchased.character.bank,975000);
  assert.equal(purchased.stock.holdings[3].shares,1);
  const tax=row("SELECT * FROM bank_tax_assessments");
  assert.equal(tax.tax_day,"2026-11-30");assert.equal(tax.assessment_base,3000000);assert.equal(tax.paid,30000);
  assert.equal(row("SELECT assessment_base FROM bank_tax_state").assessment_base,2950000);
  assert.equal(row("SELECT COUNT(*) n FROM bank_tax_assessments").n,1);
  console.log("V07_STOCK_MONDAY "+JSON.stringify({tax:tax.paid,priorBase:tax.assessment_base,bank:purchased.character.bank,cash:purchased.character.money,newBase:2950000}));
  const saved=read();
  const replay=await api("stock/access",buy);
  assert.equal(replay.stockResult.replayed,true);
  assert.deepEqual(read(),saved);
  const conflict=await api("stock/access",{...buy,quantity:2},400);
  assert.match(conflict.error,/相同股票請求碼/);assert.deepEqual(read(),saved);
  await s.stop();s=undefined;s=await launch(root,dir,"solo",t0+15000);
  const replayRestart=await api("stock/access",buy);
  assert.equal(replayRestart.stockResult.replayed,true);
  assert.equal(replayRestart.stock.holdings[3].shares,1);
  assert.deepEqual(read(),saved);
  // Return receipt failure must not publish guest/market or history updates.
  sql("CREATE TRIGGER v07_fail_return BEFORE INSERT ON stock_receipts WHEN NEW.args_json='[\"town-return\"]' BEGIN SELECT RAISE(ABORT,'v07 return receipt fault'); END");
  const back={requestId:"v07_town_return"};
  const badReturn=await api("town/return",back,400);assert.match(badReturn.error,/v07 return receipt fault/);
  sql("DROP TRIGGER v07_fail_return");assert.deepEqual(read(),saved);
  const returned=await api("town/return",back);assert.equal(returned.character,undefined);assert.equal(returned.stockReturnResult.guestCount,0);
  const returnSaved=read();
  const returnAgain=await api("town/return",back);assert.equal(returnAgain.stockReturnResult.replayed,true);assert.deepEqual(read(),returnSaved);
  const count=row("SELECT COUNT(*) n FROM stock_receipts").n,market=row("SELECT * FROM stock_market");
  const rng=s.rng();
  for(let i=0;i<3;i++)await api("state");
  assert.equal(row("SELECT COUNT(*) n FROM stock_receipts").n,count);assert.deepEqual(row("SELECT * FROM stock_market"),market);
  // State may run existing resident RNG; stock market RNG must not be added.
  const marketDraws=trace=>trace.filter(x=>x[0]==="randomInt"&&x[1]===0&&x[2]===2**32);
  assert.deepEqual(marketDraws(s.rng()),marketDraws(rng));
  console.log("V07_STOCK_HTTP "+JSON.stringify({candidate,controlled:true,human:false,mondayTax:true,historyFault:true,replay:true,conflict:true,restart:true,returnFault:true,pollMarketReadOnly:true}));
}finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
