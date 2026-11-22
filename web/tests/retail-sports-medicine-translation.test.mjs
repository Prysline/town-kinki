import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_SPORTS_MEDICINE_ZH_TW,
  displayRetailSportsMedicineName,displayRetailSportsMedicineCategory
} from "../public/retail-sports-medicine-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=source.split(/\r?\n/).filter(x=>
  x.startsWith("スポーツ用品<>")||x.startsWith("薬<>")).map(x=>x.split("<>"));
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("運動用品 16 筆、藥品 17 筆原版名稱完整覆蓋且無多餘的翻譯鍵",()=>{
  assert.equal(rows.filter(x=>x[0]==="スポーツ用品").length,16);
  assert.equal(rows.filter(x=>x[0]==="薬").length,17);
  assert.equal(Object.keys(RETAIL_SPORTS_MEDICINE_ZH_TW).length,33);
  const names=new Set(rows.map(x=>x[1]));
  assert.equal(names.size,33);
  for(const row of rows){
    assert.ok(Object.hasOwn(RETAIL_SPORTS_MEDICINE_ZH_TW,row[1]),row[1]);
    assert.ok(displayRetailSportsMedicineName(row[1]).trim(),row[1]);
    assert.equal(displayRetailSportsMedicineName(row[1]),RETAIL_SPORTS_MEDICINE_ZH_TW[row[1]]);
  }
  for(const name of Object.keys(RETAIL_SPORTS_MEDICINE_ZH_TW))
    assert.ok(names.has(name),"原版不存在的譯名："+name);
});

test("原版來源行、SKU、商品類別與特殊效果碼保持原文不變",()=>{
  const goods=parseLegacyRetailCatalog(source).filter(x=>
    ["スポーツ用品","薬"].includes(x.category));
  assert.equal(goods.length,33);
  for(const item of goods){
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.ok(Object.hasOwn(RETAIL_SPORTS_MEDICINE_ZH_TW,item.name));
  }
  const original=name=>rows.find(x=>x[1]===name);
  assert.equal(original("ウェイトアップ器具")[9],"ウエイトアップ,4");
  assert.equal(original("身長アップ器具")[9],"身長,1");
  assert.equal(original("背が伸びる薬")[9],"身長,1");
  assert.equal(original("背が縮む薬")[9],"縮み,1");
  assert.equal(original("頭が良くなる薬")[9],"無");
  assert.equal(original("ランダム品")[9],"無");
  assert.equal(original("タフマン")[9],"風邪,7,ギフト");
});

test("品牌、特殊商品與日常用品譯名都與原版效果相容",()=>{
  const expected={
    "鉄下駄":"鐵木屐",
    "ルームランナー":"室內跑步機",
    "エアロバイク":"健身車",
    "シットアップベンチ":"仰臥起坐椅",
    "パワーリスト":"負重護腕",
    "超プレミアエアジョーダン":"超珍藏版喬丹鞋",
    "ユンケル":"勇健好",
    "リポビタンD":"力保美達D",
    "リコリス":"甘草滋補飲",
    "おばあちゃんの知恵薬":"阿嬤的智慧藥",
    "頭が良くなる薬":"變聰明的藥",
    "タフマン":"Tough-Man元氣飲",
    "ランダム品":"隨機商品"
  };
  for(const [original,translation] of Object.entries(expected))
    assert.equal(displayRetailSportsMedicineName(original),translation,original);
  assert.equal(displayRetailSportsMedicineName("未知道具"),"未知道具");
  assert.equal(displayRetailSportsMedicineCategory("スポーツ用品"),"運動用品");
  assert.equal(displayRetailSportsMedicineCategory("薬"),"藥品");
  assert.equal(displayRetailSportsMedicineCategory("食料品"),"食料品");
});

test("Web 顯示與搜尋使用中文，購買、使用與裝備操作仍傳原始名稱及 SKU",()=>{
  assert.match(app,/from "\.\/retail-item-translations\.js"/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailItemName/);
  assert.match(app,/document\.createTextNode\(displayProductName\(item\.name\)\)/);
  assert.match(app,/name\.textContent=displayRetailItemName\(item\.name\)/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailItemName\(purchase\.name\)/);
  assert.match(app,/displayRetailItemName\(entry\.name\)/);
  assert.match(app,/displayRetailItemName\(stock\.name\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
