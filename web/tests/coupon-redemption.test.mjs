import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyCouponCatalog} from "../src/coupon-catalog.mjs";
import {initCouponRedemptionTables,COUPON_ITEM_ORIGIN,COUPON_INVENTORY_LIMIT,
  listCouponRewards,listCouponRedemptions,redeemEventCoupon} from "../src/coupon-redemption.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {listLegacyInventoryItems} from "../src/legacy-inventory.mjs";
import {getCouponBalance} from "../src/events.mjs";

const catalog=parseLegacyCouponCatalog(decodeLegacyText(
  readFileSync(new URL("../../dat_dir/coupon.cgi",import.meta.url))));
const now=Date.parse("2026-11-21T10:00:00Z");
function fixture({balance=4,building=true}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "name TEXT NOT NULL,town_id INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,name,town_id) VALUES(1,'單機兌換者',0),(2,'其他角色',0);",
    "CREATE TABLE character_coupons(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0));",
    "INSERT INTO character_coupons(user_id,quantity) VALUES(1,"+balance+");"
  ].join(" "));
  initTownMapTable(db);
  if(building){
    const tiles=Array(192).fill("");
    tiles[0]="クーポン";
    storeTownMap(db,0,{tiles},"web-edited");
  }
  initLegacyItemUseTables(db);
  initCouponRedemptionTables(db);
  return db;
}
function redeem(db,requestId,opts={}){
  return redeemEventCoupon(db,1,catalog,{
    sourceIndex:0,originalName:"福引券",requestId,now,...opts
  });
}
function stored(db){
  return db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=1 AND original_id=?")
    .all(COUPON_ITEM_ORIGIN);
}

test("原版 coupon_do 雙欄核對，兌換所是 unit.pl 真實地圖建築，Web 30 筆獎品資料原樣對應",()=>{
  const source=decodeLegacyText(readFileSync(new URL("../../coupon.cgi",import.meta.url)));
  const unit=decodeLegacyText(readFileSync(new URL("../../unit.pl",import.meta.url)));
  assert.match(source,/sub coupon_do\{/);
  assert.match(source,/\$in\{'syouhin'\} ne \$syo_hinmoku/);
  assert.match(source,/\$syo_taikyuu -= \$tensuu/);
  assert.match(source,/push \(@new_myitem_hairetu,\$syo_temp\)/);
  assert.match(unit,/"クーポン" => "<form method=POST action=\\"coupon\.cgi/);
  assert.equal(catalog.length,30);
  assert.equal(catalog[0].originalName,"福引券");
  assert.equal(catalog[0].requiredCoupons,1);
  assert.equal(catalog[1].requiredCoupons,150);
  assert.equal(COUPON_INVENTORY_LIMIT,25);
});

test("真實兌換：本人 Web 事件券扣點、完整33欄獎品入庫、重送冪等且不能換獎品",()=>{
  const db=fixture();
  try{
    const entries=listCouponRewards(catalog,getCouponBalance(db,1),true);
    assert.equal(entries.length,30);
    assert.equal(entries[0].canRedeem,true);
    assert.equal(entries[1].canRedeem,false);
    assert.equal(entries[0].rewardDurabilityUnit,"日");
    const received=redeem(db,"coupon_plain_0001");
    assert.equal(received.replayed,false);
    assert.equal(received.couponCost,1);
    assert.equal(getCouponBalance(db,1),3);
    assert.equal(stored(db).length,1);
    const item=stored(db)[0];
    assert.equal(item.original_name,"福引券");
    assert.equal(item.category,catalog[0].rawFields[0]);
    assert.equal(item.effect,catalog[0].rawFields[9]);
    assert.equal(item.durability,catalog[0].rewardDurability);
    assert.equal(item.durability_unit,"日");
    assert.ok(item.source_line>=6000000);
    assert.equal(item.purchased_at,Math.floor(now/1000));
    const raw=JSON.parse(item.raw_fields_json);
    assert.equal(raw.length,33);
    for(let i=0;i<33;i++)if(i!==30)
      assert.equal(raw[i],catalog[0].rawFields[i],"不能修改原版獎品欄位 "+i);
    assert.equal(raw[30],String(Math.floor(now/1000)));
    const inventory=listLegacyInventoryItems(db,1);
    assert.equal(inventory.length,1);
    assert.equal(inventory[0].origin,"coupon");
    assert.equal(inventory[0].readOnly,false);
    assert.equal(redeem(db,"coupon_plain_0001").replayed,true);
    assert.equal(getCouponBalance(db,1),3);
    assert.equal(stored(db).length,1);
    assert.throws(()=>redeem(db,"coupon_plain_0001",{
      sourceIndex:1,originalName:"４次元福袋"
    }),/相同兌換請求編號/);
    assert.throws(()=>redeem(db,"coupon_plain_0001",{
      sourceIndex:0,originalName:"偽造"
    }),/不一致/);
    assert.equal(listCouponRedemptions(db,1).length,1);
    assert.equal(listCouponRedemptions(db,2).length,0);
  }finally{db.close();}
});

test("舊版原始クーポン不混入 Web 券、不能兌換負數／超額點數或偽造商品與請求",()=>{
  const db=fixture({balance:0});
  try{
    const raw=[...catalog[0].rawFields];
    raw[0]="ギフト";raw[1]="クーポン";raw[21]="200";raw[22]="回";raw[30]="1";
    db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
      "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(1,'legacy-coupon',1,'ギフト','クーポン',?,200,'回',1,0,?)"
    ].join(" ")).run(raw[9],JSON.stringify(raw));
    assert.equal(listLegacyInventoryItems(db,1)[0].readOnly,true);
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(listCouponRewards(catalog,0,true)[0].canRedeem,false);
    assert.throws(()=>redeem(db,"coupon_legacy_0001"),/點數不足/);
    assert.equal(stored(db).length,0);
    assert.equal(db.prepare("SELECT durability FROM legacy_inventory_items WHERE source_line=1").get().durability,200);
    assert.throws(()=>redeem(db,"coupon_bad_00001",{sourceIndex:500}),/不一致/);
    assert.throws(()=>redeem(db,"coupon_bad_00002",{sourceIndex:"0"}),/格式/);
    assert.throws(()=>redeem(db,"short"),/格式/);
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(listCouponRedemptions(db,1).length,0);
  }finally{db.close();}
});

test("必須先有自己的角色且所在地有原版兌換所；無建築、券不足不應改動帳本",()=>{
  const db=fixture({building:false,balance:3});
  try{
    assert.equal(listCouponRewards(catalog,3,false)[0].canRedeem,false);
    assert.throws(()=>redeem(db,"coupon_no_house"),/沒有優惠券兌換所/);
    assert.equal(getCouponBalance(db,1),3);
    const tiles=Array(192).fill("");tiles[0]="クーポン";
    storeTownMap(db,0,{tiles},"web-edited");
    assert.throws(()=>redeemEventCoupon(db,2,catalog,{
      sourceIndex:0,originalName:"福引券",requestId:"coupon_no_money",now
    }),/點數不足/);
    assert.equal(stored(db).length,0);
    db.prepare("DELETE FROM characters WHERE user_id=1").run();
    assert.throws(()=>redeem(db,"coupon_no_player"),/請先建立角色/);
    assert.equal(getCouponBalance(db,1),3);
  }finally{db.close();}
});

test("真實一般背包25格：已滿拒絕且不扣券；舊匯入物也必須計入空間",()=>{
  const db=fixture({balance:50});
  try{
    const fields=[...catalog[0].rawFields];
    fields[30]=String(Math.floor(now/1000));
    const insert=db.prepare([
      "INSERT INTO legacy_inventory_items(",
      "user_id,original_id,source_line,category,original_name,",
      "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(1,'imported-old',?,'クーポン交換品:1','福引券',",
      "?,1,'回',?,0,?)"
    ].join(" "));
    for(let i=0;i<25;i++)insert.run(i+1,fields[9],Math.floor(now/1000),JSON.stringify(fields));
    assert.throws(()=>redeem(db,"coupon_full_slots"),/25 格/);
    assert.equal(getCouponBalance(db,1),50);
    assert.equal(stored(db).length,0);
    db.prepare("DELETE FROM legacy_inventory_items WHERE source_line=25").run();
    const result=redeem(db,"coupon_full_slots");
    assert.equal(result.replayed,false);
    assert.equal(stored(db).length,1);
    assert.equal(getCouponBalance(db,1),49);
    assert.equal(listLegacyInventoryItems(db,1).length,25);
  }finally{db.close();}
});

test("獎品入庫或歷史寫入失敗都整筆回滾，之後相同請求可安全重新執行",()=>{
  const db=fixture();
  try{
    db.exec([
      "CREATE TRIGGER block_coupon_award BEFORE INSERT ON legacy_inventory_items",
      "WHEN NEW.original_id='__web_coupon__' BEGIN",
      "SELECT RAISE(ABORT,'award blocked'); END;"
    ].join(" "));
    assert.throws(()=>redeem(db,"coupon_retry_0001"),/award blocked/);
    assert.equal(getCouponBalance(db,1),4);
    assert.equal(stored(db).length,0);
    assert.equal(listCouponRedemptions(db,1).length,0);
    db.exec("DROP TRIGGER block_coupon_award");
    db.exec([
      "CREATE TRIGGER block_coupon_ledger BEFORE INSERT ON coupon_redemptions",
      "BEGIN SELECT RAISE(ABORT,'ledger blocked'); END;"
    ].join(" "));
    assert.throws(()=>redeem(db,"coupon_retry_0001"),/ledger blocked/);
    assert.equal(getCouponBalance(db,1),4);
    assert.equal(stored(db).length,0);
    db.exec("DROP TRIGGER block_coupon_ledger");
    assert.equal(redeem(db,"coupon_retry_0001").replayed,false);
    assert.equal(getCouponBalance(db,1),3);
    assert.equal(stored(db).length,1);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});

test("多筆兌換先後扣點不會超額，對方的 Web 事件券與獎品獨立保存",()=>{
  const db=fixture({balance:1});
  try{
    assert.equal(redeem(db,"coupon_once_0001").replayed,false);
    assert.throws(()=>redeem(db,"coupon_twice_0002"),/點數不足/);
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(stored(db).length,1);
    assert.equal(listCouponRedemptions(db,1).length,1);
    assert.equal(getCouponBalance(db,2),0);
    assert.deepEqual(listLegacyInventoryItems(db,2),[]);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(listCouponRedemptions(db,1).length,0);
    assert.equal(listCouponRedemptions(db,2).length,0);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
