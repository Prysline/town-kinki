import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog, retailItemDetails } from "../src/retail.mjs";
import {
  RETAIL_ADULT_ZH_TW, displayRetailAdultName, displayRetailAdultCategory
} from "../public/retail-adult-translations.js";
import { displayRetailItemName, displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({line:i+1,fields:line.split("<>")}));
const adultRows=rows.filter(({fields})=>fields[0]==="アダルト");
const STAT_INDICES=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];

test("成人用品 12 列逐項有繁中顯示名稱與分類，保留原文商品鍵",()=>{
  assert.equal(adultRows.length,12);
  assert.deepEqual(adultRows.map(x=>x.line),Array.from({length:12},(_,i)=>147+i));
  assert.equal(Object.keys(RETAIL_ADULT_ZH_TW).length,12);
  for(const {fields} of adultRows){
    const name=fields[1];
    assert.ok(Object.hasOwn(RETAIL_ADULT_ZH_TW,name),"缺少來源商品譯名："+name);
    assert.equal(displayRetailAdultName(name),RETAIL_ADULT_ZH_TW[name]);
    assert.equal(displayRetailItemName(name),RETAIL_ADULT_ZH_TW[name]);
    assert.ok(RETAIL_ADULT_ZH_TW[name].trim());
  }
  for(const name of Object.keys(RETAIL_ADULT_ZH_TW))
    assert.ok(adultRows.some(x=>x.fields[1]===name),"原版沒有此商品名稱："+name);
  assert.equal(displayRetailAdultCategory("アダルト"),"成人用品");
  assert.equal(displayRetailItemCategory("アダルト"),"成人用品");
  assert.equal(displayRetailItemName("未知成人用品"),"未知成人用品");
  assert.equal(displayRetailItemCategory("未知分類"),"未知分類");
});

test("成人用品 12 件仍使用原始 SKU、價格、能力、耐久與效果",()=>{
  const items=parseLegacyRetailCatalog(raw).filter(x=>x.category==="アダルト");
  assert.equal(items.length,12);
  assert.equal(new Set(items.map(x=>x.sku)).size,12);
  for(const [i,item] of items.entries()){
    const source=adultRows[i];
    assert.equal(item.originalLine,source.line);
    assert.equal(item.sku,"legacy-"+source.line);
    assert.equal(item.name,source.fields[1]);
    assert.equal(item.category,"アダルト");
    assert.equal(item.effect,"無");
    assert.equal(item.rawFields[9],source.fields[9]);
    assert.equal(item.rawFields[17],source.fields[17]);
    assert.equal(item.rawFields[21],source.fields[21]);
    assert.equal(item.rawFields[22],source.fields[22]);
    assert.equal(item.rawFields[23],source.fields[23]);
    assert.equal(item.rawFields[24],source.fields[24]);
    assert.equal(item.rawFields[25],source.fields[25]);
    assert.equal(item.rawFields[27],source.fields[27]);
    assert.equal(item.rawFields[28],source.fields[28]);
    assert.deepEqual(STAT_INDICES.map(k=>item.rawFields[k]),STAT_INDICES.map(k=>source.fields[k]));
    assert.equal(retailItemDetails(item).effectCode,"無");
  }
  assert.equal(items.find(x=>x.name==="超高級ドール").durabilityUnit,"日");
  assert.equal(items.find(x=>x.name==="勝負ブラジャー").durabilityUnit,"日");
  assert.equal(items.find(x=>x.name==="秘密のビニ本").rawFields[29],"※専門店限定商品。");
  assert.equal(items.find(x=>x.name==="森高千里の手").rawFields[29],"");
});

test("成人用品保守譯名不自行推斷物品未註明的用途",()=>{
  const reviewed={
    "コスプレセット":"角色扮演套組",
    "森高千里の手":"森高千里的手",
    "高級ドール":"高級人偶",
    "超高級ドール":"超高級人偶",
    "勝負ブラジャー":"決勝胸罩",
    "バイアグラ":"威而鋼",
    "こけし":"木芥子人偶",
    "ローター":"跳蛋",
    "秘密のビニ本":"祕密塑封成人雜誌",
    "バイブ":"按摩棒",
    "ロープ":"繩索",
    "勝負パンティ":"決勝內褲"
  };
  for(const [original,translated] of Object.entries(reviewed))
    assert.equal(displayRetailItemName(original),translated,original);
});
