import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseOriginalFishing} from "../src/fishing.mjs";
import {displayRetailItemName,displayRetailItemCategory} from "../public/retail-item-translations.js";
import {RETAIL_BAIT_ZH_TW} from "../public/retail-transport-pets-bait-translations.js";
import {FISHING_CATCHES_ZH_TW,FISHING_CATEGORIES_ZH_TW} from "../public/fishing-translations.js";

const readOriginal=path=>decodeLegacyText(readFileSync(new URL(path,import.meta.url)));
const source=parseOriginalFishing(
  readOriginal("../../dat_dir/syouhin.cgi"),
  readOriginal("../../sea.cgi"),
  readOriginal("../../hanbai1.cgi")
);
const originalCatchNames=[
  "小魚","ミニたこ","ホタルイカ",
  "中くらいの魚","クラゲ","スルメイカ",
  "でかい魚","ウツボ","ミズダコ",
  "サメ","海がめ","マグロ"
];
const pendingReview=["ホタルイカ","スルメイカ","ウツボ","ミズダコ"];

test("從 sea.cgi 核對十二種實際魚獲，譯名字典與待校對名單合計不得漏列",()=>{
  assert.equal(source.catches.length,4);
  assert.deepEqual(source.catches.flatMap(group=>group.map(fields=>fields[1])),originalCatchNames);
  assert.equal(source.catches.every(group=>group.length===3),true);
  assert.equal(Object.keys(FISHING_CATCHES_ZH_TW).length,8);
  const accountedFor=new Set([...Object.keys(FISHING_CATCHES_ZH_TW),...pendingReview]);
  assert.equal(accountedFor.size,12);
  assert.deepEqual([...accountedFor].sort(),[...originalCatchNames].sort());
  for(const name of originalCatchNames){
    assert.equal(typeof displayRetailItemName(name),"string");
    assert.ok(displayRetailItemName(name).trim());
  }
  for(const name of pendingReview){
    assert.equal(displayRetailItemName(name),name,"歧義魚名未核准前不能冒用譯名："+name);
  }
});

test("四種原有餌料譯名在釣魚介面共用入口顯示，魚類類別只變更顯示",()=>{
  assert.equal(source.bait.length,4);
  assert.deepEqual(source.bait.map(item=>item.name).sort(),Object.keys(RETAIL_BAIT_ZH_TW).sort());
  for(const item of source.bait){
    assert.equal(displayRetailItemName(item.name),RETAIL_BAIT_ZH_TW[item.name]);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.sku.startsWith("bait-"),true);
  }
  for(const [name,translated] of Object.entries(FISHING_CATCHES_ZH_TW))
    assert.equal(displayRetailItemName(name),translated);
  assert.equal(displayRetailItemCategory("魚"),"魚");
  assert.equal(displayRetailItemCategory("餌"),"餌料");
  assert.equal(displayRetailItemCategory("幻の魚"),FISHING_CATEGORIES_ZH_TW["幻の魚"]);
  assert.equal(displayRetailItemName("玩家自訂魚名"),"玩家自訂魚名");
});

test("釣魚顯示接線涵蓋清單、確認、購買及釣獲通知、歷史；交易原始來源未更動",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const start=app.indexOf("let pendingFishingAction=null;");
  const end=app.indexOf("let pendingCraftingAction=null;",start);
  assert.ok(start>=0&&end>start);
  const ui=app.slice(start,end);
  for(const text of [
    "displayRetailItemName(result.name)",
    "displayRetailItemName(result.baitName)",
    "displayRetailItemName(result.catchName)",
    "displayRetailItemName(bait.name)",
    "displayRetailItemName(item.name)",
    "displayRetailItemName(item.baitName)",
    "displayRetailItemName(item.catchName)",
    "displayRetailItemName(catchItem.name)"
  ])assert.ok(ui.includes(text),text);
  assert.doesNotMatch(ui,/「釣り」|「販売1」/);
  assert.match(ui,/sku:bait.sku/);
  assert.match(ui,/sourceLine:line/);
  const origin=readOriginal("../../sea.cgi");
  assert.match(origin,/\$my_rand = int\(rand\(3\)\)/);
  assert.equal(source.catches.reduce((n,group)=>n+group.length,0),12);
  for(const group of source.catches)for(const fields of group){
    assert.equal(fields.length,33);
    assert.ok(["魚","幻の魚"].includes(fields[0]));
    assert.equal(fields[22],"回");
  }
});
