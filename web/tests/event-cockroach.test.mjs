import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveNonItemEvent } from "../src/event-effects.mjs";
import { initBankTables, refreshBankTaxSnapshot } from "../src/banking.mjs";
import { initCharacterEvents, settleDailyIllnessEvent, listCharacterEvents } from "../src/events.mjs";
import {
  COCKROACH_WINDOW_MS, getCockroachChallenge, claimCockroach
} from "../src/event-cockroach.mjs";

const STATS={kokugo:20,suugaku:20,rika:20,syakai:20,eigo:20,ongaku:20,bijutu:20,
  looks:20,tairyoku:20,kenkou:20,speed:20,power:20,wanryoku:20,kyakuryoku:20,
  love:20,unique:20,etti:20};
const event44=(44-0.5)/44;
const START=100000;
function numbers(...rolls){
  let next=0;
  return ()=> {
    if(next>=rolls.length)throw new Error("發生未預期的額外亂數抽選");
    return rolls[next++];
  };
}
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',",
    "money INTEGER NOT NULL DEFAULT 100000,kpoint INTEGER NOT NULL DEFAULT 0,",
    "stats_json TEXT NOT NULL DEFAULT '{}');",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join("\n"));
  for(const userId of [1,2])
    db.prepare("INSERT INTO characters(user_id,stats_json) VALUES(?,?)")
      .run(userId,JSON.stringify(STATS));
  initCharacterEvents(db);
  return db;
}
function initialize(db,userId=1){
  return settleDailyIllnessEvent(db,userId,"2026-11-18",1000,
    ()=>{throw new Error("初始化不應抽選");});
}
function spawn(db,userId=1,day="2026-11-19",now=START){
  return settleDailyIllnessEvent(db,userId,day,now,numbers(0,event44));
}
function row(db,userId=1){
  const r=db.prepare("SELECT money,kpoint,stats_json,last_event_day FROM characters WHERE user_id=?")
    .get(userId);
  return {...r,stats:JSON.parse(r.stats_json)};
}

test("原始 Perl #44 只產生 20 秒挑戰；成功才抽 1～20000 元與 K 點數 +3、外貌 -3",()=>{
  const source=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
  assert.match(source,/if \(\$event_rand == 44\)\s*\{\s*\$happend_ivent[\s\S]*?\$goki="on";/);
  assert.match(source,/if\(\$in\{'goki'\} eq "on"\)\s*\{[\s\S]*?\$in\{'goki_time'\} \+ 20 > \$now_goki/);
  assert.match(source,/\$syou_rand = int\(rand\(20000\)\)\+1;/);
  assert.match(source,/\$kpoint \+= 3;/);
  assert.match(source,/\$looks -= 3;/);
  assert.equal(COCKROACH_WINDOW_MS,20000);
});

test("#44 初始抽選只建立待處理事件，不預先抽獎或修改資產",()=>{
  const ev=resolveNonItemEvent(44,{},()=>{throw new Error("不應抽取獎金");});
  assert.equal(ev.event.key,"cockroach");
  assert.equal(ev.cockroachChallenge,true);
  assert.deepEqual(ev.changes,{});
  assert.deepEqual(ev.effects,{cockroach:"pending"});
});

test("20 秒內領獎，隨機獎金 1～20000 元、K 點數及外貌同筆更新並可查歷史",()=>{
  for(const [roll,reward] of [[0,1],[.4999,9999],[.999999,20000]]){
    const db=setup();
    try{
      initialize(db);
      const created=spawn(db);
      assert.equal(created.event.key,"cockroach");
      assert.deepEqual(row(db),{
        money:100000,kpoint:0,stats_json:JSON.stringify(STATS),
        last_event_day:"2026-11-19",stats:STATS
      });
      assert.deepEqual(getCockroachChallenge(db,1,START),{
        eventId:1,expiresAt:START+20000,remainingMs:20000,status:"active"
      });
      const claim=claimCockroach(db,1,START+19999,numbers(roll));
      assert.deepEqual(claim,{status:"caught",reward,kpoint:3,looks:-3});
      assert.equal(row(db).money,100000+reward);
      assert.equal(row(db).kpoint,3);
      assert.equal(row(db).stats.looks,17);
      assert.equal(getCockroachChallenge(db,1,START+19999),null);
      const [history]=listCharacterEvents(db,1);
      assert.equal(history.originalId,44);
      assert.equal(history.title,"蟑螂挑戰");
      assert.deepEqual(history.effects,{
        cockroach:"caught",money:reward,kpoint:3,stats:{looks:-3}
      });
      assert.match(history.description,new RegExp(String(reward)));
      assert.throws(()=>claimCockroach(db,1,START+19999,numbers(0)),/沒有待處理/);
      assert.equal(listCharacterEvents(db,1).length,1);
      initCharacterEvents(db);
      assert.equal(row(db).money,100000+reward);
    }finally{db.close();}
  }
});

test("期限第 20 秒（含）即判定失敗，沒有亂數抽獎、獎金或能力變化",()=>{
  const db=setup();
  try{
    initialize(db);spawn(db);
    assert.deepEqual(getCockroachChallenge(db,1,START+20000),{
      eventId:1,expiresAt:START+20000,remainingMs:0,status:"expired"
    });
    const escaped=claimCockroach(db,1,START+20000,
      ()=>{throw new Error("逾時不能抽獎");});
    assert.deepEqual(escaped,{status:"escaped",reward:0,kpoint:0,looks:0});
    assert.equal(row(db).money,100000);
    assert.equal(row(db).kpoint,0);
    assert.equal(row(db).stats.looks,20);
    assert.equal(getCockroachChallenge(db,1,START+20000),null);
    assert.deepEqual(listCharacterEvents(db,1)[0].effects,{cockroach:"escaped"});
    assert.throws(()=>claimCockroach(db,1,START+20001),/沒有待處理/);
  }finally{db.close();}
});

test("伺服器開始時間前不可領獎；不允許跨玩家領取，且同日抽選不可重複",()=>{
  const db=setup();
  try{
    initialize(db,1);initialize(db,2);
    spawn(db,1);
    assert.throws(()=>claimCockroach(db,1,START-1),/尚未開始/);
    assert.throws(()=>claimCockroach(db,2,START+1000),/沒有待處理/);
    assert.equal(getCockroachChallenge(db,2,START+1000),null);
    const repeated=settleDailyIllnessEvent(db,1,"2026-11-19",START+1000,
      ()=>{throw new Error("同日不可重抽");});
    assert.equal(repeated.checked,false);
    assert.equal(claimCockroach(db,1,START+1000,numbers(.3)).status,"caught");
    assert.equal(row(db,2).kpoint,0);
    assert.equal(listCharacterEvents(db,2).length,0);
  }finally{db.close();}
});

test("事件歷史插入失敗時挑戰與日期都回滾，修正後可再抽",()=>{
  const db=setup();
  try{
    initialize(db);
    db.exec("CREATE TRIGGER bad_history BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'insert blocked'); END;");
    assert.throws(()=>spawn(db),/insert blocked/);
    assert.equal(getCockroachChallenge(db,1,START),null);
    assert.equal(row(db).last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER bad_history");
    assert.equal(spawn(db).event.key,"cockroach");
    assert.equal(getCockroachChallenge(db,1,START).status,"active");
  }finally{db.close();}
});

test("結算歷史更新失敗時現金、K 點數、外貌與挑戰均回滾",()=>{
  const db=setup();
  try{
    initialize(db);spawn(db);
    db.exec("CREATE TRIGGER bad_history BEFORE UPDATE ON character_events BEGIN SELECT RAISE(ABORT,'update blocked'); END;");
    assert.throws(()=>claimCockroach(db,1,START+1000,numbers(0)),/update blocked/);
    assert.equal(row(db).money,100000);
    assert.equal(row(db).kpoint,0);
    assert.equal(row(db).stats.looks,20);
    assert.equal(getCockroachChallenge(db,1,START+1000).status,"active");
    assert.deepEqual(listCharacterEvents(db,1)[0].effects,{cockroach:"pending"});
    db.exec("DROP TRIGGER bad_history");
    assert.equal(claimCockroach(db,1,START+1000,numbers(0)).reward,1);
  }finally{db.close();}
});

test("現金或 K 點數超出安全整數時拒絕領獎，不消耗挑戰",()=>{
  for(const field of ["money","kpoint"]){
    const db=setup();
    try{
      initialize(db);spawn(db);
      db.prepare("UPDATE characters SET "+field+"=? WHERE user_id=1")
        .run(Number.MAX_SAFE_INTEGER);
      assert.throws(()=>claimCockroach(db,1,START+1000,numbers(.9)),/安全整數/);
      assert.equal(getCockroachChallenge(db,1,START+1000).status,"active");
      assert.equal(listCharacterEvents(db,1)[0].effects.cockroach,"pending");
    }finally{db.close();}
  }
});

test("Web 非負外貌限制保留真實扣除量；低外貌值不變負數",()=>{
  const db=setup();
  try{
    initialize(db);spawn(db);
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=1")
      .run(JSON.stringify({...STATS,looks:1}));
    assert.equal(claimCockroach(db,1,START+1000,numbers(0)).looks,-1);
    assert.equal(row(db).stats.looks,0);
    assert.deepEqual(listCharacterEvents(db,1)[0].effects.stats,{looks:-1});
  }finally{db.close();}
});

test("無活動挑戰、非法使用者或無效亂數皆拒絕且不修改狀態",()=>{
  const db=setup();
  try{
    initialize(db);
    assert.throws(()=>claimCockroach(db,1,START),/沒有待處理/);
    assert.throws(()=>getCockroachChallenge(db,0,START),/帳號/);
    assert.throws(()=>claimCockroach(db,0,START),/帳號/);
    spawn(db);
    assert.throws(()=>claimCockroach(db,1,START+1000,numbers(NaN)),/亂數/);
    assert.equal(getCockroachChallenge(db,1,START+1000).status,"active");
  }finally{db.close();}
});

test("街頭格鬥負 K 點仍可正常取得蟑螂獎勵",()=>{
  const db=setup();
  try{
    initialize(db);spawn(db);
    db.prepare("UPDATE characters SET kpoint=-6 WHERE user_id=1").run();
    assert.equal(claimCockroach(db,1,START+1,numbers(0)).status,"caught");
    assert.equal(row(db).kpoint,-3);
  }finally{db.close();}
});

function setupBanked(){
  const db=setup();
  db.exec("ALTER TABLE characters ADD COLUMN bank INTEGER NOT NULL DEFAULT 0;");
  initBankTables(db);
  for(const id of [1,2])refreshBankTaxSnapshot(db,id,"2026-11-19");
  return db;
}
function taxRow(db,id=1){
  return db.prepare("SELECT assessment_base,snapshot_day FROM bank_tax_state WHERE user_id=?").get(id);
}
function spawnShared(db,originalId){
  initialize(db);
  return settleDailyIllnessEvent(db,1,"2026-11-19",START,
    originalId===34?numbers(0,(34-.5)/44,0):numbers(0,event44));
}

test("I：#34/#44 共用蟑螂領獎將現金、K點、外貌、歷史及稅基一起更新，重送與他帳號不變",()=>{
  for(const originalId of [34,44]){
    const db=setupBanked();
    try{
      spawnShared(db,originalId);
      const other=taxRow(db,2);
      assert.deepEqual({...taxRow(db)},{assessment_base:100000,snapshot_day:"2026-11-19"});
      assert.equal(claimCockroach(db,1,START+1,numbers(0),"2026-11-20").reward,1);
      assert.deepEqual({...taxRow(db)},{assessment_base:100001,snapshot_day:"2026-11-20"});
      assert.deepEqual(taxRow(db,2),other);
      assert.equal(row(db).money,100001);
      assert.equal(row(db).kpoint,3);
      assert.equal(row(db).stats.looks,17);
      assert.equal(listCharacterEvents(db,1)[0].originalId,originalId);
      assert.throws(()=>claimCockroach(db,1,START+2,()=>{throw Error("不重抽");},"2026-11-20"),/沒有待處理/);
      assert.equal(taxRow(db).assessment_base,100001);
    }finally{db.close();}
  }
});

test("I：#34/#44 共用領獎的稅基寫入及歷史更新失敗均回滾所有獎勵",()=>{
  for(const originalId of [34,44]){
    for(const [table,triggerName] of [["bank_tax_state","tax_fault"],["character_events","history_fault"]]){
      const db=setupBanked();
      try{
        spawnShared(db,originalId);
        const before=row(db),tax=taxRow(db),history=listCharacterEvents(db,1);
        db.exec("CREATE TRIGGER "+triggerName+" BEFORE UPDATE ON "+table+" BEGIN SELECT RAISE(ABORT,'I injected fault'); END;");
        assert.throws(()=>claimCockroach(db,1,START+1,numbers(0),"2026-11-19"),/I injected fault/);
        assert.deepEqual(row(db),before);
        assert.deepEqual(taxRow(db),tax);
        assert.deepEqual(listCharacterEvents(db,1),history);
        assert.equal(getCockroachChallenge(db,1,START+1).status,"active");
        db.exec("DROP TRIGGER "+triggerName);
        assert.equal(claimCockroach(db,1,START+2,numbers(0),"2026-11-19").reward,1);
        assert.equal(taxRow(db).assessment_base,100001);
      }finally{db.close();}
    }
  }
});

test("I：現金本身合法但合計稅基溢位，蟑螂領獎完全回滾；逾時不更新資產",()=>{
  const db=setupBanked();
  try{
    spawnShared(db,44);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER-100000);
    refreshBankTaxSnapshot(db,1,"2026-11-19");
    const before=row(db),tax=taxRow(db);
    assert.throws(()=>claimCockroach(db,1,START+1,numbers(0),"2026-11-19"),/稅基資產超出安全範圍/);
    assert.deepEqual(row(db),before);
    assert.deepEqual(taxRow(db),tax);
    assert.equal(getCockroachChallenge(db,1,START+1).status,"active");
    assert.equal(claimCockroach(db,1,START+20000,()=>{throw Error("逾時不抽");},"2026-11-19").status,"escaped");
    assert.deepEqual(row(db),before);
    assert.deepEqual(taxRow(db),tax);
  }finally{db.close();}
});
