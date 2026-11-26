import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, copyFileSync, constants, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash, scryptSync } from "node:crypto";
import { initBankTables, settleBankInterest } from "../src/banking.mjs";
import { decodeLegacyText, STAT_KEYS } from "../src/engine.mjs";
import { initTownMapTable, storeTownMap } from "../src/town-storage.mjs";
import { parseArenaCatalog } from "../src/b-league-core.mjs";
import { initArenaTables, parseArenaDrops, playArena } from "../src/b-league.mjs";
import { parseOsakaRules } from "../src/osaka-challenge-core.mjs";
import { resolveOsakaNpcCatalog } from "../src/osaka-npc-catalog.mjs";
import { initOsakaTables, playOsaka } from "../src/osaka-challenge.mjs";
import { initCLeagueTables, trainCLeague, playCLeague } from "../src/c-league.mjs";
import { initStreetFightTables, playStreetFight } from "../src/street-fight.mjs";

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
async function api(url,route,body,cookie){
  const res=await fetch(url+"/api/"+route,{
    method:body===undefined?"GET":"POST",
    headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(cookie?{Cookie:cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:res.status,result:await res.json(),cookie:res.headers.get("set-cookie")?.split(";")[0]};
}


// #121 合併 e2e3004ad9af13021c4bae540863f9ca26e34b10 的代表性 schema 子集。
// B、大阪、C、街頭、銀行、裝備、道具使用、town-storage、核心及 NPC catalog
// 在基準 06711c4 與 #121 的 blob 相同，可直接執行原樣初始化及收據產生。
// legacy-inventory 模組後續有變更，故先原樣保留 #121 的 DDL。
function initPR121LegacyInventoryTables(db) {
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

function initPR121Core(db){
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
  initTownMapTable(db);
  initBankTables(db);
  initCLeagueTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS character_coupons(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0));"
  ].join("\n"));
  initStreetFightTables(db);
  initPR121LegacyInventoryTables(db);
  initArenaTables(db);
  initOsakaTables(db);
}

const source=path=>decodeLegacyText(readFileSync(new URL("../../"+path,import.meta.url)));
const arenaCatalog=parseArenaCatalog(source("dat_dir/battle.cgi"));
const drops=parseArenaDrops(source("battle.cgi"));
const osakaRules=parseOsakaRules(source("obatyan.cgi"));
function seq(...values){return n=>{assert.ok(values.length,"unexpected RNG");const v=values.shift();assert.ok(v>=0&&v<n);return v;};}
function open(file,fn){
  const db=new DatabaseSync(file,{readOnly:true});
  try{db.exec("PRAGMA foreign_keys=ON");return fn(db);}finally{db.close();}
}
function healthy(db){
  assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(x=>x.integrity_check),["ok"]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
}
function financial(db){
  const tables={
    b_league_battles:"id",b_league_default_gear:"user_id,type",
    osaka_battles:"id",street_fights:"id",
    c_league_chars:"user_id",c_league_entries:"user_id",c_league_requests:"id",c_league_season:"id",
    equipment_items:"id",legacy_inventory_items:"id",legacy_item_usage:"user_id,source_line",
    legacy_item_use_history:"id",bank_accounts:"user_id",bank_tax_state:"user_id",
    bank_tax_assessments:"user_id,tax_day",bank_ledger:"id",character_coupons:"user_id"
  };
  return {character:db.prepare("SELECT id,user_id,money,bank,kpoint,stats_json FROM characters ORDER BY user_id").all(),
    ...Object.fromEntries(Object.entries(tables).map(([table,order])=>[table,db.prepare("SELECT * FROM "+table+" ORDER BY "+order).all()]))};
}

const reqId="j3b-shared-receipt",trainId="j3b-shared-train";
const username=id=>"j3b_fixture_"+id;
const password=id=>"j3b-fixture-password-"+id;
const token=id=>"j3b-historical-session-token-000"+id;
const cookie=id=>"town_web_session="+token(id);
function dateContext(){
  const now=Date.now();
  const zones=["Asia/Taipei","UTC","America/Los_Angeles"];
  const timezone=zones.find(timeZone=>{
    const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone,hour:"2-digit",hourCycle:"h23"}).format(now));
    return hour>=6&&hour<18;
  });
  assert.ok(timezone,"固定測試日期，避免執行跨當地午夜");
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const date=new Date(today+"T12:00:00Z");
  const next=(8-date.getUTCDay())%7||7;
  const shift=n=>new Date(date.getTime()+n*86400000).toISOString().slice(0,10);
  return {now,timezone,today,nextMonday:shift(next),nextAt:now+next*86400000,prior:shift(next-14),earlier:shift(next-21)};
}
function seedMulti(dir,t,npcRoot){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"multi.sqlite"));
  try{
    initPR121Core(db);
    for(const id of [1,2]){
      const salt="j3b-fixture-salt-"+id;
      insert(db,"users",{id,username:username(id),password_salt:salt,password_hash:scryptSync(password(id),salt,64).toString("hex"),created_at:t.now-90000});
      insert(db,"sessions",{token_hash:hashText(token(id)),user_id:id,expires_at:t.now+7*86400000});
      insert(db,"characters",{id,user_id:id,name:id===1?"J多人甲":"J多人乙",gender:"other",town_id:0,money:id===1?2000000:4000000,bank:1000000,kpoint:0,body_energy:1000,brain_energy:1000,recovered_at:t.now-90000,job_id:null,work_progress:0,last_work_at:0,work_count:0,height:165,bmi:22,stats_json:JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,id===1?20:5000]))),weight:60,created_at:t.now-90000,last_health_day:t.today,last_event_day:t.today});
      insert(db,"bank_accounts",{user_id:id,term_balance:0,last_interest_day:t.today});
      insert(db,"bank_tax_state",{user_id:id,assessment_base:id===1?3000000:5000000,snapshot_day:t.today});
      insert(db,"bank_tax_assessments",{user_id:id,tax_day:t.prior,assessment_base:id===1?3000000:5000000,kpoint:0,rate_percent:1,gross:id===1?30000:50000,discount:0,due:id===1?30000:50000,paid:0,unpaid:id===1?30000:50000,created_at:Date.parse(t.prior+"T12:00:00Z")});
    }
    insert(db,"bank_tax_assessments",{user_id:2,tax_day:t.earlier,assessment_base:5000000,kpoint:100,rate_percent:1,gross:50000,discount:25000,due:25000,paid:25000,unpaid:0,created_at:Date.parse(t.earlier+"T12:00:00Z")});
    insert(db,"bank_ledger",{user_id:2,account_type:"ordinary",action:"每週納稅（K 點折扣）",debit:25000,credit:0,balance:1000000,created_at:Date.parse(t.earlier+"T12:00:00Z")});
    const tiles=Array(192).fill("");tiles[0]="Ｂリーグ";tiles[1]="おばちゃん";tiles[2]="おばちゃん強";
    storeTownMap(db,0,{tiles},"web-edited");
    db.exec("PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE);");
    const street=(id,randomIndex)=>playStreetFight(db,id,{mode:"multi",requestId:reqId,now:t.now-80000,today:t.today,randomIndex});
    const aStreet=street(1,()=>0),bStreet=street(2,seq(0,8,0,4,0));
    assert.equal(aStreet.outcome,"noOpponent");assert.equal(bStreet.outcome,"win");
    assert.equal(bStreet.coupons,5);assert.equal(bStreet.kpointDelta,-3);
    const arena=playArena(db,2,arenaCatalog,drops,{rank:"d",requestId:reqId,now:t.now-70000,today:t.today,hasBuilding:()=>true,rng:seq(0,1,0,99,9,1)});
    assert.equal(arena.outcome,"win");assert.equal(arena.kpointDelta,1);
    const catalog=resolveOsakaNpcCatalog(npcRoot,"auto");
    const osaka=playOsaka(db,2,osakaRules,catalog,{mode:"week",requestId:reqId,now:t.now-60000,today:t.today,rng:seq(0,0,1)});
    assert.equal(osaka.npcSource,"reconstructed");assert.equal(osaka.npcSourceVersion,"web-osaka-npc-v1");assert.ok(osaka.reward.granted);
    const trained=trainCLeague(db,2,{requestId:trainId,name:"J多人乙培育",transfers:{kokugo:1}},t.now-50000,t.today);
    const league=playCLeague(db,2,{requestId:reqId},t.now-40000,t.today,()=>0);
    assert.equal(trained.cost,10000);assert.equal(league.replayed,false);
    assert.equal(db.prepare("SELECT kpoint FROM characters WHERE user_id=2").get().kpoint,-2);
    return {db,aStreet,bStreet,arena,osaka,trained,league};
  }catch(error){db.close();throw error;}
}
function hashText(value){return createHash("sha256").update(value).digest("hex");}
function hashFile(file){return hashText(readFileSync(file));}
function verifySnapshot(file){
  open(file,healthy);
  assert.equal(statSync(file+"-wal",{throwIfNoEntry:false})?.size??0,0);
  return hashFile(file);
}
function restoreTestCopy(snapshot,dir,hash){
  mkdirSync(dir,{recursive:true});
  const target=join(dir,"multi.sqlite");
  // 僅測試 SQLite 一致快照；不擴充正式單機 CLI 或提供多人備份功能。
  copyFileSync(snapshot,target,constants.COPYFILE_EXCL);
  assert.equal(verifySnapshot(target),hash);
  return target;
}
function actorRows(state,id){
  return Object.fromEntries(Object.entries(state).filter(([key])=>key!=="c_league_season").map(([key,rows])=>[key,rows.filter(x=>x.user_id===id).map(x=>{
    if(key!=="c_league_entries")return x;
    const {sort_order,...record}=x; // 公開排名排序可因另一玩家參賽而變動。
    return record;
  })]));
}
function oldReceiptsRemain(old,now){
  for(const key of ["street_fights","b_league_battles","osaka_battles","c_league_requests"])
    assert.deepEqual(now[key].filter(x=>old[key].some(y=>y.id===x.id)),old[key],key+" 歷史收據不得改寫");
}
test("J-3b：#121 多人歷史戰鬥 WAL 快照、登入隔離、負 K 點週稅及交易失敗重試",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-j3b-battles-"));
  const sourceDir=join(dir,"source"),targetDir=join(dir,"restored"),taxDir=join(dir,"tax"),npcRoot=join(dir,"missing-npc");
  const sourceFile=join(sourceDir,"multi.sqlite"),snapshot=join(dir,"snapshot.sqlite");
  const t=dateContext();let db,web;
  try{
    const seeded=seedMulti(sourceDir,t,npcRoot);db=seeded.db;
    const before=financial(db),main=readFileSync(sourceFile),wal=readFileSync(sourceFile+"-wal");
    assert.ok(wal.length>32);healthy(db);
    const reader=new DatabaseSync(sourceFile,{readOnly:true});
    try{await backup(reader,snapshot);}finally{reader.close();}
    const hash=verifySnapshot(snapshot);
    assert.deepEqual(open(snapshot,financial),before);
    const target=restoreTestCopy(snapshot,targetDir,hash),taxFile=restoreTestCopy(snapshot,taxDir,hash);
    assert.throws(()=>restoreTestCopy(snapshot,targetDir,hash),/EEXIST/);
    // 另一隔離副本驗證街頭真實負 K 點與歷史已繳／未繳稅表；不改多人伺服器時鐘。
    const taxDb=new DatabaseSync(taxFile);
    try{
      taxDb.exec("PRAGMA foreign_keys=ON");
      initBankTables(taxDb);
      const base=before.bank_tax_state.find(x=>x.user_id===2).assessment_base;
      const due=Math.floor(base/100);
      assert.ok(base>1000000&&base<=10000000);
      const assessed=settleBankInterest(taxDb,2,t.nextMonday,t.nextAt);
      assert.deepEqual(assessed.tax,{ratePercent:1,gross:due,discount:0,due,paid:due,unpaid:0,taxDay:t.nextMonday});
      const after=financial(taxDb),row=after.bank_tax_assessments.find(x=>x.user_id===2&&x.tax_day===t.nextMonday);
      assert.equal(row.kpoint,-2);assert.equal(row.assessment_base,base);
      assert.deepEqual(after.bank_tax_assessments.filter(x=>x.tax_day!==t.nextMonday),before.bank_tax_assessments);
      assert.deepEqual(actorRows(after,1),actorRows(before,1));
      oldReceiptsRemain(before,after);
      assert.equal(settleBankInterest(taxDb,2,t.nextMonday,t.nextAt+1).applied,false);
      assert.deepEqual(financial(taxDb),after);healthy(taxDb);
    }finally{taxDb.close();}
    const savedSessions=open(target,x=>x.prepare("SELECT * FROM sessions ORDER BY user_id").all());
    web=await serve(targetDir,npcRoot,"auto",t.timezone);
    const firstA=await api(web.url,"state",undefined,cookie(1)),firstB=await api(web.url,"state",undefined,cookie(2));
    assert.equal(firstA.result.character.name,"J多人甲");assert.equal(firstB.result.character.name,"J多人乙");
    assert.equal(firstA.result.streetFight.history[0].outcome,"noOpponent");
    assert.equal(firstB.result.streetFight.history[0].outcome,"win");
    assert.equal(firstA.result.couponBalance,0);assert.equal(firstB.result.couponBalance,5);
    assert.equal(firstB.result.character.kpoint,-2);assert.equal(firstB.result.bankTax.unpaidTotal,"50000");
    assert.equal(firstA.result.bankTax.unpaidTotal,"30000");
    assert.equal(firstA.result.bLeague.history.length,0);assert.equal(firstA.result.osaka.history.length,0);assert.equal(firstA.result.cLeague.history.length,0);
    assert.equal(firstB.result.bLeague.history.length,1);assert.equal(firstB.result.osaka.history[0].npcSourceVersion,"web-osaka-npc-v1");assert.equal(firstB.result.cLeague.history.length,1);
    assert.deepEqual(open(target,financial),before);
    assert.deepEqual(open(target,x=>x.prepare("SELECT * FROM sessions ORDER BY user_id").all()),savedSessions);
    assert.equal((await api(web.url,"street-fight/play",{requestId:reqId})).status,401);
    assert.equal((await api(web.url,"street-fight/play",{requestId:reqId,userId:2},cookie(1))).status,400);
    assert.equal((await api(web.url,"login",{username:username(2),password:password(1)})).status,401);
    const logged=await api(web.url,"login",{username:username(2),password:password(2)});
    assert.equal(logged.status,200);assert.ok(logged.cookie);
    const cases=[
      ["street-fight/play",{requestId:reqId},"streetFightResult",seeded.aStreet,cookie(1)],
      ["street-fight/play",{requestId:reqId},"streetFightResult",seeded.bStreet,cookie(2)],
      ["b-league/play",{rank:"d",requestId:reqId},"bLeagueResult",seeded.arena,cookie(2)],
      ["osaka/play",{mode:"week",requestId:reqId},"osakaResult",seeded.osaka,cookie(2)],
      ["c-league/train",{requestId:trainId,name:"J多人乙培育",transfers:{kokugo:1}},"cLeagueResult",seeded.trained,cookie(2)],
      ["c-league/play",{requestId:reqId},"cLeagueResult",seeded.league,cookie(2)]
    ];
    async function replayOld(){
      for(const [route,payload,key,receipt,auth] of cases){
        const x=await api(web.url,route,payload,auth);
        assert.equal(x.status,200,JSON.stringify(x.result.error));assert.deepEqual(x.result[key],{...receipt,replayed:true},route);
      }
    }
    await replayOld();assert.deepEqual(open(target,financial),before);
    // 甲使用乙曾用過的各模組識別碼，必須各自產生自己的收據，不能拿到乙的收據。
    for(const [route,payload,key] of [
      ["b-league/play",{rank:"d",requestId:reqId},"bLeagueResult"],
      ["osaka/play",{mode:"week",requestId:reqId},"osakaResult"],
      ["c-league/train",{requestId:trainId,name:"J多人甲培育"},"cLeagueResult"],
      ["c-league/play",{requestId:reqId},"cLeagueResult"]
    ]){
      const x=await api(web.url,route,payload,cookie(1));assert.equal(x.status,200,JSON.stringify(x.result.error));assert.equal(x.result[key].replayed,false);
    }
    const afterA=open(target,financial);
    assert.deepEqual(actorRows(afterA,2),actorRows(before,2));oldReceiptsRemain(before,afterA);
    for(const key of ["street_fights","b_league_battles","osaka_battles","c_league_requests"])
      assert.deepEqual(afterA[key].filter(x=>x.request_id===reqId).map(x=>x.user_id).sort(),[1,2],key);
    // 實際 HTTP 新街頭戰鬥在寫入收據時故障，資產／券／稅基及歷史全回滾；同請求重試。
    const trigger=sql=>{const x=new DatabaseSync(target);try{x.exec(sql);}finally{x.close();}};
    const allCharacters=x=>x.prepare("SELECT * FROM characters ORDER BY user_id").all();
    const beforeFaultCharacters=open(target,allCharacters);
    trigger("CREATE TRIGGER j3b_fail_street BEFORE INSERT ON street_fights BEGIN SELECT RAISE(ABORT,'j3b receipt fault'); END;");
    const payload={requestId:"j3b-new-street"};
    const failed=await api(web.url,"street-fight/play",payload,logged.cookie);
    assert.equal(failed.status,400);assert.match(failed.result.error,/j3b receipt fault/);
    assert.deepEqual(open(target,financial),afterA);
    assert.deepEqual(open(target,allCharacters),beforeFaultCharacters,"能量與恢復時間也必須回滾");
    trigger("DROP TRIGGER j3b_fail_street;");
    const played=await api(web.url,"street-fight/play",payload,logged.cookie);
    assert.equal(played.status,200,JSON.stringify(played.result.error));
    const receipt=played.result.streetFightResult;
    assert.equal(receipt.replayed,false);assert.equal(receipt.outcome,"win");
    assert.equal(played.result.character.kpoint,-2+receipt.kpointDelta);
    assert.equal(played.result.couponBalance,5+receipt.coupons);
    const final=open(target,financial);assert.deepEqual(actorRows(final,1),actorRows(afterA,1));oldReceiptsRemain(before,final);
    assert.deepEqual(open(target,allCharacters).find(x=>x.user_id===1),beforeFaultCharacters.find(x=>x.user_id===1));
    await web.stop();web=null;
    web=await serve(targetDir,npcRoot,"auto",t.timezone);
    const again=await api(web.url,"street-fight/play",payload,logged.cookie);
    assert.equal(again.status,200);assert.deepEqual(again.result.streetFightResult,{...receipt,replayed:true});
    await replayOld();assert.deepEqual(open(target,financial),final);
    open(target,healthy);
    assert.deepEqual(financial(db),before);assert.deepEqual(readFileSync(sourceFile),main);assert.deepEqual(readFileSync(sourceFile+"-wal"),wal);
    assert.equal(verifySnapshot(snapshot),hash);
  }finally{
    if(web)await web.stop();db?.close();rmSync(dir,{recursive:true,force:true});
  }
});
