import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {
  parseOriginalCrafting,initCraftingTables,craftItem,craftingOverview,
  CRAFTING_ITEM_ORIGIN,CRAFTING_STACK_LIMIT
} from "../src/crafting.mjs";

const recipes=parseOriginalCrafting(
  decodeLegacyText(readFileSync(new URL("../../dat_dir/gousei.cgi",import.meta.url)))
);
const goods=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
  .split(/\r?\n/).filter(Boolean).map(line=>{
    const raw=line.split("<>");
    if(raw.length===34&&raw[33]==="")raw.pop();
    return raw;
  }).filter(x=>x.length===33);
const now=Date.parse("2026-11-21T10:00:00Z");
let lineSequence=1000;
function setup({building=true}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,town_id,money) VALUES(1,0,50000),(2,0,10000);"
  ].join(" "));
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]="合成";
  storeTownMap(db,0,{tiles},"web-edited");
  initCraftingTables(db);
  return db;
}
function seed(db,name,amount=1,userId=1,{origin="__web_retail__",category}={}){
  const original=goods.find(x=>x[1]===name&&(!category||x[0]===category));
  if(!original)throw new Error("缺少真實原版材料："+name);
  const raw=[...original];
  raw[21]=String(amount);raw[22]="回";raw[30]=String(Math.floor(now/1000));
  const sourceLine=++lineSequence;
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,origin,sourceLine,raw[0],raw[1],raw[9],amount,
    "回",Math.floor(now/1000),0,JSON.stringify(raw));
  return sourceLine;
}
function remaining(db,line,userId=1){
  const row=db.prepare([
    "SELECT i.durability,u.remaining FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? AND i.source_line=?"
  ].join(" ")).get(userId,line);
  return row?.remaining??row?.durability??null;
}
function make(db,name,quantity=1,id="phase54_craft_0001",userId=1){
  const recipe=recipes.find(r=>r.name===name);
  return craftItem(db,userId,recipes,{
    recipeKey:recipe.key,quantity,requestId:id,now
  });
}
function crafted(db,name){
  return db.prepare(
    "SELECT * FROM legacy_inventory_items WHERE original_id=? AND original_name=?"
  ).get(CRAFTING_ITEM_ORIGIN,name);
}

test("原始 gousei.cgi 確實有 12 種、2～3 材料、真實耐久；特殊冒號不靜默改資料",()=>{
  assert.equal(recipes.length,12);
  assert.equal(new Set(recipes.map(x=>x.name)).size,12);
  assert.equal(recipes.every(x=>x.rawFields.length===33&&x.unit==="回"),true);
  assert.equal(recipes[0].name,"アイスコーヒー");
  assert.equal(recipes[0].durability,1);
  assert.deepEqual(recipes[0].ingredients,[
    {name:"冷蔵庫",quantity:1},{name:"コーヒー",quantity:1}
  ]);
  const cream=recipes.find(x=>x.name==="アイスクリーム");
  assert.equal(cream.sourceAnomaly,true);
  assert.deepEqual(cream.ingredients,[
    {name:"冷蔵庫",quantity:1},{name:"ミルク",quantity:2}
  ]);
  assert.equal(recipes.find(x=>x.name==="健康汁").durability,5);
  assert.equal(recipes.find(x=>x.name==="万能おばちゃんロボット1号").ingredients.length,3);
  assert.equal(CRAFTING_STACK_LIMIT,5);
  assert.throws(()=>parseOriginalCrafting("ドリンク<>亂造品<>"),/33 欄/);
});

test("兩種材料實際扣回數、兩組原版成品入庫，零費用與防重送",()=>{
  const db=setup();
  try{
    const fridge=seed(db,"冷蔵庫",3),coffee=seed(db,"コーヒー",4);
    const originalCash=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const before=craftingOverview(db,1,recipes);
    const product=before.recipes.find(x=>x.name==="アイスコーヒー");
    assert.equal(before.available,true);
    assert.equal(product.maxBatches,3);
    assert.equal(product.ingredients[1].owned,4);
    const made=make(db,"アイスコーヒー",2);
    assert.equal(made.replayed,false);
    assert.equal(made.quantity,2);
    assert.equal(made.addedDurability,2);
    assert.equal(made.fee,0);
    assert.ok(made.sourceLine>=8000000);
    assert.equal(remaining(db,fridge),1);
    assert.equal(remaining(db,coffee),2);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,originalCash);
    assert.equal(crafted(db,"アイスコーヒー").durability,2);
    const raw=JSON.parse(crafted(db,"アイスコーヒー").raw_fields_json);
    assert.equal(raw.length,33);
    assert.equal(raw[1],"アイスコーヒー");
    assert.equal(raw[21],"2");
    assert.equal(raw[30],String(Math.floor(now/1000)));
    assert.equal(make(db,"アイスコーヒー",2).replayed,true);
    assert.equal(remaining(db,fridge),1);
    assert.equal(craftingOverview(db,1,recipes).history.length,1);
    assert.throws(()=>make(db,"アイスコーヒー",1),/相同合成識別碼/);
  }finally{db.close();}
});

test("三種材料、分批多來源扣除與同成品堆疊上限",()=>{
  const db=setup();
  try{
    const pot=seed(db,"ポット",3);
    const a=seed(db,"コーヒー",1),b=seed(db,"コーヒー",2);
    const milk=seed(db,"ミルク",4);
    assert.equal(craftingOverview(db,1,recipes).recipes.find(x=>x.name==="ミルクコーヒー").maxBatches,3);
    const first=make(db,"ミルクコーヒー",2,"phase54_coffee_first");
    assert.equal(first.merged,false);
    assert.equal(remaining(db,pot),1);
    assert.equal(remaining(db,a),0);
    assert.equal(remaining(db,b),1);
    assert.equal(remaining(db,milk),2);
    const second=make(db,"ミルクコーヒー",1,"phase54_coffee_second");
    assert.equal(second.merged,true);
    assert.equal(second.sourceLine,first.sourceLine);
    assert.equal(crafted(db,"ミルクコーヒー").durability,3);
    assert.equal(remaining(db,pot),0);
    assert.throws(()=>make(db,"ミルクコーヒー",1,"phase54_coffee_third"),/不足/);
  }finally{db.close();}
});

test("成品能再作為另一種原版合成的材料，實際消耗先前產出的耐久",()=>{
  const db=setup();
  try{
    seed(db,"冷蔵庫",1);
    seed(db,"ミルク",2);
    const ice=make(db,"アイスクリーム",1,"phase54_ice_001");
    assert.equal(ice.addedDurability,1);
    seed(db,"クロワッサン",1);
    seed(db,"シロップ",1);
    const dessert=make(db,"シロノワール",1,"phase54_shiro_001");
    assert.equal(dessert.addedDurability,1);
    assert.equal(remaining(db,ice.sourceLine),0);
    assert.equal(crafted(db,"シロノワール").category,"ファーストフード");
    assert.equal(crafted(db,"シロノワール").durability,1);
  }finally{db.close();}
});

test("原版成品最多五組，不可用額外堆疊繞過上限",()=>{
  const db=setup();
  try{
    seed(db,"ポット",6);seed(db,"コーヒー",6);
    const first=make(db,"ホットコーヒー",5,"phase54_max_five");
    assert.equal(first.addedDurability,5);
    assert.equal(craftingOverview(db,1,recipes).recipes.find(x=>x.name==="ホットコーヒー").maxBatches,0);
    assert.throws(()=>make(db,"ホットコーヒー",1,"phase54_sixth"),/五份/);
    assert.equal(crafted(db,"ホットコーヒー").durability,5);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM crafting_transactions").get().n,1);
  }finally{db.close();}
});

test("無合成屋、沒有材料、他人材料及不合法輸入一律拒絕",()=>{
  const db=setup({building:false});
  try{
    seed(db,"冷蔵庫",1);seed(db,"コーヒー",1);
    assert.equal(craftingOverview(db,1,recipes).available,false);
    assert.equal(craftingOverview(db,1,recipes).recipes[0].maxBatches,0);
    assert.throws(()=>make(db,"アイスコーヒー"),/沒有原版合成屋/);
    assert.equal(crafted(db,"アイスコーヒー"),undefined);
  }finally{db.close();}
  const own=setup();
  try{
    const fridge=seed(own,"冷蔵庫",1),coffee=seed(own,"コーヒー",1);
    assert.throws(()=>make(own,"アイスコーヒー",1,"phase54_cross_user",2),/不足/);
    assert.equal(remaining(own,fridge),1);
    assert.equal(remaining(own,coffee),1);
    assert.throws(()=>craftItem(own,1,recipes,{recipeKey:"fake",quantity:1,
      requestId:"phase54_invalid_recipe",now}),/不是原版合成配方/);
    assert.throws(()=>make(own,"アイスコーヒー",0,"phase54_invalid_count"),/格式/);
    assert.throws(()=>make(own,"アイスコーヒー",1,"short"),/格式/);
  }finally{own.close();}
});

test("原始物品33欄毀損不得被消耗；成品或交易紀錄失敗須整筆回滾",()=>{
  const db=setup();
  try{
    const fridge=seed(db,"冷蔵庫",1),coffee=seed(db,"コーヒー",1);
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json='[]' WHERE source_line=?").run(coffee);
    assert.throws(()=>make(db,"アイスコーヒー",1,"phase54_bad_source"),/33 欄/);
    assert.equal(remaining(db,fridge),1);
    assert.equal(remaining(db,coffee),1);
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json=? WHERE source_line=?")
      .run(JSON.stringify(goods.find(x=>x[1]==="コーヒー")),coffee);
    // 模擬紀錄寫入失敗：材料扣減與成品入庫不得只完成其中一半。
    db.exec("CREATE TRIGGER stop_craft BEFORE INSERT ON crafting_transactions BEGIN SELECT RAISE(ABORT,'history rejected'); END;");
    assert.throws(()=>make(db,"アイスコーヒー",1,"phase54_rollback"),/history rejected/);
    assert.equal(remaining(db,fridge),1);
    assert.equal(remaining(db,coffee),1);
    assert.equal(crafted(db,"アイスコーヒー"),undefined);
    db.exec("DROP TRIGGER stop_craft");
    assert.equal(make(db,"アイスコーヒー",1,"phase54_rollback").replayed,false);
    assert.equal(remaining(db,fridge),0);
  }finally{db.close();}
});

test("角色刪除後合成交易與本人材料隨外鍵清理，其他玩家不受影響",()=>{
  const db=setup();
  try{
    seed(db,"冷蔵庫",1);
    seed(db,"コーヒー",1);
    seed(db,"ポット",1,2);
    make(db,"アイスコーヒー");
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM crafting_transactions").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items WHERE user_id=1").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items WHERE user_id=2").get().n,1);
  }finally{db.close();}
});
