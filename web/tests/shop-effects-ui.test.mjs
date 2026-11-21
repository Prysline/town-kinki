import test from "node:test";
import assert from "node:assert/strict";
import { groupedStatLines } from "../public/shop-effects.js";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const server=readFileSync(new URL("../src/server.mjs",import.meta.url),"utf8");

const labels={
  kokugo:"國語",suugaku:"數學",rika:"理科",syakai:"社會",
  eigo:"英語",ongaku:"音樂",bijutu:"美術",looks:"外貌",
  tairyoku:"體力",kenkou:"健康",speed:"速度",power:"力量",
  wanryoku:"腕力",kyakuryoku:"腳力",love:"LOVE",
  unique:"趣味",etti:"H"
};
test("相同幅度合併但所有非零能力都完整列出，無『等 X 項』截斷",()=>{
  const keys=Object.keys(labels);
  const effects=Object.fromEntries(keys.map(key=>[key,1]));
  const lines=groupedStatLines(effects,labels);
  assert.equal(lines.length,1);
  for(const name of Object.values(labels))assert.ok(lines[0].includes(name),name);
  assert.equal(lines[0],"能力 +1："+Object.values(labels).join("、"));
  assert.doesNotMatch(lines.join("、"),/等\s*\d+\s*項|\.\.\./);
  assert.doesNotMatch(app,/bonuses\.slice\(0,3\)/);
});
test("不同增減保留分組，零值不虛報效果",()=>{
  assert.deepEqual(groupedStatLines({
    looks:3,tairyoku:2,kenkou:3,speed:-2,unique:0
  },labels),[
    "能力 +3：外貌、健康","能力 +2：體力","能力 -2：速度"
  ]);
  assert.deepEqual(groupedStatLines({},labels),[]);
});
test("原版ランダム品為每個欄位獨立隨機，不能當固定增益",()=>{
  assert.deepEqual(groupedStatLines({looks:10,kenkou:10},labels,true),[
    "每項獨立隨機 +0～+10：外貌、健康"
  ]);
  assert.match(app,/primary\.push\(\.\.\.groupedStatLines\(info\.effects,labels,info\.randomizedEffects\)\)/);
});
test("百貨與自販機都使用單張列表與共享結帳，販賣機後端提供原版完整明細",()=>{
  assert.match(app,/function renderShopTable\(/);
  assert.match(app,/renderShopTable\(el\("retail-items"\),goods/);
  assert.match(app,/renderShopTable\(el\("vending-items"\),goods/);
  assert.match(app,/shopCartSelections\.set/);
  assert.match(app,/effects=retailEffectDetails\(item\)/);
  assert.match(app,/row\.append\(nameCell,price,effectCell,remaining,detailCell\)/);
  assert.match(app,/checkout\.append\(controls,quote,button\)/);
  assert.match(server,/vendingGoods=listVendingStock\(db,vendingCatalog\)\.map\(good=>\(\{/);
  assert.match(server,/details:retailItemDetails\(bySku\.get\(good\.sku\)\)/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(css,/\.shop-catalog thead\{display:none\}/);
});
