// A-side regression derived from V #154, HEAD 3cec5aa, original assertions retained.
// This is controlled HTTP reproduction, not independent V sign-off.
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
async function newPlayer(s){
  await api(s,"character",{name:"V02驗證居民",gender:"other",stats});
  await api(s,"solo/map/starter",{});
  return await api(s,"bank",{action:"deposit",amount:10000});
}
const bath={bathKey:"futuu",requestId:"v02-bath-receipt-01"};
test("AP-05 V02 regression: 週一首次請求直接入浴不得消除前次稅基及應繳稅",{timeout:60000},async()=>{
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
    assert.equal(middle.bank_tax_assessments.length,1,"先於入浴費及新稅基結算");
    assert.equal(middle.bank_tax_assessments[0].assessment_base,3000000);
    assert.equal(middle.bank_tax_assessments[0].paid,30000);
    assert.equal(entered.character.bank,975000);
    assert.equal((await api(s,"onsen/enter",bath)).onsenResult.replayed,true);
    assert.deepEqual(dump(dir),middle);
    const left=await api(s,"onsen/leave",{visitId:entered.onsen.active.id});
    const after=dump(dir);
    console.log("V02_MONDAY_ENTRY "+JSON.stringify({before:before.bank_tax_state[0],during:middle.bank_tax_state[0],after:after.bank_tax_state[0],tax:after.bank_tax_assessments,bank:left.character.bank,interestDay:after.bank_accounts[0].last_interest_day,expectedTax:30000,expectedBank:975000}));
    assert.equal(after.bank_tax_assessments.length,1,"星期一首次入浴不得跳過每週稅務");
    assert.equal(after.bank_tax_assessments[0].assessment_base,3000000);
    assert.equal(after.bank_tax_assessments[0].paid,30000);
    assert.equal(left.character.bank,975000);
    assert.equal((await api(s,"onsen/leave",{visitId:entered.onsen.active.id})).onsenResult.replayed,true);
    assert.deepEqual(dump(dir),after);
  }finally{if(s)await s.stop();rmSync(dir,{recursive:true,force:true});}
});
