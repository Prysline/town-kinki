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
import {getCouponBalance} from "../src/events.mjs";
import {backUpSolo,restoreSolo,verifySoloDatabase} from "../scripts/solo-save.mjs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyCouponCatalog} from "../src/coupon-catalog.mjs";
import {redeemEventCoupon} from "../src/coupon-redemption.mjs";
import {useLegacyItem} from "../src/legacy-item-use.mjs";
import {storeTownMap} from "../src/town-storage.mjs";
import {claimCockroachForEvent} from "../src/event-cockroach.mjs";

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
  let log="",stdout="";
  child.stdout.on("data",x=>{stdout+=x;log+=x;});
  child.stderr.on("data",x=>log+=x);
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    const url=stdout.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)\r?\n/m)?.[1];
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

// #128 I 前正式 Web 歷史 DDL 與蟑螂核心；代表性 schema 子集，非完整舊版資料庫。
// 兌換與道具使用核心在 #128 與目前正式版 Git blob 一致。
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
function initBankTables(db) {
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
  // 新增資料表，不改動既有 bank_accounts、characters、ledger 的欄位或餘額。
  // 初次使用時建立當日快照，不補課既有 Web SQLite 的過往星期一。
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_tax_state(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "assessment_base INTEGER NOT NULL CHECK(assessment_base>=0),",
    "snapshot_day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS bank_tax_assessments(",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "tax_day TEXT NOT NULL,",
    "assessment_base INTEGER NOT NULL CHECK(assessment_base>=0),",
    "kpoint INTEGER NOT NULL,",
    "rate_percent INTEGER NOT NULL CHECK(rate_percent>=0),",
    "gross INTEGER NOT NULL CHECK(gross>=0),",
    "discount INTEGER NOT NULL CHECK(discount>=0),",
    "due INTEGER NOT NULL CHECK(due>=0),",
    "paid INTEGER NOT NULL CHECK(paid>=0),",
    "unpaid INTEGER NOT NULL CHECK(unpaid>=0),",
    "created_at INTEGER NOT NULL,",
    "PRIMARY KEY(user_id,tax_day),",
    "CHECK(due=paid+unpaid));",
    "CREATE INDEX IF NOT EXISTS bank_tax_history_idx ON bank_tax_assessments(user_id,tax_day);"
  ].join("\n"));
  // 街頭格鬥依原版允許負 K 點；舊稅務表只限制 K 點非負。
  const taxSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bank_tax_assessments'").get().sql;
  if(taxSql.includes("CHECK(kpoint>=0)")){
    db.exec("BEGIN IMMEDIATE");
    try{
      db.exec("ALTER TABLE bank_tax_assessments RENAME TO bank_tax_assessments_old");
      db.exec(taxSql.replace("CHECK(kpoint>=0)",""));
      db.exec("INSERT INTO bank_tax_assessments SELECT * FROM bank_tax_assessments_old");
      db.exec("DROP TABLE bank_tax_assessments_old");
      db.exec("CREATE INDEX IF NOT EXISTS bank_tax_history_idx ON bank_tax_assessments(user_id,tax_day)");
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
  }
}
function initCharacterEvents(db) {
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
    "CREATE INDEX IF NOT EXISTS character_events_user_idx ON character_events(user_id,id);",
    "CREATE TABLE IF NOT EXISTS character_coupons(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0));"
  ].join("\n"));
  const columns=db.prepare("PRAGMA table_info(character_events)").all();
  if(!columns.some(c=>c.name==="description"))
    db.exec("ALTER TABLE character_events ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if(!columns.some(c=>c.name==="effects_json"))
    db.exec("ALTER TABLE character_events ADD COLUMN effects_json TEXT NOT NULL DEFAULT '{}'");
  initCockroachChallenges(db);
}
// 原始 event.pl 的第 34 號（無聖誕人偶且現金>0）與第 44 號共用 20 秒蟑螂。
// 20 秒內拍死蟑螂可獲得 1～20000 元、K 點數 +3、外貌 -3。
// Web 採伺服器時間與每帳號獨立的 SQLite 挑戰，不接受前端回傳開始時間或角色 ID。
const COCKROACH_WINDOW_MS=20000;
const COCKROACH_EVENT_IDS=Object.freeze([34,44]);
function validateUser(userId){
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的角色帳號");
}
function validateNow(now){
  if(!Number.isSafeInteger(now)||now<0)throw new Error("無效的事件時間");
}
function safeNonnegative(value,label){
  if(!Number.isSafeInteger(value)||value<0)throw new Error("角色"+label+"資料不正確");
  return value;
}
function drawReward(random){
  if(typeof random!=="function")throw new Error("事件亂數產生器不正確");
  const roll=random();
  if(typeof roll!=="number"||!Number.isFinite(roll)||roll<0||roll>=1)
    throw new Error("事件亂數產生器回傳無效數值");
  return Math.floor(roll*20000)+1;
}
function initCockroachChallenges(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS character_cockroach_challenges(",
    "event_id INTEGER PRIMARY KEY REFERENCES character_events(id) ON DELETE CASCADE,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "started_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,",
    "status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','caught','escaped')),",
    "resolved_at INTEGER);",
    "CREATE INDEX IF NOT EXISTS cockroach_challenge_user_idx",
    "ON character_cockroach_challenges(user_id,event_id);"
  ].join("\n"));
}
// 呼叫者必須已持有 BEGIN IMMEDIATE；事件歷史和挑戰一起提交／回滾。
function openCockroachChallenge(db,userId,eventId,now){
  validateUser(userId);validateNow(now);
  if(!Number.isSafeInteger(eventId)||eventId<1||
      !Number.isSafeInteger(now+COCKROACH_WINDOW_MS))
    throw new Error("蟑螂事件時間或紀錄不正確");
  db.prepare([
    "INSERT INTO character_cockroach_challenges",
    "(event_id,user_id,started_at,expires_at,status)",
    "VALUES(?,?,?,?,'pending')"
  ].join(" ")).run(eventId,userId,now,now+COCKROACH_WINDOW_MS);
}
function getCockroachChallenge(db,userId,now=Date.now()){
  validateUser(userId);validateNow(now);
  const row=db.prepare([
    "SELECT event_id,started_at,expires_at FROM character_cockroach_challenges",
    "WHERE user_id=? AND status='pending' ORDER BY event_id DESC LIMIT 1"
  ].join(" ")).get(userId);
  if(!row)return null;
  if(!Number.isSafeInteger(row.expires_at)||!Number.isSafeInteger(row.started_at)||
      row.expires_at-row.started_at!==COCKROACH_WINDOW_MS)
    throw new Error("蟑螂事件計時資料不正確");
  return {eventId:row.event_id,expiresAt:row.expires_at,
    remainingMs:Math.max(0,row.expires_at-now),
    status:now>=row.expires_at?"expired":"active"};
}
function updateHistory(db,eventId,userId,description,effects){
  const result=db.prepare(
    "UPDATE character_events SET description=?,effects_json=? WHERE id=? AND user_id=? AND original_id IN (34,44)"
  ).run(description,JSON.stringify(effects),eventId,userId);
  if(result.changes!==1)throw new Error("蟑螂事件歷史不正確");
}
function claimCockroach(db,userId,now=Date.now(),random=Math.random){
  validateUser(userId);validateNow(now);
  db.exec("BEGIN IMMEDIATE");
  try{
    const row=db.prepare([
      "SELECT c.event_id,c.started_at,c.expires_at,e.original_id",
      "FROM character_cockroach_challenges c",
      "JOIN character_events e ON e.id=c.event_id AND e.user_id=c.user_id",
      "WHERE c.user_id=? AND c.status='pending'",
      "ORDER BY c.event_id DESC LIMIT 1"
    ].join(" ")).get(userId);
    if(!row||!COCKROACH_EVENT_IDS.includes(row.original_id))throw new Error("沒有待處理的蟑螂事件");
    if(!Number.isSafeInteger(row.started_at)||!Number.isSafeInteger(row.expires_at)||
        row.expires_at-row.started_at!==COCKROACH_WINDOW_MS)
      throw new Error("蟑螂事件計時資料不正確");
    if(now<row.started_at)throw new Error("蟑螂事件尚未開始");
    if(now>=row.expires_at){
      const changed=db.prepare(
        "UPDATE character_cockroach_challenges SET status='escaped',resolved_at=? WHERE event_id=? AND user_id=? AND status='pending'"
      ).run(now,row.event_id,userId);
      if(changed.changes!==1)throw new Error("蟑螂事件狀態不正確");
      updateHistory(db,row.event_id,userId,"超過 20 秒，蟑螂已逃走。",{cockroach:"escaped"});
      db.exec("COMMIT");
      return {status:"escaped",reward:0,kpoint:0,looks:0};
    }
    const character=db.prepare("SELECT money,kpoint,stats_json FROM characters WHERE user_id=?")
      .get(userId);
    if(!character)throw new Error("請先建立角色");
    const money=safeNonnegative(character.money,"現金");
    const kpoint=character.kpoint;
    if(!Number.isSafeInteger(kpoint))throw new Error("角色K 點數資料不正確");
    const stats=JSON.parse(character.stats_json);
    if(!stats||typeof stats!=="object"||Array.isArray(stats))
      throw new Error("角色能力資料不正確");
    const looks=safeNonnegative(stats.looks,"外貌");
    const reward=drawReward(random);
    const nextMoney=BigInt(money)+BigInt(reward);
    const nextKpoint=BigInt(kpoint)+3n;
    if(nextMoney>BigInt(Number.MAX_SAFE_INTEGER)||
        nextKpoint>BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("蟑螂事件獎勵超出安全整數範圍");
    const actualLooks=-Math.min(3,looks); // Web 版不允許原作負能力值。
    const nextStats=JSON.stringify({...stats,looks:looks+actualLooks});
    const updated=db.prepare(
      "UPDATE characters SET money=?,kpoint=?,stats_json=? WHERE user_id=?"
    ).run(Number(nextMoney),Number(nextKpoint),nextStats,userId);
    if(updated.changes!==1)throw new Error("角色資料更新失敗");
    const resolved=db.prepare(
      "UPDATE character_cockroach_challenges SET status='caught',resolved_at=? WHERE event_id=? AND user_id=? AND status='pending'"
    ).run(now,row.event_id,userId);
    if(resolved.changes!==1)throw new Error("蟑螂事件狀態不正確");
    updateHistory(db,row.event_id,userId,
      "在 20 秒內拍死蟑螂，獲得 "+reward+" 元及 K 點數 3 點，外貌減少 "+(-actualLooks)+" 點。",
      {cockroach:"caught",money:reward,kpoint:3,stats:{looks:actualLooks}});
    db.exec("COMMIT");
    return {status:"caught",reward,kpoint:3,looks:actualLooks};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}

function initLegacyInventoryTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS legacy_inventory_imports(",
    "original_id TEXT PRIMARY KEY,",
    "target_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,",
    "source_hash TEXT NOT NULL,",
    "source_file TEXT NOT NULL,",
    "item_count INTEGER NOT NULL,",
    "imported_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS legacy_inventory_items(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "original_id TEXT NOT NULL,",
    "source_line INTEGER NOT NULL,",
    "category TEXT NOT NULL,",
    "original_name TEXT NOT NULL,",
    "effect TEXT NOT NULL,",
    "durability INTEGER NOT NULL,",
    "durability_unit TEXT NOT NULL,",
    "purchased_at INTEGER,",
    "last_used_at INTEGER,",
    "raw_fields_json TEXT NOT NULL,",
    "UNIQUE(user_id,source_line));",
    "CREATE INDEX IF NOT EXISTS legacy_inventory_items_user_idx ON legacy_inventory_items(user_id,id);"
  ].join("\n"));
}
function initLegacyItemUseTables(db){
  initLegacyInventoryTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS legacy_item_usage(",
    "user_id INTEGER NOT NULL,source_line INTEGER NOT NULL,",
    "remaining INTEGER NOT NULL CHECK(remaining>=0),",
    "last_used_at_ms INTEGER NOT NULL,",
    "PRIMARY KEY(user_id,source_line),",
    "FOREIGN KEY(user_id,source_line) REFERENCES legacy_inventory_items(user_id,source_line) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS legacy_item_use_history(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "source_line INTEGER NOT NULL,request_id TEXT NOT NULL,",
    "original_name TEXT NOT NULL,changes_json TEXT NOT NULL,",
    "used_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS legacy_item_use_history_user_idx",
    "ON legacy_item_use_history(user_id,id);"
  ].join("\n"));
}
function initCouponRedemptionTables(db){
  initLegacyInventoryTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS coupon_redemptions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "source_index INTEGER NOT NULL,original_name TEXT NOT NULL,",
    "coupon_cost INTEGER NOT NULL CHECK(coupon_cost>0),",
    "source_line INTEGER NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id),UNIQUE(user_id,source_line));",
    "CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx",
    "ON coupon_redemptions(user_id,id);"
  ].join(" "));
}
function initSoloClock(db) {
  db.exec("CREATE TABLE IF NOT EXISTS solo_clock (id INTEGER PRIMARY KEY CHECK(id=1), offset_ms INTEGER NOT NULL CHECK(offset_ms>=0));");
  db.prepare("INSERT OR IGNORE INTO solo_clock(id,offset_ms) VALUES(1,0)").run();
}
function initTownMapTable(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS town_maps (",
    " town_id INTEGER PRIMARY KEY,",
    " original_name TEXT NOT NULL DEFAULT '',",
    " original_record TEXT NOT NULL DEFAULT '',",
    " source TEXT NOT NULL,",
    " tiles_json TEXT NOT NULL,",
    " updated_at INTEGER NOT NULL",
    ");"
  ].join(""));
}

const catalog=parseLegacyCouponCatalog(decodeLegacyText(readFileSync(new URL("../../dat_dir/coupon.cgi",import.meta.url))));
const receipts=["coupon_redemptions","legacy_inventory_items","legacy_item_usage","legacy_item_use_history","character_coupons","character_events","character_cockroach_challenges","bank_ledger","bank_tax_state"];
const rows=(db,table)=>plain(db.prepare("SELECT * FROM "+table+" ORDER BY rowid").all());
const saved=db=>Object.fromEntries(receipts.map(t=>[t,rows(db,t)]));
const redeemBody={sourceIndex:0,originalName:"福引券",requestId:"j4b_historical_coupon"};
const useBody={sourceLine:11,requestId:"j4b_historical_use"};
function historicalChallenge(db,id,day,at){
  insert(db,"character_events",{id,user_id:1,day,event_key:"cockroach",original_id:44,old_health_index:-13,new_health_index:-13,created_at:at,description:"蟑螂挑戰",effects_json:'{"cockroach":"pending"}'});
  openCockroachChallenge(db,1,id,at);
}
function historicalItem(db,now){
  const raw=Array(33).fill("");
  raw[0]="薬";raw[1]="合成歷史測試藥";raw[9]="万能,10";
  for(const index of [2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20])raw[index]="0";
  raw[17]="1500";raw[21]="3";raw[22]="回";raw[23]="0";raw[25]="0";raw[26]="0";raw[27]="0";raw[28]="0";raw[30]=String(Math.floor(now/1000));
  insert(db,"legacy_inventory_imports",{original_id:"synthetic-j4b",target_user_id:1,source_hash:"synthetic-fixture-only",source_file:"synthetic-no-source-file",item_count:1,imported_at:now});
  insert(db,"legacy_inventory_items",{user_id:1,original_id:"synthetic-j4b",source_line:11,category:raw[0],original_name:raw[1],effect:raw[9],durability:3,durability_unit:"回",purchased_at:Number(raw[30]),last_used_at:0,raw_fields_json:JSON.stringify(raw)});
}
async function rejected(server,path,body,pattern){
  const res=await fetch(server.url+"/api/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  assert.equal(res.status,400);
  assert.match(await res.text(),pattern);
}
test("J-4b：I 前事件、券、蟑螂與耐久收據實體 WAL 升級、HTTP 重送及回滾",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-j4b-event-receipts-"));
  const oldDir=join(work,"old"),targetDir=join(work,"restored"),file=join(oldDir,"solo.sqlite"),snapshot=join(work,"snapshot.sqlite");
  let source=null,db=null,server=null;
  try{
    mkdirSync(oldDir);source=new DatabaseSync(file);
    initHistoricalCore(source);initSoloClock(source);initTownMapTable(source);initBankTables(source);initCharacterEvents(source);initLegacyItemUseTables(source);initCouponRedemptionTables(source);
    source.exec("PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE);");
    const mainHash=sha(file),now=Date.now(),hour=new Date(now).getUTCHours(),zone=hour<3||hour>=21?"Asia/Taipei":"UTC",today=calendarDay(now,zone);
    const day=n=>calendarDay(now-n*86400000,zone);
    insert(source,"users",{id:1,username:"__local_player__",password_salt:"synthetic-salt",password_hash:"synthetic-hash",created_at:now-10*86400000});
    insert(source,"characters",{id:1,user_id:1,name:"歷史事件券玩家",gender:"other",town_id:0,money:150000,bank:12000,body_energy:25,brain_energy:35,recovered_at:now-100000,job_id:null,work_progress:0,last_work_at:0,work_count:0,height:165,bmi:22,stats_json:JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,20]))),created_at:now-10*86400000,last_health_day:today,last_event_day:today,health_index:-13,kpoint:-5});
    const tiles=Array(192).fill("");tiles[0]="クーポン";storeTownMap(source,0,{tiles},"web-edited");
    insert(source,"bank_accounts",{user_id:1,term_balance:0,last_interest_day:today});
    insert(source,"bank_ledger",{id:1,user_id:1,account_type:"ordinary",action:"存入",debit:0,credit:12000,balance:12000,created_at:now-86400000});
    insert(source,"character_events",{id:1,user_id:1,day:day(3),event_key:"couponGift",original_id:30,old_health_index:-13,new_health_index:-13,created_at:now-3*86400000,description:"獲得優惠券 5 張，已加入 Web 版優惠券餘額。",effects_json:'{"coupons":5}'});
    insert(source,"character_coupons",{user_id:1,quantity:5});
    historicalChallenge(source,2,day(2),now-2*86400000);
    assert.deepEqual(claimCockroach(source,1,now-2*86400000+1000,numbers(.5)),{status:"caught",reward:10001,kpoint:3,looks:-3});
    historicalChallenge(source,3,day(1),now-86400000);
    assert.deepEqual(claimCockroach(source,1,now-86400000+20000,()=>{throw Error("expired random");}),{status:"escaped",reward:0,kpoint:0,looks:0});
    historicalChallenge(source,4,today,now-60000);
    historicalItem(source,now-120000);
    const redeemed=redeemEventCoupon(source,1,catalog,{...redeemBody,now:now-90000});
    assert.equal(redeemed.replayed,false);assert.equal(redeemed.sourceLine,6000000);
    const used=useLegacyItem(source,1,useBody.sourceLine,useBody.requestId,now-80000);
    assert.equal(used.replayed,false);assert.equal(used.changes.healthIndex,10);
    insert(source,"bank_tax_state",{user_id:1,assessment_base:172001,snapshot_day:today});
    const before=saved(source),archive=rows(source,"legacy_inventory_imports"),character={...source.prepare("SELECT * FROM characters WHERE user_id=1").get()};
    assert.equal(character.money,160001);assert.equal(character.kpoint,-2);assert.equal(before.character_coupons[0].quantity,4);
    assert.deepEqual(before.character_cockroach_challenges.map(x=>x.status),["caught","escaped","pending"]);
    assert.equal(before.legacy_item_usage[0].remaining,2);
    integrity(source);assert.equal(sha(file),mainHash);assert.ok(statSync(file+"-wal").size>0);
    const walHash=sha(file+"-wal"),backup=await backUpSolo({dataDir:oldDir,file:snapshot});
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
    const target=restoreSolo({dataDir:targetDir,file:snapshot}).file;
    assert.equal(sha(target),backup.sha256);assert.throws(()=>restoreSolo({dataDir:targetDir,file:snapshot}),/拒絕覆寫/);
    db=new DatabaseSync(target,{readOnly:true});integrity(db);assert.deepEqual(saved(db),before);db.close();db=null;
    server=await serve(targetDir,zone);
    const first=await api(server,"state");
    assert.equal(first.character.money,160001);assert.equal(first.character.bank,12000);assert.equal(first.character.kpoint,-2);
    assert.equal(first.bankTax.assessmentBase,172001);assert.equal(first.couponBalance,4);assert.deepEqual(first.residents,[]);
    assert.equal(first.cockroachChallenge.eventId,4);assert.equal(first.cockroachChallenge.status,"expired");
    assert.deepEqual(first.healthEvents.map(x=>x.effects.cockroach),["pending","escaped","caught",undefined]);
    assert.equal(first.couponRedemptions[0].sourceLine,6000000);assert.equal(first.legacyItemHistory[0].sourceLine,11);
    assert.equal(first.legacyItemActions.find(x=>x.sourceLine===11).remaining,2);
    const replayCoupon=await api(server,"coupon/redeem",redeemBody);
    assert.equal(replayCoupon.couponResult.replayed,true);assert.equal(replayCoupon.couponBalance,4);
    const replayUse=await api(server,"inventory/legacy/use",useBody);
    assert.equal(replayUse.itemUseResult.replayed,true);assert.deepEqual(replayUse.itemUseResult.changes,used.changes);
    await rejected(server,"events/cockroach/claim",{eventId:2},/沒有待處理/);
    await rejected(server,"events/cockroach/claim",{eventId:3},/沒有待處理/);
    await rejected(server,"coupon/redeem",{...redeemBody,sourceIndex:1,originalName:catalog[1].originalName},/相同兌換請求/);
    await server.stop();server=null;
    db=new DatabaseSync(target);db.exec("PRAGMA foreign_keys=ON;");
    assert.deepEqual(saved(db),before);
    assert.deepEqual(rows(db,"legacy_inventory_imports"),archive);
    assert.throws(()=>db.prepare("UPDATE character_coupons SET quantity=-1 WHERE user_id=1").run(),/CHECK/);
    assert.throws(()=>db.prepare("UPDATE character_cockroach_challenges SET status='invalid' WHERE event_id=4").run(),/CHECK/);
    assert.throws(()=>db.prepare("UPDATE legacy_item_usage SET remaining=-1 WHERE user_id=1 AND source_line=11").run(),/CHECK/);
    assert.throws(()=>db.prepare("INSERT INTO coupon_redemptions(user_id,request_id,source_index,original_name,coupon_cost,source_line,created_at) VALUES(1,'another_request',0,'福引券',1,6000000,?)").run(now),/UNIQUE/);
    const failCoupon={...redeemBody,requestId:"j4b_new_coupon"};
    db.exec("CREATE TRIGGER j4b_fail_coupon BEFORE INSERT ON coupon_redemptions BEGIN SELECT RAISE(ABORT,'j4b coupon blocked'); END;");
    assert.throws(()=>redeemEventCoupon(db,1,catalog,{...failCoupon,now}),/j4b coupon blocked/);assert.deepEqual(saved(db),before);
    db.exec("DROP TRIGGER j4b_fail_coupon;");
    const failUse={...useBody,requestId:"j4b_new_use"},charBefore={...db.prepare("SELECT * FROM characters WHERE user_id=1").get()};
    db.exec("CREATE TRIGGER j4b_fail_use BEFORE INSERT ON legacy_item_use_history BEGIN SELECT RAISE(ABORT,'j4b use blocked'); END;");
    assert.throws(()=>useLegacyItem(db,1,11,failUse.requestId,now),/j4b use blocked/);assert.deepEqual(saved(db),before);assert.deepEqual({...db.prepare("SELECT * FROM characters WHERE user_id=1").get()},charBefore);
    db.exec("DROP TRIGGER j4b_fail_use;");
    db.exec("CREATE TRIGGER j4b_fail_claim BEFORE UPDATE ON character_events BEGIN SELECT RAISE(ABORT,'j4b claim blocked'); END;");
    assert.throws(()=>claimCockroachForEvent(db,1,4,now,()=>{throw Error("expired random");},today),/j4b claim blocked/);assert.deepEqual(saved(db),before);
    db.exec("DROP TRIGGER j4b_fail_claim;");integrity(db);db.close();db=null;
    server=await serve(targetDir,zone);
    const escaped=await api(server,"events/cockroach/claim",{eventId:4});
    assert.deepEqual(escaped.cockroachResult,{status:"escaped",reward:0,kpoint:0,looks:0});assert.equal(escaped.character.money,160001);
    const nextCoupon=await api(server,"coupon/redeem",failCoupon);
    assert.equal(nextCoupon.couponBalance,3);assert.equal(nextCoupon.couponResult.sourceLine,6000001);
    const nextUse=await api(server,"inventory/legacy/use",failUse);
    assert.equal(nextUse.itemUseResult.replayed,false);assert.equal(nextUse.legacyItemActions.find(x=>x.sourceLine===11).remaining,1);
    await server.stop();server=null;
    server=await serve(targetDir,zone);
    const restart=await api(server,"state");
    assert.equal(restart.couponBalance,3);assert.equal(restart.cockroachChallenge,null);
    assert.deepEqual(restart.healthEvents.slice(1),first.healthEvents.slice(1));
    assert.deepEqual(restart.healthEvents[0].effects,{cockroach:"escaped"});
    assert.equal(restart.couponRedemptions.length,2);assert.equal(restart.legacyItemHistory.length,2);
    assert.equal((await api(server,"coupon/redeem",failCoupon)).couponResult.replayed,true);
    assert.equal((await api(server,"inventory/legacy/use",failUse)).itemUseResult.replayed,true);
    await rejected(server,"events/cockroach/claim",{eventId:4},/沒有待處理/);
    await server.stop();server=null;
    db=new DatabaseSync(target,{readOnly:true});integrity(db);
    assert.deepEqual(rows(db,"legacy_inventory_imports"),archive);
    assert.deepEqual(rows(db,"legacy_inventory_items").slice(0,2),before.legacy_inventory_items);
    assert.deepEqual(rows(db,"coupon_redemptions").slice(0,1),before.coupon_redemptions);
    assert.deepEqual(rows(db,"legacy_item_use_history").slice(0,1),before.legacy_item_use_history);
    assert.deepEqual(rows(db,"character_events").slice(0,3),before.character_events.slice(0,3));
    assert.deepEqual(rows(db,"character_cockroach_challenges").slice(0,2),before.character_cockroach_challenges.slice(0,2));
    assert.deepEqual(rows(db,"bank_ledger"),before.bank_ledger);
    assert.equal(sha(file),mainHash);assert.equal(sha(file+"-wal"),walHash);assert.equal(sha(snapshot),backup.sha256);
  }finally{
    if(server)await server.stop();if(db)db.close();if(source)source.close();rmSync(work,{recursive:true,force:true});
  }
});
