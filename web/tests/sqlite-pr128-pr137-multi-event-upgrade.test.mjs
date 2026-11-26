import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, copyFileSync, constants, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash, scryptSync } from "node:crypto";
import {initBankTables,settleBankInterest} from "../src/banking.mjs";
import {decodeLegacyText,STAT_KEYS} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initCharacterEvents,settleDailyIllnessEvent} from "../src/events.mjs";
import {initCharacterEvents as initOldEvents,settleDailyIllnessEvent as settleOld} from "./fixtures/j4c-pr128/events.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {initCouponRedemptionTables,redeemEventCoupon} from "../src/coupon-redemption.mjs";
import {parseLegacyCouponCatalog} from "../src/coupon-catalog.mjs";
import {SANTA_FIGHT_ITEMS} from "../src/event-santa-fight.mjs";
import {calendarDay} from "../src/training.mjs";
import {initStreetFightTables,playStreetFight} from "../src/street-fight.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));

function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dir,npcRoot,policy="auto",timezone="Asia/Taipei"){
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"multi",HOST:"127.0.0.1",PORT:"0",DATA_DIR:dir,OSAKA_NPC_ROOT:npcRoot,OSAKA_NPC_POLICY:policy,GAME_TIMEZONE:timezone,COOKIE_SECURE:"0"}
  });
  let log="",stdout="";
  child.stdout.on("data",x=>{stdout+=x;log+=x;});
  child.stderr.on("data",x=>log+=x);
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    const url=stdout.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)\r?\n/m)?.[1];
    if(!url){await delay(100);continue;}
    try{
      const response=await fetch(url+"/api/state",{signal:AbortSignal.timeout(350)});
      if(response.ok){
        return {url,async stop(){
          if(child.exitCode!==null)return;
          const ended=new Promise(ok=>child.once("exit",ok));
          child.kill();await Promise.race([ended,delay(1500)]);
        }};
      }
    }catch{}
    await delay(100);
  }
  child.kill();throw new Error("升級後 Web 伺服器未啟動："+log);
}
async function api(url,route,body,cookie){
  const res=await fetch(url+"/api/"+route,{
    method:body===undefined?"GET":"POST",
    headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(cookie?{Cookie:cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:res.status,result:await res.json(),cookie:res.headers.get("set-cookie")?.split(";")[0]};
}



// #128 與 #137 server 核心 DDL 完全相同，逐欄初始化原樣保留。
function initHistoricalCore(db){
db.exec([
  "PRAGMA journal_mode=WAL;",
  "PRAGMA foreign_keys=ON;",
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL UNIQUE, gender TEXT NOT NULL, town_id INTEGER NOT NULL, money INTEGER NOT NULL, bank INTEGER NOT NULL, body_energy INTEGER NOT NULL, brain_energy INTEGER NOT NULL, recovered_at INTEGER NOT NULL, job_id TEXT, work_progress INTEGER NOT NULL, last_work_at INTEGER NOT NULL, work_count INTEGER NOT NULL, height INTEGER NOT NULL, bmi REAL NOT NULL, stats_json TEXT NOT NULL);"
].join("\n"));

// 舊版雛形資料庫可直接升級，避免已建立的角色在更新後無法讀取。
for (const [column, definition] of [
  ["weight", "REAL NOT NULL DEFAULT 60"],
  ["job_experience", "INTEGER NOT NULL DEFAULT 0"],
  ["job_work_count", "INTEGER NOT NULL DEFAULT 0"],
  ["mastered_job", "TEXT"],
  ["last_school_day", "TEXT NOT NULL DEFAULT ''"],
  ["last_gym_at", "INTEGER NOT NULL DEFAULT 0"],
  ["classroom_ready_at", "INTEGER NOT NULL DEFAULT 0"],
  ["salary_payment", "TEXT NOT NULL DEFAULT 'cash'"],
  ["gym_ready_at", "INTEGER NOT NULL DEFAULT 0"],
  ["created_at", "INTEGER NOT NULL DEFAULT 0"],
  ["last_meal_at", "INTEGER NOT NULL DEFAULT 0"],
  ["health_index", "INTEGER NOT NULL DEFAULT 50"],
  ["last_health_day", "TEXT NOT NULL DEFAULT ''"],
  ["last_event_day", "TEXT NOT NULL DEFAULT ''"],
  ["kpoint", "INTEGER NOT NULL DEFAULT 0"]
]) {
  const currentColumns = db.prepare("PRAGMA table_info(characters)").all();
  if (!currentColumns.some(info => info.name === column)) {
    db.exec("ALTER TABLE characters ADD COLUMN " + column + " " + definition);
  }
}
}


const catalog=parseLegacyCouponCatalog(decodeLegacyText(readFileSync(new URL("../../dat_dir/coupon.cgi",import.meta.url))));
const coupon={sourceIndex:0,originalName:"福引券",requestId:"j4c_shared_coupon"};
const username=id=>"j4c_fixture_"+id,password=id=>"j4c-fixture-password-"+id,token=id=>"j4c-historical-session-token-000"+id,cookie=id=>"town_web_session="+token(id);
const hash=value=>createHash("sha256").update(value).digest("hex"),fileHash=file=>hash(readFileSync(file));
const plain=rows=>rows.map(x=>({...x}));
const tables=["character_events","character_coupons","character_cockroach_challenges","coupon_redemptions","legacy_inventory_imports","legacy_inventory_items","legacy_item_usage","legacy_item_use_history","bank_accounts","bank_loans","bank_tax_state","bank_tax_assessments","bank_ledger","bank_transfers"];
const rows=(db,table)=>plain(db.prepare("SELECT * FROM "+table+" ORDER BY rowid").all());
const char=(db,id)=>({...db.prepare("SELECT * FROM characters WHERE user_id=?").get(id)});
const tax=(db,id)=>db.prepare("SELECT assessment_base FROM bank_tax_state WHERE user_id=?").get(id).assessment_base;
const remaining=(db,id,line)=>db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=? AND source_line=?").get(id,line)?.remaining;
const all=db=>({characters:rows(db,"characters"),...Object.fromEntries(tables.map(t=>[t,rows(db,t)]))});
const ledger=(db,id)=>rows(db,"bank_ledger").filter(x=>x.user_id===id);
const histories=(db,id)=>rows(db,"character_events").filter(x=>x.user_id===id);
const latest=(db,id)=>JSON.parse(histories(db,id).at(-1).effects_json);
const total=db=>rows(db,"characters").reduce((sum,c)=>sum+c.money+c.bank,0);
const rng=(...v)=>()=>{assert.ok(v.length,"unexpected random draw");return v.shift();};
function trigger(core,db,user,id,day,now,choices=[]){
  const result=core(db,user,day,now,rng(0,(id-.5)/44,...choices),"multi");
  assert.equal(result.event.originalId,id);
  return result;
}
function integrity(db){
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
}
function read(file,fn){const db=new DatabaseSync(file,{readOnly:true});try{return fn(db);}finally{db.close();}}
function archive(db,id,line,raw,now){
  const fields=[...raw];fields[30]=String(Math.floor(now/1000));
  insert(db,"legacy_inventory_items",{user_id:id,original_id:"synthetic-j4c-"+id,source_line:line,category:fields[0],original_name:fields[1],effect:fields[9],durability:Number(fields[21]),durability_unit:fields[22],purchased_at:Number(fields[30]),last_used_at:0,raw_fields_json:JSON.stringify(fields)});
}
function seed(db,variant,t){
  initHistoricalCore(db);initTownMapTable(db);initBankTables(db);
  const historical=variant==="pre"?settleOld:settleDailyIllnessEvent;
  (variant==="pre"?initOldEvents:initCharacterEvents)(db);
  initLegacyItemUseTables(db);initCouponRedemptionTables(db);
  db.exec("PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE);");
  const mainHash=fileHash(t.sourceFile);
  for(const id of [1,2,3]){
    const salt="j4c-fixture-salt-"+id;
    insert(db,"users",{id,username:username(id),password_salt:salt,password_hash:scryptSync(password(id),salt,64).toString("hex"),created_at:t.at-10*86400000});
    insert(db,"sessions",{token_hash:hash(token(id)),user_id:id,expires_at:t.now+7*86400000});
    insert(db,"characters",{id,user_id:id,name:"J4多人"+id,gender:"other",town_id:0,money:id===2?1000:150000,bank:id===3?50000:100000,body_energy:25,brain_energy:35,recovered_at:t.at,job_id:null,work_progress:0,last_work_at:0,work_count:0,height:165,bmi:22,stats_json:JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,20]))),weight:60,created_at:t.at-10*86400000,last_health_day:t.today,last_event_day:t.earlier,kpoint:id===1?-5:0});
    insert(db,"bank_accounts",{user_id:id,term_balance:0,last_interest_day:t.yesterday});
    insert(db,"bank_tax_state",{user_id:id,assessment_base:char(db,id).money+char(db,id).bank,snapshot_day:t.yesterday});
    insert(db,"bank_ledger",{user_id:id,account_type:"ordinary",action:"存入",debit:0,credit:char(db,id).bank,balance:char(db,id).bank,created_at:t.at-86400000});
    insert(db,"character_coupons",{user_id:id,quantity:5});
  }
  const tiles=Array(192).fill("");tiles[0]="クーポン";storeTownMap(db,0,{tiles},"web-edited");
  const camera=Array(33).fill("0");camera[0]="日用品";camera[1]="防犯カメラ";camera[9]="無";camera[21]="4";camera[22]="回";
  archive(db,1,10,camera,t.at-1000);
  archive(db,1,11,SANTA_FIGHT_ITEMS[0],t.at-1000);
  archive(db,1,12,SANTA_FIGHT_ITEMS[1],t.at-1000);
  archive(db,2,11,SANTA_FIGHT_ITEMS[0],t.at-1000);
  archive(db,2,12,SANTA_FIGHT_ITEMS[1],t.at-1000);
  archive(db,3,31,SANTA_FIGHT_ITEMS[0],t.at-1000);
  for(const id of [1,2]){
    const result=redeemEventCoupon(db,id,catalog,{...coupon,now:t.at-1000});
    assert.equal(result.sourceLine,6000000);assert.equal(result.replayed,false);
  }
  trigger(historical,db,1,16,t.yesterday,t.at,[0]);
  assert.equal(char(db,1).bank,80000);assert.equal(remaining(db,1,10),2);
  assert.equal(tax(db,1),variant==="pre"?250000:230000,"#128 事件交易尚未刷新 #16 稅基；#137 已修正");
  if(variant==="post"){
    trigger(historical,db,2,36,t.yesterday,t.at,[0,0,.99]);
    assert.equal(latest(db,2).transfer.status,"transferred");assert.equal(char(db,2).money,1002);assert.equal(char(db,2).kpoint,-3);
    trigger(historical,db,3,40,t.yesterday,t.at,[0,.99]);
    assert.equal(latest(db,3).money,-500);assert.equal(latest(db,3).riverItem.status,"awarded");
  }else{
    for(const id of [2,3])assert.equal(historical(db,id,t.yesterday,t.at,rng(.99),"multi").event,null);
  }
  integrity(db);assert.equal(fileHash(t.sourceFile),mainHash);assert.ok(statSync(t.sourceFile+"-wal").size>0);
  return mainHash;
}
function preserve(before,after){
  for(const table of ["character_events","coupon_redemptions","legacy_inventory_items","bank_ledger","bank_tax_assessments"]){
    const keys=table==="bank_tax_assessments"?["user_id","tax_day"]:["id"];
    assert.deepEqual(after[table].filter(x=>before[table].some(y=>keys.every(k=>x[k]===y[k]))),before[table],table+" 歷史不應改寫");
  }
}
function actor(state,id){
  return Object.fromEntries(Object.entries(state).map(([table,items])=>[table,items.filter(x=>x.user_id===id)]));
}
async function ok(web,route,body,id){const res=await api(web.url,route,body,cookie(id));assert.equal(res.status,200,JSON.stringify(res.result));return res.result;}
for(const variant of ["pre","post"])test("J-4c："+variant+" I 歷史多人 WAL、事件金流/K/稅基、兩笛、HTTP 隔離與故障回滾",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-j4c-"+variant+"-"));
  const sourceDir=join(work,"source"),targetDir=join(work,"restored"),sourceFile=join(sourceDir,"multi.sqlite"),snapshot=join(work,"snapshot.sqlite"),target=join(targetDir,"multi.sqlite");
  const now=Date.now(),timezone=["Asia/Taipei","UTC","America/Los_Angeles"].find(timeZone=>{
    const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone,hour:"2-digit",hourCycle:"h23"}).format(now));return hour>=6&&hour<18;
  });
  assert.ok(timezone);
  const t={now,timezone,today:calendarDay(now,timezone),yesterday:calendarDay(now-86400000,timezone),earlier:calendarDay(now-2*86400000,timezone),at:now-86400000,sourceFile};
  let source=null,db=null,web=null;
  try{
    mkdirSync(sourceDir);source=new DatabaseSync(sourceFile);
    const mainHash=seed(source,variant,t),walHash=fileHash(sourceFile+"-wal"),before=all(source);
    const reader=new DatabaseSync(sourceFile,{readOnly:true});
    try{await backup(reader,snapshot);}finally{reader.close();}
    const snapshotHash=fileHash(snapshot);
    mkdirSync(targetDir);copyFileSync(snapshot,target,constants.COPYFILE_EXCL);
    assert.throws(()=>copyFileSync(snapshot,target,constants.COPYFILE_EXCL),/EEXIST/);assert.equal(fileHash(target),snapshotHash);
    read(target,x=>{integrity(x);assert.deepEqual(all(x),before);assert.equal(tax(x,1),variant==="pre"?250000:230000);});
    db=new DatabaseSync(target);db.exec("PRAGMA foreign_keys=ON;");
    initBankTables(db);initCharacterEvents(db);initLegacyItemUseTables(db);initCouponRedemptionTables(db);
    assert.deepEqual(all(db),before);
    for(const id of [1,2,3]){
      settleBankInterest(db,id,t.today,now);
      assert.equal(tax(db,id),char(db,id).money+char(db,id).bank);
    }
    const settled=all(db);
    const eventId=variant==="pre"?36:37,line=variant==="pre"?11:12,choices=variant==="pre"?[.19999,0,.99]:[.999999,0,.99],delta=variant==="pre"?20000:-20000,k=variant==="pre"?-3:3;
    for(const [op,table] of [["INSERT","bank_ledger"],["UPDATE","bank_tax_state"],["INSERT","character_events"],["INSERT","legacy_item_usage"]]){
      db.exec("CREATE TRIGGER j4c_block BEFORE "+op+" ON "+table+" BEGIN SELECT RAISE(ABORT,'j4c write blocked'); END;");
      assert.throws(()=>trigger(settleDailyIllnessEvent,db,1,eventId,t.today,now,choices),/j4c write blocked/);
      assert.deepEqual(all(db),settled);
      db.exec("DROP TRIGGER j4c_block;");
    }
    const assets=total(db),oldActor=char(db,1),oldTarget=char(db,3);
    trigger(settleDailyIllnessEvent,db,1,eventId,t.today,now,choices);
    assert.equal(char(db,1).money,oldActor.money+delta);assert.equal(char(db,1).kpoint,oldActor.kpoint+k);
    assert.equal(char(db,3).bank,oldTarget.bank-delta);assert.equal(char(db,3).last_event_day,oldTarget.last_event_day);
    assert.equal(total(db),assets);assert.equal(remaining(db,1,line),4);
    assert.equal(latest(db,1).transfer.status,"transferred");assert.equal(latest(db,3).bank,-delta);
    assert.equal(ledger(db,3).at(-1).debit,Math.max(delta,0));assert.equal(ledger(db,3).at(-1).credit,Math.max(-delta,0));
    assert.equal(tax(db,1),char(db,1).money+char(db,1).bank);assert.equal(tax(db,3),char(db,3).money+char(db,3).bank);
    assert.deepEqual(actor(all(db),2),actor(settled,2));
    const afterTransfer=all(db),old2=char(db,2),insuffId=variant==="pre"?37:36,insuffLine=variant==="pre"?12:11,oldRemaining=remaining(db,2,insuffLine);
    trigger(settleDailyIllnessEvent,db,2,insuffId,t.today,now,[.999999,0,.99]);
    assert.deepEqual(char(db,2),{...old2,last_event_day:t.today});
    assert.equal(remaining(db,2,insuffLine),oldRemaining);
    assert.equal(latest(db,2).transfer.status,"insufficient");
    assert.deepEqual(actor(all(db),1),actor(afterTransfer,1));assert.deepEqual(actor(all(db),3),actor(afterTransfer,3));
    assert.equal(settleDailyIllnessEvent(db,2,t.today,now,rng(),"multi").checked,false);
    const prior3=char(db,3),before3=total(db);
    if(variant==="pre"){
      trigger(settleDailyIllnessEvent,db,3,28,t.today,now,[0]);
      assert.equal(char(db,3).money,prior3.money-10000);assert.equal(char(db,3).kpoint,prior3.kpoint+3);
      assert.equal(latest(db,3).transfer.status,"transferred");assert.equal(latest(db,1).bank,10000);
    }else{
      trigger(settleDailyIllnessEvent,db,3,36,t.today,now,[0,0,.99]);
      assert.deepEqual(char(db,3),{...prior3,last_event_day:t.today});assert.equal(latest(db,3).transfer.status,"self");assert.equal(remaining(db,3,31),4);
    }
    assert.equal(total(db),before3);
    for(const id of [1,2,3]){assert.equal(tax(db,id),char(db,id).money+char(db,id).bank);assert.equal(settleDailyIllnessEvent(db,id,t.today,now,rng(),"multi").checked,false);}
    const coreDone=all(db);preserve(before,coreDone);integrity(db);db.close();db=null;
    web=await serve(targetDir,join(work,"missing-npc"),"auto",timezone);
    assert.equal((await api(web.url,"coupon/redeem",coupon)).status,401);
    for(const id of [1,2,3]){
      const state=await ok(web,"state",undefined,id),row=coreDone.characters.find(x=>x.user_id===id);
      assert.equal(state.character.name,row.name);assert.equal(state.character.money,row.money);assert.equal(state.character.bank,row.bank);assert.equal(state.character.kpoint,row.kpoint);
      assert.equal(state.bankTax.assessmentBase,row.money+row.bank);
      assert.deepEqual(state.healthEvents.map(x=>x.id),coreDone.character_events.filter(x=>x.user_id===id).map(x=>x.id).reverse());
    }
    for(const id of [1,2]){
      const replay=await ok(web,"coupon/redeem",{...coupon,userId:id===1?2:1},id);
      assert.equal(replay.couponResult.replayed,true);assert.equal(replay.couponResult.sourceLine,6000000);assert.equal(replay.couponBalance,4);
    }
    assert.equal((await api(web.url,"inventory/legacy/use",{sourceLine:31,requestId:"j4c_other_item",userId:3},cookie(1))).status,400);
    const stable=read(target,all);preserve(before,stable);
    for(const key of tables)assert.deepEqual(stable[key],coreDone[key],key);
    const use={sourceLine:line,requestId:"j4c_manual_flute"};
    const used=await ok(web,"inventory/legacy/use",use,1);
    assert.equal(used.itemUseResult.replayed,false);assert.equal(used.legacyItemActions.find(x=>x.sourceLine===line).remaining,3);
    assert.equal(used.character.money,stable.characters[0].money);assert.equal(used.character.kpoint,stable.characters[0].kpoint);
    const afterUse=read(target,all);assert.deepEqual(actor(afterUse,2),actor(stable,2));assert.deepEqual(actor(afterUse,3),actor(stable,3));preserve(before,afterUse);
    await web.stop();web=null;
    web=await serve(targetDir,join(work,"missing-npc"),"auto",timezone);
    const replay=await ok(web,"inventory/legacy/use",use,1);assert.equal(replay.itemUseResult.replayed,true);assert.equal(replay.legacyItemActions.find(x=>x.sourceLine===line).remaining,3);
    for(const id of [1,2])assert.equal((await ok(web,"coupon/redeem",coupon,id)).couponResult.replayed,true);
    await web.stop();web=null;
    read(target,x=>{integrity(x);const final=all(x);for(const key of tables)assert.deepEqual(final[key],afterUse[key],key);preserve(before,final);});
    assert.deepEqual(all(source),before);assert.equal(fileHash(sourceFile),mainHash);assert.equal(fileHash(sourceFile+"-wal"),walHash);assert.equal(fileHash(snapshot),snapshotHash);
  }finally{if(web)await web.stop();if(db)db.close();if(source)source.close();rmSync(work,{recursive:true,force:true});}
});

 // J-5: #137 的街頭戰鬥核心與現行 blob 相同；與既有 #137 事件／券
 // 歷史 fixture 共用同一資料庫，避免將兩個互不相干的還原冒充聯合回歸。
test("J-5：#137 歷史事件、街頭獲券、同碼跨模組收據及 HTTP 兌換故障復原",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-j5-joint-"));
  const sourceDir=join(work,"source"),targetDir=join(work,"restored"),sourceFile=join(sourceDir,"multi.sqlite"),snapshot=join(work,"snapshot.sqlite"),target=join(targetDir,"multi.sqlite");
  const now=Date.now(),timezone=["Asia/Taipei","UTC","America/Los_Angeles"].find(timeZone=>{
    const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone,hour:"2-digit",hourCycle:"h23"}).format(now));return hour>=6&&hour<18;
  });
  assert.ok(timezone);
  const t={now,timezone,today:calendarDay(now,timezone),yesterday:calendarDay(now-86400000,timezone),earlier:calendarDay(now-2*86400000,timezone),at:now-86400000,sourceFile};
  const joint=db=>({...all(db),street_fights:rows(db,"street_fights")});
  const stableFields=state=>({...state,characters:state.characters.map(({body_energy,brain_energy,recovered_at,...row})=>row)});
  let source=null,web=null;
  try{
    mkdirSync(sourceDir);source=new DatabaseSync(sourceFile);
    const mainHash=seed(source,"post",t);
    initStreetFightTables(source);
    // 合成能力及時鐘只在歷史測試資料庫內設定；不改規則、正式 API 或多人時鐘。
    source.prepare("UPDATE characters SET stats_json=?,body_energy=1000,brain_energy=1000,recovered_at=? WHERE user_id=1")
      .run(JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,5000]))),now-10000);
    for(const id of [1,2,3]){
      settleBankInterest(source,id,t.today,now-10000);
      assert.equal(settleDailyIllnessEvent(source,id,t.today,now-10000,rng(.99),"multi").event,null);
    }
    const beforeFight=joint(source),oldActor=char(source,1);
    const draws=[1,8,0,4,0];
    const receipt=playStreetFight(source,1,{mode:"multi",requestId:coupon.requestId,now:now-10000,today:t.today,randomIndex:n=>{
      assert.ok(draws.length,"unexpected battle RNG");const v=draws.shift();assert.ok(v>=0&&v<n);return v;
    }});
    assert.deepEqual(draws,[]);
    assert.equal(receipt.outcome,"win");assert.equal(receipt.delta,1500);
    assert.equal(receipt.coupons,5);assert.equal(receipt.kpointDelta,-3);
    assert.equal(char(source,1).money,oldActor.money+1500);
    assert.equal(char(source,1).kpoint,oldActor.kpoint-3);
    assert.equal(tax(source,1),char(source,1).money+char(source,1).bank);
    const before=joint(source);
    assert.equal(before.character_coupons.find(x=>x.user_id===1).quantity,9);
    assert.deepEqual(actor(before,2),actor(beforeFight,2));
    assert.deepEqual(actor(before,3),actor(beforeFight,3));
    preserve(beforeFight,before);integrity(source);
    assert.equal(fileHash(sourceFile),mainHash);assert.ok(statSync(sourceFile+"-wal").size>32);
    const walHash=fileHash(sourceFile+"-wal");
    const reader=new DatabaseSync(sourceFile,{readOnly:true});
    try{await backup(reader,snapshot);}finally{reader.close();}
    const snapshotHash=fileHash(snapshot);
    mkdirSync(targetDir);copyFileSync(snapshot,target,constants.COPYFILE_EXCL);
    assert.throws(()=>copyFileSync(snapshot,target,constants.COPYFILE_EXCL),/EEXIST/);
    assert.equal(fileHash(target),snapshotHash);
    read(target,x=>{integrity(x);assert.deepEqual(joint(x),before);});
    web=await serve(targetDir,join(work,"missing-npc"),"auto",timezone);
    async function replayOld(){
      const battle=await ok(web,"street-fight/play",{requestId:coupon.requestId},1);
      assert.deepEqual(battle.streetFightResult,{...receipt,replayed:true});
      assert.equal(battle.character.money,char(source,1).money);
      assert.equal(battle.character.kpoint,char(source,1).kpoint);
      for(const id of [1,2]){
        const replay=await ok(web,"coupon/redeem",coupon,id);
        assert.equal(replay.couponResult.replayed,true);assert.equal(replay.couponResult.sourceLine,6000000);
      }
    }
    await replayOld();
    const other=await ok(web,"state",undefined,2);
    assert.equal(other.streetFight.history.length,0);assert.equal(other.couponBalance,4);
    assert.equal((await api(web.url,"street-fight/play",{requestId:coupon.requestId})).status,401);
    assert.equal((await api(web.url,"street-fight/play",{requestId:coupon.requestId,userId:1},cookie(2))).status,400);
    const ready=read(target,joint);
    assert.deepEqual(stableFields(ready),stableFields(before));
    // 兌換的收據是最後一筆寫入，故注入失敗須回滾已扣券與已入庫獎品。
    const sql=statement=>{const db=new DatabaseSync(target);try{db.exec(statement);}finally{db.close();}};
    const next={...coupon,requestId:"j5_joint_coupon_retry"};
    sql("CREATE TRIGGER j5_coupon_fault BEFORE INSERT ON coupon_redemptions BEGIN SELECT RAISE(ABORT,'j5 receipt fault'); END;");
    const failed=await api(web.url,"coupon/redeem",next,cookie(1));
    assert.equal(failed.status,400);assert.match(failed.result.error,/j5 receipt fault/);
    assert.deepEqual(read(target,joint),ready);
    sql("DROP TRIGGER j5_coupon_fault;");
    const used=await ok(web,"coupon/redeem",next,1);
    assert.equal(used.couponResult.replayed,false);assert.equal(used.couponResult.couponCost,1);
    assert.equal(used.couponResult.sourceLine,6000001);assert.equal(used.couponBalance,8);
    const after=read(target,joint);
    assert.deepEqual(after.street_fights,before.street_fights);
    assert.deepEqual(after.character_events,before.character_events);
    assert.deepEqual(after.bank_ledger,before.bank_ledger);
    assert.deepEqual(after.bank_tax_state,before.bank_tax_state);
    assert.deepEqual(actor(after,2),actor(ready,2));assert.deepEqual(actor(after,3),actor(ready,3));
    preserve(before,after);
    assert.equal(after.legacy_inventory_items.filter(x=>x.user_id===1&&x.source_line===6000001).length,1);
    assert.equal(after.coupon_redemptions.filter(x=>x.user_id===1&&x.request_id===next.requestId).length,1);
    await web.stop();web=null;
    web=await serve(targetDir,join(work,"missing-npc"),"auto",timezone);
    const replay=await ok(web,"coupon/redeem",next,1);
    assert.deepEqual(replay.couponResult,{...used.couponResult,replayed:true});assert.equal(replay.couponBalance,8);
    await replayOld();
    await web.stop();web=null;
    read(target,x=>{integrity(x);assert.deepEqual(stableFields(joint(x)),stableFields(after));});
    assert.deepEqual(joint(source),before);
    assert.equal(fileHash(sourceFile),mainHash);assert.equal(fileHash(sourceFile+"-wal"),walHash);assert.equal(fileHash(snapshot),snapshotHash);
  }finally{if(web)await web.stop();if(source)source.close();rmSync(work,{recursive:true,force:true});}
});
