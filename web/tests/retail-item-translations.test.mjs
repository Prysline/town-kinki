import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";
import { EQUIPMENT_ZH_TW,VENDING_ZH_TW } from "../public/item-translations.js";
import { RETAIL_FOOD_ZH_TW } from "../public/retail-food-translations.js";
import { DESSERT_FASTFOOD_ZH_TW } from "../public/retail-dessert-fastfood-translations.js";
import { RETAIL_DRINK_ZH_TW,RETAIL_ALCOHOL_ZH_TW } from "../public/retail-drink-alcohol-translations.js";
import { RETAIL_SPORTS_MEDICINE_ZH_TW } from "../public/retail-sports-medicine-translations.js";
import { RETAIL_BEAUTY_ELECTRONICS_ZH_TW } from "../public/retail-beauty-electronics-translations.js";

const groups=[
  EQUIPMENT_ZH_TW,VENDING_ZH_TW,RETAIL_FOOD_ZH_TW,DESSERT_FASTFOOD_ZH_TW,
  RETAIL_DRINK_ZH_TW,RETAIL_ALCOHOL_ZH_TW,RETAIL_SPORTS_MEDICINE_ZH_TW,
  RETAIL_BEAUTY_ELECTRONICS_ZH_TW
];
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("共用入口保留已合併的四批及美容電化產品全部原文名稱對照",()=>{
  const unique=new Map();
  for(const group of groups)for(const [original,chinese] of Object.entries(group)){
    if(unique.has(original))
      assert.equal(unique.get(original),chinese,"重複商品的繁中譯名不一致："+original);
    else unique.set(original,chinese);
    assert.equal(displayRetailItemName(original),chinese,original);
  }
  assert.ok(unique.size>=162,"百貨翻譯不得遺失前四批或美容電化產品");
  assert.equal(displayRetailItemName("未知物品"),"未知物品");
});

test("共用入口將前五批類別合成繁體中文且未知類別回退原文",()=>{
  const expected={
    "食料品":"食品","デザート":"甜點","ファーストフード":"速食",
    "ドリンク":"飲料","アルコール":"酒類","スポーツ用品":"運動用品",
    "薬":"藥品","美容":"美容用品","電化製品":"電器用品",
    "武器":"武器","御守":"護身符"
  };
  for(const [original,chinese] of Object.entries(expected))
    assert.equal(displayRetailItemCategory(original),chinese,original);
  assert.equal(displayRetailItemCategory("未知分類"),"未知分類");
});

test("app.js 僅載入共用入口，且所有交易仍使用來源 SKU 和原文",()=>{
  assert.match(app,/from "\.\/retail-item-translations\.js"/);
  assert.doesNotMatch(app,/from "\.\/retail-beauty-electronics-translations\.js"/);
  assert.doesNotMatch(app,/const displayRetailItemName=name=>/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailItemName/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailItemCategory\(item\.category\)\.toLocaleLowerCase\("zh-TW"\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});

test("跨分類校對過的商品仍顯示指定譯名",()=>{
  const reviewed={
    "セイ・ノビール":"聖德高",
    "Apple1":"Apple1",
    "ビスコ":"必思可夾心餅乾",
    "オレンジポテト":"橘薯條",
    "カルアミルク":"卡魯哇牛奶",
    "リコリス":"甘草滋補飲",
    "ブラジャードリンク":"胸罩飲料"
  };
  for(const [original,localized] of Object.entries(reviewed))
    assert.equal(displayRetailItemName(original),localized,original);
});
