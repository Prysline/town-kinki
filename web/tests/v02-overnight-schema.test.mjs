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
test("V02 受控跨日：浴中不結算、真 CLI WAL 備份還原、星期一出浴計息稅務一次、健康事件與續玩",{timeout:90000},async()=>{
  const root=mkdtempSync(join(tmpdir(),"town-v02-")),dir=join(root,"original"),restored=join(root,"restored"),file=join(root,"bath.sqlite");
  let s;
  try{
    s=await launch(dir);
    await newPlayer(s);
    const entry=await api(s,"onsen/enter",bath),id=entry.onsen.active.id;
    assert.equal(entry.onsen.active.entry.fee,500);
    const before=dump(dir);
    assert.equal(before.bank_accounts[0].last_interest_day,"2026-11-29");
    const advanced=await api(s,"solo/time/advance",{preset:"1d"});
    assert.equal(advanced.gameTimeMs,monday);
    assert.equal(advanced.onsen.active.id,id);
    assert.deepEqual(dump(dir),before);
    cli("backup","--data-dir",dir,"--output",file);cli("verify","--file",file);
    await s.stop();s=undefined;
    cli("restore","--file",file,"--data-dir",restored);
    assert.deepEqual(dump(restored),before);
    s=await launch(restored);
    assert.equal((await api(s,"state")).onsen.active.id,id);
    assert.deepEqual(dump(restored),before);
    const exit=await api(s,"onsen/leave",{visitId:id});
    assert.equal(exit.onsen.active,null);
    assert.equal(exit.onsenResult.exit.bodyEnergy,21);
    assert.equal(exit.onsenResult.exit.brainEnergy,23);
    assert.equal(exit.character.bank,10050);
    const after=dump(restored);
    assert.equal(after.bank_accounts[0].last_interest_day,"2026-11-30");
    assert.equal(after.bank_ledger.filter(x=>x.action==="普通存款利息").length,1);
    assert.equal(after.bank_tax_assessments.length,1);
    assert.equal(after.bank_tax_assessments[0].tax_day,"2026-11-30");
    assert.equal(after.bank_tax_assessments[0].assessment_base,before.bank_tax_state[0].assessment_base);
    assert.equal(after.characters[0].last_health_day,"2026-11-30");
    assert.equal(after.characters[0].last_event_day,"2026-11-30");
    assert.equal(after.character_events.length,before.character_events.length);
    assert.equal((await api(s,"onsen/leave",{visitId:id})).onsenResult.replayed,true);
    await api(s,"state");
    assert.deepEqual(dump(restored),after);
    assert.deepEqual(dump(dir),before);
    schema(restored,"solo");
    console.log("V02_CROSS_DAY "+JSON.stringify({interest:50,taxAssessment:1,healthDay:"2026-11-30",eventDay:"2026-11-30",backupRestore:true,replay:true,sourceUnchanged:true,controlled:true}));
  }finally{if(s)await s.stop();rmSync(root,{recursive:true,force:true});}
});
test("V02 真實多人初始化 schema、索引、外鍵與完整性清冊",{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-v02-multi-"));
  let s;
  try{s=await launch(dir,sunday,"multi");await api(s,"state");schema(dir,"multi");}
  finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});
// Strict diagnostic, not a changed game rule. Monday's first direct POST must not erase
// Sunday's assessed base before the already-existing weekly assessment runs.
test("V02 缺陷重現候選：週一首次請求直接入浴不得消除前次稅基及應繳稅",{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-v02-tax-"));
  let s;
  try{
    s=await launch(dir);
    await newPlayer(s);
    // Controlled wealthy fixture solely to make the existing tax obligation nonzero.
    const db=new DatabaseSync(join(dir,"solo.sqlite"));
    try{db.exec("UPDATE characters SET money=2000000,bank=1000000");}finally{db.close();}
    await api(s,"state");
    const before=dump(dir);
    assert.equal(before.bank_tax_state[0].assessment_base,3000000);
    assert.equal(before.bank_tax_state[0].snapshot_day,"2026-11-29");
    await s.stop();s=undefined;
    s=await launch(dir,monday);
    // No GET /api/state before direct POST. All money operations use actual server handlers.
    const entered=await api(s,"onsen/enter",bath);
    const middle=dump(dir);
    const left=await api(s,"onsen/leave",{visitId:entered.onsen.active.id});
    const after=dump(dir);
    console.log("V02_MONDAY_ENTRY "+JSON.stringify({before:before.bank_tax_state[0],during:middle.bank_tax_state[0],after:after.bank_tax_state[0],tax:after.bank_tax_assessments,bank:left.character.bank,interestDay:after.bank_accounts[0].last_interest_day,expectedTax:30000,expectedBank:975000}));
    assert.equal(after.bank_tax_assessments.length,1,"星期一首次入浴不得跳過每週稅務");
    assert.equal(after.bank_tax_assessments[0].assessment_base,3000000);
    assert.equal(after.bank_tax_assessments[0].paid,30000);
    assert.equal(left.character.bank,975000);
  }finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});
