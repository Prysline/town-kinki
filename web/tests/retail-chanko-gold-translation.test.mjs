import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog,retailItemDetails } from "../src/retail.mjs";
import { 
  RETAIL_CHANKO_ZH_TW,RETAIL_GOLD_BOX_ZH_TW,
  displayRetailChankoGoldName,displayRetailChankoGoldCategory
} from "../public/retail-chanko-gold-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const ini=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
const rows=source.split(/\r?\n/).map((line,i)=>({line:i+1,fields:line.split("<>")}));
const chanko=rows.filter(x=>x.fields[0]==="ちゃんこ");
const gold=rows.filter(x=>x.fields[0]==="金の箱");
const STAT_INDEX=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];

test("原版相撲火鍋 8 列與金色寶箱 1 列均有對應繁中名稱，不改來源鍵",()=>{
  const groups=[
    ["ちゃんこ",chanko,RETAIL_CHANKO_ZH_TW,2],
    ["金の箱",gold,RETAIL_GOLD_BOX_ZH_TW,405]
  ];
  for(const [category,items,map,start] of groups){
    assert.equal(items.length,Object.keys(map).length);
    assert.deepEqual(items.map(x=>x.line),Array.from({length:items.length},(_,i)=>start+i));
    for(const {fields} of items){
      assert.ok(Object.hasOwn(map,fields[1]),"缺少譯名："+fields[1]);
      assert.equal(displayRetailChankoGoldName(fields[1]),map[fields[1]]);
      assert.equal(displayRetailItemName(fields[1]),map[fields[1]]);
    }
    for(const name of Object.keys(map))
      assert.ok(items.some(x=>x.fields[1]===name),"來源沒有此鍵："+name);
    assert.equal(displayRetailItemCategory(category),displayRetailChankoGoldCategory(category));
  }
  assert.equal(displayRetailItemCategory("ちゃんこ"),"相撲火鍋");
  assert.equal(displayRetailItemCategory("金の箱"),"金色寶箱");
});

test("相撲鍋系列的 8 種特殊效果維持原始資料而不是從中文譯名猜測",()=>{
  const effects=[
    "ギフト","食料品","ファ","無",
    "ウエイトアップ,1,ギフト","ウエイトアップ,1,食料品",
    "ウエイトアップ,1,ファ","ウエイトアップ,1"
  ];
  const catalog=parseLegacyRetailCatalog(source).filter(x=>x.category==="ちゃんこ");
  assert.equal(catalog.length,8);
  for(const [i,item] of catalog.entries()){
    const row=chanko[i];
    assert.equal(item.originalLine,row.line);
    assert.equal(item.sku,"legacy-"+row.line);
    assert.equal(item.name,row.fields[1]);
    assert.equal(item.category,"ちゃんこ");
    assert.equal(item.effect,effects[i]);
    assert.equal(item.rawFields[9],effects[i]);
    assert.equal(item.rawFields[21],"2");
    assert.equal(item.rawFields[22],"回");
    assert.equal(item.rawFields[23],"5");
    assert.equal(item.rawFields[25],"1500");
    assert.deepEqual(STAT_INDEX.map(k=>item.rawFields[k]),Array(17).fill("2"));
    assert.equal(retailItemDetails(item).effectCode,effects[i]);
  }
  assert.equal(retailItemDetails(catalog[0]).usage,"gift");
  assert.equal(retailItemDetails(catalog[4]).usage,"gift");
});

test("Landmaster 保留原始金箱分類、特殊效果及戰車備註，未虛構移動功能",()=>{
  const catalog=parseLegacyRetailCatalog(source).filter(x=>x.category==="金の箱");
  assert.equal(catalog.length,1);
  const [item]=catalog;
  assert.equal(item.originalLine,405);
  assert.equal(item.sku,"legacy-405");
  assert.equal(item.name,"ランドマスター");
  assert.equal(item.category,"金の箱");
  assert.equal(item.effect,"万能,");
  assert.equal(item.rawFields[21],"7");
  assert.equal(item.rawFields[22],"回");
  assert.match(item.rawFields[29],/主力戦車/);
  assert.match(item.rawFields[29],/移動手段です/);
  assert.ok(!ini.includes("'ランドマスター'"),"原版移動設定沒有 Landmaster，不能新增該功能");
  assert.equal(retailItemDetails(item).effectCode,"万能,");
  assert.equal(displayRetailItemName("ランドマスター"),"Landmaster");
  assert.equal(displayRetailItemName("未知相撲商品"),"未知相撲商品");
});
