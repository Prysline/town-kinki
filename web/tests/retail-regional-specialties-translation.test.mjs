import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_TOHOKU_SPECIALTIES_ZH_TW,RETAIL_KANSAI_SPECIALTIES_ZH_TW,
  displayRetailRegionalName,displayRetailRegionalCategory
} from "../public/retail-regional-specialties-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({number:i+1,fields:line.split("<>")}));
const groups=[
  ["東北名産店",RETAIL_TOHOKU_SPECIALTIES_ZH_TW,14,314],
  ["関西名産店",RETAIL_KANSAI_SPECIALTIES_ZH_TW,8,375]
];

test("東北 14／關西 8 列名產全部有繁中名稱且沒有虛構來源鍵",()=>{
  for(const [category,dictionary,size,firstLine] of groups){
    const source=rows.filter(x=>x.fields[0]===category);
    assert.equal(source.length,size);
    assert.equal(Object.keys(dictionary).length,size);
    assert.deepEqual(source.map(x=>x.number),Array.from({length:size},(_,i)=>firstLine+i));
    for(const {fields} of source){
      assert.ok(Object.hasOwn(dictionary,fields[1]),fields[1]);
      assert.equal(displayRetailRegionalName(fields[1]),dictionary[fields[1]]);
      assert.equal(displayRetailItemName(fields[1]),dictionary[fields[1]]);
    }
    for(const name of Object.keys(dictionary))
      assert.ok(source.some(x=>x.fields[1]===name),"非原始 CGI 的名稱："+name);
    assert.equal(displayRetailItemCategory(category),displayRetailRegionalCategory(category));
  }
});

test("分類仍照原始 CGI、所有名產 SKU 和原始效果值保持不變",()=>{
  const cats=new Set(groups.map(x=>x[0]));
  const items=parseLegacyRetailCatalog(raw).filter(item=>cats.has(item.category));
  assert.equal(items.length,22);
  assert.equal(new Set(items.map(x=>x.sku)).size,22);
  for(const item of items){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(displayRetailItemName(item.name),displayRetailRegionalName(item.name));
  }
  const get=name=>rows.find(x=>x.fields[1]===name).fields;
  assert.equal(get("蔵王温泉湯の花")[9],"ダイエット,1");
  assert.equal(get("宮城伝統こけし")[9],"万能,5,ギフト");
  assert.equal(get("白神山地ガイドマップ")[9],"ダイエット,2");
  assert.equal(get("琵琶湖の水")[9],"万能,");
  assert.equal(get("有田みかん")[9],"風邪,20");
  assert.equal(get("阪神タイガースの公式チケット")[9],"ステータス");
  assert.equal(get("楽天ゴールデンゴールズ試合観覧特別優待券")[9],"ダイエット,1,ギフト");
  assert.equal(get("新型野郎箪笥")[29],"仙台箪笥です。");
});

test("名產詞彙、球隊與人偶保有原文辨識，未知來源直接回退",()=>{
  assert.equal(displayRetailItemName("食い倒れ人形"),"食倒太郎人偶");
  assert.equal(displayRetailItemName("きりたんぽ鍋セット"),"烤米棒鍋組");
  assert.equal(displayRetailItemName("仙台名物ずんだもち"),"仙台名產毛豆麻糬");
  assert.equal(displayRetailItemName("阪神タイガースの公式チケット"),"阪神虎官方門票");
  assert.equal(displayRetailItemName("未知名產"),"未知名產");
});
