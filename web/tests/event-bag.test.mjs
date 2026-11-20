import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { maxBodyEnergy,maxBrainEnergy } from "../src/engine.mjs";
import { resolveNonItemEvent,NON_ITEM_EVENT_IDS } from "../src/event-effects.mjs";
import { EVENT_BONUS_ITEMS,findEventBonusItem } from "../src/event-item-bonus.mjs";
import { initLegacyItemUseTables } from "../src/legacy-item-use.mjs";
import {
  initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents,getCouponBalance
} from "../src/events.mjs";

const STAT_KEYS=["kokugo","suugaku","rika","syakai","eigo","ongaku",
  "bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku",
  "love","unique","etti"];
const STATS=Object.fromEntries(STAT_KEYS.map(name=>[name,20]));
const ITEM_NAME="４次元福袋";
const chosenId=(35-.5)/44;

function sequence(...values){
  let i=0;
  return ()=>{if(i>=values.length)throw Error("不應額外抽亂數");return values[i++];};
}
function character(overrides={}){
  return {money:100000,weight:60,height:165,bmi:22,body_energy:10,brain_energy:10,
    job_experience:60,recovered_at:1000,stats_json:JSON.stringify(STATS),...overrides};
}
function dbForEvents(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),",
    "health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',",
    "money INTEGER NOT NULL DEFAULT 100000,weight REAL NOT NULL DEFAULT 60,",
    "height INTEGER NOT NULL DEFAULT 165,bmi REAL NOT NULL DEFAULT 22,",
    "body_energy INTEGER NOT NULL DEFAULT 10,brain_energy INTEGER NOT NULL DEFAULT 10,",
    "job_experience INTEGER NOT NULL DEFAULT 60,recovered_at INTEGER NOT NULL DEFAULT 1000,",
    "stats_json TEXT NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  for(const id of [1,2])
    db.prepare("INSERT INTO characters(user_id,stats_json) VALUES(?,?)")
      .run(id,JSON.stringify(STATS));
  initCharacterEvents(db);
  initLegacyItemUseTables(db);
  return db;
}
function addItem(db,{userId=1,line=1,name=ITEM_NAME,category="プレゼント",durability=4,unit="回",broken=false}={}){
  const fields=Array(33).fill("0");
  fields[0]=category;fields[1]=broken?"錯誤物品名稱":name;
  fields[9]="無";fields[21]=String(durability);fields[22]=unit;
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
    "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,String(userId),line,category,name,"無",durability,unit,0,0,JSON.stringify(fields));
}
function usage(db,line=1,userId=1){
  return db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=? AND source_line=?")
    .get(userId,line)?.remaining;
}
function initial(db,userId=1){
  return settleDailyIllnessEvent(db,userId,"2026-11-18",1000,()=>{
    throw Error("新功能初次啟動不可補抽事件");
  });
}
function trigger(db,{userId=1,day="2026-11-19",choice=0,extra=[]}={}){
  return settleDailyIllnessEvent(db,userId,day,100000,
    sequence(0,chosenId,choice,...extra));
}

test("事件 #35 來源：原版福袋確有此物，並先抽 1..4；第四個結果沒有獎勵",()=>{
  const event=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
  const itemFile=readFileSync(new URL("../../dat_dir/prezento.cgi",import.meta.url),"utf8");
  const block=event.slice(event.indexOf("if ($event_rand == 35)"),event.indexOf("if ($event_rand == 36)"));
  assert.match(block,/int\(rand\(4\)\)\+1/);
  assert.match(block,/motimono_kensa_ev2\("４次元福袋"\)/);
  assert.match(block,/money \+= 100000000/);
  assert.match(block,/energy \+= 10000/);
  assert.match(block,/coupon_get\(\$my_rand2\)/);
  assert.match(block,/int\(rand\(15\)\)\+1/);
  assert.doesNotMatch(block,/\$myranded == 4/);
  assert.match(block,/\$money-10000/);
  assert.match(itemFile,/プレゼント<>４次元福袋<>[^\n]+<>10<>回<>/);
  assert.equal(EVENT_BONUS_ITEMS[35],ITEM_NAME);
  assert.ok(NON_ITEM_EVENT_IDS.includes(35));
});

test("福袋四種結果：一億元、能量+10000（限上限）、1至15張券、第四種無獎勵",()=>{
  const money=resolveNonItemEvent(35,character(),sequence(0),ITEM_NAME);
  assert.equal(money.event.key,"fourDimensionalBag");
  assert.equal(money.effects.money,100000000);
  assert.equal(money.changes.money,100100000);
  assert.equal(money.usedItemName,ITEM_NAME);
  const energy=resolveNonItemEvent(35,character(),sequence(.3),ITEM_NAME);
  assert.equal(energy.changes.body_energy,maxBodyEnergy(STATS));
  assert.equal(energy.changes.brain_energy,maxBrainEnergy(STATS));
  assert.equal(energy.effects.bodyEnergy,maxBodyEnergy(STATS)-10);
  assert.equal(energy.effects.brainEnergy,maxBrainEnergy(STATS)-10);
  assert.equal(energy.usedItemName,ITEM_NAME);
  for(let i=0;i<15;i++){
    const coupons=resolveNonItemEvent(35,character(),sequence(.51,(i+.5)/15),ITEM_NAME);
    assert.equal(coupons.couponAward,i+1);
    assert.equal(coupons.effects.coupons,i+1);
    assert.deepEqual(coupons.changes,{});
    assert.equal(coupons.usedItemName,ITEM_NAME);
  }
  const fourth=resolveNonItemEvent(35,character(),sequence(.99),ITEM_NAME);
  assert.equal(fourth.couponAward,null);
  assert.equal(fourth.usedItemName,ITEM_NAME,"第四種無獎勵，仍已檢查消耗福袋一次");
  assert.deepEqual(fourth.effects,{});
  assert.deepEqual(fourth.changes,{});
  assert.match(fourth.event.description,/沒有開出獎勵/);
});

test("無有效福袋時固定罰款一萬，金額不會降到負數且不假裝有福袋",()=>{
  const noBag=resolveNonItemEvent(35,character(),sequence(.99));
  assert.equal(noBag.changes.money,90000);
  assert.equal(noBag.effects.money,-10000);
  assert.equal(noBag.usedItemName,null);
  assert.equal(noBag.couponAward,null);
  const low=resolveNonItemEvent(35,character({money:200}),sequence(0));
  assert.equal(low.changes.money,0);
  assert.equal(low.effects.money,-200);
});

test("福袋耐久、現金、優惠券與歷史可跨日累積；無物品的其他玩家不會受影響",()=>{
  const db=dbForEvents();
  try{
    addItem(db,{durability:3});
    addItem(db,{userId:2,line:8,category:"ギフト"});
    assert.equal(findEventBonusItem(db,2,ITEM_NAME),null,"原作不接受禮物分類");
    initial(db,1);initial(db,2);
    const before=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=1").get().raw_fields_json;
    const awarded=trigger(db,{choice:.51,extra:[.99]});
    assert.equal(awarded.event.key,"fourDimensionalBag");
    assert.equal(getCouponBalance(db,1),15);
    assert.equal(usage(db),2);
    assert.equal(usage(db,8,2),undefined);
    assert.equal(trigger(db,{choice:.51,extra:[.99]}).checked,false,"同日不可重抽");
    trigger(db,{day:"2026-11-20",choice:0});
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,100100000);
    assert.equal(usage(db),1);
    trigger(db,{day:"2026-11-21",choice:.99});
    assert.equal(usage(db),0,"第四種無獎勵也要扣福袋耐久");
    assert.equal(getCouponBalance(db,1),15);
    trigger(db,{day:"2026-11-22",choice:0});
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,100090000);
    assert.equal(usage(db),0);
    const other=trigger(db,{userId:2,choice:.99});
    assert.equal(other.event.key,"fourDimensionalBag");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,90000);
    assert.equal(getCouponBalance(db,2),0);
    assert.equal(usage(db,8,2),undefined);
    const events=listCharacterEvents(db,1);
    assert.deepEqual(events.map(x=>x.originalId),[35,35,35,35]);
    assert.equal(events[0].title,"四次元福袋");
    assert.equal(events[0].effects.money,-10000);
    assert.equal(events[1].effects.item.remaining,0);
    assert.equal(events[2].effects.money,100000000);
    assert.equal(events[3].effects.coupons,15);
    assert.equal(events[3].effects.item.sourceLine,1);
    assert.equal(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 AND source_line=1").get().raw_fields_json,before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db.close();}
});

test("沒有有效物品：日耐久、禮物類、損毀封存、零耐久都不能觸發獎勵",()=>{
  const db=dbForEvents();
  try{
    addItem(db,{line:1,category:"ギフト"});
    addItem(db,{line:2,unit:"日"});
    addItem(db,{line:3,broken:true});
    addItem(db,{line:4,durability:0});
    assert.equal(findEventBonusItem(db,1,ITEM_NAME),null);
    initial(db);
    trigger(db,{choice:.51,extra:[]});
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,90000);
    assert.equal(getCouponBalance(db,1),0);
    for(const i of [1,2,3,4])assert.equal(usage(db,i),undefined);
  }finally{db.close();}
});

test("交易失敗：寫入事件歷史錯誤會回滾福袋耐久、優惠券與當日抽選標記",()=>{
  const db=dbForEvents();
  try{
    addItem(db);
    initial(db);
    db.exec("CREATE TRIGGER fail_bag BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'blocked event'); END;");
    assert.throws(()=>trigger(db,{choice:.51,extra:[.7]}),/blocked event/);
    assert.equal(usage(db),undefined);
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(listCharacterEvents(db,1).length,0);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER fail_bag");
    trigger(db,{choice:.51,extra:[.7]});
    assert.equal(getCouponBalance(db,1),11);
    assert.equal(usage(db),3);
  }finally{db.close();}
});

test("極端數值：現金與優惠券溢位時不消耗道具、不寫事件，修復後仍能抽選",()=>{
  const db=dbForEvents();
  try{
    addItem(db);
    initial(db);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER-1);
    assert.throws(()=>trigger(db,{choice:0}),/安全整數/);
    assert.equal(usage(db),undefined);
    assert.equal(listCharacterEvents(db,1).length,0);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.prepare("UPDATE characters SET money=100000 WHERE user_id=1").run();
    db.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)").run(1,Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,{choice:.51,extra:[.99]}),/安全整數/);
    assert.equal(usage(db),undefined);
    assert.equal(getCouponBalance(db,1),Number.MAX_SAFE_INTEGER);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.prepare("UPDATE character_coupons SET quantity=0 WHERE user_id=1").run();
    trigger(db,{choice:.51,extra:[.99]});
    assert.equal(getCouponBalance(db,1),15);
    assert.equal(usage(db),3);
  }finally{db.close();}
});
