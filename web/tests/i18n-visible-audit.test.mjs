import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText,parseLegacyJobs} from "../src/engine.mjs";
import {parseLegacyRetailCatalog} from "../src/retail.mjs";
import {parseLegacyMeals} from "../src/dining.mjs";
import {displayRetailItemName,displayRetailItemCategory}
  from "../public/retail-item-translations.js";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const legacy=path=>decodeLegacyText(readFileSync(new URL(path,import.meta.url)));
const retailSource=legacy("../../dat_dir/syouhin.cgi");
const retailSourceRows=retailSource.split(/\r?\n/).filter(Boolean).slice(1)
  .map(line=>line.split("<>"));
const targetKana=/[\u3040-\u30ff\u31f0-\u31ff]/;

test("全站來源稽核：零售原始417個非食堂品項每列都有不含日文假名的中文顯示",()=>{
  const rows=retailSourceRows.filter(row=>row[0]!=="食");
  const catalog=parseLegacyRetailCatalog(retailSource);
  assert.equal(retailSourceRows.length,451);
  assert.equal(rows.length,417);
  // 零售交易解析器會排除3筆秘傳商品與1筆零價格物品；這4個來源名稱仍已翻譯。
  assert.equal(catalog.length,413);
  for(const item of catalog){
    const sourceRow=retailSourceRows[item.originalLine-2];
    assert.deepEqual([item.category,item.name],[sourceRow[0],sourceRow[1]]);
  }
  for(const row of rows){
    assert.doesNotMatch(displayRetailItemName(row[1]),targetKana,row[1]);
    assert.doesNotMatch(displayRetailItemCategory(row[0]),targetKana,row[0]);
  }
  for(const item of catalog){
    const translated=displayRetailItemName(item.name);
    const category=displayRetailItemCategory(item.category);
    assert.ok(typeof translated==="string"&&translated.trim(),item.name);
    assert.doesNotMatch(translated,targetKana,item.name);
    assert.ok(typeof category==="string"&&category.trim(),item.category);
    assert.doesNotMatch(category,targetKana,item.category);
    assert.equal(item.name,item.rawFields[1],"原始33欄品名不可被翻譯函式修改");
    assert.equal(item.category,item.rawFields[0],"原始33欄分類不可被翻譯函式修改");
    assert.equal(item.rawFields.length,33,"原始商品欄數必須維持33");
  }
});

test("全站來源稽核：原版食堂34+35道及職業150個顯示全為繁中，不改原始鍵",()=>{
  const meals=[
    ...parseLegacyMeals(retailSource,"main"),
    ...parseLegacyMeals(legacy("../../dat_dir/syokudou2.cgi"),"second")
  ];
  assert.equal(meals.length,69);
  for(const meal of meals){
    assert.ok(meal.name.trim());
    assert.doesNotMatch(meal.name,targetKana,meal.originalName);
    assert.ok(meal.key.startsWith("meal-"));
  }
  const jobs=parseLegacyJobs(legacy("../../dat_dir/job.cgi"));
  assert.equal(jobs.length,150);
  for(const job of jobs){
    assert.equal(job.translated,true,job.originalName);
    assert.ok(job.name.trim());
    assert.doesNotMatch(job.name,targetKana,job.originalName);
    assert.ok(job.key.startsWith("legacy-"));
  }
});

test("靜態首頁及場景說明無日文假名，地圖代碼仍由原始符號決定",()=>{
  const html=read("../public/index.html");
  const map=read("../src/town-map.mjs");
  const townNav=read("../public/town-home.js");
  assert.doesNotMatch(html,targetKana);
  assert.ok(map.includes('["ギフト屋", "禮品店"'));
  assert.ok(map.includes('["ゲーセン", "遊樂中心"'));
  assert.ok(townNav.includes('"ギフト屋":"gift-panel"'));
  assert.ok(townNav.includes('"ゲーセン":"arcade-dice-panel"'));
  assert.ok(html.includes("三輪滑板車"));
  assert.ok(html.includes("專賣店限定商品"));
});

test("住宅商店分類和四處付款信用卡名稱只翻玩家顯示，不改業務識別",()=>{
  const app=read("../public/app.js");
  for(const expected of [
    '"住宅商店「"+shop.title+"」｜"+displayRetailItemCategory(shop.category)',
    'opt.textContent="有效信用卡："+displayRetailItemName(card.name);',
    'option.textContent="信用卡："+displayRetailItemName(card.name);payment.append(option);',
    'new Option(displayRetailItemName(card.name)+"（普通存款扣款）","credit:"+card.sourceLine)',
    '["credit:"+c.sourceLine,displayRetailItemName(c.name)+"（銀行付款）"]'
  ])assert.ok(app.includes(expected),expected);
  assert.equal(displayRetailItemName("クレジットカード"),"信用卡");
  assert.equal(displayRetailItemName("ゴールドクレジットカード"),"黃金信用卡");
  assert.ok(app.includes('opt.value="card:"+card.sourceLine'));
  assert.ok(app.includes('option.value="card:"+card.sourceLine'));
  // 共用付款選單仍以原始來源行號結帳，但不得因現金不足自動改刷卡。
  assert.ok(app.includes('sourceLine:Number(value.slice(7))'));
  assert.ok(app.includes('choice="unavailable"'));
  assert.ok(!app.includes('paymentSelect.value="credit:"+cards[0].sourceLine'));
  assert.ok(app.includes('shop?.category==="スーパー"'));
  assert.ok(app.includes('/専門店限定商品|秘伝商品/.test(item.note??"")'));
});

test("不當作玩家漏譯：原始資料鍵及使用者自由文字必須留在來源欄位",()=>{
  const app=read("../public/app.js");
  assert.ok(app.includes('message.textContent = post.body;'));
  assert.ok(app.includes('body.textContent=mail.message;'));
  assert.ok(app.includes('title.textContent = house.name;'));
  assert.ok(app.includes('shop?'));
  assert.equal(displayRetailItemName("未收錄來源品名"),"未收錄來源品名");
  assert.equal(displayRetailItemCategory("未收錄來源分類"),"未收錄來源分類");
});
