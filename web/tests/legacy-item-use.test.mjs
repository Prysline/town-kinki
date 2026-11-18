import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {STAT_KEYS} from "../src/engine.mjs";
import {
  initLegacyItemUseTables,listLegacyItemActions,listLegacyItemUseHistory,useLegacyItem
} from "../src/legacy-item-use.mjs";

const NOW=1_700_000_000_000;
const stats=()=>Object.fromEntries(STAT_KEYS.map(key=>[key,20]));
function archived({
  category="薬",name="風邪薬",effect="風邪,10",durability=3,
  unit="回",interval=30,bodyCost=0,brainCost=0,calories=0,
  lastUsed=0,bonuses={},purchasedAt=1690000000
}={}){
  const fields=Array(33).fill("");
  fields[0]=category;fields[1]=name;fields[9]=effect;
  for(const [key,i] of STAT_KEYS.map((key,i)=>[key,[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20][i]]))
    fields[i]=String(bonuses[key]??0);
  fields[17]="1500";fields[21]=String(durability);fields[22]=unit;
  fields[23]=String(interval);fields[25]=String(calories);fields[26]=String(lastUsed);
  fields[27]=String(bodyCost);fields[28]=String(brainCost);
  fields[30]=String(purchasedAt);
  return fields;
}
function createDb(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "name TEXT NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,",
    "stats_json TEXT NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,",
    "recovered_at INTEGER NOT NULL,health_index INTEGER NOT NULL,weight REAL NOT NULL,",
    "height INTEGER NOT NULL,bmi REAL NOT NULL,last_meal_at INTEGER NOT NULL);",
    "INSERT INTO users(id,username) VALUES(1,'owner'),(2,'other');"
  ].join("\n"));
  const stmt=db.prepare([
    "INSERT INTO characters(user_id,name,money,bank,stats_json,body_energy,brain_energy,",
    "recovered_at,health_index,weight,height,bmi,last_meal_at)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" "));
  for(const [id,name] of [[1,"甲"],[2,"乙"]])
    stmt.run(id,name,100000,50000,JSON.stringify(stats()),25,35,
      NOW,-13,60,165,22,0);
  initLegacyItemUseTables(db);
  return db;
}
function addItem(db,sourceLine,fields,userId=1){
  const stmt=db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" "));
  stmt.run(userId,"00042",sourceLine,fields[0],fields[1],fields[9],
    Number(fields[21]),fields[22],Number(fields[30])||null,Number(fields[26])||0,
    JSON.stringify(fields));
}
function read(db,id=1){
  const row=db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);
  return {...row,stats:JSON.parse(row.stats_json)};
}
const use=(db,line,requestId="olditem-0001",now=NOW,userId=1)=>
  useLegacyItem(db,userId,line,requestId,now);

test("只允許原版 33 欄與可確定的「回」耐久效果，特殊道具仍為唯讀",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived());
    addItem(db,2,archived({name:"おばあちゃんの知恵薬",
      effect:"万能,20"}));
    addItem(db,3,archived({name:"ランダム品",effect:"無"}));
    addItem(db,4,archived({name:"健康保険",unit:"日"}));
    addItem(db,5,archived({name:"ギフト",category:"ギフト",effect:"無"}));
    addItem(db,6,archived({name:"基本薬",effect:"無",durability:0}));
    const available=listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW);
    assert.deepEqual(available.map(x=>x.sourceLine),[1,6]);
    assert.equal(available[0].canUse,true);
    assert.equal(available[1].canUse,false);
    assert.match(available[1].reason,/用盡/);
    for(const line of [2,3,4,5])
      assert.throws(()=>use(db,line,"blocked-"+line+"-01"),/尚未支援/);
    assert.equal(listLegacyItemUseHistory(db,1).length,0);
  }finally{db.close();}
});

test("感冒藥依原版只在風邪分類增加疾病指數，扣除使用次數並保存獨立歷史",()=>{
  const db=createDb();
  try{
    const original=archived({bodyCost:2,brainCost:3,bonuses:{kenkou:1}});
    addItem(db,1,original);
    const first=use(db,1);
    assert.equal(first.replayed,false);
    assert.equal(first.changes.healthIndex,10);
    assert.equal(first.changes.stats.kenkou,1);
    assert.equal(first.changes.bodyEnergy,-2);
    assert.equal(first.changes.brainEnergy,-3);
    assert.equal(read(db).health_index,-3);
    assert.equal(read(db).stats.kenkou,21);
    assert.equal(read(db).body_energy,23);
    assert.equal(read(db).brain_energy,32);
    assert.equal(read(db).money,100000);
    assert.equal(read(db).bank,50000);
    assert.equal(db.prepare("SELECT remaining,last_used_at_ms FROM legacy_item_usage").get().remaining,2);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.equal(listLegacyItemUseHistory(db,2).length,0);
    const saved=db.prepare("SELECT raw_fields_json,durability FROM legacy_inventory_items WHERE user_id=1 AND source_line=1").get();
    assert.equal(saved.durability,3);
    assert.deepEqual(JSON.parse(saved.raw_fields_json),original);
    assert.throws(()=>use(db,1,"olditem-0002",NOW+1),/間隔/);
    const second=use(db,1,"olditem-0002",NOW+30*60000);
    assert.equal(second.changes.healthIndex,10);
    assert.equal(read(db).health_index,7);
    const third=use(db,1,"olditem-0003",NOW+60*60000);
    assert.equal(third.changes.healthIndex,0);
    assert.equal(read(db).health_index,7);
    assert.equal(listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW+60*60000)[0].remaining,0);
    assert.throws(()=>use(db,1,"olditem-0004",NOW+90*60000),/用盡/);
    assert.equal(listLegacyItemUseHistory(db,1).length,3);
  }finally{db.close();}
});

test("網路回覆遺失時同一請求重送不重複套用效果，也不能改用其他道具",()=>{
  const db=createDb();
  try {
    addItem(db,1,archived({effect:"無",interval:0,bonuses:{kokugo:3}}));
    addItem(db,2,archived({effect:"無",interval:0,bonuses:{suugaku:3}}));
    const first=use(db,1,"repeat-old-item-1");
    assert.equal(read(db).stats.kokugo,23);
    const repeat=use(db,1,"repeat-old-item-1",NOW+DAY);
    assert.equal(repeat.replayed,true);
    assert.deepEqual(repeat.changes,first.changes);
    assert.equal(read(db).stats.kokugo,23);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.throws(()=>use(db,2,"repeat-old-item-1"),/相同請求/);
  }finally{db.close();}
});
const DAY=86400000;

test("食品與食堂共用 60 分鐘用餐間隔，增加熱量、能力及體重",()=>{
  const db=createDb();
  try {
    addItem(db,1,archived({category:"食料品",name:"頭脳パン",effect:"無",
      durability:2,interval:0,calories:800,bonuses:{kokugo:3,tairyoku:1}}));
    const first=use(db,1,"food-old-0001");
    assert.equal(first.changes.food,true);
    assert.equal(read(db).last_meal_at,NOW);
    assert.equal(read(db).weight,60.8);
    assert.equal(read(db).stats.kokugo,23);
    assert.equal(read(db).stats.tairyoku,21);
    assert.throws(()=>use(db,1,"food-old-0002",NOW+59000),/60 分鐘/);
    const second=use(db,1,"food-old-0002",NOW+3600000);
    assert.equal(second.changes.food,true);
    assert.equal(read(db).weight,61.6);
    assert.equal(read(db).last_meal_at,NOW+3600000);
    assert.equal(listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:NOW+3600000
    },NOW+3600000)[0].remaining,0);
  }finally{db.close();}
});

test("腹瀉、肺炎及結核效果只有對應病症時作用，其他疾病不會憑空治療",()=>{
  const effects=[["下痢,18",-17],["肺炎,20",-21],["結核,40",-41]];
  for(const [effect,index] of effects){
    const db=createDb();
    try {
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=1").run(index);
      addItem(db,1,archived({effect,interval:0}));
      const first=use(db,1,"disease-item-01");
      assert.ok(first.changes.healthIndex>0);
      const after=read(db).health_index;
      assert.equal(after,index+Number(effect.split(",")[1]));
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=1").run(-13);
      const second=use(db,1,"disease-item-02",NOW+1);
      assert.equal(second.changes.healthIndex,0);
      assert.equal(read(db).health_index,-13);
    }finally{db.close();}
  }
});

test("身高、增重、減重與原始 17 種能力均能一致更新 BMI",()=>{
  for(const [effect,weight,height] of [
    ["ウエイトアップ,2",62,165],
    ["ダイエット,2",58,165],
    ["身長,1",60,166],
    ["縮み,1",60,164]
  ]){
    const db=createDb();
    try{
      addItem(db,1,archived({effect,interval:0}));
      const result=use(db,1,"change-body-01");
      assert.equal(read(db).weight,weight);
      assert.equal(read(db).height,height);
      assert.equal(read(db).bmi,Math.round(weight/((height/100)**2)*10)/10);
      assert.equal(result.changes.weight,weight-60);
    }finally{db.close();}
  }
});

test("不足的身體／頭腦能量、原版冷卻時間、無效行號及其他帳號物品均拒絕並回滾",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:30,bodyCost:100}));
    addItem(db,2,archived({effect:"無",interval:30,brainCost:100}));
    addItem(db,3,archived({effect:"無",interval:10,
      lastUsed:Math.floor(NOW/1000)-60}));
    addItem(db,4,archived({effect:"無",interval:0,bonuses:{kokugo:5}}),2);
    assert.throws(()=>use(db,1,"energy-body-01"),/能量不足/);
    assert.throws(()=>use(db,2,"energy-brain-01"),/能量不足/);
    assert.throws(()=>use(db,3,"orig-cooldown-01"),/間隔/);
    assert.throws(()=>use(db,4,"other-player-01"),/找不到本人/);
    assert.throws(()=>use(db,999,"bad-line-0001"),/找不到本人/);
    assert.throws(()=>use(db,1,"x"),/識別碼/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,0);
    assert.equal(read(db).stats.kokugo,20);
    assert.equal(read(db,2).stats.kokugo,20);
  }finally{db.close();}
});

test("能力溢位、封存原始欄位變造會整筆拒絕且耐久不減",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:0,bonuses:{kokugo:1000}}));
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=1")
      .run(JSON.stringify({...stats(),kokugo:Number.MAX_SAFE_INTEGER}));
    assert.throws(()=>use(db,1,"overflow-item-01"),/安全範圍/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=1")
      .run(JSON.stringify(stats()));
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json='[]' WHERE user_id=1 AND source_line=1").run();
    assert.throws(()=>use(db,1,"overflow-item-01"),/封存物品/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,0);
  }finally{db.close();}
});

test("建立道具使用資料表後重複初始化不會刪除既有封存或使用歷史",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:0}));
    use(db,1,"first-version-01");
    initLegacyItemUseTables(db);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,2);
  }finally{db.close();}
});
