import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

function rule(selector){
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const found=new RegExp(escaped+"\\s*\\{([^}]*)\\}").exec(css);
  assert.ok(found,"missing CSS selector: "+selector);
  return found[1];
}

test("城鎮地圖按鈕高度不得繼承通用 36px 最小高度",()=>{
  const common=rule(".game-shell button");
  assert.match(common,/min-height:\s*36px/);
  const cells=rule(".game-shell .town-map .map-cell");
  assert.match(cells,/width:\s*34px/);
  assert.match(cells,/height:\s*34px/);
  assert.match(cells,/min-height:\s*34px/);
  assert.match(cells,/max-height:\s*34px/);
  assert.match(cells,/padding:\s*0/);
  assert.match(cells,/margin:\s*0/);
  assert.match(cells,/box-sizing:\s*border-box/);
  assert.ok(css.indexOf(".game-shell .town-map .map-cell")>
    css.indexOf(".game-shell button{"),"地圖專用規則須覆蓋一般按鈕");
});

test("座標軸與格子沿用 12 列 16 欄固定軌道，預覽及遊戲主地圖共用",()=>{
  const map=rule(".town-map");
  assert.match(map,/grid-template-columns:\s*20px repeat\(16,34px\)/);
  assert.match(map,/grid-template-rows:\s*18px repeat\(12,34px\)/);
  assert.match(map,/gap:\s*1px/);
  const cell=rule(".map-cell");
  assert.match(cell,/width:\s*34px/);
  assert.match(cell,/height:\s*34px/);
  assert.match(css,/\.map-cell img\{width:32px;height:32px/);
  for(const id of ["town-map","preview-map"])
    assert.match(html,new RegExp('id="'+id+'" class="town-map"'));
  assert.match(app,/for\s*\(let row=0;row<12;row\+\+\)/);
  assert.match(app,/for\s*\(let col=0;col<16;col\+\+\)/);
  assert.match(app,/for\s*\(let row = 0; row < 12; row\+\+\)/);
  assert.match(app,/for\s*\(let col = 0; col < 16; col\+\+\)/);
});

test("小螢幕不壓縮格子，保留橫向捲動與原圖排版",()=>{
  const scroll=rule(".map-scroll");
  assert.match(scroll,/overflow:\s*auto/);
  const map=rule(".town-map");
  assert.match(map,/width:\s*max-content/);
  assert.match(map,/background-size:\s*cover/);
  assert.match(rule(".game-shell .town-map .map-cell"),/border-radius:\s*0/);
});
