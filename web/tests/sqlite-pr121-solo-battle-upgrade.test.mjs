import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { backUpSolo, restoreSolo, verifySoloDatabase } from "../scripts/solo-save.mjs";
import { initBankTables } from "../src/banking.mjs";
import { decodeLegacyText, STAT_KEYS } from "../src/engine.mjs";
import { initTownMapTable, storeTownMap } from "../src/town-storage.mjs";
import { parseArenaCatalog } from "../src/b-league-core.mjs";
import { initArenaTables, parseArenaDrops, playArena } from "../src/b-league.mjs";
import { parseOsakaRules } from "../src/osaka-challenge-core.mjs";
import { resolveOsakaNpcCatalog } from "../src/osaka-npc-catalog.mjs";
import { initOsakaTables, playOsaka } from "../src/osaka-challenge.mjs";
import { initCLeagueTables, trainCLeague, playCLeague } from "../src/c-league.mjs";
import { initStreetFightTables } from "../src/street-fight.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));

function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dir,npcRoot,policy="auto"){
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",PORT:"0",DATA_DIR:dir,OSAKA_NPC_ROOT:npcRoot,OSAKA_NPC_POLICY:policy,GAME_TIMEZONE:"Asia/Taipei"}
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

function initPR121Core(db,offset){
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
  initTownMapTable(db);
  initBankTables(db);
  initCLeagueTables(db);
  initStreetFightTables(db);
  initPR121LegacyInventoryTables(db);
  initArenaTables(db);
  initOsakaTables(db);
}

const source=path=>decodeLegacyText(readFileSync(new URL("../../"+path,import.meta.url)));
const arenaCatalog=parseArenaCatalog(source("dat_dir/battle.cgi"));
const drops=parseArenaDrops(source("battle.cgi"));
const osakaRules=parseOsakaRules(source("obatyan.cgi"));
const requestId="j3-same-request";
const legacyId="j3-old-unlabelled";
const originalId="j3-original-file";
const trainId="j3-train";
const dateFormat=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"});
function anchor(){
  const now=Date.now(),day=86400000;
  const local=(now+8*3600000)%day;
  const offset=(12*3600000-local+day)%day;
  const time=now+offset;
  return {offset,time,today:dateFormat.format(time)};
}
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
    bank_tax_assessments:"user_id,tax_day",bank_ledger:"id",solo_clock:"id"
  };
  return {character:db.prepare("SELECT id,user_id,money,bank,kpoint,stats_json FROM characters ORDER BY user_id").all(),
    ...Object.fromEntries(Object.entries(tables).map(([table,order])=>[table,db.prepare("SELECT * FROM "+table+" ORDER BY "+order).all()]))};
}
function seedNpcs(root){
  const dir=join(root,"member","osaka");mkdirSync(dir,{recursive:true});
  for(const prefix of ["w","s"])for(let i=1;i<=5;i++){
    const filename=prefix+i+"log.cgi";
    const fields=Array(68).fill("");
    fields[1]="J3 TEST "+filename;fields[2]="J3 FIXTURE PRIVATE FIELD";
    STAT_KEYS.forEach((_,j)=>{fields[6+j]="24";});
    writeFileSync(join(dir,filename),fields.join("<>"));
  }
}
function seed(dir,t,originalRoot,emptyRoot){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  try{
    initPR121Core(db,t.offset);
    const initial=t.time-90000;
    insert(db,"users",{id:1,username:"__local_player__",password_salt:"fixture-only",password_hash:"fixture-only",created_at:initial});
    insert(db,"characters",{id:1,user_id:1,name:"J戰鬥居民",gender:"other",town_id:0,money:4000000,bank:1000000,kpoint:-3,body_energy:1000,brain_energy:1000,recovered_at:initial,job_id:null,work_progress:0,last_work_at:0,work_count:0,height:165,bmi:22,stats_json:JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,5000]))),weight:60,created_at:initial,last_health_day:t.today,last_event_day:t.today});
    insert(db,"bank_accounts",{user_id:1,term_balance:0,last_interest_day:t.today});
    insert(db,"bank_tax_state",{user_id:1,assessment_base:5000000,snapshot_day:t.today});
    const tiles=Array(192).fill("");tiles[0]="Ｂリーグ";tiles[1]="おばちゃん";tiles[2]="おばちゃん強";
    storeTownMap(db,0,{tiles},"web-edited");
    db.exec("PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE);");
    const arena=playArena(db,1,arenaCatalog,drops,{rank:"d",requestId,now:t.time-80000,today:t.today,hasBuilding:()=>true,rng:seq(0,1,0,99,9,0)});
    assert.equal(arena.outcome,"win");assert.equal(arena.reward.granted,true);
    const original=resolveOsakaNpcCatalog(originalRoot,"original-only");
    const rebuilt=resolveOsakaNpcCatalog(emptyRoot,"auto");
    assert.equal(original.source,"original-file");assert.equal(rebuilt.sourceVersion,"web-osaka-npc-v1");
    const play=(catalog,id,now)=>playOsaka(db,1,osakaRules,catalog,{mode:"week",requestId:id,now,today:t.today,rng:seq(0,0,1)});
    // c38adff1 歷史 Draft 的原始 NPC 無 source，receipt={...battle,reward,playedAt:now}。
    // 以合成原版欄位和現行相同戰鬥流程生成其歷史 JSON 形狀，非宣稱曾正式發布舊 Draft。
    const oldCatalog={...original,npcs:original.npcs.map(({source,...npc})=>npc)};
    const {npcSource,npcSourceVersion,replayed,...legacy}=play(oldCatalog,legacyId,t.time-70000);
    assert.equal(npcSource,"unknown");assert.equal(npcSourceVersion,null);
    assert.equal(Object.hasOwn(legacy.npc,"source"),false);
    db.prepare("UPDATE osaka_battles SET result_json=? WHERE user_id=1 AND request_id=?").run(JSON.stringify(legacy),legacyId);
    const labelled=play(original,originalId,t.time-60000);
    const reconstructed=play(rebuilt,requestId,t.time-50000);
    assert.equal(labelled.npcSource,"original-file");assert.equal(labelled.npcSourceVersion,null);
    assert.equal(reconstructed.npcSource,"reconstructed");assert.equal(reconstructed.npcSourceVersion,"web-osaka-npc-v1");
    assert.ok([legacy,labelled,reconstructed].every(x=>x.outcome==="win"&&x.reward.granted));
    assert.equal(labelled.reward.sourceLine,legacy.reward.sourceLine);
    assert.equal(reconstructed.reward.sourceLine,legacy.reward.sourceLine);
    const trained=trainCLeague(db,1,{requestId:trainId,name:"J培育角色",transfers:{kokugo:1}},t.time-40000,t.today);
    assert.equal(trained.cost,10000);
    const league=playCLeague(db,1,{requestId},t.time-30000,t.today,()=>0);
    assert.equal(league.replayed,false);
    return {db,legacy,arena,labelled,reconstructed,trained,league};
  }catch(error){db.close();throw error;}
}
test("J-3a：#121 單機戰鬥收據 WAL 還原，三種大阪來源、跨模組重送與續玩",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-j3a-battles-"));
  const sourceDir=join(dir,"source"),targetDir=join(dir,"restored"),snapshot=join(dir,"snapshot.sqlite");
  const originalRoot=join(dir,"synthetic-npc"),emptyRoot=join(dir,"missing-npc");
  let sourceDb,web;
  try{
    seedNpcs(originalRoot);
    const t=anchor(),seeded=seed(sourceDir,t,originalRoot,emptyRoot);sourceDb=seeded.db;
    const sourceFile=join(sourceDir,"solo.sqlite");
    const before=financial(sourceDb),main=readFileSync(sourceFile),wal=readFileSync(sourceFile+"-wal");
    assert.ok(wal.length>32);
    assert.equal(before.character.length,1,"單機不建立虛構對手");
    assert.equal(before.street_fights.length,0);
    assert.equal(before.osaka_battles.length,3);
    assert.equal(before.legacy_inventory_items.find(x=>x.source_line===seeded.legacy.reward.sourceLine).durability,9);
    healthy(sourceDb);
    const backup=await backUpSolo({dataDir:sourceDir,file:snapshot});
    const restored=restoreSolo({dataDir:targetDir,file:snapshot});
    assert.equal(restored.sha256,backup.sha256);
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
    assert.throws(()=>restoreSolo({dataDir:targetDir,file:snapshot}),/拒絕覆寫/);
    assert.deepEqual(open(restored.file,financial),before);
    const replayCases=[
      ["b-league/play",{rank:"d",requestId},"bLeagueResult",seeded.arena],
      ["osaka/play",{mode:"week",requestId:legacyId},"osakaResult",seeded.legacy],
      ["osaka/play",{mode:"week",requestId:originalId},"osakaResult",seeded.labelled],
      ["osaka/play",{mode:"week",requestId},"osakaResult",seeded.reconstructed],
      ["c-league/train",{requestId:trainId,name:"J培育角色",transfers:{kokugo:1}},"cLeagueResult",seeded.trained],
      ["c-league/play",{requestId},"cLeagueResult",seeded.league]
    ];
    async function checkReplays(){
      for(const [route,payload,key,receipt] of replayCases){
        const response=await api(web.url,route,payload);
        assert.equal(response.status,200,JSON.stringify(response.result.error));
        assert.deepEqual(response.result[key],{...receipt,replayed:true},route+" 原收據");
      }
      assert.equal((await api(web.url,"b-league/play",{rank:"s",requestId})).status,400);
      assert.equal((await api(web.url,"osaka/play",{mode:"strong",requestId:legacyId})).status,400);
      assert.equal((await api(web.url,"c-league/play",{requestId:trainId})).status,400);
      assert.equal((await api(web.url,"street-fight/play",{requestId})).status,400);
      assert.deepEqual(open(restored.file,financial),before,"重送不得增減資產或重寫 JSON 收據");
    }
    web=await serve(targetDir,emptyRoot);
    const first=await api(web.url,"state");
    assert.equal(first.status,200);
    assert.equal(first.result.bLeague.history.length,1);
    assert.equal(first.result.cLeague.history.length,1);
    assert.equal(first.result.streetFight.available,false);
    assert.equal(first.result.osaka.npcSource,"reconstructed");
    assert.deepEqual(first.result.osaka.history.map(x=>[x.npcSource,x.npcSourceVersion]),[
      ["reconstructed","web-osaka-npc-v1"],["original-file",null],["unknown",null]
    ]);
    assert.ok(!JSON.stringify(first.result).includes("J3 FIXTURE PRIVATE FIELD"));
    assert.deepEqual(open(restored.file,financial),before);
    await checkReplays();
    await web.stop();web=null;
    web=await serve(targetDir,emptyRoot,"original-only");
    const unavailable=await api(web.url,"state");
    assert.equal(unavailable.result.osaka.catalogReady,false);
    assert.deepEqual(unavailable.result.osaka.history,first.result.osaka.history);
    await checkReplays();
    assert.equal((await api(web.url,"osaka/play",{mode:"week",requestId:"j3-new-disabled"})).status,400);
    assert.deepEqual(open(restored.file,financial),before);
    await web.stop();web=null;
    web=await serve(targetDir,originalRoot,"original-only");
    const switched=await api(web.url,"state");
    assert.equal(switched.result.osaka.npcSource,"original-file");
    assert.deepEqual(switched.result.osaka.history,first.result.osaka.history);
    await checkReplays();
    const newBattle=await api(web.url,"osaka/play",{mode:"week",requestId:"j3-new-original"});
    assert.equal(newBattle.status,200,JSON.stringify(newBattle.result.error));
    assert.equal(newBattle.result.osakaResult.replayed,false);
    assert.equal(newBattle.result.osakaResult.npcSource,"original-file");
    assert.equal(newBattle.result.osaka.history.length,4);
    const played=open(restored.file,financial);
    assert.deepEqual(played.osaka_battles.slice(0,3),before.osaka_battles);
    assert.deepEqual(played.b_league_battles,before.b_league_battles);
    assert.deepEqual(played.c_league_requests,before.c_league_requests);
    await web.stop();web=null;
    web=await serve(targetDir,emptyRoot);
    const resumed=await api(web.url,"osaka/play",{mode:"week",requestId:"j3-new-original"});
    assert.equal(resumed.status,200);
    assert.deepEqual(resumed.result.osakaResult,{...newBattle.result.osakaResult,replayed:true});
    assert.deepEqual(open(restored.file,financial),played);
    open(restored.file,healthy);
    assert.deepEqual(financial(sourceDb),before);
    assert.deepEqual(readFileSync(sourceFile),main);
    assert.deepEqual(readFileSync(sourceFile+"-wal"),wal);
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
  }finally{
    if(web)await web.stop();
    sourceDb?.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
