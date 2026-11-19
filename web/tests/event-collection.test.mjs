import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { resolveNonItemEvent } from "../src/event-effects.mjs";
import { EVENT_REQUIRED_SETS,findEventBonusItem } from "../src/event-item-bonus.mjs";
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
  raw[0]=category;raw[1]=name;raw[9]="無";raw[21]=String(durability);raw[22]=unit;
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
    "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,String(userId),sourceLine,category,name,"無",durability,unit,0,0,JSON.stringify(raw));
}
function start(db,userId=1){
  return settleDailyIllnessEvent(db,userId,"2026-11-18",1000,
    ()=>{throw Error("初次接入不可抽事件");});
}
function trigger(db,id,{choice=0,day="2026-11-19",userId=1}={}){
  const extras=[22,42].includes(id)?[choice]:[];
  return settleDailyIllnessEvent(db,userId,day,100000,rng(0,(id-.5)/44,...extras));
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

test("第 22 號無保險時地震現金取三分之一或運用成功翻倍，有保險時零損失且不額外抽亂數",()=>{
  const quake=resolveNonItemEvent(22,row({money:100001}),rng(0));
  assert.equal(quake.changes.money,33333);
  assert.equal(quake.effects.money,-66668);
  const investment=resolveNonItemEvent(22,row({money:100001}),rng(.99));
  assert.equal(investment.changes.money,200002);
  assert.equal(investment.effects.money,100001);
  const insured=resolveNonItemEvent(22,row(),rng(),"損害保険");
  assert.deepEqual(insured.changes,{});
  assert.equal(insured.usedItemName,"損害保険");
  assert.match(insured.event.description,/全額保障/);
  const broke=resolveNonItemEvent(22,row({money:0}),rng(0));
  assert.equal(broke.changes.money,0);
});

test("第 31 號未持有合格物品固定 +100 元；有可消耗的ミグ25則扣耐久不加錢",()=>{
  const without=resolveNonItemEvent(31,row(),rng());
  assert.equal(without.effects.money,100);
  const withItem=resolveNonItemEvent(31,row(),rng(),"ミグ25");
  assert.equal(withItem.usedItemName,"ミグ25");
  assert.deepEqual(withItem.changes,{});
  assert.deepEqual(withItem.effects,{});
});

test("第 32 號三種收藏品必須全部齊備，否則依原版程式增加五十萬而不是提示的五千",()=>{
  assert.deepEqual(EVENT_REQUIRED_SETS[32],["小さな花束(ラン)","ルパン三世","ファイナルクエスト"]);
  const missing=resolveNonItemEvent(32,row(),rng());
  assert.equal(missing.effects.money,500000);
  assert.equal(missing.changes.money,600000);
  assert.equal(missing.usedItemNames,null);
  const partial=resolveNonItemEvent(32,row(),rng(),["小さな花束(ラン)","ルパン三世"]);
  assert.equal(partial.effects.money,500000);
  const complete=resolveNonItemEvent(32,row(),rng(),[...EVENT_REQUIRED_SETS[32]]);
  assert.equal(complete.effects.money,100000);
  assert.deepEqual(complete.usedItemNames,[...EVENT_REQUIRED_SETS[32]]);
});

test("第 42 號無票時訓練六種身體能力 +10 或損失現金一半",()=>{
  const trained=resolveNonItemEvent(42,row(),rng(0));
  const keys=["tairyoku","kenkou","speed","power","wanryoku","kyakuryoku"];
  assert.deepEqual(Object.keys(trained.effects.stats),keys);
  for(const key of keys)assert.equal(JSON.parse(trained.changes.stats_json)[key],30);
  assert.equal(trained.changes.body_energy,0);
  assert.equal(trained.effects.bodyEnergy,-20);
  const fell=resolveNonItemEvent(42,row({money:101}),rng(.99));
  assert.equal(fell.changes.money,50);
  assert.equal(fell.effects.money,-51);
  assert.equal(fell.changes.stats_json,undefined);
});

test("第 42 號有票時依二分之一機率發生鬥毆或勝利，Web 能量維持非負及現行能力上限",()=>{
  const fight=resolveNonItemEvent(42,row(),rng(0),"阪神タイガースの公式チケット");
  assert.equal(fight.changes.body_energy,0);
  assert.equal(fight.effects.bodyEnergy,-20);
  assert.equal(fight.usedItemName,"阪神タイガースの公式チケット");
  const win=resolveNonItemEvent(42,row(),rng(.99),"阪神タイガースの公式チケット");
  assert.equal(win.changes.brain_energy,35);
  assert.equal(win.effects.brainEnergy,15);
  assert.equal(win.usedItemName,"阪神タイガースの公式チケット");
  const full=resolveNonItemEvent(42,row({brain_energy:35}),rng(.99),"阪神タイガースの公式チケット");
  assert.equal(full.effects.brainEnergy,0);
});

test("第 22 號保險在單一交易中消耗一次、保留封存且寫出沒有金額變化的事件",()=>{
  const db=setup();
  try{
    addItem(db,1,"損害保険");
    start(db);
    const before=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=1")
      .get().raw_fields_json;
    const event=trigger(db,22,{choice:.99});
    assert.equal(event.event.key,"earthquakeInsurance");
    assert.equal(money(db),100000);
    assert.equal(usage(db,1).remaining,1);
    const history=listCharacterEvents(db,1);
    assert.equal(history[0].title,"地震與資產運用");
    assert.deepEqual(history[0].effects.item,{name:"損害保険",sourceLine:1,remaining:1});
    assert.equal(trigger(db,22,{day:"2026-11-19"}).checked,false);
    assert.equal(usage(db,1).remaining,1);
    assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=1")
      .get().raw_fields_json,before);
    trigger(db,22,{day:"2026-11-20"});
    assert.equal(usage(db,1).remaining,0);
    trigger(db,22,{choice:0,day:"2026-11-21"});
    assert.equal(money(db),33333);
  }finally{db.close();}
});

test("第 31 號原始商品表的ミグ25是禮物，不能誤判為加成；非禮物封存才可扣耐久",()=>{
  const db=setup();
  try{
    addItem(db,1,"ミグ25",{category:"ギフト"});
    assert.equal(findEventBonusItem(db,1,"ミグ25"),null);
    start(db);
    trigger(db,31);
    assert.equal(money(db),100100);
    assert.equal(usage(db,1),undefined);
    addItem(db,2,"ミグ25",{category:"乗り物"});
    trigger(db,31,{day:"2026-11-20"});
    assert.equal(money(db),100100);
    assert.equal(usage(db,2).remaining,1);
    assert.equal(listCharacterEvents(db,1)[0].effects.item.sourceLine,2);
  }finally{db.close();}
});

test("第 32 號三件收藏品缺一不可；成功時三種耐久與封存保持一致並防止重抽",()=>{
  const db=setup();
  try{
    const names=EVENT_REQUIRED_SETS[32];
    for(let i=0;i<3;i++)addItem(db,10+i,names[i],{category:["お花","DVD","ゲーム"][i]});
    start(db);
    const original=names.map((_,i)=>db.prepare(
      "SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=?"
    ).get(10+i).raw_fields_json);
    trigger(db,32);
    assert.equal(money(db),200000);
    for(let i=0;i<3;i++){
      assert.equal(usage(db,10+i).remaining,1);
      assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=?")
        .get(10+i).raw_fields_json,original[i]);
    }
    const history=listCharacterEvents(db,1);
    assert.equal(history[0].title,"收藏品檢查");
    assert.deepEqual(history[0].effects.items.map(x=>x.name),names);
    assert.deepEqual(history[0].effects.items.map(x=>x.remaining),[1,1,1]);
    assert.equal(trigger(db,32).checked,false);
    trigger(db,32,{day:"2026-11-20"});
    assert.deepEqual(names.map((_,i)=>usage(db,10+i).remaining),[0,0,0]);
    trigger(db,32,{day:"2026-11-21"});
    assert.equal(money(db),900000); // 前兩次各十萬，第三次無套組 +50 萬
    assert.equal(listCharacterEvents(db,1)[0].effects.items,undefined);
  }finally{db.close();}
});

test("收藏品不能跨帳號湊齊，禮物、日耐久或用盡物品都不能參與套組",()=>{
  const db=setup();
  try{
    const names=EVENT_REQUIRED_SETS[32];
    addItem(db,1,names[0],{userId:1});
    addItem(db,2,names[1],{userId:1});
    addItem(db,3,names[2],{userId:2});
    start(db);start(db,2);
    trigger(db,32);
    trigger(db,32,{userId:2});
    assert.equal(money(db),600000);
    assert.equal(money(db,2),600000);
    assert.equal(usage(db,1),undefined);
    assert.equal(usage(db,3,2),undefined);
    addItem(db,4,names[2],{category:"ギフト"});
    addItem(db,5,names[2],{unit:"日"});
    addItem(db,6,names[2],{durability:0});
    trigger(db,32,{day:"2026-11-20"});
    assert.equal(money(db),1100000);
    assert.equal(usage(db,4),undefined);
    assert.equal(usage(db,5),undefined);
    assert.equal(usage(db,6),undefined);
  }finally{db.close();}
});

test("第 42 號門票抽選更新能量與恢復計時，無票時正常實施能力訓練",()=>{
  const db=setup();
  try{
    addItem(db,7,"阪神タイガースの公式チケット",{category:"関西名産店"});
    start(db);start(db,2);
    trigger(db,42,{choice:.99});
    assert.equal(usage(db,7).remaining,1);
    assert.deepEqual({...db.prepare(
      "SELECT body_energy,brain_energy,recovered_at FROM characters WHERE user_id=1"
    ).get()},{body_energy:20,brain_energy:35,recovered_at:100000});
    assert.equal(listCharacterEvents(db,1)[0].effects.brainEnergy,15);
    trigger(db,42,{choice:0,userId:2});
    assert.equal(stats(db,2).tairyoku,30);
    assert.equal(stats(db,2).kyakuryoku,30);
    assert.equal(usage(db,7,2),undefined);
    assert.equal(db.prepare("SELECT body_energy FROM characters WHERE user_id=2").get().body_energy,0);
  }finally{db.close();}
});

test("三件收藏物耐久寫入後若事件紀錄失敗，三個物品與現金、事件日全部回滾",()=>{
  const db=setup();
  try{
    for(let i=0;i<3;i++)addItem(db,1+i,EVENT_REQUIRED_SETS[32][i]);
    start(db);
    db.exec("CREATE TRIGGER reject_events BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'event rollback'); END;");
    assert.throws(()=>trigger(db,32),/event rollback/);
    assert.equal(money(db),100000);
    for(let i=1;i<=3;i++)assert.equal(usage(db,i),undefined);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER reject_events");
    trigger(db,32);
    assert.equal(money(db),200000);
    assert.deepEqual([1,2,3].map(i=>usage(db,i).remaining),[1,1,1]);
  }finally{db.close();}
});

test("第 22 號翻倍金額溢位不會完成抽選，修正角色存款後可以重試",()=>{
  const db=setup();
  try{
    start(db);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,22,{choice:.99}),/安全整數/);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    assert.equal(listCharacterEvents(db,1).length,0);
    db.prepare("UPDATE characters SET money=1 WHERE user_id=1").run();
    trigger(db,22,{choice:.99});
    assert.equal(money(db),2);
  }finally{db.close();}
});
