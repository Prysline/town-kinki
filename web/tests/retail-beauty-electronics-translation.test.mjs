import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_BEAUTY_ELECTRONICS_ZH_TW,
  displayRetailBeautyElectronicsName,
  displayRetailBeautyElectronicsCategory
} from "../public/retail-beauty-electronics-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=source.split(/\r?\n/).filter(line=>
  line.startsWith("美容<>")||line.startsWith("電化製品<>")).map(line=>line.split("<>"));
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原版 13 件美容用品與 14 件電化製品均有繁體中文顯示名稱",()=>{
  assert.equal(rows.filter(x=>x[0]==="美容").length,13);
  assert.equal(rows.filter(x=>x[0]==="電化製品").length,14);
  assert.equal(rows.length,27);
  const originals=new Set(rows.map(x=>x[1]));
  assert.equal(originals.size,27);
  assert.equal(Object.keys(RETAIL_BEAUTY_ELECTRONICS_ZH_TW).length,27);
  for(const fields of rows){
    assert.ok(Object.hasOwn(RETAIL_BEAUTY_ELECTRONICS_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailBeautyElectronicsName(fields[1]),RETAIL_BEAUTY_ELECTRONICS_ZH_TW[fields[1]]);
    assert.ok(displayRetailBeautyElectronicsName(fields[1]).trim(),fields[1]);
  }
  for(const name of Object.keys(RETAIL_BEAUTY_ELECTRONICS_ZH_TW))
    assert.ok(originals.has(name),"翻譯鍵在原版分類中不存在："+name);
});

test("百貨商品解析仍保留原版類別、原文識別值及 SKU",()=>{
  const list=parseLegacyRetailCatalog(source).filter(item=>
    ["美容","電化製品"].includes(item.category));
  assert.equal(list.length,27);
  for(const item of list){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.ok(Object.hasOwn(RETAIL_BEAUTY_ELECTRONICS_ZH_TW,item.name));
  }
});

test("特殊物品效果與原版備註未因中文名稱而被改寫",()=>{
  const find=name=>rows.find(x=>x[1]===name);
  assert.equal(find("セイ・ノビール")[9],"身長,1");
  assert.match(find("セイ・ノビール")[29],/身長を少し伸ばします/);
  assert.equal(find("スリムアップビューティ")[9],"ダイエット,2");
  assert.equal(find("ヘアーカラー(髪染め)")[29],"茶色");
  assert.match(find("ドラえもん試作一号")[29],/試作品のため壊れやすい/);
  assert.equal(find("年賀状作成機")[28],"100");
  assert.equal(find("Apple1")[17],"50000");
});

test("品牌型號、限定商品及系列玩笑譯名符合目前的校對提案",()=>{
  const examples={
    "シャネルの５番":"香奈兒五號香水",
    "シャネルの限定コフレ":"香奈兒限定美妝禮盒",
    "Dior2004限定KIT":"Dior 2004限定套組",
    "ヌーブラ":"NuBra隱形胸罩",
    "バストアップブラ":"豐胸胸罩",
    "セイ・ノビール":"聖德高",
    "ドラえもん試作一号":"哆啦A夢試作一號",
    "MacG5":"Mac G5",
    "Apple1":"Apple1",
    "MacintoshClassic":"Macintosh Classic",
    "ibook":"iBook",
    "年賀状作成機":"新年賀卡製作機"
  };
  for(const [original,translation] of Object.entries(examples))
    assert.equal(displayRetailBeautyElectronicsName(original),translation,original);
  assert.equal(displayRetailBeautyElectronicsName("未知商品"),"未知商品");
  assert.equal(displayRetailBeautyElectronicsCategory("美容"),"美容用品");
  assert.equal(displayRetailBeautyElectronicsCategory("電化製品"),"電器用品");
  assert.equal(displayRetailBeautyElectronicsCategory("食料品"),"食料品");
});

test("Web 以繁體中文顯示與搜尋，但請求保留原始 SKU、名稱及類別",()=>{
  assert.match(app,/from "\.\/retail-item-translations\.js"/);
  assert.match(app,/name\.textContent=displayRetailItemName\(item\.name\)/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailItemName/);
  assert.match(app,/document\.createTextNode\(displayProductName\(item\.name\)\)/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailItemCategory\(item\.category\)\.toLocaleLowerCase\("zh-TW"\)/);
  assert.match(app,/displayRetailItemName\(purchase\.name\)/);
  assert.match(app,/displayRetailItemName\(entry\.name\)/);
  assert.match(app,/displayRetailItemName\(stock\.name\)/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
