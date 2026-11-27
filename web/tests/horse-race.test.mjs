import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {parseHorseRaceSource} from "../src/horse-race-source.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initRoadTravelTables} from "../src/road-travel.mjs";
import {initCockroachChallenges,openCockroachChallenge} from "../src/event-cockroach.mjs";
import {initOnsenTables} from "../src/onsen.mjs";
import {initHorseRaceTables,quoteHorseRace,enterHorseRace,stepHorseRace,
  horseRaceById,activeHorseRace,horseRaceOverview,horseRaceRankings} from "../src/horse-race.mjs";

const source=parseHorseRaceSource(readFileSync(new URL("../../basic.cgi",import.meta.url),"utf8"),
  readFileSync(new URL("../../town_ini.cgi",import.meta.url),"utf8"));
const NOW=Date.parse("2026-11-28T00:00:00Z"),today="2026-11-28",rand=n=>n*.99;
const noRand=()=>{throw Error("不得重抽");};
function setup(file=":memory:"){
  const db=new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);"+
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);"+
    "INSERT INTO characters VALUES(1,'甲',0,200000,1234),(2,'乙',0,200000,5678);"+
    "CREATE TABLE character_events(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);");
  initTownMapTable(db);initBankTables(db);initRoadTravelTables(db);initCockroachChallenges(db);initOnsenTables(db);initHorseRaceTables(db);
  const tiles=Array(192).fill("");tiles[0]="競馬";storeTownMap(db,0,{tiles},"web-edited");return db;
}
const cash=(db,user=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(user).money;
const tax=(db,user=1)=>db.prepare("SELECT assessment_base FROM bank_tax_state WHERE user_id=?").get(user)?.assessment_base;
const quote=(db,user=1,more={})=>quoteHorseRace(db,user,source,{requestId:"quote_0001",now:NOW,rand,...more});
const start=(db,id,user=1,more={})=>enterHorseRace(db,user,source,{raceId:id,tickets:[0,0,0,0,0,100],requestId:"start_0001",now:NOW,today,rand,...more});
const step=(db,race,user=1,more={})=>stepHorseRace(db,user,source,{raceId:race.id,expectedTurn:race.turn,requestId:"turn_"+String(race.turn).padStart(5,"0"),now:NOW+1000+race.turn,today,rand,...more});
function finish(db,race,user=1,more={}){
  for(let i=0;i<20&&race.status==="running";i++)race=step(db,race,user,more);
  assert.equal(race.status,"completed");return race;
}
test("GM-02 SQLite genuine quote/start/turn/payout, receipts and rank, bank/tax unchanged except cash",()=>{
  const db=setup();
  try{
    const q=quote(db);assert.equal(q.card.length,6);assert.equal(cash(db),200000);
    assert.deepEqual(quote(db,1,{rand:noRand}),{...q,replayed:true});
    assert.throws(()=>start(db,q.id,2),/本人/);
    const r=start(db,q.id);assert.equal(r.cost,50000);assert.equal(cash(db),150000);
    assert.equal(tax(db),151234);assert.equal(cash(db,2),200000);
    assert.deepEqual(start(db,q.id,1,{rand:noRand}),{...r,replayed:true});
    assert.throws(()=>start(db,q.id,1,{tickets:[1,0,0,0,0,0]}),/不可變更/);
    assert.throws(()=>step(db,r,2),/本人/);
    const next=step(db,r);assert.equal(next.turn,1);assert.equal(next.status,"running");
    assert.deepEqual(step(db,r,1,{rand:noRand}),{...next,replayed:true});
    assert.throws(()=>step(db,r,1,{requestId:"stale_turn_1"}),/回合已變更/);
    const out=finish(db,next);
    const winner=out.horses.find(h=>h.name===out.winner);
    assert.equal(out.payout,winner.tickets*winner.odds*500);assert.ok(out.payout>0);
    assert.equal(cash(db),150000+out.payout);assert.equal(tax(db),cash(db)+1234);
    assert.equal(activeHorseRace(db,1),null);
    assert.deepEqual(horseRaceRankings(db),[{name:"甲",spent:50000,won:out.payout,profit:out.payout-50000,lastPlayedAt:out.lastAt}]);
    assert.throws(()=>step(db,out,1,{requestId:"finish_again"}),/已結束/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1234);
  }finally{db.close();}
});
test("GM-02 one global lock, exact 180 second boundary, late go allowed, rejected expired takeover forfeits without refund/rank",()=>{
  const db=setup();
  try{
    const q1=quote(db),q2=quote(db,2);
    let r=start(db,q1.id);
    assert.throws(()=>start(db,q2.id,2,{now:NOW+180999}),/已有競馬/);
    r=step(db,r,1,{now:NOW+181000});assert.equal(r.status,"running");
    assert.throws(()=>start(db,q2.id,2,{now:NOW+181000,tickets:[0,0,0,0,0,0]}),/尚未購買/);
    assert.equal(activeHorseRace(db,1),null);
    assert.equal(activeHorseRace(db,2),null);
    assert.equal(cash(db,2),200000);assert.equal(tax(db,2),undefined);
    const r2=start(db,q2.id,2,{now:NOW+181000,requestId:"start_after_reject"});
    assert.equal(horseRaceById(db,1,r.id).status,"forfeited");
    assert.equal(cash(db),150000);assert.equal(cash(db,2),150000);
    assert.deepEqual(horseRaceRankings(db),[]);
    assert.throws(()=>step(db,r,1,{now:NOW+182000}),/已棄權/);
    assert.equal(activeHorseRace(db,2).id,r2.id);
  }finally{db.close();}
});
test("GM-02 missing facility, different town, insufficient cash, limit, two horses, event and invalid clock reject without debit",()=>{
  const db=setup();
  try{
    db.exec("UPDATE characters SET town_id=1 WHERE user_id=1");
    assert.equal(horseRaceOverview(db,1).available,false);assert.throws(()=>quote(db),/沒有競馬場/);
    db.exec("UPDATE characters SET town_id=0 WHERE user_id=1");const q=quote(db);
    db.exec("UPDATE characters SET town_id=1 WHERE user_id=1");assert.throws(()=>start(db,q.id),/沒有此競馬場/);
    db.exec("UPDATE characters SET town_id=0,money=499 WHERE user_id=1");assert.throws(()=>start(db,q.id),/現金不足/);
    db.exec("UPDATE characters SET money=200000 WHERE user_id=1");
    assert.throws(()=>start(db,q.id,1,{tickets:[201,0,0,0,0,0]}),/上限/);
    assert.throws(()=>start(db,q.id,1,{tickets:[1,1,1,0,0,0]}),/兩匹/);
    assert.throws(()=>start(db,q.id,1,{now:NOW-1}),/時計/);
    db.exec("INSERT INTO character_events VALUES(1,1)");openCockroachChallenge(db,1,1,NOW);
    assert.throws(()=>start(db,q.id),/限時事件/);
    assert.equal(cash(db),200000);assert.equal(tax(db),undefined);
    assert.equal(horseRaceById(db,1,q.id).status,"quoted");assert.equal(activeHorseRace(db,1),null);
  }finally{db.close();}
});
test("GM-02 SQL failures roll back entry, turn, payout, rank, tax and receipts; retry pays exactly once",()=>{
  const db=setup();
  try{
    const q=quote(db);
    db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON horse_race_receipts BEGIN SELECT RAISE(ABORT,'receipt fault'); END;");
    assert.throws(()=>start(db,q.id),/receipt fault/);assert.equal(cash(db),200000);
    assert.equal(tax(db),undefined);assert.equal(activeHorseRace(db,1),null);
    db.exec("DROP TRIGGER fail_receipt");let r=start(db,q.id);
    db.exec("CREATE TRIGGER fail_turn BEFORE UPDATE ON horse_races BEGIN SELECT RAISE(ABORT,'turn fault'); END;");
    assert.throws(()=>step(db,r),/turn fault/);assert.equal(activeHorseRace(db,1).turn,0);
    db.exec("DROP TRIGGER fail_turn");
    // Deterministic real rounds; locate the last nonterminal round without modifying SQL race state.
    db.exec("CREATE TRIGGER fail_rank BEFORE INSERT ON horse_race_rankings BEGIN SELECT RAISE(ABORT,'rank fault'); END;");
    let fault=false;
    for(let i=0;i<20;i++){
      try{r=step(db,r);}catch(e){assert.match(e.message,/rank fault/);fault=true;break;}
    }
    assert.equal(fault,true);assert.equal(cash(db),150000);assert.equal(tax(db),151234);
    assert.equal(activeHorseRace(db,1).turn,r.turn);assert.deepEqual(horseRaceRankings(db),[]);
    db.exec("DROP TRIGGER fail_rank");
    db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON horse_race_receipts BEGIN SELECT RAISE(ABORT,'receipt fault'); END;");
    assert.throws(()=>step(db,r),/receipt fault/);assert.equal(cash(db),150000);
    assert.deepEqual(horseRaceRankings(db),[]);
    db.exec("DROP TRIGGER fail_receipt");
    const out=step(db,r);assert.equal(out.status,"completed");assert.ok(out.payout>0);
    assert.deepEqual(step(db,r,1,{rand:noRand}),{...out,replayed:true});
    assert.equal(cash(db),150000+out.payout);
  }finally{db.close();}
});
test("GM-02 physical SQLite reopen preserves card, lock, turns, final receipt and cascading deletion",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-horse-")),file=join(dir,"game.sqlite");
  let db;
  try{
    db=setup(file);const q=quote(db),r=start(db,q.id),next=step(db,r);
    db.close();db=new DatabaseSync(file);db.exec("PRAGMA foreign_keys=ON");initHorseRaceTables(db);
    assert.deepEqual(activeHorseRace(db,1),horseRaceById(db,1,q.id));
    assert.equal(activeHorseRace(db,1).turn,next.turn);
    assert.deepEqual(step(db,r,1,{rand:noRand}),{...next,replayed:true});
    storeTownMap(db,0,{tiles:Array(192).fill("")},"web-edited");
    assert.equal(horseRaceOverview(db,1).available,false);
    const out=finish(db,next);const paid=cash(db);
    db.close();db=new DatabaseSync(file);db.exec("PRAGMA foreign_keys=ON");initHorseRaceTables(db);
    assert.equal(horseRaceById(db,1,q.id).payout,out.payout);assert.equal(cash(db),paid);
    db.exec("DELETE FROM users WHERE id=1");
    for(const table of ["horse_races","horse_race_receipts","horse_race_rankings"])
      assert.equal(db.prepare("SELECT COUNT(*) n FROM "+table).get().n,0);
    assert.equal(cash(db,2),200000);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test("GM-02 first Monday start uses Sunday tax base before refreshing, including rejected and replayed transaction",()=>{
  const db=setup();
  try{
    const sunday=Date.parse("2026-11-29T00:00:00Z"),monday=sunday+86400000;
    db.exec("UPDATE characters SET money=2000000,bank=1000000 WHERE user_id=1");
    db.prepare("INSERT INTO bank_accounts(user_id,term_balance,last_interest_day) VALUES(1,0,?)").run("2026-11-29");
    db.prepare("INSERT INTO bank_tax_state(user_id,assessment_base,snapshot_day) VALUES(1,3000000,?)").run("2026-11-29");
    const q=quote(db,1,{now:sunday});
    const args={now:monday,today:"2026-11-30"};
    assert.throws(()=>start(db,q.id,1,{...args,tickets:[0,0,0,0,0,0]}),/尚未購買/);
    assert.equal(tax(db),3000000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_tax_assessments").get().n,0);
    const r=start(db,q.id,1,args);
    assert.equal(cash(db),1950000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,975000);
    assert.equal(db.prepare("SELECT assessment_base FROM bank_tax_assessments WHERE user_id=1").get().assessment_base,3000000);
    assert.equal(start(db,q.id,1,{...args,rand:noRand}).replayed,true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_tax_assessments").get().n,1);
    assert.equal(tax(db),2925000);
    assert.equal(r.status,"running");
  }finally{db.close();}
});

test("GM-02 decision A: every original wager rejection clears stale lock, but no other user's cash or rank",()=>{
  for(const [tickets,cashBefore,reason] of [
    [[0,0,0,0,0,0],200000,/尚未購買/],[[1,0,0,0,0,0],499,/現金不足/],
    [[201,0,0,0,0,0],200000,/上限/],[[1,1,1,0,0,0],200000,/兩匹/],
    [[-1,0,0,0,0,0],200000,/購買數/],[null,200000,/購買數/]
  ]){
    const db=setup();try{
      const a=quote(db),b=quote(db,2),r=start(db,a.id);
      db.prepare("UPDATE characters SET money=? WHERE user_id=2").run(cashBefore);
      const attempt={now:NOW+181000,tickets};
      assert.throws(()=>start(db,b.id,2,{...attempt,now:NOW+180999}),/已有競馬/);
      assert.equal(activeHorseRace(db,1).id,r.id);
      assert.throws(()=>start(db,b.id,2,attempt),reason);
      assert.equal(horseRaceById(db,1,r.id).status,"forfeited");
      assert.equal(horseRaceById(db,2,b.id).status,"quoted");
      assert.equal(activeHorseRace(db,2),null);assert.equal(cash(db,1),150000);
      assert.equal(cash(db,2),cashBefore);assert.equal(tax(db,2),undefined);
      assert.deepEqual(horseRaceRankings(db),[]);
      const next=quote(db,1,{now:NOW+182000,requestId:"quote_later"});
      const later=start(db,next.id,1,{now:NOW+182000,requestId:"start_later"});
      assert.throws(()=>start(db,b.id,2,{...attempt,now:NOW+400000,rand:noRand}),reason);
      assert.equal(activeHorseRace(db,1).id,later.id,"replayed rejection must not forfeit a newer stale race");
    }finally{db.close();}
  }
});
test("GM-02 decision A: forged ownership, internal RNG and SQL faults cannot commit expired lock clear",()=>{
  const db=setup();try{
    const a=quote(db),b=quote(db,2),r=start(db,a.id);
    const now=NOW+181000;
    assert.throws(()=>start(db,b.id,1,{now}),/不可變更/);
    assert.throws(()=>start(db,b.id,1,{now,requestId:"forged_owner_001"}),/本人/);
    assert.equal(activeHorseRace(db,1).id,r.id);
    assert.throws(()=>start(db,b.id,2,{now,rand:()=>NaN}),/亂數/);
    db.exec("CREATE TRIGGER fail_expired_receipt BEFORE INSERT ON horse_race_receipts BEGIN SELECT RAISE(ABORT,'expired receipt fault'); END;");
    assert.throws(()=>start(db,b.id,2,{now,tickets:[0,0,0,0,0,0]}),/expired receipt fault/);
    assert.equal(activeHorseRace(db,1).id,r.id);
    assert.equal(cash(db,1),150000);assert.equal(cash(db,2),200000);
    assert.equal(tax(db,2),undefined);assert.deepEqual(horseRaceRankings(db),[]);
    db.exec("DROP TRIGGER fail_expired_receipt");
    assert.throws(()=>start(db,b.id,2,{now,tickets:[0,0,0,0,0,0]}),/尚未購買/);
    assert.equal(activeHorseRace(db,1),null);
  }finally{db.close();}
});
