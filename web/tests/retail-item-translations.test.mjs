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
import { RETAIL_FLOWERS_ZH_TW } from "../public/retail-flower-translations.js";
import { RETAIL_DAILY_GOODS_ZH_TW } from "../public/retail-daily-goods-translations.js";
import { RETAIL_GAMES_ZH_TW } from "../public/retail-game-translations.js";
import { RETAIL_VEHICLES_ZH_TW,RETAIL_PETS_ZH_TW,RETAIL_BAIT_ZH_TW } from "../public/retail-transport-pets-bait-translations.js";
import { RETAIL_TOHOKU_SPECIALTIES_ZH_TW,RETAIL_KANSAI_SPECIALTIES_ZH_TW } from "../public/retail-regional-specialties-translations.js";
import { RETAIL_DEPARTMENT_ZH_TW,RETAIL_SUPERMARKET_ZH_TW,RETAIL_CRAFTING_ZH_TW } from "../public/retail-department-supermarket-crafting-translations.js";
import { RETAIL_GIFTS_ZH_TW } from "../public/retail-gift-translations.js";
import { RETAIL_SECRET_GOODS_ZH_TW } from "../public/retail-secret-goods-translations.js";
import { RETAIL_CHANKO_ZH_TW,RETAIL_GOLD_BOX_ZH_TW } from "../public/retail-chanko-gold-translations.js";
import { RETAIL_DVD_ZH_TW } from "../public/retail-dvd-translations.js";
import { RETAIL_BOOKS_ZH_TW } from "../public/retail-book-translations.js";
import { RETAIL_ADULT_ZH_TW } from "../public/retail-adult-translations.js";

const groups=[
  EQUIPMENT_ZH_TW,VENDING_ZH_TW,RETAIL_FOOD_ZH_TW,DESSERT_FASTFOOD_ZH_TW,
  RETAIL_DRINK_ZH_TW,RETAIL_ALCOHOL_ZH_TW,RETAIL_SPORTS_MEDICINE_ZH_TW,
  RETAIL_BEAUTY_ELECTRONICS_ZH_TW,RETAIL_FLOWERS_ZH_TW,RETAIL_DAILY_GOODS_ZH_TW,
  RETAIL_GAMES_ZH_TW,RETAIL_VEHICLES_ZH_TW,RETAIL_PETS_ZH_TW,RETAIL_BAIT_ZH_TW,
  RETAIL_TOHOKU_SPECIALTIES_ZH_TW,RETAIL_KANSAI_SPECIALTIES_ZH_TW,
  RETAIL_DEPARTMENT_ZH_TW,RETAIL_SUPERMARKET_ZH_TW,RETAIL_CRAFTING_ZH_TW,
  RETAIL_GIFTS_ZH_TW,
  RETAIL_SECRET_GOODS_ZH_TW,
  RETAIL_CHANKO_ZH_TW,RETAIL_GOLD_BOX_ZH_TW,
  RETAIL_DVD_ZH_TW,
  RETAIL_BOOKS_ZH_TW,
  RETAIL_ADULT_ZH_TW
];
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("共用入口保留所有已確認品項、花卉、日用品與遊戲名稱對照",()=>{
  const unique=new Map();
  for(const group of groups)for(const [original,chinese] of Object.entries(group)){
    if(unique.has(original))
      assert.equal(unique.get(original),chinese,"重複商品的繁中譯名不一致："+original);
    else unique.set(original,chinese);
    assert.equal(displayRetailItemName(original),chinese,original);
  }
  assert.ok(unique.size>=411,"百貨翻譯不得遺失已確認品項與成人用品 12 列");
  assert.equal(displayRetailItemName("未知物品"),"未知物品");
});

test("共用入口將已確認分類、花卉、日用品及遊戲轉成繁體中文且未知類別回退原文",()=>{
  const expected={
    "食料品":"食品","デザート":"甜點","ファーストフード":"速食",
    "ドリンク":"飲料","アルコール":"酒類","スポーツ用品":"運動用品",
    "薬":"藥品","美容":"美容用品","電化製品":"電器用品",
    "お花":"花卉","日用品":"日用品","ゲーム":"遊戲",
    "乗り物":"交通工具","ペット":"寵物","餌":"餌料",
    "東北名産店":"東北名產店","関西名産店":"關西名產店",
    "デパート":"百貨公司","スーパー":"超級市場","合成":"合成",
    "ギフト":"禮品","秘密の商品":"秘密商品",
    "ちゃんこ":"相撲料理","金の箱":"金色寶箱",
    "DVD":"DVD","書籍":"書籍","アダルト":"成人用品",
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
