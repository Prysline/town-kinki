import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TOWNS } from "../src/engine.mjs";
import { resolveNonItemEvent } from "../src/event-effects.mjs";
import { findEventBonusItem } from "../src/event-item-bonus.mjs";
import { initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents } from "../src/events.mjs";
import { initLegacyItemUseTables } from "../src/legacy-item-use.mjs";
import { initBankTables,bankLedger } from "../src/banking.mjs";

const STATS={kokugo:20,suugaku:20,rika:20,syakai:20,bijutu:20,love:20,
  eigo:20,ongaku:20,looks:20,tairyoku:20,kenkou:20,speed:20,power:20,
  wanryoku:20,kyakuryoku:20,unique:20,etti:20};
function character(overrides={}){
  return {money:100000,bank:100000,town_id:3,weight:60,height:165,bmi:22,
    body_energy:20,brain_energy:20,job_experience:60,recovered_at:1000,
    stats_json:JSON.stringify(STATS),...overrides};
}
function rng(...values){
  let i=0;return ()=>{if(i>=values.length)throw Error("亂數抽選次數超出預期");return values[i++];};
}
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),",
    "health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',",
    "money INTEGER NOT NULL DEFAULT 100000,bank INTEGER NOT NULL DEFAULT 100000,",
    "town_id INTEGER NOT NULL DEFAULT 3,weight REAL NOT NULL DEFAULT 60,",
    "height INTEGER NOT NULL DEFAULT 165,bmi REAL NOT NULL DEFAULT 22,",
    "body_energy INTEGER NOT NULL DEFAULT 20,brain_energy INTEGER NOT NULL DEFAULT 20,",
    "job_experience INTEGER NOT NULL DEFAULT 60,recovered_at INTEGER NOT NULL DEFAULT 1000,",
    "stats_json TEXT NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  const ins=db.prepare("INSERT INTO characters(user_id,stats_json) VALUES(?,?)");
  ins.run(1,JSON.stringify(STATS));
  ins.run(2,JSON.stringify(STATS));
  initBankTables(db);
  initCharacterEvents(db);
  initLegacyItemUseTables(db);
  return db;
}
function addItem(db,sourceLine,name,{userId=1,unit="日",durability=7,purchasedAt=10,category="日用品"}={}){
  const raw=Array(33).fill("0");
  raw[0]=category;raw[1]=name;raw[9]="無";raw[21]=String(durability);raw[22]=unit;raw[30]=String(purchasedAt);
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,String(userId),sourceLine,category,name,"無",
    durability,unit,purchasedAt,0,JSON.stringify(raw));
}
function first(db,userId=1){
  settleDailyIllnessEvent(db,userId,"2026-11-18",1000,()=>{throw Error("初次不可抽事件");});
}
function trigger(db,id,{choices=[],day="2026-11-19",userId=1,now=100000}={}){
  return settleDailyIllnessEvent(db,userId,day,now,rng(0,(id-.5)/44,...choices));
}
function state(db,userId=1){
  return db.prepare("SELECT money,bank,town_id,last_event_day FROM characters WHERE user_id=?").get(userId);
}
function remaining(db,sourceLine,userId=1){
  return db.prepare("SELECT remaining,last_used_at_ms FROM legacy_item_usage WHERE user_id=? AND source_line=?")
    .get(userId,sourceLine);
}

test("第 16 號無攝影機時：銀行為零不抽結果；有存款時等機率無損或失去五分之一",()=>{
  const noBank=resolveNonItemEvent(16,character({bank:0}),rng());
  assert.deepEqual(noBank.changes,{});
  assert.equal(noBank.usedItemName,null);
  const safe=resolveNonItemEvent(16,character(),rng(0));
  assert.deepEqual(safe.changes,{});
  const robbed=resolveNonItemEvent(16,character({bank:101}),rng(.99));
  assert.equal(robbed.changes.bank,81);
  assert.equal(robbed.effects.bank,-20);
  assert.equal(robbed.effects.money,undefined);
});

test("第 16 號有攝影機時：五分之一損失五分之一存款、其餘獲得十萬謝禮",()=>{
  const bad=resolveNonItemEvent(16,character({bank:101}),rng(0),"防犯カメラ");
  assert.equal(bad.changes.bank,81);
  assert.equal(bad.extraItemUseName,"防犯カメラ");
  assert.equal(bad.usedItemName,"防犯カメラ");
  const good=resolveNonItemEvent(16,character(),rng(.999),"防犯カメラ");
  assert.equal(good.effects.money,100000);
  assert.equal(good.changes.money,200000);
  assert.equal(good.extraItemUseName,null);
  const empty=resolveNonItemEvent(16,character({bank:0}),rng(),"防犯カメラ");
  assert.equal(empty.usedItemName,"防犯カメラ");
  assert.equal(empty.extraItemUseName,null);
});

test("第 23 號會員卡抽獎保留四種等機率金額；無卡時只傳送到 0 至 2 號城市",()=>{
  for(const [n,rand] of [[10000,0],[100000,.25],[500000,.5],[1000000,.999]]){
    const reward=resolveNonItemEvent(23,character(),rng(rand),"ブラタンメンバーズカード");
    assert.equal(reward.effects.money,n);
    assert.equal(reward.usedItemName,"ブラタンメンバーズカード");
  }
  for(const [rand,destination] of [[0,0],[.34,1],[.999,2]]){
    const moved=resolveNonItemEvent(23,character(),rng(.99,rand));
    assert.equal(moved.changes.town_id,destination);
    assert.deepEqual(moved.effects.townId,{from:3,to:destination});
    assert.match(moved.event.description,new RegExp(TOWNS[destination].name));
    assert.equal(moved.usedItemName,null);
  }
  const same=resolveNonItemEvent(23,character({town_id:0}),rng(0,0));
  assert.deepEqual(same.effects.townId,{from:0,to:0});
  assert.throws(()=>resolveNonItemEvent(23,character({town_id:99}),rng(0,0)),/城鎮/);
});

test("日耐久事件道具只在購入時間至期限內有效；禮物、零耐久、不完整日期不可觸發",()=>{
  const db=setup();
  try{
    addItem(db,1,"防犯カメラ",{durability:1,purchasedAt:10});
    addItem(db,2,"ブラタンメンバーズカード",{durability:7,purchasedAt:10});
    addItem(db,3,"防犯カメラ",{category:"ギフト"});
    assert.equal(findEventBonusItem(db,1,"防犯カメラ"),null);
    assert.equal(findEventBonusItem(db,1,"防犯カメラ",{allowDay:true,now:100000}).sourceLine,1);
    assert.equal(findEventBonusItem(db,1,"ブラタンメンバーズカード",{allowDay:true,now:100000}).sourceLine,2);
    assert.equal(findEventBonusItem(db,1,"防犯カメラ",{allowDay:true,now:10*1000+86400000}),null);
    assert.equal(findEventBonusItem(db,1,"ブラタンメンバーズカード",{allowDay:true,now:1000}),null);
    db.prepare("UPDATE legacy_inventory_items SET purchased_at=0 WHERE user_id=1 AND source_line=1").run();
    assert.equal(findEventBonusItem(db,1,"防犯カメラ",{allowDay:true,now:100000}),null);
  }finally{db.close();}
});

test("有銀行存款、無攝影機時，竊盜記入本人普通銀行帳簿，與角色及事件歷史一致",()=>{
  const db=setup();
  try{
    first(db);first(db,2);
    const result=trigger(db,16,{choices:[.99]});
    assert.equal(result.event.key,"bankBurglary");
    assert.equal(state(db).bank,80000);
    assert.equal(state(db).money,100000);
    assert.equal(state(db,2).bank,100000);
    assert.equal(bankLedger(db,2).length,0);
    assert.deepEqual(bankLedger(db,1).map(e=>[e.action,e.debit,e.balance]),[["空屋竊盜",20000,80000]]);
    const history=listCharacterEvents(db,1);
    assert.equal(history[0].title,"銀行存款竊盜");
    assert.equal(history[0].effects.bank,-20000);
    assert.equal(trigger(db,16,{choices:[0]}).checked,false);
    assert.equal(bankLedger(db,1).length,1);
  }finally{db.close();}
});

test("攝影機原版破壞結果會最多扣兩次耐久，剩下一次時僅扣一次",()=>{
  const db=setup();
  try{
    addItem(db,1,"防犯カメラ",{durability:4});
    first(db);
    const firstEvent=trigger(db,16,{choices:[0]});
    assert.equal(firstEvent.event.key,"bankBurglary");
    assert.equal(state(db).bank,80000);
    assert.equal(remaining(db,1).remaining,2);
    const history=listCharacterEvents(db,1)[0].effects;
    assert.equal(history.item.remaining,3);
    assert.equal(history.extraItem.remaining,2);
    assert.equal(history.item.sourceLine,1);
    trigger(db,16,{choices:[0],day:"2026-11-20"});
    assert.equal(remaining(db,1).remaining,0);
    // 攝影機已耗盡；原版回到二分之一抽選，指定抽中銀行被偷。
    trigger(db,16,{choices:[.99],day:"2026-11-21"});
    assert.equal(remaining(db,1).remaining,0);
    assert.equal(state(db).bank,51200); // 80000 → 64000 → 51200
  }finally{db.close();}
});

test("同名攝影機第一件只剩一次時，破壞事件的第二次扣除會選取下一件",()=>{
  const db=setup();
  try{
    addItem(db,1,"防犯カメラ",{durability:1});
    addItem(db,2,"防犯カメラ",{durability:3});
    first(db);
    trigger(db,16,{choices:[0]});
    assert.equal(remaining(db,1).remaining,0);
    assert.equal(remaining(db,2).remaining,2);
    assert.equal(listCharacterEvents(db,1)[0].effects.extraItem.sourceLine,2);
  }finally{db.close();}
});

test("銀行為零也會檢查並消耗一次攝影機，但沒有銀行帳簿扣款",()=>{
  const db=setup();
  try{
    addItem(db,1,"防犯カメラ",{durability:2});
    db.prepare("UPDATE characters SET bank=0 WHERE user_id=1").run();
    first(db);
    trigger(db,16);
    assert.equal(remaining(db,1).remaining,1);
    assert.equal(bankLedger(db,1).length,0);
    assert.equal(listCharacterEvents(db,1)[0].effects.item.remaining,1);
  }finally{db.close();}
});

test("會員卡日耐久同人連續扣除並保存抽獎金額，卡用盡後 UFO 會移動城鎮",()=>{
  const db=setup();
  try{
    addItem(db,5,"ブラタンメンバーズカード",{durability:2});
    first(db);
    trigger(db,23,{choices:[0]});
    assert.equal(state(db).money,110000);
    assert.equal(state(db).town_id,3);
    assert.equal(remaining(db,5).remaining,1);
    trigger(db,23,{choices:[.999],day:"2026-11-20"});
    assert.equal(state(db).money,1110000);
    assert.equal(remaining(db,5).remaining,0);
    const moved=trigger(db,23,{choices:[.99,.45],day:"2026-11-21"});
    assert.equal(moved.event.key,"ufoMembership");
    assert.equal(state(db).town_id,1);
    assert.deepEqual(listCharacterEvents(db,1)[0].effects.townId,{from:3,to:1});
    assert.equal(trigger(db,23,{day:"2026-11-21"}).checked,false);
    assert.equal(remaining(db,5).remaining,0);
  }finally{db.close();}
});

test("日耐久的事件物品不可跨玩家使用，也不會改寫原始 33 欄封存",()=>{
  const db=setup();
  try{
    addItem(db,3,"ブラタンメンバーズカード",{userId:2});
    const raw=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=2 AND source_line=3").get().raw_fields_json;
    first(db);first(db,2);
    trigger(db,23,{choices:[0,.999]});
    assert.equal(state(db).town_id,2);
    assert.equal(remaining(db,3,2),undefined);
    trigger(db,23,{userId:2,choices:[.25]});
    assert.equal(state(db,2).money,200000);
    assert.equal(remaining(db,3,2).remaining,6);
    assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=2 AND source_line=3").get().raw_fields_json,raw);
  }finally{db.close();}
});

test("銀行帳簿若失敗，竊盜、道具耐久、當日事件標記全部回滾",()=>{
  const db=setup();
  try{
    addItem(db,1,"防犯カメラ",{durability:2});
    first(db);
    db.exec("CREATE TRIGGER reject_ledger BEFORE INSERT ON bank_ledger BEGIN SELECT RAISE(ABORT,'ledger blocked'); END;");
    assert.throws(()=>trigger(db,16,{choices:[0]}),/ledger blocked/);
    assert.equal(state(db).bank,100000);
    assert.equal(state(db).last_event_day,"2026-11-18");
    assert.equal(remaining(db,1),undefined);
    assert.equal(listCharacterEvents(db,1).length,0);
    db.exec("DROP TRIGGER reject_ledger");
    trigger(db,16,{choices:[0]});
    assert.equal(state(db).bank,80000);
    assert.equal(remaining(db,1).remaining,0);
  }finally{db.close();}
});

test("UFO 改變城鎮若事件歷史儲存失敗，移動與當日抽選標記全部回滾",()=>{
  const db=setup();
  try{
    first(db);
    db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'history blocked'); END;");
    assert.throws(()=>trigger(db,23,{choices:[0,0]}),/history blocked/);
    assert.equal(state(db).town_id,3);
    assert.equal(state(db).last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER reject_event");
    trigger(db,23,{choices:[0,0]});
    assert.equal(state(db).town_id,0);
  }finally{db.close();}
});

test("攝影機抓到竊賊的十萬元謝禮若溢位，不消耗耐久或標記已抽事件",()=>{
  const db=setup();
  try{
    addItem(db,1,"防犯カメラ",{durability:3});
    first(db);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,16,{choices:[.99]}),/安全整數/);
    assert.equal(remaining(db,1),undefined);
    assert.equal(state(db).last_event_day,"2026-11-18");
    db.prepare("UPDATE characters SET money=500 WHERE user_id=1").run();
    trigger(db,16,{choices:[.99]});
    assert.equal(state(db).money,100500);
    assert.equal(remaining(db,1).remaining,2);
  }finally{db.close();}
});
