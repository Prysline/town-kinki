import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {STAT_KEYS,decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initRoadTravelTables} from "../src/road-travel.mjs";
import {initCockroachChallenges,openCockroachChallenge} from "../src/event-cockroach.mjs";
import {parseOriginalOnsenConfig,originalOnsenOptions} from "../src/onsen-source.mjs";
import {initOnsenTables,activeOnsenVisit,assertNoActiveOnsen,onsenOverview,enterOnsen,leaveOnsen} from "../src/onsen.mjs";
const config=parseOriginalOnsenConfig(decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url))));
const NOW=Date.parse("2026-11-26T04:00:00Z");
const stats=Object.fromEntries(STAT_KEYS.map(k=>[k,20]));
function setup(file=":memory:"){
  const db=new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);"+
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,stats_json TEXT NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,recovered_at INTEGER NOT NULL);"+
    "CREATE TABLE character_events(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);");
  for(const id of [1,2])db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,?)")
    .run(id,0,2000000,123456,JSON.stringify(stats),0,0,NOW);
  initTownMapTable(db);initRoadTravelTables(db);initCockroachChallenges(db);initOnsenTables(db);
  const tiles=Array(192).fill("");tiles[0]="温泉";storeTownMap(db,0,{tiles},"web-edited");
  return db;
}
const row=(db,id=1)=>({...db.prepare("SELECT * FROM characters WHERE user_id=?").get(id)});
const buy=(db,bathKey="futuu",more={})=>enterOnsen(db,1,config,{bathKey,requestId:"bath_request_1",now:NOW,random:()=>.99,...more});
test("AP-05 八種浴池真 SQLite 入浴／出浴：費用、兩時計、能力 RNG 與背景次序",()=>{
  for(const bath of originalOnsenOptions(config,stats)){
    const db=setup();
    try{
      let draws=0;
      const expected=bath.key==="special_dou"?2:bath.key==="special_gin"?7:bath.key==="special_kin"?17:0;
      const before=row(db),other=row(db,2);
      const result=buy(db,bath.key,{random:()=>{draws++;return .99;}});
      assert.equal(draws,expected+1);
      assert.equal(result.entry.backgroundIndex,10);
      assert.equal(result.entry.fee,bath.fee);
      assert.equal(result.entry.rate,bath.rate);
      assert.deepEqual(result.entry.gains,{});
      assert.equal(row(db).money,before.money-bath.fee);
      assert.equal(row(db).bank,before.bank);
      assert.deepEqual([row(db).body_energy,row(db).brain_energy,row(db).recovered_at],[1,1,NOW]);
      assert.deepEqual(row(db,2),other);
      assert.throws(()=>assertNoActiveOnsen(db,1),/正在泡/);
      assert.doesNotThrow(()=>assertNoActiveOnsen(db,2));
      const projected=onsenOverview(db,1,config,NOW+1000);
      assert.equal(projected.active.id,result.id);
      assert.equal(projected.exitPreview.bodyEnergy,Math.min(21,1+Math.trunc(bath.rate/10)));
      assert.equal(projected.exitPreview.brainEnergy,Math.min(23,1+Math.trunc(bath.rate/10)));
      assert.equal(row(db).body_energy,1,"讀取預覽不消耗恢復時間或寫入");
      const exit=leaveOnsen(db,1,config,{visitId:result.id,now:NOW+1000});
      assert.deepEqual(exit.exit, {...projected.exitPreview,rate:bath.rate});
      assert.deepEqual([row(db).body_energy,row(db).brain_energy,row(db).recovered_at],
        [exit.exit.bodyEnergy,exit.exit.brainEnergy,NOW+1000]);
      assert.equal(row(db).money,before.money-bath.fee);
      assert.equal(activeOnsenVisit(db,1),null);
    }finally{db.close();}
  }
});
test("AP-05 核准金浴能力：十七次抽選後才抽背景，舊上限與新出浴上限分開",()=>{
  const db=setup();
  try{
    const fractions=Array(17).fill(.475);fractions.push(.05);let i=0;
    const entry=buy(db,"special_kin",{random:()=>fractions[i++]});
    assert.equal(i,18);
    assert.deepEqual(entry.entry.maxima,{body:22,brain:24});
    assert.deepEqual(entry.entry.gains,Object.fromEntries(STAT_KEYS.map(k=>[k,10])));
    assert.equal(entry.entry.backgroundIndex,1);
    assert.equal(row(db).money,1000000);
    assert.deepEqual(JSON.parse(row(db).stats_json),Object.fromEntries(STAT_KEYS.map(k=>[k,30])));
    const out=leaveOnsen(db,1,config,{visitId:entry.id,now:NOW+1000});
    assert.deepEqual(out.exit.maxima,{body:32,brain:35});
    assert.equal(out.exit.bodyEnergy,32);
    assert.equal(out.exit.brainEnergy,35);
  }finally{db.close();}
});
test("AP-05 地圖、本人現金、偽造浴池、入浴中其他旅程與重送拒絕不扣款",()=>{
  const db=setup();
  try{
    const first=row(db);
    db.prepare("UPDATE characters SET town_id=1 WHERE user_id=1").run();
    assert.equal(onsenOverview(db,1,config,NOW).available,false);
    assert.throws(()=>buy(db),/沒有溫泉/);
    db.prepare("UPDATE characters SET town_id=0,money=199 WHERE user_id=1").run();
    assert.throws(()=>buy(db,"koukyuu"),/現金不足/);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(first.money);
    assert.throws(()=>buy(db,"fake"),/未知/);
    db.prepare("INSERT INTO character_events VALUES(1,1)").run();
    openCockroachChallenge(db,1,1,NOW);
    assert.throws(()=>buy(db),/限時事件/);
    const entry=buy(db,"futuu",{now:NOW+20000});
    const paid=row(db);
    const replay=buy(db,"futuu",{now:NOW+20001,random:()=>{throw Error("不可重抽");}});
    assert.equal(replay.id,entry.id);
    assert.equal(replay.replayed,true);
    assert.throws(()=>buy(db,"koukyuu",{now:NOW+20001}),/不可更換浴池/);
    assert.throws(()=>buy(db,"futuu",{requestId:"second_request",now:NOW+20001}),/正在泡/);
    assert.throws(()=>leaveOnsen(db,2,config,{visitId:entry.id,now:NOW+20001}),/本人/);
    assert.deepEqual(row(db),paid);
    assert.throws(()=>leaveOnsen(db,1,config,{visitId:entry.id,now:NOW+19999}),/尚未到達/);
    const out=leaveOnsen(db,1,config,{visitId:entry.id,now:NOW+21000});
    const closed=row(db);
    assert.equal(leaveOnsen(db,1,config,{visitId:entry.id,now:NOW+50000}).replayed,true);
    assert.equal(buy(db,"futuu",{now:NOW+50000}).completedAt,out.completedAt);
    assert.deepEqual(row(db),closed);
  }finally{db.close();}
});
test("AP-05 扣款／能力／能量與收據原子回滾，離開收據失敗亦不遺失入浴",()=>{
  const db=setup();
  try{
    const before=row(db);
    db.exec("CREATE TRIGGER fail_entry BEFORE INSERT ON onsen_visits BEGIN SELECT RAISE(ABORT,'entry fault'); END;");
    assert.throws(()=>buy(db,"special_gin",{random:()=>0}),/entry fault/);
    assert.deepEqual(row(db),before);
    assert.equal(activeOnsenVisit(db,1),null);
    db.exec("DROP TRIGGER fail_entry");
    assert.throws(()=>buy(db,"special_gin",{random:()=>1}),/亂數/);
    assert.deepEqual(row(db),before);
    const e=buy(db,"special_dou",{random:()=>0});
    const paid=row(db);
    db.exec("CREATE TRIGGER fail_exit BEFORE UPDATE ON onsen_visits BEGIN SELECT RAISE(ABORT,'exit fault'); END;");
    assert.throws(()=>leaveOnsen(db,1,config,{visitId:e.id,now:NOW+1000}),/exit fault/);
    assert.deepEqual(row(db),paid);
    assert.equal(activeOnsenVisit(db,1).id,e.id);
    db.exec("DROP TRIGGER fail_exit");
    assert.equal(leaveOnsen(db,1,config,{visitId:e.id,now:NOW+1000}).completedAt,NOW+1000);
  }finally{db.close();}
});
test("AP-05 實體 SQLite 關閉重開、設施移除仍可離開、刪帳外鍵清理",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-onsen-"));
  const file=join(dir,"fixture.sqlite");
  let db;
  try{
    db=setup(file);
    const entry=buy(db);
    const persisted=row(db);
    db.close();db=null;
    db=new DatabaseSync(file);db.exec("PRAGMA foreign_keys=ON");initOnsenTables(db);
    assert.deepEqual(row(db),persisted);
    assert.equal(activeOnsenVisit(db,1).id,entry.id);
    storeTownMap(db,0,{tiles:Array(192).fill("")},"web-edited");
    assert.equal(onsenOverview(db,1,config,NOW+5000).available,false);
    const out=leaveOnsen(db,1,config,{visitId:entry.id,now:NOW+5000});
    assert.equal(out.exit.bodyEnergy,6);assert.equal(out.exit.brainEnergy,6);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM onsen_visits").get().n,0);
    assert.ok(row(db,2));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test("AP-05 V02 Monday direct entry uses previous tax base, rollback and replay preserve settlement",()=>{
  const db=setup();
  try{
    initBankTables(db);
    db.exec("UPDATE characters SET money=2000000,bank=1000000 WHERE user_id=1");
    db.prepare("INSERT INTO bank_accounts(user_id,term_balance,last_interest_day) VALUES(1,0,?)").run("2026-11-29");
    db.prepare("INSERT INTO bank_tax_state(user_id,assessment_base,snapshot_day) VALUES(1,3000000,?)").run("2026-11-29");
    const monday=Date.parse("2026-11-30T04:00:00Z");
    const args={now:monday,today:"2026-11-30"};
    const taxes=()=>db.prepare("SELECT * FROM bank_tax_assessments WHERE user_id=1").all();
    const taxState=()=>db.prepare("SELECT * FROM bank_tax_state WHERE user_id=1").get();
    db.exec("CREATE TRIGGER fail_bath BEFORE INSERT ON onsen_visits BEGIN SELECT RAISE(ABORT,'bath fault'); END;");
    assert.throws(()=>buy(db,"futuu",args),/bath fault/);
    assert.equal(row(db).bank,1000000);assert.equal(row(db).money,2000000);
    assert.equal(taxes().length,0);assert.equal(taxState().assessment_base,3000000);
    assert.equal(taxState().snapshot_day,"2026-11-29");
    db.exec("DROP TRIGGER fail_bath");
    const entered=buy(db,"futuu",args);
    assert.equal(row(db).money,1999500);assert.equal(row(db).bank,975000);
    assert.equal(taxes().length,1);assert.equal(taxes()[0].assessment_base,3000000);
    assert.equal(taxes()[0].paid,30000);assert.equal(taxState().assessment_base,2974500);
    assert.equal(buy(db,"futuu",{...args,random:()=>{throw Error("不得重抽");}}).replayed,true);
    assert.equal(taxes().length,1);
    leaveOnsen(db,1,config,{visitId:entered.id,now:monday+1000});
    assert.equal(row(db).bank,975000);assert.equal(taxes().length,1);
  }finally{db.close();}
});
