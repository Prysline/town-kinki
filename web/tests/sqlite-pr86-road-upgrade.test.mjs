import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {backUpSolo,restoreSolo,verifySoloDatabase} from "../scripts/solo-save.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const stats=()=>{
  const keys=["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu",
    "looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku",
    "love","unique","etti"];
  const result=Object.fromEntries(keys.map(key=>[key,20]));
  result.tairyoku=23; // 已由舊版徒步出發結算的鍛鍊，不得在升級／抵達時再加一次。
  return result;
};
function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+
    keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dataDir){
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",
      PORT:"0",DATA_DIR:dataDir}
  });
  let logs="",stdout="";
  child.stdout.on("data",chunk=>{stdout+=chunk;logs+=chunk;});
  child.stderr.on("data",chunk=>logs+=chunk);
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
          child.kill();
          await Promise.race([ended,delay(1500)]);
        }};
      }
    }catch{}
    await delay(100);
  }
  child.kill();
  throw new Error("PR #86 舊公路存檔升級後伺服器無法啟動："+logs);
}
async function api(url,path,body){
  const response=await fetch(url+"/api/"+path,{
    method:body===undefined?"GET":"POST",
    headers:body===undefined?{}:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:response.status,result:await response.json()};
}

// Web 第62階段合併 PR #86 / SHA 8de151b68b54836f7d58c2cdc5e4b7571cd6bd34
// 的 road-travel.mjs::initRoadTravelTables 欄位／索引原樣重建（非 CGI 玩家匯入）。
// users/characters/solo_clock 僅重建可開機的既有 Web schema 代表性子集。
function seedPhase62Road(dir){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  const now=Date.now();
  try{
    db.exec([
      "PRAGMA journal_mode=WAL;",
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL COLLATE NOCASE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);",
      "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL UNIQUE,gender TEXT NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,recovered_at INTEGER NOT NULL,job_id TEXT,work_progress INTEGER NOT NULL,last_work_at INTEGER NOT NULL,work_count INTEGER NOT NULL,height INTEGER NOT NULL,bmi REAL NOT NULL,stats_json TEXT NOT NULL);",
      "CREATE TABLE solo_clock(id INTEGER PRIMARY KEY CHECK(id=1),offset_ms INTEGER NOT NULL CHECK(offset_ms>=0));",
      "CREATE TABLE bank_accounts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,term_balance INTEGER NOT NULL DEFAULT 0 CHECK(term_balance>=0),last_interest_day TEXT NOT NULL);",
      "CREATE TABLE arcade_road_trips(",
      "id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
      "request_id TEXT NOT NULL,from_town INTEGER NOT NULL CHECK(from_town BETWEEN 0 AND 3),",
      "to_town INTEGER NOT NULL CHECK(to_town BETWEEN 0 AND 3),",
      "vehicle_source_line INTEGER,vehicle_name TEXT NOT NULL,",
      "travel_seconds INTEGER NOT NULL CHECK(travel_seconds>=0),",
      "started_at INTEGER NOT NULL,arrival_at INTEGER NOT NULL,",
      "accident INTEGER NOT NULL CHECK(accident IN(0,1)),",
      "durability_after INTEGER,exercise_json TEXT NOT NULL,completed_at INTEGER,",
      "UNIQUE(user_id,request_id));",
      "CREATE UNIQUE INDEX arcade_road_open_user",
      "ON arcade_road_trips(user_id) WHERE completed_at IS NULL;",
      "CREATE INDEX arcade_road_user_history",
      "ON arcade_road_trips(user_id,id);"
    ].join(" "));
    for(const [column,definition] of [
      ["weight","REAL NOT NULL DEFAULT 60"],["job_experience","INTEGER NOT NULL DEFAULT 0"],
      ["job_work_count","INTEGER NOT NULL DEFAULT 0"],["mastered_job","TEXT"],
      ["last_school_day","TEXT NOT NULL DEFAULT ''"],["last_gym_at","INTEGER NOT NULL DEFAULT 0"],
      ["classroom_ready_at","INTEGER NOT NULL DEFAULT 0"],["salary_payment","TEXT NOT NULL DEFAULT 'cash'"],
      ["gym_ready_at","INTEGER NOT NULL DEFAULT 0"],["created_at","INTEGER NOT NULL DEFAULT 0"],
      ["last_meal_at","INTEGER NOT NULL DEFAULT 0"],["health_index","INTEGER NOT NULL DEFAULT 50"],
      ["last_health_day","TEXT NOT NULL DEFAULT ''"],["last_event_day","TEXT NOT NULL DEFAULT ''"],
      ["kpoint","INTEGER NOT NULL DEFAULT 0"]
    ])db.exec("ALTER TABLE characters ADD COLUMN "+column+" "+definition);
    insert(db,"users",{id:1,username:"__local_player__",password_salt:"old",
      password_hash:"old",created_at:now});
    insert(db,"characters",{id:1,user_id:1,name:"第62階段舊公路旅客",
      gender:"other",town_id:0,money:80500,bank:9500,body_energy:90,
      brain_energy:90,recovered_at:now,job_id:null,work_progress:0,
      last_work_at:0,work_count:0,height:165,bmi:22,
      stats_json:JSON.stringify(stats()),weight:60,created_at:now,
      last_health_day:"9999-12-31",last_event_day:"9999-12-31"});
    insert(db,"solo_clock",{id:1,offset_ms:0});
    insert(db,"bank_accounts",{user_id:1,term_balance:2500,
      last_interest_day:"9999-12-31"});
    // 第62階段已在出發時確定鍛鍊；pending 到站前不能再套用一次。
    insert(db,"arcade_road_trips",{id:41,user_id:1,
      request_id:"phase62_saved_pending",from_town:0,to_town:1,
      vehicle_source_line:null,vehicle_name:"徒歩",travel_seconds:600,
      started_at:now,arrival_at:now+600000,accident:0,
      durability_after:null,exercise_json:JSON.stringify({tairyoku:3}),
      completed_at:null});
    insert(db,"arcade_road_trips",{id:42,user_id:1,
      request_id:"phase62_saved_history",from_town:2,to_town:0,
      vehicle_source_line:null,vehicle_name:"徒歩",travel_seconds:10,
      started_at:now-20000,arrival_at:now-10000,accident:0,
      durability_after:null,exercise_json:"{}",completed_at:now-10000});
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    const cols=new Set(db.prepare("PRAGMA table_info(arcade_road_trips)").all()
      .map(row=>row.name));
    for(const key of ["by_bus","fare_paid","requested_to_town","lost","rerouted"])
      assert.equal(cols.has(key),false,"必須從真實第62階段舊 schema 起始");
    return {now};
  }finally{db.close();}
}

test("DB-04：第62階段公路 SQLite 實體 WAL 備份→升級→未完成旅程抵達→重啟無損",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-pr86-road-upgrade-"));
  const oldDir=join(work,"old"),newDir=join(work,"restored");
  const snapshot=join(work,"phase62-backup.sqlite");
  let server=null;
  try{
    const seed=seedPhase62Road(oldDir);
    const backup=await backUpSolo({dataDir:oldDir,file:snapshot});
    assert.equal(backup.characters,1);
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
    restoreSolo({dataDir:newDir,file:snapshot});
    server=await serve(newDir);

    const response=await api(server.url,"state");
    assert.equal(response.status,200);
    const state=response.result;
    assert.equal(state.character.name,"第62階段舊公路旅客");
    assert.equal(state.character.townId,0);
    assert.equal(state.character.money,80500);
    assert.equal(state.character.bank,9500);
    assert.equal(state.bankAccount.termBalance,2500);
    assert.equal(state.character.stats.tairyoku,23);
    assert.equal(state.roadTravel.pending.id,41);
    assert.equal(state.roadTravel.pending.toTownId,1);
    assert.equal(state.roadTravel.pending.requestedToTownId,1);
    assert.equal(state.roadTravel.pending.byBus,false);
    assert.equal(state.roadTravel.pending.farePaid,0);
    assert.equal(state.roadTravel.pending.accident,undefined,"未抵達不得公開事故結果");
    assert.equal(state.roadTravel.pending.lost,undefined,"未抵達不得公開迷路結果");
    assert.equal(state.roadTravel.history.length,1);
    assert.equal(state.roadTravel.history[0].id,42);
    assert.equal(state.roadTravel.history[0].completedAt,seed.now-10000);
    assert.equal(state.roadTravel.history[0].lost,false);
    assert.equal(state.roadTravel.history[0].byBus,false);

    const migrated=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      const cols=new Set(migrated.prepare("PRAGMA table_info(arcade_road_trips)")
        .all().map(row=>row.name));
      for(const key of ["by_bus","fare_paid","requested_to_town","lost","rerouted"])
        assert.ok(cols.has(key),"現行 schema 必須補足 "+key);
      for(const id of [41,42]){
        const row=migrated.prepare([
          "SELECT requested_to_town,lost,rerouted,by_bus,fare_paid,",
          "exercise_json,accident FROM arcade_road_trips WHERE id=?"
        ].join(" ")).get(id);
        assert.deepEqual({...row},{
          requested_to_town:id===41?1:0,lost:0,rerouted:0,by_bus:0,
          fare_paid:0,exercise_json:id===41?'{"tairyoku":3}':"{}",accident:0
        });
      }
      assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    }finally{migrated.close();}

    const payload={toTownId:1,requestId:"phase62_saved_pending"};
    const replay=await api(server.url,"road/start",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.roadStartResult.replayed,true);
    assert.equal((await api(server.url,"road/start",{
      toTownId:2,requestId:"phase62_second_trip"
    })).status,400,"舊 pending 必須鎖住同一使用者的第二趟公路");
    assert.equal((await api(server.url,"road/arrive",{tripId:41})).status,400,
      "尚未到站，歷史升級不能自動放行");

    const advance=await api(server.url,"solo/time/advance",{preset:"30m"});
    assert.equal(advance.status,200);
    const arrived=await api(server.url,"road/arrive",{tripId:41});
    assert.equal(arrived.status,200);
    assert.equal(arrived.result.roadArrivalResult.replayed,false);
    assert.equal(arrived.result.roadArrivalResult.toTownId,1);
    assert.equal(arrived.result.roadArrivalResult.requestedToTownId,1);
    assert.equal(arrived.result.roadArrivalResult.lost,false);
    assert.equal(arrived.result.roadArrivalResult.rerouted,false);
    assert.equal(arrived.result.character.townId,1);
    assert.equal(arrived.result.character.stats.tairyoku,23,
      "舊版出發時已計算的鍛鍊不能在抵達時重算");
    const replayArrival=await api(server.url,"road/arrive",{tripId:41});
    assert.equal(replayArrival.status,200);
    assert.equal(replayArrival.result.roadArrivalResult.replayed,true);
    assert.equal(replayArrival.result.character.money,80500);

    await server.stop();server=null;
    server=await serve(newDir);
    const resumed=(await api(server.url,"state")).result;
    assert.equal(resumed.character.townId,1);
    assert.equal(resumed.character.money,80500);
    assert.equal(resumed.character.bank,9500);
    assert.equal(resumed.character.stats.tairyoku,23);
    assert.equal(resumed.bankAccount.termBalance,2500);
    assert.equal(resumed.roadTravel.pending,null);
    assert.deepEqual(resumed.roadTravel.history.map(x=>x.id),[42,41],
      "最近20筆歷史依資料列 id DESC 排序，不以舊結算日期重排");
    assert.equal(resumed.roadTravel.history[0].lost,false);
    assert.equal(resumed.roadTravel.history[0].completedAt,seed.now-10000);
    assert.equal(resumed.roadTravel.history[1].lost,false);
    const migratedAgain=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      assert.equal(migratedAgain.prepare("SELECT COUNT(*) n FROM arcade_road_trips").get().n,2);
      assert.equal(migratedAgain.prepare("SELECT COUNT(*) n FROM arcade_road_trips WHERE completed_at IS NOT NULL").get().n,2);
      assert.equal(migratedAgain.prepare("SELECT offset_ms FROM solo_clock WHERE id=1").get().offset_ms,1800000);
      assert.deepEqual(migratedAgain.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.equal(migratedAgain.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    }finally{migratedAgain.close();}

    // 「原始舊版資料庫」與「匯出的快照」均不會因還原目的地升級而改變。
    const source=new DatabaseSync(join(oldDir,"solo.sqlite"),{readOnly:true});
    try{
      assert.equal(source.prepare("SELECT town_id FROM characters WHERE id=1").get().town_id,0);
      assert.equal(source.prepare("SELECT completed_at FROM arcade_road_trips WHERE id=41").get().completed_at,null);
      assert.equal(source.prepare("SELECT COUNT(*) n FROM arcade_road_trips").get().n,2);
      assert.equal(source.prepare("PRAGMA table_info(arcade_road_trips)").all()
        .some(row=>row.name==="requested_to_town"),false);
    }finally{source.close();}
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
  }finally{
    await server?.stop();
    rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
