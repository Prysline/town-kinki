import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_DEPARTMENT_ZH_TW,RETAIL_SUPERMARKET_ZH_TW,RETAIL_CRAFTING_ZH_TW,
  displayRetailDepartmentSupermarketCraftingName,displayRetailDepartmentSupermarketCraftingCategory
} from "../public/retail-department-supermarket-crafting-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const allRows=raw.split(/\r?\n/).map((s,i)=>({line:i+1,fields:s.split("<>")}));
const groups=[
  ["デパート",RETAIL_DEPARTMENT_ZH_TW,3,258],
  ["スーパー",RETAIL_SUPERMARKET_ZH_TW,6,294],
  ["合成",RETAIL_CRAFTING_ZH_TW,4,262]
];

test("百貨公司 3、超市 6、合成 4 原始商品列與翻譯完整對應",()=>{
  for(const [category,dictionary,length,first] of groups){
    const rows=allRows.filter(x=>x.fields[0]===category);
    assert.equal(rows.length,length,category);
    assert.equal(Object.keys(dictionary).length,length,category);
    assert.deepEqual(rows.map(x=>x.line),Array.from({length},(_,i)=>first+i));
    for(const {fields} of rows){
      assert.ok(Object.hasOwn(dictionary,fields[1]),fields[1]);
      assert.equal(displayRetailDepartmentSupermarketCraftingName(fields[1]),dictionary[fields[1]]);
      assert.equal(displayRetailItemName(fields[1]),dictionary[fields[1]]);
    }
    for(const key of Object.keys(dictionary))
      assert.ok(rows.some(row=>row.fields[1]===key),"原始 CGI 無此品項："+key);
    assert.equal(displayRetailItemCategory(category),displayRetailDepartmentSupermarketCraftingCategory(category));
  }
});
test("新分類的 SKU、名稱與特殊原版效果／耐久均由原始 CGI 管理",()=>{
  const categories=new Set(groups.map(x=>x[0]));
  const items=parseLegacyRetailCatalog(raw).filter(x=>categories.has(x.category));
  assert.equal(items.length,13);
  assert.equal(new Set(items.map(x=>x.sku)).size,13);
  for(const item of items){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
  }
  const find=name=>allRows.find(x=>x.fields[1]===name).fields;
  assert.equal(find("断食セット")[9],"ダイエット,30,食料品");
  assert.equal(find("MHP2G")[9],"ギフト");
  assert.equal(find("トムキャット")[21],"6");
  assert.equal(find("トムキャット")[22],"回");
  assert.equal(find("冷蔵庫")[21],"15");
  assert.equal(find("冷蔵庫")[22],"回");
});
test("咖啡跨類別沿用既有譯名，未知商品不翻譯",()=>{
  assert.equal(RETAIL_CRAFTING_ZH_TW["コーヒー"],"咖啡");
  assert.equal(displayRetailItemName("コーヒー"),"咖啡");
  assert.equal(displayRetailItemName("未知商品"),"未知商品");
  assert.equal(displayRetailItemCategory("未知類別"),"未知類別");
});
