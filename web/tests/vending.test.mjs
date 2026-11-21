import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {initRetailTables,buyRetailItem,listRetailPurchases} from "../src/retail.mjs";
import {parseLegacyVendingCatalog,initVendingTables,ensureVendingRotation,
  listVendingStock,vendingPeriodKey,VENDING_MAX_GOODS} from "../src/vending.mjs";

const original=decodeLegacyText(readFileSync(new URL("../../dat_dir/jihanki.cgi",import.meta.url)));
const originalScript=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
const catalog=parseLegacyVendingCatalog(original);
const morning=Date.parse("2026-11-20T03:59:00Z"); // 台灣 11:59
const noon=Date.parse("2026-11-20T04:00:00Z"); // 台灣 12:00
const nextMorning=Date.parse("2026-11-21T03:59:00Z");
const randomIndex=()=>0;
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "money INTEGER NOT NULL,bank INTEGER NOT NULL,town_id INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,money,bank,town_id) VALUES",
    "(1,100000,100000,0),(2,100000,100000,0);"
  ].join(" "));
  initBankTables(db);
  initLegacyItemUseTables(db);
  initRetailTables(db);
  initVendingTables(db);
  return db;
}
const options=(sku,requestId,quantity=1,now=noon)=>
  ({shop:"vending",sku,requestId,quantity,now,day:"2026-11-20",
    timeZone:"Asia/Taipei",hasBuilding:()=>true});

test("原版自販機獨立飲料來源、十種上架與無百貨三倍售價",()=>{
  assert.match(originalScript,/sub hanbai\s*\{/);
  assert.match(originalScript,/\$habaisurukazu\s*=\s*10/);
  assert.match(originalScript,/\$habaikoushin\s*=\s*12/);
  assert.match(originalScript,/\$hanbai_icigyo\s*=\s*<OL>/);
  assert.equal(catalog.length,12);
  assert.equal(catalog[0].name,"爽快ミルク");
  assert.ok(catalog.every(x=>x.category==="ドリンク"));
  assert.ok(catalog.every(x=>x.unitPrice===x.basePrice&&x.rawFields.length===33));
  assert.ok(catalog.some(x=>x.name==="コーヒー"&&x.unitPrice===200));
  const db=fixture();try{
    assert.equal(ensureVendingRotation(db,catalog,noon,"Asia/Taipei",randomIndex),true);
    const goods=listVendingStock(db,catalog);
    assert.equal(goods.length,VENDING_MAX_GOODS);
    assert.ok(goods.every(x=>x.shop==="vending"&&x.stock>0));
    assert.equal(ensureVendingRotation(db,catalog,noon,"Asia/Taipei",randomIndex),false);
  }finally{db.close();}
});
test("自販機貨架依當地中午換檔，午夜及上午維持同一份跨玩家庫存",()=>{
  const db=fixture();try{
    assert.equal(vendingPeriodKey(morning),"2026-11-19T12:00");
    assert.equal(vendingPeriodKey(noon),"2026-11-20T12:00");
    assert.equal(vendingPeriodKey(nextMorning),"2026-11-20T12:00");
    assert.equal(ensureVendingRotation(db,catalog,morning,"Asia/Taipei",randomIndex),true);
    const first=listVendingStock(db,catalog)[0];
    db.prepare("UPDATE vending_stock SET remaining=0 WHERE sku=?").run(first.sku);
    assert.equal(ensureVendingRotation(db,catalog,morning+1000,"Asia/Taipei",randomIndex),false);
    assert.equal(ensureVendingRotation(db,catalog,noon,"Asia/Taipei",randomIndex),true);
    assert.equal(listVendingStock(db,catalog).find(x=>x.sku===first.sku).stock,
      catalog.find(x=>x.sku===first.sku).originalStock);
    db.prepare("UPDATE vending_stock SET remaining=0 WHERE sku=?").run(first.sku);
    assert.equal(ensureVendingRotation(db,catalog,nextMorning,"Asia/Taipei",randomIndex),false);
    assert.equal(listVendingStock(db,catalog).find(x=>x.sku===first.sku).stock,0);
    assert.equal(ensureVendingRotation(db,catalog,nextMorning+61000,"Asia/Taipei",randomIndex),true);
  }finally{db.close();}
});
test("有實體自販機才允許原價 1～5 件購物；多人共用庫存與本人持有物同筆扣款",()=>{
  const db=fixture();try{
    ensureVendingRotation(db,catalog,noon,"Asia/Taipei",randomIndex);
    const drink=listVendingStock(db,catalog).find(x=>x.stock>=6);
    assert.ok(drink);
    const unlisted=catalog.find(x=>!listVendingStock(db,catalog).some(y=>y.sku===x.sku));
    assert.ok(unlisted);
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.throws(()=>buyRetailItem(db,1,catalog,{
      ...options(drink.sku,"vending_no_building"),hasBuilding:()=>false
    }),/沒有自動販賣機/);
    assert.throws(()=>buyRetailItem(db,1,catalog,
      options(unlisted.sku,"vending_not_listed")),/未上架/);
    assert.throws(()=>buyRetailItem(db,1,catalog,
      options(drink.sku,"vending_bad_quantity",6)),/1～5/);
    const first=buyRetailItem(db,1,catalog,options(drink.sku,"vending_purchase_a",2));
    assert.equal(first.shop,"vending");
    assert.equal(first.paid,drink.price*2);
    assert.equal(first.quantity,2);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,
      before-drink.price*2);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,100000);
    assert.equal(db.prepare("SELECT durability FROM legacy_inventory_items WHERE user_id=1").get().durability,
      drink.durability*2);
    const second=buyRetailItem(db,2,catalog,options(drink.sku,"vending_purchase_b",2));
    assert.equal(second.paid,drink.price*2);
    assert.equal(listVendingStock(db,catalog).find(x=>x.sku===drink.sku).stock,drink.stock-4);
    const replay=buyRetailItem(db,1,catalog,options(drink.sku,"vending_purchase_a",2));
    assert.equal(replay.replayed,true);
    assert.equal(replay.sourceLine,first.sourceLine);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,
      before-drink.price*2);
    assert.equal(listRetailPurchases(db,1)[0].shop,"vending");
    assert.equal(listRetailPurchases(db,2)[0].shop,"vending");
    assert.throws(()=>buyRetailItem(db,1,catalog,
      options(drink.sku,"vending_purchase_a",1)),/不同商品、數量/);
    assert.throws(()=>buyRetailItem(db,1,catalog,
      {...options("legacy-356","vending_forged_sku"),sku:"legacy-356"}),/找不到/);
  }finally{db.close();}
});
test("販賣機同品耐久累加但不可超過五份，餘額或庫存不足應整筆回滾",()=>{
  const db=fixture();try{
    ensureVendingRotation(db,catalog,noon,"Asia/Taipei",randomIndex);
    const drink=listVendingStock(db,catalog).find(x=>x.stock>=7&&x.price<1000);
    assert.ok(drink);
    const first=buyRetailItem(db,1,catalog,options(drink.sku,"vending_stack_1",3));
    const next=buyRetailItem(db,1,catalog,options(drink.sku,"vending_stack_2",2));
    assert.equal(first.sourceLine,next.sourceLine);
    assert.equal(next.merged,true);
    assert.equal(db.prepare("SELECT durability FROM legacy_inventory_items WHERE user_id=1").get().durability,
      drink.durability*5);
    const cash=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const stock=listVendingStock(db,catalog).find(x=>x.sku===drink.sku).stock;
    assert.throws(()=>buyRetailItem(db,1,catalog,
      options(drink.sku,"vending_stack_over")),/5 件/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,cash);
    assert.equal(listVendingStock(db,catalog).find(x=>x.sku===drink.sku).stock,stock);
    db.prepare("UPDATE characters SET money=0 WHERE user_id=2").run();
    assert.throws(()=>buyRetailItem(db,2,catalog,
      options(drink.sku,"vending_no_money")),/現金不足/);
    db.prepare("UPDATE vending_stock SET remaining=0 WHERE sku=?").run(drink.sku);
    assert.throws(()=>buyRetailItem(db,2,catalog,
      options(drink.sku,"vending_sold_out")),/庫存不足/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases").get().n,2);
  }finally{db.close();}
});
test("自販機付款方式不可憑空引用信用卡或動用他人的銀行存款",()=>{
  const db=fixture();try{
    ensureVendingRotation(db,catalog,noon,"Asia/Taipei",randomIndex);
    const drink=listVendingStock(db,catalog)[0];
    const before=db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank;
    assert.throws(()=>buyRetailItem(db,1,catalog,{
      ...options(drink.sku,"vending_credit_fake"),payment:"bank",cardSourceLine:10
    }),/信用卡/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger").get().n,0);
  }finally{db.close();}
});
