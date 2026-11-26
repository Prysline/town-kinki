import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,rmSync,readFileSync,copyFileSync,constants,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {DatabaseSync,backup} from "node:sqlite";
import {createHash} from "node:crypto";
import {calendarDay} from "../src/training.mjs";
import {STAT_KEYS} from "../src/engine.mjs";
import {settleDailyIllnessEvent,getCouponBalance} from "../src/events.mjs";
import {advanceSoloClock} from "../src/solo-clock.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const sha=file=>createHash("sha256").update(readFileSync(file)).digest("hex");
const plain=rows=>rows.map(row=>({...row}));
const columns=(db,table)=>db.prepare("PRAGMA table_info("+table+")").all().map(row=>row.name);
const hasTable=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function integrity(db){
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
}
function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
function numbers(...values){
  let i=0;
  return ()=>{assert.ok(i<values.length,"unexpected random draw");return values[i++];};
}
async function serve(dir,zone){
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",PORT:"0",DATA_DIR:dir,GAME_TIMEZONE:zone}
  });
  let log="";
  child.stdout.on("data",x=>log+=x);
  child.stderr.on("data",x=>log+=x);
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    const url=log.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)\r?$/m)?.[1];
    if(!url){await delay(100);continue;}
    try{
      const response=await fetch(url+"/api/state",{signal:AbortSignal.timeout(350)});
      if(response.ok)return {url,async stop(){
        if(child.exitCode!==null)return;
        const ended=new Promise(ok=>child.once("exit",ok));
        child.kill();await Promise.race([ended,delay(1500)]);
      }};
    }catch{}
    await delay(100);
  }
  child.kill();throw new Error("歷史事件存檔升級後啟動失敗："+log);
}
async function api(server,path,body){
  const response=await fetch(server.url+"/api/"+path,{
    method:body===undefined?"GET":"POST",
    headers:body===undefined?{}:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  return result;
}

// 正式分支祖先 6859a66427bd1ce45e4a987d11ef245e0b8ea31a，
// 下一個 1ae4134b4a462d3b990d688cd6ccaa8254943da8 才加入兩個事件欄位。
// 以下是該歷史 server、banking、events 的代表性原樣 DDL／疾病核心，
// 只更名測試函式，未建立當時尚不存在的 solo_clock、券、領獎或稅務表。
// 不讀取原版 CGI 私人玩家資料。
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
    ["gym_ready_at", "INTEGER NOT NULL DEFAULT 0"],
    ["created_at", "INTEGER NOT NULL DEFAULT 0"],
    ["last_meal_at", "INTEGER NOT NULL DEFAULT 0"],
    ["health_index", "INTEGER NOT NULL DEFAULT 50"],
    ["last_health_day", "TEXT NOT NULL DEFAULT ''"],
    ["last_event_day", "TEXT NOT NULL DEFAULT ''"]
  ]) {
    const currentColumns = db.prepare("PRAGMA table_info(characters)").all();
    if (!currentColumns.some(info => info.name === column)) {
      db.exec("ALTER TABLE characters ADD COLUMN " + column + " " + definition);
    }
  }
}
function initHistoricalBank(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_accounts(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "term_balance INTEGER NOT NULL DEFAULT 0 CHECK(term_balance>=0),",
    "last_interest_day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS bank_ledger(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "account_type TEXT NOT NULL CHECK(account_type IN ('ordinary','term')),",
    "action TEXT NOT NULL,",
    "debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0),",
    "credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0),",
    "balance INTEGER NOT NULL CHECK(balance>=0),",
    "created_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS bank_ledger_user_idx ON bank_ledger(user_id,id);"
  ].join("\n"));
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_loans(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "principal INTEGER NOT NULL CHECK(principal>=0),",
    "daily_payment INTEGER NOT NULL CHECK(daily_payment>=0),",
    "remaining_payments INTEGER NOT NULL CHECK(remaining_payments>=0),",
    "original_payments INTEGER NOT NULL CHECK(original_payments>=0),",
    "missed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(missed_attempts>=0),",
    "last_attempt_day TEXT NOT NULL,",
    "borrowed_at INTEGER NOT NULL);"
  ].join("\n"));
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_transfers(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "amount INTEGER NOT NULL CHECK(amount>0),",
    "transfer_day TEXT NOT NULL,",
    "request_key TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,",
    "UNIQUE(sender_user_id,request_key));",
    "CREATE INDEX IF NOT EXISTS bank_transfers_daily_idx ON bank_transfers(sender_user_id,recipient_user_id,transfer_day);"
  ].join("\n"));
}
// 原版 event.pl::event_happen：三分之一機率從 44 個事件中抽一個。
// 本階段僅移植兩個會改變 byouki_sisuu 的事件（編號 4 與 15）。
// 原 CGI 在進入主畫面時抽取，Web 版改為每個遊戲日最多抽取一次。
const ORIGINAL_EVENT_COUNT = 44;
const ORIGINAL_EVENT_CHANCE = 3;
const ILLNESS_EVENTS = Object.freeze({
  4: Object.freeze({
    key:"caughtCold",originalId:4,title:"感冒事件",
    description:"感冒了。",healthIndex:-15
  }),
  15: Object.freeze({
    key:"sleptUncovered",originalId:15,title:"睡覺後身體不適",
    description:"裸體睡覺，似乎因此身體不舒服了。",healthIndex:-8
  })
});

function drawInteger(random,count) {
  const value=random();
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>=1)
    throw new Error("事件亂數產生器回傳無效數值");
  return Math.floor(value*count)+1;
}
function rollOriginalIllnessEvent(random=Math.random) {
  if (typeof random!=="function") throw new Error("事件亂數產生器不正確");
  // event.pl: $hassei_rand=int(rand(3))+1; $event_rand=int(rand(44))+1
  const happened=drawInteger(random,ORIGINAL_EVENT_CHANCE)===1;
  if(!happened) return {drawn:false,originalId:null,event:null};
  const originalId=drawInteger(random,ORIGINAL_EVENT_COUNT);
  const event=ILLNESS_EVENTS[originalId]??null;
  return {drawn:true,originalId,event};
}
function initHistoricalEvents(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS character_events(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "day TEXT NOT NULL,",
    "event_key TEXT NOT NULL,",
    "original_id INTEGER NOT NULL,",
    "old_health_index INTEGER NOT NULL,",
    "new_health_index INTEGER NOT NULL,",
    "created_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS character_events_user_idx ON character_events(user_id,id);"
  ].join("\n"));
}
function validDay(day) {
  return typeof day==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(day);
}
function settleHistoricalEvent(db,userId,day,now=Date.now(),random=Math.random) {
  if(!Number.isSafeInteger(userId)||userId<1) throw new Error("無效的角色帳號");
  if(!validDay(day)||!Number.isSafeInteger(now)||now<0)
    throw new Error("無效的事件日期或時間");
  db.exec("BEGIN IMMEDIATE");
  try {
    const old=db.prepare(
      "SELECT health_index,last_event_day FROM characters WHERE user_id=?"
    ).get(userId);
    if(!old) throw new Error("請先建立角色");
    if(old.last_event_day>=day) {
      db.exec("COMMIT");
      return {checked:false,initial:false,event:null};
    }
    // 舊存檔沒有事件檢查歷史，不將當日新功能啟用視為舊版漏抽事件。
    if(!old.last_event_day){
      db.prepare("UPDATE characters SET last_event_day=? WHERE user_id=?")
        .run(day,userId);
      db.exec("COMMIT");
      return {checked:false,initial:true,event:null};
    }
    const result=rollOriginalIllnessEvent(random);
    db.prepare("UPDATE characters SET last_event_day=? WHERE user_id=?")
      .run(day,userId);
    if(result.event){
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=?")
        .run(result.event.healthIndex,userId);
      db.prepare(
        "INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at) VALUES(?,?,?,?,?,?,?)"
      ).run(userId,day,result.event.key,result.event.originalId,
        old.health_index,result.event.healthIndex,now);
    }
    db.exec("COMMIT");
    return {checked:true,initial:false,event:result.event,
      originalId:result.originalId};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}

test("J-4a：真實早期 Web 事件欄位升級、WAL 歷史保留、券回滾與 HTTP 續玩",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-j4a-event-upgrade-"));
  const oldDir=join(work,"old"),restored=join(work,"restored"),file=join(oldDir,"solo.sqlite");
  const snapshot=join(work,"snapshot.sqlite"),target=join(restored,"solo.sqlite");
  let source=null,db=null,server=null;
  try{
    mkdirSync(oldDir);
    source=new DatabaseSync(file);
    initHistoricalCore(source);initHistoricalBank(source);initHistoricalEvents(source);
    source.exec("PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE);");
    const mainHash=sha(file);
    const now=Date.now();
    // 選一個不接近午夜的合法遊戲時區，避免 CI 橫跨日期造成隨機抽選。
    const hour=new Date(now).getUTCHours();
    const zone=hour<3||hour>=21?"Asia/Taipei":"UTC";
    const today=calendarDay(now,zone),yesterday=calendarDay(now-86400000,zone);
    const beforeYesterday=calendarDay(now-2*86400000,zone);
    insert(source,"users",{id:1,username:"__local_player__",password_salt:"synthetic-salt",password_hash:"synthetic-hash",created_at:now-3*86400000});
    insert(source,"characters",{id:1,user_id:1,name:"早期歷史事件玩家",gender:"other",town_id:0,money:150000,bank:12000,
      body_energy:90,brain_energy:90,recovered_at:now,job_id:null,work_progress:0,last_work_at:0,work_count:0,
      height:165,bmi:22,stats_json:JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,20]))),
      created_at:now-3*86400000,last_health_day:today,last_event_day:beforeYesterday});
    insert(source,"bank_accounts",{user_id:1,term_balance:0,last_interest_day:today});
    insert(source,"bank_ledger",{id:1,user_id:1,account_type:"ordinary",action:"存入",debit:0,credit:12000,balance:12000,created_at:now-2*86400000});
    assert.equal(settleHistoricalEvent(source,1,yesterday,now-86400000,numbers(0,(4-.5)/44)).event.originalId,4);
    assert.equal(settleHistoricalEvent(source,1,today,now,numbers(0,(15-.5)/44)).event.originalId,15);
    const history=plain(source.prepare("SELECT * FROM character_events ORDER BY id").all());
    const ledger=plain(source.prepare("SELECT * FROM bank_ledger ORDER BY id").all());
    const originalColumns=columns(source,"character_events");
    assert.equal(history.length,2);
    assert.deepEqual(history.map(x=>[x.original_id,x.old_health_index,x.new_health_index]),[[4,50,-15],[15,-15,-8]]);
    assert.ok(!originalColumns.includes("description")&&!originalColumns.includes("effects_json"));
    for(const name of ["solo_clock","character_coupons","character_cockroach_challenges","coupon_redemptions","bank_tax_state"])assert.equal(hasTable(source,name),false);
    integrity(source);
    assert.equal(sha(file),mainHash,"fixture 的交易應仍在 WAL");
    assert.ok(statSync(file+"-wal").size>0);
    const walHash=sha(file+"-wal");
    // 歷史版本早於 solo_clock；產品 CLI 明確要求此表，故在測試用 SQLite backup()
    // 取得一致快照，再以 COPYFILE_EXCL 非覆寫還原，未放寬正式 CLI。
    await backup(source,snapshot);
    const snapshotHash=sha(snapshot);
    mkdirSync(restored);
    copyFileSync(snapshot,target,constants.COPYFILE_EXCL);
    assert.throws(()=>copyFileSync(snapshot,target,constants.COPYFILE_EXCL),/EEXIST/);
    assert.equal(sha(target),snapshotHash);
    db=new DatabaseSync(target,{readOnly:true});
    integrity(db);
    assert.deepEqual(plain(db.prepare("SELECT * FROM character_events ORDER BY id").all()),history);
    assert.deepEqual(columns(db,"character_events"),originalColumns);
    db.close();db=null;

    server=await serve(restored,zone);
    const first=await api(server,"state");
    assert.equal(first.character.name,"早期歷史事件玩家");
    assert.equal(first.character.healthIndex,-8);
    assert.equal(first.character.money,150000);
    assert.equal(first.character.bank,12000);
    assert.equal(first.couponBalance,0);
    assert.deepEqual(first.residents,[]);
    assert.equal(first.gameTimeOffsetMs,0);
    assert.deepEqual(first.healthEvents.map(x=>[x.id,x.originalId,x.oldHealthIndex,x.newHealthIndex]),[[2,15,-15,-8],[1,4,50,-15]]);
    assert.deepEqual(first.healthEvents.map(x=>x.effects),[{},{}]);
    assert.deepEqual(first.healthEvents.map(x=>x.description),["裸體睡覺，似乎因此身體不舒服了。","感冒了。"]);
    assert.equal(first.bankTax.assessmentBase,162000);
    const deposited=await api(server,"bank",{action:"deposit",amount:1000});
    assert.equal(deposited.character.money,149000);
    assert.equal(deposited.character.bank,13000);
    assert.equal(deposited.bankTax.assessmentBase,162000);
    await server.stop();server=null;

    db=new DatabaseSync(target);
    db.exec("PRAGMA foreign_keys=ON;");
    assert.deepEqual(columns(db,"character_events"),[...originalColumns,"description","effects_json"]);
    const historicalRows=()=>plain(db.prepare("SELECT * FROM character_events WHERE id IN (1,2) ORDER BY id").all());
    const expected=history.map(x=>({...x,description:"",effects_json:"{}"}));
    assert.deepEqual(historicalRows(),expected);
    assert.deepEqual(plain(db.prepare("SELECT * FROM bank_ledger WHERE id=1").all()),ledger);
    assert.ok(db.prepare("PRAGMA index_list(character_events)").all().some(x=>x.name==="character_events_user_idx"));
    assert.ok(db.prepare("PRAGMA foreign_key_list(character_events)").all().some(x=>x.table==="users"&&x.on_delete==="CASCADE"));
    assert.throws(()=>db.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(1,-1)").run(),/CHECK/);
    const next=advanceSoloClock(db,"1d",now);
    const nextDay=calendarDay(next.gameTimeMs,zone);
    db.exec("CREATE TRIGGER reject_j4a_history BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'j4a history blocked'); END;");
    const attempt=()=>settleDailyIllnessEvent(db,1,nextDay,next.gameTimeMs,numbers(0,(30-.5)/44,.999),"solo");
    const before={...db.prepare("SELECT * FROM characters WHERE user_id=1").get()};
    assert.throws(attempt,/j4a history blocked/);
    assert.deepEqual({...db.prepare("SELECT * FROM characters WHERE user_id=1").get()},before);
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM character_events").get().n,2);
    db.exec("DROP TRIGGER reject_j4a_history;");
    assert.equal(attempt().event.originalId,30);
    assert.equal(getCouponBalance(db,1),5);
    assert.equal(settleDailyIllnessEvent(db,1,nextDay,next.gameTimeMs,()=>{throw new Error("同日不可重抽");},"solo").checked,false);
    assert.deepEqual(historicalRows(),expected);
    integrity(db);
    db.close();db=null;

    server=await serve(restored,zone);
    const second=await api(server,"state");
    assert.equal(second.character.money,149000);
    assert.equal(second.character.bank,13065);
    assert.equal(second.bankTax.assessmentBase,162065);
    assert.equal(second.couponBalance,5);
    assert.equal(second.healthEvents.length,3);
    assert.equal(second.healthEvents[0].originalId,30);
    assert.deepEqual(second.healthEvents[0].effects,{coupons:5});
    assert.deepEqual(second.healthEvents.slice(1),first.healthEvents);
    assert.deepEqual(second.residents,[]);
    assert.equal((await api(server,"state")).couponBalance,5);
    await server.stop();server=null;
    db=new DatabaseSync(target,{readOnly:true});integrity(db);
    assert.deepEqual(plain(db.prepare("SELECT * FROM character_events WHERE id IN (1,2) ORDER BY id").all()),expected);
    assert.equal(sha(file),mainHash);
    assert.equal(sha(file+"-wal"),walHash);
    assert.equal(sha(snapshot),snapshotHash);
  }finally{
    if(server)await server.stop();
    if(db)db.close();
    if(source)source.close();
    rmSync(work,{recursive:true,force:true});
  }
});
