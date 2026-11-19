import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeTile } from "../src/town-map.mjs";
import { FACILITY_PANELS,townCellAction } from "../public/town-home.js";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原 CGI 建築代碼只連到 Web 真正已實作的設施入口",()=>{
  const expected={
    "銀行":"bank-panel","病院":"hospital-panel","職安":"jobs-panel",
    "教室":"school-panel","食堂":"dining-panel","食堂２":"dining-panel",
    "建築":"housing-panel"
  };
  assert.deepEqual(FACILITY_PANELS,expected);
  for(const [key,panelId] of Object.entries(expected)){
    const cell=describeTile(key);
    assert.equal(cell.key,key);
    assert.deepEqual(townCellAction(cell),{kind:"facility",panelId});
    assert.match(html,new RegExp('id="'+panelId+'"'));
  }
  for(const key of ["駅","デパ","ギフト屋","ゲーセン","株"]){
    const cell=describeTile(key);
    assert.deepEqual(townCellAction(cell),{kind:"unavailable"});
  }
  assert.deepEqual(townCellAction({category:"empty"}),{kind:"inspect"});
});

test("住宅與真實空地擁有獨立導覽，不會誤把其他土地或道路送去建屋",()=>{
  assert.deepEqual(townCellAction({key:"webhouse_5",houseId:5,category:"house"}),
    {kind:"house",houseId:5});
  assert.deepEqual(townCellAction({key:"webhouse_5",houseId:0,category:"house"}),
    {kind:"unavailable"});
  for(const key of ["空地","空地2","空地3","空地4"])
    assert.deepEqual(townCellAction(describeTile(key)),{kind:"build",panelId:"housing-panel"});
  for(const key of ["地","道横","木"])
    assert.deepEqual(townCellAction(describeTile(key)),{kind:"inspect"});
  assert.deepEqual(townCellAction(null),{kind:"inspect"});
});

test("未登入亦有唯讀街區預覽與登入區，手機及桌機版均為地圖先行",()=>{
  const landing=html.indexOf('id="landing"');
  const preview=html.indexOf('id="preview-map"');
  const auth=html.indexOf('id="auth"');
  const create=html.indexOf('id="create"');
  const game=html.indexOf('id="game"');
  assert.ok(landing>0&&preview>landing&&auth>preview&&create>auth&&game>create);
  assert.match(html,/id="preview-town"/);
  assert.match(html,/id="preview-map-status"/);
  assert.match(script,/loadPublicPreview/);
  assert.match(script,/town\/preview\?townId=/);
  const main=html.slice(game);
  assert.ok(main.indexOf('class="content"')<main.indexOf('class="sidebar"'));
  assert.ok(main.indexOf('id="town-panel"')<main.indexOf('id="housing-panel"'));
  assert.match(html,/id="facility-shortcuts"/);
  assert.match(script,/townCellAction\(cell\)/);
  assert.match(css,/@media\(max-width:800px\)/);
  assert.match(css,/\.landing-layout\{display:grid/);
  assert.match(css,/\.layout\{grid-template-columns:minmax\(0,1fr\) 320px\}/);
  for(const key of Object.values(expectedFacilityIds()))assert.match(html,new RegExp('id="'+key+'"'));
});
function expectedFacilityIds(){
  return {...FACILITY_PANELS,inventory:"inventory-panel",town:"town-panel"};
}
