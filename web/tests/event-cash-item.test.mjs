import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { resolveNonItemEvent } from "../src/event-effects.mjs";
import { findEventBonusItem } from "../src/event-item-bonus.mjs";
import { initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents } from "../src/events.mjs";
import { initLegacyItemUseTables } from "../src/legacy-item-use.mjs";

const STATS={kokugo:20,suugaku:20,rika:20,syakai:20,bijutu:20,love:20,
  eigo:20,ongaku:20,looks:20,tairyoku:20,kenkou:20,speed:20,power:20,
  wanryoku:20,kyakuryoku:20,unique:20,etti:20};
function row(overrides={}){
  return {money:100000,weight:60,height:165,bmi:22,body_energy:20,brain_energy:20,
    job_experience:60,recovered_at:1000,stats_json:JSON.stringify(STATS),...overrides};
}
function rng(...values){
  let i=0;
  return ()=>{if(i>=values.length)throw Error("額外呼叫亂數產生器");return values[i++];};
}
function setup(){
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
  insert.run(1,JSON.stringify(STATS));
  insert.run(2,JSON.stringify(STATS));
  initCharacterEvents(db);
  initLegacyItemUseTables(db);
  return db;
}
function addItem(db,sourceLine,name,{userId=1,category="日用品",durability=2,unit="回"}={}){
  const raw=Array(33).fill("0");
  raw[0]=category;raw[1]=name;raw[9]="無";
  raw[21]=String(durability);raw[22]=unit;
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
    "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,String(userId),sourceLine,category,name,"無",durability,unit,0,0,JSON.stringify(raw));
}
function firstDay(db,userId=1){
  settleDailyIllnessEvent(db,userId,"2026-11-18",1000,()=>{throw Error("初始化不應抽選");});
}
function trigger(db,id,{choice=0,day="2026-11-19",userId=1}={}){
  return settleDailyIllnessEvent(db,userId,day,100000,rng(0,(id-.5)/44,...(
    [17,18,20,21].includes(id)?[choice]:[])));
}
function money(db,userId=1){
  return db.prepare("SELECT money FROM characters WHERE user_id=?").get(userId).money;
}
function stats(db,userId=1){
  return JSON.parse(db.prepare("SELECT stats_json FROM characters WHERE user_id=?").get(userId).stats_json);
}
function usage(db,sourceLine,userId=1){
  return db.prepare("SELECT remaining,last_used_at_ms FROM legacy_item_usage WHERE user_id=? AND source_line=?")
    .get(userId,sourceLine);
}

test("第 17 號版稅：未持有物品為 1000／500 元，持有知恵袋固定 3000 元",()=>{
  assert.equal(resolveNonItemEvent(17,row(),rng(0)).effects.money,1000);
  assert.equal(resolveNonItemEvent(17,row(),rng(.99)).effects.money,500);
  const bonus=resolveNonItemEvent(17,row(),rng(.99),"おばあちゃんの知恵袋");
  assert.equal(bonus.effects.money,3000);
  assert.equal(bonus.usedItemName,"おばあちゃんの知恵袋");
});

test("第 18 號呼拉圈：未持有物品為 +5000／-500 元，持有固定 +77777 元",()=>{
  assert.equal(resolveNonItemEvent(18,row(),rng(0)).effects.money,5000);
  assert.equal(resolveNonItemEvent(18,row(),rng(.99)).effects.money,-500);
  const bonus=resolveNonItemEvent(18,row(),rng(.99),"フラフープ");
  assert.equal(bonus.changes.money,177777);
  assert.equal(bonus.usedItemName,"フラフープ");
  const poor=resolveNonItemEvent(18,row({money:100}),rng(.99));
  assert.equal(poor.effects.money,-100);
  assert.equal(poor.changes.money,0);
});

test("第 19 號交通意外：速度 180 以下付 3 萬，181 起無傷，御守提供 3 萬",()=>{
  assert.equal(resolveNonItemEvent(19,row()).effects.money,-30000);
  const slow=resolveNonItemEvent(19,row({
    stats_json:JSON.stringify({...STATS,speed:180})
  }));
  assert.equal(slow.effects.money,-30000);
  const quick=resolveNonItemEvent(19,row({
    stats_json:JSON.stringify({...STATS,speed:181})
  }));
  assert.deepEqual(quick.changes,{});
  assert.deepEqual(quick.effects,{});
  const protectedEvent=resolveNonItemEvent(19,row(),rng(),"谷保天満宮のお守り");
  assert.equal(protectedEvent.effects.money,30000);
  assert.equal(protectedEvent.usedItemName,"谷保天満宮のお守り");
});

test("第 20 號香水：原版文字寫一萬但實際程式為十萬，持有則現金翻倍",()=>{
  assert.equal(resolveNonItemEvent(20,row(),rng(0)).effects.money,100000);
  assert.equal(resolveNonItemEvent(20,row(),rng(.99)).effects.money,-10000);
  const bonus=resolveNonItemEvent(20,row(),rng(.99),"幸せを呼ぶ香水");
  assert.equal(bonus.changes.money,200000);
  assert.equal(bonus.effects.money,100000);
  assert.equal(bonus.usedItemName,"幸せを呼ぶ香水");
  assert.throws(()=>resolveNonItemEvent(20,row({money:Number.MAX_SAFE_INTEGER}),
    rng(0),"幸せを呼ぶ香水"),/安全整數/);
});

test("第 21 號親密能力：一般結果為 +3／-3，持有物品則 LOVE、親密各 +3",()=>{
  const positive=resolveNonItemEvent(21,row(),rng(0));
  assert.deepEqual(positive.effects.stats,{etti:3});
  const negative=resolveNonItemEvent(21,row(),rng(.99));
  assert.deepEqual(negative.effects.stats,{etti:-3});
  const bonus=resolveNonItemEvent(21,row(),rng(.99),"バイアグラ");
  assert.deepEqual(bonus.effects.stats,{love:3,etti:3});
  assert.equal(JSON.parse(bonus.changes.stats_json).love,23);
  assert.equal(JSON.parse(bonus.changes.stats_json).etti,23);
  assert.equal(bonus.usedItemName,"バイアグラ");
  const limited=resolveNonItemEvent(21,row({stats_json:JSON.stringify({
    ...STATS,etti:1
  })}),rng(.99));
  assert.equal(limited.effects.stats.etti,-1);
});

test("第 29 號星砂：沒有物品 +10000，有物品則現金翻倍且不額外抽亂數",()=>{
  assert.equal(resolveNonItemEvent(29,row(),rng()).effects.money,10000);
  const withItem=resolveNonItemEvent(29,row(),rng(),"幸せの星砂");
  assert.equal(withItem.changes.money,200000);
  assert.equal(withItem.usedItemName,"幸せの星砂");
});

test("新事件記錄說明、消耗耐久、同日防重與原始 33 欄封存保持不變",()=>{
  const db=setup();
  try{
    addItem(db,7,"おばあちゃんの知恵袋",{durability:2,category:"書籍"});
    firstDay(db);
    const original=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=7")
      .get().raw_fields_json;
    const earned=trigger(db,17,{choice:.99});
    assert.equal(earned.event.key,"bookRoyalty");
    assert.equal(money(db),103000);
    assert.equal(usage(db,7).remaining,1);
    assert.equal(trigger(db,17,{day:"2026-11-19"}).checked,false);
    assert.equal(usage(db,7).remaining,1);
    trigger(db,17,{day:"2026-11-20"});
    assert.equal(money(db),106000);
    assert.equal(usage(db,7).remaining,0);
    trigger(db,17,{day:"2026-11-21"});
    assert.equal(money(db),107000);
    const records=listCharacterEvents(db,1);
    assert.equal(records.length,3);
    assert.deepEqual(records.map(x=>x.title),["書籍版稅","書籍版稅","書籍版稅"]);
    assert.equal(records[0].effects.item,undefined);
    assert.deepEqual(records[1].effects.item,{name:"おばあちゃんの知恵袋",sourceLine:7,remaining:0});
    assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=7")
      .get().raw_fields_json,original);
  }finally{db.close();}
});

test("新增六事件的物品識別、原本使用紀錄與跨玩家資料均安全隔離",()=>{
  const mapping=new Map([
    [17,"おばあちゃんの知恵袋"],[18,"フラフープ"],[19,"谷保天満宮のお守り"],
    [20,"幸せを呼ぶ香水"],[21,"バイアグラ"],[29,"幸せの星砂"]
  ]);
  const db=setup();
  try{
    firstDay(db);
    firstDay(db,2);
    let source=1;
    for(const [id,name] of mapping){
      addItem(db,source,name,{userId:2});
      assert.equal(findEventBonusItem(db,1,name),null);
      assert.equal(findEventBonusItem(db,2,name).sourceLine,source);
      source++;
    }
    const without=trigger(db,18,{choice:0,userId:1});
    assert.equal(without.event.key,"hulaHoopLuck");
    assert.equal(money(db,1),105000);
    const withItem=trigger(db,18,{choice:.99,userId:2});
    assert.equal(withItem.event.key,"hulaHoopLuck");
    assert.equal(money(db,2),177777);
    assert.equal(usage(db,2,2).remaining,1);
    assert.equal(usage(db,2),undefined);
    assert.equal(listCharacterEvents(db,1)[0].effects.item,undefined);
    assert.equal(listCharacterEvents(db,2)[0].effects.item.sourceLine,2);
  }finally{db.close();}
});

test("無效的禮物、日耐久、耗盡物品不能觸發加成；合法『回』才消耗",()=>{
  const db=setup();
  try{
    addItem(db,1,"幸せを呼ぶ香水",{category:"ギフト"});
    addItem(db,2,"幸せを呼ぶ香水",{unit:"日"});
    addItem(db,3,"幸せを呼ぶ香水",{durability:0});
    assert.equal(findEventBonusItem(db,1,"幸せを呼ぶ香水"),null);
    firstDay(db);
    trigger(db,20,{choice:0});
    assert.equal(money(db),200000); // 沒道具仍中原版 +100000
    assert.equal(usage(db,1),undefined);
    assert.equal(usage(db,2),undefined);
    assert.equal(usage(db,3),undefined);
    addItem(db,4,"幸せを呼ぶ香水");
    db.prepare("INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms) VALUES(?,?,?,?)")
      .run(1,4,1,3600000);
    trigger(db,20,{choice:.99,day:"2026-11-20"});
    assert.equal(money(db),400000);
    assert.deepEqual({...usage(db,4)},{remaining:0,last_used_at_ms:3600000});
  }finally{db.close();}
});

test("事件扣道具後若歷史紀錄寫入失敗，能力、現金、耐久與當日標記全部回滾",()=>{
  const db=setup();
  try{
    addItem(db,9,"バイアグラ");
    firstDay(db);
    db.exec("CREATE TRIGGER block_event BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'blocked event'); END;");
    assert.throws(()=>trigger(db,21),/blocked event/);
    assert.equal(stats(db).love,20);
    assert.equal(stats(db).etti,20);
    assert.equal(usage(db,9),undefined);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER block_event;");
    trigger(db,21);
    assert.equal(stats(db).love,23);
    assert.equal(stats(db).etti,23);
    assert.equal(usage(db,9).remaining,1);
  }finally{db.close();}
});

test("現金安全整數溢位不會扣道具或標記已抽，修正角色現金後可以重抽",()=>{
  const db=setup();
  try{
    addItem(db,9,"幸せの星砂");
    firstDay(db);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,29),/安全整數/);
    assert.equal(usage(db,9),undefined);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.prepare("UPDATE characters SET money=40000 WHERE user_id=1").run();
    const fixed=trigger(db,29);
    assert.equal(fixed.event.key,"luckyStarSand");
    assert.equal(money(db),80000);
    assert.equal(usage(db,9).remaining,1);
    assert.equal(listCharacterEvents(db,1).length,1);
  }finally{db.close();}
});
