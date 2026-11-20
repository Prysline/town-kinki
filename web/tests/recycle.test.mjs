import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {
 initRecycleTables,listRecycleListings,listRecycleSellable,listRecycleHistory,
 sellToRecycle,buyFromRecycle,RECYCLE_SYMBOL,RECYCLE_WAIT_MS,RECYCLE_MAX_LISTINGS
} from "../src/recycle.mjs";

const original=decodeLegacyText(readFileSync(new URL("../../recycle.cgi",import.meta.url)));
const now=Date.parse("2026-11-20T12:00:00Z");
const options=(requestId,extra={})=>({requestId,now,hasBuilding:()=>true,...extra});
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "money INTEGER NOT NULL,town_id INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2),(3);",
    "INSERT INTO characters(user_id,money,town_id) VALUES",
    "(1,500000,0),(2,500000,0),(3,500000,0);"
  ].join(" "));
  initLegacyItemUseTables(db);
  initRecycleTables(db);
  return db;
}
function seed(db,{userId=1,sourceLine=1000001,category="日用品",
  name="回收物品",origin="__web_retail__",durability=5,unit="回",
  tanka=100,purchasedAt=Math.floor((now-31*60000)/1000)}={}){
  const f=Array(33).fill("0");
  f[0]=category;f[1]=name;f[9]="無";f[21]=String(durability);
  f[22]=unit;f[30]=String(purchasedAt);f[31]=String(tanka);
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,origin,sourceLine,category,name,"無",durability,unit,
    purchasedAt,0,JSON.stringify(f));
  return sourceLine;
}
function row(db,userId,sourceLine){
  return db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=? AND source_line=?")
    .get(userId,sourceLine);
}
test("原版回收獨立交易來源、七日、50 筆、30 分鐘、最高回收 200000 元",()=>{
  assert.equal(RECYCLE_SYMBOL,"リサイ");
  assert.equal(RECYCLE_MAX_LISTINGS,50);
  assert.equal(RECYCLE_WAIT_MS,30*60000);
  assert.match(original,/\$recycle_log_f = '\.\/log_dir\/recycle_log\.cgi'/);
  assert.match(original,/\$uritobasi_jyougen = 200000/);
  assert.match(original,/\$re_zaiko = 50/);
  assert.match(original,/\$kesunisuu = 7/);
  assert.match(original,/sub baikyaku_do\{/);
  assert.match(original,/sub resycle_do\{/);
});
test("二手回收完整交易：本人出售收現金、共用貨架、別人買入原價且不複製舊物",()=>{
  const db=fixture();try{
    seed(db);
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const sold=sellToRecycle(db,1,{sourceLine:1000001,...options("recycle_seller_one")});
    assert.equal(sold.amount,500);
    assert.equal(sold.replayed,false);
    assert.equal(row(db,1,1000001),undefined);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before+500);
    const shelf=listRecycleListings(db,now);
    assert.equal(shelf.length,1);
    assert.equal(shelf[0].price,500);
    assert.equal(shelf[0].quantity,5);
    const again=sellToRecycle(db,1,{sourceLine:1000001,...options("recycle_seller_one")});
    assert.equal(again.replayed,true);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before+500);
    const bought=buyFromRecycle(db,2,{
      listingId:shelf[0].id,...options("recycle_buyer_one")
    });
    assert.equal(bought.amount,-500);
    const obtained=row(db,2,bought.sourceLine);
    assert.equal(obtained.original_id,"__web_recycle__");
    assert.equal(obtained.category,"リサイクル");
    assert.equal(obtained.durability,5);
    assert.equal(JSON.parse(obtained.raw_fields_json)[0],"リサイクル");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,499500);
    assert.equal(listRecycleListings(db,now).length,0);
    assert.equal(buyFromRecycle(db,2,{
      listingId:shelf[0].id,...options("recycle_buyer_one")
    }).replayed,true);
    assert.throws(()=>buyFromRecycle(db,3,{
      listingId:shelf[0].id,...options("recycle_third_buyer")
    }),/已售出/);
    assert.equal(listRecycleHistory(db,1).length,1);
    assert.equal(listRecycleHistory(db,2).length,1);
  }finally{db.close();}
});
test("原版出售須等 30 分鐘，日制另要滿完整一日；原版舊匯入物品不可出售",()=>{
  const db=fixture();try{
    seed(db,{purchasedAt:Math.floor((now-29*60000)/1000)});
    assert.throws(()=>sellToRecycle(db,1,{
      sourceLine:1000001,...options("recycle_early")
    }),/30 分鐘/);
    seed(db,{sourceLine:1000002,unit:"日",durability:8,
      purchasedAt:Math.floor((now-31*60000)/1000)});
    assert.throws(()=>sellToRecycle(db,1,{
      sourceLine:1000002,...options("recycle_day_early")
    }),/完整 1 天/);
    seed(db,{sourceLine:1000003,unit:"日",durability:8,
      purchasedAt:Math.floor((now-2*86400000)/1000)});
    const day=sellToRecycle(db,1,{
      sourceLine:1000003,...options("recycle_day_valid")
    });
    assert.equal(day.amount,600);
    const listing=listRecycleListings(db,now).find(x=>x.id===day.newListingId);
    assert.equal(listing.quantity,6);
    assert.equal(listing.unit,"日");
    seed(db,{sourceLine:1000004,origin:"old_original"});
    assert.throws(()=>sellToRecycle(db,1,{
      sourceLine:1000004,...options("recycle_legacy_denied")
    }),/唯讀/);
    assert.equal(row(db,1,1000004).original_id,"old_original");
    assert.equal(listRecycleListings(db,now).length,1);
  }finally{db.close();}
});
test("原版超過 200000 元先限制回收額，再以每單位八成價格轉售",()=>{
  const db=fixture();try{
    seed(db,{tanka:100000,durability:5});
    const sold=sellToRecycle(db,1,{
      sourceLine:1000001,...options("recycle_200k_cap")
    });
    assert.equal(sold.amount,200000);
    const listing=listRecycleListings(db,now)[0];
    assert.equal(listing.price,160000);
    const buyer=buyFromRecycle(db,2,{
      listingId:listing.id,...options("recycle_discount_buy")
    });
    assert.equal(buyer.amount,-160000);
    assert.equal(JSON.parse(row(db,2,buyer.sourceLine).raw_fields_json)[31],"32000");
  }finally{db.close();}
});
test("二手貨架最多顯示 50 筆、超過 7 日自動到期，無法重複出售或購買到期品",()=>{
  const db=fixture();try{
    for(let i=0;i<51;i++){
      seed(db,{sourceLine:1000001+i,name:"舊物-"+i});
      sellToRecycle(db,1,{sourceLine:1000001+i,...options("recycle_many_"+String(i).padStart(3,"0"))});
    }
    assert.equal(listRecycleListings(db,now).length,50);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recycle_listings WHERE status='expired'").get().n,1);
    const oldest=listRecycleListings(db,now).at(-1).id;
    assert.throws(()=>buyFromRecycle(db,2,{
      listingId:1,...options("recycle_older_expired")
    }),/已售出或超過/);
    assert.ok(oldest>1);
    const later=now+7*86400000+1;
    assert.equal(listRecycleListings(db,later).length,0);
    assert.throws(()=>buyFromRecycle(db,2,{
      listingId:oldest,...options("recycle_after_week",{now:later})
    }),/已售出或超過/);
  }finally{db.close();}
});
test("庫存、現金、本人資料及 requestId 撞單失敗時不異動資產",()=>{
  const db=fixture();try{
    seed(db);
    assert.throws(()=>sellToRecycle(db,1,{
      sourceLine:1000001,...options("recycle_without_building",{hasBuilding:()=>false})
    }),/沒有回收商店/);
    assert.throws(()=>sellToRecycle(db,2,{
      sourceLine:1000001,...options("recycle_other_item")
    }),/唯讀/);
    const sold=sellToRecycle(db,1,{
      sourceLine:1000001,...options("recycle_one_item")
    });
    assert.ok(sold.newListingId>0);
    assert.throws(()=>sellToRecycle(db,1,{
      sourceLine:1000002,...options("recycle_one_item")
    }),/請求編號/);
    const money=db.prepare("SELECT money FROM characters WHERE user_id=2").get().money;
    db.prepare("UPDATE characters SET money=0 WHERE user_id=2").run();
    assert.throws(()=>buyFromRecycle(db,2,{
      listingId:sold.newListingId,...options("recycle_poor_buyer")
    }),/現金不足/);
    assert.equal(listRecycleListings(db,now).length,1);
    assert.equal(row(db,2,4000000),undefined);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,0);
    db.prepare("UPDATE characters SET money=? WHERE user_id=2").run(money);
    assert.throws(()=>buyFromRecycle(db,2,{
      listingId:sold.newListingId,...options("recycle_no_building_buy",{hasBuilding:()=>false})
    }),/沒有回收商店/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recycle_transactions").get().n,1);
  }finally{db.close();}
});
