import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {listLegacyInventoryItems} from "../src/legacy-inventory.mjs";
import {retailItemDetails} from "../src/retail.mjs";
import {itemCooldownRemaining,formatItemCountdown,itemCooldownText,itemRemainingDurability} from "../public/item-cooldown.js";
import {groupedStatLines} from "../public/shop-effects.js";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const server=readFileSync(new URL("../src/server.mjs",import.meta.url),"utf8");
const use=readFileSync(new URL("../src/legacy-item-use.mjs",import.meta.url),"utf8");

test("冷卻以伺服器 readyAt 與遊戲時間倒數，歸零不自行越過後端驗證",()=>{
  const action={canUse:false,reason:"物品使用間隔尚未結束",readyAt:600000};
  assert.equal(itemCooldownRemaining(action,538999),61001);
  assert.equal(itemCooldownText(action,538999),"冷卻剩餘 01:02");
  assert.equal(itemCooldownRemaining(action,600000),0);
  assert.equal(itemCooldownRemaining({...action,canUse:true},538999),0);
  assert.equal(itemCooldownText({...action,canUse:true},538999),"");
  assert.equal(itemCooldownText({...action,reason:"尚未到原版商品購入時間"},538999),
    "距離購入時間 01:02");
  assert.equal(formatItemCountdown(3723000),"01:02:03");
  assert.equal(formatItemCountdown(90061000),"1 天 01:01:01");
});
test("原版日制物品顯示實際剩餘天數，回制與無效購入日期不亂算",()=>{
  const bought=1_700_000_000;
  const item={durability:30,unit:"日",purchasedAt:bought};
  const now=bought*1000+9*86400000+1000;
  assert.equal(itemRemainingDurability(item,null,now),21);
  assert.equal(itemRemainingDurability(item,{remaining:12},now),12);
  assert.equal(itemRemainingDurability({durability:3,unit:"回",purchasedAt:bought},null,now),3);
  assert.equal(itemRemainingDurability({...item,purchasedAt:null},null,now),30);
  assert.equal(itemRemainingDurability(item,null,now+45*86400000),0);
});

test("個人物品安全取得原版效果，壞資料保留清單而不憑空產生效果",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec("CREATE TABLE legacy_inventory_items ("+
      "user_id INTEGER,source_line INTEGER,original_id TEXT,category TEXT,"+
      "original_name TEXT,durability INTEGER,durability_unit TEXT,"+
      "purchased_at INTEGER,raw_fields_json TEXT)");
    const f=Array(33).fill("0");
    f[0]="ドリンク";f[1]="測試飲料";f[9]="無";
    f[7]="1";f[10]="1";f[17]="200";f[21]="2";f[22]="回";
    f[23]="30";f[25]="100";f[29]="原始備註";
    db.prepare("INSERT INTO legacy_inventory_items VALUES(?,?,?,?,?,?,?,?,?)")
      .run(1,1,"import",f[0],f[1],2,"回",0,JSON.stringify(f));
    db.prepare("INSERT INTO legacy_inventory_items VALUES(?,?,?,?,?,?,?,?,?)")
      .run(1,2,"import","薬","損壞存檔",3,"回",0,"[]");
    const items=listLegacyInventoryItems(db,1,50,retailItemDetails);
    assert.equal(items.length,2);
    assert.equal(items[0].details.effects.ongaku,1);
    assert.equal(items[0].details.effects.looks,1);
    assert.equal(items[0].details.calories,100);
    assert.equal(items[0].details.comment,"原始備註");
    assert.equal(items[0].readOnly,true);
    assert.ok(!("rawFields" in items[0]));
    assert.equal(items[1].name,"損壞存檔");
    assert.equal(items[1].details,undefined);
  }finally{db.close();}
});
test("物品沿用百貨的完整能力增減格式，不使用等 X 項摘要",()=>{
  assert.equal(groupedStatLines({ongaku:1,looks:1,kenkou:5},
    {ongaku:"音樂",looks:"外貌",kenkou:"健康"}).join("｜"),
    "能力 +1：音樂、外貌｜能力 +5：健康");
  assert.match(app,/function itemInventoryEffects\(/);
  assert.match(app,/groupedStatLines\(info\.effects,labels,info\.randomizedEffects\)/);
  assert.match(server,/listLegacyInventoryItems\(db,user\.id,50,retailItemDetails,now\)/);
});
test("物品為主；保險續購、使用紀錄與來源說明置於可展開區域",()=>{
  const a=html.indexOf('id="inventory-panel"');
  const inventory=html.slice(a,html.indexOf('id="attributes-panel"',a));
  const item=inventory.indexOf('id="legacy-inventory-list"');
  const insurance=inventory.indexOf('id="inventory-insurance-management"');
  const history=inventory.indexOf('id="inventory-history-details"');
  assert.ok(item>=0&&insurance>item&&history>insurance);
  assert.match(inventory,/<details class="inventory-secondary" id="inventory-insurance-management">/);
  assert.match(inventory,/<details class="inventory-secondary" id="inventory-history-details">/);
  for(const id of ["insurance-status","insurance-buy-form","insurance-quantity",
    "insurance-buy","insurance-purchases","legacy-item-use-history"])
    assert.ok(inventory.includes('id="'+id+'"'),id);
  assert.doesNotMatch(inventory,/正式百貨、每日上架、玩家商店價格與庫存仍未移植/);
  assert.match(app,/item\.category==="ギフト"/);
  assert.match(app,/原版備註與詳細資訊/);
  assert.match(css,/\.inventory-item-heading/);
});
test("有 readyAt 就每秒更新倒數，單機快轉重渲染並以較晚冷卻時間為準",()=>{
  assert.match(app,/updateInventoryCooldowns\(\);/);
  assert.match(app,/node\.textContent=remaining>0\?itemCooldownText\(action,now\)/);
  assert.match(app,/itemCooldownRemaining\(actionInfo,browserGameNow\(\)\)>0/);
  assert.match(app,/api\("state"\)\.then\(next=>\{state=next;render\(\);\}\)/);
  assert.match(app,/state=await api\("solo\/time\/advance",\{preset\}\);\s*render\(\);/);
  assert.match(use,/const readyAt=Math\.max\(itemReadyAt,mealReadyAt\)/);
});


test("釣魚餌料與漁獲的真實剩餘次數由 Web 消耗帳本決定，而非原始購買耐久",()=>{
  const item={sourceLine:7000000,origin:"fishing",durability:5,remaining:0,unit:"回"};
  assert.equal(itemRemainingDurability(item,null,Date.now()),0);
  assert.equal(itemRemainingDurability({...item,remaining:3},null,Date.now()),3);
  assert.equal(itemRemainingDurability({...item,remaining:3},{remaining:2},Date.now()),2);
  assert.match(app,/item\.origin==="fishing"\?"請至原版釣場/);
  assert.match(app,/renderFishing\(\);/);
});
