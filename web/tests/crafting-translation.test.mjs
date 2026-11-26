import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseOriginalCrafting} from "../src/crafting.mjs";
import {displayRetailItemName,displayRetailItemCategory} from "../public/retail-item-translations.js";
import {CRAFTING_DISPLAY_NAMES_ZH_TW} from "../public/crafting-translations.js";
import {RETAIL_CRAFTING_ZH_TW} from "../public/retail-department-supermarket-crafting-translations.js";
import {RETAIL_GIFTS_ZH_TW} from "../public/retail-gift-translations.js";
import {DESSERT_FASTFOOD_ZH_TW} from "../public/retail-dessert-fastfood-translations.js";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/gousei.cgi",import.meta.url)));
const recipes=parseOriginalCrafting(source);
const rawRows=source.split(/\r?\n/).filter(Boolean).map(line=>{
  const fields=line.split("<>");
  if(fields.length===34&&fields[33]==="")fields.pop();
  return fields;
});
const products=[
  ["アイスコーヒー","冰咖啡"],
  ["ホットコーヒー","熱咖啡"],
  ["焙煎アイスコーヒー","烘焙冰咖啡"],
  ["焙煎ホットコーヒー","烘焙熱咖啡"],
  ["ミルクコーヒー","牛奶咖啡"],
  ["アイスクリーム","冰淇淋"],
  ["シロノワール","冰與火"],
  ["健康汁","健康汁"],
  ["韓国語を習う本","韓語學習書"],
  ["阪神タイガースの選手のレアなサイン","阪神虎球員珍稀親筆簽名"],
  ["万能おばちゃんロボット1号","萬能阿姨機器人1號"],
  ["純金製ミグ25","純金製米格-25戰鬥機"]
];
const materials=[
  ["冷蔵庫","冰箱"],["コーヒー","咖啡"],["ポット","熱水壺"],
  ["コーヒー豆","咖啡豆"],["ミルク","牛奶"],["クロワッサン","可頌"],
  ["アイスクリーム","冰淇淋"],["シロップ","糖漿"],
  ["おばちゃんの力","阿姨的力量"],["青汁","青汁"],
  ["おばあちゃんの知恵袋","阿嬤的生活智慧"],
  ["阪神タイガースの公式チケット","阪神虎官方門票"],
  ["おばあちゃんの知恵薬（スーパー）","阿嬤的智慧藥（超級版）"],
  ["金塊","金塊"],["ミグ25","米格-25戰鬥機"]
];
const originalFormula=[
  [["冷蔵庫",1],["コーヒー",1]],
  [["ポット",1],["コーヒー",1]],
  [["冷蔵庫",1],["コーヒー豆",1]],
  [["ポット",1],["コーヒー豆",1]],
  [["ポット",1],["コーヒー",1],["ミルク",1]],
  [["冷蔵庫",1],["ミルク",2]],
  [["クロワッサン",1],["アイスクリーム",1],["シロップ",1]],
  [["おばちゃんの力",1],["青汁",1]],
  [["おばちゃんの力",1],["おばあちゃんの知恵袋",1]],
  [["おばちゃんの力",1],["阪神タイガースの公式チケット",1]],
  [["おばちゃんの力",5],["おばあちゃんの知恵袋",5],
    ["おばあちゃんの知恵薬（スーパー）",5]],
  [["金塊",5],["ミグ25",5]]
];

test("12 種合成成品逐列以來源配方對照，僅新增10個成品譯名",()=>{
  assert.equal(recipes.length,12);
  assert.equal(products.length,12);
  assert.deepEqual(recipes.map(x=>x.name),products.map(x=>x[0]));
  assert.equal(new Set(products.map(x=>x[0])).size,12);
  for(let i=0;i<recipes.length;i++){
    const recipe=recipes[i],fields=rawRows[i];
    assert.equal(fields.length,33);
    assert.equal(recipe.rawFields.length,33);
    assert.equal(fields[1].split("=")[0],recipe.name);
    assert.equal(recipe.rawFields[1],recipe.name);
    assert.equal(recipe.rawFields[29],fields[29],"原版備註不得受顯示翻譯影響");
    assert.equal(recipe.rawFields[21],fields[21],"成品耐久不得改動");
    assert.equal(recipe.category,fields[0],"原版分類不得改動");
    assert.equal(displayRetailItemName(recipe.name),products[i][1]);
    assert.deepEqual(recipe.ingredients.map(x=>[x.name,x.quantity]),originalFormula[i]);
    assert.equal(recipe.durability,i<7?1:5);
    assert.equal(recipe.key,"craft-"+(i+1));
  }
  assert.equal(DESSERT_FASTFOOD_ZH_TW["アイスクリーム"],"冰淇淋");
  assert.equal(displayRetailItemName("健康汁"),"健康汁","原文已是繁中，不另造譯名");
  assert.equal(Object.keys(CRAFTING_DISPLAY_NAMES_ZH_TW).length,11);
});

test("15種不同原始材料全數顯示繁中，重用既有13筆，金塊原文為繁中，新增阿姨的力量",()=>{
  assert.equal(materials.length,15);
  const actual=[...new Set(recipes.flatMap(recipe=>recipe.ingredients.map(i=>i.name)))];
  assert.equal(actual.length,15);
  assert.deepEqual(actual.sort(),materials.map(x=>x[0]).sort());
  for(const [name,zh] of materials)assert.equal(displayRetailItemName(name),zh,name);
  assert.equal(RETAIL_CRAFTING_ZH_TW["冷蔵庫"],"冰箱");
  assert.equal(RETAIL_CRAFTING_ZH_TW["ポット"],"熱水壺");
  assert.equal(RETAIL_GIFTS_ZH_TW["ミグ25"],"米格-25戰鬥機");
  assert.equal(CRAFTING_DISPLAY_NAMES_ZH_TW["おばちゃんの力"],"阿姨的力量");
  assert.equal(CRAFTING_DISPLAY_NAMES_ZH_TW["シロノワール"],"冰與火");
  assert.equal(displayRetailItemName("未知使用者道具"),"未知使用者道具");
});

test("合成原有材料數量、珍稀配方、多餘冒號例外和分類都是純顯示層",()=>{
  assert.equal(recipes[5].sourceAnomaly,true);
  assert.match(rawRows[5][1],/冷蔵庫:1:\+ミルク:2/);
  assert.deepEqual(recipes[5].ingredients,[
    {name:"冷蔵庫",quantity:1},{name:"ミルク",quantity:2}
  ]);
  assert.equal(displayRetailItemCategory("本"),"書籍");
  assert.equal(displayRetailItemCategory("自動車"),"汽車");
  assert.equal(displayRetailItemCategory("ドリンク"),"飲料");
  assert.equal(displayRetailItemCategory("ファーストフード"),"速食");
  assert.equal(displayRetailItemCategory("玩家自訂分類"),"玩家自訂分類");
});

test("合成清單、材料、選單、確認、通知及歷史顯示繁中，API 仍提交原始配方鍵",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const start=app.indexOf("let pendingCraftingAction=null;");
  const end=app.indexOf("function renderRetail(){",start);
  assert.ok(start>=0&&end>start);
  const section=app.slice(start,end);
  for(const term of [
    "displayRetailItemName(recipe.name)",
    "displayRetailItemName(i.name)",
    "displayRetailItemCategory(recipe.category)",
    "displayRetailItemName(result.name)",
    "displayRetailItemName(item.name)"
  ])assert.ok(section.includes(term),term);
  assert.match(section,/const key=recipe\.key\+":"\+quantity/);
  assert.match(section,/option\.value=recipe\.key/);
  assert.match(section,/recipeKey:recipe\.key,quantity,requestId:pendingCraftingAction\.requestId/);
  assert.match(section,/api\("crafting\/make"/);
  assert.doesNotMatch(section,/title\.textContent=recipe\.name/);
  assert.doesNotMatch(section,/recipe\.ingredients\.map\(i=>i\.name/);
});
