import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents } from "../src/events.mjs";
import { resolveNonItemEvent } from "../src/event-effects.mjs";
import { findEventBonusItem } from "../src/event-item-bonus.mjs";
import { initLegacyItemUseTables } from "../src/legacy-item-use.mjs";

const BASE_STATS={kokugo:20,suugaku:20,rika:20,syakai:20,bijutu:20,love:20,
  eigo:20,ongaku:20,looks:20,tairyoku:20,kenkou:20,speed:20,power:20,
  wanryoku:20,kyakuryoku:20,unique:20,etti:20};
function setup() {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),",
    "health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',",
    "money INTEGER NOT NULL DEFAULT 100000,weight REAL NOT NULL DEFAULT 60,",
    "height INTEGER NOT NULL DEFAULT 165,bmi REAL NOT NULL DEFAULT 22,",
    "body_energy INTEGER NOT NULL DEFAULT 20,brain_energy INTEGER NOT NULL DEFAULT 20,",
    "job_experience INTEGER NOT NULL DEFAULT 60,recovered_at INTEGER NOT NULL DEFAULT 1000,",
    "stats_json TEXT NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  const insert=db.prepare("INSERT INTO characters(user_id,stats_json) VALUES(?,?)");
  insert.run(1,JSON.stringify(BASE_STATS));
  insert.run(2,JSON.stringify(BASE_STATS));
  initCharacterEvents(db);
  initLegacyItemUseTables(db);
  return db;
}
function rng(...values){
  let index=0;
  return ()=>{if(index>=values.length)throw Error("出現未預期的亂數呼叫");return values[index++];};
}
function trigger(db,id,choice=0,day="2026-11-19",userId=1){
  return settleDailyIllnessEvent(db,userId,day,100000,
    rng(0,(id-.5)/44,choice));
}
function start(db,userId=1){
  return settleDailyIllnessEvent(db,userId,"2026-11-18",1000,()=>{throw Error("首次不可抽事件");});
}
function stats(db,userId=1){
  return JSON.parse(db.prepare("SELECT stats_json FROM characters WHERE user_id=?").get(userId).stats_json);
}
function addItem(db,sourceLine,name,{userId=1,category="ゲットアイテム",durability=2,unit="回",corrupt=false}={}){
  const raw=Array(33).fill("0");
  raw[0]=category;raw[1]=name;raw[21]=String(durability);raw[22]=unit;
  raw[9]="無";
  if(corrupt)raw[1]="破損名稱";
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
    "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,String(userId),sourceLine,category,name,"無",durability,unit,0,0,JSON.stringify(raw));
}
function remaining(db,sourceLine,userId=1){
  return db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=? AND source_line=?")
    .get(userId,sourceLine)?.remaining;
}

test("事件 3 與 11 的基本分支各為二分之一，沒有道具仍能正常生效",()=>{
  for(const [id,key] of [[3,"eigo"],[11,"ongaku"]]){
    const ch={stats_json:JSON.stringify(BASE_STATS)};
    const positive=resolveNonItemEvent(id,ch,rng(0));
    const negative=resolveNonItemEvent(id,ch,rng(.99));
    assert.equal(positive.effects.stats[key],3);
    assert.equal(negative.effects.stats[key],-3);
    assert.equal(positive.usedItemName,null);
    assert.equal(negative.usedItemName,null);
    assert.equal(JSON.parse(positive.changes.stats_json)[key],23);
    assert.equal(JSON.parse(negative.changes.stats_json)[key],17);
  }
});

test("英語事件只在正面結果消耗《英文解釈教室》，額外增加 5 點",()=>{
  const db=setup();
  try {
    addItem(db,1,"英文解釈教室");
    start(db);
    const negative=trigger(db,3,.99);
    assert.equal(negative.event.key,"englishLesson");
    assert.equal(stats(db).eigo,17);
    assert.equal(remaining(db,1),undefined);
    const positive=trigger(db,3,0,"2026-11-20");
    assert.equal(positive.event.key,"englishLesson");
    assert.equal(stats(db).eigo,25);
    assert.equal(remaining(db,1),1);
    const history=listCharacterEvents(db,1);
    assert.equal(history[0].title,"英語事件");
    assert.equal(history[0].effects.stats.eigo,8);
    assert.deepEqual(history[0].effects.item,{name:"英文解釈教室",sourceLine:1,remaining:1});
    assert.equal(history[1].effects.item,undefined);
    assert.equal(trigger(db,3,0,"2026-11-20").checked,false);
    assert.equal(remaining(db,1),1);
  }finally{db.close();}
});

test("音樂事件持有《成り上がり》無論正反都再加 3，而非原文敘述的 5",()=>{
  const db=setup();
  try {
    addItem(db,2,"成り上がり");
    start(db);
    const negative=trigger(db,11,.99);
    assert.equal(negative.event.key,"musicLesson");
    assert.equal(stats(db).ongaku,20); // -3 + 3 = 0
    assert.equal(remaining(db,2),1);
    assert.match(negative.event.description,/再增加 3 點/);
    const positive=trigger(db,11,0,"2026-11-20");
    assert.equal(stats(db).ongaku,26); // +3 + 3
    assert.equal(remaining(db,2),0);
    assert.equal(trigger(db,11,0,"2026-11-21").event.key,"musicLesson");
    assert.equal(stats(db).ongaku,29); // 道具已耗盡，只剩 +3
    assert.equal(remaining(db,2),0);
    assert.equal(listCharacterEvents(db,1)[1].effects.stats.ongaku,6);
  }finally{db.close();}
});

test("只有本人持有且有效的「回」耐久物品可加成，禮物、日耐久與損壞封存均不誤觸",()=>{
  const db=setup();
  try{
    addItem(db,1,"英文解釈教室",{userId:2});
    addItem(db,2,"英文解釈教室",{category:"ギフト"});
    addItem(db,3,"英文解釈教室",{unit:"日"});
    addItem(db,4,"英文解釈教室",{corrupt:true});
    addItem(db,5,"英文解釈教室",{durability:0});
    assert.equal(findEventBonusItem(db,1,"英文解釈教室"),null);
    start(db);start(db,2);
    trigger(db,3,0);
    assert.equal(stats(db).eigo,23);
    assert.equal(remaining(db,2),undefined);
    trigger(db,3,0,"2026-11-19",2);
    assert.equal(stats(db,2).eigo,28);
    assert.equal(remaining(db,1,2),1);
    assert.equal(listCharacterEvents(db,1)[0].effects.item,undefined);
    assert.equal(listCharacterEvents(db,2)[0].effects.item.name,"英文解釈教室");
  }finally{db.close();}
});

test("事件扣除與第二十階段手動消耗共用耐久，不改寫原始 33 欄封存",()=>{
  const db=setup();
  try{
    addItem(db,7,"成り上がり",{durability:4});
    db.prepare("INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms) VALUES(?,?,?,?)")
      .run(1,7,2,3600000);
    const archived=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=7").get().raw_fields_json;
    start(db);
    trigger(db,11,0);
    assert.equal(remaining(db,7),1);
    assert.equal(db.prepare("SELECT last_used_at_ms FROM legacy_item_usage WHERE user_id=1 AND source_line=7").get().last_used_at_ms,3600000);
    assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=7").get().raw_fields_json,archived);
  }finally{db.close();}
});

test("事件歷史寫入失敗時，能力、耐久與抽選日一併回滾",()=>{
  const db=setup();
  try{
    addItem(db,1,"成り上がり");
    start(db);
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'fail history'); END;");
    assert.throws(()=>trigger(db,11,0),/fail history/);
    assert.equal(stats(db).ongaku,20);
    assert.equal(remaining(db,1),undefined);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER fail_event;");
    assert.equal(trigger(db,11,0).event.key,"musicLesson");
    assert.equal(remaining(db,1),1);
  }finally{db.close();}
});
