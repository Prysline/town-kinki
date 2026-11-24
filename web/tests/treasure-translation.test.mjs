import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseOriginalTreasure,TREASURE_BOXES} from "../src/arcade-treasure.mjs";
import {displayRetailItemName,displayRetailItemCategory} from "../public/retail-item-translations.js";
import {TREASURE_REWARD_NAMES_ZH_TW} from "../public/treasure-translations.js";
import {RETAIL_GIFTS_ZH_TW} from "../public/retail-gift-translations.js";
import {RETAIL_VEHICLES_ZH_TW} from "../public/retail-transport-pets-bait-translations.js";
import {COUPON_REWARD_NAMES_ZH_TW} from "../public/coupon-translations.js";

const original=path=>decodeLegacyText(readFileSync(new URL(path,import.meta.url)));
const treasure=parseOriginalTreasure(
  original("../../gamerand.cgi"),original("../../otakara.cgi"),
  original("../../dat_dir/otakara.cgi"),original("../../town_ini.cgi")
);
const pool=treasure.pools.special;
const existing={...RETAIL_GIFTS_ZH_TW,...RETAIL_VEHICLES_ZH_TW,...COUPON_REWARD_NAMES_ZH_TW};
const reused=Object.fromEntries(pool.filter(x=>Object.hasOwn(existing,x.name))
  .map(x=>[x.name,existing[x.name]]));
const stat=[
  ["国","國語",2],["数","數學",3],["理","理科",4],["社","社會",5],
  ["英","英語",6],["音","音樂",7],["美","美術",8],["ル","外貌",10],
  ["体","體力",11],["健","健康",12],["ス","速度",13],["パ","力量",14],
  ["腕","臂力",15],["脚","腿力",16],["L","LOVE",18],["面","有趣度",19],
  ["H","情色度",20]
];
const series=[
  ["銀のコイン","銀幣",15,"銀の箱"],
  ["銀箔","銀箔",5,"銀の箱"],
  ["銅のメダル","銅牌",5,"銅の箱"],
  ["ティッシュ","面紙",1,"銅の箱"],
  ["金箔","金箔",20,"金の箱"]
];

test("來源110筆逐筆不遺漏：新譯名87、沿用21、原文即繁中1、待校對1",()=>{
  assert.equal(pool.length,110);
  assert.equal(new Set(pool.map(x=>x.name)).size,110);
  assert.equal(Object.keys(TREASURE_REWARD_NAMES_ZH_TW).length,87);
  assert.equal(Object.keys(reused).length,21);
  const names=new Set([...Object.keys(TREASURE_REWARD_NAMES_ZH_TW),
    ...Object.keys(reused),"金塊","冷えピタクール"]);
  assert.equal(names.size,110);
  assert.deepEqual([...names].sort(),pool.map(x=>x.name).sort());
  for(const item of pool){
    assert.equal(item.rawFields.length,33);
    assert.equal(item.rawFields[0],item.category);
    assert.equal(item.rawFields[1],item.name);
    const expected=TREASURE_REWARD_NAMES_ZH_TW[item.name]??reused[item.name]??item.name;
    assert.equal(displayRetailItemName(item.name),expected,item.name);
    assert.ok(displayRetailItemName(item.name).trim());
  }
  assert.equal(displayRetailItemName("金塊"),"金塊");
  assert.equal(displayRetailItemName("冷えピタクール"),"冷えピタクール",
    "待確認的商品式名稱不得擅自定稿");
  assert.equal(TREASURE_REWARD_NAMES_ZH_TW["豪華クルージング"],"豪華遊輪之旅");
  assert.equal(TREASURE_REWARD_NAMES_ZH_TW["究極の純プラチナカー"],"究極純鉑金車");
});

test("五組各17種獎品，名稱與原版各能力欄位逐筆核對且不推測額外獎勵",()=>{
  assert.equal(series.length*stat.length,85);
  for(const [prefix,display,value,category] of series){
    for(const [suffix,statName,position] of stat){
      const name=prefix+" "+suffix;
      const reward=pool.find(x=>x.name===name);
      assert.ok(reward,name);
      assert.equal(reward.category,category,name);
      assert.equal(reward.rawFields[position],String(value),name);
      for(const [, ,other] of stat)if(other!==position)
        assert.equal(reward.rawFields[other],"0",name+" cannot affect field "+other);
      assert.equal(displayRetailItemName(name),display+"（"+statName+"）");
    }
  }
});

test("寶箱名稱、抽中通知、最近紀錄與本人歷史只顯示繁中，API 鍵和抽選規則保持原始值",()=>{
  assert.deepEqual(TREASURE_BOXES.map(x=>[x.key,x.name,x.price]),[
    ["copper","銅の箱",500],["silver","銀の箱",1000],
    ["gold","金の箱",2500000],["special","スペシャル",500000]
  ]);
  assert.deepEqual(TREASURE_BOXES.map(x=>displayRetailItemCategory(x.name)),
    ["銅箱","銀箱","金色寶箱","特殊寶箱"]);
  assert.deepEqual([
    treasure.pools.copper.length,treasure.pools.silver.length,
    treasure.pools.gold.length,treasure.pools.special.length
  ],[34,35,39,110]);
  assert.equal(treasure.pools.gold.at(-1).name,"究極の純プラチナカー");
  assert.equal(treasure.pools.special.at(-1).name,"究極の純プラチナカー");
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const begin=app.indexOf("let pendingTreasureOpen=null;");
  const end=app.indexOf("let pendingMultiCard=null;",begin);
  assert.ok(begin>=0&&end>begin);
  const ui=app.slice(begin,end);
  for(const content of [
    "displayRetailItemCategory(box.name)",
    "displayRetailItemCategory(boxes.find(b=>b.key===round.boxKey)?.name",
    "displayRetailItemName(result.itemName)",
    "displayRetailItemName(last.itemName)",
    "displayRetailItemName(round.itemName)"
  ])assert.ok(ui.includes(content),content);
  assert.match(ui,/pendingTreasureOpen=\{boxKey:box\.key,requestId:crypto\.randomUUID\(\)\}/);
  assert.match(ui,/boxKey:box\.key,requestId:pendingTreasureOpen\.requestId/);
  assert.match(ui,/await api\("arcade\/treasure\/open"/);
  assert.doesNotMatch(ui,/「ゲーセン」/);
  assert.ok(app.includes("displayRetailItemName(item.name)"),
    "同一背包共用來源日文顯示入口");
  assert.equal(displayRetailItemName("玩家自訂物品"),"玩家自訂物品");
  assert.equal(displayRetailItemCategory("玩家自訂類別"),"玩家自訂類別");
});
