import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { townTimePhase } from "../public/time-theme.js";

const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const original=readFileSync(new URL("../../top.pl",import.meta.url),"latin1");

const taipei=(hour,minute=0)=>Date.UTC(2026,10,21,hour-8,minute);
const expected=[
  [0,"night"],[6,"night"],[7,"morning"],[9,"morning"],
  [10,"day"],[15,"day"],[16,"sunset"],[17,"sunset"],
  [18,"evening"],[21,"evening"],[22,"night"],[23,"night"]
];

test("城鎮背景使用原版 top.pl 小時分界，包括各時段前一分鐘",()=>{
  for(const [hour,phase] of expected)
    assert.equal(townTimePhase(taipei(hour), "Asia/Taipei"),phase,
      `台灣遊戲時間 ${hour}:00`);
  const boundaries=[
    [6,59,"night"],[9,59,"morning"],[15,59,"day"],
    [17,59,"sunset"],[21,59,"evening"]
  ];
  for(const [hour,minute,phase] of boundaries)
    assert.equal(townTimePhase(taipei(hour,minute),"Asia/Taipei"),phase);
});

test("以伺服器傳來的遊戲時區判斷，不依瀏覽器本地時區",()=>{
  const now=Date.UTC(2026,10,21,0,15);
  assert.equal(townTimePhase(now,"Asia/Taipei"),"morning");
  assert.equal(townTimePhase(now,"UTC"),"night");
  assert.equal(townTimePhase(NaN,"Asia/Taipei"),"day");
  assert.equal(townTimePhase(now,"Invalid/Time_Zone"),"day");
});

test("五段城鎮地圖色碼忠實對應原始 CGI 並保留地圖圖片",()=>{
  for(const color of ["#333366","#ffcc66","#ffff99","#ff9966","#666699"])
    assert.ok(original.includes(`$sotonoiro="${color}";`),color);
  assert.match(original,/background-color:\$sotonoiro/);
  const themes=css.slice(css.indexOf("/* 原版 top.pl 城鎮背景依遊戲時段切換"));
  assert.match(themes,/:root\{[^}]*--town-map-bg:#ffff99/);
  for(const [phase,color] of [["morning","#ffcc66"],["sunset","#ff9966"],
    ["evening","#666699"],["night","#333366"]]){
    const block=themes.match(new RegExp(`data-town-time="${phase}"\\]\\{([^}]+)\\}`))?.[1];
    assert.ok(block,`缺少 ${phase} 配色`);
    assert.ok(block.includes(`--town-map-bg:${color}`),phase);
  }
  assert.match(themes,/\.town-map\{background-color:var\(--town-map-bg\)\}/);
  assert.doesNotMatch(themes,/\.town-map\{background-image:/);
});

test("單人快轉、多人伺服器時鐘及跨小時皆會更新色系",()=>{
  assert.match(app,/import \{ townTimePhase \} from "\.\/time-theme\.js"/);
  assert.match(app,/townTimePhase\(browserGameNow\(\),state\.gameTimeZone\|\|"Asia\/Taipei"\)/);
  assert.match(app,/document\.documentElement\.dataset\.townTime=phase/);
  assert.match(app,/syncedGameMs=state\.gameTimeMs\?\?Date\.now\(\);\s*syncedAtRealMs=Date\.now\(\);\s*updateTownTheme\(\)/);
  assert.match(app,/setInterval\(\(\)=>\{\s*updateTownTheme\(\)/);
});

function luminance(color) {
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
    .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
function contrast(a,b) {
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
test("日夜外圍文字、面板文字、頁首與按鈕對比至少 4.5:1",()=>{
  const pairs=[
    ["#fff9dc","#342f25"],["#fff0c9","#382e21"],
    ["#ffe3d4","#3d2d30"],["#34334f","#f6f3ff"],
    ["#1c2240","#f5f4ff"],["#fffefa","#23352d"],
    ["#fafbff","#23352d"],["#f9faff","#23352d"],
    ["#5b4c2e","#ffffff"],["#654d2c","#ffffff"],
    ["#673c41","#ffffff"],["#272742","#ffffff"],
    ["#14192f","#ffffff"],["#425e70","#ffffff"],
    ["#465f75","#ffffff"],["#68546b","#ffffff"],
    ["#465d77","#ffffff"],["#3c596f","#ffffff"],
    ["#f1f2ff","#222b44"]
  ];
  for(const [background,foreground] of pairs)
    assert.ok(contrast(background,foreground)>=4.5,
      `${background} 與 ${foreground} 對比不足`);
  assert.match(css,/\.card,\.game-shell \.facility-shell\{\s*background:var\(--town-panel-bg\);color:var\(--town-panel-ink\)/);
  assert.match(css,/input,select,textarea\{background-color:#fff;color:#23352d\}/);
  assert.match(css,/\.map-axis\{background:var\(--town-map-axis-bg\);color:var\(--town-map-axis-ink\)\}/);
});
