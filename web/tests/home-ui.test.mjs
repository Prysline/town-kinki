import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeTile } from "../src/town-map.mjs";
import { FACILITY_PANELS,townCellAction } from "../public/town-home.js";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("原版兩間食堂每日菜單與共用庫存呈現完整且售完時不可下單",()=>{
  assert.match(html,/id="meal-menu-day"/);
  assert.match(html,/兩間食堂各每日抽選最多 30 道/);
  assert.match(script,/state\.mealMenuDay/);
  assert.match(script,/meal\.stock/);
  assert.match(script,/meal\.reason\?"目前無法用餐":"選擇這道餐點"/);
  assert.match(script,/button\.disabled=Boolean\(meal\.reason\)/);
});
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
  assert.match(script,/let savingSalaryPayment=false/);
  assert.match(script,/await action\("job\/payment"/);
  assert.match(script,/el\("work"\)\.disabled = !ready \|\| savingSalaryPayment/);
});

test("原版薪資收款方式可從工作面板儲存，銀行與現金有實際分流",()=>{
  assert.match(html,/id="salary-payment"/);
  assert.match(html,/<option value="cash">現金領取<\/option>/);
  assert.match(html,/<option value="bank">轉入普通銀行存款<\/option>/);
  assert.match(script,/salary-payment"\)\.addEventListener\("change"/);
  assert.match(script,/action\("job\/payment",\{payment\}/);
  assert.match(script,/state\.character\.salaryPayment/);
});

test("職業條件只列真正大於零的需求，保留非零體格條件與後端資格限制",()=>{
  assert.match(html,/id="job-filter"><option value="all">全部職業/);
  assert.match(script,/JOB_REQUIREMENT_KEYS/);
  assert.match(script,/function jobRequirementsPanel\(job\)/);
  assert.match(script,/JOB_REQUIREMENT_KEYS\.filter\(key=>Number\(job\.requirements\?\.\[key\]\?\?0\)>0\)/);
  assert.match(script,/for\(const key of demanded\)/);
  assert.match(script,/row\.textContent=labels\[key\]\+"｜目前 "\+current\+" ／ 要求 "\+required/);
  assert.match(script,/required-current/);
  assert.match(script,/job-condition-met/);
  assert.match(script,/能力已達 /);
  assert.match(css,/\.job-condition-met/);
  assert.match(script,/if\(job\.bmiMin\|\|job\.bmiMax\)/);
  assert.match(script,/if\(job\.minHeight>0\)/);
  assert.match(script,/if\(job\.previousJob\)/);
  assert.match(script,/details\.append\(finance\)/);
  assert.match(script,/button\.disabled = Boolean\(job\.reason\)/);
});
test("職業精通有清楚的 15 級／1500 經驗進度，與既有精通紀錄分開",()=>{
  assert.match(html,/id="job-mastery-status"/);
  assert.match(html,/id="job-mastery-bar" max="1500" value="0"/);
  assert.match(html,/id="jobs-mastery-status"/);
  assert.match(script,/const masteryTargetXp=1500/);
  assert.match(script,/state\.jobLevel>=15/);
  assert.match(script,/距離精通還需 /);
  assert.match(script,/el\("job-mastery-bar"\)\.value=Math\.min\(currentMasteryXp,masteryTargetXp\)/);
  assert.match(script,/text\("mastered-job", c\.masteredJob \|\| "無"\)/);
  assert.match(css,/\.game-shell \.mastery-status progress\{/);
});

test("城鎮快捷工作只切到工作頁籤，不會自動出勤或受工作冷卻停用",()=>{
  assert.match(html,/id="home-work" data-facility="jobs-panel"/);
  assert.doesNotMatch(html,/id="home-work" data-action="work"/);
  const shortcuts=script.slice(
    script.indexOf('el("facility-shortcuts").addEventListener("click"'),
    script.indexOf('el("map-edit-toggle").addEventListener("change"')
  );
  assert.match(shortcuts,/event\.target\.closest\("button\[data-facility\]"\)/);
  assert.match(shortcuts,/goToFacility\(button\.dataset\.facility\)/);
  assert.doesNotMatch(shortcuts,/action\("work"/);
  assert.match(script,/if\(pane\)selectFacilityTab\(pane\.id\.slice\("facility-pane-"\.length\)\)/);
  assert.match(script,/el\("home-work"\)\.disabled = false/);
  assert.match(script,/el\("work"\)\.addEventListener\("click", \(\) => action\("work", \{\}\)\)/);
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
    "デパ":"retail-panel","デパ2":"retail-panel","自販機":"vending-panel","装備屋":"equipment-panel","ギフト屋":"gift-panel","リサイ":"recycle-panel","問屋":"wholesale-panel","建築":"housing-panel"
  };
  assert.deepEqual(FACILITY_PANELS,expected);
  for(const [key,panelId] of Object.entries(expected)){
    const cell=describeTile(key);
    assert.equal(cell.key,key);
    assert.deepEqual(townCellAction(cell),{kind:"facility",panelId});
    assert.match(html,new RegExp('id="'+panelId+'"'));
  }
  assert.deepEqual(townCellAction(describeTile("駅")),{kind:"station"});
  for(const key of ["ゲーセン","株"]){
    const cell=describeTile(key);
    assert.deepEqual(townCellAction(cell),{kind:"unavailable"});
  }
  assert.deepEqual(townCellAction({category:"empty"}),{kind:"inspect"});
});

test("百貨店實體地圖入口、商品與現金操作需連上真正交易路由",()=>{
  for(const key of ["デパ","デパ2"])
    assert.deepEqual(townCellAction(describeTile(key)),{kind:"facility",panelId:"retail-panel"});
  for(const id of ["retail-panel","retail-shop-select","retail-search","retail-items","retail-purchases"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(script,/function renderRetail\(\)/);
  assert.match(script,/api\("retail\/buy",pendingRetailPurchase\)/);
  assert.match(script,/item\.stock<=0/);
  assert.match(script,/renderRetail\(\)/);
  assert.match(script,/item\.origin==="retail"/);
});
test("原版特殊代碼已可依來源區分實際使用與尚未支援",()=>{
  assert.match(script,/code==="ステータス"/);
  assert.match(script,/code==="効果"/);
  assert.match(script,/原版分類標記/);
  assert.match(script,/第三段不是額外能力數值/);
});
test("百貨結帳數量與付款欄位並排、原版能力與使用狀態可展開查閱",()=>{
  assert.match(html,/class="filters retail-filters"/);
  assert.match(script,/controls\.className="retail-buy-controls"/);
  assert.match(script,/controls\.append\(qtyLabel,paymentLabel\)/);
  assert.match(script,/retailEffectDetails\(item\)/);
  assert.match(script,/info\.effects/);
  assert.match(script,/info\.usage==="automatic"/);
  assert.match(script,/info\.usage==="supported"/);
  assert.match(script,/尚未支援直接使用/);
  assert.match(css,/\.retail-buy-controls\{display:grid;grid-template-columns:/);
  assert.match(css,/\.retail-filters\{display:grid;grid-template-columns:/);
  assert.match(css,/\.retail-item-effects/);
});

test("自動販賣機真實地圖入口、獨立飲料原價、庫存及結帳表單",()=>{
  assert.deepEqual(townCellAction(describeTile("自販機")),
    {kind:"facility",panelId:"vending-panel"});
  for(const id of ["vending-panel","vending-status","vending-items","vending-purchases"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/dat_dir\/jihanki\.cgi/);
  assert.match(html,/不乘百貨三倍/);
  assert.match(script,/function renderVending\(\)/);
  assert.match(script,/api\("retail\/buy",pendingVendingPurchase\)/);
  assert.match(script,/state\.vendingGoods/);
  assert.match(script,/item\.price\*quantity/);
  assert.match(script,/if\(cell\.key==="自販機"\)renderVending\(\)/);
});

test("裝備屋真實地圖、獨立 6 欄商品、購入與換裝倉庫操作入口",()=>{
  const cell=describeTile("装備屋");
  assert.deepEqual(townCellAction(cell),
    {kind:"facility",panelId:"equipment-panel"});
  for(const id of ["equipment-panel","equipment-status","equipment-goods",
      "equipment-inventory","equipment-history"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/dat_dir\/soubi\.cgi/);
  assert.match(html,/原價現金單件購買/);
  assert.match(script,/function renderEquipment\(\)/);
  assert.match(script,/state\.equipmentGoods/);
  assert.match(script,/state\.equipmentItems/);
  assert.match(script,/api\("equipment\/"\+action,payload\)/);
  assert.match(script,/const choices=\[0,1,3,5,10,15,25,50\]/);
  assert.match(script,/submitEquipmentAction\("forge"/);
  assert.match(script,/if\(cell\.key==="装備屋"\)renderEquipment\(\)/);
});

test("原版禮品店地圖入口、五萬元轉換、指定收件人與跨玩家寄送 UI",()=>{
  assert.deepEqual(townCellAction(describeTile("ギフト屋")),
    {kind:"facility",panelId:"gift-panel"});
  for(const id of ["gift-panel","gift-status","gift-sources","gift-events"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/原版 gifutoya\.cgi/);
  assert.match(html,/50,000 元/);
  assert.match(script,/function renderGiftShop\(\)/);
  assert.match(script,/state\.giftSources/);
  assert.match(script,/state\.giftEvents/);
  assert.match(script,/api\("gift\/"\+action,payload\)/);
  assert.match(script,/if\(cell\.key==="ギフト屋"\)renderGiftShop\(\)/);
});
test("原版「リサイ」回收商店真實地圖入口、二手貨架與本人出售控制",()=>{
  assert.deepEqual(townCellAction(describeTile("リサイ")),
    {kind:"facility",panelId:"recycle-panel"});
  for(const id of ["recycle-panel","recycle-status","recycle-market",
      "recycle-sellable","recycle-history"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/原版 recycle\.cgi/);
  assert.match(script,/function renderRecycle\(\)/);
  assert.match(script,/state\.recycleListings/);
  assert.match(script,/state\.recycleSellable/);
  assert.match(script,/api\("recycle\/"\+action,body\)/);
  assert.match(script,/if\(cell\.key==="リサイ"\)renderRecycle\(\)/);
});

test("玩家住宅商店對外零售，店主售價與有效信用卡付款對應真實 API",()=>{
  assert.match(script,/activeRoom\.shop=await api\("shop\/visit\?houseId="/);
  assert.match(script,/function buyFromPlayerRoom|async function buyFromPlayerRoom/);
  assert.match(script,/api\("shop\/buy",data\)/);
  assert.match(script,/api\("shop\/price",\{houseId,sku:item\.sku,price\}\)/);
  assert.match(script,/current\.type === "1"/);
  assert.match(script,/state\.classroomCreditCards/);
  assert.match(script,/pendingPlayerStorePurchase/);
  assert.match(html,/顧客可用現金或本人有效信用卡購買/);
});

test("原版問屋入口與住宅商店設定、普通銀行結帳、倉庫及退貨 UI",()=>{
  assert.deepEqual(townCellAction(describeTile("問屋")),
    {kind:"facility",panelId:"wholesale-panel"});
  for(const id of ["wholesale-panel","wholesale-status","wholesale-house-select",
      "wholesale-category","wholesale-shop-title","wholesale-shop-save",
      "wholesale-goods","wholesale-inventory","wholesale-history"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/command\.pl::orosi/);
  assert.match(html,/tonya|問屋/);
  assert.match(script,/function renderWholesale\(\)/);
  assert.match(script,/api\("wholesale\/"\+action,body\)/);
  assert.match(script,/api\("shop\/config"/);
  assert.match(script,/state\.wholesaleGoods/);
  assert.match(script,/state\.myShops/);
  assert.match(script,/if\(cell\.key==="問屋"\)renderWholesale\(\)/);
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
  assert.match(html,/id="home-work" data-facility="jobs-panel"/);
  assert.match(script,/el\("home-work"\)\.disabled = false/);
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
  shops:["retail-panel"],
  training:["school-panel","gym-panel","classroom-panel"],
  jobs:["jobs-panel"],
  bank:["bank-panel"],
  hospital:["hospital-panel"],
  events:["event-panel"]
};
test("高密度主畫面：地圖摘要與八組可存取設施分頁，保留全部現有操作元件",()=>{
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
  assert.match(script,/state\.schoolRemainingToday/);
  assert.match(script,/學校須隔日才可再上課/);
  assert.match(script,/state\.character\.classroomReadyAt/);
  assert.match(script,/const classroomWait=Math\.max\(0,/);
  assert.match(script,/教室還需約 /);
  assert.match(script,/browserGameNow\(\)/);
  assert.match(script,/panel\.hidden=state\?\.mode!=="solo" \|\| !state\?\.character/);
  assert.match(script,/api\("solo\/time\/advance",\{preset\}\)/);
  assert.match(script,/const browserGameNow=\(\)=>syncedGameMs\+/);
  assert.match(script,/challenge\.expiresAt-browserGameNow\(\)/);
  assert.match(script,/state\.cockroachChallenge\.expiresAt>browserGameNow\(\)/);
  assert.match(css,/\.game-shell \.solo-time-panel/);
  assert.match(css,/\.game-shell \.solo-time-panel \.solo-time-buttons/);
  assert.match(css,/\.solo-time-buttons\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.solo-time-buttons button\{display:flex;align-items:center;justify-content:center/);
  assert.match(css,/min-height:42px/);
  assert.doesNotMatch(css,/\.solo-time-buttons\{grid-template-columns:repeat\(4,/);
  assert.equal((html.match(/data-advance="(?:5m|30m|1h|1d)"/g)||[]).length,4);
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

test("百貨ランダム品明確標註 17 項獨立隨機 0～上限，不誤顯成固定增加",()=>{
  assert.match(script,/info\.randomizedEffects\?" \+0～\+"\+value/);
  assert.match(script,/每項獨立隨機/);
});

test("空白万能治療幅度與原版負熱量有清楚說明，不會被誤當成治病或固定增重",()=>{
  assert.match(script,/if\(code==="万能,"\)/);
  assert.match(script,/原版沒有填寫治療幅度/);
  assert.match(script,/不會推定治病加成/);
  assert.match(script,/\(info\.calories\?\?0\)<0/);
  assert.match(script,/使用後體重減少/);
});

test("寄禮站內信 UI 允許撰寫、雙方查看，純文字輸出不做 HTML 解析",()=>{
  assert.match(html,/id="gift-mail"/);
  assert.match(html,/寄禮站內信（收件與寄件，共用 50 封上限）/);
  assert.match(html,/一般無禮品的私人信件、舊版信件匯入/);
  assert.match(script,/state\.giftMail/);
  assert.match(script,/payload\.message=message/);
  assert.match(script,/message\.maxLength=1000/);
  assert.match(script,/body\.textContent=mail\.message/);
  assert.match(script,/gift\.textContent="禮品：/);
  assert.match(script,/pendingGiftAction\.message!==message/);
  assert.doesNotMatch(script,/body\.innerHTML=mail\.message/);
});

test("所有共用成功與錯誤通知固定於目前視窗，且可關閉、可被輔助工具宣告",()=>{
  assert.match(html,/id="notice" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/id="notice-message"/);
  assert.match(html,/id="notice-close"[^>]*aria-label="關閉通知"/);
  assert.match(css,/#notice\{position:fixed;z-index:60/);
  assert.match(css,/#notice-message\{flex:1;min-width:0;overflow-wrap:anywhere/);
  assert.match(script,/text\("notice-message", message\)/);
  assert.match(script,/target\.setAttribute\("role", error \? "alert" : "status"\)/);
  assert.match(script,/el\("notice-close"\)\.addEventListener\("click"/);
  for(const feature of ["work","bank","house/build","meal/eat","train"])
    assert.match(script,new RegExp('path === "'+feature.replace("/","\\/")+'"'));
  assert.match(script,/notify\(result\.replayed\?/);
});
test("現金與普通存款同時出現在固定狀態列及銀行表單，交易回覆含最新餘額",()=>{
  for(const id of ["compact-money","compact-bank","bank-available-cash","bank-available-balance"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(script,/text\("compact-money",money\(character\.money\)\)/);
  assert.match(script,/text\("compact-bank",money\(character\.bank\)\)/);
  assert.match(script,/text\("bank-available-cash",money\(state\.character\.money\)\)/);
  assert.match(script,/text\("bank-available-balance",money\(state\.character\.bank\)\)/);
  assert.match(script,/const result=state\.bankResult/);
  assert.match(script,/目前現金：/);
  assert.match(script,/普通銀行存款：/);
  assert.match(css,/top:var\(--compact-status-height,64px\)/);
  assert.match(script,/getBoundingClientRect\(\)\.height/);
});
