import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  DESSERT_FASTFOOD_ZH_TW, displayDessertFastFoodName, displayDessertFastFoodCategory
} from "../public/retail-dessert-fastfood-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const sourceRows=source.split(/\r?\n/).filter(line=>
  line.startsWith("デザート<>")||line.startsWith("ファーストフード<>"))
  .map(line=>line.split("<>"));
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原版甜點 15 種、速食 20 種都有對應的繁體中文顯示名稱",()=>{
  const dessert=sourceRows.filter(fields=>fields[0]==="デザート");
  const fastFood=sourceRows.filter(fields=>fields[0]==="ファーストフード");
  assert.equal(dessert.length,15);
  assert.equal(fastFood.length,20);
  assert.equal(Object.keys(DESSERT_FASTFOOD_ZH_TW).length,35);
  const originals=new Set(sourceRows.map(fields=>fields[1]));
  assert.equal(originals.size,35);
  for(const fields of sourceRows){
    const original=fields[1];
    assert.ok(Object.hasOwn(DESSERT_FASTFOOD_ZH_TW,original),original);
    assert.ok(displayDessertFastFoodName(original).trim(),original);
    assert.equal(displayDessertFastFoodName(original),DESSERT_FASTFOOD_ZH_TW[original]);
  }
  for(const name of Object.keys(DESSERT_FASTFOOD_ZH_TW))
    assert.ok(originals.has(name),"翻譯表有不存在於來源的品名："+name);
});

test("目前百貨解析可保留 35 筆來源名稱、分類、來源行與 SKU",()=>{
  const catalog=parseLegacyRetailCatalog(source).filter(item=>
    ["デザート","ファーストフード"].includes(item.category));
  assert.equal(catalog.length,35);
  for(const item of catalog){
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.rawFields[0],item.category);
    assert.ok(item.sku.startsWith("legacy-"));
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.ok(Object.hasOwn(DESSERT_FASTFOOD_ZH_TW,item.name));
  }
});

test("胸罩漢堡系列保留相同詞根；其他商品留存品牌與特殊用語",()=>{
  const expected={
    "ブラジャーバーガー":"胸罩漢堡",
    "ブラジャーバーガー特":"胸罩漢堡（特製）",
    "ポン・デ・リング":"波堤甜甜圈",
    "D-ポップ":"D-POP迷你甜甜圈",
    "ビッグマック":"大麥克",
    "匠味":"匠味",
    "オレンジポテト":"橘薯條",
    "うまい棒１００本（タコヤキ味）":"美味棒100根（章魚燒口味）"
  };
  for(const [original,translated] of Object.entries(expected))
    assert.equal(displayDessertFastFoodName(original),translated,original);
  assert.equal(sourceRows.find(fields=>fields[1]==="オレンジポテト")[29],
    "オレポテの由来、オレンジポテトです。");
  assert.equal(sourceRows.find(fields=>fields[1]==="ブラジャーバーガー")[20],"10");
});

test("未收錄品名及非目標分類回退原文",()=>{
  assert.equal(displayDessertFastFoodName("不存在的商品"),"不存在的商品");
  assert.equal(displayDessertFastFoodCategory("デザート"),"甜點");
  assert.equal(displayDessertFastFoodCategory("ファーストフード"),"速食");
  assert.equal(displayDessertFastFoodCategory("食料品"),"食料品");
});

test("Web 介面顯示繁體中文、可搜尋中文，但操作維持原始 SKU、名稱及類別",()=>{
  assert.match(app,/from "\.\/retail-dessert-fastfood-translations\.js"/);
  assert.match(app,/displayDessertFastFoodName\(displayKnownItemName\(item\.name\)\)/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayDessertFastFoodName/);
  assert.match(app,/document\.createTextNode\(displayProductName\(item\.name\)\)/);
  assert.match(app,/displayDessertFastFoodName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayDessertFastFoodCategory\(item\.category\)\.toLocaleLowerCase\("zh-TW"\)/);
  assert.match(app,/displayDessertFastFoodName\(purchase\.name\)/);
  assert.match(app,/displayDessertFastFoodName\(entry\.name\)/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
