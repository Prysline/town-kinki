import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseOsakaRules} from "../src/osaka-challenge-core.mjs";
import {parseArenaDrops} from "../src/b-league.mjs";
import {DROP_NAMES,DEFAULT_NAMES,parseArenaCatalog} from "../src/b-league-core.mjs";
import {SANTA_FIGHT_ITEMS,SANTA_FIGHT_NAMES}
  from "../src/event-santa-fight.mjs";
import {displayRetailItemName,displayRetailItemCategory}
  from "../public/retail-item-translations.js";
import {displayOriginalItemComment} from "../public/item-comment-translations.js";
import {BATTLE_ITEM_ZH_TW,BATTLE_CATEGORY_ZH_TW,BATTLE_MONSTER_ZH_TW,displayBattleMonsterName}
  from "../public/battle-item-translations.js";

const source=path=>decodeLegacyText(readFileSync(new URL(path,import.meta.url)));
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const kana=/[\u3040-\u30ff\u31f0-\u31ff]/;

test("新基底大阪挑戰：八筆原版來源／六種名稱，全部在顯示層有繁中譯名",()=>{
  const rules=parseOsakaRules(source("../../obatyan.cgi"));
  const prizes=[...rules.week.prizes,...rules.strong.prizes];
  assert.equal(prizes.length,8);
  assert.equal(new Set(prizes.map(x=>x.name)).size,6);
  for(const item of prizes){
    assert.doesNotMatch(displayRetailItemName(item.name),kana,item.name);
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.rawFields.length,33);
  }
  assert.equal(displayRetailItemName("おばちゃんの力"),"阿姨的力量");
  assert.equal(displayRetailItemName("おばちゃんの知恵袋"),"阿姨的生活智慧");
  assert.equal(displayRetailItemName("おばちゃんの知恵薬（スーパー）"),"阿姨的智慧藥（超級版）");
  assert.equal(Object.keys(BATTLE_ITEM_ZH_TW).filter(k=>k.startsWith("おばちゃん")||k==="関西弁翻訳機").length,5);
  assert.equal(displayRetailItemCategory("ゲットアイテム"),"獲得道具");
});

test("新基底 B 聯賽：四種實際掉落名稱翻譯，不將第5筆未抽中獎品當成可獲得物",()=>{
  const drops=parseArenaDrops(source("../../battle.cgi"));
  assert.equal(drops.length,4);
  assert.deepEqual(drops.map(row=>row[1]),DROP_NAMES);
  assert.deepEqual(drops.map(row=>displayRetailItemName(row[1])),
    ["藥草","上等藥草","特級藥草","秘傳藥草"]);
  assert.ok(drops.every(row=>row.length===33&&row[0]==="MB"));
  assert.equal(displayRetailItemCategory("MB"),"B 聯賽獎品");
  assert.equal(displayRetailItemName("ドラゴンの角"),"ドラゴンの角",
    "第5筆僅用於驗證來源，不當作已實作獎品");
});

test("新基底 B 聯賽預設裝備名只在 UI 翻譯，原始鍵不變",()=>{
  assert.deepEqual(Object.values(DEFAULT_NAMES),["素手","洋服","念力","先祖の霊"]);
  for(const raw of Object.values(DEFAULT_NAMES))
    assert.doesNotMatch(displayRetailItemName(raw),kana,raw);
  assert.equal(displayRetailItemName("先祖の霊"),"祖先之靈");
  const app=read("../public/app.js");
  assert.ok(app.includes('displayRetailItemName(item.name)+"｜威力 "'));
  assert.ok(app.includes('displayRetailItemName(r.gear)'));
  assert.ok(app.includes('displayRetailItemName(battle.reward.name)'));
  assert.ok(app.includes('if(cell.key==="Ｂリーグ")renderBLeague();'));
});

test("聖誕戰鬥前六項來源均顯示繁中，重複品名保留既有共用譯名",()=>{
  assert.equal(SANTA_FIGHT_ITEMS.length,6);
  assert.equal(SANTA_FIGHT_NAMES.length,6);
  for(let i=0;i<6;i++){
    assert.equal(SANTA_FIGHT_ITEMS[i].length,33);
    assert.ok(displayRetailItemName(SANTA_FIGHT_ITEMS[i][1]).trim());
    assert.doesNotMatch(SANTA_FIGHT_NAMES[i],kana);
  }
  assert.equal(displayRetailItemName("等身大サンタさん人形"),"真人大小聖誕老人玩偶");
  assert.equal(BATTLE_CATEGORY_ZH_TW["ゲットアイテム"],"獲得道具");
});

test("新基底聖誕獎品兩種額外備註翻譯，原始 33 欄保持唯讀",()=>{
  assert.deepEqual(SANTA_FIGHT_ITEMS.map(item=>displayOriginalItemComment(item[29])),
    ["究竟會發生什麼事呢？","究竟會發生什麼事呢？","","","",""]);
  assert.deepEqual(SANTA_FIGHT_ITEMS.slice(2).map(item=>item[30]),
    ["クリスマスプレゼントです","クリスマスプレゼントです",
      "クリスマスプレゼントです","クリスマスプレゼントです"],
    "第 30 欄原始文字不是備註欄，必須保留原文不當作備註");
  assert.equal(displayOriginalItemComment("未收錄特殊備註"),"未收錄特殊備註");
});

test("新基底玩家靜態介面沒有假名，大阪阿姨／B聯賽提示已改成繁中",()=>{
  const html=read("../public/index.html");
  const app=read("../public/app.js");
  assert.doesNotMatch(html,kana);
  assert.ok(html.includes("大阪阿姨挑戰"));
  assert.ok(html.includes("阿姨的力量"));
  assert.ok(app.includes("所在城鎮沒有「B 聯賽」建築"));
  assert.ok(app.includes("目前城鎮沒有裝備商店。"));
  assert.ok(app.includes('!battle.reward.granted?"背包已滿，未取得 "+displayRetailItemName(battle.reward.name)'));
  assert.ok(app.includes('const category=el("wholesale-category")'),
    "原始商店分類仍由同一判定流程處理");
});

test("B 聯賽十筆怪物名稱全部定稿，來源名稱與數值保留，未知名稱回退原文",()=>{
  const raw=source("../../dat_dir/battle.cgi");
  const monsters=parseArenaCatalog(raw);
  const expected=[["ドロン","幽靈"],["べビードラゴン","幼龍"],["ドラゴン","龍"],["ベスドロン","貝斯幽靈"],["ゴットドラゴンの影","神龍之影"],["ボスドロン","幽靈首領"],["ゴットドラゴン","神龍"],["ドロンシドー","幽靈席德"],["ドロンエビル","邪惡幽靈"],["ゴットエビルドラゴン","邪神龍"]];
  assert.equal(monsters.length,10);
  assert.deepEqual(Object.entries(BATTLE_MONSTER_ZH_TW),expected);
  const before=JSON.stringify(monsters);
  for(const m of monsters){
    const fields=raw.split(/\r?\n/)[m.sourceLine-1].split("<>");
    assert.equal(m.name,fields[2]);
    assert.equal(m.originalId,fields[1]);
    assert.equal(m.money,Number(fields[4]));
    assert.deepEqual(m.drops,[Number(fields[5]),Number(fields[6])]);
    assert.equal(m.brainEnergy,Number(fields[9]));
    assert.equal(m.bodyEnergy,Number(fields[10]));
    assert.ok(Object.hasOwn(BATTLE_MONSTER_ZH_TW,m.name),m.name);
    assert.equal(displayBattleMonsterName(m.name),expected.find(([name])=>name===m.name)?.[1]);
    assert.doesNotMatch(displayBattleMonsterName(m.name),kana,m.name);
  }
  assert.deepEqual(monsters.map(m=>m.name),expected.map(([name])=>name));
  assert.equal(JSON.stringify(monsters),before);
  assert.equal(displayBattleMonsterName("未知怪物"),"未知怪物");
  assert.equal(displayBattleMonsterName("toString"),"toString");
  const app=read("../public/app.js");
  assert.ok(app.includes('battle.monster.rank.toUpperCase()+" 級｜"+displayBattleMonsterName(battle.monster.name)'));
  assert.ok(app.includes('item.rank.toUpperCase()+" 級｜"+displayBattleMonsterName(item.name)'));
});
