import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import { VENDING_ZH_TW } from "../public/item-translations.js";
import {
  RETAIL_DRINK_ZH_TW,RETAIL_ALCOHOL_ZH_TW,
  displayRetailDrinkAlcoholName,displayRetailDrinkAlcoholCategory
} from "../public/retail-drink-alcohol-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const lines=raw.split(/\r?\n/).map(line=>line.split("<>"));
const rows=lines.filter(x=>["ドリンク","アルコール"].includes(x[0]));
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原版百貨飲料 15 種、酒類 13 種完全對照，沒有多餘的翻譯鍵",()=>{
  const drinks=rows.filter(x=>x[0]==="ドリンク");
  const alcohol=rows.filter(x=>x[0]==="アルコール");
  assert.equal(drinks.length,15);
  assert.equal(alcohol.length,13);
  assert.equal(Object.keys(RETAIL_DRINK_ZH_TW).length,15);
  assert.equal(Object.keys(RETAIL_ALCOHOL_ZH_TW).length,13);
  for(const [source,translations] of [[drinks,RETAIL_DRINK_ZH_TW],[alcohol,RETAIL_ALCOHOL_ZH_TW]]){
    const sourceNames=new Set(source.map(x=>x[1]));
    assert.equal(sourceNames.size,source.length);
    for(const item of source){
      assert.ok(Object.hasOwn(translations,item[1]),item[1]);
      assert.ok(displayRetailDrinkAlcoholName(item[1]).trim(),item[1]);
    }
    for(const original of Object.keys(translations))
      assert.ok(sourceNames.has(original),"原版中不存在的名稱："+original);
  }
});

test("自販機既有 12 種飲料名稱不另造譯名，額外 3 種飲品補齊",()=>{
  assert.equal(Object.keys(VENDING_ZH_TW).length,12);
  for(const [original,localized] of Object.entries(VENDING_ZH_TW))
    assert.equal(RETAIL_DRINK_ZH_TW[original],localized,original);
  assert.equal(RETAIL_DRINK_ZH_TW["元気ミルク"],"活力牛奶");
  assert.equal(RETAIL_DRINK_ZH_TW["ミルク"],"牛奶");
  assert.equal(RETAIL_DRINK_ZH_TW["シロップ"],"糖漿");
  assert.equal(RETAIL_DRINK_ZH_TW["ブラジャードリンク"],"胸罩飲料");
});

test("可交易原始欄位、SKU、名稱、類別不變，特殊效果仍以日文資料為準",()=>{
  const catalog=parseLegacyRetailCatalog(raw).filter(x=>
    ["ドリンク","アルコール"].includes(x.category));
  assert.equal(catalog.length,28);
  for(const item of catalog){
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.ok(Object.hasOwn(
      item.category==="ドリンク"?RETAIL_DRINK_ZH_TW:RETAIL_ALCOHOL_ZH_TW,
      item.name
    ));
  }
  const odd=rows.find(x=>x[1]==="ぼったくり");
  assert.equal(odd[17],"15000");
  assert.equal(odd[25],"-300");
  const milk=rows.find(x=>x[1]==="元気ミルク");
  assert.equal(milk[27],"-500");
  assert.equal(milk[29],"身体消費が回復します。");
});

test("趣味與品牌譯名保留、未知名稱回退原文",()=>{
  const expected={
    "ぼったくり":"敲竹槓",
    "ミックスボトル":"綜合酒瓶",
    "ダイキリ":"黛綺莉",
    "グラスホッパー":"綠色蚱蜢",
    "カルアミルク":"卡魯哇牛奶",
    "フォアローゼス":"四玫瑰",
    "ビール（ピッチャー）":"啤酒（大壺）",
    "ジャックダニエル":"傑克丹尼"
  };
  for(const [original,localized] of Object.entries(expected))
    assert.equal(displayRetailDrinkAlcoholName(original),localized,original);
  assert.equal(displayRetailDrinkAlcoholName("未知酒款"),"未知酒款");
  assert.equal(displayRetailDrinkAlcoholCategory("ドリンク"),"飲料");
  assert.equal(displayRetailDrinkAlcoholCategory("アルコール"),"酒類");
  assert.equal(displayRetailDrinkAlcoholCategory("食料品"),"食料品");
});

test("商店／背包／搜尋／交易紀錄顯示繁體中文，不把譯名送往 API",()=>{
  assert.match(app,/from "\.\/retail-drink-alcohol-translations\.js"/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailDrinkAlcoholName/);
  assert.match(app,/name\.textContent=displayRetailDrinkAlcoholName\(displayKnownItemName\(item\.name\)\)/);
  assert.match(app,/document\.createTextNode\(displayProductName\(item\.name\)\)/);
  assert.match(app,/displayRetailDrinkAlcoholName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailDrinkAlcoholName\(purchase\.name\)/);
  assert.match(app,/displayRetailDrinkAlcoholName\(entry\.name\)/);
  assert.match(app,/displayRetailDrinkAlcoholName\(stock\.name\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
