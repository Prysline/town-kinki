import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText,STAT_KEYS} from "../src/engine.mjs";
import {parseLegacyRetailCatalog} from "../src/retail.mjs";
import {
  initLegacyItemUseTables,listLegacyItemActions,
  useLegacyItem,listLegacyItemUseHistory,supportsLegacyItemUse
} from "../src/legacy-item-use.mjs";
import {initGiftTables,convertToGift,sendGift} from "../src/gift-shop.mjs";

const NOW=Date.parse("2026-11-21T09:00:00Z");
const catalog=parseLegacyRetailCatalog(decodeLegacyText(
  readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))
));
const originalBasic=decodeLegacyText(
  readFileSync(new URL("../../basic.cgi",import.meta.url))
);
const originalGift=decodeLegacyText(
  readFileSync(new URL("../../gifutoya.cgi",import.meta.url))
);
const originalSend=decodeLegacyText(
  readFileSync(new URL("../../command.pl",import.meta.url))
);
const stats=()=>Object.fromEntries(STAT_KEYS.map(k=>[k,20]));
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "name TEXT NOT NULL UNIQUE,town_id INTEGER NOT NULL,money INTEGER NOT NULL,",
    "bank INTEGER NOT NULL,stats_json TEXT NOT NULL,body_energy INTEGER NOT NULL,",
    "brain_energy INTEGER NOT NULL,recovered_at INTEGER NOT NULL,",
    "health_index INTEGER NOT NULL,weight REAL NOT NULL,height INTEGER NOT NULL,",
    "bmi REAL NOT NULL,last_meal_at INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  const add=db.prepare([
    "INSERT INTO characters(user_id,name,town_id,money,bank,stats_json,",
    "body_energy,brain_energy,recovered_at,health_index,weight,height,bmi,last_meal_at)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" "));
  for(const [id,name] of [[1,"甲"],[2,"乙"]])
    add.run(id,name,0,400000,0,JSON.stringify(stats()),25,35,NOW,-13,60,165,22,0);
  initLegacyItemUseTables(db);
  initGiftTables(db);
  return db;
}
function seed(db,name,sourceLine,{category}={}){
  const item=catalog.find(x=>x.name===name);
  assert.ok(item,"原版產品應存在："+name);
  const fields=[...item.rawFields];
  fields[0]=category??item.category;
  fields[30]=String(Math.floor(NOW/1000));
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
    "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(1,'__web_retail__',?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(sourceLine,fields[0],fields[1],fields[9],
    Number(fields[21]),fields[22],Number(fields[30]),0,JSON.stringify(fields));
  return fields;
}
function row(db,userId,line){
  return db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=? AND source_line=?")
    .get(userId,line);
}
function actions(db,time=NOW){
  const c=db.prepare("SELECT * FROM characters WHERE user_id=2").get();
  return listLegacyItemActions(db,2,{
    bodyEnergy:c.body_energy,brainEnergy:c.brain_energy,
    lastMealAt:c.last_meal_at
  },time);
}
function convertedAndSent(db,sourceLine,tag){
  const gift=convertToGift(db,1,{
    sourceLine,quantity:0,requestId:"convert_food_"+tag,
    now:NOW,hasBuilding:()=>true
  });
  assert.equal(row(db,1,gift.giftSourceLine).category,"ギフト");
  const sent=sendGift(db,1,{
    sourceLine:gift.giftSourceLine,quantity:gift.moved,
    recipientName:"乙",requestId:"send_food_"+tag,now:NOW
  });
  return sent.giftSourceLine;
}
test("原版 gifutoya 與基本持有物流程確實將受贈食品、速食轉回可食類型",()=>{
  assert.match(originalGift,/\$syo_kouka \.= ",食料品"/);
  assert.match(originalGift,/\$syo_kouka \.= ",ファ"/);
  assert.match(originalSend,/\$syo_syubetu = "ギフト商品"/);
  assert.match(originalBasic,/\$kuka_basyo =~ \/食料品\//);
  assert.match(originalBasic,/\$kuka_basyo =~ \/ファ\//);
  assert.match(originalBasic,/\$syo_syubetu = "ファーストフード"/);
  assert.match(originalBasic,/\$last_syokuzi = \$now_time/);
});
test("真的轉換與寄出原版牛丼弁当後，受贈者可食用並啟動 60 分鐘用餐冷卻",()=>{
  const db=fixture();
  try{
    const input=seed(db,"牛丼弁当",1000001);
    assert.equal(input[0],"食料品");
    assert.equal(input[9],"無");
    const received=convertedAndSent(db,1000001,"bento");
    const receipt=row(db,2,received);
    const beforeRaw=receipt.raw_fields_json;
    assert.equal(receipt.category,"ギフト商品");
    assert.equal(receipt.effect,"食料品");
    assert.equal(receipt.durability,1);
    assert.equal(actions(db).find(x=>x.sourceLine===received).food,true);
    const used=useLegacyItem(db,2,received,"food_gift_bento_use",NOW);
    assert.equal(used.changes.food,true);
    assert.equal(used.changes.weight,.72);
    const c=db.prepare("SELECT weight,last_meal_at FROM characters WHERE user_id=2").get();
    assert.equal(c.weight,60.72);
    assert.equal(c.last_meal_at,NOW);
    assert.equal(row(db,2,received).raw_fields_json,beforeRaw);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=2 AND source_line=?")
      .get(received).remaining,0);
    assert.equal(useLegacyItem(db,2,received,"food_gift_bento_use",NOW+1).replayed,true);
    assert.equal(listLegacyItemUseHistory(db,2).length,1);
    assert.equal(row(db,1,1000001),undefined);
  }finally{db.close();}
});
test("受贈複合效果食品與速食保留身高／熱量效果、用餐冷卻與各自單件間隔",()=>{
  const db=fixture();
  try{
    seed(db,"チヂミ",1000002);
    seed(db,"特級幻バーガー",1000003);
    const chijimi=convertedAndSent(db,1000002,"chijimi");
    const burger=convertedAndSent(db,1000003,"burger");
    assert.equal(row(db,2,chijimi).effect,"縮み,1,食料品");
    assert.equal(row(db,2,burger).effect,"ファ");
    assert.equal(actions(db).find(x=>x.sourceLine===chijimi).food,true);
    assert.equal(actions(db).find(x=>x.sourceLine===burger).food,true);
    const first=useLegacyItem(db,2,chijimi,"food_gift_chijimi_use",NOW);
    assert.equal(first.changes.food,true);
    assert.equal(first.changes.height,-1);
    assert.equal(first.changes.weight,.3);
    assert.equal(db.prepare("SELECT height FROM characters WHERE user_id=2").get().height,164);
    const next=actions(db,NOW+10*60000).find(x=>x.sourceLine===burger);
    assert.equal(next.canUse,false);
    assert.match(next.reason,/60 分鐘/);
    assert.throws(()=>useLegacyItem(db,2,burger,
      "food_gift_burger_early",NOW+10*60000),/60 分鐘/);
    assert.equal(row(db,2,burger).durability,1);
    const second=useLegacyItem(db,2,burger,"food_gift_burger_use",NOW+60*60000);
    assert.equal(second.changes.food,true);
    assert.equal(second.changes.weight,.8);
    assert.equal(db.prepare("SELECT weight FROM characters WHERE user_id=2").get().weight,61.1);
    assert.equal(db.prepare("SELECT last_meal_at FROM characters WHERE user_id=2").get().last_meal_at,NOW+60*60000);
    assert.equal(listLegacyItemUseHistory(db,2).length,2);
  }finally{db.close();}
});
test("原版含ギフト字尾的非食品仍按特殊效果使用，不能被誤判為餐點",()=>{
  const db=fixture();
  try{
    const original=seed(db,"どすこいスーパープレゼント",1000004,{category:"ギフト"});
    assert.equal(original[9],"ウエイトアップ,1,ギフト");
    const sent=sendGift(db,1,{
      sourceLine:1000004,quantity:1,recipientName:"乙",
      requestId:"send_special_nonfood",now:NOW
    });
    const received=sent.giftSourceLine;
    assert.equal(row(db,2,received).effect,"ウエイトアップ,1");
    assert.equal(actions(db).find(x=>x.sourceLine===received).food,false);
    const result=useLegacyItem(db,2,received,"use_special_nonfood",NOW);
    assert.equal(result.changes.food,false);
    assert.equal(result.changes.weight,2.5);
    assert.equal(db.prepare("SELECT last_meal_at FROM characters WHERE user_id=2").get().last_meal_at,0);
  }finally{db.close();}
});
test("食物標記只能透過原版受贈分類；普通ギフト與畸形效果保持不可使用",()=>{
  const f=seedRaw=>{
    const raw=Array(33).fill("0");
    raw[0]=seedRaw.category;
    raw[1]="來源邊界測試食品";
    raw[9]=seedRaw.effect;
    raw[21]="1";raw[22]="回";raw[23]="0";
    return raw;
  };
  assert.equal(supportsLegacyItemUse(f({category:"ギフト商品",effect:"食料品"})),true);
  assert.equal(supportsLegacyItemUse(f({category:"ギフト商品",effect:"ファ"})),true);
  assert.equal(supportsLegacyItemUse(f({category:"ギフト商品",effect:"縮み,1,食料品"})),true);
  for(const [category,effect] of [
    ["ギフト","食料品"],["薬","食料品"],
    ["ギフト商品","食料品,2"],["ギフト商品","ウエイトアップ,2,未知"],
    ["ギフト商品","ウエイトアップ,-2,食料品"],["ギフト商品","無,ギフト"]
  ])assert.equal(supportsLegacyItemUse(f({category,effect})),false,
    "不應推定非法來源組合："+category+"/"+effect);
});
