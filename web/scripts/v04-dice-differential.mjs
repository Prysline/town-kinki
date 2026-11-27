import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
const [baseRoot,candidateRoot]=process.argv.slice(2).map(x=>resolve(x));
const baseline="c18f56e8df68f3c8998c1ba7733500026e34424b", candidate="eda610cc63ef07eb32bce331a8dda3d3c1d2492b";
const git=(root,...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
assert.equal(git(baseRoot,"rev-parse","HEAD"),baseline);
assert.equal(git(baseRoot,"rev-parse","HEAD^{tree}"),"d462bbd51f94066499ff3c1e084d6fa4532ed47e");
// Candidate runtime equals pinned M tree; this V commit only adds the script/workflow/docs.
assert.equal(git(candidateRoot,"rev-parse",candidate+"^{tree}"),"9860b406a4d37473fe84c03ad777487b97d12561");
const changed=git(candidateRoot,"diff","--name-only",candidate,"HEAD").split("\n").filter(Boolean);
assert.ok(changed.every(x=>x.startsWith("web/docs/validation/")||x==="web/scripts/v04-dice-differential.mjs"||x===".github/workflows/v04-dice-differential.yml"),changed.join(","));
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
    add(label,{status:res.status,payload});console.log("V04_EXEC "+label);return payload;
  }
  const first={guess:"even",stake:10000,requestId:"v04_dice_round_01"};
  const second={guess:"odd",stake:10000,requestId:"v04_dice_round_02"};
  const cash=()=>dbRun(data,mode,db=>db.prepare("SELECT user_id,money,bank,kpoint FROM characters ORDER BY user_id").all());
  const rounds=()=>dbRun(data,mode,db=>db.prepare("SELECT * FROM arcade_dice_rounds ORDER BY id").all());
  const sql=statement=>dbRun(data,mode,db=>db.exec(statement));
  try{
    s=await launch(root,data,mode);
    await request("solo create","character",{name:"V04骰子",gender:"other",stats});
    await request("solo starter","solo/map/starter",{});
    sql("UPDATE characters SET money=200000");
    const initial=await request("solo initial","state");
    assert.equal(initial.arcadeDice.available,true);
    assert.equal(initial.character.money,200000);
    await request("solo bad origin","arcade/dice/play",first,403,null,{Origin:"https://example.invalid"});
    await request("solo wrong method","arcade/dice/play",undefined,404);
    await request("solo invalid stake","arcade/dice/play",{...first,stake:123},400);
    await request("solo insufficient","arcade/dice/play",{...first,stake:1000000},400);
    assert.equal(rounds().length,0);
    writeFileSync(join(data,"v04-next-die"),"0");
    const a=await request("solo win","arcade/dice/play",first);
    assert.equal(a.arcadeDiceResult.won,true);assert.equal(a.character.money,210000);
    assert.equal(a.arcadeDiceResult.dieOne,1);assert.equal(a.arcadeDiceResult.dieTwo,1);
    const saved=cash();
    assert.equal((await request("solo replay","arcade/dice/play",first)).arcadeDiceResult.replayed,true);
    await request("solo receipt conflict","arcade/dice/play",{...first,guess:"odd"},400);
    await request("solo cooldown","arcade/dice/play",second,400);
    assert.deepEqual(cash(),saved);assert.equal(rounds().length,1);
    await request("solo advance exact boundary","solo/time/advance",{preset:"5m"});
    writeFileSync(join(data,"v04-next-die"),"1");
    const b=await request("solo second","arcade/dice/play",{...second,guess:"even"});
    assert.equal(b.arcadeDiceResult.dieOne,1);assert.equal(b.arcadeDiceResult.dieTwo,2);assert.equal(b.arcadeDiceResult.won,false);assert.equal(b.character.money,200000);
    await request("solo advance for fault","solo/time/advance",{preset:"5m"});
    const pre=dbRead(data,mode);
    sql("CREATE TRIGGER v04_fault BEFORE INSERT ON arcade_dice_rounds BEGIN SELECT RAISE(ABORT,'v04 rollback'); END;");
    writeFileSync(join(data,"v04-next-die"),"35");
    await request("solo SQL fault","arcade/dice/play",{...first,requestId:"v04_dice_fault_03"},400);
    sql("DROP TRIGGER v04_fault");assert.deepEqual(dbRead(data,mode),pre);
    writeFileSync(join(data,"v04-next-die"),"7");
    await request("solo retry after fault","arcade/dice/play",{...first,requestId:"v04_dice_fault_03"});
    assert.equal(rounds().length,3);
    await s.stop();s=undefined;s=await launch(root,data,mode);
    const restored=await request("solo restart","state");assert.equal(restored.arcadeDice.history.length,3);
    assert.equal((await request("solo replay after restart","arcade/dice/play",first)).arcadeDiceResult.replayed,true);
    const bath=await request("solo bath","onsen/enter",{bathKey:"futuu",requestId:"v04_dice_bath_01"});
    assert.equal(bath.onsen.active.entry.fee,500);
    await request("solo bath guard","arcade/dice/play",first,409);
    await request("solo bath exit","onsen/leave",{visitId:bath.onsen.active.id});
    const mapRows=dbRun(data,mode,db=>db.prepare("SELECT * FROM town_maps").all());
    await s.stop();s=undefined;
    mode="multi";data=join(dir,mode);mkdirSync(data);s=await launch(root,data,mode);
    await request("multi anonymous","arcade/dice/play",first,401);
    const u={},v={};
    await request("multi register A","register",{username:"v04alice",password:"V04-test-password-A"},200,u);
    await request("multi register B","register",{username:"v04bob",password:"V04-test-password-B"},200,v);
    await request("multi character A","character",{name:"V04甲",gender:"other",stats},200,u);
    await request("multi character B","character",{name:"V04乙",gender:"other",stats},200,v);
    // Controlled map fixture copied from the actual solo starter, not a live multiplayer edit.
    dbRun(data,mode,db=>{
      const ins=db.prepare("INSERT OR REPLACE INTO town_maps(town_id,original_name,original_record,source,tiles_json,updated_at) VALUES(?,?,?,?,?,?)");
      for(const m of mapRows)ins.run(m.town_id,m.original_name,m.original_record,m.source,m.tiles_json,m.updated_at);
      db.exec("UPDATE characters SET money=200000");
    });
    await request("multi A state","state",undefined,200,u);
    await request("multi B state","state",undefined,200,v);
    const before=cash();
    await request("multi A play","arcade/dice/play",first,200,u);
    assert.deepEqual(cash()[1],before[1]);
    await request("multi B same receipt","arcade/dice/play",first,200,v);
    assert.equal(rounds().length,2);assert.notEqual(rounds()[0].user_id,rounds()[1].user_id);
    await request("multi A replay","arcade/dice/play",first,200,u);
    await request("multi B conflict","arcade/dice/play",{...first,guess:"odd"},400,v);
    await request("multi forbidden fast-forward","solo/time/advance",{preset:"5m"},403,u);
    await s.stop();s=undefined;s=await launch(root,data,mode,t0+300000);
    await request("multi restart A","state",undefined,200,u);
    await request("multi restart B","state",undefined,200,v);
    await request("multi A boundary play","arcade/dice/play",second,200,u);
    assert.equal(rounds().length,3);
    return transcript;
  }finally{if(s)await s.stop();}
}
const root=mkdtempSync(join(tmpdir(),"town-v04-diff-"));
try{
  const a=await run(baseRoot,join(root,"baseline"));
  const b=await run(candidateRoot,join(root,"candidate"));
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){
    assert.equal(a[i].label,b[i].label);
    // Full payload/DB including all tables/schema/session rows and RNG call sequence;
    // only ephemeral HTTP origin and cookie headers are not compared, no payload fields dropped.
    assert.deepEqual(b[i].body,a[i].body,"HTTP "+a[i].label);
    assert.deepEqual(b[i].db,a[i].db,"SQLite "+a[i].label);
    assert.deepEqual(b[i].rng,a[i].rng,"RNG "+a[i].label);
    console.log("V04_DIFF_STEP "+a[i].label);
  }
  console.log("V04_DICE_DIFF "+JSON.stringify({baseline,candidate,steps:a.length,http:true,sqlite:true,rng:true,solo:true,multi:true,controlled:true,human:false}));
}finally{rmSync(root,{recursive:true,force:true});}
