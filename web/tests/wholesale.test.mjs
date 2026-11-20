import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initHousingTables} from "../src/housing.mjs";
import {initRoomsTables,setRoomSlots} from "../src/rooms.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initLegacyInventoryTables} from "../src/legacy-inventory.mjs";
import {
  parseWholesaleCatalog,initWholesaleTables,ensureWholesaleDay,
  listWholesaleGoods,configurePlayerShop,listMyShops,listShopInventory,
  buyWholesale,returnWholesale,wholesaleCost,listWholesaleHistory,SHOP_CATEGORIES,
  WHOLESALE_SYMBOL,WHOLESALE_MAX_GOODS,SHOP_ITEM_LIMIT,SHOP_KIND_LIMIT
} from "../src/wholesale.mjs";

const original=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
const refunds=decodeLegacyText(readFileSync(new URL("../../tonyahenpin.cgi",import.meta.url)));
const houseSource=decodeLegacyText(readFileSync(new URL("../../original_house.cgi",import.meta.url)));
const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const catalog=parseWholesaleCatalog(source);
const now=Date.parse("2026-11-20T14:02:00Z");
const day="2026-11-20";
const opts=(requestId,more={})=>({
  houseId:1,requestId,now,day,hasBuilding:()=>true,...more
});
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "name TEXT NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,name,town_id,money,bank) VALUES",
    "(1,'我的店主',3,1000000,1000000),(2,'別的店主',3,1000000,1000000);"
  ].join(" "));
  initHousingTables(db);
  initRoomsTables(db);
  initBankTables(db);
  initLegacyInventoryTables(db);
  initWholesaleTables(db);
  db.exec([
    "INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,",
    "interior_rank,purchase_price,original_plot,created_at)",
    "VALUES(1,1,3,0,0,'商店住宅','house/kamakura.gif',3,6500000,'空地',100);"
  ].join(" "));
  return db;
}
function shop(db,category="食料品"){
  setRoomSlots(db,1,1,[{type:"1",title:"我的店",url:""}],now);
  return configurePlayerShop(db,1,1,{category,title:"小小商店"},now);
}
function stocked(db,category="食料品"){
  shop(db,category);
  ensureWholesaleDay(db,catalog,day,()=>0);
  const candidate=listWholesaleGoods(db,catalog).find(x=>
    (category==="スーパー"||
      x.category===category)&&x.stock>=4&&x.price>0&&
      (category!=="スーパー"||!/専門店限定商品|秘伝商品/.test(x.note)));
  assert.ok(candidate,"原版來源在抽選貨架內應有可進貨商品");
  return candidate;
}
test("原版問屋是商店貨架（非本人持有物）：120 種、庫存二倍、分類、銀行及退貨公式",()=>{
  assert.match(original,/sub orosi \{/);
  assert.match(original,/sub buy_orosi \{/);
  assert.match(original,/\\?\$orosi_sinakazu/);
  assert.match(original,/\$ton_zaiko_tyousei/);
  assert.match(original,/\$mise_zaiko_limit/);
  assert.match(original,/普通口座/);
  assert.match(houseSource,/>お店<\/option>/);
  assert.match(refunds,/\$tesuuryou = 0\.75/);
  assert.match(refunds,/\$suupaa = 1\.5/);
  assert.equal(WHOLESALE_SYMBOL,"問屋");
  assert.equal(WHOLESALE_MAX_GOODS,120);
  assert.equal(SHOP_ITEM_LIMIT,100);
  assert.equal(SHOP_KIND_LIMIT,100);
  assert.ok(SHOP_CATEGORIES.includes("スーパー"));
  assert.ok(catalog.length>120);
  assert.ok(catalog.some(x=>x.name==="健康保険"&&x.basePrice===10000));
  assert.ok(catalog.every(x=>x.fields.length===33&&x.stock>0));
});
test("原版供應貨架全球共用，同日不重置庫存，跨天更新最多 120 種",()=>{
  const db=fixture();try{
    assert.equal(ensureWholesaleDay(db,catalog,day,()=>0),true);
    const goods=listWholesaleGoods(db,catalog);
    assert.equal(goods.length,120);
    const first=goods[0];
    db.prepare("UPDATE wholesale_stock SET remaining=1 WHERE sku=?").run(first.sku);
    assert.equal(ensureWholesaleDay(db,catalog,day,()=>0),false);
    assert.equal(listWholesaleGoods(db,catalog)[0].stock,1);
    assert.equal(ensureWholesaleDay(db,catalog,"2026-11-21",()=>0),true);
    assert.equal(listWholesaleGoods(db,catalog)[0].stock,
      catalog.find(x=>x.sku===first.sku).stock);
  }finally{db.close();}
});
test("沒有住宅、未在住宅開啟商店欄位、非屋主均不能建立進貨商店",()=>{
  const db=fixture();try{
    assert.throws(()=>configurePlayerShop(db,1,1,{
      category:"日用品",title:"沒有室內欄位"
    },now),/室內/);
    assert.throws(()=>configurePlayerShop(db,2,1,{
      category:"日用品",title:"竊用別人店鋪"
    },now),/本人住宅/);
    assert.throws(()=>configurePlayerShop(db,1,1,{
      category:"不存在的類別",title:"假的店"
    },now),/分類/);
    const chosen=shop(db);
    assert.equal(chosen.category,"食料品");
    assert.deepEqual(listMyShops(db,2),[]);
    assert.equal(listMyShops(db,1).length,1);
    assert.throws(()=>buyWholesale(db,2,catalog,{
      sku:catalog[0].sku,quantity:1,...opts("wholesale_other_house")
    }),/必須先擁有並設定住宅商店/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wholesale_transactions").get().n,0);
  }finally{db.close();}
});
test("專賣店普通銀行進貨與庫存累加：本人帳簿扣款，未動現金與原版個人物品",()=>{
  const db=fixture();try{
    const item=stocked(db);
    const before=db.prepare("SELECT money,bank FROM characters WHERE user_id=1").get();
    const first=buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:2,...opts("wholesale_buy_first")
    });
    assert.equal(first.amount,-item.price*2);
    assert.equal(first.stockAfter,2);
    assert.equal(first.replayed,false);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before.money);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,
      before.bank-item.price*2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items").get().n,0);
    assert.equal(listShopInventory(db,1,1)[0].quantity,2);
    assert.equal(listShopInventory(db,2,1).length,0);
    const second=buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:1,...opts("wholesale_buy_second")
    });
    assert.equal(second.stockAfter,3);
    assert.equal(listShopInventory(db,1,1)[0].quantity,3);
    assert.equal(listWholesaleGoods(db,catalog).find(x=>x.sku===item.sku).stock,item.stock-3);
    assert.equal(buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:2,...opts("wholesale_buy_first")
    }).replayed,true);
    assert.throws(()=>buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:1,...opts("wholesale_buy_first")
    }),/請求編號/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger").get().n,2);
    assert.equal(listWholesaleHistory(db,1).length,2);
  }finally{db.close();}
});
test("退貨可退部分或全部，普通商店 75% 入普通存款，原版貨架不回補",()=>{
  const db=fixture();try{
    const item=stocked(db);
    buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:4,...opts("wholesale_return_buy")
    });
    const oldStock=listWholesaleGoods(db,catalog).find(x=>x.sku===item.sku).stock;
    const bank=db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank;
    const first=returnWholesale(db,1,{
      houseId:1,sku:item.sku,quantity:2,
      requestId:"wholesale_return_two",now,hasBuilding:()=>false
    });
    assert.equal(first.amount,Math.floor(item.price*2*0.75));
    assert.equal(first.stockAfter,2);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,
      bank+first.amount);
    assert.equal(listShopInventory(db,1,1)[0].quantity,2);
    const last=returnWholesale(db,1,{
      houseId:1,sku:item.sku,quantity:0,
      requestId:"wholesale_return_all",now,hasBuilding:()=>false
    });
    assert.equal(last.returned,2);
    assert.equal(last.stockAfter,0);
    assert.equal(listShopInventory(db,1,1).length,0);
    assert.equal(listWholesaleGoods(db,catalog).find(x=>x.sku===item.sku).stock,oldStock);
    assert.equal(returnWholesale(db,1,{
      houseId:1,sku:item.sku,quantity:0,
      requestId:"wholesale_return_all",now,hasBuilding:()=>false
    }).replayed,true);
    assert.throws(()=>returnWholesale(db,1,{
      houseId:1,sku:item.sku,quantity:1,
      requestId:"wholesale_return_again",now,hasBuilding:()=>true
    }),/沒有這項/);
  }finally{db.close();}
});
test("超市跨類進貨乘 1.5，退貨返還 1.5×0.75，專賣店限定拒進",()=>{
  const db=fixture();try{
    const item=stocked(db,"スーパー");
    assert.equal(wholesaleCost(101,1,true),152);
    assert.equal(wholesaleCost(101,2,true),303);
    assert.equal(wholesaleCost(101,1,false),101);
    const buy=buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:3,...opts("wholesale_supermarket_buy")
    });
    assert.equal(buy.amount,-Math.ceil(item.price*3*1.5));
    const refunded=returnWholesale(db,1,{
      houseId:1,sku:item.sku,quantity:1,
      requestId:"wholesale_supermarket_return",now,hasBuilding:()=>false
    });
    assert.equal(refunded.amount,Math.floor(item.price*1.5*0.75));
    assert.equal(listShopInventory(db,1,1)[0].quantity,2);
    // 注入一筆由原始來源確認為「専門店限定商品」的受限上架品進行拒買測試。
    const limited=catalog.find(x=>/専門店限定商品|秘伝商品/.test(x.note));
    if(limited){
      if(!listWholesaleGoods(db,catalog).some(x=>x.sku===limited.sku)){
        db.prepare("DELETE FROM wholesale_stock WHERE position=0").run();
        db.prepare("INSERT INTO wholesale_stock(sku,position,remaining) VALUES(?,0,10)")
          .run(limited.sku);
      }
      assert.throws(()=>buyWholesale(db,1,catalog,{
        sku:limited.sku,quantity:1,...opts("wholesale_specialist_limited")
      }),/限定|秘傳/);
    }
  }finally{db.close();}
});
test("沒有問屋不能進貨、店類不符、庫存與普通銀行不足都不會扣錢",()=>{
  const db=fixture();try{
    const item=stocked(db);
    const before=db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank;
    assert.throws(()=>buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:1,...opts("wholesale_map_missing",{hasBuilding:()=>false})
    }),/沒有原版問屋/);
    const other=listWholesaleGoods(db,catalog).find(x=>x.category!=="食料品");
    assert.ok(other);
    assert.throws(()=>buyWholesale(db,1,catalog,{
      sku:other.sku,quantity:1,...opts("wholesale_category_wrong")
    }),/店鋪種類/);
    assert.throws(()=>buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:101,...opts("wholesale_quantity_over")
    }),/格式/);
    db.prepare("UPDATE characters SET bank=0 WHERE user_id=1").run();
    assert.throws(()=>buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:1,...opts("wholesale_no_bank")
    }),/普通銀行存款不足/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_shop_stock").get().n,0);
    assert.equal(listWholesaleGoods(db,catalog).find(x=>x.sku===item.sku).stock,item.stock);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wholesale_transactions").get().n,0);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=1").run(before);
  }finally{db.close();}
});
test("變更店類清除舊庫存需明確確認；出售住宅時倉庫跟著銷毀",()=>{
  const db=fixture();try{
    const item=stocked(db);
    buyWholesale(db,1,catalog,{
      sku:item.sku,quantity:2,...opts("wholesale_change_category_buy")
    });
    assert.throws(()=>configurePlayerShop(db,1,1,{
      category:"書籍",title:"書店"
    },now),/明確確認/);
    assert.equal(listMyShops(db,1)[0].category,"食料品");
    assert.equal(listShopInventory(db,1,1).length,1);
    const changed=configurePlayerShop(db,1,1,{
      category:"書籍",title:"書店",confirmClear:true
    },now);
    assert.equal(changed.stockCleared,true);
    assert.equal(listShopInventory(db,1,1).length,0);
    assert.equal(listMyShops(db,1)[0].category,"書籍");
    db.prepare("DELETE FROM houses WHERE id=1").run();
    assert.deepEqual(listMyShops(db,1),[]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_shop_stock").get().n,0);
  }finally{db.close();}
});
