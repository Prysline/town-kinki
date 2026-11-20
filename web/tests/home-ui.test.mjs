import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeTile } from "../src/town-map.mjs";
import { FACILITY_PANELS,townCellAction } from "../public/town-home.js";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("教室原版有效信用卡付款：畫面能選本人卡片、改檢查銀行餘額並送來源行號",()=>{
  assert.match(html,/原版信用卡/);
  assert.match(script,/state\.classroomCreditCards/);
  assert.match(script,/paymentSelect\.dataset\.lessonKey/);
  assert.match(script,/lesson\.creditReason/);
  assert.match(script,/lesson\.cashReason/);
  assert.match(script,/sourceLine:Number\(value\.slice\(7\)\)/);
  assert.match(script,/action\("train", \{ key,\.\.\.payment \}\)/);
});
test("工作結果顯示原版結薪進度，避免把未達發薪次數誤認為銀行或現金入帳故障",()=>{
  assert.match(html,/id="work-payday-status"/);
  assert.match(script,/job\.worksUntilPayday/);
  assert.match(script,/job\.workProgress/);
  assert.match(script,/result\.pending/);
  assert.match(script,/result\.payEvery/);
  assert.match(script,/result\.worksUntilPayday/);
  assert.match(script,/本次尚未到發薪次數/);
  assert.match(script,/此次沒有薪資入帳/);
});

test("原版薪資收款方式可從工作面板儲存，銀行與現金有實際分流",()=>{
  assert.match(html,/id="salary-payment"/);
  assert.match(html,/<option value="cash">現金領取<\/option>/);
  assert.match(html,/<option value="bank">轉入普通銀行存款<\/option>/);
  assert.match(script,/salary-payment"\)\.addEventListener\("change"/);
  assert.match(script,/action\("job\/payment",\{payment\}/);
  assert.match(script,/state\.character\.salaryPayment/);
});

test("職業條件保留原版十七項數值及全部職業可展開檢視",()=>{
  assert.match(html, /id="job-filter"><option value="all">全部職業/);
  assert.match(script, /JOB_REQUIREMENT_KEYS/);
  assert.match(script, /function jobRequirementsPanel\(job\)/);
  assert.match(script, /job\.requirements\?\.\[key\]/);
  assert.match(script, /state\.physique\?\.bmi/);
  assert.match(script, /details\.append\(other,finance,requirements\)/);
  assert.match(script, /button\.disabled = Boolean\(job\.reason\)/);
});
test("地圖車站接回原版六組票價與真實跨城操作而非免費切換",()=>{
  assert.match(html,/id="station-heading"/);
  assert.match(html,/id="station-status"/);
  assert.match(script,/state\.trainDestinations/);
  assert.match(script,/fare=fares\.get\(town\.id\)/);
  assert.match(script,/button\.disabled = current \|\| !affordable/);
  assert.match(script,/action\("move", \{ townId: town\.id \}\)/);
  assert.match(script,/result\.fare/);
  assert.match(script,/destination\.kind==="station"/);
  assert.deepEqual(townCellAction(describeTile("駅")),{kind:"station"});
});
test("原 CGI 建築代碼只連到 Web 真正已實作的設施入口",()=>{
  const expected={
    "銀行":"bank-panel","病院":"hospital-panel","職安":"jobs-panel",
    "教室":"classroom-panel","食堂":"dining-panel","食堂２":"dining-panel",
    "建築":"housing-panel"
  };
  assert.deepEqual(FACILITY_PANELS,expected);
  for(const [key,panelId] of Object.entries(expected)){
    const cell=describeTile(key);
    assert.equal(cell.key,key);
    assert.deepEqual(townCellAction(cell),{kind:"facility",panelId});
    assert.match(html,new RegExp('id="'+panelId+'"'));
  }
  assert.deepEqual(townCellAction(describeTile("駅")),{kind:"station"});
  for(const key of ["デパ","ギフト屋","ゲーセン","株"]){
    const cell=describeTile(key);
    assert.deepEqual(townCellAction(cell),{kind:"unavailable"});
  }
  assert.deepEqual(townCellAction({category:"empty"}),{kind:"inspect"});
});

test("原版教室必須導向獨立教室，而非誤開學校或健身房",()=>{
  const result=townCellAction(describeTile("教室"));
  assert.deepEqual(result,{kind:"facility",panelId:"classroom-panel"});
  assert.match(html,/id="classroom-lessons"/);
  assert.match(html,/id="classroom-status"/);
  assert.match(script,/classroom: el\("classroom-lessons"\)/);
  assert.match(script,/state\.classroomCooldownMs/);
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
  training:["school-panel","gym-panel","classroom-panel"],
  jobs:["jobs-panel"],
  bank:["bank-panel"],
  hospital:["hospital-panel"],
  events:["event-panel"]
};
test("高密度主畫面：地圖摘要與七組可存取設施分頁，保留全部現有操作元件",()=>{
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
  assert.match(script,/el\("event-popup-claim"\)\.addEventListener\("click"/);
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


test("單人角色管理：只在返回單人首頁時顯示刪除入口，必須名稱＋二次確認，刪後進建角",()=>{
  assert.match(html,/id="solo-lobby" class="intro card" hidden/);
  assert.match(html,/id="solo-character-name"/);
  assert.match(html,/id="solo-delete-details"/);
  assert.match(html,/id="solo-delete-form"/);
  assert.match(html,/id="solo-delete-name"/);
  assert.match(html,/id="solo-delete-ack" type="checkbox" required/);
  assert.match(html,/id="solo-delete-submit"/);
  assert.match(html,/城鎮地圖編輯與單機遊戲時間不會被清除/);
  assert.match(script,/const lobby=solo && Boolean\(state\.character\) && soloAtHome/);
  assert.match(script,/if\(lobby\)text\("solo-character-name",state\.character\.name\)/);
  assert.match(script,/if\(entered!==state\.character\.name\)/);
  assert.match(script,/window\.confirm\("確定永久刪除/);
  assert.match(script,/api\("solo\/character\/delete",\{characterName:entered,confirm:true\}\)/);
  assert.match(script,/el\("solo-delete-form"\)\.reset\(\)/);
  assert.match(script,/sessionStorage\.removeItem\("town-solo-at-home"\)/);
  assert.match(css,/#solo-lobby \.solo-delete-box/);
  assert.match(css,/#solo-lobby \.danger-action/);
});


const originalTop=readFileSync(new URL("../../top.pl",import.meta.url),"latin1");
const originalTown=readFileSync(new URL("../../town_maker.cgi",import.meta.url),"latin1");
test("原版依據：事件在右上角獨立通知、能力值在右側狀態／物品並列切換",()=>{
  assert.match(originalTop,/position:absolute;top:0;z-index:1;right:10/);
  assert.match(originalTop,/event_close\(suuji\)/);
  assert.match(originalTop,/event_open\(suuji\)/);
  assert.match(originalTown,/id="nouryoku"/);
  assert.match(originalTown,/menu\('nouryoku','stetas'\)/);
  assert.match(originalTown,/menu\('nouryoku','item'\)/);
  assert.match(originalTown,/\$nouryoku_bar\[6\]/);
  assert.match(originalTown,/\$nouryoku_bar\[13\]/);
  assert.match(originalTown,/\$nouryoku_bar\[20\]/);
});
test("能力值位於右側角色資訊切換而非全寬設施分頁，三組黃條不會拉長",()=>{
  const aside=html.indexOf('class="sidebar game-status-column"');
  const endAside=html.indexOf("</aside>",aside);
  const right=html.slice(aside,endAside);
  assert.ok(aside>0&&endAside>aside);
  assert.match(right,/id="profile-view-tabs" class="profile-view-tabs" role="tablist"/);
  assert.match(right,/id="profile-tab-status"[^>]*role="tab"/);
  assert.match(right,/id="profile-tab-inventory"[^>]*role="tab"/);
  assert.match(right,/id="profile-tab-attributes"[^>]*role="tab"/);
  const statusPos=right.indexOf('id="player-summary"');
  const itemPos=right.indexOf('id="inventory-panel"');
  const abilityPos=right.indexOf('id="attributes-panel"');
  assert.ok(statusPos>0&&itemPos>statusPos&&abilityPos>itemPos);
  assert.match(right,/id="attributes-panel"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(right,/class="ability-groups" id="attributes"/);
  assert.equal((html.match(/id="attributes-panel"/g)||[]).length,1);
  assert.doesNotMatch(html,/id="facility-pane-stats"/);
  assert.doesNotMatch(html,/id="facility-tab-stats"/);
  assert.doesNotMatch(html,/id="facility-tab-inventory"/);
  assert.doesNotMatch(html,/id="facility-pane-inventory"/);
  assert.match(right,/id="inventory-panel"[^>]*role="tabpanel"[^>]*hidden/);
  for(const id of ["insurance-buy-form","insurance-quantity","insurance-buy","insurance-purchases",
    "legacy-inventory-list","legacy-item-use-history"])
    assert.match(right,new RegExp('id="'+id+'"'));
  assert.match(script,/const ABILITY_GROUPS =/);
  assert.match(script,/label:"頭腦"/);
  assert.match(script,/label:"身體"/);
  assert.match(script,/label:"其他"/);
  assert.match(script,/function renderAbilities\(stats\)/);
  assert.match(script,/renderAbilities\(c\.stats\)/);
  assert.match(script,/function selectProfileView\(/);
  assert.match(script,/el\("profile-view-tabs"\)\.addEventListener\("keydown"/);
  assert.match(css,/\.attributes-panel\{width:100%;min-width:0;overflow:hidden\}/);
  assert.match(css,/\.ability-groups\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.ability-track>span\{display:block;height:100%;background:#edc443/);
});
test("體格資訊在右側狀態分頁直接可見，不必展開更多資訊",()=>{
  const aside=html.slice(html.indexOf('id="player-summary"'),html.indexOf('id="inventory-panel"'));
  const physiquePos=aside.indexOf('class="physique-summary"');
  const detailsPos=aside.indexOf('class="status-details"');
  assert.ok(physiquePos>0&&detailsPos>physiquePos);
  const visible=aside.slice(physiquePos,detailsPos);
  assert.match(visible,/aria-labelledby="physique-summary-title"/);
  assert.match(visible,/id="physique-summary-title">體格資訊/);
  assert.match(visible,/id="measurements"/);
  assert.match(visible,/id="physique-status"/);
  assert.doesNotMatch(aside.slice(detailsPos),/id="measurements"|id="physique-status"/);
  assert.equal((html.match(/id="measurements"/g)||[]).length,1);
  assert.equal((html.match(/id="physique-status"/g)||[]).length,1);
  // 保留原本的 API snapshot 與渲染 ID：移動顯示位置，不引入新資料欄位。
  assert.match(script,/text\("measurements", c\.height/);
  assert.match(script,/text\("physique-status",\(state\.physique\?\.label/);
  assert.match(css,/\.game-shell \.physique-summary\{min-width:0/);
  assert.match(css,/\.physique-summary \.status-physique dd\{font-variant-numeric:tabular-nums\}/);
});

test("原版右上角事件通知：可關閉，限時事件直接拍打，不再強制捲動整頁",()=>{
  assert.match(html,/id="event-popup"[^>]*hidden/);
  assert.match(html,/id="event-popup-close"/);
  assert.match(html,/id="event-popup-title"/);
  assert.match(html,/id="event-popup-body"/);
  assert.match(html,/id="event-popup-claim"/);
  assert.match(script,/function dismissEventPopup\(/);
  assert.match(script,/el\("event-popup-close"\)\.addEventListener\("click",dismissEventPopup\)/);
  assert.match(script,/action\("events\/cockroach\/claim",\{\}\)/);
  assert.match(script,/event\?\.day===state\?\.character\?\.lastEventDay/);
  assert.doesNotMatch(script,/selectFacilityTab\("events",\{scroll:true\}\)/);
  assert.match(css,/\.event-popup\{position:fixed;z-index:22;top:4\.8rem/);
});
test("往下捲過地圖後顯示固定角色能量，返回上方、登出或刪角則隱藏",()=>{
  assert.match(html,/id="compact-status" class="compact-status" hidden/);
  for(const id of ["compact-character-name","compact-body-energy","compact-brain-energy",
    "compact-body-bar","compact-brain-bar"])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(script,/function updateCompactVisibility\(\)/);
  assert.match(script,/shouldShowCompactEnergy\(\{/);
  assert.match(script,/el\("body-energy"\)\.closest\("div"\)\.getBoundingClientRect\(\)\.bottom/);
  assert.match(script,/el\("profile-view-tabs"\)\.getBoundingClientRect\(\)\.bottom/);
  assert.match(script,/import \{ shouldShowCompactEnergy \} from "\.\/energy-visibility\.js"/);
  assert.doesNotMatch(script,/facility\.getBoundingClientRect\(\)\.top<85/);
  assert.match(script,/updateCompactVisibility\(\);\s*return true;/);
  assert.match(script,/Boolean\(state\?\.character\)&&!el\("game"\)\.hidden/);
  assert.match(script,/window\.addEventListener\("scroll",updateCompactVisibility,\{passive:true\}\)/);
  assert.match(script,/window\.addEventListener\("resize",updateCompactVisibility\)/);
  assert.match(script,/renderCompactStatus\(c\)/);
  assert.match(script,/document\.body\.classList\.toggle\("compact-status-active",show\)/);
  assert.match(css,/\.compact-status\{position:fixed;left:50%;top:0/);
  assert.match(css,/body\.compact-status-active \.game-shell \.facility-tabs\{top:54px\}/);
  assert.match(css,/@media\(max-width:600px\)/);
});


test("原版右側物品頁籤保留保險、消耗品與使用紀錄，地圖物品快捷鍵可直接切換",()=>{
  const main=html.slice(html.indexOf('id="game"'));
  const sidebarStart=main.indexOf('class="sidebar game-status-column"');
  const right=main.slice(sidebarStart,main.indexOf('</aside>',sidebarStart));
  assert.match(right,/id="profile-view-tabs"/);
  assert.match(right,/data-profile-view="status"/);
  assert.match(right,/data-profile-view="inventory"/);
  assert.match(right,/data-profile-view="attributes"/);
  assert.match(script,/const PROFILE_VIEWS = Object\.freeze\(\["status","inventory","attributes"\]\)/);
  assert.match(script,/inventory:"inventory-panel"/);
  assert.match(script,/if\(target\.closest\("#inventory-panel"\)\)selectProfileView\("inventory"\)/);
  assert.match(html,/data-facility="inventory-panel"/);
  assert.match(script,/el\("facility-shortcuts"\)\.addEventListener\("click"/);
  assert.match(css,/\.profile-view-tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.inventory-panel\{min-width:0;width:100%;max-height:min\(65vh,540px\)/);
  assert.match(css,/overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain/);
  assert.match(script,/el\("insurance-buy-form"\)\.addEventListener/);
});
