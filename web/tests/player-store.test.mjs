import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initHousingTables} from "../src/housing.mjs";
import {initRoomsTables,setRoomSlots} from "../src/rooms.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initInventoryTables,insuranceCoverage} from "../src/inventory.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {parseWholesaleCatalog,initWholesaleTables,listShopInventory,defaultStorePrice,storePriceRange}
  from "../src/wholesale.mjs";
import {initPlayerStoreTables,viewPlayerStore,setPlayerStorePrice,buyPlayerStore,
  listPlayerShopSales,PLAYER_STORE_ORIGIN} from "../src/player-store.mjs";

const originalHouse=decodeLegacyText(readFileSync(new URL("../../original_house.cgi",import.meta.url)));
const originalCommand=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const catalog=parseWholesaleCatalog(source);
const soap=catalog.find(x=>x.name==="油取り紙");
const now=Date.parse("2026-11-20T14:30:00Z");
const params=(requestId,extra={})=>({houseId:1,sku:soap.sku,quantity:1,
  payment:"cash",requestId,now,...extra});
function fixture({buyerHome=true}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "name TEXT NOT NULL UNIQUE,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2),(3);",
    "INSERT INTO characters(user_id,name,town_id,money,bank) VALUES",
    "(1,'玩家店主',3,100000,100000),(2,'顧客甲',3,100000,100000),",
    "(3,'顧客乙',3,100000,100000);"
  ].join(" "));
  initHousingTables(db);
  initRoomsTables(db);
  initBankTables(db);
  initInventoryTables(db);
  initLegacyItemUseTables(db);
  initWholesaleTables(db);
  initPlayerStoreTables(db);
  db.exec([
    "INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,",
    "interior_rank,purchase_price,original_plot,created_at)",
    "VALUES(1,1,3,0,0,'店家住宅','house/kamakura.gif',3,6500000,'空地',1);"
  ].join(" "));
  if(buyerHome)db.exec([
    "INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,",
    "interior_rank,purchase_price,original_plot,created_at)",
    "VALUES(2,2,3,0,1,'顧客住宅','house/kamakura.gif',3,6500000,'空地',1);"
  ].join(" "));
  setRoomSlots(db,1,1,[{type:"1",title:"對外商店",url:""}],now);
  db.prepare([
    "INSERT INTO player_shops(house_id,owner_user_id,category,title,created_at)",
    "VALUES(1,1,'美容','原版美容專賣店',?)"
  ].join(" ")).run(now);
  seedStock(db,soap,12);
  return db;
}
function seedStock(db,item,quantity,price=null){
  const fields=[...item.fields];fields[24]=String(quantity);
  db.prepare([
    "INSERT INTO player_shop_stock(house_id,sku,category,name,unit_price,quantity,",
    "raw_fields_json,updated_at,sale_price) VALUES(1,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(item.sku,item.category,item.name,item.basePrice,
    quantity,JSON.stringify(fields),now,price);
}
function getItem(db,userId=2){
  return db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=?")
    .get(userId);
}
test("原版個人住宅商店預設兩倍、超市三倍售價，自訂價介於原價十分之一與三倍",()=>{
  assert.ok(soap&&soap.durability===5);
  assert.match(originalHouse,/sub my_syouhin \{/);
  assert.match(originalHouse,/\$omise_yobi5 eq ""\)\{\$omise_yobi5 = "2"/);
  assert.match(originalHouse,/\$in\{'syo_nedan'\} \* 3/);
  assert.match(originalHouse,/\$in\{'syo_nedan'\} \/ 10/);
  assert.match(originalCommand,/sub buy_syouhin \{/);
  assert.match(originalCommand,/販売（\$katta_syouhin）/);
  assert.equal(defaultStorePrice(100,"美容"),200);
  assert.equal(defaultStorePrice(100,"スーパー"),300);
  assert.deepEqual(storePriceRange(101),{min:11,max:303});
  assert.deepEqual(storePriceRange(101,"スーパー"),{min:16,max:454});
});
test("住宅商店可參訪與設定價，非屋主不可改價，沒有本人住宅商店不能從假編號購入",()=>{
  const db=fixture();try{
    const room=viewPlayerStore(db,2,1);
    assert.equal(room.title,"原版美容專賣店");
    assert.equal(room.items[0].price,soap.basePrice*2);
    assert.equal(room.owner,false);
    assert.throws(()=>setPlayerStorePrice(db,2,{
      houseId:1,sku:soap.sku,price:soap.basePrice
    }),/店主/);
    assert.throws(()=>setPlayerStorePrice(db,1,{
      houseId:1,sku:soap.sku,price:soap.basePrice*3+1
    }),/售價/);
    assert.throws(()=>setPlayerStorePrice(db,1,{
      houseId:1,sku:soap.sku,price:Math.ceil(soap.basePrice/10)-1
    }),/售價/);
    const set=setPlayerStorePrice(db,1,{houseId:1,sku:soap.sku,price:150});
    assert.equal(set.price,150);
    assert.equal(viewPlayerStore(db,2,1).items[0].price,150);
    assert.equal(listShopInventory(db,1,1)[0].salePrice,150);
    assert.equal(listShopInventory(db,2,1).length,0);
    assert.throws(()=>buyPlayerStore(db,2,params("store_forged_house",{houseId:999})),/尚未開設/);
    db.prepare("UPDATE characters SET town_id=0 WHERE user_id=2").run();
    assert.throws(()=>viewPlayerStore(db,2,1),/城鎮/);
    assert.throws(()=>buyPlayerStore(db,2,params("store_remote_buyer")),/城鎮/);
  }finally{db.close();}
});
test("兩個玩家真實店鋪結帳：同城 10% 現金回饋、店主銀行入帳、買家本人 33 欄入庫",()=>{
  const db=fixture();try{
    const start=db.prepare("SELECT money,bank FROM characters WHERE user_id=2").get();
    const seller=db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank;
    const first=buyPlayerStore(db,2,params("store_cash_purchase_2",{quantity:2}));
    assert.equal(first.replayed,false);
    assert.equal(first.paid,soap.basePrice*2*2);
    assert.equal(first.cashback,Math.floor(first.paid/10));
    assert.equal(db.prepare("SELECT money,bank FROM characters WHERE user_id=2").get().money,
      start.money-first.paid+first.cashback);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,
      seller+first.paid);
    assert.equal(getItem(db).original_id,PLAYER_STORE_ORIGIN);
    assert.equal(getItem(db).durability,soap.durability*2);
    assert.equal(JSON.parse(getItem(db).raw_fields_json).length,33);
    assert.equal(viewPlayerStore(db,2,1).items[0].stock,10);
    const rerun=buyPlayerStore(db,2,params("store_cash_purchase_2",{quantity:2}));
    assert.equal(rerun.replayed,true);
    assert.equal(rerun.sourceLine,first.sourceLine);
    assert.equal(listPlayerShopSales(db,1).length,1);
    assert.equal(listPlayerShopSales(db,2).length,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger WHERE user_id=1").get().n,1);
    assert.throws(()=>buyPlayerStore(db,2,params("store_cash_purchase_2",{quantity:1})),/購物識別碼/);
  }finally{db.close();}
});
test("從店鋪購買同品回耐久會累加，但不得超過五份，使用餘額不被復活",()=>{
  const db=fixture();try{
    const a=buyPlayerStore(db,2,params("store_stack_first",{quantity:2}));
    db.prepare([
      "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
      "VALUES(2,?,?,?)"
    ].join(" ")).run(a.sourceLine,7,now-3000);
    const b=buyPlayerStore(db,2,params("store_stack_next",{quantity:2}));
    assert.equal(b.merged,true);
    assert.equal(b.sourceLine,a.sourceLine);
    assert.equal(getItem(db).durability,17);
    assert.equal(JSON.parse(getItem(db).raw_fields_json)[21],"17");
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=2").get().remaining,17);
    assert.throws(()=>buyPlayerStore(db,2,params("store_stack_exceed",{quantity:2})),/五份/);
    assert.equal(viewPlayerStore(db,2,1).items[0].stock,8);
  }finally{db.close();}
});
test("信用卡支付只可用本人仍有效的原版 33 欄信用卡；扣本人銀行，不扣現金",()=>{
  const db=fixture({buyerHome:false});try{
    const f=Array(33).fill("0");
    f[0]="日用品";f[1]="クレジットカード";f[9]="クレジット";
    f[21]="30";f[22]="日";f[30]=String(Math.floor(now/1000));
    db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
      "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(2,'legacy',43,'日用品','クレジットカード','クレジット',30,'日',?,0,?)"
    ].join(" ")).run(Number(f[30]),JSON.stringify(f));
    const before=db.prepare("SELECT money,bank FROM characters WHERE user_id=2").get();
    assert.throws(()=>buyPlayerStore(db,2,params("store_invalid_card",{
      payment:"bank",cardSourceLine:99999
    })),/信用卡/);
    const result=buyPlayerStore(db,2,params("store_valid_card",{
      payment:"bank",cardSourceLine:43
    }));
    assert.equal(result.cashback,0);
    assert.equal(result.paid,soap.basePrice*2);
    const after=db.prepare("SELECT money,bank FROM characters WHERE user_id=2").get();
    assert.equal(after.money,before.money);
    assert.equal(after.bank,before.bank-result.paid);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger").get().n,2);
  }finally{db.close();}
});
test("自家店購物不再付給自己銀行銷售收入，也不領取同城回饋",()=>{
  const db=fixture();try{
    const bank=db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank;
    const buy=buyPlayerStore(db,1,params("store_owner_self_buy"));
    assert.equal(buy.cashback,0);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,bank);
    assert.equal(listPlayerShopSales(db,1)[0].role,"buyer");
    assert.equal(viewPlayerStore(db,1,1).items[0].stock,11);
  }finally{db.close();}
});
test("顧客餘額不足、店鋪售罄、庫存不足及屋主銀行溢位時整筆交易回滾",()=>{
  const db=fixture();try{
    db.prepare("UPDATE characters SET money=0 WHERE user_id=2").run();
    assert.throws(()=>buyPlayerStore(db,2,params("store_empty_cash")),/現金不足/);
    assert.equal(viewPlayerStore(db,2,1).items[0].stock,12);
    db.prepare("UPDATE characters SET money=100000 WHERE user_id=2").run();
    assert.throws(()=>buyPlayerStore(db,2,params("store_too_many",{quantity:6})),/1～5/);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=1")
      .run(Number.MAX_SAFE_INTEGER-100);
    assert.throws(()=>buyPlayerStore(db,2,params("store_seller_overflow")),/安全範圍/);
    assert.equal(viewPlayerStore(db,2,1).items[0].stock,12);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_shop_sales").get().n,0);
    db.prepare("UPDATE characters SET bank=100000 WHERE user_id=1").run();
    // 改成最後剩下三件，單筆買光，直接刪除庫存（CHECK quantity > 0）。
    const remaining=[...soap.fields];remaining[24]="3";
    db.prepare([
      "UPDATE player_shop_stock SET quantity=3,raw_fields_json=?",
      "WHERE house_id=1 AND sku=?"
    ].join(" ")).run(JSON.stringify(remaining),soap.sku);
    buyPlayerStore(db,3,params("store_sold_out_last",{quantity:3}));
    assert.equal(viewPlayerStore(db,2,1).items.length,0);
    assert.throws(()=>buyPlayerStore(db,2,params("store_no_inventory")),/庫存不足|沒有上架/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_shop_stock WHERE house_id=1").get().n,0);
  }finally{db.close();}
});
test("店鋪未公開／類別移除後無法繞過路由出售，買家原版匯入物品不被改寫",()=>{
  const db=fixture();try{
    setRoomSlots(db,1,1,[{type:"0",title:"留言",url:""}],now);
    assert.throws(()=>buyPlayerStore(db,2,params("store_closed_buy")),/未公開/);
    assert.throws(()=>viewPlayerStore(db,2,1),/未公開/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_shop_sales").get().n,0);
  }finally{db.close();}
});
