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

test("V04 同類風險：跨週日午夜蟑螂領獎不得覆蓋前次稅基",{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-v04-cockroach-tax-"));let s;
  try{
    s=await launch(dir);const before=await wealthySunday(s,dir);
    await s.stop();s=undefined;
    // Controlled fixture uses the actual event core to open the original #44 20-second challenge.
    // Not a naturally occurring event. No reward/receipt injected.
    const {settleDailyIllnessEvent}=await import("../src/events.mjs");
    const start=Date.parse("2026-11-29T23:59:50Z");
    const now=Date.parse("2026-11-30T00:00:05Z");
    const db=new DatabaseSync(join(dir,"solo.sqlite"));
    let eventId;
    try{
      db.exec("PRAGMA foreign_keys=ON; UPDATE characters SET last_event_day='2026-11-28';");
      let rolls=[0,(44-0.5)/44];
      const ev=settleDailyIllnessEvent(db,1,"2026-11-29",start,()=>{assert.ok(rolls.length,"unexpected RNG");return rolls.shift();},"solo");
      assert.equal(ev.originalId,44);
      assert.equal(rolls.length,0);
      const pending=db.prepare("SELECT * FROM character_cockroach_challenges WHERE status='pending'").get();
      assert.equal(pending.started_at,start);assert.equal(pending.expires_at,start+20000);
      eventId=pending.event_id;
    }finally{db.close();}
    assert.equal(dump(dir).bank_tax_state[0].assessment_base,3000000);
    s=await launch(dir,now);
    // Monday's first HTTP request is the valid eventId claim, not a GET state.
    const result=await api(s,"events/cockroach/claim",{eventId});
    const after=dump(dir);
    console.log("V04_MONDAY_COCKROACH "+JSON.stringify({before:before.bank_tax_state[0],after:after.bank_tax_state[0],tax:after.bank_tax_assessments,bank:result.character.bank,reward:result.cockroachResult.reward,expectedTax:30000,expectedBank:975000}));
    assert.equal(result.cockroachResult.status,"caught");
    assert.equal(result.cockroachResult.reward,10001);
    assert.equal(after.bank_tax_assessments.length,1,"星期一跨午夜蟑螂領獎不得跳過每週稅務");
    assert.equal(after.bank_tax_assessments[0].assessment_base,3000000);
    assert.equal(after.bank_tax_assessments[0].paid,30000);
    assert.equal(result.character.bank,975000);
  }finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});
