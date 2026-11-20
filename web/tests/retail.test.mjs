import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initLegacyItemUseTables,listLegacyItemActions} from "../src/legacy-item-use.mjs";
import {parseLegacyRetailCatalog,initRetailTables,ensureRetailDay,listRetailStock,buyRetailItem,listRetailPurchases} from "../src/retail.mjs";
const original=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const script=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
const catalog=parseLegacyRetailCatalog(original);
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters (user_id INTEGER PRIMARY KEY REFERENCES users(id),money INTEGER NOT NULL,town_id INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,money,town_id) VALUES(1,9999999,0),(2,9999999,0);"
  ].join(" "));
  initLegacyItemUseTables(db);initRetailTables(db);
  return db;
}
const now=1760000000000,day="2026-10-09";
const randomIndex=()=>0;
const options=(shop,sku,requestId)=>({shop,sku,requestId,now,day,hasBuilding:()=>true});
test("原版兩間百貨同日上架，單價三倍，最多各 110 件，並非食堂商品",()=>{
  assert.match(script,/sub depart_gamen\s*\{/);
  assert.match(script,/sub buy_syouhin\s*\{/);
  assert.match(script,/\$syo_nedan \*= 3/);
  assert.ok(catalog.length>=110);
  for(const item of catalog){
    assert.equal(item.unitPrice,item.basePrice*3);
    assert.equal(item.rawFields.length,33);
    assert.notEqual(item.category,"食");
  }
  const db=fixture();try{
    assert.equal(ensureRetailDay(db,catalog,day,randomIndex),true);
    assert.equal(ensureRetailDay(db,catalog,day,randomIndex),false);
    const stock=listRetailStock(db,catalog,["depart1","depart2"]);
    assert.equal(stock.filter(x=>x.shop==="depart1").length,110);
    assert.equal(stock.filter(x=>x.shop==="depart2").length,110);
    assert.ok(stock.every(x=>x.stock>=1));
    assert.equal(listRetailStock(db,catalog,[]).length,0);
  }finally{db.close();}
});
test("本人現金購物、共用扣庫存與 33 欄持有物同筆儲存；重送不能扣第二次",()=>{
  const db=fixture();try{
    ensureRetailDay(db,catalog,day,randomIndex);
    const first=listRetailStock(db,catalog,["depart1"]).find(x=>x.price<=100000);
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const requestId="shop_dept_000001";
    const receipt=buyRetailItem(db,1,catalog,options("depart1",first.sku,requestId));
    assert.equal(receipt.paid,first.price);
    assert.equal(receipt.replayed,false);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before-first.price);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,9999999);
    const purchased=db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=1 AND source_line=?").get(receipt.sourceLine);
    assert.equal(purchased.original_name,first.name);
    assert.equal(JSON.parse(purchased.raw_fields_json).length,33);
    assert.equal(listRetailStock(db,catalog,["depart1"]).find(x=>x.sku===first.sku).stock,first.stock-1);
    const replay=buyRetailItem(db,1,catalog,options("depart1",first.sku,requestId));
    assert.equal(replay.replayed,true);
    assert.equal(replay.sourceLine,receipt.sourceLine);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before-first.price);
    assert.equal(listRetailPurchases(db,1)[0].name,first.name);
    assert.equal(listRetailPurchases(db,2).length,0);
    assert.throws(()=>buyRetailItem(db,1,catalog,options("depart2",first.sku,requestId)),/不同商品/);
  }finally{db.close();}
});
test("沒有實體百貨、商品未上架、現金不足、無效序號均拒絕且不改動資產",()=>{
  const db=fixture();try{
    ensureRetailDay(db,catalog,day,randomIndex);
    const listed=listRetailStock(db,catalog,["depart1"]);
    const shop=listed[0];
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.throws(()=>buyRetailItem(db,1,catalog,{...options("depart1",shop.sku,"shop_no_building"),hasBuilding:()=>false}),/沒有這間百貨店/);
    const unlisted=catalog.find(x=>!listed.some(s=>s.sku===x.sku));
    assert.ok(unlisted);
    assert.throws(()=>buyRetailItem(db,1,catalog,options("depart1",unlisted.sku,"shop_unlisted_1")),/未上架/);
    db.prepare("UPDATE characters SET money=0 WHERE user_id=1").run();
    assert.throws(()=>buyRetailItem(db,1,catalog,options("depart1",shop.sku,"shop_no_money_1")),/現金不足/);
    assert.throws(()=>buyRetailItem(db,1,catalog,options("depart1","legacy-9999999","shop_bad_sku_1")),/找不到/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases").get().n,0);
    assert.equal(listRetailStock(db,catalog,["depart1"]).find(x=>x.sku===shop.sku).stock,shop.stock);
    assert.equal(before,9999999);
  }finally{db.close();}
});
test("同品不得越過 25 格容量，跨日刷新，但原版匯入物品不可被改寫",()=>{
  const db=fixture();try{
    ensureRetailDay(db,catalog,day,randomIndex);
    const selected=listRetailStock(db,catalog,["depart1"]).filter(x=>x.price<=100000).slice(0,26);
    assert.equal(selected.length,26);
    // 多種真實上架商品各買一件，確定容量按實際個人物品格而非單一 SKU 計。
    for(let i=0;i<25;i++)buyRetailItem(db,1,catalog,options("depart1",selected[i].sku,"shop_slot_"+String(i).padStart(7,"0")));
    assert.throws(()=>buyRetailItem(db,1,catalog,options("depart1",selected[25].sku,"shop_slot_overfull")),/25 格/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=1").get().n,25);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases WHERE user_id=1").get().n,25);
    assert.equal(ensureRetailDay(db,catalog,"2026-10-10",randomIndex),true);
    assert.equal(db.prepare("SELECT day FROM retail_day").get().day,"2026-10-10");
  }finally{db.close();}
});
