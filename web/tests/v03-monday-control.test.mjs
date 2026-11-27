import test from "node:test";
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";

const cwd=fileURLToPath(new URL("..",import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stats=Object.fromEntries("kokugo suugaku rika syakai eigo ongaku bijutu looks tairyoku kenkou speed power wanryoku kyakuryoku love unique etti".split(" ").map(k=>[k,20]));
const sunday=Date.parse("2026-11-29T12:00:00Z"), monday=sunday+86400000;
async function launch(dir,now=sunday,mode="solo"){
  const child=spawn(process.execPath,["--import","data:text/javascript,"+encodeURIComponent("Date.now=()=>"+now+";Math.random=()=>0.5;"),"src/server.mjs"],{cwd,env:{...process.env,HOST:"127.0.0.1",PORT:"0",GAME_MODE:mode,GAME_TIMEZONE:"UTC",DATA_DIR:dir}});
  let output="",errors="";
  child.stdout.on("data",x=>output+=x);child.stderr.on("data",x=>errors+=x);
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit");child.kill();await exited;}};
  try{
    for(let i=0;i<120;i++){
      const url=output.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)/m)?.[1];
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

function query(dir,sql,mode="solo"){
  const db=new DatabaseSync(join(dir,mode+".sqlite"),{readOnly:true});
  try{return db.prepare(sql).all();}finally{db.close();}
}
function dump(dir){
  return Object.fromEntries(["characters","onsen_visits","bank_accounts","bank_ledger","bank_tax_state","bank_tax_assessments","character_events","dining_rotation","dining_stock"].map(t=>[t,query(dir,"SELECT * FROM "+t+" ORDER BY rowid")]));
}
function schema(dir,mode){
  const db=new DatabaseSync(join(dir,mode+".sqlite"),{readOnly:true});
  try{
    const objects=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const tables=objects.filter(x=>x.type==="table").map(t=>({name:t.name,columns:db.prepare("SELECT * FROM pragma_table_xinfo(?)").all(t.name),foreignKeys:db.prepare("SELECT * FROM pragma_foreign_key_list(?)").all(t.name),indexes:db.prepare("SELECT * FROM pragma_index_list(?)").all(t.name)}));
    for(const t of tables)for(const index of t.indexes)index.columns=db.prepare("SELECT * FROM pragma_index_xinfo(?)").all(index.name);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    console.log("V02_SCHEMA_SUMMARY "+JSON.stringify({mode,tables:tables.length,indexes:objects.filter(x=>x.type==="index").length,triggers:objects.filter(x=>x.type==="trigger").length,views:objects.filter(x=>x.type==="view").length}));
    for(const o of objects)console.log("V02_SCHEMA_OBJECT "+JSON.stringify({mode,...o}));
    for(const t of tables)console.log("V02_SCHEMA_TABLE "+JSON.stringify({mode,...t}));
  }finally{db.close();}
}
async function newPlayer(s){
  await api(s,"character",{name:"V02驗證居民",gender:"other",stats});
  await api(s,"solo/map/starter",{});
  return await api(s,"bank",{action:"deposit",amount:10000});
}
const bath={bathKey:"futuu",requestId:"v02-bath-receipt-01"};
function cli(...args){return execFileSync(process.execPath,["scripts/solo-save.mjs",...args],{cwd,encoding:"utf8",timeout:30000});}

async function wealthySunday(s,dir){
  await newPlayer(s);
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  try{db.exec("UPDATE characters SET money=2000000,bank=1000000");}finally{db.close();}
  await api(s,"state");
  const before=dump(dir);
  assert.equal(before.bank_tax_state[0].assessment_base,3000000);
  assert.equal(before.bank_tax_state[0].snapshot_day,"2026-11-29");
  return before;
}
test("V03 星期一先 GET state 對照：拒絕、稅務、扣款、浴中重啟及重送",{timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-v03-control-"));let s;
  try{
    s=await launch(dir);const before=await wealthySunday(s,dir);
    await s.stop();s=undefined;s=await launch(dir,monday);
    await api(s,"onsen/enter",{...bath,bathKey:"unknown"},400);
    assert.deepEqual(dump(dir),before);
    const state=await api(s,"state"),settled=dump(dir);
    assert.equal(state.character.bank,975000);
    assert.equal(settled.bank_tax_assessments.length,1);
    assert.equal(settled.bank_tax_assessments[0].assessment_base,3000000);
    assert.equal(settled.bank_tax_assessments[0].paid,30000);
    assert.equal(settled.bank_ledger.filter(x=>x.action==="普通存款利息"&&x.credit===5000).length,1);
    const entered=await api(s,"onsen/enter",bath),id=entered.onsen.active.id;
    assert.equal(entered.onsen.active.entry.fee,500);
    assert.equal(entered.character.money,state.character.money-500);
    assert.equal(entered.character.bank,975000);
    const during=dump(dir);
    assert.equal((await api(s,"onsen/enter",bath)).onsenResult.replayed,true);
    await api(s,"bank",{action:"deposit",amount:1},409);
    await api(s,"state");assert.deepEqual(dump(dir),during);
    await s.stop();s=undefined;s=await launch(dir,monday);
    assert.equal((await api(s,"state")).onsen.active.id,id);
    assert.deepEqual(dump(dir),during);
    const exit=await api(s,"onsen/leave",{visitId:id}),after=dump(dir);
    assert.equal(exit.character.bank,975000);assert.equal(exit.onsen.active,null);
    assert.deepEqual(after.bank_tax_assessments,settled.bank_tax_assessments);
    assert.deepEqual(after.bank_ledger,settled.bank_ledger);
    assert.equal((await api(s,"onsen/leave",{visitId:id})).onsenResult.replayed,true);
    assert.deepEqual(dump(dir),after);
    console.log("V03_MONDAY_CONTROL "+JSON.stringify({tax:30000,bank:975000,fee:500,restart:true,replay:true,rejection:true}));
  }finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});

test("V03 星期一直接入浴：真 SQLite 故障回滾、重試、入浴即結算、重啟與重送",{timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-v03-atomic-"));let s;
  try{
    s=await launch(dir);const before=await wealthySunday(s,dir);
    await s.stop();s=undefined;s=await launch(dir,monday);
    const sql=statement=>{const db=new DatabaseSync(join(dir,"solo.sqlite"));try{db.exec(statement);}finally{db.close();}};
    sql("CREATE TRIGGER v03_fail_bath BEFORE INSERT ON onsen_visits BEGIN SELECT RAISE(ABORT,'v03 bath fault'); END;");
    const rejected=await api(s,"onsen/enter",bath,400);
    assert.match(rejected.error,/v03 bath fault/);
    assert.deepEqual(dump(dir),before);
    sql("DROP TRIGGER v03_fail_bath");
    const entered=await api(s,"onsen/enter",bath),id=entered.onsen.active.id,during=dump(dir);
    assert.equal(entered.character.money,1999500);
    assert.equal(entered.character.bank,975000);
    assert.equal(during.bank_tax_assessments.length,1);
    assert.equal(during.bank_tax_assessments[0].assessment_base,3000000);
    assert.equal(during.bank_tax_assessments[0].paid,30000);
    assert.equal(during.bank_tax_state[0].assessment_base,2974500);
    assert.equal(during.bank_ledger.filter(x=>x.action==="普通存款利息"&&x.credit===5000).length,1);
    assert.equal((await api(s,"onsen/enter",bath)).onsenResult.replayed,true);
    await api(s,"bank",{action:"withdraw",amount:1},409);
    assert.deepEqual(dump(dir),during);
    await s.stop();s=undefined;s=await launch(dir,monday);
    assert.equal((await api(s,"state")).onsen.active.id,id);
    assert.deepEqual(dump(dir),during);
    const exit=await api(s,"onsen/leave",{visitId:id}),after=dump(dir);
    assert.equal(exit.character.bank,975000);
    assert.deepEqual(after.bank_tax_assessments,during.bank_tax_assessments);
    assert.deepEqual(after.bank_ledger,during.bank_ledger);
    assert.equal((await api(s,"onsen/leave",{visitId:id})).onsenResult.replayed,true);
    assert.deepEqual(dump(dir),after);
    console.log("V03_DIRECT_ATOMIC "+JSON.stringify({tax:30000,bank:975000,fee:500,faultRollback:true,restart:true,replay:true}));
  }finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});
