import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeTile } from "../src/town-map.mjs";
import { FACILITY_PANELS,townCellAction } from "../public/town-home.js";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const shopEffects=readFileSync(new URL("../public/shop-effects.js",import.meta.url),"utf8");

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
test("職業名稱緊貼原版等級，只有本級 100 XP 進度與 15 級精通文字，不再重複 1500 XP 長條",()=>{
  assert.match(html,/<dt>目前職業<\/dt><dd id="current-job"><\/dd>/);
  assert.match(script,/state\.currentJob\.name\+"（Lv\."\+jobLevel\+"）"/);
  assert.match(html,/id="job-level-progress"/);
  assert.match(html,/id="job-level-xp"/);
  assert.match(html,/id="job-next-level"/);
  assert.match(html,/id="job-level-bar" max="100" value="0"/);
  assert.match(script,/const currentLevelXp=jobExperience%100/);
  assert.match(script,/text\("job-level-xp","本級經驗 "\+currentLevelXp\+" \/ 100 XP"\)/);
  assert.match(script,/text\("job-next-level","距離 Lv\."\+\(jobLevel\+1\)\+" 還差 "\+\(100-currentLevelXp\)\+" XP"\)/);
  assert.match(script,/el\("job-level-bar"\)\.value=currentLevelXp/);
  assert.match(script,/jobLevel>=15\?"已達 Lv\.15 精通門檻"/);
  assert.match(script,/1500-jobExperience/);
  assert.match(script,/text\("mastered-job", c\.masteredJob \|\| "無"\)/);
  assert.match(html,/<dt>最近精通職業<\/dt><dd id="mastered-job"/);
  assert.doesNotMatch(html,/id="jobs-mastery-status"/);
  assert.doesNotMatch(html,/id="job-mastery-bar"/);
  assert.doesNotMatch(html,/id="job-level"/);
  assert.match(css,/\.game-shell \.job-level-progress\[hidden\]\{display:none\}/);
  assert.match(css,/\.game-shell \.job-level-progress progress\{/);
});
test("職業介紹所還原原版階級星號與就職資格，不混用個人等級",()=>{
  assert.match(html,/id="jobs-panel"/);
  assert.match(html,/職業名稱後的 \* 代表原版職業階級/);
  assert.match(script,/const rankStars=job\.rank>1\?"\*"\.repeat\(job\.rank-1\):""/);
  assert.match(script,/title\.textContent = job\.name \+ rankStars/);
  assert.match(script,/job\.reason\?\(job\.previousJob/);
  assert.match(script,/尚未解鎖：/);
  assert.match(script,/目前未達就職條件：/);
  assert.match(script,/meta\.append\(title,eligibility,desc,requirements\)/);
  assert.match(script,/button\.disabled = Boolean\(job\.reason\)/);
  assert.match(css,/\.job \.job-eligibility\.locked/);
});
test("工作能量需求與發薪週期保留在操作區，和職業經驗進度分離",()=>{
  assert.match(html,/id="work-cost-status"/);
  assert.match(html,/id="work-payday-status"/);
  assert.match(script,/const workJob=job\?state\.jobs\?\.find\(entry=>entry\.key===job\.key\):null/);
  assert.match(script,/每次工作消耗：身體能量 /);
  assert.match(script,/頭腦能量 /);
  assert.match(script,/job\.workProgress/);
  assert.match(script,/job\.worksUntilPayday/);
  assert.doesNotMatch(script,/text\("jobs-mastery-status"/);
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
    "デパ":"retail-panel","デパ2":"retail-panel","自販機":"vending-panel","装備屋":"equipment-panel","ギフト屋":"gift-panel","リサイ":"recycle-panel","クーポン":"event-panel","釣り":"fishing-panel","販売1":"fishing-panel","合成":"crafting-panel","ゲーセン":"arcade-dice-panel","おばちゃん":"osaka-panel","おばちゃん強":"osaka-panel","問屋":"wholesale-panel","建築":"housing-panel"
  };
  assert.deepEqual(FACILITY_PANELS,expected);
  for(const [key,panelId] of Object.entries(expected)){
    const cell=describeTile(key);
    assert.equal(cell.key,key);
    assert.deepEqual(townCellAction(cell),{kind:"facility",panelId});
    assert.match(html,new RegExp('id="'+panelId+'"'));
  }
  assert.deepEqual(townCellAction(describeTile("駅")),{kind:"station"});
  for(const key of ["株"]){
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
  assert.match(script,/item\.readOnly\?"歷史來源封存":item\.origin==="fishing"/);
});

test("IT-02／MP-06：只將後端核實的ギフト類公路載具顯示為可用，並正確標示優惠券來源",()=>{
  assert.match(script,/const roadVehicles=new Map\(\(state\.roadTravel\?\.choices\?\?\[\]\)/);
  assert.match(script,/giftVehicleCount=gifts\.filter\(gift=>roadVehicles\.has\(gift\.sourceLine\)\)/);
  assert.match(script,/vehicle=roadVehicles\.get\(gift\.sourceLine\)/);
  assert.match(script,/button\.textContent="前往公路旅行"/);
  assert.match(script,/goToFacility\("road-travel-panel"\)/);
  assert.match(script,/select\.value=String\(vehicle\.sourceLine\)/);
  assert.match(script,/select\.dispatchEvent\(new Event\("change",\{bubbles:true\}\)\)/);
  assert.match(script,/item\.origin==="coupon"\?"優惠券":"寶箱"/);
  assert.match(css,/\.inventory-gift-row\{display:flex;/);
  assert.match(html,/id="road-travel-panel"/);
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
  assert.match(script,/renderShopTable\(el\("vending-items"\),goods/);
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

test("課程不可用時恢復整張灰階與卡片倒數，停用由真實課程資格控制",()=>{
  assert.match(css,/\.game-shell \.training-tile\.is-unavailable\{background:#e5e7e5/);
  assert.match(css,/\.game-shell \.training-tile\.is-unavailable button:disabled/);
  assert.match(css,/\.game-shell \.training-tile \.training-countdown/);
  assert.match(script,/const countdown=document\.createElement\("p"\)/);
  assert.match(script,/countdown\.setAttribute\("role","timer"\)/);
  assert.match(script,/tile\.classList\.toggle\("is-unavailable",unavailable\)/);
  assert.match(script,/submit\.disabled=unavailable/);
  assert.match(script,/blocked\.textContent=reason\?\?""/);
  assert.match(script,/paymentSelect\?\.addEventListener\("change",\(\)=>update\(\)\)/);
  assert.match(script,/tile\.append\(countdown,blocked,submit\)/);
});
test("健身房課程卡片明示 Web 補完減重預估，完成後呈現後端實際減重而非誤當原版公式",()=>{
  assert.match(script,/lesson\.type==="gym"\?/);
  assert.match(script,/Web 補完規則預計減重/);
  assert.match(script,/lesson\.weightLoss\?\?0/);
  assert.match(script,/result\.weightLoss \? "，體重減少 "/);
});

test("學校跨日、健身房與教室各自倒數且每秒刷新，到期需重新取後端資格",()=>{
  assert.match(script,/function schoolWaitUntilTomorrow\(now\)/);
  assert.match(script,/character\.lastSchoolDay!==today/);
  assert.match(script,/timeZone:zone,hour:"2-digit",minute:"2-digit",second:"2-digit"/);
  assert.match(script,/gym:Math\.max\(0,\(state\?\.character\?\.gymReadyAt\?\?0\)-now\)/);
  assert.match(script,/classroom:Math\.max\(0,\(state\?\.character\?\.classroomReadyAt\?\?0\)-now\)/);
  assert.match(script,/function formatTrainingWait\(ms\)/);
  assert.match(script,/updateTrainingCountdowns\(\); \/\/ 每秒刷新課程灰階和剩餘時間/);
  assert.match(script,/for\(const update of trainingTileUpdates\)update\(waits\)/);
  assert.match(script,/cooldownReason\?"正在更新課程狀態…":originalReason/);
  assert.match(script,/api\("state"\)\.then\(fresh=>\{state=fresh;render\(\);\}\)/);
  assert.match(script,/const unavailable=wait>0\|\|Boolean\(reason\)/);
  assert.match(script,/state\.schoolRemainingToday&&character\.lastSchoolDay&&waits\.school===0/);
  assert.match(script,/state\.gymCooldownMs>0&&character\.gymReadyAt&&waits\.gym===0/);
  assert.match(script,/state\.classroomCooldownMs>0&&character\.classroomReadyAt&&waits\.classroom===0/);
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
  events:["event-panel"],
  mail:["mail-panel"],
  games:["arcade-dice-panel"]
};
test("高密度主畫面：地圖摘要與十組可存取設施分頁，保留全部現有操作元件",()=>{
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
  assert.match(shopEffects,/randomizedEffects\?" \+0～\+"\+value/);
  assert.match(script,/groupedStatLines\(info.effects,labels,info.randomizedEffects\)/);
  assert.match(script,/每項獨立隨機/);
});

test("空白万能治療幅度與原版負熱量有清楚說明，不會被誤當成治病或固定增重",()=>{
  assert.match(script,/if\(code==="万能,"\)/);
  assert.match(script,/原版沒有填寫治療幅度/);
  assert.match(script,/不會推定治病加成/);
  assert.match(script,/\(info\.calories\?\?0\)<0/);
  assert.match(script,/使用後體重減少/);
});

test("郵件獨立分頁與城鎮快捷：純文字信、寄禮信同一信箱，沒有 HTML 注入",()=>{
  assert.match(html,/id="facility-tab-mail"[^>]+role="tab"/);
  assert.match(html,/id="facility-pane-mail"/);
  assert.match(html,/id="mail-panel"/);
  assert.match(html,/data-facility="mail-panel"/);
  assert.match(html,/id="mail-compose"/);
  assert.match(html,/id="mail-recipient"/);
  assert.match(html,/id="mail-message"[^>]*maxlength="1000"/);
  assert.match(html,/id="mail-messages"/);
  assert.match(html,/收件與寄件合計最多 50 封/);
  assert.match(script,/FACILITY_TAB_NAMES = Object\.freeze\(\[[^\]]*"mail"\]/);
  assert.match(script,/function renderMailbox\(\)/);
  assert.match(script,/state\.mailbox/);
  assert.match(script,/body\.textContent=mail\.message/);
  assert.match(script,/gift\.textContent="禮品：/);
  assert.match(script,/await api\("mail\/send",pendingMailAction\)/);
  assert.match(script,/await api\("mail\/delete",\{mailId\}\)/);
  assert.match(script,/pendingMailAction\.message!==message/);
  assert.match(script,/payload\.message=message/);
  assert.match(script,/message\.maxLength=1000/);
  assert.doesNotMatch(script,/body\.innerHTML=mail\.message/);
  assert.doesNotMatch(html,/id="gift-mail"/,"寄禮已統一至郵件分頁而非複製第二個信箱");
});

test("共用交易結果依原版中央呈現，玩家確認後返回操作畫面，不再使用右下角 Toast",()=>{
  assert.match(html,/<dialog id="result-dialog"[^>]*aria-modal="true"/);
  assert.match(html,/id="result-dialog-title"/);
  assert.match(html,/id="result-dialog-message"/);
  assert.match(html,/id="result-dialog-close"[^>]*>確認並返回/);
  assert.doesNotMatch(html,/id="notice"/);
  assert.match(css,/\.result-dialog::backdrop/);
  assert.match(css,/white-space:pre-line;overflow-wrap:anywhere/);
  assert.doesNotMatch(css,/#notice\{position:fixed/);
  assert.match(script,/dialog\.showModal\(\)/);
  assert.match(script,/dialog\.setAttribute\("role",error\?"alertdialog":"dialog"\)/);
  assert.match(script,/el\("result-dialog-close"\)\.addEventListener\("click"/);
  assert.match(script,/resultReturnFocus\.focus\(\{preventScroll:true\}\)/);
  for(const feature of ["work","bank","house/build","meal/eat","train"])
    assert.match(script,new RegExp('path === "'+feature.replace("/","\\/")+'"'));
  assert.match(script,/notify\(result\.replayed\?/);
});
test("表單與餘額驗證錯誤就地顯示；共用錯誤處理亦有中央後備畫面",()=>{
  assert.match(script,/function showInlineFeedback\(message,error,source\)/);
  assert.match(script,/event\.type==="submit"\?\(event\.submitter\|\|event\.target\)/);
  assert.match(script,/const form=origin\.closest\("form"\)/);
  assert.match(script,/note\.setAttribute\("role",error\?"alert":"status"\)/);
  assert.match(script,/note\.textContent=String\(message\)/);
  assert.match(script,/note\.scrollIntoView\(\{block:"nearest",behavior:"auto"\}\)/);
  assert.match(script,/if\(\(error\|\|inline\)&&showInlineFeedback\(message,error,source\)\)return/);
  assert.match(script,/showResultDialog\(message,title\|\|\(error\?"操作未完成":"操作結果"\),error\)/);
  assert.match(css,/\.operation-feedback\.error/);
  assert.match(script,/source:el\("map-selection"\)/);
  assert.match(script,/source:path==="map\/tile"\?el\("map-selection"\):undefined/);
  assert.match(script,/renderLegacyItems\(\);\s+notify\(error\.message,true\)/);
});
test("電車、工作維持不同結果標題；非交易訊息不強制跳出對話框",()=>{
  assert.match(script,/title:"電車移動結果"/);
  assert.match(script,/title:"工作結果"/);
  assert.match(script,/notify\(messages\.join\("\\n"\)/);
  assert.match(script,/inline:path==="map\/tile"\|\|path==="job\/payment"/);
  assert.match(script,/notify\("遊戲資料已更新",false,\{inline:true\}\)/);
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


test("第50階段：單機首次遊玩可自願建立非原版試玩街區，已有配置不顯示入口",()=>{
  assert.match(html,/id="solo-starter-town"/);
  assert.match(html,/id="solo-starter-create"/);
  assert.match(html,/不是原版歷史地圖/);
  assert.match(html,/不會覆蓋已有資料/);
  assert.match(script,/el\("solo-starter-town"\)\.hidden=!\(state\.mode==="solo"&&!map\.configured\)/);
  assert.match(script,/map\.source === "web-solo-starter"/);
  assert.match(script,/不是原版歷史街區/);
  assert.match(script,/el\("solo-starter-create"\)\.addEventListener\("click"/);
  assert.match(script,/window\.confirm\("將在目前城鎮建立一張 Web 試玩街區/);
  assert.match(script,/action\("solo\/map\/starter",\{\}/);
  assert.match(css,/\.map-starter\{/);
});


test("單機 Web 試玩街區提供可操作的新手路線，不誤用在原版或自訂地圖",()=>{
  assert.match(html,/id="solo-play-guide"/);
  assert.match(html,/第一次在試玩街區遊玩/);
  assert.match(html,/不會自動扣款或贈送物品/);
  assert.match(script,/el\("solo-play-guide"\)\.hidden=!\(state\.mode==="solo"&&map\.source==="web-solo-starter"\)/);
  assert.match(script,/el\("solo-play-guide"\)\.addEventListener\("click"/);
  for(const id of ["jobs-panel","retail-panel","inventory-panel",
    "fishing-panel","crafting-panel","arcade-dice-panel"]){
    assert.match(html,new RegExp('id="'+id+'"'));
    assert.match(html,new RegExp('id="solo-play-guide"[\\s\\S]*?data-facility="'+id+'"'));
  }
  assert.match(css,/\.starter-guide-actions\{display:flex;/);
});

test("第51階段：原版優惠券兌換所地圖入口、30獎品、本人事件券與原子入庫 UI",()=>{
  assert.deepEqual(townCellAction(describeTile("クーポン")),
    {kind:"facility",panelId:"event-panel"});
  assert.match(html,/id="coupon-rewards"/);
  assert.match(html,/id="coupon-shop-status"/);
  assert.match(html,/id="coupon-redemptions"/);
  assert.match(html,/只可使用「Web 隨機事件所得」的優惠券點數/);
  assert.match(html,/一般持有物上限 25 格/);
  assert.match(script,/function renderCouponShop\(\)/);
  assert.match(script,/renderCouponShop\(\);/);
  assert.match(script,/state\.couponRewards/);
  assert.match(script,/state\.couponRedemptions/);
  assert.match(script,/state\.couponShopAvailable===true/);
  assert.match(script,/button\.disabled=!reward\.canRedeem/);
  assert.match(script,/heading\.textContent=reward\.originalName/);
  assert.match(script,/reason\.textContent=reward\.reason/);
  assert.match(script,/const result=state\.couponResult/);
  assert.match(script,/await api\("coupon\/redeem",pendingCouponRedemption\)/);
  assert.match(script,/pendingCouponRedemption\.originalName!==reward\.originalName/);
  assert.match(script,/window\.confirm\("確定使用 "/);
  assert.doesNotMatch(script,/heading\.innerHTML=reward\.originalName/);
});


test("第54階段：原版合成屋只有真正材料才能製作，表單及資料皆用安全 DOM",()=>{
  assert.deepEqual(townCellAction(describeTile("合成")),{
    kind:"facility",panelId:"crafting-panel"
  });
  for(const id of ["crafting-panel","crafting-status","crafting-recipes",
    "crafting-select","crafting-quantity","crafting-submit","crafting-history"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.ok(html.includes("gouseiya.cgi／dat_dir/gousei.cgi"));
  assert.ok(script.includes("function renderCrafting(){"));
  assert.ok(script.includes("renderCrafting();"));
  assert.ok(script.includes('await api("crafting/make"'));
  assert.ok(script.includes("pendingCraftingAction"));
  assert.ok(script.includes("materials"));
  assert.ok(!script.includes("innerHTML=recipe.name"));
});

test("第55階段：原版遊樂中心地圖入口與安全下注面板已接真實後端",()=>{
  assert.deepEqual(townCellAction(describeTile("ゲーセン")),
    {kind:"facility",panelId:"arcade-dice-panel"});
  for(const id of ["facility-tab-games","facility-pane-games","arcade-dice-panel",
    "arcade-dice-status","arcade-dice-guess","arcade-dice-stake",
    "arcade-dice-quote","arcade-dice-submit","arcade-dice-result","arcade-dice-history"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.ok(html.includes("gamerand.cgi／saikoro.cgi"));
  assert.ok(script.includes("function renderArcadeDice(){"));
  assert.ok(script.includes("renderArcadeDice();"));
  assert.ok(script.includes('await api("arcade/dice/play"'));
  assert.ok(script.includes("pendingArcadeDice"));
  assert.ok(script.includes("arcadeDiceSubmitting"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(!script.includes("innerHTML=round.guess"));
});

test("第56階段：遊樂中心新增HighLow真實下注、牌桌與本人紀錄，安全DOM呈現",()=>{
  for(const id of ["arcade-highlow-panel","arcade-highlow-status",
    "arcade-highlow-table","arcade-highlow-guess","arcade-highlow-quote",
    "arcade-highlow-submit","arcade-highlow-result","arcade-highlow-history"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.ok(html.includes("donut.cgi／town_ini.cgi"));
  assert.ok(html.includes("同點數"));
  assert.ok(script.includes("function renderArcadeHighLow(){"));
  assert.ok(script.includes("renderArcadeHighLow();"));
  assert.ok(script.includes('await api("arcade/highlow/play"'));
  assert.ok(script.includes("pendingArcadeHighLow"));
  assert.ok(script.includes("arcadeHighLowSubmitting"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(!script.includes("innerHTML=round.drawnCard"));
});

test("第57階段：三種donus模式、原版卡牌資料與安全DOM表單皆接真實API",()=>{
  for(const id of ["arcade-donuts-panel","arcade-donuts-status",
    "arcade-donuts-mode","arcade-donuts-table","arcade-donuts-quote",
    "arcade-donuts-submit","arcade-donuts-result","arcade-donuts-history"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.ok(html.includes("gamerand.cgi／donut.cgi"));
  for(const mode of ["donus","donus2","donus3"])
    assert.ok(html.includes('value="'+mode+'"'));
  assert.ok(html.includes("第一、二種"));
  assert.ok(html.includes("第三種"));
  assert.ok(script.includes("function renderArcadeDonuts(){"));
  assert.ok(script.includes("renderArcadeDonuts();"));
  assert.ok(script.includes('await api("arcade/donuts/draw"'));
  assert.ok(script.includes("pendingArcadeDonut"));
  assert.ok(script.includes("arcadeDonutSubmitting"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(!script.includes("innerHTML=round.drawnCard"));
});

test("第58階段：原版六位數樂透6欄選號、下注、安全DOM與伺服器交易已接入",()=>{
  for(const id of ["arcade-loto-panel","arcade-loto-status","arcade-loto-stake",
    "arcade-loto-quote","arcade-loto-submit","arcade-loto-result","arcade-loto-history"])
    assert.ok(html.includes('id="'+id+'"'));
  for(let i=1;i<=6;i++)assert.ok(html.includes('id="arcade-loto-digit-'+i+'"'));
  assert.ok(html.includes("gamerand.cgi／loto.cgi"));
  assert.ok(html.includes("最後一位玩樂透的人"));
  assert.ok(html.includes("六號樂透"));
  assert.ok(script.includes("function renderInstantLoto(){"));
  assert.ok(script.includes("renderInstantLoto();"));
  assert.ok(script.includes('await api("arcade/loto/play"'));
  assert.ok(script.includes("pendingInstantLoto"));
  assert.ok(script.includes("instantLotoSubmitting"));
  assert.ok(script.includes("crypto.randomUUID()"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=round.chosenDigits"));
});

test("第59階段：六號樂透原版分場、六個1～36選號、隨機購券、按需開獎與銀行展示",()=>{
  for(const id of ["arcade-loto6-panel","arcade-loto6-status",
    "arcade-loto6-random","arcade-loto6-quote","arcade-loto6-buy",
    "arcade-loto6-check","arcade-loto6-result","arcade-loto6-history"])
    assert.ok(html.includes('id="'+id+'"'));
  for(let i=1;i<=6;i++)assert.ok(html.includes('id="arcade-loto6-number-'+i+'"'));
  assert.ok(html.includes("gamerand.cgi／loto6.cgi"));
  assert.ok(html.includes("200注"));
  assert.ok(html.includes("普通銀行"));
  assert.ok(html.includes("不是在背景定時執行"));
  assert.ok(script.includes("function renderLoto6(){"));
  assert.ok(script.includes("renderLoto6();"));
  assert.ok(script.includes('await api("arcade/loto6/buy"'));
  assert.ok(script.includes('await api("arcade/loto6/check"'));
  assert.ok(script.includes("pendingLoto6Purchase"));
  assert.ok(script.includes("loto6Busy"));
  assert.ok(script.includes("new Set(chosen).size===6"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=ticket.numbers"));
});

test("第60階段：多卡五課程、實際79至19%成功率、原子下注與安全DOM",()=>{
  for(const id of ["arcade-cardw-panel","arcade-cardw-status",
    "arcade-cardw-course","arcade-cardw-quote","arcade-cardw-submit",
    "arcade-cardw-result","arcade-cardw-history"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.ok(html.includes("cardw2.cgi"));
  for(let i=0;i<=4;i++)assert.ok(html.includes('value="'+i+'">'));
  assert.ok(html.includes("79%／64%／49%／34%／19%"));
  assert.ok(html.includes("0分鐘"));
  assert.ok(html.includes("多人Web保留此限制"));
  assert.ok(script.includes("function renderMultiCard(){"));
  assert.ok(script.includes("renderMultiCard();"));
  assert.ok(script.includes('await api("arcade/cardw/draw"'));
  assert.ok(script.includes("pendingMultiCard"));
  assert.ok(script.includes("multiCardBusy"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=r.stake"));
});

test("第61階段：四寶箱有來源獎池、扣款與真實33欄入庫／直接狀態的安全顯示",()=>{
  for(const id of ["arcade-treasure-panel","arcade-treasure-status","arcade-treasure-box",
    "arcade-treasure-quote","arcade-treasure-open","arcade-treasure-result",
    "arcade-treasure-history"])
    assert.ok(html.includes('id="'+id+'"'));
  for(const key of ["copper","silver","gold","special"])
    assert.ok(html.includes('value="'+key+'">'));
  assert.ok(html.includes("otakara.cgi"));
  assert.ok(html.includes("原始110筆獎品"));
  assert.ok(html.includes("33、34、38、109"));
  assert.ok(html.includes("金塊屬於直接現金獎品"));
  assert.ok(script.includes("function renderTreasure(){"));
  assert.ok(script.includes("renderTreasure();"));
  assert.ok(script.includes('await api("arcade/treasure/open"'));
  assert.ok(script.includes("pendingTreasureOpen"));
  assert.ok(script.includes("treasureBusy"));
  assert.ok(script.includes("document.createElement"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=round.itemName"));
});

test("第62階段：公路旅行原版秒數、寶箱載具選擇、倒數完成與安全DOM",()=>{
  for(const id of ["road-travel-panel","road-travel-to","road-travel-vehicle",
    "road-travel-status","road-travel-quote","road-travel-start",
    "road-travel-arrive","road-travel-result","road-travel-history"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.ok(html.includes("town_ini.cgi／town_lib.pl／town_maker.cgi"));
  assert.ok(html.includes("1/10事故機率"));
  assert.ok(html.includes("第63階段已依原版補上迷路與事故後改道"));
  assert.ok(script.includes("function renderRoadTravel(){"));
  assert.ok(script.includes("function updateRoadCountdown(){"));
  assert.ok(script.includes("renderRoadTravel();"));
  assert.ok(script.includes("updateRoadCountdown();"));
  assert.ok(script.includes('await api("road/start"'));
  assert.ok(script.includes('await api("road/arrive"'));
  assert.ok(script.includes("pendingRoadStart"));
  assert.ok(script.includes("roadTravelBusy"));
  assert.ok(script.includes("Boolean(state.roadTravel?.pending)"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=trip.vehicleName"));
});

test("第63階段：原版迷路／事故後改道只在抵達時公布，並列原定與實際目的地",()=>{
  assert.ok(html.includes("持有「ローラースルーゴーゴー」必定迷路"));
  assert.ok(html.includes("否則有1/5機率迷路"));
  assert.ok(html.includes("只有「迷路且發生交通事故」"));
  assert.ok(html.includes("單純迷路時"));
  assert.ok(html.includes("到站之前不提前公布"));
  assert.ok(script.includes("trip.requestedToTownId"));
  assert.ok(script.includes("trip.rerouted"));
  assert.ok(script.includes("trip.lost"));
  assert.ok(script.includes("原版觸發迷路提示，但沒有事故"));
  assert.ok(script.includes("迷路、事故及可能改道的結果都會在抵達時公布"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=trip.rerouted"));
});

test("第64階段：原版500元巴士納入既有公路選單、現金檢查與安全DOM",()=>{
  assert.ok(html.includes("第64階段新增原版 mati_idou2 巴士"));
  assert.ok(html.includes("現金不足500元不可上車"));
  assert.ok(script.includes('bus.value="bus"'));
  assert.ok(script.includes('byBus,requestId:pendingRoadStart.requestId'));
  assert.ok(script.includes("roadTravel.busSeconds"));
  assert.ok(script.includes("info.busFare"));
  assert.ok(script.includes("trip.farePaid"));
  assert.ok(script.includes("巴士車資500元從現金扣款"));
  assert.ok(script.includes("const affordable=!byBus||state.character.money>=info.busFare"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=trip.farePaid"));
});

test("第65階段：真實百貨車輛顯示來源與耐久，仍使用原安全DOM",()=>{
  assert.ok(html.includes("第66階段重新核對的18種原版百貨"));
  assert.ok(html.includes("購買流水與33欄原始資料相符"));
  assert.ok(html.includes("専門店限定商品"));
  assert.ok(script.includes('item.origin==="retail"?(item.category==="ギフト"?"百貨禮品":"百貨")'));
  assert.ok(script.includes('item.origin==="coupon"?"優惠券":"寶箱"'));
  assert.ok(script.includes("可用寶箱／百貨載具"));
  assert.ok(script.includes("history.replaceChildren()"));
  assert.ok(!script.includes("innerHTML=item.origin"));
});

test("第53階段：原版釣場與餌料商店實際有入庫交易 UI 且拒絕虛構漁獲",()=>{
  for(const key of ["釣り","販売1"])
    assert.deepEqual(townCellAction(describeTile(key)),{
      kind:"facility",panelId:"fishing-panel"
    });
  for(const id of ["fishing-panel","fishing-status","fishing-shop-status",
    "fishing-bait-goods","fishing-bait-select","fishing-sell-select",
    "fishing-cast","fishing-sell","fishing-history","fishing-cooldown"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/原版 sea\.cgi／hanbai1\.cgi/);
  assert.match(html,/每次釣魚消耗 1 次/);
  assert.match(html,/int\(rand\(3\)\)/);
  assert.match(script,/function renderFishing\(\)/);
  assert.match(script,/renderFishing\(\);/);
  assert.match(script,/state\.fishing\?\?/);
  assert.match(script,/submitFishingAction\("bait\/buy"/);
  assert.match(script,/submitFishingAction\("cast"/);
  assert.match(script,/submitFishingAction\("sell"/);
  assert.match(script,/await api\("fishing\/"\+actionName,data\)/);
  assert.match(script,/crypto\.randomUUID\(\)/);
  assert.match(script,/button\.disabled|buy\.disabled=!canBuy/);
  assert.match(script,/item\.origin==="fishing"/);
  assert.doesNotMatch(script,/innerHTML\s*=\s*item\.name/);
});

test("IT-02 本人優惠券與一般類別合法載具在背包可進入公路，其他物品不冒充載具",()=>{
  assert.match(script,/function goToVerifiedInventoryVehicle\(vehicle\)/);
  assert.match(script,/const roadVehicles=new Map\(\(state\.roadTravel\?\.choices\?\?\[\]\)/);
  assert.match(script,/const verifiedVehicle=roadVehicles\.get\(item\.sourceLine\)/);
  assert.match(script,/card\.dataset\.sourceLine=String\(item\.sourceLine\)/);
  assert.match(script,/status\.textContent=verifiedVehicle\?/);
  assert.match(script,/不是背包直接使用道具/);
  assert.match(script,/if\(verifiedVehicle\)\{/);
  assert.match(script,/inventory-road-link/);
  assert.match(script,/goToVerifiedInventoryVehicle\(verifiedVehicle\)/);
  assert.match(script,/goToVerifiedInventoryVehicle\(vehicle\)/);
  assert.match(script,/公路面板操作，事故可能扣耐久/);
});

test("第66階段：公路選單說明不再錯稱專門店備註禁止百貨購入",()=>{
  assert.match(html,/18種原版百貨/);
  assert.match(html,/6種標有「専門店限定商品」/);
  assert.match(html,/7種禮品類別車/);
  assert.match(html,/禮品屋轉換或跨玩家收到的物品仍需要額外來源鏈驗證/);
  assert.ok(script.includes("百貨禮品"));
  assert.ok(script.includes("vehicle.append(option)"));
  assert.ok(script.includes("option.textContent=displayRetailItemName(item.name)"));
});

test("大阪挑戰：原版兩種地圖入口與遊樂中心共用伺服器戰鬥面板",()=>{
  for(const key of ["おばちゃん","おばちゃん強"]){
    assert.deepEqual(townCellAction(describeTile(key)),{kind:"facility",panelId:"osaka-panel"});
  }
  const games=html.slice(html.indexOf('id="facility-pane-games"'));
  for(const id of ["osaka-panel","osaka-status","osaka-modes","osaka-result","osaka-history"])
    assert.match(games,new RegExp('id="'+id+'"'));
  assert.match(script,/api\("osaka\/play",osakaPending\)/);
  assert.match(script,/!game\?\.catalogReady/);
  assert.match(script,/item\.blocked\?/);
});
