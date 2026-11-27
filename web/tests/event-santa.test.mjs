import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {maxBodyEnergy,maxBrainEnergy} from "../src/engine.mjs";
import {resolveNonItemEvent,NON_ITEM_EVENT_IDS} from "../src/event-effects.mjs";
import {EVENT_BONUS_ITEMS,findEventBonusItem} from "../src/event-item-bonus.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents} from "../src/events.mjs";
import {COCKROACH_WINDOW_MS,COCKROACH_EVENT_IDS,getCockroachChallenge,claimCockroach} from "../src/event-cockroach.mjs";

const STATS={kokugo:20,suugaku:20,rika:20,syakai:20,eigo:20,ongaku:20,bijutu:20,
  looks:20,tairyoku:20,kenkou:20,speed:20,power:20,wanryoku:20,kyakuryoku:20,
  love:20,unique:20,etti:20};
const DOLL="等身大サンタさん人形";
const EVENT34=(34-.5)/44,EVENT44=(44-.5)/44;
const NOW=100000;
function sequence(...values){
  let i=0;
  return ()=>{if(i>=values.length)throw Error("額外亂數呼叫");return values[i++];};
}
function character(overrides={}){
  return {money:100000,body_energy:10,brain_energy:10,stats_json:JSON.stringify(STATS),...overrides};
}
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',",
    "money INTEGER NOT NULL DEFAULT 100000,kpoint INTEGER NOT NULL DEFAULT 0,",
    "body_energy INTEGER NOT NULL DEFAULT 10,brain_energy INTEGER NOT NULL DEFAULT 10,",
    "recovered_at INTEGER NOT NULL DEFAULT 1000,stats_json TEXT NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  for(const uid of [1,2])db.prepare(
    "INSERT INTO characters(user_id,stats_json) VALUES(?,?)"
  ).run(uid,JSON.stringify(STATS));
  initCharacterEvents(db);
  initLegacyItemUseTables(db);
  return db;
}
function addDoll(db,{userId=1,sourceLine=1,category="プレゼント",durability=3,unit="回",invalid=false}={}){
  const fields=Array(33).fill("0");
  fields[0]=category;fields[1]=invalid?"破損名稱":DOLL;
  fields[9]="無";fields[21]=String(durability);fields[22]=unit;
  db.prepare(
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ).run(userId,String(userId),sourceLine,category,DOLL,"無",durability,unit,0,0,JSON.stringify(fields));
}
function usage(db,sourceLine=1,userId=1){
  return db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=? AND source_line=?")
    .get(userId,sourceLine)?.remaining;
}
function init(db,uid=1){
  return settleDailyIllnessEvent(db,uid,"2026-11-18",1000,()=>{throw Error("首次不可補抽事件");});
}
function trigger(db,{userId=1,day="2026-11-19",now=NOW,choice=0,event=34}={}){
  return settleDailyIllnessEvent(db,userId,day,now,sequence(0,(event-.5)/44,choice));
}
function row(db,uid=1){
  const c=db.prepare("SELECT money,kpoint,body_energy,brain_energy,stats_json,last_event_day FROM characters WHERE user_id=?").get(uid);
  return {...c,stats:JSON.parse(c.stats_json)};
}

test("原始事件 #34：先抽二選一，聖誕人偶符合則倍增現金或恢復能量；否則零現金德政令或蟑螂挑戰",()=>{
  const source=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
  const gifts=readFileSync(new URL("../../dat_dir/prezento.cgi",import.meta.url),"utf8");
  const branch=source.slice(source.indexOf("if ($event_rand == 34)"),source.indexOf("if ($event_rand == 35)"));
  assert.match(branch,/int\(rand\(2\)\)\+1/);
  assert.match(branch,/motimono_kensa_ev2\("等身大サンタさん人形"\)/);
  assert.match(branch,/\$money\s*=\s*int\s*\(\$money\*2\)/);
  assert.match(branch,/\$energy \+= 10000/);
  assert.match(branch,/\$nou_energy \+= 10000/);
  assert.match(branch,/elsif\(\$money <= 0\)/);
  assert.match(branch,/\$goki="on"/);
  assert.match(gifts,/プレゼント<>等身大サンタさん人形<>[^\n]+<>10<>回<>/);
  assert.equal(EVENT_BONUS_ITEMS[34],DOLL);
  assert.ok(NON_ITEM_EVENT_IDS.includes(34));
  assert.deepEqual(COCKROACH_EVENT_IDS,[34,44]);
});

test("有聖誕人偶：兩種等機率獎勵保留 Web 現金／能量安全上限，需消耗一次耐久",()=>{
  const doubled=resolveNonItemEvent(34,character(),sequence(0),DOLL);
  assert.equal(doubled.event.key,"santaEncounter");
  assert.equal(doubled.event.title,"聖誕老人事件");
  assert.equal(doubled.changes.money,200000);
  assert.equal(doubled.effects.money,100000);
  assert.equal(doubled.usedItemName,DOLL);
  assert.equal(doubled.cockroachChallenge,false);
  const recovered=resolveNonItemEvent(34,character(),sequence(.99),DOLL);
  assert.equal(recovered.changes.body_energy,maxBodyEnergy(STATS));
  assert.equal(recovered.changes.brain_energy,maxBrainEnergy(STATS));
  assert.equal(recovered.effects.bodyEnergy,maxBodyEnergy(STATS)-10);
  assert.equal(recovered.effects.brainEnergy,maxBrainEnergy(STATS)-10);
  assert.equal(recovered.usedItemName,DOLL);
  assert.equal(recovered.cockroachChallenge,false);
  const capped=resolveNonItemEvent(34,character({
    body_energy:maxBodyEnergy(STATS),brain_energy:maxBrainEnergy(STATS)
  }),sequence(.99),DOLL);
  assert.equal(capped.effects.bodyEnergy,0);
  assert.equal(capped.effects.brainEnergy,0);
});

test("沒有有效人偶：正現金必須產生蟑螂，零現金觸發德政令且不產生挑戰",()=>{
  for(const choice of [0,.99]){
    const danger=resolveNonItemEvent(34,character({money:1}),sequence(choice));
    assert.equal(danger.cockroachChallenge,true);
    assert.deepEqual(danger.effects,{cockroach:"pending"});
    assert.deepEqual(danger.changes,{});
    assert.equal(danger.usedItemName,null);
    const decree=resolveNonItemEvent(34,character({money:0}),sequence(choice));
    assert.equal(decree.event.key,"santaEncounter");
    assert.equal(decree.cockroachChallenge,false);
    assert.deepEqual(decree.effects,{});
    assert.deepEqual(decree.changes,{});
    assert.match(decree.event.description,/德政令/);
  }
});

test("聖誕人偶跨日獎勵、扣耐久與事件歷史同筆提交，原始 33 欄封存不變",()=>{
  const db=setup();
  try{
    addDoll(db,{durability:2});
    init(db);
    const raw=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=1").get().raw_fields_json;
    assert.equal(trigger(db,{choice:0}).event.key,"santaEncounter");
    assert.equal(row(db).money,200000);
    assert.equal(usage(db),1);
    assert.equal(getCockroachChallenge(db,1,NOW),null);
    assert.equal(trigger(db,{choice:.99,day:"2026-11-20"}).event.key,"santaEncounter");
    assert.equal(usage(db),0);
    assert.equal(row(db).body_energy,maxBodyEnergy(STATS));
    assert.equal(row(db).brain_energy,maxBrainEnergy(STATS));
    assert.equal(trigger(db,{choice:.99,day:"2026-11-20"}).checked,false);
    const third=trigger(db,{day:"2026-11-21",choice:0});
    assert.equal(third.event.key,"santaEncounter");
    assert.equal(getCockroachChallenge(db,1,NOW).status,"active");
    assert.equal(usage(db),0);
    const history=listCharacterEvents(db,1);
    assert.deepEqual(history.map(h=>h.originalId),[34,34,34]);
    assert.equal(history[0].effects.cockroach,"pending");
    assert.equal(history[1].effects.item.remaining,0);
    assert.equal(history[2].effects.item.remaining,1);
    assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=1").get().raw_fields_json,raw);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db.close();}
});

test("無效人偶、他人持有、ギフト、日耐久和損壞封存不能冒領聖誕獎勵",()=>{
  const db=setup();
  try{
    addDoll(db,{userId:2,sourceLine:1});
    addDoll(db,{sourceLine:2,category:"ギフト"});
    addDoll(db,{sourceLine:3,unit:"日"});
    addDoll(db,{sourceLine:4,invalid:true});
    addDoll(db,{sourceLine:5,durability:0});
    assert.equal(findEventBonusItem(db,1,DOLL),null);
    init(db,1);init(db,2);
    const e=trigger(db,{choice:0});
    assert.equal(e.event.key,"santaEncounter");
    assert.equal(getCockroachChallenge(db,1,NOW).status,"active");
    assert.equal(row(db).money,100000);
    for(const sourceLine of [2,3,4,5])assert.equal(usage(db,sourceLine),undefined);
    const other=trigger(db,{userId:2,choice:0});
    assert.equal(other.event.key,"santaEncounter");
    assert.equal(row(db,2).money,200000);
    assert.equal(usage(db,1,2),2);
    assert.equal(usage(db,1),undefined);
    assert.equal(getCockroachChallenge(db,2,NOW),null);
  }finally{db.close();}
});

test("事件 #34 與原本 #44 的蟑螂：都可在 20 秒內領獎，維持 K 點 +3、外貌 -3 及防重領",()=>{
  for(const id of [34,44]){
    const db=setup();
    try{
      init(db);
      const spawned=trigger(db,{event:id,choice:0});
      assert.equal(spawned.originalId,id);
      assert.equal(getCockroachChallenge(db,1,NOW).remainingMs,COCKROACH_WINDOW_MS);
      assert.throws(()=>claimCockroach(db,2,NOW+1000),/沒有待處理/);
      const reward=claimCockroach(db,1,NOW+19999,sequence(.5));
      assert.equal(reward.status,"caught");
      assert.equal(reward.reward,10001);
      assert.equal(row(db).money,110001);
      assert.equal(row(db).kpoint,3);
      assert.equal(row(db).stats.looks,17);
      assert.equal(getCockroachChallenge(db,1,NOW+19999),null);
      assert.equal(listCharacterEvents(db,1)[0].effects.cockroach,"caught");
      assert.throws(()=>claimCockroach(db,1,NOW+19999),/沒有待處理/);
    }finally{db.close();}
  }
});

test("事件 #34 蟑螂逾時沒有獎金、K 點或外貌變化；回寫事件歷史",()=>{
  const db=setup();
  try{
    init(db);trigger(db);
    const expired=claimCockroach(db,1,NOW+20000,()=>{throw Error("逾時不可抽獎");});
    assert.deepEqual(expired,{status:"escaped",reward:0,kpoint:0,looks:0});
    assert.equal(row(db).money,100000);
    assert.equal(row(db).kpoint,0);
    assert.equal(row(db).stats.looks,20);
    assert.equal(listCharacterEvents(db,1)[0].effects.cockroach,"escaped");
  }finally{db.close();}
});

test("事件 #34 新增歷史失敗會回滾人偶耐久、現金及日標記，領獎失敗不會消耗挑戰",()=>{
  const db=setup();
  try{
    addDoll(db);init(db);
    db.exec("CREATE TRIGGER refuse_santa BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'santa history blocked'); END;");
    assert.throws(()=>trigger(db,{choice:0}),/santa history blocked/);
    assert.equal(usage(db),undefined);
    assert.equal(row(db).money,100000);
    assert.equal(row(db).last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER refuse_santa");
    trigger(db,{choice:0});
    assert.equal(usage(db),2);
    // 另一個玩家無人偶，開啟挑戰後使事件歷史更新失敗。
    init(db,2);trigger(db,{userId:2});
    db.exec("CREATE TRIGGER refuse_claim BEFORE UPDATE ON character_events BEGIN SELECT RAISE(ABORT,'claim history blocked'); END;");
    assert.throws(()=>claimCockroach(db,2,NOW+1000,sequence(0)),/claim history blocked/);
    assert.equal(row(db,2).money,100000);
    assert.equal(row(db,2).kpoint,0);
    assert.equal(getCockroachChallenge(db,2,NOW+1000).status,"active");
    db.exec("DROP TRIGGER refuse_claim");
    assert.equal(claimCockroach(db,2,NOW+1000,sequence(0)).reward,1);
  }finally{db.close();}
});

test("事件 #34 現金倍增超出安全整數時拒絕且保留人偶耐久及當日重抽資格",()=>{
  const db=setup();
  try{
    addDoll(db);init(db);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,{choice:0}),/安全整數/);
    assert.equal(usage(db),undefined);
    assert.equal(row(db).last_event_day,"2026-11-18");
    assert.equal(listCharacterEvents(db,1).length,0);
  }finally{db.close();}
});
