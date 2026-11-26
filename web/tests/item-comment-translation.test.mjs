import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {ORIGINAL_ITEM_COMMENTS_ZH_TW,displayOriginalItemComment}
  from "../public/item-comment-translations.js";

const original=relativePath=>decodeLegacyText(
  readFileSync(new URL(relativePath,import.meta.url)));
const readRows=path=>original(path).split(/\r?\n/).filter(Boolean).slice(1).map((line,index)=>{
  const fields=line.split("<>");
  if(fields.length===34&&fields[33]==="")fields.pop();
  assert.equal(fields.length,33,"source "+path+" line "+(index+2));
  return fields;
});
const retail=readRows("../../dat_dir/syouhin.cgi");
const treasure=readRows("../../dat_dir/otakara.cgi");
const notes=rows=>rows.map(f=>f[29]?.trim()??"").filter(Boolean);
const retailNotes=notes(retail),treasureNotes=notes(treasure);
const allNotes=[...retailNotes,...treasureNotes];

test("原始商品備註451筆零售+110筆寶箱：297筆有原文，105種全部有顯示譯文",()=>{
  assert.equal(retail.length,451);
  assert.equal(treasure.length,110);
  assert.equal(retailNotes.length,187);
  assert.equal(treasureNotes.length,110);
  assert.equal(new Set(retailNotes).size,96);
  assert.equal(new Set(treasureNotes).size,10);
  const allUnique=[...new Set(allNotes)];
  assert.equal(allUnique.length,105);
  assert.equal(Object.keys(ORIGINAL_ITEM_COMMENTS_ZH_TW).length,105);
  assert.deepEqual(Object.keys(ORIGINAL_ITEM_COMMENTS_ZH_TW).sort(),allUnique.sort());
  for(const note of allNotes){
    assert.ok(Object.hasOwn(ORIGINAL_ITEM_COMMENTS_ZH_TW,note),note);
    const translated=displayOriginalItemComment(note);
    assert.equal(translated,ORIGINAL_ITEM_COMMENTS_ZH_TW[note]);
    assert.ok(translated.trim(),note);
    assert.doesNotMatch(translated,/[\u3040-\u30ff]/,"玩家譯文不應殘留假名："+note);
  }
  const unchanged=Object.entries(ORIGINAL_ITEM_COMMENTS_ZH_TW)
    .filter(([source,zh])=>source===zh).map(([key])=>key).sort();
  assert.deepEqual(unchanged,["新商品","無"].sort());
});

test("來源備註保留原文、數字與專賣店限制；玩家 UI 才翻譯",()=>{
  const sample=retail.find(f=>f[29]==="※専門店限定商品。");
  assert.ok(sample);
  assert.equal(sample[29],"※専門店限定商品。");
  assert.equal(displayOriginalItemComment(sample[29]),"※專賣店限定商品。");
  assert.equal(displayOriginalItemComment("ウエイトアップ1"),"增重 1");
  assert.equal(displayOriginalItemComment("ウエイトアップ1食料品"),
    "增重 1／食品");
  assert.equal(displayOriginalItemComment("ウエイトアップ1ギフト"),
    "增重 1／禮品");
  assert.equal(displayOriginalItemComment("10日間で使い捨てです。"),
    "使用期限為 10 天，用後即棄。");
  assert.equal(displayOriginalItemComment("お店の支払い時に使うと銀行から引き落としができます。"),
    "在商店付款時使用，可從銀行存款扣款。");
  assert.equal(displayOriginalItemComment("※移動手段です。"),
    "※可作為移動工具。");
  assert.equal(displayOriginalItemComment("未知のコメント"),"未知のコメント");
  assert.equal(displayOriginalItemComment("constructor"),"constructor");
  assert.equal(displayOriginalItemComment("toString"),"toString");
  assert.equal(displayOriginalItemComment(null),"");
  assert.equal(displayOriginalItemComment(""),"");
  assert.equal(displayOriginalItemComment(" ※専門店限定商品。 "),"※專賣店限定商品。");
});

test("寶箱原始備註中獎／未中獎不改抽選或原文金塊用途",()=>{
  const first=treasure.find(f=>f[1]==="冷えピタクール");
  assert.ok(first);
  assert.equal(first[29],"※当たり。風邪に少しだけ効果があります。");
  assert.equal(first[9],"風邪,7");
  assert.equal(displayOriginalItemComment(first[29]),"※中獎。對感冒略有效果。");
  const gold=treasure.find(f=>f[1]==="金塊");
  assert.ok(gold);
  assert.equal(gold[29],"重くてどうすることも出来なかった。");
  assert.equal(displayOriginalItemComment(gold[29]),"太重了，什麼也做不了。");
  assert.equal(displayOriginalItemComment("これを金の箱のあたりにして欲しいです。"),
    "希望能把這個設為金箱的中獎獎品。");
  assert.deepEqual(treasure.filter(f=>f[0]==="金の箱").length,39);
});

test("百貨及背包皆用同一備註顯示入口，後端原版備註與進貨判定維持原文",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const retailSource=readFileSync(new URL("../src/retail.mjs",import.meta.url),"utf8");
  const wholesaleSource=readFileSync(new URL("../src/wholesale.mjs",import.meta.url),"utf8");
  assert.match(app,/import \{ displayOriginalItemComment \} from "\.\/item-comment-translations\.js"/);
  assert.ok(app.includes('displayOriginalItemComment(info?.comment)'));
  assert.ok(app.includes('displayOriginalItemComment(info.comment)'));
  assert.equal((app.match(/displayOriginalItemComment\(info\??\.comment\)/g)??[]).length,2);
  assert.equal((app.match(/原版備註（繁中顯示）：/g)??[]).length,2);
  assert.match(app,/\/専門店限定商品\|秘伝商品\/\.test\(item\.note\?\?""\)/,
    "商店批發禁購仍依原版文字判定");
  assert.match(retailSource,/comment:f\[29\]\|\|""/,
    "後端商品效果仍傳原文備註");
  assert.doesNotMatch(retailSource,/displayOriginalItemComment/,
    "禁止在後端修改原始商品資料");
  assert.doesNotMatch(wholesaleSource,/displayOriginalItemComment/,
    "禁止在批發端更動限制判定");
});
