import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";

const cwd=fileURLToPath(new URL("..",import.meta.url));
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
  try{return {character:db.prepare("SELECT money,bank,body_energy,brain_energy,recovered_at,stats_json FROM characters").get(),visits:db.prepare("SELECT * FROM onsen_visits ORDER BY id").all(),ledger:db.prepare("SELECT * FROM bank_ledger ORDER BY rowid").all(),tax:db.prepare("SELECT * FROM bank_tax_state ORDER BY rowid").all(),events:db.prepare("SELECT * FROM character_events ORDER BY rowid").all(),fk:db.prepare("PRAGMA foreign_key_check").all()};}
  finally{db.close();}
}
test("V01 正式玩家入口自動化：新角色工作、銀行、普通浴池、重啟、收據及續玩（真 RNG／無 DB 注入）",{timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-v01-"));
  let s;
  try{
    s=await launch(dir);
    await api(s,"character",{name:"V01驗證居民",gender:"other",stats});
    const map=await api(s,"solo/map/starter",{});
    assert.equal(map.onsen.available,true);
    await api(s,"job",{key:"legacy-2"});
    const worked=await api(s,"work",{});
    assert.ok(worked.result.paid>0);
    const deposited=await api(s,"bank",{action:"deposit",amount:1000});
    assert.equal(deposited.character.bank,worked.character.bank+1000);
    assert.equal(deposited.character.money,worked.character.money-1000);
    // A natural timed event, if present, is not silently bypassed or rerolled.
    const request={bathKey:"futuu",requestId:"v01-normal-bath-001"};
    const entry=await api(s,"onsen/enter",request);
    assert.equal(entry.onsen.active.entry.fee,500);
    assert.equal(entry.onsen.active.entry.rate,10);
    assert.equal(entry.character.money,deposited.character.money-500);
    assert.equal(entry.character.bank,deposited.character.bank);
    const id=entry.onsen.active.id, before=stored(dir);
    await api(s,"bank",{action:"withdraw",amount:1},409);
    assert.equal((await api(s,"onsen/enter",request)).onsenResult.replayed,true);
    assert.deepEqual(stored(dir),before);
    await s.stop();s=undefined;s=await launch(dir);
    assert.equal((await api(s,"state")).onsen.active.id,id);
    assert.deepEqual(stored(dir),before);
    const left=await api(s,"onsen/leave",{visitId:id});
    assert.equal(left.onsen.active,null);
    assert.equal(left.character.money,entry.character.money);
    assert.equal(left.character.bank,entry.character.bank);
    assert.equal((await api(s,"onsen/leave",{visitId:id})).onsenResult.replayed,true);
    const after=stored(dir);
    assert.equal(after.visits.length,1);
    assert.notEqual(after.visits[0].completed_at,null);
    assert.deepEqual(after.ledger,before.ledger);
    assert.deepEqual(after.events,before.events);
    assert.deepEqual(after.fk,[]);
    const continued=await api(s,"bank",{action:"withdraw",amount:100});
    assert.equal(continued.character.bank,left.character.bank-100);
    assert.equal(continued.character.money,left.character.money+100);
    console.log("V01_PLAYER "+JSON.stringify({timezone,workPaid:worked.result.paid,bathFee:500,restart:true,replay:true,continued:true,naturalRng:true,human:false}));
  }finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});
