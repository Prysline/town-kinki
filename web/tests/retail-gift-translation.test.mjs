import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog,retailItemDetails } from "../src/retail.mjs";
import { RETAIL_GIFTS_ZH_TW,displayRetailGiftName,displayRetailGiftCategory } from "../public/retail-gift-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const townIni=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
const rows=source.split(/\r?\n/).map((line,i)=>({line:i+1,fields:line.split("<>")}));
const gifts=rows.filter(x=>x.fields[0]==="ギフト");

test("禮品 22 筆原始商品逐列均有繁中顯示名稱且 key 不變",()=>{
  assert.equal(gifts.length,22);
  assert.equal(Object.keys(RETAIL_GIFTS_ZH_TW).length,22);
  assert.deepEqual(gifts.map(x=>x.line),Array.from({length:22},(_,i)=>383+i));
  for(const {fields} of gifts){
    assert.ok(Object.hasOwn(RETAIL_GIFTS_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailGiftName(fields[1]),RETAIL_GIFTS_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_GIFTS_ZH_TW[fields[1]]);
    assert.ok(RETAIL_GIFTS_ZH_TW[fields[1]].trim());
  }
  for(const name of Object.keys(RETAIL_GIFTS_ZH_TW))
    assert.ok(gifts.some(x=>x.fields[1]===name),"非原版來源鍵："+name);
  assert.equal(displayRetailGiftCategory("ギフト"),"禮品");
  assert.equal(displayRetailItemCategory("ギフト"),"禮品");
});

test("禮品原始 SKU／分類／效果及禮物用途與翻譯互不干涉",()=>{
  const catalog=parseLegacyRetailCatalog(source).filter(item=>item.category==="ギフト");
  assert.equal(catalog.length,22);
  assert.equal(new Set(catalog.map(item=>item.sku)).size,22);
  for(const item of catalog){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.rawFields[9],"無");
    assert.equal(retailItemDetails(item).usage,"gift");
  }
  const find=name=>gifts.find(x=>x.fields[1]===name).fields;
  assert.equal(find("船艦大和")[22],"日");
  assert.equal(find("船艦大和")[21],"10");
  assert.equal(find("船艦大和")[29],"移動手段です");
  assert.equal(find("ポルシェ")[29],"※移動手段です。");
  assert.equal(find("祝花（特上）")[29],"※専門店限定商品。");
  assert.equal(find("スーパースッポンエキス")[29],"※専門店限定商品。");
  assert.equal(find("スッポン定食セット")[29],"愛情たっぷり");
});

test("原版禮品車輛維持交通工具辨識，不因翻譯而改成其他來源分類",()=>{
  for(const key of ["ポルシェ","ジャガー","キャデラック","ミグ25","BMW","フェアレディZ","ベスパ"]){
    assert.ok(townIni.includes("'"+key+"'"),"原版行動設定沒有此交通工具："+key);
    assert.ok(gifts.some(x=>x.fields[1]===key),key);
  }
  // 船艦大和的備註提到移動，但原版移動工具表未將其列入；不虛構功能。
  assert.ok(!townIni.includes("'船艦大和'"));
  assert.equal(displayRetailItemName("ポルシェ"),"保時捷");
  assert.equal(displayRetailItemName("フェアレディZ"),"日產 Fairlady Z");
  assert.equal(displayRetailItemName("ディズニーDENPO"),"迪士尼電報");
  assert.equal(displayRetailItemName("未知禮品"),"未知禮品");
  assert.equal(displayRetailItemCategory("未知分類"),"未知分類");
});
