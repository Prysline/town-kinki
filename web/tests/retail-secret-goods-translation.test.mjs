import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import { 
  RETAIL_SECRET_GOODS_ZH_TW,displayRetailSecretGoodsName,displayRetailSecretGoodsCategory
} from "../public/retail-secret-goods-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({line:i+1,fields:line.split("<>")}));
const products=rows.filter(x=>x.fields[0]==="秘密の商品");
const STAT_INDEXES=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];

test("秘密商品 14 列逐一對照原始 CGI 並使用繁中顯示名稱",()=>{
  assert.equal(products.length,14);
  assert.equal(Object.keys(RETAIL_SECRET_GOODS_ZH_TW).length,14);
  assert.deepEqual(products.map(x=>x.line),Array.from({length:14},(_,i)=>242+i));
  for(const {fields} of products){
    assert.ok(Object.hasOwn(RETAIL_SECRET_GOODS_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailSecretGoodsName(fields[1]),RETAIL_SECRET_GOODS_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_SECRET_GOODS_ZH_TW[fields[1]]);
    assert.ok(RETAIL_SECRET_GOODS_ZH_TW[fields[1]].trim());
  }
  for(const key of Object.keys(RETAIL_SECRET_GOODS_ZH_TW))
    assert.ok(products.some(x=>x.fields[1]===key),"來源未含此 key："+key);
  assert.equal(displayRetailSecretGoodsCategory("秘密の商品"),"秘密商品");
  assert.equal(displayRetailItemCategory("秘密の商品"),"秘密商品");
});

test("秘密商品來源鍵、SKU、耐久和特殊商品備註不因翻譯改變",()=>{
  const catalog=parseLegacyRetailCatalog(raw).filter(x=>x.category==="秘密の商品");
  assert.equal(catalog.length,14);
  assert.equal(new Set(catalog.map(x=>x.sku)).size,14);
  for(const item of catalog){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.rawFields[9],"無");
    assert.equal(item.rawFields[22],"回");
  }
  const get=name=>products.find(x=>x.fields[1]===name).fields;
  assert.equal(get("ダイヤモンド")[29],"※専門店限定商品。");
  assert.equal(get("知性のリング")[29],"※専門店限定商品。");
  assert.equal(get("科学のペンダント")[29],"強化育成。");
  assert.equal(get("文化のペンダント")[29],"強化育成。");
});

test("能力石名稱直接依來源 33 欄的唯一非零能力欄展開",()=>{
  // 原始欄位：2 國語，3 數學，4 理科，5 社會，6 英語，7 音樂，8 美術，
  // 10 外貌，11 體力，12 健康，13 速度，14 力量，15 腕力，16 腳力，18 LOVE，19 趣味，20 色色。
  const cases=[
    ["体力の石","體力之石",11,3],
    ["健の石","健康之石",12,3],
    ["スの石","速度之石",13,3],
    ["パの石","力量之石",14,3],
    ["腕の石","腕力之石",15,3],
    ["脚の石","腳力之石",16,3],
    ["英の石","英語之石",6,15]
  ];
  for(const [original,display,index,bonus] of cases){
    const source=products.find(x=>x.fields[1]===original);
    assert.ok(source,original);
    const actual=STAT_INDEXES.filter(x=>Number(source.fields[x])!==0);
    assert.deepEqual(actual,[index],"能力石沒有符合唯一來源效果："+original);
    assert.equal(Number(source.fields[index]),bonus,original);
    assert.equal(displayRetailItemName(original),display);
  }
  assert.equal(displayRetailItemName("未知道具"),"未知道具");
  assert.equal(displayRetailItemCategory("未知分類"),"未知分類");
});
