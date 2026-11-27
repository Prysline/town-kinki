import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initLegacyItemUseTables,listLegacyItemActions} from "../src/legacy-item-use.mjs";
import {initBankTables} from "../src/banking.mjs";
import {parseLegacyInsurance,inventoryOverview,hasActiveHealthInsurance,buyHealthInsurance,DAY_MS} from "../src/inventory.mjs";
import {parseLegacyRetailCatalog,retailItemDetails,initRetailTables,ensureRetailDay,listRetailStock,buyRetailItem,listRetailPurchases} from "../src/retail.mjs";
const original=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const script=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
const catalog=parseLegacyRetailCatalog(original);
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters (user_id INTEGER PRIMARY KEY REFERENCES users(id),money INTEGER NOT NULL,bank INTEGER NOT NULL,town_id INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,money,bank,town_id) VALUES(1,9999999,9999999,0),(2,9999999,9999999,0);"
  ].join(" "));
  initBankTables(db);initLegacyItemUseTables(db);initRetailTables(db);
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
test("百貨原版商品效果沒有遺失：能力、特殊欄位、能量與備註對照 33 欄",()=>{
  const paper=catalog.find(x=>x.name==="油取り紙");
  assert.ok(paper);
  const details=retailItemDetails(paper);
  assert.equal(details.effects.looks,2);
  assert.equal(details.effectCode,"無");
  assert.equal(details.intervalMinutes,10);
  assert.equal(details.usage,"supported");
  assert.equal(details.comment,"");
  const milk=catalog.find(x=>x.name==="元気ミルク");
  assert.ok(milk);
  const drinking=retailItemDetails(milk);
  assert.equal(drinking.bodyCost,-500);
  assert.equal(drinking.calories,300);
  assert.match(drinking.comment,/身体消費が回復/);
  assert.equal(drinking.usage,"supported");
  const insurance=retailItemDetails(catalog.find(x=>x.name==="健康保険"));
  assert.equal(insurance.usage,"automatic");
  const card=retailItemDetails(catalog.find(x=>x.name==="クレジットカード"));
  assert.equal(card.usage,"payment");
  assert.match(card.comment,/銀行/);
  const db=fixture();try{
    ensureRetailDay(db,[paper],day,randomIndex);
    const stock=listRetailStock(db,[paper],["depart1"]);
    assert.equal(stock[0].details.effects.looks,2);
    assert.equal(stock[0].details.intervalMinutes,10);
    assert.equal(stock[0].price,paper.unitPrice);
  }finally{db.close();}
});
test("原版「無」不等於沒有使用效果；未支援的特殊代碼不能顯示成已實作",()=>{
  const examples=catalog.filter(x=>x.effect==="無"&&
    retailItemDetails(x).effects.looks!==undefined);
  assert.ok(examples.length>0);
  const unsupported=catalog.find(x=>x.name==="ランドマスター");
  assert.ok(unsupported);
  assert.equal(unsupported.effect,"万能,");
  assert.equal(retailItemDetails(unsupported).usage,"unsupported");
  assert.equal(retailItemDetails(unsupported).effectCode,"万能,");
});

test("新增可實際使用的原版甜點、ステータス 道具、分類複合效果及日制書籍，在百貨顯示已支援",()=>{
  const samples=[
    ["元気パフェ","supported"],
    ["爽快パフェ","supported"],
    ["バイオハザード（wiiバージョン","supported"],
    ["キングダムハーツ2ファイナルミックス＋","supported"],
    ["阪神タイガースの公式チケット","supported"],
    ["どすこいスーパーちゃんこ","supported"],
    ["どすこいスーパーつまみ食い","supported"],
    ["こちら葛飾区亀有公園前派出所　全巻","supported"]
  ];
  for(const [name,usage] of samples){
    const item=catalog.find(x=>x.name===name);
    assert.ok(item,"原版商品不存在："+name);
    assert.equal(retailItemDetails(item).usage,usage,name);
  }
  // 断食セット 的原版價為 0，百貨的安全目錄不能上架；使用效果另由舊檔道具測試。
  assert.equal(catalog.some(x=>x.name==="断食セット"),false);
  for(const [name,usage] of [
    ["無駄知識を覚える本","supported"],
    ["健康保険","automatic"],["クレジットカード","payment"],
    ["ガチャピン","supported"],["防犯カメラ","unsupported"]
  ]){
    const item=catalog.find(x=>x.name===name);
    assert.ok(item,"原版商品不存在："+name);
    assert.equal(retailItemDetails(item).usage,usage,name);
  }
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
test("不同一般商品不得越過 25 格容量，跨日刷新，但原版匯入物品不可被改寫",()=>{
  const db=fixture();try{
    ensureRetailDay(db,catalog,day,randomIndex);
    const selected=listRetailStock(db,catalog,["depart1"]).filter(x=>x.price<=100000&&
      !catalog.find(c=>c.sku===x.sku).effect.includes("ギフト")&&x.category!=="ギフト");
    const distinct=[...new Map(selected.map(x=>[x.name,x])).values()].slice(0,26);
    assert.equal(distinct.length,26);
    // 多種真實上架商品各買一件，確定容量按實際個人物品格而非單一 SKU 計。
    for(let i=0;i<25;i++)buyRetailItem(db,1,catalog,options("depart1",distinct[i].sku,"shop_slot_"+String(i).padStart(7,"0")));
    assert.throws(()=>buyRetailItem(db,1,catalog,options("depart1",distinct[25].sku,"shop_slot_overfull")),/25 格/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=1").get().n,25);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases WHERE user_id=1").get().n,25);
    assert.equal(ensureRetailDay(db,catalog,"2026-10-10",randomIndex),true);
    assert.equal(db.prepare("SELECT day FROM retail_day").get().day,"2026-10-10");
  }finally{db.close();}
});


test("百貨可一次購買 1～5 件並與本人 Web 同品合併耐久；保留使用紀錄及購物防重",()=>{
  const db=fixture();try{
    ensureRetailDay(db,catalog,day,randomIndex);
    const shop=listRetailStock(db,catalog,["depart1"])
      .find(x=>x.stock>=4&&x.price*4<=9999999&&
        x.unit==="回"&&x.category!=="ギフト"&&
        !catalog.find(c=>c.sku===x.sku).effect.includes("ギフト"));
    assert.ok(shop);
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const first=buyRetailItem(db,1,catalog,{...options("depart1",shop.sku,"retail_multi_1"),quantity:2});
    assert.equal(first.quantity,2);
    assert.equal(first.paid,shop.price*2);
    assert.equal(first.merged,false);
    const original=db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=1 AND source_line=?")
      .get(first.sourceLine);
    assert.equal(original.durability,shop.durability*2);
    db.prepare("INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms) VALUES(?,?,?,?)")
      .run(1,first.sourceLine,original.durability-1,now-1000);
    const second=buyRetailItem(db,1,catalog,{...options("depart1",shop.sku,"retail_multi_2"),quantity:2});
    assert.equal(second.sourceLine,first.sourceLine);
    assert.equal(second.merged,true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=1").get().n,1);
    const merged=db.prepare("SELECT durability,raw_fields_json FROM legacy_inventory_items WHERE user_id=1").get();
    assert.equal(merged.durability,shop.durability*4-1);
    assert.equal(JSON.parse(merged.raw_fields_json)[21],String(merged.durability));
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1").get().remaining,merged.durability);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before-shop.price*4);
    assert.equal(listRetailStock(db,catalog,["depart1"]).find(x=>x.sku===shop.sku).stock,shop.stock-4);
    assert.equal(buyRetailItem(db,1,catalog,{...options("depart1",shop.sku,"retail_multi_2"),quantity:2}).replayed,true);
    assert.throws(()=>buyRetailItem(db,1,catalog,{
      ...options("depart1",shop.sku,"retail_multi_2"),quantity:1
    }),/不同商品、數量/);
    assert.equal(listRetailPurchases(db,1)[0].quantity,2);
    assert.equal(listRetailPurchases(db,1)[0].merged,true);
  }finally{db.close();}
});

test("多件購物的數量、現金、庫存與同品上限均在交易中檢查並回滾",()=>{
  const db=fixture();try{
    ensureRetailDay(db,catalog,day,randomIndex);
    const shop=listRetailStock(db,catalog,["depart1"])
      .find(x=>x.stock>=5&&x.price*5<=9999999&&x.category!=="ギフト"&&
        !catalog.find(c=>c.sku===x.sku).effect.includes("ギフト"));
    assert.ok(shop);
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.throws(()=>buyRetailItem(db,1,catalog,{
      ...options("depart1",shop.sku,"retail_invalid_6"),quantity:6
    }),/1～5/);
    const first=buyRetailItem(db,1,catalog,{
      ...options("depart1",shop.sku,"retail_limit_5"),quantity:5
    });
    const after=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.equal(after,before-shop.price*5);
    assert.throws(()=>buyRetailItem(db,1,catalog,{
      ...options("depart1",shop.sku,"retail_limit_more"),quantity:1
    }),/5 件持有上限/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items").get().n,1);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,after);
    assert.equal(listRetailStock(db,catalog,["depart1"]).find(x=>x.sku===shop.sku).stock,shop.stock-5);
    assert.ok(first.sourceLine>0);
  }finally{db.close();}
});

test("原版信用卡有效時可從普通銀行結帳並登帳；過期、他人卡片、餘額不足拒絕",()=>{
  const db=fixture();try{
    const credit=catalog.find(x=>x.effect==="クレジット"&&x.durabilityUnit==="日");
    assert.ok(credit,"原版目錄應存在可驗證的信用卡");
    const fields=[...credit.rawFields];
    fields[30]=String(Math.floor(now/1000)-60);
    const src=712398;
    db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
      "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(1,"legacy_test",src,fields[0],fields[1],fields[9],
      credit.durability,"日",Number(fields[30]),0,JSON.stringify(fields));
    ensureRetailDay(db,catalog,day,randomIndex);
    const shop=listRetailStock(db,catalog,["depart1"])
      .find(x=>x.price<9999999&&x.stock>=1);
    const cash=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const bank=db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank;
    const receipt=buyRetailItem(db,1,catalog,{
      ...options("depart1",shop.sku,"retail_credit_ok"),
      payment:"bank",cardSourceLine:src
    });
    assert.equal(receipt.payment,"bank");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,cash);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,bank-shop.price);
    const ledger=db.prepare("SELECT debit,credit,balance FROM bank_ledger WHERE user_id=1").get();
    assert.deepEqual({...ledger},{debit:shop.price,credit:0,balance:bank-shop.price});
    assert.throws(()=>buyRetailItem(db,2,catalog,{
      ...options("depart1",shop.sku,"retail_credit_other"),
      payment:"bank",cardSourceLine:src
    }),/屬於本人的/);
    db.prepare("UPDATE characters SET bank=0 WHERE user_id=1").run();
    assert.throws(()=>buyRetailItem(db,1,catalog,{
      ...options("depart1",shop.sku,"retail_credit_no_funds"),
      payment:"bank",cardSourceLine:src
    }),/銀行存款不足/);
    const count=db.prepare("SELECT COUNT(*) AS n FROM retail_purchases").get().n;
    assert.equal(count,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger").get().n,1);
  }finally{db.close();}
});

test("購買禮品採獨立 10 格上限，普通持有物不能擠佔禮品購買格",()=>{
  const db=fixture();try{
    const gift=catalog.find(x=>x.category==="ギフト"&&x.basePrice<10000);
    assert.ok(gift);
    ensureRetailDay(db,[gift],day,randomIndex);
    db.prepare("UPDATE retail_stock SET remaining=100 WHERE shop='depart1'").run();
    for(let i=0;i<10;i++){
      const r=buyRetailItem(db,1,[gift],{
        ...options("depart1",gift.sku,"retail_gift_"+String(i).padStart(6,"0")),
        quantity:1
      });
      assert.equal(r.merged,false);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=1 AND category='ギフト'").get().n,10);
    assert.throws(()=>buyRetailItem(db,1,[gift],options("depart1",gift.sku,"retail_gift_full")),/10 格/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases").get().n,10);
  }finally{db.close();}
});

test("舊有購物紀錄升級補上數量及付款方式，不丟失既有訂單",()=>{
  const db=fixture();try{
    db.prepare([
      "INSERT INTO retail_purchases(user_id,shop,sku,name,paid,source_line,request_id,created_at)",
      "VALUES(1,'depart1','old-sku','舊單件商品',100,1000001,'retail_old_purchase',?)"
    ].join(" ")).run(now);
    initRetailTables(db);
    const row=db.prepare("SELECT quantity,payment,merged FROM retail_purchases WHERE request_id='retail_old_purchase'").get();
    assert.deepEqual({...row},{quantity:1,payment:"cash",merged:0});
  }finally{db.close();}
});


test("百貨真正買到的原版健康保険立即讓醫院辨識；直購續保統一期限與五份上限",()=>{
  const db=fixture();try{
    const product=catalog.find(x=>x.name==="健康保険"&&
      x.category==="日用品"&&x.effect==="無"&&x.durabilityUnit==="日");
    assert.ok(product);
    const insurance=parseLegacyInsurance(original);
    ensureRetailDay(db,[product],day,randomIndex);
    assert.equal(hasActiveHealthInsurance(db,1,insurance,now),false);
    const first=buyRetailItem(db,1,[product],{
      ...options("depart1",product.sku,"retail_insurance_1"),quantity:2
    });
    assert.equal(first.paid,product.unitPrice*2);
    assert.equal(hasActiveHealthInsurance(db,1,insurance,now),true);
    assert.equal(inventoryOverview(db,1,insurance,now).remainingDays,60);
    assert.equal(db.prepare("SELECT active_until FROM inventory_items WHERE user_id=1").get().active_until,
      now+60*DAY_MS);
    const direct=buyHealthInsurance(db,1,insurance,3,"retail_insurance_direct",now);
    assert.equal(direct.activeUntil,now+150*DAY_MS);
    assert.equal(inventoryOverview(db,1,insurance,now).remainingDays,150);
    const cash=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const stock=listRetailStock(db,[product],["depart1"])[0].stock;
    assert.throws(()=>buyRetailItem(db,1,[product],{
      ...options("depart1",product.sku,"retail_insurance_over"),quantity:1
    }),/5 份/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,cash);
    assert.equal(listRetailStock(db,[product],["depart1"])[0].stock,stock);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM retail_purchases").get().n,1);
  }finally{db.close();}
});

test("原版ランダム品的百貨預覽不誤寫每項固定 +10，商品仍依原價三倍販售",()=>{
  const original=catalog.find(x=>x.category==="薬"&&x.name==="ランダム品");
  assert.ok(original);
  assert.equal(original.originalLine,113);
  assert.equal(original.basePrice,2000000);
  assert.equal(original.unitPrice,6000000);
  const detail=retailItemDetails(original);
  assert.equal(detail.usage,"supported");
  assert.equal(detail.randomizedEffects,true);
  assert.equal(Object.keys(detail.effects).length,17);
  assert.ok(Object.values(detail.effects).every(value=>value===10));
  const ordinary=retailItemDetails(catalog.find(x=>x.name==="油取り紙"));
  assert.equal(ordinary.randomizedEffects,false);
});

test("原版兩款空値万能商品的可觀察效果可用；移動說明不被視為已完成",()=>{
  const water=catalog.find(x=>x.name==="琵琶湖の水");
  const book=catalog.find(x=>x.name==="無駄知識を覚える本");
  const vehicle=catalog.find(x=>x.name==="ランドマスター");
  const alcohol=catalog.find(x=>x.name==="ぼったくり");
  assert.ok(water&&book&&vehicle&&alcohol);
  assert.equal(retailItemDetails(water).usage,"supported");
  assert.equal(retailItemDetails(water).calories,-100);
  assert.equal(retailItemDetails(water).effects.looks,10);
  assert.equal(retailItemDetails(water).effects.tairyoku,10);
  assert.equal(retailItemDetails(water).effects.kenkou,10);
  assert.equal(retailItemDetails(book).usage,"supported");
  assert.equal(retailItemDetails(book).effects.kokugo,3);
  assert.equal(retailItemDetails(book).effects.love,5);
  assert.equal(retailItemDetails(book).bodyCost,1);
  assert.equal(retailItemDetails(book).brainCost,10);
  assert.equal(retailItemDetails(vehicle).usage,"unsupported");
  assert.equal(retailItemDetails(alcohol).calories,-300);
  assert.equal(retailItemDetails(alcohol).usage,"supported");
});
