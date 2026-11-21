import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_FLOWERS_ZH_TW,displayRetailFlowerName,displayRetailFlowerCategory
} from "../public/retail-flower-translations.js";
import {
  displayRetailItemName,displayRetailItemCategory
} from "../public/retail-item-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=source.split(/\r?\n/).map((line,i)=>({
  sourceLine:i+1,fields:line.split("<>")
})).filter(x=>x.fields[0]==="お花");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原版花卉 29 列、27 種不同名稱完整覆蓋，無不存在的翻譯鍵",()=>{
  assert.equal(rows.length,29);
  const originals=new Set(rows.map(r=>r.fields[1]));
  assert.equal(originals.size,27);
  assert.equal(Object.keys(RETAIL_FLOWERS_ZH_TW).length,27);
  for(const {fields} of rows){
    assert.ok(Object.hasOwn(RETAIL_FLOWERS_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailFlowerName(fields[1]),RETAIL_FLOWERS_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_FLOWERS_ZH_TW[fields[1]]);
  }
  for(const original of Object.keys(RETAIL_FLOWERS_ZH_TW))
    assert.ok(originals.has(original),"原版無此花卉："+original);
});

test("重複的玫瑰菊與仙人掌來源資料相同，但 SKU 和來源行各自保留",()=>{
  const list=parseLegacyRetailCatalog(source).filter(item=>item.category==="お花");
  assert.equal(list.length,29);
  assert.equal(new Set(list.map(item=>item.sku)).size,29);
  assert.equal(new Set(list.map(item=>item.originalLine)).size,29);
  for(const item of list){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(displayRetailItemName(item.name),RETAIL_FLOWERS_ZH_TW[item.name]);
  }
  for(const name of ["マーガレット","サボテン"]){
    const matches=rows.filter(row=>row.fields[1]===name);
    const items=list.filter(item=>item.name===name);
    assert.equal(matches.length,2);
    assert.equal(items.length,2);
    assert.notEqual(items[0].sku,items[1].sku);
    assert.deepEqual(matches[0].fields,matches[1].fields,"重複列不得自行推定不同商品");
    assert.equal(displayRetailItemName(items[0].name),displayRetailItemName(items[1].name));
  }
  assert.deepEqual(rows.filter(x=>x.fields[1]==="マーガレット").map(x=>x.sourceLine),[183,184]);
  assert.deepEqual(rows.filter(x=>x.fields[1]==="サボテン").map(x=>x.sourceLine),[178,200]);
});

test("櫻花盆栽來源名稱的兩個尾端空白與季節限定備註完整保留",()=>{
  const cherry=rows.find(row=>row.fields[1]==="盆栽(桜)  ");
  assert.ok(cherry);
  assert.equal(cherry.sourceLine,195);
  assert.equal(cherry.fields[1],"盆栽(桜)  ");
  assert.equal(cherry.fields[29],"春限定品");
  assert.equal(cherry.fields[17],"100000");
  assert.equal(displayRetailFlowerName(cherry.fields[1]),"櫻花盆栽");
  assert.equal(displayRetailFlowerName(cherry.fields[1].trim()),"盆栽(桜)");
});

test("花束、盆栽與花名保持可辨識譯名；遊戲效果、特店備註不更動",()=>{
  const expected={
    "100本のバラの花束":"100朵玫瑰花束",
    "人生の花束":"人生的花束",
    "ガーベラ":"非洲菊",
    "かすみ草":"滿天星",
    "マーガレット":"瑪格麗特菊",
    "サボテン":"仙人掌",
    "盆栽(松)":"松樹盆栽",
    "盆栽(バラ)":"玫瑰盆栽",
    "小さな花束(ユリ)":"小型百合花束"
  };
  for(const [original,translated] of Object.entries(expected))
    assert.equal(displayRetailItemName(original),translated,original);
  const roses=rows.find(x=>x.fields[1]==="100本のバラの花束").fields;
  assert.equal(roses[18],"15");
  assert.equal(roses[20],"10");
  assert.equal(roses[29],"※専門店限定商品。");
  const odd=rows.find(x=>x.fields[1]==="盆栽(バラ)").fields;
  assert.equal(odd[29],"物好きしか買いません。");
  for(const r of rows)assert.equal(r.fields[9],"無");
  assert.equal(displayRetailFlowerName("未知花名"),"未知花名");
  assert.equal(displayRetailFlowerCategory("お花"),"花卉");
  assert.equal(displayRetailFlowerCategory("薬"),"薬");
  assert.equal(displayRetailItemCategory("お花"),"花卉");
});

test("花卉透過既有共用入口呈現與搜尋，不變更 app.js 或提交的日文識別",()=>{
  assert.match(app,/from "\.\/retail-item-translations\.js"/);
  assert.doesNotMatch(app,/from "\.\/retail-flower-translations\.js"/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailItemName/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailItemCategory\(item\.category\)\.toLocaleLowerCase\("zh-TW"\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
