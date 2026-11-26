import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { backUpSolo, restoreSolo, verifySoloDatabase } from "../scripts/solo-save.mjs";
import { initBankTables, settleBankInterest } from "../src/banking.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const stats=()=>Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","love","unique","etti"].map(x=>[x,20]));
function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dir){
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",PORT:"0",DATA_DIR:dir}
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
async function api(url,route,body){
  const res=await fetch(url+"/api/"+route,{
    method:body===undefined?"GET":"POST",
    headers:body===undefined?{}:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:res.status,result:await res.json()};
}

// 真實歷史 Web #103 合併 441a30bffc9c45e2a303b988f98fb530f97a9f2a。
// 下列銀行 DDL 原樣取自 banking.mjs（僅更名函式），不是把現行表改回舊表。
function initPR103BankTables(db) {
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
    "kpoint INTEGER NOT NULL CHECK(kpoint>=0),",
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
}

// 同一歷史 server.mjs 的 users/sessions/characters 及逐欄升級順序；
// solo_clock 取自同版 solo-clock.mjs。這是代表性 schema 子集，非整套舊版 DB。
function initPR103Core(db,offset){
  db.exec("CREATE TABLE IF NOT EXISTS solo_clock (id INTEGER PRIMARY KEY CHECK(id=1), offset_ms INTEGER NOT NULL CHECK(offset_ms>=0));");
  db.prepare("INSERT INTO solo_clock(id,offset_ms) VALUES(1,?)").run(offset);
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
  initPR103BankTables(db);
}

const dayMs=86400000;
function sundayClock(){
  const now=Date.now();
  const fmt=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const parts=ms=>Object.fromEntries(fmt.formatToParts(new Date(ms)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  const p=parts(now);
  const weekday={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[p.weekday];
  const elapsed=((Number(p.hour)*60+Number(p.minute))*60+Number(p.second))*1000;
  const offset=(((7-weekday)%7)*dayMs+43200000-elapsed+7*dayMs)%(7*dayMs);
  const target=parts(now+offset);
  assert.equal(target.weekday,"Sun");
  const sunday=target.year+"-"+target.month+"-"+target.day;
  const date=n=>new Date(Date.parse(sunday+"T12:00:00Z")+n*dayMs).toISOString().slice(0,10);
  return {now:now+offset,offset,sunday,monday:date(1),prior:date(-6),earlier:date(-13)};
}
function financial(db){
  const rows=(table,order)=>db.prepare("SELECT * FROM "+table+" ORDER BY "+order).all();
  return {
    characters:db.prepare("SELECT id,user_id,money,bank,kpoint FROM characters ORDER BY user_id").all(),
    accounts:rows("bank_accounts","user_id"),
    taxes:rows("bank_tax_assessments","user_id,tax_day"),
    state:rows("bank_tax_state","user_id"),
    ledger:rows("bank_ledger","id"),
    clock:rows("solo_clock","id")
  };
}
function taxSchema(db){
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('bank_tax_assessments','bank_tax_history_idx','bank_tax_assessments_old') ORDER BY name").all();
}
function healthy(db){
  assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(x=>x.integrity_check),["ok"]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
}
function open(file,fn,readOnly=false){
  const db=new DatabaseSync(file,{readOnly});
  try{db.exec("PRAGMA foreign_keys=ON");return fn(db);}finally{db.close();}
}
function seed(dir,t){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  try{
    initPR103Core(db,t.offset);
    for(const id of [1,2]){
      insert(db,"users",{id,username:id===1?"__local_player__":"j2_isolation_fixture",password_salt:"fixture-only",password_hash:"fixture-only",created_at:t.now});
      insert(db,"characters",{id,user_id:id,name:id===1?"J稅務居民":"J隔離測試居民",gender:"other",town_id:id===1?0:1,money:id===1?3000000:100000,bank:id===1?2000000:100000,body_energy:90,brain_energy:90,recovered_at:t.now,job_id:null,work_progress:0,last_work_at:0,work_count:0,height:165,bmi:22,stats_json:JSON.stringify(stats()),weight:60,created_at:t.now,last_health_day:t.monday,last_event_day:t.monday,kpoint:0});
      insert(db,"bank_accounts",{user_id:id,term_balance:id===1?1000000:0,last_interest_day:t.sunday});
      insert(db,"bank_tax_state",{user_id:id,assessment_base:id===1?7000000:200000,snapshot_day:t.sunday});
    }
    for(const row of [
      {user_id:1,tax_day:t.earlier,assessment_base:6000000,kpoint:100,rate_percent:1,gross:60000,discount:30000,due:30000,paid:30000,unpaid:0,created_at:t.now-13*dayMs},
      {user_id:1,tax_day:t.prior,assessment_base:6000000,kpoint:0,rate_percent:1,gross:60000,discount:0,due:60000,paid:0,unpaid:60000,created_at:t.now-6*dayMs},
      {user_id:2,tax_day:t.prior,assessment_base:2000000,kpoint:0,rate_percent:1,gross:20000,discount:0,due:20000,paid:0,unpaid:20000,created_at:t.now-6*dayMs}
    ])insert(db,"bank_tax_assessments",row);
    insert(db,"bank_ledger",{id:1,user_id:1,account_type:"ordinary",action:"每週納稅（K 點折扣）",debit:30000,credit:0,balance:2000000,created_at:t.now-13*dayMs});
    // 第二個帳號僅為資料庫隔離測試；不新增單機 NPC 或真人資料。
    insert(db,"bank_ledger",{id:2,user_id:2,account_type:"ordinary",action:"存入",debit:0,credit:100000,balance:100000,created_at:t.now-6*dayMs});
    db.exec("PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE); UPDATE characters SET money=4000000 WHERE user_id=1;");
    return db;
  }catch(error){db.close();throw error;}
}
test("J-2：#103 真實歷史稅表 WAL 備份、DDL 回滾、負 K 點 HTTP 週稅與重啟",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-j2-pr103-"));
  const sourceDir=join(dir,"source"),faultDir=join(dir,"fault"),httpDir=join(dir,"http");
  const sourceFile=join(sourceDir,"solo.sqlite"),snapshotFile=join(dir,"snapshot.sqlite");
  const t=sundayClock();
  let source,web;
  try{
    source=seed(sourceDir,t);
    const original=financial(source),oldSchema=taxSchema(source);
    assert.match(oldSchema.find(x=>x.name==="bank_tax_assessments").sql,/CHECK\(kpoint>=0\)/);
    assert.throws(()=>source.exec("UPDATE bank_tax_assessments SET kpoint=-3 WHERE user_id=1"),/CHECK constraint failed/);
    const main=readFileSync(sourceFile),wal=readFileSync(sourceFile+"-wal");
    assert.ok(wal.length>32,"必須有已提交但未 checkpoint 的 WAL");
    const backup=await backUpSolo({dataDir:sourceDir,file:snapshotFile});
    assert.equal(verifySoloDatabase(snapshotFile).sha256,backup.sha256);
    const fault=restoreSolo({dataDir:faultDir,file:snapshotFile});
    const target=restoreSolo({dataDir:httpDir,file:snapshotFile});
    assert.equal(fault.sha256,backup.sha256);assert.equal(target.sha256,backup.sha256);
    assert.throws(()=>restoreSolo({dataDir:httpDir,file:snapshotFile}),/拒絕覆寫/);
    assert.deepEqual(open(snapshotFile,financial,true),original);
    // 故障切片：在真實遷移的資料複製後、刪除舊表之前執行錯誤 SQL。
    open(fault.file,db=>{
      assert.deepEqual(financial(db),original);
      let copied=false;
      const faultDb={
        prepare:sql=>db.prepare(sql),
        exec(sql){
          db.exec(sql);
          if(sql==="INSERT INTO bank_tax_assessments SELECT * FROM bank_tax_assessments_old"){
            copied=true;
            assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_tax_assessments").get().n,original.taxes.length);
            db.exec("SELECT * FROM j2_intentionally_missing_table");
          }
        }
      };
      assert.throws(()=>initBankTables(faultDb),/no such table/);
      assert.equal(copied,true,"必須進入真正的資料複製階段");
      assert.deepEqual(taxSchema(db),oldSchema);
      assert.deepEqual(financial(db),original);healthy(db);
    });
    // 關閉再重開，重試同一遷移，不能殘留 old 表、丟失索引或重複資料。
    open(fault.file,db=>{
      assert.deepEqual(taxSchema(db),oldSchema);
      initBankTables(db);initBankTables(db);
      assert.deepEqual(financial(db),original);
      const schema=taxSchema(db);
      assert.equal(schema.length,2);
      assert.doesNotMatch(schema.find(x=>x.name==="bank_tax_assessments").sql,/CHECK\(kpoint>=0\)/);
      assert.equal(schema.find(x=>x.name==="bank_tax_history_idx").tbl_name,"bank_tax_assessments");
      assert.deepEqual(db.prepare("PRAGMA index_info(bank_tax_history_idx)").all().map(x=>x.name),["user_id","tax_day"]);
      assert.throws(()=>db.exec("UPDATE bank_tax_assessments SET due=-1 WHERE user_id=1"),/CHECK constraint failed/);
      assert.throws(()=>db.exec("UPDATE bank_tax_assessments SET paid=1 WHERE user_id=1"),/CHECK constraint failed/);
      assert.throws(()=>db.exec("UPDATE bank_tax_assessments SET user_id=999 WHERE user_id=1"),/FOREIGN KEY constraint failed/);
      assert.throws(()=>db.exec("INSERT INTO bank_tax_assessments SELECT * FROM bank_tax_assessments WHERE user_id=1"),/UNIQUE constraint failed/);
      db.exec("UPDATE characters SET kpoint=-3 WHERE user_id=1");
      const before=financial(db);
      db.exec("CREATE TRIGGER j2_block_tax BEFORE INSERT ON bank_tax_assessments BEGIN SELECT RAISE(ABORT,'j2 settlement fault'); END;");
      assert.throws(()=>settleBankInterest(db,1,t.monday,t.now+dayMs),/j2 settlement fault/);
      assert.deepEqual(financial(db),before,"利息、稅款、帳簿、日期及稅基必須一起回滾");
      db.exec("DROP TRIGGER j2_block_tax");
      const result=settleBankInterest(db,1,t.monday,t.now+dayMs);
      assert.deepEqual(result.tax,{ratePercent:1,gross:70000,discount:0,due:70000,paid:70000,unpaid:0,taxDay:t.monday});
      assert.equal(settleBankInterest(db,1,t.monday,t.now+dayMs+1).applied,false);healthy(db);
    });
    // 獨立還原副本仍是舊 schema，真正 server 啟動走正式遷移順序，而非先由測試升級。
    assert.deepEqual(open(target.file,taxSchema,true),oldSchema);
    web=await serve(httpDir);
    const first=await api(web.url,"state");
    assert.equal(first.status,200);
    assert.equal(first.result.character.name,"J稅務居民");
    assert.equal(first.result.character.money,4000000);
    assert.equal(first.result.bankTax.assessmentBase,7000000);
    assert.equal(first.result.bankTax.unpaidTotal,"60000");
    assert.equal(first.result.bankTax.lastAssessment.day,t.prior);
    assert.deepEqual(open(target.file,financial,true),original);
    // 僅在隔離測試注入既有核准的負 K 點；不重作街頭玩法、不新增單機對手。
    open(target.file,db=>db.exec("UPDATE characters SET kpoint=-3 WHERE user_id=1"));
    const advanced=await api(web.url,"solo/time/advance",{preset:"1d"});
    assert.equal(advanced.status,200,JSON.stringify(advanced.result.error));
    assert.equal(advanced.result.character.kpoint,-3);
    assert.equal(advanced.result.character.bank,1940000);
    assert.equal(advanced.result.bankAccount.termBalance,1010000);
    assert.equal(advanced.result.bankTax.assessmentBase,6950000);
    assert.equal(advanced.result.bankTax.unpaidTotal,"60000");
    assert.equal(advanced.result.bankTax.unpaidPeriods,1);
    assert.deepEqual(advanced.result.bankTax.lastAssessment,{day:t.monday,assessmentBase:7000000,kpoint:-3,ratePercent:1,gross:70000,discount:0,due:70000,paid:70000,unpaid:0});
    const settled=open(target.file,financial,true);
    assert.deepEqual(settled.taxes.filter(x=>x.tax_day!==t.monday),original.taxes);
    assert.equal(settled.taxes.length,original.taxes.length+1);
    assert.equal(settled.ledger.filter(x=>x.user_id===1&&x.action==="每週納稅").length,1);
    for(const key of ["characters","accounts","taxes","state","ledger"])
      assert.deepEqual(settled[key].filter(x=>x.user_id===2),original[key].filter(x=>x.user_id===2),key+" 帳號隔離");
    assert.equal((await api(web.url,"state")).status,200);
    assert.deepEqual(open(target.file,financial,true),settled,"同日重讀不能再次扣稅");
    const deposited=await api(web.url,"bank",{action:"deposit",amount:500});
    assert.equal(deposited.status,200);
    assert.equal(deposited.result.character.money,3999500);
    assert.equal(deposited.result.character.bank,1940500);
    const played=open(target.file,financial,true);
    await web.stop();web=null;
    web=await serve(httpDir);
    const resumed=await api(web.url,"state");
    assert.equal(resumed.status,200);
    assert.equal(resumed.result.character.money,3999500);
    assert.equal(resumed.result.character.bank,1940500);
    assert.equal(resumed.result.bankTax.unpaidTotal,"60000");
    assert.deepEqual(open(target.file,financial,true),played);
    open(target.file,healthy,true);
    assert.deepEqual(financial(source),original);
    assert.deepEqual(taxSchema(source),oldSchema);
    assert.deepEqual(readFileSync(sourceFile),main);
    assert.deepEqual(readFileSync(sourceFile+"-wal"),wal);
    assert.equal(verifySoloDatabase(snapshotFile).sha256,backup.sha256);
  }finally{
    if(web)await web.stop();
    source?.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
