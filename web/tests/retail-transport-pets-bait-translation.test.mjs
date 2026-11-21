import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_VEHICLES_ZH_TW,RETAIL_PETS_ZH_TW,RETAIL_BAIT_ZH_TW,
  displayRetailTransportPetsBaitName,displayRetailTransportPetsBaitCategory
} from "../public/retail-transport-pets-bait-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const allRows=raw.split(/\r?\n/).map((s,i)=>({line:i+1,fields:s.split("<>")}));
const groups=[
  ["乗り物",RETAIL_VEHICLES_ZH_TW,11,328],
  ["ペット",RETAIL_PETS_ZH_TW,7,267],
  ["餌",RETAIL_BAIT_ZH_TW,4,371]
];

test("交通工具 11、寵物 7、餌料 4 筆原始 CGI 商品均逐筆翻譯",()=>{
  for(const [category,dictionary,total,firstLine] of groups){
    const rows=allRows.filter(x=>x.fields[0]===category);
    assert.equal(rows.length,total,category);
    assert.deepEqual(rows.map(x=>x.line),Array.from({length:total},(_,i)=>i+firstLine));
    assert.equal(Object.keys(dictionary).length,total,category);
    for(const {fields} of rows){
      assert.ok(Object.hasOwn(dictionary,fields[1]),fields[1]);
      assert.equal(displayRetailTransportPetsBaitName(fields[1]),dictionary[fields[1]]);
      assert.equal(displayRetailItemName(fields[1]),dictionary[fields[1]]);
      assert.ok(dictionary[fields[1]].trim());
    }
    for(const key of Object.keys(dictionary))
      assert.ok(rows.some(x=>x.fields[1]===key),"來源沒有此商品："+key);
    assert.notEqual(displayRetailItemCategory(category),category);
    assert.equal(displayRetailItemCategory(category),displayRetailTransportPetsBaitCategory(category));
  }
});

test("原始 SKU、商品分類、來源行與效果不因顯示翻譯而改變",()=>{
  const categories=new Set(groups.map(x=>x[0]));
  const items=parseLegacyRetailCatalog(raw).filter(item=>categories.has(item.category));
  assert.equal(items.length,22);
  assert.equal(new Set(items.map(item=>item.sku)).size,22);
  for(const item of items){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(displayRetailItemName(item.name),displayRetailTransportPetsBaitName(item.name));
  }
  const find=(name)=>allRows.find(x=>x.fields[1]===name).fields;
  assert.equal(find("キリン")[9],"身長,5");
  assert.equal(find("子豚")[9],"ウエイトアップ,2");
  assert.equal(find("豚")[9],"ウエイトアップ,10");
  assert.equal(find("ガチャピン")[21],"3");
  assert.equal(find("ガチャピン")[22],"日");
  assert.equal(find("魚ルアー（中）")[29],"ルアーだけど一応餌です。");
  assert.equal(find("小エビ")[29],"乾燥してます。");
  assert.equal(find("ローラースルーゴーゴー")[29],"※移動手段です。");
});

test("專有車款、角色名稱與原文未知商品維持可辨識的名稱",()=>{
  const expected={
    "ナナハン":"750cc 重機",
    "スカイラインGTR":"Nissan Skyline GT-R",
    "ローラースルーゴーゴー":"Roller Through GOGO（三輪滑板車）",
    "ガチャピン":"Gachapin（綠色恐龍）",
    "魚ルアー（大）":"釣魚路亞（大）"
  };
  for(const [original,translated] of Object.entries(expected))
    assert.equal(displayRetailItemName(original),translated);
  assert.equal(displayRetailItemName("未知商品"),"未知商品");
  assert.equal(displayRetailItemCategory("未知分類"),"未知分類");
});
