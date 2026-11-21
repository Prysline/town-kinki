import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_FOOD_ZH_TW,displayRetailFoodName,displayRetailFoodCategory
} from "../public/retail-food-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const originalRows=raw.split(/\r?\n/).filter(line=>line.startsWith("食料品<>"))
  .map(line=>line.split("<>"));
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原版食料品 39 筆都有單一繁體中文對照，沒有無來源或空白譯名",()=>{
  assert.equal(originalRows.length,39);
  assert.equal(Object.keys(RETAIL_FOOD_ZH_TW).length,39);
  const names=new Set(originalRows.map(x=>x[1]));
  assert.equal(names.size,39);
  for(const fields of originalRows){
    const original=fields[1];
    assert.ok(Object.hasOwn(RETAIL_FOOD_ZH_TW,original),original);
    assert.ok(displayRetailFoodName(original).trim(),"未提供顯示名稱："+original);
    assert.equal(displayRetailFoodName(original),RETAIL_FOOD_ZH_TW[original]);
  }
  for(const name of Object.keys(RETAIL_FOOD_ZH_TW))
    assert.ok(names.has(name),"翻譯表含未出現在原始食品來源的名稱："+name);
});

test("37 種一般百貨候選食品與兩種原版秘傳商品分開處理",()=>{
  const live=parseLegacyRetailCatalog(raw).filter(x=>x.category==="食料品");
  assert.equal(live.length,37);
  for(const item of live){
    assert.equal(displayRetailFoodName(item.name),RETAIL_FOOD_ZH_TW[item.name]);
    assert.ok(item.sku.startsWith("legacy-"));
    assert.ok(item.originalLine>0);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.rawFields[0],"食料品");
  }
  const secret=originalRows.filter(fields=>fields[29].includes("秘伝商品"));
  assert.deepEqual(secret.map(x=>x[1]),["中国秘伝のたれ","究極の壺スープ"]);
  for(const fields of secret){
    assert.ok(Object.hasOwn(RETAIL_FOOD_ZH_TW,fields[1]));
    assert.ok(!live.some(item=>item.name===fields[1]));
  }
});

test("既定食堂用語與胸罩系列統一，韓式煎餅的縮身效果不誤譯成普通菜色",()=>{
  const expected={
    "ブラジャーランチ（持ち帰り）":"胸罩午餐（外帶）",
    "お好み焼き弁当":"御好燒便當",
    "スパゲッティ（持ち帰り）":"義大利麵（外帶）",
    "究極の壺スープ":"究極瓦罐湯",
    "中国秘伝のたれ":"中國秘傳醬汁",
    "チヂミ":"縮縮韓式煎餅",
    "ゴディバチョコレート":"GODIVA巧克力",
    "ビスコ":"必思可夾心餅乾"
  };
  for(const [key,value] of Object.entries(expected))
    assert.equal(displayRetailFoodName(key),value,key);
  const chijimi=originalRows.find(x=>x[1]==="チヂミ");
  assert.equal(chijimi[9],"縮み,1");
  assert.match(chijimi[29],/身長が少し縮みます/);
});

test("未知品項回退原名；食品類別只在顯示時翻譯",()=>{
  assert.equal(displayRetailFoodName("未知食品"),"未知食品");
  assert.equal(displayRetailFoodCategory("食料品"),"食品");
  assert.equal(displayRetailFoodCategory("ドリンク"),"ドリンク");
});

test("UI 可用繁體中文搜尋食品，商品與持有物使用中文顯示，但交易保留原始 SKU 與名稱",()=>{
  assert.match(app,/import \{ displayRetailFoodName,displayRetailFoodCategory \} from "\.\/retail-food-translations\.js"/);
  assert.match(app,/document\.createTextNode\(displayProductName\(item\.name\)\)/);
  assert.match(app,/name\.textContent=displayRetailItemName\(item\.name\)/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailItemCategory\(item\.category\)\.toLocaleLowerCase\("zh-TW"\)/);
  assert.match(app,/displayRetailItemName\(purchase\.name\)/);
  assert.match(app,/displayRetailItemName\(result\.name\)/);
  assert.match(app,/displayRetailItemName\(stock\.name\)/);
  assert.match(app,/displayRetailItemName\(entry\.name\)/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/sku:item\.sku/);
  assert.match(app,/name:item\.name/);
  assert.match(app,/if\(item\.category!==category\)/);
});
