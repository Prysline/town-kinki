import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
const [baseRoot,candidateRoot]=process.argv.slice(2).map(x=>resolve(x));
const baseline="c18f56e8df68f3c8998c1ba7733500026e34424b", candidate="80ed6bef7a9681efc56d4d5873a98a3bb6bdf4a1";
const git=(root,...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
assert.equal(git(baseRoot,"rev-parse","HEAD"),baseline);
assert.equal(git(baseRoot,"rev-parse","HEAD^{tree}"),"d462bbd51f94066499ff3c1e084d6fa4532ed47e");
// Candidate runtime equals pinned M tree; this V commit only adds the script/workflow/docs.
assert.equal(git(candidateRoot,"rev-parse",candidate+"^{tree}"),"b040fa512cbf478acfa9cf1f00aba4a577163138");
const changed=git(candidateRoot,"diff","--name-only",candidate,"HEAD").split("\n").filter(Boolean);
assert.ok(changed.every(x=>x.startsWith("web/docs/validation/")||x==="web/scripts/v05-jobs-http-differential.mjs"||x===".github/workflows/v05-jobs-http-differential.yml"),changed.join(","));
const t0=Date.parse("2026-11-29T12:00:00Z");
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
async function run(root,dir){
  mkdirSync(dir,{recursive:true});let s;const transcript=[];
  let mode="solo",data=join(dir,mode);mkdirSync(data);
  const add=(label,body)=>transcript.push({label,body,db:dbRead(data,mode),rng:s.rng()});
  async function request(label,path,body,status=200,session=null,headers={}){
    const res=await fetch(s.url+"/api/"+path,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(session?.cookie?{Cookie:session.cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const payload=await res.json();assert.equal(res.status,status,label+" "+JSON.stringify(payload).slice(0,400));
    if(session&&res.headers.get("set-cookie"))session.cookie=res.headers.get("set-cookie").split(";")[0];
    add(label,{status:res.status,payload});return payload;
  }
  const char=()=>dbRun(data,mode,db=>db.prepare("SELECT * FROM characters ORDER BY user_id").all());
  const ledger=()=>dbRun(data,mode,db=>db.prepare("SELECT * FROM bank_ledger ORDER BY id").all());
  const tax=()=>dbRun(data,mode,db=>db.prepare("SELECT * FROM bank_tax_assessments ORDER BY user_id,tax_day").all());
  const sql=statement=>dbRun(data,mode,db=>db.exec(statement));
  try{
    s=await launch(root,data,mode);
    await request("solo create","character",{name:"V05工作",gender:"other",stats});
    await request("solo starter","solo/map/starter",{});
    await request("solo no job","work",{},400);
    await request("solo invalid job","job",{key:"unknown-job"},404);
    await request("solo invalid payment","job/payment",{payment:"credit"},400);
    await request("solo wrong origin","work",{},403,null,{Origin:"https://example.invalid"});
    await request("solo select job","job",{key:"legacy-2"});
    const start=char()[0];
    const cash=await request("solo cash work","work",{});
    assert.ok(cash.result.paid>0);assert.equal(cash.result.payment,"cash");
    assert.equal(cash.character.money,start.money+cash.result.paid+cash.result.bonus);
    await request("solo repeat cooldown","work",{},400);
    await request("solo bank preference","job/payment",{payment:"bank"});
    await request("solo exact cooldown","solo/time/advance",{preset:"5m"});
    const beforeBank=char()[0];
    const bank=await request("solo bank work","work",{});
    assert.equal(bank.result.payment,"bank");assert.equal(bank.character.bank,beforeBank.bank+bank.result.paid+bank.result.bonus);
    // Controlled fifth attendance and 99 XP exercise both existing bonus and salary ledger writes.
    const high=Object.fromEntries(Object.keys(stats).map(k=>[k,200]));
    dbRun(data,mode,db=>db.prepare("UPDATE characters SET job_id='legacy-3',job_work_count=4,work_progress=4,job_experience=99,stats_json=?,body_energy=120,brain_energy=120,last_work_at=0,health_index=50").run(JSON.stringify(high)));
    await request("solo dual payment fixture","state");
    const pre=dbRead(data,mode),beforeLedger=ledger().length;
    sql("CREATE TRIGGER v05_fail_salary BEFORE INSERT ON bank_ledger WHEN NEW.action='工作薪資' BEGIN SELECT RAISE(ABORT,'v05 salary fault'); END;");
    const fault=await request("solo second ledger fault","work",{},400);assert.match(fault.error,/v05 salary fault/);
    sql("DROP TRIGGER v05_fail_salary");assert.deepEqual(dbRead(data,mode),pre);
    const success=await request("solo retry dual payment","work",{});
    assert.equal(success.result.leveledUp,true);assert.ok(success.result.bonus>0&&success.result.paid>0);
    assert.deepEqual(ledger().slice(beforeLedger).map(x=>x.action),["升級獎金","工作薪資"]);
    await request("solo duplicate work rejected","work",{},400);
    // Monday first request, prior saved tax base. Existing work settlement is separate
    // from the later rejected character transaction; preserve rather than redesign it.
    const monday=t0+86400000;
    dbRun(data,mode,db=>db.prepare("UPDATE characters SET money=2000000,bank=1000000,kpoint=0,last_work_at=?").run(monday-120000));
    await request("solo Sunday tax base","state");
    const prior=char()[0];
    assert.equal(dbRun(data,mode,db=>db.prepare("SELECT assessment_base FROM bank_tax_state").get().assessment_base),3000000);
    await s.stop();s=undefined;s=await launch(root,data,mode,monday-300000);
    const refused=await request("solo Monday first cooldown rejection","work",{},400);
    assert.match(refused.error,/還需要等待/);
    assert.deepEqual(char()[0],{...prior,bank:975000});
    assert.equal(tax().length,1);assert.equal(tax()[0].assessment_base,3000000);assert.equal(tax()[0].paid,30000);
    await request("solo Monday repeat rejection","work",{},400);
    assert.equal(tax().length,1);assert.equal(char()[0].bank,975000);
    await request("solo Monday state","state");
    await request("solo Monday advance","solo/time/advance",{preset:"5m"});
    await request("solo Monday successful work","work",{});
    assert.equal(tax().length,1);
    const saved=ledger();
    await s.stop();s=undefined;s=await launch(root,data,mode,monday-300000);
    await request("solo restart state","state");assert.deepEqual(ledger(),saved);
    const bath=await request("solo bath","onsen/enter",{bathKey:"futuu",requestId:"v05_work_bath_01"});
    await request("solo bath work guard","work",{},409);
    await request("solo bath payment guard","job/payment",{payment:"cash"},409);
    await request("solo bath exit","onsen/leave",{visitId:bath.onsen.active.id});
    await s.stop();s=undefined;
    mode="multi";data=join(dir,mode);mkdirSync(data);s=await launch(root,data,mode);
    await request("multi anonymous","work",{},401);
    const u={},v={};
    await request("multi register A","register",{username:"v05alice",password:"V05-test-password-A"},200,u);
    await request("multi register B","register",{username:"v05bob",password:"V05-test-password-B"},200,v);
    await request("multi create A","character",{name:"V05甲",gender:"other",stats},200,u);
    await request("multi create B","character",{name:"V05乙",gender:"other",stats},200,v);
    await request("multi A select","job",{key:"legacy-2"},200,u);
    await request("multi B select","job",{key:"legacy-2"},200,v);
    await request("multi A bank preference","job/payment",{payment:"bank"},200,u);
    const beforeB=char()[1];
    const a=await request("multi A work","work",{},200,u);
    assert.equal(a.result.payment,"bank");
    assert.deepEqual(char()[1],beforeB);
    const beforeA=char()[0];
    const b=await request("multi B work","work",{},200,v);
    assert.equal(b.result.payment,"cash");
    assert.deepEqual(char()[0],beforeA);
    await request("multi A cooldown","work",{},400,u);
    await request("multi forbidden clock","solo/time/advance",{preset:"5m"},403,v);
    await s.stop();s=undefined;s=await launch(root,data,mode,t0+300000);
    await request("multi restart A","state",undefined,200,u);
    await request("multi restart B","state",undefined,200,v);
    await request("multi A boundary work","work",{},200,u);
    return transcript;
  }finally{if(s)await s.stop();}
}
const root=mkdtempSync(join(tmpdir(),"town-v05-jobs-diff-"));
try{
  const a=await run(baseRoot,join(root,"baseline"));
  const b=await run(candidateRoot,join(root,"candidate"));
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){
    assert.equal(a[i].label,b[i].label);
    assert.deepEqual(b[i].body,a[i].body,"HTTP "+a[i].label);
    assert.deepEqual(b[i].db,a[i].db,"SQLite "+a[i].label);
    assert.deepEqual(b[i].rng,a[i].rng,"RNG "+a[i].label);
    console.log("V05_WORK_DIFF_STEP "+a[i].label);
  }
  console.log("V05_WORK_DIFF "+JSON.stringify({baseline,candidate,steps:a.length,http:true,sqlite:true,rng:true,solo:true,multi:true,mondayTax:true,ledgerFault:true,controlled:true,human:false}));
}finally{rmSync(root,{recursive:true,force:true});}
