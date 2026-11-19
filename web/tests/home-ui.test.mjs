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
  assert.ok(main.indexOf('class="content game-map-column"')<main.indexOf('class="sidebar game-status-column"'));
  assert.ok(main.indexOf('id="town-panel"')<main.indexOf('id="housing-panel"'));
  assert.match(html,/id="facility-shortcuts"/);
  assert.match(html,/id="home-work" data-action="work"/);
  assert.match(script,/el\("home-work"\)\.disabled = !ready/);
  assert.match(script,/townCellAction\(cell\)/);
  assert.match(css,/@media\(max-width:800px\)/);
  assert.match(css,/\.landing-layout\{display:grid/);
  assert.match(css,/\.layout\{grid-template-columns:minmax\(0,1fr\) 320px\}/);
  for(const key of Object.values(expectedFacilityIds()))assert.match(html,new RegExp('id="'+key+'"'));
});
function expectedFacilityIds(){
  return {...FACILITY_PANELS,inventory:"inventory-panel",town:"town-panel"};
}


const paneMap={
  house:["housing-panel","room-panel"],
  dining:["dining-panel"],
  training:["school-panel","gym-panel"],
  jobs:["jobs-panel"],
  bank:["bank-panel"],
  hospital:["hospital-panel"],
  inventory:["inventory-panel"],
  events:["event-panel"],
  stats:["attributes-panel"]
};
test("高密度主畫面：地圖摘要與九組可存取設施分頁，保留全部現有操作元件",()=>{
  const main=html.slice(html.indexOf('id="game"'));
  assert.ok(main.indexOf('id="town-panel"')<main.indexOf('id="player-summary"'));
  assert.ok(main.indexOf('id="player-summary"')<main.indexOf('id="facility-tabs"'));
  const tablist=main.match(/id="facility-tabs"[\s\S]*?<\/div>/)?.[0];
  assert.ok(tablist);
  assert.match(tablist,/role="tablist"/);
  for(const [name, panels] of Object.entries(paneMap)){
    assert.match(tablist,new RegExp('id="facility-tab-'+name+'"[^>]*role="tab"[^>]*data-pane="'+name+'"'));
    const pane=main.indexOf('id="facility-pane-'+name+'"');
    assert.ok(pane>0);
    const next=main.indexOf('id="facility-pane-',pane+15);
    const segment=main.slice(pane,next<0?main.length:next);
    assert.match(segment,/role="tabpanel"/);
    assert.match(segment,new RegExp('aria-labelledby="facility-tab-'+name+'"'));
    for(const id of panels)assert.match(segment,new RegExp('id="'+id+'"'));
    if(name==="jobs")assert.match(segment,/tabindex="0"/);
    else assert.match(segment,/hidden/);
  }
  for(const id of ["bank-form","bank-transfer-form","loan-borrow-form",
      "insurance-buy-form","house-form","room-config-form",
      "cockroach-claim","hospital-treat","home-work","work","refresh","meal-list"])
    assert.match(main,new RegExp('id="'+id+'"'));
  const allIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(allIds.length,new Set(allIds).size,"不可產生重複 ID");
  assert.match(html,/id="event-alert"[^>]*hidden/);
});
test("分頁導覽保留原版地圖與角色內容，鍵盤操作及 20 秒蟑螂可見性已接入",()=>{
  assert.match(script,/const FACILITY_TAB_NAMES = Object\.freeze/);
  assert.match(script,/function selectFacilityTab\(/);
  assert.match(script,/pane\.hidden=!selected/);
  assert.match(script,/aria-selected/);
  assert.match(script,/ArrowRight/);
  assert.match(script,/ArrowLeft/);
  assert.match(script,/Home/);
  assert.match(script,/End/);
  assert.match(script,/const pane=target\.closest\("\.facility-pane"\)/);
  assert.match(script,/selectFacilityTab\("house"\)/);
  assert.match(script,/el\("event-alert"\)\.addEventListener\("click"/);
  assert.match(script,/selectFacilityTab\("events",\{scroll:true\}\)/);
  assert.match(css,/\.game-shell\.layout\{display:block\}/);
  assert.match(css,/\.game-overview\{display:grid;grid-template-columns:minmax\(0,1fr\) 290px/);
  assert.match(css,/\.facility-tabs\{display:flex;gap:2px;overflow-x:auto/);
  assert.match(css,/\.facility-tabs button\[aria-selected="true"\]/);
  assert.match(css,/\.game-shell \.towns\{display:flex/);
  assert.match(css,/\.game-shell \.town-shortcuts\{/);
  assert.match(css,/\.game-shell \.training-grid\{gap:\.5rem/);
});


test("單機介面：可離開遊戲返回首頁、繼續進度；多人仍可真正登出",()=>{
  assert.match(html,/id="logout"[^>]*>登出<\/button>/);
  assert.match(html,/id="solo-lobby"[^>]*hidden/);
  assert.match(html,/id="solo-continue"/);
  assert.match(script,/soloAtHome=true/);
  assert.match(script,/sessionStorage\.setItem\("town-solo-at-home","1"\)/);
  assert.match(script,/sessionStorage\.removeItem\("town-solo-at-home"\)/);
  assert.match(script,/el\("logout"\)\.textContent=solo\?"離開遊戲":"登出"/);
  assert.match(script,/el\("game"\)\.hidden = !state\.character \|\| lobby/);
  assert.match(script,/await api\("logout",\{\}\)/);
});
test("單機介面：只有單機可看到四種實際等待快轉，倒數與伺服器時間同步",()=>{
  assert.match(html,/id="solo-time-panel"[^>]*hidden/);
  assert.match(html,/id="solo-game-time"/);
  assert.match(html,/data-advance="5m"/);
  assert.match(html,/data-advance="30m"/);
  assert.match(html,/data-advance="1h"/);
  assert.match(html,/data-advance="1d"/);
  assert.match(html,/id="solo-wait-hints"/);
  assert.match(script,/panel\.hidden=state\?\.mode!=="solo" \|\| !state\?\.character/);
  assert.match(script,/api\("solo\/time\/advance",\{preset\}\)/);
  assert.match(script,/const browserGameNow=\(\)=>syncedGameMs\+/);
  assert.match(script,/challenge\.expiresAt-browserGameNow\(\)/);
  assert.match(script,/state\.cockroachChallenge\.expiresAt>browserGameNow\(\)/);
  assert.match(css,/\.game-shell \.solo-time-panel/);
  assert.match(css,/\.game-shell \.solo-time-panel \.solo-time-buttons/);
});
