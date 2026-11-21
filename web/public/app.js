import { townCellAction } from "./town-home.js";
import { displayRetailSportsMedicineName,displayRetailSportsMedicineCategory } from "./retail-sports-medicine-translations.js";
import { displayRetailDrinkAlcoholName,displayRetailDrinkAlcoholCategory } from "./retail-drink-alcohol-translations.js";
import { displayDessertFastFoodName,displayDessertFastFoodCategory } from "./retail-dessert-fastfood-translations.js";
import { displayRetailFoodName,displayRetailFoodCategory } from "./retail-food-translations.js";
import { shouldShowCompactEnergy } from "./energy-visibility.js";
import { townTimePhase } from "./time-theme.js";
import { groupedStatLines } from "./shop-effects.js";
import { displayEquipmentName,displayVendingName,displayKnownItemName,displayEquipmentCategory,displayKnownItemCategory } from "./item-translations.js";
import { itemCooldownRemaining,itemCooldownText,itemRemainingDurability,formatItemCountdown } from "./item-cooldown.js";
const el = id => document.getElementById(id);
let state = null;
let requestedLegacyIconUrl = null;
let loadedLegacyIconUrl = null;
// 原始 kounyuu 圖示不屬於 BMI 或 C 聯賽角色圖片。
// 不在 render() 中設定外部 src：只有本人按下預覽時才真正請求圖片。
function clearLegacyIconPreview() {
  requestedLegacyIconUrl = null;
  loadedLegacyIconUrl = null;
  const image = document.getElementById("legacy-icon-image");
  if (image) { image.hidden = true; image.removeAttribute("src"); }
}
function renderLegacyIcon() {
  const panel = document.getElementById("legacy-icon-panel");
  const button = document.getElementById("legacy-icon-toggle");
  const image = document.getElementById("legacy-icon-image");
  const icon = state?.legacyPlayerIcon;
  if (!state?.character || (state.mode === "solo" && soloAtHome) ||
      !icon || icon.status === "none") {
    panel.hidden = true;
    if (requestedLegacyIconUrl) clearLegacyIconPreview();
    return;
  }
  panel.hidden = false;
  if (icon.status !== "available") {
    clearLegacyIconPreview();
    button.hidden = true;
    text("legacy-icon-help", "原版圖示連結不符合 Web 的 HTTPS 安全預覽條件，暫不載入。");
    return;
  }
  if (requestedLegacyIconUrl && requestedLegacyIconUrl !== icon.url)
    clearLegacyIconPreview();
  const displayed = loadedLegacyIconUrl === icon.url;
  image.hidden = !displayed;
  button.hidden = false;
  button.disabled = Boolean(requestedLegacyIconUrl) && !displayed;
  button.textContent = displayed ? "隱藏原版圖示" : "載入原版圖示（外部圖片）";
  text("legacy-icon-help", displayed
    ? "此 32×32 圖片來自原版存檔所記錄的網址。"
    : "按下後才會向原版圖示的外部網站載入圖片；可能向對方透露連線資訊。");
}
const displayRetailItemName=name=>displayRetailSportsMedicineName(displayRetailDrinkAlcoholName(displayDessertFastFoodName(displayRetailFoodName(displayKnownItemName(name)))));
const displayRetailItemCategory=category=>displayRetailSportsMedicineCategory(displayRetailDrinkAlcoholCategory(displayDessertFastFoodCategory(displayRetailFoodCategory(displayKnownItemCategory(category)))));

const labels = {
  kokugo:"國語",suugaku:"數學",rika:"理科",syakai:"社會",eigo:"英語",
  ongaku:"音樂",bijutu:"美術",looks:"外貌",tairyoku:"體力",
  kenkou:"健康",speed:"速度",power:"力量",wanryoku:"臂力",
  kyakuryoku:"腿力",love:"LOVE",unique:"有趣度",etti:"情色度"
};
const money = n => new Intl.NumberFormat("zh-TW").format(n) + " 元";

async function api(path, data) {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失敗");
  return result;
}

// 原版的交易與錯誤結果採中央訊息畫面。Web 保留原操作頁面，改用確認後返回的對話框；
// 輸入或餘額錯誤則優先顯示在剛操作的表單／按鈕旁，不再推到頁首或右下角。
let feedbackOrigin=null;
let inlineFeedback=null;
let resultReturnFocus=null;
function clearInlineFeedback(){
  if(inlineFeedback?.isConnected)inlineFeedback.remove();
  inlineFeedback=null;
}
function rememberFeedbackOrigin(event){
  if(event.target.closest("#result-dialog"))return;
  const target=event.type==="submit"?(event.submitter||event.target):
    event.type==="change"?event.target:
    event.target.closest("button,a,[role=button]");
  if(!target)return;
  feedbackOrigin=target;
  clearInlineFeedback();
}
document.addEventListener("click",rememberFeedbackOrigin,true);
document.addEventListener("submit",rememberFeedbackOrigin,true);
document.addEventListener("change",rememberFeedbackOrigin,true);
function showInlineFeedback(message,error,source){
  const origin=source||feedbackOrigin;
  if(!origin?.isConnected||origin.closest("[hidden]"))return false;
  const form=origin.closest("form");
  const tile=origin.closest(".training-tile");
  const section=origin.closest(".solo-time-panel");
  const anchor=form||tile||section||origin;
  clearInlineFeedback();
  const note=document.createElement("p");
  note.className="operation-feedback"+(error?" error":"");
  note.setAttribute("role",error?"alert":"status");
  note.textContent=String(message);
  if(tile&&!form || section&&!form)anchor.append(note);
  else anchor.insertAdjacentElement("afterend",note);
  inlineFeedback=note;
  // 只捲動到附近的提示，不把整個長頁面跳回頂端。
  note.scrollIntoView({block:"nearest",behavior:"auto"});
  return true;
}
function showResultDialog(message,title,error){
  const dialog=el("result-dialog");
  clearInlineFeedback();
  dialog.classList.toggle("error",error);
  dialog.setAttribute("role",error?"alertdialog":"dialog");
  text("result-dialog-title",title);
  text("result-dialog-message",String(message));
  if(!dialog.open){
    resultReturnFocus=feedbackOrigin?.isConnected?feedbackOrigin:document.activeElement;
    dialog.showModal();
  }
}
function notify(message,error=false,{title,inline=false,source}={}){
  if((error||inline)&&showInlineFeedback(message,error,source))return;
  showResultDialog(message,title||(error?"操作未完成":"操作結果"),error);
}
el("result-dialog-close").addEventListener("click",()=>el("result-dialog").close());
el("result-dialog").addEventListener("close",()=>{
  if(resultReturnFocus?.isConnected&&!resultReturnFocus.disabled)
    resultReturnFocus.focus({preventScroll:true});
  resultReturnFocus=null;
});

function text(id, value) { el(id).textContent = value; }

function addRow(parent, key, value) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = key;
  dd.textContent = String(value);
  row.append(dt, dd);
  parent.append(row);
}

let selectedMapCell = null;
let selectedHouseSpot = null;
let selectedMapTown = null;
let activeRoom = null;
// 單機不需要帳號，所謂「離開遊戲」只回到首頁，不移除存檔。
let soloAtHome=false;
try { soloAtHome=sessionStorage.getItem("town-solo-at-home")==="1"; } catch {}
let syncedGameMs=Date.now();
let syncedAtRealMs=Date.now();
const browserGameNow=()=>syncedGameMs+Math.max(0,Date.now()-syncedAtRealMs);
// 使用伺服器的遊戲時間／時區，不使用瀏覽器所在地時區；單機快轉即時生效。
function updateTownTheme() {
  if (!state) return;
  const phase=townTimePhase(browserGameNow(),state.gameTimeZone||"Asia/Taipei");
  if(document.documentElement.dataset.townTime!==phase)
    document.documentElement.dataset.townTime=phase;
}
let timeAdvanceBusy=false;
function renderSoloTime() {
  const panel=el("solo-time-panel");
  panel.hidden=state?.mode!=="solo" || !state?.character;
  if(panel.hidden)return;
  const format=new Intl.DateTimeFormat("zh-TW",{
    timeZone:state.gameTimeZone||"Asia/Taipei",year:"numeric",month:"2-digit",
    day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  });
  text("solo-game-time","遊戲時間："+format.format(new Date(browserGameNow())));
  const remain=[];
  if(state.workCooldownMs>0)remain.push("工作還需約 "+Math.ceil(state.workCooldownMs/60000)+" 分鐘");
  if(state.gymCooldownMs>0)remain.push("健身房還需約 "+Math.ceil(state.gymCooldownMs/60000)+" 分鐘");
  if(state.mealCooldownMs>0)remain.push("用餐還需約 "+Math.ceil(state.mealCooldownMs/60000)+" 分鐘");
  if(state.schoolRemainingToday)remain.push("學校須隔日才可再上課");
  // 教室的間隔是實際課程完成時儲存的 classroomReadyAt，不是學校的每日重設。
  // 用遊戲時鐘推算剩餘時間，快轉與畫面每秒更新都會同步變化。
  const classroomWait=Math.max(0,(state.character.classroomReadyAt??0)-browserGameNow());
  if(classroomWait>0)remain.push("教室還需約 "+Math.ceil(classroomWait/60000)+" 分鐘");
  text("solo-wait-hints",remain.length?remain.join("；")+"。":"目前沒有主要冷卻等待。");
  const blocked=timeAdvanceBusy || (
    state.cockroachChallenge?.status==="active" &&
    state.cockroachChallenge.expiresAt>browserGameNow()
  );
  for(const button of panel.querySelectorAll("button[data-advance]"))button.disabled=blocked;
}
let publicPreview=null;
let previewLoading=false;
// 方案 B：一次顯示一組設施。原本的表單留在 DOM，既有事件和資料更新不受影響。
const FACILITY_TAB_NAMES = Object.freeze(["house","dining","shops","games","training","jobs","bank","hospital","events","mail"]);
const PROFILE_VIEWS = Object.freeze(["status","inventory","attributes"]);
let activeProfileView="status";
function selectProfileView(name,{focus=false}={}) {
  if(!PROFILE_VIEWS.includes(name))return false;
  activeProfileView=name;
  for(const key of PROFILE_VIEWS){
    const selected=key===name;
    const tab=el("profile-tab-"+key);
    tab.setAttribute("aria-selected",String(selected));
    tab.tabIndex=selected?0:-1;
    const panelId={status:"player-summary",inventory:"inventory-panel",attributes:"attributes-panel"}[key];
    el(panelId).hidden=!selected;
  }
  if(focus)el("profile-tab-"+name).focus({preventScroll:true});
  updateCompactVisibility();
  return true;
}

const ABILITY_GROUPS = [
  {label:"頭腦", keys:["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu"]},
  {label:"身體", keys:["looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku"]},
  {label:"其他", keys:["love","unique","etti"]}
];
function renderAbilities(stats){
  const root=el("attributes");
  root.replaceChildren();
  // 原版為分組黃條。正規化到目前最高能力，固定在側欄寬度內，不再用整行 flex 撐開。
  const maximum=Math.max(1,...Object.keys(labels).map(k=>Math.max(0,Number(stats[k])||0)));
  for(const group of ABILITY_GROUPS){
    const section=document.createElement("section");
    section.className="ability-group";
    const heading=document.createElement("h4");
    heading.textContent=group.label;
    section.append(heading);
    const list=document.createElement("div");
    list.className="ability-group-rows";
    for(const key of group.keys){
      const value=Number(stats[key])||0;
      const row=document.createElement("div");
      row.className="ability-row";
      const line=document.createElement("div");
      line.className="ability-row-line";
      const label=document.createElement("span");
      label.textContent=labels[key];
      const amount=document.createElement("strong");
      amount.textContent=String(value);
      const track=document.createElement("div");
      track.className="ability-track";
      track.setAttribute("aria-hidden","true");
      const fill=document.createElement("span");
      fill.style.width=Math.min(100,Math.max(0,value)/maximum*100).toFixed(2)+"%";
      track.append(fill);
      line.append(label,amount);
      row.append(line,track);
      list.append(row);
    }
    section.append(list);
    root.append(section);
  }
}
function updateCompactVisibility(){
  const statusView=activeProfileView==="status";
  const show=shouldShowCompactEnergy({
    gameVisible:!el("game").hidden,
    hasCharacter:Boolean(state?.character),
    statusView,
    bodyRowBottom:statusView?el("body-energy").closest("div").getBoundingClientRect().bottom:Infinity,
    profileTabsBottom:!statusView?el("profile-view-tabs").getBoundingClientRect().bottom:Infinity
  });
  const compact=el("compact-status");
  compact.hidden=!show;
  document.body.classList.toggle("compact-status-active",show);
  if(show)document.body.style.setProperty("--compact-status-height",
    Math.ceil(compact.getBoundingClientRect().height)+"px");
  else document.body.style.removeProperty("--compact-status-height");
}
function renderCompactStatus(character){
  text("compact-character-name",character.name);
  text("compact-body-energy",character.bodyEnergy+" / "+state.maxBodyEnergy);
  text("compact-brain-energy",character.brainEnergy+" / "+state.maxBrainEnergy);
  text("compact-money",money(character.money));
  text("compact-bank",money(character.bank));
  el("compact-body-bar").value=state.maxBodyEnergy>0?
    Math.max(0,Math.min(100,character.bodyEnergy/state.maxBodyEnergy*100)):0;
  el("compact-brain-bar").value=state.maxBrainEnergy>0?
    Math.max(0,Math.min(100,character.brainEnergy/state.maxBrainEnergy*100)):0;
  updateCompactVisibility();
}
window.addEventListener("scroll",updateCompactVisibility,{passive:true});
window.addEventListener("resize",updateCompactVisibility);

let activeFacilityTab="jobs";
let dismissedEventKey=null;
try{ dismissedEventKey=sessionStorage.getItem("town-dismissed-event")||null; }catch{}
function dismissEventPopup(){
  const popup=el("event-popup");
  dismissedEventKey=popup.dataset.key||null;
  try{
    if(dismissedEventKey)sessionStorage.setItem("town-dismissed-event",dismissedEventKey);
  }catch{}
  popup.hidden=true;
}
function selectFacilityTab(name,{focusTab=false,scroll=false}={}) {
  if(!FACILITY_TAB_NAMES.includes(name))return false;
  activeFacilityTab=name;
  for(const key of FACILITY_TAB_NAMES){
    const tab=el("facility-tab-"+key);
    const pane=el("facility-pane-"+key);
    const selected=key===name;
    tab.setAttribute("aria-selected",String(selected));
    tab.tabIndex=selected?0:-1;
    pane.hidden=!selected;
  }
  const active=el("facility-tab-"+name);
  if(focusTab)active.focus({preventScroll:true});
  if(scroll)el("facility-tabs").scrollIntoView({behavior:"smooth",block:"start"});
  return true;
}
function goToFacility(panelId) {
  const target=el(panelId);
  if(!target||!state?.character)return;
  const pane=target.closest(".facility-pane");
  if(pane)selectFacilityTab(pane.id.slice("facility-pane-".length));
  if(target.closest("#inventory-panel"))selectProfileView("inventory");
  target.scrollIntoView({behavior:"smooth",block:"start"});
  target.classList.add("facility-focused");
  target.setAttribute("tabindex","-1");
  target.focus({preventScroll:true});
  target.addEventListener("blur",()=>target.classList.remove("facility-focused"),{once:true});
}
function renderPublicPreview() {
  if(!publicPreview)return;
  const {towns,map}=publicPreview;
  const select=el("preview-town");
  select.replaceChildren();
  for(const town of towns){
    const opt=document.createElement("option");
    opt.value=String(town.id);
    opt.textContent=town.name;
    select.append(opt);
  }
  select.value=String(map.townId);
  text("preview-map-status",map.configured?
    "顯示已保存的城鎮街區（唯讀）。":
    "此城鎮沒有原始街區配置，依原版保留 12×16 空白街區。");
  const board=el("preview-map");
  board.replaceChildren();
  board.style.backgroundImage="url('/legacy-assets/"+map.background+"')";
  const corner=document.createElement("span");
  corner.className="map-axis";board.append(corner);
  for(let c=1;c<=16;c++){
    const axis=document.createElement("span");
    axis.className="map-axis";axis.textContent=String(c);board.append(axis);
  }
  for(let row=0;row<12;row++){
    const axis=document.createElement("span");
    axis.className="map-axis";axis.textContent="ABCDEFGHIJKL"[row];
    board.append(axis);
    for(let col=0;col<16;col++){
      const cell=map.cells[row*16+col];
      const tile=document.createElement("span");
      tile.className="map-cell preview-cell map-"+cell.category;
      tile.title="ABCDEFGHIJKL"[row]+(col+1)+"："+cell.label;
      if(cell.image){
        const img=document.createElement("img");
        img.src="/legacy-assets/"+cell.image;
        img.alt="";img.loading="lazy";
        tile.append(img);
      }else if(cell.category==="unknown")tile.textContent="?";
      board.append(tile);
    }
  }
}
async function loadPublicPreview(townId=0){
  if(previewLoading)return;
  previewLoading=true;
  try{
    const loaded=await api("town/preview?townId="+encodeURIComponent(townId));
    publicPreview=loaded;
    renderPublicPreview();
  }catch(error){text("preview-map-status","無法讀取城鎮預覽："+error.message);}
  finally{previewLoading=false;}
}
function renderTownMap() {
  const map = state.map;
  const board = el("town-map");
  board.replaceChildren();
  if (!map) return;
  if (selectedMapTown !== map.townId) {
    selectedMapCell = null;
    selectedHouseSpot = null;
    selectedMapTown = map.townId;
  }
  const editor = el("map-editor");
  editor.hidden = !map.editable;
  el("solo-starter-town").hidden=!(state.mode==="solo"&&!map.configured);
  const palette = el("map-palette");
  const previousSymbol = palette.value;
  palette.replaceChildren();
  for (const symbol of map.palette || []) {
    const option = document.createElement("option");
    option.value = symbol.key;
    option.textContent = symbol.label;
    palette.append(option);
  }
  if (map.palette?.some(item => item.key === previousSymbol)) palette.value = previousSymbol;
  palette.disabled = !el("map-edit-toggle").checked;
  const sourceText = !map.configured
    ? "這個城鎮目前沒有原始街區資料，顯示未配置的空白地圖。"
    : map.source === "legacy" || map.source === "legacy-import"
      ? "已讀取原版街區配置，未支援的設施將保留原始代碼。"
      : map.source === "web-solo-starter"
        ? "這是玩家自行建立的 Web 單機試玩配置，不是原版歷史街區。"
        : "目前使用 Web 版儲存的街區配置。";
  text("map-source", sourceText);

  board.style.backgroundImage = "url('/legacy-assets/" + map.background + "')";
  const corner = document.createElement("span");
  corner.className = "map-axis map-corner";
  corner.textContent = "";
  board.append(corner);
  for (let col = 1; col <= 16; col++) {
    const heading = document.createElement("span");
    heading.className = "map-axis";
    heading.textContent = String(col);
    board.append(heading);
  }
  for (let row = 0; row < 12; row++) {
    const rowName = "ABCDEFGHIJKL"[row];
    const rowHeading = document.createElement("span");
    rowHeading.className = "map-axis";
    rowHeading.textContent = rowName;
    board.append(rowHeading);
    for (let col = 0; col < 16; col++) {
      const cell = map.cells[row * 16 + col];
      const name = rowName + (col + 1);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-cell map-" + cell.category;
      if (selectedMapCell === name) button.classList.add("selected");
      button.title = name + "：" + cell.label;
      button.setAttribute("aria-label", name + "：" + cell.label);
      if (cell.image) {
        const image = document.createElement("img");
        image.src = "/legacy-assets/" + cell.image;
        image.alt = "";
        image.loading = "lazy";
        button.append(image);
      } else if (cell.raw) {
        const unknown = document.createElement("span");
        unknown.className = "map-unknown-text";
        unknown.textContent = "?";
        button.append(unknown);
      }
      button.addEventListener("click", () => {
        selectedMapCell=name;
        const editing=map.editable&&el("map-edit-toggle").checked;
        const destination=townCellAction(cell);
        if(!editing){
          selectedHouseSpot=destination.kind==="build"?{row,column:col}:null;
          updateHouseQuote();
        }
        text("map-selection",name+"："+cell.label+
          (cell.raw&&cell.category==="unknown"?"（"+cell.raw+"）":""));
        if(editing){
          action("map/tile",{row,column:col,symbol:el("map-palette").value},
            name+" 的街區內容已儲存。");
        }else{
          board.querySelectorAll(".map-cell.selected").forEach(node=>node.classList.remove("selected"));
          button.classList.add("selected");
          if(destination.kind==="house")openRoom(destination.houseId);
          else if(destination.kind==="build"||destination.kind==="facility"){
            if(cell.key==="デパ"||cell.key==="デパ2")
              el("retail-shop-select").value=cell.key==="デパ2"?"depart2":"depart1";
            goToFacility(destination.panelId);
            if(cell.key==="デパ"||cell.key==="デパ2")renderRetail();
            if(cell.key==="自販機")renderVending();
            if(cell.key==="装備屋")renderEquipment();
            if(cell.key==="ギフト屋")renderGiftShop();
            if(cell.key==="リサイ")renderRecycle();
            if(cell.key==="問屋")renderWholesale();
          }
          else if(destination.kind==="station"){
            el("station-heading").scrollIntoView({behavior:"smooth",block:"start"});
            el("towns").querySelector("button:not(:disabled)")?.focus({preventScroll:true});
          }
          else if(destination.kind==="unavailable")
            notify(name+"："+cell.label+" 尚未移植或尚無對應 Web 入口。",false,{inline:true,source:el("map-selection")});
        }
      });
      board.append(button);
    }
  }
}

function closeRoom() {
  activeRoom = null;
  el("room-panel").hidden = true;
}
async function openRoom(houseId, slot = null, scroll = true) {
  try {
    const search = "houseId=" + encodeURIComponent(houseId) +
      (slot === null ? "" : "&slot=" + encodeURIComponent(slot));
    activeRoom = await api("house/visit?" + search);
    if(activeRoom.selected?.type==="1"){
      try{activeRoom.shop=await api("shop/visit?houseId="+encodeURIComponent(houseId));}
      catch{activeRoom.shop=null;}
    }
    renderRoom();
    // 房屋室內可能從地圖或玩家住宅捷徑開啟；先打開所屬分頁。
    selectFacilityTab("house");
    if (scroll) el("room-panel").scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    closeRoom();
    notify(error.message, true);
  }
}
async function roomAction(path, data, successText, resetSlot = false) {
  if (!activeRoom) return;
  const houseId = activeRoom.houseId;
  const slot = resetSlot ? null : activeRoom.selectedIndex;
  try {
    state = await api(path, data);
    render();
    notify(successText);
    await openRoom(houseId, slot, false);
  } catch(error) { notify(error.message, true); }
}
let pendingPlayerStorePurchase=null;
async function buyFromPlayerRoom(item,quantity,payment,cardSourceLine){
  const houseId=activeRoom?.houseId;
  if(!houseId)return;
  const total=item.price*quantity;
  if(!window.confirm("確定從「"+(activeRoom.shop?.title??"玩家商店")+
    "」購買「"+displayRetailItemName(item.name)+"」×"+quantity+"，"+
    (payment==="bank"?"使用有效信用卡扣普通存款 ":"支付現金 ")+money(total)+"嗎？"))return;
  if(!pendingPlayerStorePurchase||
    pendingPlayerStorePurchase.houseId!==houseId||
    pendingPlayerStorePurchase.sku!==item.sku||
    pendingPlayerStorePurchase.quantity!==quantity||
    pendingPlayerStorePurchase.payment!==payment||
    pendingPlayerStorePurchase.cardSourceLine!==cardSourceLine){
    pendingPlayerStorePurchase={
      houseId,sku:item.sku,quantity,payment,cardSourceLine,
      requestId:crypto.randomUUID()
    };
  }
  const data={houseId,sku:item.sku,quantity,payment,
    requestId:pendingPlayerStorePurchase.requestId,
    ...(payment==="bank"?{cardSourceLine}:{} )};
  const slot=activeRoom.selectedIndex;
  try{
    state=await api("shop/buy",data);
    const result=state.playerStoreResult;
    pendingPlayerStorePurchase=null;
    render();
    notify(result.replayed?"這筆商店購物已完成，沒有重複扣款或出貨。":
      "已購入「"+displayRetailItemName(result.name)+"」×"+quantity+"，付款 "+money(result.paid)+
      (result.cashback?"；同城現金回饋 "+money(result.cashback):"")+
      "，商品已入本人持有物。");
    await openRoom(houseId,slot,false);
  }catch(error){notify(error.message,true);}
}
async function setPlayerRoomPrice(item,price){
  const houseId=activeRoom?.houseId;
  if(!houseId)return;
  if(!Number.isSafeInteger(price)||price<item.min||price>item.max){
    notify("售價必須為 "+money(item.min)+"～"+money(item.max)+" 的整數",true);return;
  }
  if(!window.confirm("確定將「"+displayRetailItemName(item.name)+"」的售價設定為 "+money(price)+" 嗎？"))return;
  const slot=activeRoom.selectedIndex;
  try{
    state=await api("shop/price",{houseId,sku:item.sku,price});
    render();
    notify("已設定「"+displayRetailItemName(item.name)+"」的商店單價。");
    await openRoom(houseId,slot,false);
  }catch(error){notify(error.message,true);}
}
function renderRoom() {
  const view = activeRoom;
  const panel = el("room-panel");
  if (!view || !state?.character ||
    !state.townHouses.some(house => house.id === view.houseId)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  text("room-title", view.houseName);
  text("room-owner", "屋主：" + view.ownerName + "｜室內最多 " + view.capacity + " 個內容欄位");
  const nav = el("room-nav");
  nav.replaceChildren();
  for (const slot of view.available) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = view.selectedIndex === slot.index ? "primary" : "secondary";
    button.textContent = slot.title || (slot.type === "0" ? "一般留言板" :
      slot.type === "3" ? "屋主公告板" : slot.type==="1"?"玩家商店":"自訂網址");
    button.addEventListener("click", () => openRoom(view.houseId, slot.index, false));
    nav.append(button);
  }
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "secondary";
  reload.textContent = "更新室內內容";
  reload.addEventListener("click", () => openRoom(view.houseId, view.selectedIndex, false));
  nav.append(reload);
  const body = el("room-body");
  body.replaceChildren();
  const current = view.selected;
  if (!current) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = view.owner ?
      "尚未公開任何室內內容，請先設定下方欄位。" : "尚無可觀看的內容。";
    body.append(empty);
  } else if (current.type === "1") {
    const note=document.createElement("p");
    note.className="small";
    const shop=view.shop;
    note.textContent=shop?
      "住宅商店「"+shop.title+"」｜"+shop.category+
      "｜目前 "+shop.items.length+" 種上架商品；普通存款／現金結帳。":
      "屋主尚未完成這間玩家商店的分類與店名設定。";
    body.append(note);
    if(view.owner){
      const go=document.createElement("button");
      go.type="button";go.textContent="前往問屋／管理商店庫存";
      go.addEventListener("click",()=>{
        selectedWholesaleHouseId=view.houseId;
        goToFacility("wholesale-panel");
        renderWholesale();
      });
      body.append(go);
    }
    for(const item of shop?.items??[]){
      const tile=document.createElement("div");
      tile.className="training-tile";
      const title=document.createElement("strong");
      title.textContent=displayRetailItemName(item.name)+"｜"+displayRetailItemCategory(item.category);
      const hint=document.createElement("p");hint.className="small";
      hint.textContent="單價 "+money(item.price)+"｜剩餘 "+item.stock+
        " 件｜進貨原價 "+money(item.basePrice);
      const qtyLabel=document.createElement("label");
      qtyLabel.textContent="購買數量";
      const qty=document.createElement("select");
      qty.setAttribute("aria-label",displayRetailItemName(item.name)+"玩家商店購買數量");
      for(let n=1;n<=5;n++){
        const opt=document.createElement("option");
        opt.value=String(n);
        opt.textContent=n+" 件";
        opt.disabled=n>item.stock;
        qty.append(opt);
      }
      qtyLabel.append(qty);
      const payLabel=document.createElement("label");
      payLabel.textContent="付款方式";
      const pay=document.createElement("select");
      const cash=document.createElement("option");
      cash.value="cash";cash.textContent="現金";
      pay.append(cash);
      for(const card of state.classroomCreditCards??[]){
        const opt=document.createElement("option");
        opt.value="card:"+card.sourceLine;
        opt.textContent="有效信用卡："+card.name;
        pay.append(opt);
      }
      payLabel.append(pay);
      const quote=document.createElement("p");quote.className="small";
      const button=document.createElement("button");
      button.type="button";
      const update=()=>{
        const n=Number(qty.value),cost=n*item.price;
        const bank=pay.value.startsWith("card:");
        const enough=Number.isSafeInteger(cost)&&
          cost<=(bank?state.character.bank:state.character.money);
        quote.textContent="合計 "+money(cost)+(bank?"（普通存款）":"（現金）")+
          (!enough?"｜餘額不足":n>item.stock?"｜庫存不足":"");
        button.disabled=!enough||n>item.stock;
        button.textContent=button.disabled?"無法購買":"購買商品";
      };
      qty.addEventListener("change",update);
      pay.addEventListener("change",update);
      button.addEventListener("click",()=>{
        const bank=pay.value.startsWith("card:");
        buyFromPlayerRoom(item,Number(qty.value),bank?"bank":"cash",
          bank?Number(pay.value.slice(5)):undefined);
      });
      update();
      tile.append(title,hint,qtyLabel,payLabel,quote,button);
      if(view.owner){
        const priceLabel=document.createElement("label");
        priceLabel.textContent="店主調整單價（"+money(item.min)+"～"+money(item.max)+"）";
        const price=document.createElement("input");
        price.type="number";price.min=String(item.min);price.max=String(item.max);
        price.step="1";price.value=String(item.price);
        priceLabel.append(price);
        const set=document.createElement("button");
        set.type="button";set.className="secondary";set.textContent="變更售價";
        set.addEventListener("click",()=>setPlayerRoomPrice(item,Number(price.value)));
        tile.append(priceLabel,set);
      }
      body.append(tile);
    }
    if(shop&&!shop.items.length){
      const empty=document.createElement("p");empty.className="small";
      empty.textContent="目前沒有貨物；屋主可先在問屋進貨後再對外販售。";
      body.append(empty);
    }
    const recent=(state.playerShopSales??[]).filter(x=>x.houseId===view.houseId).slice(0,12);
    if(recent.length){
      const h=document.createElement("h3");
      h.textContent="近期本人在這間店的交易";
      const list=document.createElement("ol");
      list.className="bank-ledger-list";
      for(const entry of recent){
        const li=document.createElement("li");
        li.textContent=new Date(entry.createdAt).toLocaleString("zh-TW")+"｜"+
          (entry.role==="seller"?"出售":"購入")+"｜"+displayRetailItemName(entry.name)+
          " ×"+entry.quantity+"｜"+money(entry.paid)+
          (entry.cashback?"｜同城回饋 "+money(entry.cashback):"");
        list.append(li);
      }
      body.append(h,list);
    }
  } else if (current.type === "2") {
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = "此內容是屋主提供的外部連結，將在新分頁開啟。";
    const link = document.createElement("a");
    link.href = current.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow";
    link.textContent = current.title || "前往外部網頁";
    body.append(note, link);
  } else {
    const list = document.createElement("div");
    list.className = "room-posts";
    if (!view.posts.length) {
      const empty = document.createElement("p");
      empty.className = "small";
      empty.textContent = "目前沒有留言。";
      list.append(empty);
    }
    for (const post of view.posts) {
      const item = document.createElement("article");
      item.className = "room-post";
      const meta = document.createElement("p");
      meta.className = "small";
      meta.textContent = post.authorName + "｜" + new Date(post.createdAt).toLocaleString("zh-TW");
      const message = document.createElement("p");
      message.className = "room-post-text";
      message.textContent = post.body;
      item.append(meta, message);
      if (post.canDelete) {
        const remove = document.createElement("button");
        remove.className = "secondary";
        remove.type = "button";
        remove.textContent = "刪除";
        remove.addEventListener("click", () => {
          if (window.confirm("確定刪除這篇留言嗎？"))
            roomAction("house/room/delete",
              { houseId:view.houseId, postId:post.id }, "留言已刪除。");
        });
        item.append(remove);
      }
      list.append(item);
    }
    body.append(list);
    if (view.canPost) {
      const form = document.createElement("form");
      form.className = "room-post-form";
      const label = document.createElement("label");
      label.textContent = current.type === "3" ? "發布屋主公告" : "新增留言";
      const textarea = document.createElement("textarea");
      textarea.name = "body";
      textarea.rows = 3;
      textarea.maxLength = 250;
      textarea.required = true;
      label.append(textarea);
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "送出";
      form.append(label, button);
      form.addEventListener("submit", event => {
        event.preventDefault();
        roomAction("house/room/post", {
          houseId: view.houseId, slotIndex: view.selectedIndex, body: textarea.value
        }, "內容已送出。");
      });
      body.append(form);
    }
  }
  const settings = el("room-settings");
  settings.hidden = !view.owner;
  const slotArea = el("room-slot-inputs");
  slotArea.replaceChildren();
  if (!view.owner) return;
  for (let i = 0; i < view.capacity; i++) {
    const previous = view.editableSlots[i] || {type:"",title:"",url:""};
    const fieldset = document.createElement("fieldset");
    fieldset.className = "room-slot-editor";
    const legend = document.createElement("legend");
    legend.textContent = "欄位 " + (i + 1);
    const labelType = document.createElement("label");
    labelType.textContent = "內容類型";
    const select = document.createElement("select");
    select.className = "room-slot-type";
    for (const type of state.roomTypes || []) {
      const option = document.createElement("option");
      option.value = type.type;
      option.textContent = type.label;
      select.append(option);
    }
    select.value = previous.type;
    labelType.append(select);
    const labelTitle = document.createElement("label");
    labelTitle.textContent = "顯示標題（最多 32 字）";
    const title = document.createElement("input");
    title.className = "room-slot-title";
    title.maxLength = 32;
    title.value = previous.title;
    labelTitle.append(title);
    const labelUrl = document.createElement("label");
    labelUrl.textContent = "自訂 HTTPS 網址";
    const url = document.createElement("input");
    url.className = "room-slot-url";
    url.type = "url";
    url.maxLength = 500;
    url.value = previous.url;
    labelUrl.append(url);
    const update = () => {
      url.disabled = select.value !== "2";
      labelUrl.hidden = url.disabled;
    };
    select.addEventListener("change", update);
    update();
    fieldset.append(legend, labelType, labelTitle, labelUrl);
    slotArea.append(fieldset);
  }
}

function updateHouseQuote() {
  const catalog = state?.houseCatalog;
  const priceList = el("house-quote");
  priceList.replaceChildren();
  const target = el("house-target");
  const submit = el("house-submit");
  if (!catalog) {
    submit.disabled = true;
    return;
  }
  const map = state?.map;
  const cell = selectedHouseSpot ? map?.cells[selectedHouseSpot.row * 16 + selectedHouseSpot.column] : null;
  const location = selectedHouseSpot ? "ABCDEFGHIJKL"[selectedHouseSpot.row] + (selectedHouseSpot.column + 1) : "";
  const isLot = ["空地","空地2","空地3","空地4"].includes(cell?.raw);
  target.textContent = !cell
    ? "請先點選上方地圖中的建築空地。"
    : isLot ? "選擇位置：" + location + "（" + cell.label + "）"
    : location + " 不是可建造的空地（" + cell.label + "）。";
  const image = catalog.designs.find(x => x.id === el("house-design").value);
  const rank = Number(el("house-interior").value);
  const interior = catalog.interiorOptions.find(x => x.rank === rank);
  const price = image?.supported && interior ? (catalog.landWan + image.priceWan + interior.priceWan) * 10000 : null;
  const preview = el("house-preview");
  if (image?.supported) preview.src = "/legacy-assets/" + image.image;
  text("house-design-cost", image?.supported ? "外觀價格：" + money(image.priceWan * 10000) : "這個外觀的價格超過目前支援範圍");
  addRow(priceList, "城鎮地價", money(catalog.landWan * 10000));
  addRow(priceList, "房屋外觀", image?.supported ? money(image.priceWan * 10000) : "不支援");
  addRow(priceList, "室內等級", interior ? money(interior.priceWan * 10000) : "請選擇");
  addRow(priceList, "建造總額", price === null ? "無法計算" : money(price));
  if (catalog.canBuild && isLot && price !== null) {
    const available = el("house-payment").value === "cash" ? state.character.money : state.character.bank;
    addRow(priceList, "可用餘額", money(available));
    if (available < price) addRow(priceList, "付款狀態", "餘額不足");
  }
  submit.disabled = !catalog.canBuild || !isLot || price === null;
}

function makeHouseRemodelForm(house, catalog) {
  const form = document.createElement("form");
  form.className = "house-remodel-form";
  const heading = document.createElement("strong");
  heading.textContent = "住宅改裝";
  const desc = document.createElement("p");
  desc.className = "small";
  desc.textContent = "依原版：新外觀與新室內等級各收完整標價，只從現金扣款，不重新收取地價。";
  const imageLabel = document.createElement("label");
  imageLabel.textContent = "外觀更換";
  const images = document.createElement("select");
  images.name = "image";
  const keepImage = document.createElement("option");
  keepImage.value = "";
  keepImage.textContent = "外觀保持現狀（不收費）";
  images.append(keepImage);
  for (const item of catalog.designs) {
    if (!item.supported) continue;
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.id.split("/").pop() + "（" + money(item.priceWan * 10000) + "）";
    images.append(opt);
  }
  imageLabel.append(images);
  const rankLabel = document.createElement("label");
  rankLabel.textContent = "室內等級調整";
  const ranks = document.createElement("select");
  ranks.name = "interiorRank";
  const keepRank = document.createElement("option");
  keepRank.value = "";
  keepRank.textContent = "室內保持現狀（不收費）";
  ranks.append(keepRank);
  for (const item of catalog.interiorOptions) {
    const opt = document.createElement("option");
    opt.value = String(item.rank);
    opt.textContent = item.label + "（" + money(item.priceWan * 10000) + "）";
    ranks.append(opt);
  }
  rankLabel.append(ranks);
  const preview = document.createElement("img");
  preview.className = "house-remodel-preview";
  preview.src = "/legacy-assets/" + house.image;
  preview.alt = "房屋改裝外觀預覽";
  preview.width = 42;
  preview.height = 42;
  const total = document.createElement("p");
  total.className = "small";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "確認改裝";
  const update = () => {
    const image = catalog.designs.find(item => item.id === images.value);
    const rank = catalog.interiorOptions.find(item => String(item.rank) === ranks.value);
    const amount = ((image?.priceWan ?? 0) + (rank?.priceWan ?? 0)) * 10000;
    preview.src = "/legacy-assets/" + (image?.image ?? house.image);
    total.textContent = amount > 0
      ? "改裝費用：" + money(amount) + "，現金：" + money(state.character.money)
      : "請選擇要修改的外觀或室內等級。";
    submit.disabled = amount <= 0 || !Number.isSafeInteger(amount);
  };
  images.addEventListener("change", update);
  ranks.addEventListener("change", update);
  update();
  form.append(heading, desc, imageLabel, rankLabel, preview, total, submit);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const image = images.value || null;
    const interiorRank = ranks.value === "" ? null : Number(ranks.value);
    const choice = catalog.designs.find(item => item.id === image);
    const grade = catalog.interiorOptions.find(item => item.rank === interiorRank);
    const cost = ((choice?.priceWan ?? 0) + (grade?.priceWan ?? 0)) * 10000;
    if (!Number.isSafeInteger(cost) || cost <= 0) return;
    if (window.confirm("確定改裝「" + house.name + "」嗎？\n將由現金支付 " + money(cost) +
      "，原有裝潢費不退。室內欄位會依新等級顯示，原設定與文章仍保留。")) {
      action("house/remodel", { houseId:house.id,image,interiorRank });
    }
  });
  return form;
}

function renderHouses() {
  const catalog = state?.houseCatalog;
  if (!catalog) return;
  text("house-count", "一般住宅：" + state.houses.length + " / " + catalog.maxNormalHouses);
  const designSelect = el("house-design");
  const selectedDesign = designSelect.value;
  designSelect.replaceChildren();
  for (const house of catalog.designs) {
    const option = document.createElement("option");
    option.value = house.id;
    option.disabled = !house.supported;
    option.textContent = house.id.split("/").pop() + (house.supported ? "（" + money(house.priceWan * 10000) + "）" : "（價格未支援）");
    designSelect.append(option);
  }
  if (catalog.designs.some(x => x.id === selectedDesign && x.supported)) designSelect.value = selectedDesign;
  const interiorSelect = el("house-interior");
  const previousRank = interiorSelect.value;
  interiorSelect.replaceChildren();
  for (const item of catalog.interiorOptions) {
    const option = document.createElement("option");
    option.value = String(item.rank);
    option.textContent = item.label + "：" + money(item.priceWan * 10000);
    interiorSelect.append(option);
  }
  if (catalog.interiorOptions.some(x => String(x.rank) === previousRank)) interiorSelect.value = previousRank;
  const listing = el("owned-houses");
  listing.replaceChildren();
  if (!state.houses.length) {
    const info = document.createElement("p");
    info.className = "small";
    info.textContent = "尚未擁有住宅。";
    listing.append(info);
  }
  for (const house of state.houses) {
    const box = document.createElement("div");
    box.className = "owned-house";
    const img = document.createElement("img");
    img.src = "/legacy-assets/" + house.image;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    const title = document.createElement("strong");
    title.textContent = house.name;
    const where = document.createElement("p");
    where.className = "small";
    where.textContent = house.townName + " " + house.location + "，購屋價格：" + money(house.purchasePrice);
    const label = document.createElement("label");
    label.textContent = "修改住宅名稱";
    const input = document.createElement("input");
    input.name = "houseName";
    input.value = house.name;
    input.maxLength = 28;
    input.required = true;
    label.append(input);
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "儲存名稱";
    const saleInfo = document.createElement("p");
    saleInfo.className = "small house-sale-info";
    saleInfo.textContent = "原版出售退款（僅土地地價）：" + money(house.saleRefund);
    const sellButton = document.createElement("button");
    sellButton.type = "button";
    sellButton.className = "secondary house-sell";
    sellButton.textContent = "出售住宅";
    sellButton.addEventListener("click", () => {
      const confirmed = window.confirm(
        "確定出售「" + house.name + "」嗎？\n" +
        "將退還 " + money(house.saleRefund) + " 至現金，外觀與室內費用不退還。\n" +
        "原位置會恢復為空地，出售後可以重新購屋。"
      );
      if (confirmed) action("house/sell", { houseId: house.id });
    });
    const visit = document.createElement("button");
    visit.type = "button";
    visit.className = "secondary";
    visit.textContent = "進入室內／設定";
    visit.addEventListener("click", () => openRoom(house.id));
    const renameForm = document.createElement("form");
    renameForm.className = "house-rename-form";
    renameForm.append(label, button);
    box.append(img, title, where, visit, renameForm, makeHouseRemodelForm(house, catalog), saleInfo, sellButton);
    renameForm.addEventListener("submit", event => {
      event.preventDefault();
      action("house/rename", { houseId: house.id, name: input.value }, "已更新住宅名稱。");
    });
    listing.append(box);
  }
  const events = el("house-events");
  events.replaceChildren();
  if (!state.houseEvents?.length) {
    const info = document.createElement("p");
    info.className = "small";
    info.textContent = "尚無住宅建造或出售紀錄。舊版 Web 建屋紀錄不會被虛構補入。";
    events.append(info);
  } else {
    const list = document.createElement("ul");
    list.className = "house-event-list";
    for (const event of state.houseEvents) {
      const item = document.createElement("li");
      const date = new Date(event.occurredAt).toLocaleString("zh-TW");
      item.textContent = date + "｜" +
        (event.action === "sold" ? "出售退還 " : "建造支付 ") +
        money(event.amount) + "｜" + event.townName + " " + event.location;
      list.append(item);
    }
    events.append(list);
  }
  const remodelHistory = el("house-remodel-events");
  remodelHistory.replaceChildren();
  if (!state.houseRemodelEvents?.length) {
    const info = document.createElement("p");
    info.className = "small";
    info.textContent = "尚未有房屋改裝紀錄。";
    remodelHistory.append(info);
  } else {
    const list = document.createElement("ul");
    list.className = "house-event-list";
    for (const event of state.houseRemodelEvents) {
      const item = document.createElement("li");
      const date = new Date(event.occurredAt).toLocaleString("zh-TW");
      const grade = ["A","B","C","D"];
      const changes = [];
      if (event.oldImage !== event.newImage) changes.push("已更換外觀");
      if (event.oldInteriorRank !== event.newInteriorRank)
        changes.push("室內 " + grade[event.oldInteriorRank] + " 級改為 " + grade[event.newInteriorRank] + " 級");
      item.textContent = date + "｜支付 " + money(event.amount) + "｜" +
        event.townName + " " + event.location + "｜" +
        (changes.length ? changes.join("、") : "重新裝修原外觀／室內等級");
      list.append(item);
    }
    remodelHistory.append(list);
  }
  updateHouseQuote();
}

function renderTowns() {
  const target = el("towns");
  target.replaceChildren();
  const fares=new Map((state.trainDestinations??[]).map(route=>[route.townId,route.fare]));
  text("station-status","從"+(state.towns.find(t=>t.id===state.character.townId)?.name??"目前城鎮")+
    "出發，依原版 station.cgi 的電車票價從現金支付；餘額不足時無法乘車。");
  for (const town of state.towns) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "town" + (town.id === state.character.townId ? " active" : "");
    const current=town.id===state.character.townId;
    const fare=fares.get(town.id);
    const affordable=Number.isSafeInteger(fare)&&state.character.money>=fare;
    button.disabled = current || !affordable;
    const title = document.createElement("span");
    const hint = document.createElement("small");
    title.textContent = town.name;
    hint.textContent = current ? "目前所在地（不需搭車）" :
      !Number.isSafeInteger(fare) ? "暫無票價資訊" :
      "車票 "+money(fare)+(affordable?" · 搭乘電車":" · 現金不足");
    button.append(title, hint);
    button.addEventListener("click", () => action("move", { townId: town.id }));
    target.append(button);
  }
}

// 原版 basic.cgi::job_change 有 17 個能力欄，但只列出實際大於 0 的需求。
// 不顯示無門檻的能力或「不限」欄位；應徵資格仍在伺服器判定。
const JOB_REQUIREMENT_KEYS = Object.freeze([
  "kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu",
  "looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku",
  "love","unique","etti"
]);
function jobRequirementsPanel(job) {
  const details=document.createElement("details");
  details.className="job-requirements";
  details.dataset.jobKey=job.key;
  const demanded=JOB_REQUIREMENT_KEYS.filter(key=>Number(job.requirements?.[key]??0)>0);
  const summary=document.createElement("summary");
  summary.textContent=demanded.length?
    "職業條件｜能力已達 "+demanded.filter(key=>
      Number(state.character.stats[key]??0)>=Number(job.requirements[key])).length+
    "/"+demanded.length+" 項（展開比較目前／要求）":"檢視職業條件與待遇";
  details.append(summary);

  const other=document.createElement("div");
  other.className="job-condition-grid";
  const status=[];
  if(job.bmiMin||job.bmiMax){
    const bmi=(job.bmiMin||"不限")+"～"+(job.bmiMax||"不限");
    const current=state.physique?.bmi;
    status.push(["BMI","目前 "+(Number.isFinite(current)?current:"未取得")+"／要求 "+bmi,
      (job.bmiMin&&current<job.bmiMin)||
      (job.bmiMax&&current>job.bmiMax)]);
  }
  if(job.minHeight>0)
    status.push(["身高","目前 "+state.character.height+" cm／要求 "+
      job.minHeight+" cm 以上",state.character.height<job.minHeight]);
  if(job.gender)
    status.push(["性別",job.gender==="male"?"男":"女",
      state.character.gender!==job.gender]);
  if(job.previousJob)
    status.push(["前置精通",job.previousJob,
      state.character.masteredJob!==job.previousJob]);
  for(const [label,required,missing] of status){
    const row=document.createElement("div");
    row.className="job-condition"+(missing?" job-condition-missing":"");
    row.textContent=label+"："+required;
    other.append(row);
  }
  if(status.length)details.append(other);

  const finance=document.createElement("p");
  finance.className="small job-finance";
  finance.textContent="每次基礎薪資 "+money(job.salary)+
    " · 每 "+job.payEvery+" 次工作發薪 · 升級獎金倍率 ×"+
    job.bonusRate+" · 升薪倍率 ×"+job.raiseRate+
    " · 身體消耗 "+job.bodyCost+" · 頭腦消耗 "+job.brainCost;

  if(demanded.length){
    const requirements=document.createElement("div");
    requirements.className="job-condition-grid job-stats-grid";
    for(const key of demanded){
      const current=Number(state.character.stats[key]??0);
      const required=Number(job.requirements[key]);
      const row=document.createElement("div");
      const met=current>=required;
      row.className="job-condition "+(met?"job-condition-met":"job-condition-missing");
      row.textContent=labels[key]+"｜目前 "+current+" ／ 要求 "+required+
        "｜"+(met?"已達標":"還差 "+(required-current));
      requirements.append(row);
    }
    details.append(requirements);
  }
  details.append(finance);
  return details;
}
function renderJobs() {
  if (!state?.character) return;
  el("salary-payment").value=state.character.salaryPayment==="bank"?"bank":"cash";
  const target = el("jobs");
  const search = el("job-search").value.trim().toLocaleLowerCase("zh-TW");
  const availableOnly = el("job-filter").value === "available";
  const expanded=new Set([...target.querySelectorAll("details[open][data-job-key]")]
    .map(element=>element.dataset.jobKey));
  const filtered = state.jobs.filter(job =>
    (!availableOnly || !job.reason) && job.name.toLocaleLowerCase("zh-TW").includes(search)
  );
  text("job-count", "顯示：" + filtered.length + " / " + state.jobs.length);
  target.replaceChildren();
  for (const job of filtered) {
    const row = document.createElement("div");
    row.className = "job" + (job.key === state.character.jobId ? " active" : "");
    const meta = document.createElement("div");
    meta.className="job-main";
    const title = document.createElement("span");
    const desc = document.createElement("small");
    // 原版 basic.cgi 的職業名稱後會顯示 (階級 - 1) 顆 *；這不是玩家目前的職業等級。
    const rankStars=job.rank>1?"*".repeat(job.rank-1):"";
    title.textContent = job.name + rankStars + (job.translated ? "" : "（未翻譯）");
    const eligibility=document.createElement("small");
    eligibility.className="job-eligibility"+(job.reason?" locked":"");
    eligibility.textContent=job.key===state.character.jobId?"目前任職中":
      job.reason?(job.previousJob&&job.reason.startsWith("需先精通")?
        "尚未解鎖："+job.reason:"目前未達就職條件："+job.reason):"可應徵";
    desc.textContent = "薪資 " + money(job.salary) + "／每 " + job.payEvery +
      " 次工作 · 體力 " + job.bodyCost + " · 頭腦 " + job.brainCost;
    const requirements=jobRequirementsPanel(job);
    requirements.open=expanded.has(job.key);
    meta.append(title,eligibility,desc,requirements);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = job.key === state.character.jobId ? "任職中" : "應徵";
    button.disabled = Boolean(job.reason) || job.key === state.character.jobId;
    button.addEventListener("click", () => action("job", { key:job.key }, "已選擇職業：" + job.name));
    row.append(meta, button);
    target.append(row);
  }
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "沒有符合條件的職業。";
    target.append(empty);
  }
}
function renderInsurance() {
  const item=state?.insurance;
  if (!item||!state.character) return;
  text("insurance-status",item.active?
    "健康保險生效中，剩餘約 "+item.remainingDays+" 天，到期時間："+
      new Date(item.activeUntil).toLocaleString("zh-TW")+"。" :
    "目前沒有有效的健康保險。");
  const brief=el("inventory-insurance-inline");
  brief.hidden=!item.active;
  brief.textContent=item.active?"健康保險有效：約剩 "+item.remainingDays+" 天（醫院自動生效）":"";
  const quantity=Number(el("insurance-quantity").value);
  const total=item.price*quantity;
  const capacity=item.maxQuantity*item.durationDays*86400000;
  const allowed=Number.isSafeInteger(quantity)&&quantity>=1&&
    quantity<=item.maxQuantity&&
    item.remainingMs+quantity*item.durationDays*86400000<=capacity;
  const enough=state.character.money>=total;
  text("insurance-quote","原始基準價："+money(item.price)+"／份，合計 "+
    money(total)+"。"+(!allowed?"有效耐久不可超過五份。":
      !enough?"現金不足。":"購買後會延長保險有效期限。"));
  el("insurance-buy").disabled=!allowed||!enough;
  const target=el("insurance-purchases");
  target.replaceChildren();
  if (!state.insurancePurchases?.length) {
    const note=document.createElement("p");
    note.className="small";
    note.textContent="尚無購買紀錄。";
    target.append(note);
    renderLegacyItems();
    return;
  }
  const list=document.createElement("ol");
  list.className="health-event-list";
  for (const purchase of state.insurancePurchases) {
    const item=document.createElement("li");
    item.textContent=new Date(purchase.created_at).toLocaleString("zh-TW")+
      "｜"+purchase.quantity+" 份｜支付 "+money(purchase.paid)+
      "｜有效期累加至 "+new Date(purchase.active_until).toLocaleString("zh-TW");
    list.append(item);
  }
  target.append(list);
  renderLegacyItems();
}

let pendingLegacyUse=null;
async function submitLegacyUse(sourceLine,name){
  if(!window.confirm("確定使用「"+displayRetailItemName(name)+"」一次嗎？將消耗一次原始耐久。"))return;
  if(!pendingLegacyUse||pendingLegacyUse.sourceLine!==sourceLine)
    pendingLegacyUse={sourceLine,requestId:crypto.randomUUID()};
  try{
    state=await api("inventory/legacy/use",pendingLegacyUse);
    const result=state.itemUseResult;
    pendingLegacyUse=null;
    render();
    notify(result.replayed?
      "相同道具使用請求已處理，沒有重複扣除耐久。" :
      "已使用「"+displayRetailItemName(result.name)+"」，效果已套用。");
  }catch(error){
    // 清單重建後再提示，避免把錯誤訊息連同舊商品元件一起刪掉。
    renderLegacyItems();
    notify(error.message,true);
  }
}
// 倒數以伺服器的遊戲時鐘為基準，單機快轉或同步後都重新核對。
let inventoryCooldownSyncBusy=false;
const inventoryCooldownSyncRequested=new Set();
function updateInventoryCooldowns(){
  if(!state?.character||el("inventory-panel").hidden)return;
  const now=browserGameNow();
  let expired=false;
  // 日制過期與回制 0 耐久的清除時間皆以伺服器給的 removeAt 為準。
  for(const card of el("legacy-inventory-list").querySelectorAll(".inventory-item[data-remove-at]")){
    const at=Number(card.dataset.removeAt);
    const remaining=at-now;
    const label=card.querySelector(".inventory-removing");
    if(label&&remaining>0)label.textContent="已用盡，等待移除 "+formatItemCountdown(remaining);
    if(remaining<=0){
      card.hidden=true; // 尚未取得新的 snapshot 也不繼續展示過期道具
      const key="remove:"+state.character.name+":"+card.dataset.sourceLine+":"+at;
      if(!inventoryCooldownSyncRequested.has(key)){
        inventoryCooldownSyncRequested.add(key);expired=true;
      }
    }
  }
  for(const node of el("legacy-inventory-list").querySelectorAll(".inventory-cooldown[data-ready-at]")){
    const readyAt=Number(node.dataset.readyAt);
    const key=node.dataset.cooldownKey;
    const action={canUse:false,readyAt,reason:node.dataset.reason};
    const remaining=itemCooldownRemaining(action,now);
    node.textContent=remaining>0?itemCooldownText(action,now):
      "冷卻已結束，正在確認可使用狀態";
    if(remaining===0&&key&&!inventoryCooldownSyncRequested.has(key)){
      inventoryCooldownSyncRequested.add(key);expired=true;
    }
  }
  if(expired&&!inventoryCooldownSyncBusy){
    inventoryCooldownSyncBusy=true;
    api("state").then(next=>{state=next;render();})
      .catch(()=>{}).finally(()=>{inventoryCooldownSyncBusy=false;});
  }
}
function itemInventoryEffects(info){
  if(!info)return ["原始效果資料尚無法確認"];
  const lines=[];
  if((info.bodyCost??0)<0)lines.push("身體能量恢復 "+(-info.bodyCost));
  if((info.brainCost??0)<0)lines.push("頭腦能量恢復 "+(-info.brainCost));
  if(info.effectCode&&!["無","効果","ステータス"].includes(info.effectCode))
    lines.push(describeOriginalRetailEffect(info.effectCode));
  lines.push(...groupedStatLines(info.effects,labels,info.randomizedEffects));
  if(!lines.length)lines.push("原版沒有非零能力增減");
  return lines;
}
function renderLegacyItems(){
  const target=el("legacy-inventory-list");
  target.replaceChildren();
  const items=state.legacyInventory??[];
  const actions=new Map((state.legacyItemActions??[]).map(x=>[x.sourceLine,x]));
  const grouped=new Map(),gifts=[];
  for(const item of items){
    // 原版一般道具清單排除寄送用「ギフト」，但不刪除：另置收合區。
    if(item.category==="ギフト"){gifts.push(item);continue;}
    if(!grouped.has(item.category))grouped.set(item.category,[]);
    grouped.get(item.category).push(item);
  }
  text("inventory-summary",items.length?
    "顯示 "+items.length+" 筆持有物資料｜"+grouped.size+" 類"+
    (gifts.length?"｜另有 "+gifts.length+" 筆寄送用禮品":""):
    "目前沒有持有物。");
  if(!items.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent="目前沒有持有物；可以在百貨店或自動販賣機購買。";
    target.append(empty);
  }
  for(const category of [...grouped.keys()].sort((x,y)=>x.localeCompare(y,"ja"))){
    const section=document.createElement("section");section.className="inventory-category";
    const heading=document.createElement("h4");heading.className="inventory-category-heading";
    heading.textContent="▼ "+displayRetailItemCategory(category);section.append(heading);
    for(const item of grouped.get(category)){
      const card=document.createElement("article");card.className="inventory-item";
      if(Number.isSafeInteger(item.removeAt)){
        card.dataset.removeAt=String(item.removeAt);
        card.dataset.sourceLine=String(item.sourceLine);
      }
      const info=item.details??null;
      const actionInfo=actions.get(item.sourceLine);
      const head=document.createElement("div");head.className="inventory-item-heading";
      const name=document.createElement("strong");name.textContent=displayRetailItemName(item.name);
      const durability=document.createElement("span");durability.className="inventory-item-remaining";
      const amount=itemRemainingDurability(item,actionInfo,browserGameNow());
      durability.textContent="剩餘 "+amount+(item.unit??"");
      head.append(name,durability);card.append(head);
      const preview=document.createElement("div");preview.className="inventory-effects";
      for(const effect of itemInventoryEffects(info)){
        const line=document.createElement("p");line.className="small";line.textContent=effect;
        preview.append(line);
      }
      card.append(preview);
      const controls=document.createElement("div");controls.className="inventory-item-controls";
      if(actionInfo){
        const status=document.createElement("span");status.className="small inventory-item-status";
        if(amount<=0&&item.unit==="回"&&
           Number.isSafeInteger(item.removeAt)&&item.removeAt>browserGameNow()){
          status.classList.add("inventory-removing");
          status.textContent="已用盡，等待移除 "+
            formatItemCountdown(item.removeAt-browserGameNow());
        }else if(!actionInfo.canUse&&itemCooldownRemaining(actionInfo,browserGameNow())>0){
          status.classList.add("inventory-cooldown");
          status.dataset.readyAt=String(actionInfo.readyAt);
          status.dataset.reason=actionInfo.reason??"";
          status.dataset.cooldownKey=state.character.name+":"+item.sourceLine+":"+actionInfo.readyAt;
          status.textContent=itemCooldownText(actionInfo,browserGameNow());
        }else{
          status.textContent=actionInfo.canUse?"可使用":actionInfo.reason??"目前無法使用";
        }
        const button=document.createElement("button");button.className="secondary";
        button.type="button";button.textContent="使用";
        button.disabled=!actionInfo.canUse;
        button.addEventListener("click",()=>submitLegacyUse(item.sourceLine,item.name));
        controls.append(status,button);
      }else{
        const status=document.createElement("span");status.className="small inventory-item-status";
        status.textContent=item.name==="健康保険"&&state.insurance?.active?
          "醫院自動生效，不需手動使用":"目前尚未支援直接使用";
        controls.append(status);
      }
      card.append(controls);
      const details=document.createElement("details");details.className="inventory-item-details";
      const summary=document.createElement("summary");summary.textContent="原版備註與詳細資訊";
      details.append(summary);
      const lines=[
        "熱量："+(info?.calories??"未確認")+" kcal｜使用間隔："+(info?.intervalMinutes??"未確認")+" 分鐘",
        "身體能量消耗："+(info?.bodyCost??"未確認")+"｜頭腦能量消耗："+(info?.brainCost??"未確認"),
        "原版備註："+(info?.comment?.trim()||"沒有提供文字備註"),
        "來源："+(item.readOnly?"歷史來源封存":item.origin==="fishing"?"Web 釣魚／餌料店":item.origin==="crafting"?"Web 合成屋":"Web 購入或轉換")+
          "（記錄位置 "+item.sourceLine+"；原始內容不在此頁修改）",
        "Web 使用狀態："+(actionInfo?"已核對可使用規則，受冷卻與角色條件限制":
          info?.usage==="automatic"?"自動處理":
          info?.usage==="payment"?"支援有效信用卡付款":
          info?.usage==="gift"?"禮品，請於寄送介面操作":
          item.origin==="fishing"?"請至原版釣場釣魚或出售":"尚未支援手動使用")
      ];
      for(const line of lines){
        const p=document.createElement("p");p.className="small";p.textContent=line;details.append(p);
      }
      card.append(details);section.append(card);
    }
    target.append(section);
  }
  if(gifts.length){
    const details=document.createElement("details");details.className="inventory-secondary";
    const summary=document.createElement("summary");
    summary.textContent="寄送用禮品（"+gifts.length+" 筆）";details.append(summary);
    const note=document.createElement("p");note.className="small";
    note.textContent="原版一般物品清單不顯示自購禮品；這些項目仍留在資料庫，請於禮品店／郵件中操作。";
    details.append(note);
    for(const gift of gifts){
      const p=document.createElement("p");p.className="small";
      p.textContent=displayRetailItemName(gift.name)+"｜剩餘 "+gift.durability+(gift.unit??"");
      details.append(p);
    }
    target.append(details);
  }
  const history=el("legacy-item-use-history");
  history.replaceChildren();
  if(!state.legacyItemHistory?.length){
    const empty=document.createElement("p");
    empty.className="small";
    empty.textContent="目前沒有原版消耗品使用紀錄。";
    history.append(empty);
  }else{
    const list=document.createElement("ol");
    list.className="health-event-list";
    for(const item of state.legacyItemHistory){
      const li=document.createElement("li");
      li.textContent=new Date(item.usedAt).toLocaleString("zh-TW")+
        "｜"+displayRetailItemName(item.name)+"｜能力變化 "+
        Object.entries(item.changes.stats??{}).map(([key,n])=>
          (labels[key]||key)+(n>=0?"+":"")+n).join("、")+
        "｜疾病指數 "+(item.changes.healthIndex>=0?"+":"")+item.changes.healthIndex+
        "｜體重 "+(item.changes.weight>=0?"+":"")+item.changes.weight+" 公斤";
      list.append(li);
    }
    history.append(list);
  }
}

function updateCockroachCountdown() {
  const challenge=state?.cockroachChallenge;
  const panel=el("cockroach-challenge");
  const popup=el("event-popup");
  panel.hidden=!challenge;
  const remaining=challenge?Math.max(0,challenge.expiresAt-browserGameNow()):0;
  if(challenge){
    text("cockroach-remaining",remaining>0 ?
      "蟑螂出現！剩餘 "+(remaining/1000).toFixed(1)+" 秒。" :
      "蟑螂已逃走，期限已過，沒有獎勵。");
    el("cockroach-claim").disabled=remaining<=0;
  }
  const active=Boolean(challenge)&&challenge.status==="active"&&remaining>0;
  const event=state?.healthEvents?.[0];
  const recent=event?.day===state?.character?.lastEventDay?event:null;
  const key=state?.character?.name+":"+
    (active?"cockroach-"+challenge.eventId:recent?"event-"+recent.id:"none");
  const visible=Boolean(state?.character)&&!el("game").hidden&&
    (active||recent)&&dismissedEventKey!==key;
  popup.hidden=!visible;
  if(!visible)return;
  popup.dataset.key=key;
  text("event-popup-title",active?"⚠ 限時事件：蟑螂！":"事件發生！");
  text("event-popup-body",active?
    "剩餘 "+(remaining/1000).toFixed(1)+" 秒，請立即處理。" :
    recent.title+"："+recent.description);
  el("event-popup-claim").hidden=!active;
  el("event-alert").hidden=false;
  el("event-alert").textContent=active?"查看事件詳情":"查看事件紀錄";
}
let pendingCouponRedemption=null;
async function submitCouponRedemption(reward){
  if(!reward.canRedeem)return;
  if(!window.confirm("確定使用 "+reward.requiredCoupons+" 點 Web 事件優惠券，兌換「"+
    reward.originalName+"」嗎？此獎品會以原版 33 欄入庫；部分獎品效果仍未支援。"))return;
  if(!pendingCouponRedemption||
     pendingCouponRedemption.sourceIndex!==reward.sourceIndex||
     pendingCouponRedemption.originalName!==reward.originalName)
    pendingCouponRedemption={
      sourceIndex:reward.sourceIndex,originalName:reward.originalName,
      requestId:crypto.randomUUID()
    };
  try{
    state=await api("coupon/redeem",pendingCouponRedemption);
    const result=state.couponResult;
    pendingCouponRedemption=null;
    render();
    notify(result.replayed?
      "這筆優惠券兌換已處理過，沒有再次扣券或發獎。":
      "已扣除 "+result.couponCost+" 點 Web 事件券，兌換「"+
      result.originalName+"」，獎品已加入本人背包。");
  }catch(error){notify(error.message,true);}
}
function renderCouponShop(){
  const available=state.couponShopAvailable===true;
  text("coupon-shop-status",available?
    "目前城鎮有原版優惠券兌換所；使用 Web 事件取得的點數兌換獎品。":
    "目前城鎮沒有「クーポン」兌換所。可在單機地圖編輯器放置該原版建築，或前往已有兌換所的城鎮。");
  const target=el("coupon-rewards");
  target.replaceChildren();
  for(const reward of state.couponRewards??[]){
    const tile=document.createElement("div");
    tile.className="training-tile";
    const heading=document.createElement("strong");
    heading.textContent=reward.originalName;
    const info=document.createElement("p");info.className="small";
    info.textContent="需要 "+reward.requiredCoupons+" 點｜獎品耐久 "+
      reward.rewardDurability+" "+reward.rewardDurabilityUnit+
      "（是獎品本身的耐久，並非優惠券到期時間）";
    const button=document.createElement("button");
    button.type="button";
    button.textContent=reward.canRedeem?"兌換這件獎品":"目前不可兌換";
    button.disabled=!reward.canRedeem;
    const reason=document.createElement("p");reason.className="small";
    reason.textContent=reward.reason??"";
    reason.hidden=!reward.reason;
    button.addEventListener("click",()=>submitCouponRedemption(reward));
    tile.append(heading,info,button,reason);
    target.append(tile);
  }
  const history=el("coupon-redemptions");
  history.replaceChildren();
  const entries=state.couponRedemptions??[];
  if(!entries.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent="尚無兌換紀錄。";
    history.append(empty);
    return;
  }
  const list=document.createElement("ol");list.className="health-event-list";
  for(const entry of entries){
    const li=document.createElement("li");
    li.textContent=new Date(entry.createdAt).toLocaleString("zh-TW")+"｜"+
      entry.originalName+"（扣 "+entry.couponCost+" 點；持有物行號 "+
      entry.sourceLine+"）";
    list.append(li);
  }
  history.append(list);
}

function renderDining() {
  if (!state?.character) return;
  const status=state.hunger;
  text("hunger-status",status?.label ?? "未知");
  text("physique-status",(state.physique?.label ?? "未知") +
    "（BMI " + (state.physique?.bmi ?? "?") + "）");
  text("condition-status",(state.condition?.label ?? "未知") +
    (state.condition?.provisional ? "（缺少用餐紀錄，暫定）" : ""));
  const health=state.health;
  text("health-status",(health?.name ?? "未知") +
    (health ? "（指數 "+health.index+"）" : ""));
  text("hospital-diagnosis","目前診斷：" + (health?.name ?? "未知") +
    (health?.lastSettledDay ? "；最近結算日：" + health.lastSettledDay : ""));
  const quote=state.hospital;
  text("hospital-cost",(quote?.hasInsurance?"已套用健康保險折抵。":"")+
    (quote?.disease.key==="healthy" ?
    "目前沒有診斷疾病。原版仍提供 " + money(quote.price) + " 的預防性注射。" :
    "治療「" + (quote?.disease.name ?? "未知") + "」需支付現金 " +
      money(quote?.price??0) + "。"));
  el("hospital-treat").disabled=!quote || (state.character.money<quote.price);
  text("event-coupon-count","Web 事件所得優惠券："+(state.couponBalance ?? 0)+" 點");
  renderCouponShop();
  text("event-kpoint","Web K 點數："+(state.character?.kpoint??0));
  updateCockroachCountdown();
  const events=el("health-event-history");
  events.replaceChildren();
  if (!(state.healthEvents?.length)) {
    const empty=document.createElement("p");
    empty.className="small";
    empty.textContent="目前沒有已實作的隨機事件紀錄。";
    events.append(empty);
  } else {
    const list=document.createElement("ol");
    list.className="health-event-list";
    for (const event of state.healthEvents) {
      const item=document.createElement("li");
      item.textContent=event.day+"｜"+event.title+"："+event.description+
        (event.oldHealthIndex!==event.newHealthIndex?
          "（疾病指數 "+event.oldHealthIndex+" → "+event.newHealthIndex+"）":"");
      list.append(item);
    }
    events.append(list);
  }
  const wait=state.mealCooldownMs ?? 0;
  text("meal-status",wait>0 ?
    "距離下次用餐還有 " + Math.ceil(wait/60000) + " 分鐘" :
    "現在可以用餐");
  text("meal-menu-day",(state.mealMenuDay??"—")+" 的菜單（今日供應數量全玩家共用）");
  const list=el("meal-list");
  list.replaceChildren();
  const menu=el("meal-menu").value;
  for(const meal of state.meals??[]) {
    if(meal.menu!==menu) continue;
    const tile=document.createElement("div");
    tile.className="training-tile";
    const title=document.createElement("strong");
    title.textContent=meal.name;
    const desc=document.createElement("p");
    desc.className="small";
    desc.textContent="餐費："+money(meal.price)+"，熱量："+meal.calories+
      "，體重預計增加 "+(meal.calories/1000).toFixed(2)+
      " 公斤，剩餘 "+meal.stock+" 份";
    const gains=document.createElement("p");
    gains.className="small";
    const parts=Object.entries(meal.gains).filter(([,n])=>n>0)
      .map(([key,n])=>(labels[key]||key)+" +"+n);
    gains.textContent=parts.length?parts.join("、"):"不增加能力值";
    const button=document.createElement("button");
    button.type="button";
    button.textContent=meal.reason?"目前無法用餐":"選擇這道餐點";
    button.disabled=Boolean(meal.reason);
    button.addEventListener("click",()=>{
      if(window.confirm("確定支付 "+money(meal.price)+" 食用「"+meal.name+"」嗎？"))
        action("meal/eat",{key:meal.key});
    });
    tile.append(title,desc,gains);
    if(meal.reason){
      const reason=document.createElement("p");
      reason.className="training-blocked";
      reason.textContent=meal.reason;
      tile.append(reason);
    }
    tile.append(button);
    list.append(tile);
  }
}


let pendingRetailPurchase=null;
async function submitRetailPurchase(item,quantity,payment,cardSourceLine){
  const total=item.price*quantity;
  const method=payment==="bank"?"普通銀行存款（有效信用卡）":"現金";
  if(!window.confirm("確定以"+method+"支付 "+money(total)+
    "，購買「"+displayRetailItemName(item.name)+"」×"+quantity+" 嗎？"))return;
  if(!pendingRetailPurchase||pendingRetailPurchase.shop!==item.shop||
     pendingRetailPurchase.sku!==item.sku||
     pendingRetailPurchase.quantity!==quantity||
     pendingRetailPurchase.payment!==payment||
     pendingRetailPurchase.cardSourceLine!==cardSourceLine)
    pendingRetailPurchase={shop:item.shop,sku:item.sku,quantity,payment,
      ...(payment==="bank"?{cardSourceLine}:{}),
      requestId:crypto.randomUUID()};
  try{
    state=await api("retail/buy",pendingRetailPurchase);
    const result=state.retailResult;
    pendingRetailPurchase=null;
    render();
    notify(result.replayed?"這筆購買已完成，未重複扣款。":
      "已購入「"+displayRetailItemName(result.name)+"」×"+result.quantity+"，"+
      (result.payment==="bank"?"普通存款":"現金")+"支付 "+money(result.paid)+
      (result.merged?"；耐久已合併至原持有物。":"；物品已加入本人清單。"));
  }catch(error){notify(error.message,true);}
}
function describeOriginalRetailEffect(code){
  const names={
    "万能":"疾病指數改善","風邪":"感冒時改善疾病指數",
    "下痢":"腹瀉時改善疾病指數","肺炎":"肺炎時改善疾病指數",
    "結核":"結核時改善疾病指數","ウエイトアップ":"增加體重",
    "ダイエット":"減少體重","身長":"增加身高","縮み":"減少身高"
  };
  if(code==="無")return "原版標記「無」；仍須查看下方能力增減值";
  if(code==="万能,")
    return "原版沒有填寫治療幅度；不會推定治病加成，一般能力與熱量需依原版欄位及 Web 支援狀態核對";
  if(code==="ステータス")
    return "依原版能力增減和能量消耗欄位生效；原版沒有額外特殊分支";
  if(code==="効果")
    return "原版沒有額外特殊分支；已核對的牛奶與聖代透過負能量消耗恢復能量";
  const compound=/^([^,]+),(\d+),(食料品|ファ)$/.exec(code);
  if(compound&&names[compound[1]]){
    const unit=["身長","縮み"].includes(compound[1])?" cm":
      ["ウエイトアップ","ダイエット"].includes(compound[1])?" kg":"";
    return names[compound[1]]+" "+compound[2]+unit+
      "｜原版分類標記："+(compound[3]==="ファ"?"速食":"食品")+
      "（第三段不是額外能力數值）";
  }
  const match=/^([^,]+),(\d+)$/.exec(code);
  if(match&&names[match[1]]){
    const unit=["身長","縮み"].includes(match[1])?" cm":
      ["ウエイトアップ","ダイエット"].includes(match[1])?" kg":"";
    return names[match[1]]+" "+match[2]+unit+"（原版："+code+"）";
  }
  return "原版特殊代碼："+code+"（尚未將此代碼解讀成確定效果）";
}
function retailEffectDetails(item){
  const info=item.details??{};
  const bonuses=Object.entries(info.effects??{})
    .map(([key,value])=>(labels[key]??key)+
      (info.randomizedEffects?" +0～+"+value:(value>0?"+":"")+value));
  // 完整列出原版非零能力，不再截斷成「等 X 項」；同幅度合併以減少重複。
  const primary=[];
  if((info.bodyCost??0)<0)primary.push("身體能量恢復 "+(-info.bodyCost));
  if((info.brainCost??0)<0)primary.push("頭腦能量恢復 "+(-info.brainCost));
  if(info.effectCode&&!["無","効果","ステータス"].includes(info.effectCode))
    primary.push(describeOriginalRetailEffect(info.effectCode));
  primary.push(...groupedStatLines(info.effects,labels,info.randomizedEffects));
  if(!primary.length)primary.push("原版未記載能力增減");
  const preview=document.createElement("div");
  preview.className="retail-effect-preview";
  for(const line of primary){
    const p=document.createElement("p");
    p.className="small";p.textContent=line;preview.append(p);
  }
  const details=document.createElement("details");
  details.className="retail-item-effects";
  const summary=document.createElement("summary");
  summary.textContent="原版商品效果、備註與 Web 使用狀態";
  details.append(summary);
  const lines=[
    "能力增減"+(info.randomizedEffects?"（每項獨立隨機）":"")+"："+
      (bonuses.length?bonuses.join("、"):"原版欄位沒有非零能力增減"),
    "特殊欄位："+describeOriginalRetailEffect(info.effectCode??"無"),
    "熱量："+(info.calories??0)+" kcal"+
      ((info.calories??0)<0?"（依原版計算，使用後體重減少）":"")+
      "｜使用間隔："+(info.intervalMinutes??0)+" 分鐘",
    "身體能量消耗："+(info.bodyCost??0)+"（負數表示恢復）"+
      "｜頭腦能量消耗："+(info.brainCost??0)+"（負數表示恢復）",
    "原版備註："+(info.comment?.trim()||"沒有提供文字備註"),
    "Web 生效狀態："+(
      info.usage==="automatic"?"已支援：健康保險於醫院自動計算，不需手動使用":
      info.usage==="payment"?"已支援：有效期內可於支援信用卡的商店從普通銀行付款":
      info.usage==="gift"?"屬於禮品：可依禮品寄送規則操作，不是一般直接使用道具":
      info.usage==="supported"?"已支援：購買後可在持有物執行使用（仍受冷卻、體力等條件限制）":
      "目前尚未支援直接使用；顯示原始數值不代表效果已能執行")
  ];
  for(const line of lines){
    const p=document.createElement("p");
    p.className="small";p.textContent=line;
    details.append(p);
  }
  return {preview,details};
}
// 保留上次選擇，避免每 30 秒同步狀態就清空正在進行的結帳。
const shopCartSelections=new Map();
// 原版兩種店均為「一商品一列、分類分段、選一件後統一結帳」。
function renderShopTable(target,goods,{shopName,onPurchase,emptyText}){
  // 商店、確認與背包顯示中文；商品 SKU 和後端原始日文資料保持不變。
  const displayProductName=shopName==="自動販賣機"?displayVendingName:displayRetailItemName;
  target.replaceChildren();
  if(!goods.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent=emptyText;target.append(empty);return;
  }
  const viewport=document.createElement("div");
  viewport.className="shop-table-scroll";
  viewport.tabIndex=0;
  viewport.setAttribute("aria-label",shopName+"商品清單，可逐列查看商品效果");
  const table=document.createElement("table");
  table.className="shop-catalog";
  const header=document.createElement("thead");
  const headings=document.createElement("tr");
  for(const heading of ["商品","價格","主要效果（完整列出）","庫存／耐久","詳情"]){
    const th=document.createElement("th");th.scope="col";th.textContent=heading;
    headings.append(th);
  }
  header.append(headings);
  const body=document.createElement("tbody");
  const saved=shopCartSelections.get(shopName);
  let category=null,chosen=goods.find(item=>item.sku===saved?.sku&&item.stock>0)??null;
  const cards=state.classroomCreditCards??[];
  const checkout=document.createElement("div");checkout.className="shop-checkout";
  const controls=document.createElement("div");controls.className="retail-buy-controls";
  const qtyLabel=document.createElement("label");qtyLabel.textContent="數量";
  const qty=document.createElement("select");
  qty.setAttribute("aria-label",shopName+"購買數量");
  for(let n=1;n<=5;n++){
    const option=document.createElement("option");option.value=String(n);
    option.textContent=n+" 件";qty.append(option);
  }
  qtyLabel.append(qty);
  const paymentLabel=document.createElement("label");paymentLabel.textContent="付款方式";
  const payment=document.createElement("select");
  payment.setAttribute("aria-label",shopName+"付款方式");
  const cash=document.createElement("option");cash.value="cash";cash.textContent="現金";
  payment.append(cash);
  for(const card of cards){
    const option=document.createElement("option");
    option.value="card:"+card.sourceLine;
    option.textContent="信用卡："+card.name;payment.append(option);
  }
  paymentLabel.append(payment);
  if(saved?.quantity&&[...qty.options].some(x=>x.value===String(saved.quantity)))
    qty.value=String(saved.quantity);
  if(saved?.payment&&[...payment.options].some(x=>x.value===saved.payment))
    payment.value=saved.payment;
  controls.append(qtyLabel,paymentLabel);
  const quote=document.createElement("p");quote.className="small";
  quote.setAttribute("role","status");
  const button=document.createElement("button");
  button.type="button";button.textContent="請先選擇商品";button.disabled=true;
  function update(){
    const item=chosen,quantity=Number(qty.value);
    const bank=payment.value.startsWith("card:");
    const balance=bank?state.character.bank:state.character.money;
    const total=item?item.price*quantity:0;
    const available=Boolean(item)&&item.stock>=quantity;
    const affordable=Number.isSafeInteger(total)&&total<=balance;
    for(const option of qty.options)
      option.disabled=Boolean(item)&&Number(option.value)>item.stock;
    quote.textContent=!item?"先在上方表格選擇一項商品。":
      "已選："+displayProductName(item.name)+"｜合計 "+money(total)+"（"+(bank?"普通存款":"現金")+"）"+
      (!available?"｜庫存不足":!affordable?"｜餘額不足":"");
    button.disabled=!item||item.stock<=0||!available||!affordable;
    button.textContent=!item?"請先選擇商品":item.stock<=0?"售完":
      !available?"庫存不足":!affordable?"餘額不足":"購買所選商品";
  }
  let n=0;
  for(const item of goods){
    if(item.category!==category){
      category=item.category;
      const group=document.createElement("tr");group.className="shop-category-row";
      const th=document.createElement("th");th.scope="rowgroup";th.colSpan=5;
      th.textContent="▼ "+(shopName==="自動販賣機"?displayKnownItemCategory(category):displayRetailItemCategory(category));group.append(th);body.append(group);
    }
    const row=document.createElement("tr");row.className="shop-product-row";
    const nameCell=document.createElement("td");
    const label=document.createElement("label");label.className="shop-product-name";
    const radio=document.createElement("input");radio.type="radio";
    radio.name=shopName+"-selection";radio.value=item.sku;
    radio.disabled=item.stock<=0;
    radio.checked=item===chosen;
    radio.addEventListener("change",()=>{
      chosen=item;
      shopCartSelections.set(shopName,{sku:item.sku,quantity:Number(qty.value),
        payment:payment.value});
      update();
    });
    label.append(radio,document.createTextNode(displayProductName(item.name)));nameCell.append(label);
    const price=document.createElement("td");price.className="shop-price";
    price.textContent=money(item.price);
    const effectCell=document.createElement("td");effectCell.className="shop-effect-cell";
    const effects=retailEffectDetails(item);effectCell.append(effects.preview);
    const remaining=document.createElement("td");remaining.className="shop-stock";
    remaining.textContent=(item.stock<=0?"售完":"庫存 "+item.stock)+
      "｜耐久 "+item.durability+item.unit;
    const detailCell=document.createElement("td");detailCell.className="shop-expand";
    const toggle=document.createElement("button");toggle.type="button";
    toggle.className="secondary shop-detail-toggle";toggle.textContent="查看明細";
    const detailId=shopName+"-detail-"+(n++);
    toggle.setAttribute("aria-controls",detailId);
    toggle.setAttribute("aria-expanded","false");
    const detailRow=document.createElement("tr");detailRow.className="shop-detail-row";
    detailRow.id=detailId;detailRow.hidden=true;
    const full=document.createElement("td");full.colSpan=5;
    effects.details.open=true;full.append(effects.details);detailRow.append(full);
    toggle.addEventListener("click",()=>{
      detailRow.hidden=!detailRow.hidden;
      toggle.setAttribute("aria-expanded",String(!detailRow.hidden));
      toggle.textContent=detailRow.hidden?"查看明細":"收合明細";
    });
    detailCell.append(toggle);
    row.append(nameCell,price,effectCell,remaining,detailCell);
    body.append(row,detailRow);
  }
  table.append(header,body);viewport.append(table);target.append(viewport);
  button.addEventListener("click",()=>{
    if(!chosen)return;
    const bank=payment.value.startsWith("card:");
    onPurchase(chosen,Number(qty.value),bank?"bank":"cash",
      bank?Number(payment.value.slice(5)):undefined);
  });
  const saveControls=()=>{
    if(chosen)shopCartSelections.set(shopName,{
      sku:chosen.sku,quantity:Number(qty.value),payment:payment.value
    });
    update();
  };
  qty.addEventListener("change",saveControls);
  payment.addEventListener("change",saveControls);
  checkout.append(controls,quote,button);target.append(checkout);
  update();
}
let pendingMultiCard=null;
let multiCardBusy=false;
async function submitMultiCard(course,stake){
  if(multiCardBusy)return;
  const chosen=state?.multiCard?.courses?.find(item=>item.course===course);
  if(!chosen)return;
  if(!window.confirm("確認挑戰多卡「"+money(chosen.unit)+"課程」？"+
      "當前共用倍率 "+state.multiCard.cardCount+
      "；成功淨得、失敗淨扣 "+money(stake)+
      "。真實成功機率 "+chosen.actualPercent+"%。"))return;
  if(!pendingMultiCard||pendingMultiCard.course!==course)
    pendingMultiCard={course,requestId:crypto.randomUUID()};
  multiCardBusy=true;
  el("arcade-cardw-submit").disabled=true;
  try{
    state=await api("arcade/cardw/draw",{
      course,requestId:pendingMultiCard.requestId
    });
    const r=state.multiCardResult;
    pendingMultiCard=null;
    render();
    notify(r.replayed?"原本多卡請求已經結算，沒有重複扣款或獎勵。":
      "多卡抽出 "+r.roll+"／100，"+(r.won?"成功得款 ":"失敗扣款 ")+
      money(r.stake)+"；共用倍率 "+r.cardsBefore+" → "+r.cardsAfter+"。");
  }catch(error){notify(error.message,true);}
  finally{multiCardBusy=false;if(state?.character)renderMultiCard();}
}
function renderMultiCard(){
  if(!state?.character)return;
  const info=state.multiCard??{},courses=info.courses??[];
  const selected=Number(el("arcade-cardw-course").value);
  const course=courses.find(c=>c.course===selected)??courses[0];
  const select=el("arcade-cardw-course");
  const submit=el("arcade-cardw-submit");
  select.disabled=!course;
  select.onchange=renderMultiCard;
  const history=el("arcade-cardw-history");
  if(!course){
    text("arcade-cardw-status","多卡來源尚未載入。");
    text("arcade-cardw-quote","");
    text("arcade-cardw-result","");
    submit.disabled=true;history.replaceChildren();return;
  }
  const available=info.available===true;
  const seconds=Math.ceil(Math.max(0,(info.readyAt??0)-browserGameNow())/1000);
  const blocked=info.multiplayerAdjacentRepeatBlocked===true;
  const enough=course.safe&&state.character.money>=course.stake;
  text("arcade-cardw-status",!available?
    "目前城鎮沒有「ゲーセン」遊樂中心。":
    blocked?"原版禁止同一位玩家連續抽卡；請等待其他玩家抽卡。":
    seconds>0?"單機多卡尚需等待 "+seconds+" 秒（可使用單機快轉）。":
    "可抽卡。所有玩家共用目前倍率 "+info.cardCount+"。");
  text("arcade-cardw-quote","目前共用倍率 "+info.cardCount+
    "｜基本課程 "+money(course.unit)+"｜本局可能得款／扣款 "+
    money(course.stake)+
    "｜原版畫面機率 "+course.displayPercent+
    "%；實際執行機率 "+course.actualPercent+"%"+
    "｜目前現金 "+money(state.character.money)+
    (!enough?"｜現金不足或賭注超出安全範圍":""));
  submit.disabled=multiCardBusy||!available||blocked||seconds>0||!enough;
  submit.onclick=()=>{
    if(!multiCardBusy&&available&&!blocked&&seconds===0&&enough)
      submitMultiCard(course.course,course.stake);
  };
  const rounds=info.history??[];
  const latest=rounds[0];
  text("arcade-cardw-result",latest?
    "最近一局：第"+(latest.course+1)+"課程、抽到"+latest.roll+
    "；"+(latest.won?"成功獲得 ":"失敗扣除 ")+money(latest.stake)+
    "，倍率 "+latest.cardsBefore+" → "+latest.cardsAfter:
    "尚無本人多卡抽牌紀錄。");
  history.replaceChildren();
  if(!rounds.length){
    const p=document.createElement("p");
    p.className="small";p.textContent="尚無多卡紀錄。";history.append(p);
    return;
  }
  const list=document.createElement("ol");
  list.className="health-event-list";
  for(const r of rounds){
    const li=document.createElement("li");
    li.textContent=new Date(r.playedAt).toLocaleString("zh-TW")+
      "｜課程"+(r.course+1)+" 抽到"+r.roll+
      "｜"+(r.won?"得款 +":"扣款 −")+money(r.stake)+
      "｜倍率 "+r.cardsBefore+" → "+r.cardsAfter;
    list.append(li);
  }
  history.append(list);
}

let pendingLoto6Purchase=null;
let loto6Busy=false;
async function buyLoto6(random,numbers){
  if(loto6Busy)return;
  const info=state.loto6;
  const key=random?"random":"manual:"+numbers.join(",");
  if(!window.confirm("確認花費 "+money(info.price)+" 買一注六號樂透？"+
      (random?"伺服器將隨機選出6個不同號碼。":
        "所選號碼："+numbers.join("、")+"。")+
      "開獎後獎金會存入普通銀行，不會直接變成現金。"))return;
  if(!pendingLoto6Purchase||pendingLoto6Purchase.key!==key)
    pendingLoto6Purchase={key,requestId:crypto.randomUUID()};
  loto6Busy=true;
  el("arcade-loto6-buy").disabled=true;
  try{
    state=await api("arcade/loto6/buy",{
      ...(random?{random:true}:{numbers,random:false}),
      requestId:pendingLoto6Purchase.requestId
    });
    const ticket=state.loto6TicketResult;
    pendingLoto6Purchase=null;render();
    notify(ticket.replayed?"這注彩券已購買過，不會再次扣款。":
      "已買入六號樂透："+ticket.numbers.join("、")+
      "；扣款 "+money(ticket.price)+
      (ticket.drawTriggered?"。上一輪也已完成開獎。":"。等待下一輪開獎。"));
  }catch(error){notify(error.message,true);}
  finally{loto6Busy=false;if(state?.character)renderLoto6();}
}
async function checkLoto6Draw(){
  if(loto6Busy)return;
  loto6Busy=true;
  el("arcade-loto6-check").disabled=true;
  try{
    state=await api("arcade/loto6/check",{});
    const result=state.loto6DrawResult;
    render();
    notify(result.drawn?
      "六號樂透已開獎（"+result.reason+"），中獎號碼 "+
      result.winningNumbers.join("、")+
      "。共結算 "+result.ticketCount+" 注，獎金合計 "+
      money(result.totalPrize)+" 匯入各玩家的普通銀行。":
      "目前六號樂透尚未達06:00開獎條件，也未累計200注。");
  }catch(error){notify(error.message,true);}
  finally{loto6Busy=false;if(state?.character)renderLoto6();}
}
function renderLoto6(){
  if(!state?.character)return;
  const info=state.loto6??{};
  const available=info.available===true;
  const random=el("arcade-loto6-random");
  const selectors=Array.from({length:6},(_,i)=>el("arcade-loto6-number-"+(i+1)));
  for(let i=0;i<selectors.length;i++){
    const select=selectors[i],old=select.value;
    if(select.options.length!==36){
      select.replaceChildren();
      for(let n=1;n<=36;n++){
        const option=document.createElement("option");
        option.value=String(n);option.textContent=String(n).padStart(2,"0");
        select.append(option);
      }
      select.value=Number.isInteger(Number(old))&&Number(old)>=1&&Number(old)<=36?
        old:String(i+1);
    }
  }
  const buy=el("arcade-loto6-buy"),check=el("arcade-loto6-check");
  const current=selectors.map(x=>Number(x.value));
  const bank=state.character.bank;
  text("arcade-loto6-status",!available?
    "目前所在城鎮沒有「ゲーセン」遊樂中心。":
    "目前輪次：全服待開獎 "+info.pendingCount+"/"+info.drawCap+
    " 注；本人 "+info.myPendingCount+"/"+info.perUserLimit+
    " 注；當地時鐘 "+String(info.hour).padStart(2,"0")+
    " 時。"+(info.due?"已滿足開獎條件（"+
      (info.dueReason==="06:00"?"06:00":"達200注")+"）；請按下方開獎按鈕。":
      "尚未到新一輪開獎條件。"));
  function update(){
    const chosen=selectors.map(x=>Number(x.value));
    const valid=chosen.length===6&&chosen.every(x=>Number.isInteger(x)&&x>=1&&x<=36)&&
      new Set(chosen).size===6;
    const enough=Number.isSafeInteger(info.price)&&state.character.money>=info.price;
    for(const select of selectors)select.disabled=random.checked;
    text("arcade-loto6-quote",(random.checked?"伺服器隨機選6個不重複數字":
      "所選 "+chosen.map(x=>String(x).padStart(2,"0")).join("、")+
      (valid?"":"（不可有重複或無效號碼）"))+
      "｜每注 "+money(info.price??0)+
      "｜目前現金 "+money(state.character.money)+
      "｜普通銀行 "+money(bank)+
      (!enough?"｜現金不足":""));
    buy.disabled=loto6Busy||!available||!enough||
      (info.myPendingCount??0)>=(info.perUserLimit??20)||
      (!random.checked&&!valid);
    check.disabled=loto6Busy||!available;
  }
  for(const select of selectors)select.onchange=update;
  random.onchange=update;
  buy.onclick=()=>{
    const numbers=selectors.map(x=>Number(x.value));
    const valid=numbers.length===6&&numbers.every(x=>Number.isInteger(x)&&x>=1&&x<=36)&&
      new Set(numbers).size===6;
    if(!loto6Busy&&available&&state.character.money>=info.price&&
       info.myPendingCount<info.perUserLimit&&(random.checked||valid))
      buyLoto6(random.checked,numbers);
  };
  check.onclick=checkLoto6Draw;
  update();
  text("arcade-loto6-result",info.lastDraw?
    "最近開獎："+info.lastDraw.day+
    "｜號碼 "+info.lastDraw.numbers.join("、")+
    "｜"+(info.lastDraw.reason==="06:00"?"06:00時段":"200注滿額")+
    "｜共結算 "+info.lastDraw.ticketCount+" 注":
    "尚無六號樂透開獎紀錄。");
  const history=el("arcade-loto6-history");history.replaceChildren();
  const tickets=info.history??[];
  if(!tickets.length){
    const p=document.createElement("p");p.className="small";
    p.textContent="尚未購買彩券。";history.append(p);
  }else{
    const list=document.createElement("ol");list.className="health-event-list";
    for(const ticket of tickets){
      const li=document.createElement("li");
      li.textContent=new Date(ticket.boughtAt).toLocaleString("zh-TW")+
        "｜"+ticket.numbers.join("、")+
        (ticket.randomSelected?"（隨機選號）":"")+
        "｜"+(ticket.pending?"待開獎":
          "中 "+ticket.matches+" 號，普通銀行獎金 "+
          money(ticket.prize??0));
      list.append(li);
    }
    history.append(list);
  }
}

let pendingInstantLoto=null;
let instantLotoSubmitting=false;
async function submitInstantLoto(stake,chosenDigits){
  if(instantLotoSubmitting)return;
  if(!window.confirm("確認以現金 "+money(stake)+" 下注六位數 "+
    chosenDigits.join("")+" 嗎？伺服器會即時開出六個0～9數字，並依猜中位置發還0～1000倍金額。"))return;
  const key=stake+":"+chosenDigits.join("");
  if(!pendingInstantLoto||pendingInstantLoto.key!==key)
    pendingInstantLoto={key,requestId:crypto.randomUUID()};
  instantLotoSubmitting=true;
  el("arcade-loto-submit").disabled=true;
  try{
    state=await api("arcade/loto/play",{
      stake,chosenDigits,requestId:pendingInstantLoto.requestId
    });
    const result=state.instantLotoResult;
    pendingInstantLoto=null;
    render();
    notify(result.replayed?"這筆六位數樂透已經結算，沒有重複扣款或發獎。":
      "六位數樂透：你的 "+result.chosenDigits.join("")+
      "／開獎 "+result.drawnDigits.join("")+
      "｜猜中 "+result.matches+" 位（"+result.multiplier+"倍發還）｜"+
      (result.delta>=0?"現金淨增加 ":"現金淨減少 ")+
      money(Math.abs(result.delta))+"。");
  }catch(error){notify(error.message,true);}
  finally{
    instantLotoSubmitting=false;
    if(state?.character)renderInstantLoto();
  }
}
function renderInstantLoto(){
  if(!state?.character)return;
  const info=state.instantLoto??{};
  const available=info.available===true;
  const remain=Math.max(0,(info.readyAt??0)-browserGameNow());
  text("arcade-loto-status",!available?
    "目前城鎮沒有「ゲーセン」遊樂中心；可在單機編輯地圖放置。":
    remain>0?"原版最後一位玩樂透的仍是本人，需再等 "+
      Math.ceil(remain/1000)+" 秒（單機可快轉）。":
      "可立即開獎；僅當最後遊玩者仍是本人時，才有3分鐘限制。");
  const selectors=Array.from({length:6},(_,i)=>el("arcade-loto-digit-"+(i+1)));
  for(const selector of selectors){
    const previous=selector.value;
    if(selector.options.length!==10){
      selector.replaceChildren();
      for(let digit=0;digit<10;digit++){
        const option=document.createElement("option");
        option.value=String(digit);option.textContent=String(digit);
        selector.append(option);
      }
      if(Array.from({length:10},(_,i)=>String(i)).includes(previous))
        selector.value=previous;
    }
  }
  const stake=el("arcade-loto-stake"),previousStake=stake.value;
  stake.replaceChildren();
  for(const amount of info.rates??[]){
    const option=document.createElement("option");
    option.value=String(amount);option.textContent=money(amount);
    stake.append(option);
  }
  if((info.rates??[]).some(x=>String(x)===previousStake))stake.value=previousStake;
  const submit=el("arcade-loto-submit");
  function update(){
    const amount=Number(stake.value);
    const chosen=selectors.map(s=>Number(s.value));
    const valid=(info.rates??[]).includes(amount)&&
      chosen.length===6&&chosen.every(x=>Number.isInteger(x)&&x>=0&&x<=9);
    const enough=valid&&state.character.money>=amount;
    text("arcade-loto-quote",valid?
      "所選號碼 "+chosen.join("")+"｜下注 "+money(amount)+
      "｜0位中獎會損失 "+money(amount)+
      "｜全部6位相符最高發還 "+money(amount*1000)+
      (!enough?"｜現金不足":""):
      "請選擇六位0～9數字及原版下注金額。");
    submit.disabled=instantLotoSubmitting||!available||remain>0||!enough;
  }
  stake.onchange=update;
  for(const selector of selectors)selector.onchange=update;
  submit.onclick=()=>{
    const amount=Number(stake.value);
    const chosen=selectors.map(s=>Number(s.value));
    if(available&&remain<=0&&(info.rates??[]).includes(amount)&&
       state.character.money>=amount&&chosen.length===6&&
       chosen.every(x=>Number.isInteger(x)&&x>=0&&x<=9))
      submitInstantLoto(amount,chosen);
  };
  update();
  const history=el("arcade-loto-history");history.replaceChildren();
  const rounds=info.history??[],latest=rounds[0];
  text("arcade-loto-result",latest?
    "最近開獎："+latest.chosenDigits.join("")+"／"+
    latest.drawnDigits.join("")+"，符合 "+
    latest.matches+" 位，發還 "+money(latest.gross)+
    "（淨"+(latest.delta>=0?"+":"−")+money(Math.abs(latest.delta))+"）":
    "尚無本人六位數樂透紀錄。");
  if(!rounds.length){
    const p=document.createElement("p");p.className="small";
    p.textContent="尚未進行即時樂透。";history.append(p);
  }else{
    const list=document.createElement("ol");list.className="health-event-list";
    for(const round of rounds){
      const item=document.createElement("li");
      item.textContent=new Date(round.playedAt).toLocaleString("zh-TW")+
        "｜選 "+round.chosenDigits.join("")+
        "／開 "+round.drawnDigits.join("")+
        "｜符合"+round.matches+"位／"+round.multiplier+"倍"+
        "｜下注 "+money(round.stake)+
        "，淨"+(round.delta>=0?"+":"−")+money(Math.abs(round.delta));
      list.append(item);
    }
    history.append(list);
  }
}

let pendingArcadeDonut=null;
let arcadeDonutSubmitting=false;
async function submitArcadeDonut(mode,risk,winAmount,reference){
  if(arcadeDonutSubmitting)return;
  const label=mode==="donus"?"不同點數×1萬元":
    mode==="donus2"?"不同點數×2萬元":"相同點數×10萬元";
  if(!window.confirm("確認在「"+label+"」抽牌嗎？前一張 "+
      (reference===null?"尚未設定":reference+"點")+
      "；猜中最多獲得 "+money(winAmount)+
      "，猜錯扣除 "+money(risk)+"。伺服器會即時依真正共用牌桌計算。"))return;
  if(!pendingArcadeDonut||pendingArcadeDonut.mode!==mode)
    pendingArcadeDonut={mode,requestId:crypto.randomUUID()};
  arcadeDonutSubmitting=true;
  el("arcade-donuts-submit").disabled=true;
  try{
    state=await api("arcade/donuts/draw",{
      mode,requestId:pendingArcadeDonut.requestId
    });
    const result=state.arcadeDonutResult;
    pendingArcadeDonut=null;
    render();
    notify(result.replayed?"這局抽牌已結算，沒有重複扣款或發獎。":
      "原版抽牌 "+result.mode+"：前一張 "+
      (result.previousCard??"空（首次以原版起始值比較）")+
      "，抽中 "+result.drawnCard+" 點。"+
      (result.won?"獲得 ":"扣除 ")+money(Math.abs(result.delta))+
      "；牌桌目前 "+result.cardsAfter+" 張牌。");
  }catch(error){notify(error.message,true);}
  finally{
    arcadeDonutSubmitting=false;
    if(state?.character)renderArcadeDonuts();
  }
}
function renderArcadeDonuts(){
  if(!state?.character)return;
  const info=state.arcadeDonuts??{};
  const modes=info.modes??[];
  const selector=el("arcade-donuts-mode");
  const selected=modes.find(item=>item.mode===selector.value)??modes[0];
  selector.disabled=modes.length===0;
  selector.onchange=renderArcadeDonuts;
  const submit=el("arcade-donuts-submit"),history=el("arcade-donuts-history");
  if(!selected){
    text("arcade-donuts-status","原版卡牌模式尚未載入。");
    text("arcade-donuts-table","");
    text("arcade-donuts-quote","");
    text("arcade-donuts-result","");
    submit.disabled=true;history.replaceChildren();return;
  }
  const available=info.available===true;
  const wait=Math.max(0,(selected.readyAt??0)-browserGameNow());
  const affordable=Number.isSafeInteger(selected.risk)&&
    state.character.money>=selected.risk;
  text("arcade-donuts-status",!available?
    "所在城鎮沒有「ゲーセン」遊樂中心；須先建立原版建築。":
    wait>0?"目前模式冷卻中，還需 "+Math.ceil(wait/1000)+" 秒（單機可快轉時間）。":
      "這個模式已可抽牌。三個模式牌桌獨立，帳戶本人交易記錄隔離。");
  const initialReference=selected.rule==="same"?1:0;
  text("arcade-donuts-table","前一張："+(selected.previousCard===null?
      "未設定（首次比較"+initialReference+"點）":selected.previousCard+"點")+
    "｜桌上累積 "+selected.cardCount+" 張｜抽牌範圍 1～"+
    selected.faces+"點｜最近牌面 "+selected.recentCards.join("、")+
    (selected.cardCount>20?"（僅展示最近20張）":""));
  const rule=selected.rule==="same"?"與前卡相同才中獎":"與前卡不同才中獎";
  text("arcade-donuts-quote",rule+
    "｜中獎收入 "+money(selected.winAmount)+
    "｜未中扣除 "+money(selected.risk)+
    "｜目前現金 "+money(state.character.money)+
    (!affordable?"｜現金不足":"")+
    (selected.mode==="donus"?"｜Web單機5秒限制":"｜10分鐘限制"));
  submit.disabled=arcadeDonutSubmitting||!available||wait>0||!affordable;
  submit.onclick=()=>{
    if(!arcadeDonutSubmitting&&available&&wait<=0&&affordable)
      submitArcadeDonut(selected.mode,selected.risk,selected.winAmount,
        selected.previousCard);
  };
  const rounds=selected.history??[];
  const recent=rounds[0];
  text("arcade-donuts-result",recent?
    "最近一局：前卡 "+(recent.previousCard??"未設定")+
    "、抽到 "+recent.drawnCard+"，"+
    (recent.won?"獲勝 +":"失敗 −")+money(Math.abs(recent.delta)):
    "本人還沒有此模式的抽牌紀錄。");
  history.replaceChildren();
  if(!rounds.length){
    const p=document.createElement("p");p.className="small";
    p.textContent="尚無抽牌紀錄。";history.append(p);return;
  }
  const list=document.createElement("ol");list.className="health-event-list";
  for(const round of rounds){
    const li=document.createElement("li");
    li.textContent=new Date(round.playedAt).toLocaleString("zh-TW")+
      "｜前卡 "+(round.previousCard??"空")+" → "+round.drawnCard+
      "｜"+(round.won?"勝 +":"敗 −")+money(Math.abs(round.delta))+
      "｜桌上 "+round.cardsAfter+" 張";
    list.append(li);
  }
  history.append(list);
}

let pendingArcadeHighLow=null;
let arcadeHighLowSubmitting=false;
async function submitArcadeHighLow(guess,stake,previousCard){
  const direction=guess==="hi"?"高":"低";
  const comparison=previousCard===null?"原版首次未設定的前卡（比較為0）":String(previousCard);
  if(arcadeHighLowSubmitting)return;
  if(!window.confirm("這局選擇比 "+comparison+" 更"+direction+
      "，即將抽1～5點牌。桌面基本輸贏 "+money(stake)+
      "；若與前卡相同則依原版設定獲勝且獎金雙倍。確認要玩嗎？"))return;
  if(!pendingArcadeHighLow||pendingArcadeHighLow.guess!==guess)
    pendingArcadeHighLow={guess,requestId:crypto.randomUUID()};
  arcadeHighLowSubmitting=true;
  el("arcade-highlow-submit").disabled=true;
  try{
    state=await api("arcade/highlow/play",{
      guess,requestId:pendingArcadeHighLow.requestId
    });
    const result=state.arcadeHighLowResult;
    pendingArcadeHighLow=null;
    render();
    notify(result.replayed?"這局 High／Low 已結算，沒有重複扣款或領獎。":
      "High／Low 抽到 "+result.drawnCard+" 點（前卡 "+
      (result.previousCard??"未設定，數值比較0")+"）；"+
      (result.tie?"同點數雙倍！":"")+
      (result.won?"獲得 ":"扣除 ")+money(Math.abs(result.delta))+
      "；桌面目前 "+result.cardsAfter+" 張牌。");
  }catch(error){notify(error.message,true);}
  finally{
    arcadeHighLowSubmitting=false;
    if(state?.character)renderArcadeHighLow();
  }
}
function renderArcadeHighLow(){
  if(!state?.character)return;
  const info=state.arcadeHighLow??{};
  const available=info.available===true;
  const wait=Math.max(0,(info.readyAt??0)-browserGameNow());
  const stake=info.stake??0;
  const enough=Number.isSafeInteger(stake)&&stake>0&&state.character.money>=stake;
  text("arcade-highlow-status",!available?
    "目前城鎮沒有「ゲーセン」遊樂中心；可使用單機地圖編輯器放置。":
    wait>0?"High／Low 冷卻中，還有 "+Math.ceil(wait/1000)+" 秒（單機可快轉時間）。":
      "High／Low 可進行下一局，牌桌與其他帳號共用。");
  const previous=info.previousCard;
  text("arcade-highlow-table","前一張："+(previous===null?"未設定（原版首次比較值0）":previous+"點")+
    "｜累積 "+(info.cardCount??0)+" 張｜最近牌面 "+
    (info.recentCards?.join("、")??"")+
    ((info.cardCount??0)>20?"（只顯示最後20張）":""));
  const guess=el("arcade-highlow-guess"),submit=el("arcade-highlow-submit");
  function update(){
    text("arcade-highlow-quote","本局基本輸贏 "+money(stake)+
      "｜同點數獲勝 +"+money(stake*(info.tieMultiplier??2))+
      "｜目前現金 "+money(state.character.money)+
      (!enough?"｜現金不足":""));
    submit.disabled=arcadeHighLowSubmitting||!available||wait>0||!enough;
  }
  guess.onchange=update;
  submit.onclick=()=>{
    if(["hi","low"].includes(guess.value)&&available&&wait<=0&&enough)
      submitArcadeHighLow(guess.value,stake,previous);
  };
  update();
  const history=el("arcade-highlow-history");history.replaceChildren();
  const rounds=info.history??[];
  const newest=rounds[0];
  text("arcade-highlow-result",newest?
    "最近一次：前卡 "+(newest.previousCard??"未設定")+"、抽到 "+
    newest.drawnCard+"，"+(newest.won?"獲勝 +":"失敗 −")+
    money(Math.abs(newest.delta)):"尚未玩過 High／Low。");
  if(!rounds.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent="目前沒有本人 High／Low 對局。";history.append(empty);
  }else{
    const list=document.createElement("ol");list.className="health-event-list";
    for(const round of rounds){
      const li=document.createElement("li");
      li.textContent=new Date(round.playedAt).toLocaleString("zh-TW")+
        "｜猜"+(round.guess==="hi"?"高":"低")+
        "，前卡 "+(round.previousCard??"未設定")+" → "+round.drawnCard+
        "｜"+(round.tie?"同點數雙倍勝利":round.won?"勝":"敗")+
        " "+(round.won?"+":"−")+money(Math.abs(round.delta))+
        "｜累積 "+round.cardsAfter+" 張";
      list.append(li);
    }
    history.append(list);
  }
}

let pendingArcadeDice=null;
let arcadeDiceSubmitting=false;
async function submitArcadeDice(guess,stake){
  if(arcadeDiceSubmitting)return;
  if(!window.confirm("確認下注 "+money(stake)+"，猜兩顆骰子總和是"+
      (guess==="even"?"偶數":"奇數")+"嗎？猜中增加下注額，猜錯扣除同額。"))return;
  const key=guess+":"+stake;
  if(!pendingArcadeDice||pendingArcadeDice.key!==key)
    pendingArcadeDice={key,requestId:crypto.randomUUID()};
  arcadeDiceSubmitting=true;
  el("arcade-dice-submit").disabled=true;
  try{
    state=await api("arcade/dice/play",{
      guess,stake,requestId:pendingArcadeDice.requestId
    });
    const result=state.arcadeDiceResult;
    pendingArcadeDice=null;
    render();
    notify(result.replayed?
      "這局骰子遊戲已結算，不會重複扣款或領獎。":
      "骰子結果："+result.dieOne+" ＋ "+result.dieTwo+" ＝ "+result.total+
      "（"+(result.total%2===0?"偶數":"奇數")+"）。"+
      (result.won?"猜中了，獲得 ":"猜錯了，扣除 ")+money(result.stake)+"。");
  }catch(error){notify(error.message,true);}
  finally{
    arcadeDiceSubmitting=false;
    if(state?.character)renderArcadeDice();
  }
}
function renderArcadeDice(){
  if(!state?.character)return;
  const info=state.arcadeDice??{};
  const available=info.available===true;
  const remain=Math.max(0,(info.readyAt??0)-browserGameNow());
  text("arcade-dice-status",!available?
    "目前城鎮沒有「ゲーセン」遊樂中心；可使用單機地圖編輯器放置。":
    remain>0?"骰子遊戲冷卻中，還需 "+Math.ceil(remain/1000)+" 秒（單機可快轉遊戲時間）。":
      "遊樂中心已開放，現在可以擲骰。");
  const stake=el("arcade-dice-stake"),previous=stake.value;
  stake.replaceChildren();
  for(const amount of info.rates??[]){
    const option=document.createElement("option");
    option.value=String(amount);
    option.textContent=money(amount);
    stake.append(option);
  }
  if((info.rates??[]).some(x=>String(x)===previous))stake.value=previous;
  const guess=el("arcade-dice-guess"),submit=el("arcade-dice-submit");
  function update(){
    const amount=Number(stake.value);
    const valid=(info.rates??[]).includes(amount);
    const affordable=valid&&amount<=state.character.money;
    text("arcade-dice-quote",!valid?"請選擇原版下注額。":
      "下注 "+money(amount)+"｜猜中增加 "+money(amount)+"，猜錯扣除同額"+
      (!affordable?"｜現金不足":""));
    submit.disabled=arcadeDiceSubmitting||!available||remain>0||!affordable;
  }
  stake.onchange=update;guess.onchange=update;
  submit.onclick=()=>{
    const value=guess.value,amount=Number(stake.value);
    if((value==="odd"||value==="even")&&(info.rates??[]).includes(amount)&&
       available&&remain<=0&&amount<=state.character.money)
      submitArcadeDice(value,amount);
  };
  update();
  const history=el("arcade-dice-history");history.replaceChildren();
  const rounds=info.history??[];
  const newest=rounds[0];
  text("arcade-dice-result",newest?
    "最近一次："+newest.dieOne+" ＋ "+newest.dieTwo+" ＝ "+newest.total+
    "，"+(newest.won?"獲勝 +":"失敗 −")+money(newest.stake):"尚無擲骰紀錄。");
  if(!rounds.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent="尚未進行骰子遊戲。";history.append(empty);
  }else{
    const list=document.createElement("ol");list.className="health-event-list";
    for(const round of rounds){
      const li=document.createElement("li");
      li.textContent=new Date(round.playedAt).toLocaleString("zh-TW")+
        "｜猜"+(round.guess==="even"?"偶數":"奇數")+
        "｜"+round.dieOne+" + "+round.dieTwo+" = "+round.total+
        "｜"+(round.won?"獲勝 +":"失敗 −")+money(round.stake);
      list.append(li);
    }
    history.append(list);
  }
}

let pendingFishingAction=null;
async function submitFishingAction(actionName,payload,description){
  if(!window.confirm(description))return;
  const requestKey=actionName+":"+JSON.stringify(payload);
  if(!pendingFishingAction||pendingFishingAction.key!==requestKey)
    pendingFishingAction={key:requestKey,requestId:crypto.randomUUID()};
  const data={...payload,requestId:pendingFishingAction.requestId};
  try{
    state=await api("fishing/"+actionName,data);
    const result=state.fishingResult;
    pendingFishingAction=null;
    render();
    if(result.replayed){notify("這筆釣魚交易已完成，沒有重複扣款、扣餌或領獎。");return;}
    notify(actionName==="bait/buy"?
      "已購入「"+result.name+"」魚餌，支付 "+money(result.price)+"；商品已入本人背包。":
      actionName==="cast"?
        "已消耗「"+result.baitName+"」一回。"+
        (result.caught?"釣到「"+result.catchName+"」，漁獲已入庫！":"這次沒有釣到魚。")+
        "釣魚冷卻 100 秒。":
        "已出售「"+result.name+"」一回，競價收入 "+money(result.paid)+"。");
  }catch(error){notify(error.message,true);}
}
function renderFishing(){
  if(!state?.character)return;
  const info=state.fishing??{};
  const available=info.fishingAvailable===true;
  const shop=info.baitShopAvailable===true;
  text("fishing-status",available?
    "釣場已開放。魚可重新作餌，也可於此出售；每次都消耗一回耐久。":
    "目前城鎮尚無「釣り」釣場；可在單機地圖編輯器放置原版建築。");
  text("fishing-shop-status",shop?
    "原版餌料商店已開放：依原始標價，庫存每日依原版商品數據補充。":
    "這座城鎮尚無「販売1」餌料商店；無法購買新的魚餌。");
  const goods=el("fishing-bait-goods");
  goods.replaceChildren();
  for(const bait of info.baitGoods??[]){
    const tile=document.createElement("div");tile.className="training-tile";
    const name=document.createElement("strong");name.textContent=bait.name;
    const details=document.createElement("p");details.className="small";
    details.textContent="售價："+money(bait.price)+"｜耐久 "+bait.durability+" 回｜尚餘 "+bait.stock+" 件";
    const buy=document.createElement("button");buy.type="button";
    const canBuy=shop&&bait.stock>0&&state.character.money>=bait.price;
    buy.textContent=canBuy?"購買一件魚餌":"目前無法購買";
    buy.disabled=!canBuy;
    buy.addEventListener("click",()=>submitFishingAction("bait/buy",{
      sku:bait.sku
    },"確定依原版標價以現金 "+money(bait.price)+" 購買「"+bait.name+"」嗎？"));
    tile.append(name,details,buy);goods.append(tile);
  }
  function fillOptions(id,list){
    const select=el(id),previous=select.value;
    select.replaceChildren();
    for(const item of list){
      const option=document.createElement("option");
      option.value=String(item.sourceLine);
      option.textContent=item.name+"（可用 "+item.remaining+" 回）";
      select.append(option);
    }
    if(list.some(x=>String(x.sourceLine)===previous))select.value=previous;
    select.disabled=!available||list.length===0;
  }
  fillOptions("fishing-bait-select",info.baitOptions??[]);
  fillOptions("fishing-sell-select",info.sellOptions??[]);
  const readyAt=info.readyAt??0;
  const wait=Math.max(0,readyAt-(state.gameTimeMs??Date.now()));
  text("fishing-cooldown",!available?"釣場未開放。":
    wait>0?"釣魚冷卻中，尚需約 "+Math.ceil(wait/1000)+" 秒；可使用單機時間快轉。":
    "現在可以釣魚。成功或失敗都會扣掉一回魚餌，並進入 100 秒冷卻。");
  const cast=el("fishing-cast"),sell=el("fishing-sell");
  cast.disabled=!available||wait>0||!(info.baitOptions?.length);
  sell.disabled=!available||!(info.sellOptions?.length);
  cast.onclick=()=>{
    const line=Number(el("fishing-bait-select").value);
    const bait=info.baitOptions?.find(x=>x.sourceLine===line);
    if(bait)submitFishingAction("cast",{sourceLine:line},
      "使用「"+bait.name+"」釣魚一次？不論有沒有釣到魚，都會消耗一回耐久。");
  };
  sell.onclick=()=>{
    const line=Number(el("fishing-sell-select").value);
    const catchItem=info.sellOptions?.find(x=>x.sourceLine===line);
    if(catchItem)submitFishingAction("sell",{sourceLine:line},
      "確定在原版競價市場出售「"+catchItem.name+"」一回？成交價格依原版範圍隨機決定。");
  };
  const history=el("fishing-history");history.replaceChildren();
  const items=info.history??[];
  if(!items.length){
    const p=document.createElement("p");p.className="small";
    p.textContent="尚未有購餌、釣魚或魚獲出售紀錄。";history.append(p);
  }else{
    const list=document.createElement("ol");list.className="health-event-list";
    for(const item of items){
      const li=document.createElement("li");
      const label=item.action==="buy"?
        "買餌："+item.name+"（"+money(item.price)+"）":
        item.action==="cast"?
          "釣魚："+item.baitName+" → "+(item.caught?"釣到 "+item.catchName:"未中魚"):
          "賣魚："+item.name+"（收入 "+money(item.paid)+"）";
      li.textContent=new Date(item.createdAt).toLocaleString("zh-TW")+"｜"+label;
      list.append(li);
    }
    history.append(list);
  }
}

let pendingCraftingAction=null;
async function submitCrafting(recipe,quantity){
  if(!window.confirm("使用本人實際材料合成「"+recipe.name+"」共 "+quantity+
    " 組？材料會扣除，成品將增加 "+(recipe.durability*quantity)+" 回耐久；手續費 0 元。"))return;
  const key=recipe.key+":"+quantity;
  if(!pendingCraftingAction||pendingCraftingAction.key!==key)
    pendingCraftingAction={key,requestId:crypto.randomUUID()};
  try{
    state=await api("crafting/make",{
      recipeKey:recipe.key,quantity,requestId:pendingCraftingAction.requestId
    });
    const result=state.craftingResult;
    pendingCraftingAction=null;
    render();
    notify(result.replayed?
      "這筆合成已經完成，不會重複扣材料或增加成品。":
      "合成完成：「"+result.name+"」"+result.quantity+" 組，共增加 "+
        result.addedDurability+" 回耐久，已入本人背包。");
  }catch(error){notify(error.message,true);}
}
function renderCrafting(){
  if(!state?.character)return;
  const info=state.crafting??{};
  text("crafting-status",info.available?
    "合成屋已開放。僅能使用本人持有材料，製作手續費為 0 元。":
    "目前城鎮沒有「合成」建築；可在單機地圖編輯器放置原版合成屋。");
  const recipes=info.recipes??[];
  const list=el("crafting-recipes");list.replaceChildren();
  for(const recipe of recipes){
    const tile=document.createElement("article");tile.className="training-tile";
    const title=document.createElement("strong");
    title.textContent=recipe.name+"（"+recipe.category+"，每組 "+recipe.durability+" 回）";
    const materials=document.createElement("p");materials.className="small";
    materials.textContent="需要："+recipe.ingredients.map(i=>i.name+" "+i.quantity+
      " 回（持有 "+i.owned+" 回）").join("＋");
    const count=document.createElement("p");count.className="small";
    count.textContent="最多可製作 "+recipe.maxBatches+" 組"+
      (recipe.sourceAnomaly?"｜原始配方多餘冒號已依 Perl 實際解析方式處理":"");
    tile.append(title,materials,count);list.append(tile);
  }
  const select=el("crafting-select"),previous=select.value;
  select.replaceChildren();
  for(const recipe of recipes){
    const option=document.createElement("option");
    option.value=recipe.key;
    option.textContent=recipe.name+"（可製作 "+recipe.maxBatches+" 組）";
    option.disabled=recipe.maxBatches===0;
    select.append(option);
  }
  const available=recipes.filter(x=>x.maxBatches>0);
  if(available.length){
    select.value=available.some(r=>r.key===previous)?previous:available[0].key;
  }
  select.disabled=!info.available||!available.length;
  const qty=el("crafting-quantity"),submit=el("crafting-submit");
  function update(){
    const recipe=recipes.find(x=>x.key===select.value);
    const max=recipe?.maxBatches??0;
    qty.max=String(max||1);
    const current=Number(qty.value);
    if(!Number.isSafeInteger(current)||current<1||current>max)
      qty.value="1";
    qty.disabled=!info.available||max===0;
    submit.disabled=!info.available||max===0;
  }
  select.onchange=update;
  qty.onchange=update;
  submit.onclick=()=>{
    const recipe=recipes.find(x=>x.key===select.value);
    const quantity=Number(qty.value);
    if(recipe&&Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=recipe.maxBatches)
      submitCrafting(recipe,quantity);
  };
  update();
  const history=el("crafting-history");history.replaceChildren();
  if(!info.history?.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent="尚無合成紀錄。";history.append(empty);
  }else{
    const ordered=document.createElement("ol");ordered.className="health-event-list";
    for(const item of info.history){
      const li=document.createElement("li");
      li.textContent=new Date(item.createdAt).toLocaleString("zh-TW")+
        "｜"+item.name+" × "+item.quantity+"（新增 "+item.addedDurability+" 回）";
      ordered.append(li);
    }
    history.append(ordered);
  }
}

function renderRetail(){
  if(!state?.character)return;
  const choices=state.retailAvailable??[];
  const select=el("retail-shop-select");
  for(const option of select.options)option.disabled=!choices.includes(option.value);
  if(!choices.includes(select.value))select.value=choices[0]??"depart1";
  const shop=select.value;
  const search=el("retail-search").value.trim().toLocaleLowerCase("zh-TW");
  const goods=(state.retailGoods??[]).filter(item=>item.shop===shop&&
    (item.name.toLocaleLowerCase("zh-TW").includes(search)||
     displayRetailItemName(item.name).toLocaleLowerCase("zh-TW").includes(search)||
     item.category.toLocaleLowerCase("zh-TW").includes(search)||
     displayRetailItemCategory(item.category).toLocaleLowerCase("zh-TW").includes(search)));
  text("retail-status",!choices.length?
    "目前城鎮沒有已配置的百貨店。請先在地圖中找到百貨店，單機模式可配置原版建築代碼。" :
    !choices.includes(shop)?"這間百貨店不在目前城鎮。" :
    (state.retailDay??"今日")+"｜符合搜尋的商品 "+goods.length+
    " 種。請先選擇商品再統一結帳；每筆可買 1～5 件，一般持有上限 25 格、購入禮品 10 格。");
  renderShopTable(el("retail-items"),goods,{
    shopName:shop,
    onPurchase:submitRetailPurchase,
    emptyText:choices.length?"目前沒有符合條件的上架商品。":"尚無可進入的百貨店。"
  });
  const receipts=el("retail-purchases");
  receipts.replaceChildren();
  const list=document.createElement("ol");list.className="health-event-list";
  for(const purchase of (state.retailPurchases??[]).filter(x=>x.shop!=="vending")){
    const line=document.createElement("li");
    line.textContent=new Date(purchase.createdAt).toLocaleString("zh-TW")+
      "｜"+(purchase.shop==="depart2"?"百貨二":"百貨一")+"｜"+displayRetailItemName(purchase.name)+
      " ×"+purchase.quantity+"｜"+(purchase.payment==="bank"?"信用卡／普通存款":"現金")+
      "支付 "+money(purchase.paid)+
      (purchase.merged?"｜已合併耐久":"")+
      "｜目前對應持有物耐久 "+(purchase.remaining??"?")+(purchase.unit??"");
    list.append(line);
  }
  if(!list.childElementCount){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent="尚無百貨店購物紀錄。";
    receipts.append(empty);
  }else receipts.append(list);
}


let pendingVendingPurchase=null;
async function submitVendingPurchase(item,quantity,payment,cardSourceLine){
  const total=item.price*quantity;
  const method=payment==="bank"?"普通銀行存款（有效信用卡）":"現金";
  if(!window.confirm("確定在自動販賣機以"+method+"支付 "+money(total)+
     "，購買「"+displayVendingName(item.name)+"」×"+quantity+" 嗎？"))return;
  if(!pendingVendingPurchase||pendingVendingPurchase.sku!==item.sku||
     pendingVendingPurchase.quantity!==quantity||
     pendingVendingPurchase.payment!==payment||
     pendingVendingPurchase.cardSourceLine!==cardSourceLine){
    pendingVendingPurchase={shop:"vending",sku:item.sku,quantity,payment,
      ...(payment==="bank"?{cardSourceLine}:{}),
      requestId:crypto.randomUUID()};
  }
  try{
    state=await api("retail/buy",pendingVendingPurchase);
    const result=state.retailResult;
    pendingVendingPurchase=null;
    render();
    notify(result.replayed?"自動販賣機的這筆購物已完成，沒有重複扣款。":
      "已在自動販賣機買入「"+displayVendingName(result.name)+"」×"+result.quantity+
      "，"+(payment==="bank"?"普通銀行存款":"現金")+"支付 "+money(result.paid)+
      (result.merged?"；同品耐久已合併。":"；物品已入庫。"));
  }catch(error){notify(error.message,true);}
}
function renderVending(){
  if(!state?.character)return;
  const available=state.vendingAvailable===true;
  const goods=available?(state.vendingGoods??[]):[];
  text("vending-status",!available?
    "所在城鎮沒有原版自動販賣機。請在地圖中找到「自販機」，單機模式可先配置該建築。" :
    "本期貨架："+(state.vendingPeriod??"尚未初始化")+
    "（當地中午 12 點刷新）｜"+goods.length+
    " 種飲料，均為自販機原始標價，不乘三。所有玩家共用庫存。");
  renderShopTable(el("vending-items"),goods,{
    shopName:"自動販賣機",
    onPurchase:submitVendingPurchase,
    emptyText:available?"本期沒有可售飲料。":"請先進入城鎮中的自動販賣機。"
  });
  const history=el("vending-purchases");
  history.replaceChildren();
  const list=document.createElement("ol");
  list.className="health-event-list";
  for(const entry of (state.retailPurchases??[]).filter(x=>x.shop==="vending")){
    const line=document.createElement("li");
    line.textContent=new Date(entry.createdAt).toLocaleString("zh-TW")+
      "｜"+displayVendingName(entry.name)+" ×"+entry.quantity+"｜"+
      (entry.payment==="bank"?"信用卡／普通存款":"現金")+"支付 "+money(entry.paid)+
      (entry.merged?"｜已合併耐久":"")+
      "｜目前對應持有物耐久 "+(entry.remaining??"?")+(entry.unit??"");
    list.append(line);
  }
  if(list.childElementCount)history.append(list);
  else{
    const note=document.createElement("p");
    note.className="small";
    note.textContent="尚無自動販賣機購物紀錄。";
    history.append(note);
  }
}


let pendingEquipmentAction=null;
async function submitEquipmentAction(action,{sku,itemId,name,amount,powerUp=0,usesUp=0}){
  const captions={buy:"購買",equip:"裝備",sell:"出售",forge:"鍛造"};
  if(!Object.hasOwn(captions,action))return;
  const moneyText=(action==="buy"||action==="forge")?"支付 "+money(-amount):
    action==="sell"?"收入 "+money(amount):"把同類原裝備退回倉庫";
  if(!window.confirm("確定"+captions[action]+"「"+displayEquipmentName(name)+"」嗎？"+
    "（"+moneyText+"）"))return;
  if(!pendingEquipmentAction||pendingEquipmentAction.action!==action||
     pendingEquipmentAction.sku!==sku||pendingEquipmentAction.itemId!==itemId)
    pendingEquipmentAction={action,sku,itemId,requestId:crypto.randomUUID()};
  const payload=action==="buy"?
    {sku,requestId:pendingEquipmentAction.requestId}:
    action==="forge"?
      {itemId,powerUp,usesUp,requestId:pendingEquipmentAction.requestId}:
      {itemId,requestId:pendingEquipmentAction.requestId};
  try{
    state=await api("equipment/"+action,payload);
    const result=state.equipmentResult;
    pendingEquipmentAction=null;
    render();
    notify(result.replayed?"這筆裝備交易已處理，沒有重複扣款或變更裝備。":
      "已"+captions[action]+"「"+displayEquipmentName(result.name)+"」。"+
      ((action==="buy"||action==="forge")?"從現金扣除 "+money(-result.amount):
        action==="sell"?"現金增加 "+money(result.amount):"同類原裝備已退回倉庫。"));
  }catch(error){notify(error.message,true);}
}
function renderEquipment(){
  if(!state?.character)return;
  const available=state.equipmentAvailable===true;
  text("equipment-status",available?
    "目前城鎮裝備屋營業中｜獨立原價商品 "+(state.equipmentGoods??[]).length+
    " 種；可購買、換裝、出售及按原版費用鍛造，暫不提供戰鬥效果。" :
    "目前城鎮沒有原版「装備屋」。請在地圖中找到該建築，單機模式可先配置。");
  const goodsTarget=el("equipment-goods");
  goodsTarget.replaceChildren();
  const owned=state.equipmentItems??[];
  for(const item of state.equipmentGoods??[]){
    const tile=document.createElement("div");tile.className="training-tile";
    const heading=document.createElement("strong");
    heading.textContent=displayEquipmentName(item.name)+"｜"+displayEquipmentCategory(item.category);
    const note=document.createElement("p");note.className="small";
    note.textContent="威力 "+item.power+"｜命中 "+item.accuracy+"%｜可使用 "+item.uses+
      " 次｜售價 "+money(item.price);
    const button=document.createElement("button");button.type="button";
    const duplicate=owned.some(x=>x.name===item.name);
    const affordable=state.character.money>item.price;
    button.disabled=!available||duplicate||!affordable;
    button.textContent=duplicate?"已持有／已裝備":!affordable?"現金不足":"購買並存入倉庫";
    button.addEventListener("click",()=>submitEquipmentAction("buy",{
      sku:item.sku,itemId:null,name:item.name,amount:-item.price
    }));
    tile.append(heading,note,button);
    goodsTarget.append(tile);
  }
  if(!available){
    const note=document.createElement("p");note.className="small";
    note.textContent="此地沒有裝備屋，無法購買；已有的本人裝備清單仍可查看。";
    goodsTarget.append(note);
  }
  const warehouse=el("equipment-inventory");
  warehouse.replaceChildren();
  for(const item of owned){
    const tile=document.createElement("div");tile.className="training-tile";
    const title=document.createElement("strong");
    title.textContent=displayEquipmentName(item.name)+"｜"+displayEquipmentCategory(item.category)+"｜"+
      (item.status==="equipped"?"已裝備":"倉庫");
    const note=document.createElement("p");note.className="small";
    note.textContent="威力 "+item.power+"｜命中 "+item.accuracy+"%｜剩餘使用 "+item.uses+
      " 次｜等級 "+item.level+"｜經驗 "+item.experience;
    tile.append(title,note);
    if(item.status==="stored"&&available){
      const buttons=document.createElement("div");buttons.className="filters";
      const wear=document.createElement("button");
      wear.type="button";wear.textContent="裝備";
      wear.addEventListener("click",()=>submitEquipmentAction("equip",{
        sku:"item-"+item.id,itemId:item.id,name:item.name,amount:0
      }));
      const sell=document.createElement("button");
      sell.type="button";sell.className="secondary";sell.textContent="出售";
      const price=(state.equipmentGoods??[]).find(x=>x.sku===item.sku)?.price;
      const credit=Number.isSafeInteger(price)?Math.floor(price*item.level/10):null;
      sell.disabled=credit===null;
      sell.addEventListener("click",()=>submitEquipmentAction("sell",{
        sku:"item-"+item.id,itemId:item.id,name:item.name,amount:credit
      }));
      buttons.append(wear,sell);tile.append(buttons);
    }
    if(available){
      const forge=document.createElement("div");
      forge.className="filters";
      const choices=[0,1,3,5,10,15,25,50];
      function selector(label){
        const wrapper=document.createElement("label");
        wrapper.textContent=label;
        const input=document.createElement("select");
        input.setAttribute("aria-label",displayEquipmentName(item.name)+"鍛造"+label);
        for(const count of choices){
          const option=document.createElement("option");
          option.value=String(count);
          option.textContent=count?"＋"+count:"不增加";
          input.append(option);
        }
        wrapper.append(input);
        forge.append(wrapper);
        return input;
      }
      const power=selector("威力");
      const uses=selector("使用次數");
      const quote=document.createElement("p");
      quote.className="small";
      const button=document.createElement("button");
      button.type="button";
      const update=()=>{
        const p=Number(power.value),u=Number(uses.value);
        const cost=p*10000+u*1000;
        const tooHigh=item.power+p>1000000||item.uses+u>1000000;
        quote.textContent="鍛造費 "+money(cost)+
          (cost>state.character.money?"｜現金不足":tooHigh?"｜超過安全屬性上限":"");
        button.disabled=(!p&&!u)||cost>state.character.money||tooHigh;
        button.textContent="鍛造";
      };
      power.addEventListener("change",update);
      uses.addEventListener("change",update);
      button.addEventListener("click",()=>{
        const powerUp=Number(power.value),usesUp=Number(uses.value);
        submitEquipmentAction("forge",{
          sku:"item-"+item.id+"-power-"+powerUp+"-uses-"+usesUp,
          itemId:item.id,name:item.name,powerUp,usesUp,
          amount:-(powerUp*10000+usesUp*1000)
        });
      });
      update();
      forge.append(quote,button);
      tile.append(forge);
    }
    warehouse.append(tile);
  }
  if(!owned.length){
    const note=document.createElement("p");note.className="small";
    note.textContent="本人尚無從 Web 裝備屋購入的裝備；原版 7 欄倉庫舊檔尚未匯入此處。";
    warehouse.append(note);
  }
  const history=el("equipment-history");
  history.replaceChildren();
  const list=document.createElement("ol");list.className="health-event-list";
  for(const tx of state.equipmentTransactions??[]){
    const row=document.createElement("li");
    const label={buy:"購買",equip:"換裝",sell:"出售",forge:"鍛造"}[tx.action]??tx.action;
    row.textContent=new Date(tx.createdAt).toLocaleString("zh-TW")+"｜"+
      label+"｜"+displayEquipmentName(tx.name)+"｜"+
      (tx.amount<0?"現金支出 "+money(-tx.amount):
       tx.amount>0?"現金收入 "+money(tx.amount):"無金額變動");
    list.append(row);
  }
  if(list.childElementCount)history.append(list);
  else{
    const note=document.createElement("p");note.className="small";
    note.textContent="尚無裝備交易紀錄。";
    history.append(note);
  }
}


let pendingGiftAction=null;
async function submitGiftAction(action,{sourceLine,quantity,recipientName,name,message}){
  const converted=action==="convert";
  if(!converted&&action!=="send")return;
  if(!window.confirm(converted?
    "確定支付 50,000 元，將「"+displayRetailItemName(name)+"」的"+(quantity===0?"全部剩餘":quantity+" 份")+
    "耐久轉換成禮品嗎？":
    "確定將「"+displayRetailItemName(name)+"」的 "+quantity+" 份禮品寄給「"+recipientName+"」嗎？"))return;
  if(!pendingGiftAction||pendingGiftAction.action!==action||
     pendingGiftAction.sourceLine!==sourceLine||
     pendingGiftAction.quantity!==quantity||
     pendingGiftAction.recipientName!==recipientName||
     pendingGiftAction.message!==message){
    pendingGiftAction={action,sourceLine,quantity,recipientName,message,requestId:crypto.randomUUID()};
  }
  const payload={sourceLine,quantity,requestId:pendingGiftAction.requestId};
  if(!converted){payload.recipientName=recipientName;payload.message=message;}
  try{
    state=await api("gift/"+action,payload);
    const result=state.giftResult;
    pendingGiftAction=null;
    render();
    notify(result.replayed?"禮品操作已完成，未重複改變持有物或扣款。":
      converted?"「"+displayRetailItemName(result.name)+"」已轉換成禮品，手續費 "+money(result.fee)+"。":
      "已將「"+displayRetailItemName(result.name)+"」×"+quantity+" 送給「"+recipientName+"」。");
  }catch(error){notify(error.message,true);}
}
function renderGiftShop(){
  if(!state?.character)return;
  const available=state.giftShopAvailable===true;
  text("gift-status",available?
    "目前城鎮設有禮品店，轉換每次現金 50,000 元；本人未寄送禮品及收件方收到的禮品各有 10 格限制。":
    "所在城鎮沒有原版「ギフト屋」；不能在此轉換物品，但已持有的禮品仍可寄送給其他角色。");
  const target=el("gift-sources");
  target.replaceChildren();
  for(const item of state.giftSources??[]){
    const tile=document.createElement("div");
    tile.className="training-tile";
    const heading=document.createElement("strong");
    heading.textContent=displayRetailItemName(item.name)+"｜"+displayRetailItemCategory(item.category);
    const detail=document.createElement("p");
    detail.className="small";
    detail.textContent="剩餘 "+item.quantity+item.unit+"｜物品來源 #"+item.sourceLine;
    tile.append(heading,detail);
    if(item.canConvert&&available){
      const label=document.createElement("label");
      label.textContent="轉換耐久（輸入 0 表示全部）";
      const qty=document.createElement("input");
      qty.type="number";qty.min="0";qty.max=String(item.quantity);
      qty.step="1";qty.value="0";
      label.append(qty);
      const button=document.createElement("button");
      button.type="button";
      button.textContent="支付 50,000 元轉換為禮品";
      button.disabled=state.character.money<50000;
      button.addEventListener("click",()=>{
        const count=Number(qty.value);
        if(!Number.isSafeInteger(count)||count<0||count>item.quantity){
          notify("轉換數量需為 0 或不超過剩餘耐久的正整數",true);return;
        }
        submitGiftAction("convert",{
          sourceLine:item.sourceLine,quantity:count,name:item.name
        });
      });
      tile.append(label,button);
    }
    if(item.canSend){
      const label=document.createElement("label");
      label.textContent="收件人角色名稱";
      const person=document.createElement("input");
      person.type="text";person.maxLength=40;person.placeholder="輸入對方完整角色名稱";
      label.append(person);
      const quantityLabel=document.createElement("label");
      quantityLabel.textContent="寄送份數";
      const qty=document.createElement("input");
      qty.type="number";qty.min="1";qty.max=String(item.quantity);
      qty.step="1";qty.value="1";
      quantityLabel.append(qty);
      const messageLabel=document.createElement("label");
      messageLabel.textContent="隨禮附上的站內信內容（必填）";
      const message=document.createElement("textarea");
      message.rows=2;message.maxLength=1000;
      message.placeholder="寫給收件人的訊息（最多 1,000 字）";
      message.value="送給你的禮物";
      messageLabel.append(message);
      const button=document.createElement("button");
      button.type="button";button.textContent="寄禮並寄送雙方站內信";
      button.addEventListener("click",()=>{
        const count=Number(qty.value);
        const to=person.value.trim();
        if(!to||!Number.isSafeInteger(count)||count<1||count>item.quantity||
           !message.value.trim()||message.value.length>1000){
          notify("請填寫收件人、有效份數及 1～1,000 字的信件內容",true);return;
        }
        submitGiftAction("send",{sourceLine:item.sourceLine,
          quantity:count,recipientName:to,name:item.name,message:message.value.trim()});
      });
      tile.append(label,quantityLabel,messageLabel,button);
    }
    target.append(tile);
  }
  if(!target.childElementCount){
    const note=document.createElement("p");note.className="small";
    note.textContent="尚無可安全轉換或寄送的本人 Web 物品；原版匯入的 33 欄封存不會直接改寫。";
    target.append(note);
  }
  const history=el("gift-events");
  history.replaceChildren();
  const list=document.createElement("ol");list.className="health-event-list";
  for(const event of state.giftEvents??[]){
    const line=document.createElement("li");
    line.textContent=new Date(event.createdAt).toLocaleString("zh-TW")+"｜"+
      (event.action==="convert"?"轉換禮品":"寄送給 "+(event.recipientName??"收件人"))+
      "｜"+event.name+" ×"+(event.quantity||"全部")+
      (event.fee?"｜手續費 "+money(event.fee):"");
    list.append(line);
  }
  if(list.childElementCount)history.append(list);
  else{
    const note=document.createElement("p");note.className="small";
    note.textContent="尚無禮品轉換與寄送紀錄。";
    history.append(note);
  }
}

let pendingMailAction=null;
async function submitPrivateMail(recipientName,message){
  if(!pendingMailAction||pendingMailAction.recipientName!==recipientName||
     pendingMailAction.message!==message)
    pendingMailAction={recipientName,message,requestId:crypto.randomUUID()};
  try{
    state=await api("mail/send",pendingMailAction);
    const result=state.mailResult;
    pendingMailAction=null;
    el("mail-compose").reset();
    render();
    notify(result.replayed?"郵件已送達，沒有重複寄送。":
      "已寄送私人站內信給「"+result.recipientName+"」。");
  }catch(error){notify(error.message,true);}
}
async function deleteMailboxMessage(mailId){
  if(!Number.isSafeInteger(mailId)||mailId<1)return;
  if(!window.confirm("確定刪除這封自己信箱內的信件嗎？對方的副本不會受影響。"))return;
  try{
    state=await api("mail/delete",{mailId});
    render();
    notify("已刪除自己的信件。");
  }catch(error){notify(error.message,true);}
}
function renderMailbox(){
  if(!state?.character)return;
  const mails=state.mailbox??[];
  text("mail-status","目前保留 "+mails.length+"／50 封郵件，收／寄、純文字與寄禮信共用上限。");
  const mailbox=el("mail-messages");
  mailbox.replaceChildren();
  if(mails.length){
    const entries=document.createElement("ol");entries.className="health-event-list";
    for(const mail of mails){
      const item=document.createElement("li");
      const heading=document.createElement("strong");
      heading.textContent=(mail.direction==="inbox"?"收件｜來自 ":"寄件｜寄給 ")+
        mail.otherName+"｜"+new Date(mail.createdAt).toLocaleString("zh-TW");
      const body=document.createElement("p");body.className="small";
      body.textContent=mail.message;
      item.append(heading,body);
      if(mail.type==="gift"&&mail.giftName){
        const gift=document.createElement("p");gift.className="small";
        gift.textContent="禮品：「"+mail.giftName+"」×"+mail.quantity+" 回（日）";
        item.append(gift);
      }
      const remove=document.createElement("button");
      remove.type="button";remove.textContent="刪除這封信";
      remove.addEventListener("click",()=>deleteMailboxMessage(mail.id));
      item.append(remove);
      entries.append(item);
    }
    mailbox.append(entries);
  }else{
    const note=document.createElement("p");note.className="small";
    note.textContent="信箱目前沒有收件或寄件紀錄。";
    mailbox.append(note);
  }

}


let pendingRecycleAction=null;
async function submitRecycleAction(action,{sourceLine,listingId,name,price}){
  if(!["sell","buy"].includes(action))return;
  if(!window.confirm((action==="sell"?"確定回收出售「":"確定購買二手商品「")+
    displayRetailItemName(name)+"」嗎？"+(action==="sell"?"預計得到 ":"需支付 ")+money(price)))return;
  const id=action==="sell"?sourceLine:listingId;
  if(!pendingRecycleAction||pendingRecycleAction.action!==action||
    pendingRecycleAction.id!==id)
    pendingRecycleAction={action,id,requestId:crypto.randomUUID()};
  const requestId=pendingRecycleAction.requestId;
  const body=action==="sell"?{sourceLine,requestId}:{listingId,requestId};
  try{
    state=await api("recycle/"+action,body);
    const result=state.recycleResult;
    pendingRecycleAction=null;
    render();
    notify(result.replayed?"回收交易已處理，沒有重複改變資產。":
      (action==="sell"?"已出售「":"已購入「")+displayRetailItemName(result.name)+
      "」，"+(result.amount>=0?"現金增加 ":"現金扣除 ")+
      money(Math.abs(result.amount))+"。");
  }catch(error){notify(error.message,true);}
}
function renderRecycle(){
  if(!state?.character)return;
  const available=state.recycleAvailable===true;
  text("recycle-status",available?
    "目前城鎮設有回收商店｜貨架最多 50 筆、上架 7 天；所有玩家共用。":
    "目前城鎮沒有原版「リサイ」，只能查看本人已持有物品，不可買賣回收品。");
  const market=el("recycle-market");
  market.replaceChildren();
  for(const item of state.recycleListings??[]){
    const tile=document.createElement("div");tile.className="training-tile";
    const title=document.createElement("strong");
    title.textContent=displayRetailItemName(item.name)+"｜"+displayRetailItemCategory(item.category);
    const note=document.createElement("p");note.className="small";
    note.textContent="耐久 "+item.quantity+item.unit+"｜二手售價 "+money(item.price);
    const button=document.createElement("button");button.type="button";
    button.disabled=state.character.money<item.price;
    button.textContent=button.disabled?"現金不足":"購買二手品";
    button.addEventListener("click",()=>submitRecycleAction("buy",{
      listingId:item.id,name:item.name,price:item.price
    }));
    tile.append(title,note,button);
    market.append(tile);
  }
  if(!market.childElementCount){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent=available?"目前無人上架未過期的二手物品。":"所在城鎮沒有回收商店。";
    market.append(empty);
  }
  const sellable=el("recycle-sellable");
  sellable.replaceChildren();
  for(const item of state.recycleSellable??[]){
    const tile=document.createElement("div");tile.className="training-tile";
    const title=document.createElement("strong");
    title.textContent=displayRetailItemName(item.name)+"｜"+displayRetailItemCategory(item.category);
    const note=document.createElement("p");note.className="small";
    note.textContent="剩餘 "+item.quantity+item.unit+"｜預估回收款 "+money(item.payout);
    const button=document.createElement("button");button.type="button";
    const wait=Math.max(0,item.readyAt-(state.gameTimeMs??0));
    button.disabled=!available||!item.canSell;
    button.textContent=!available?"本城無回收商店":
      wait>0?"等待 "+Math.ceil(wait/60000)+" 分鐘":"出售整件";
    button.addEventListener("click",()=>submitRecycleAction("sell",{
      sourceLine:item.sourceLine,name:item.name,price:item.payout
    }));
    tile.append(title,note,button);
    sellable.append(tile);
  }
  if(!sellable.childElementCount){
    const note=document.createElement("p");note.className="small";
    note.textContent="目前沒有可安全出售的本人 Web 物品，原版匯入檔保持唯讀。";
    sellable.append(note);
  }
  const history=el("recycle-history");
  history.replaceChildren();
  const list=document.createElement("ol");list.className="health-event-list";
  for(const entry of state.recycleHistory??[]){
    const line=document.createElement("li");
    line.textContent=new Date(entry.createdAt).toLocaleString("zh-TW")+"｜"+
      (entry.action==="sell"?"出售":"購買")+"｜"+displayRetailItemName(entry.name)+"｜"+
      (entry.amount>=0?"現金收入 ":"現金支出 ")+money(Math.abs(entry.amount));
    list.append(line);
  }
  if(list.childElementCount)history.append(list);
  else{
    const note=document.createElement("p");note.className="small";
    note.textContent="尚無回收交易紀錄。";
    history.append(note);
  }
}


let selectedWholesaleHouseId=null;
let pendingWholesaleOrder=null;
async function submitWholesaleAction(action,{houseId,sku,name,quantity,price}){
  if(!["buy","return"].includes(action))return;
  if(!window.confirm(
    (action==="buy"?"確定從問屋進貨「":"確定把商店貨物退回問屋「")+
    displayRetailItemName(name)+"」 "+(quantity===0?"全部剩餘":quantity+" 件")+"，"+
    (action==="buy"?"從普通存款支付 ":"退回普通存款 ")+money(price)+" 嗎？"
  ))return;
  if(!pendingWholesaleOrder||
     pendingWholesaleOrder.action!==action||
     pendingWholesaleOrder.houseId!==houseId||
     pendingWholesaleOrder.sku!==sku||
     pendingWholesaleOrder.quantity!==quantity){
    pendingWholesaleOrder={action,houseId,sku,quantity,requestId:crypto.randomUUID()};
  }
  const body={houseId,sku,quantity,requestId:pendingWholesaleOrder.requestId};
  try{
    state=await api("wholesale/"+action,body);
    const result=state.wholesaleResult;
    pendingWholesaleOrder=null;
    render();
    notify(result.replayed?"這筆問屋交易已結帳，沒有重複扣款、加貨或退貨。":
      (action==="buy"?"已進貨「":"已退貨「")+displayRetailItemName(result.name)+"」×"+
      (action==="return"?(result.returned??quantity):quantity)+"，"+
      (result.amount<0?"普通存款扣除 ":"普通存款增加 ")+money(Math.abs(result.amount))+"。");
  }catch(error){notify(error.message,true);}
}
function renderWholesale(){
  if(!state?.character)return;
  const available=state.wholesaleAvailable===true;
  const houseSelect=el("wholesale-house-select");
  const category=el("wholesale-category");
  const titleInput=el("wholesale-shop-title");
  const oldCategory=category.value;
  houseSelect.replaceChildren();
  for(const house of state.houses??[]){
    const o=document.createElement("option");
    o.value=String(house.id);
    o.textContent=house.name+"（"+house.location+"）";
    houseSelect.append(o);
  }
  const houses=state.houses??[];
  if(!houses.some(h=>h.id===selectedWholesaleHouseId))
    selectedWholesaleHouseId=houses[0]?.id??null;
  houseSelect.value=selectedWholesaleHouseId===null?"":String(selectedWholesaleHouseId);
  const shop=(state.myShops??[]).find(x=>x.houseId===selectedWholesaleHouseId);
  category.replaceChildren();
  for(const kind of state.shopCategories??[]){
    const o=document.createElement("option");
    o.value=kind;o.textContent=displayRetailItemCategory(kind);
    category.append(o);
  }
  category.value=shop?.category??(
    (state.shopCategories??[]).includes(oldCategory)?oldCategory:
      (state.shopCategories??[]).find(x=>x!=="スーパー")??"");
  titleInput.value=shop?.title??"";
  el("wholesale-shop-save").disabled=!selectedWholesaleHouseId;
  text("wholesale-status",available?
    "目前城鎮設有問屋｜本期 "+(state.wholesaleGoods?.length??0)+
    " 種商品，共用庫存、來源原價、普通銀行付款（貨架按遊戲日期更新）。":
    "目前城鎮沒有「問屋」；可以先在自己的住宅配置玩家商店，但不能進貨。");
  text("wholesale-shop-summary",!houses.length?
    "你尚無住宅。必須先建立住宅，於室內配置中選「玩家商店」，再設定店鋪類別。":
    shop?"已設定「"+shop.title+"」（"+displayRetailItemCategory(shop.category)+
      "）｜店鋪倉庫 "+shop.inventory.length+"/100 種；變更類別會清除庫存。":
    "請先進入本人住宅，把至少一個室內欄位設為「玩家商店」，再於此設定店名與類別。");
  const goods=el("wholesale-goods");goods.replaceChildren();
  const search=(el("wholesale-search").value??"").trim().toLocaleLowerCase();
  const matching=(state.wholesaleGoods??[]).filter(item=>
    (!search||(item.name+" "+item.category+" "+displayRetailItemName(item.name)+" "+displayRetailItemCategory(item.category)).toLocaleLowerCase().includes(search))&&
    (!shop||shop.category==="スーパー"||
     item.category===shop.category)
  );
  for(const item of matching.slice(0,40)){
    const tile=document.createElement("div");tile.className="training-tile";
    const heading=document.createElement("strong");
    heading.textContent=displayRetailItemName(item.name)+"｜"+displayRetailItemCategory(item.category);
    const note=document.createElement("p");note.className="small";
    note.textContent="原價 "+money(item.price)+"｜本期共用庫存 "+item.stock;
    const quantityLabel=document.createElement("label");
    quantityLabel.textContent="進貨數量（1～100）";
    const quantity=document.createElement("input");
    quantity.type="number";quantity.min="1";quantity.max="100";
    quantity.step="1";quantity.value="1";quantityLabel.append(quantity);
    const quote=document.createElement("p");quote.className="small";
    const button=document.createElement("button");button.type="button";
    const update=()=>{
      const n=Number(quantity.value);
      const cost=Math.ceil(item.price*n*(shop?.category==="スーパー"?1.5:1));
      const owned=shop?.inventory.find(x=>x.sku===item.sku)?.quantity??0;
      const restricted=shop?.category==="スーパー"&&
        /専門店限定商品|秘伝商品/.test(item.note??"");
      const ok=available&&Boolean(shop)&&Number.isSafeInteger(n)&&n>=1&&
        n<=100&&n<=item.stock&&owned+n<=100&&
        Number.isSafeInteger(cost)&&cost<=state.character.bank&&!restricted;
      button.disabled=!ok;
      button.textContent=restricted?"原版專賣店限定":
        !shop?"尚未設定商店":!available?"本城無問屋":
        item.stock<=0?"庫存不足":"進貨到商店倉庫";
      quote.textContent="合計 "+money(cost)+(shop?.category==="スーパー"?"（超市×1.5）":"")+
        (owned?"｜店內既有 "+owned+" 件":"")+
        (cost>state.character.bank?"｜普通存款不足":"");
    };
    quantity.addEventListener("input",update);
    button.addEventListener("click",()=>{
      const n=Number(quantity.value);
      if(!Number.isSafeInteger(n)||n<1||n>100){notify("進貨數量需為 1～100",true);return;}
      submitWholesaleAction("buy",{
        houseId:selectedWholesaleHouseId,sku:item.sku,
        name:item.name,quantity:n,
        price:Math.ceil(item.price*n*(shop?.category==="スーパー"?1.5:1))
      });
    });
    update();tile.append(heading,note,quantityLabel,quote,button);goods.append(tile);
  }
  if(matching.length>40){
    const note=document.createElement("p");note.className="small";
    note.textContent="僅顯示前 40 筆，共 "+matching.length+" 筆符合搜尋；請輸入商品名稱縮小範圍。";
    goods.append(note);
  }
  if(!matching.length){
    const note=document.createElement("p");note.className="small";
    note.textContent=available?"目前沒有符合類別／搜尋條件的問屋商品。":"目前沒有可瀏覽的問屋貨架。";
    goods.append(note);
  }
  const warehouse=el("wholesale-inventory");warehouse.replaceChildren();
  for(const stock of shop?.inventory??[]){
    const tile=document.createElement("div");tile.className="training-tile";
    const name=document.createElement("strong");
    name.textContent=displayRetailItemName(stock.name)+"｜"+displayRetailItemCategory(stock.category);
    const note=document.createElement("p");note.className="small";
    note.textContent="店鋪庫存 "+stock.quantity+" 件｜每件進貨原價 "+money(stock.unitPrice);
    const qtyLabel=document.createElement("label");
    qtyLabel.textContent="退貨數量（0 表示全部）";
    const qty=document.createElement("input");
    qty.type="number";qty.min="0";qty.max=String(stock.quantity);
    qty.step="1";qty.value="0";qtyLabel.append(qty);
    const refund=document.createElement("p");refund.className="small";
    const button=document.createElement("button");
    button.type="button";button.textContent="退貨至普通銀行";
    const update=()=>{
      const n=Number(qty.value),moved=n===0?stock.quantity:n;
      const valid=Number.isSafeInteger(n)&&n>=0&&n<=stock.quantity;
      const total=Math.floor(moved*stock.unitPrice*
        (shop.category==="スーパー"?1.5:1)*0.75);
      button.disabled=!valid;
      refund.textContent="預估退款 "+money(total)+"（原版進貨價×75%）";
    };
    qty.addEventListener("input",update);
    button.addEventListener("click",()=>{
      const n=Number(qty.value);
      if(!Number.isSafeInteger(n)||n<0||n>stock.quantity){notify("退貨數量無效",true);return;}
      const amount=Math.floor((n||stock.quantity)*stock.unitPrice*
        (shop.category==="スーパー"?1.5:1)*0.75);
      submitWholesaleAction("return",{houseId:shop.houseId,sku:stock.sku,
        name:stock.name,quantity:n,price:amount});
    });
    update();tile.append(name,note,qtyLabel,refund,button);warehouse.append(tile);
  }
  if(!warehouse.childElementCount){
    const note=document.createElement("p");note.className="small";
    note.textContent="這間住宅商店尚無從問屋進貨的庫存。";
    warehouse.append(note);
  }
  const history=el("wholesale-history");history.replaceChildren();
  const list=document.createElement("ol");list.className="health-event-list";
  for(const entry of state.wholesaleHistory??[]){
    const line=document.createElement("li");
    line.textContent=new Date(entry.createdAt).toLocaleString("zh-TW")+"｜"+
      (entry.action==="buy"?"進貨":"退貨")+"｜"+displayRetailItemName(entry.name)+" ×"+entry.quantity+
      "｜"+(entry.amount<0?"普通存款扣除 ":"普通存款增加 ")+
      money(Math.abs(entry.amount));
    list.append(line);
  }
  if(list.childElementCount)history.append(list);
  else{
    const note=document.createElement("p");note.className="small";
    note.textContent="尚無問屋進貨或退貨紀錄。";history.append(note);
  }
}
el("wholesale-house-select").addEventListener("change",event=>{
  selectedWholesaleHouseId=Number(event.target.value);
  renderWholesale();
});
el("wholesale-category").addEventListener("change",()=>{
  // 使用者選擇分類時保存輸入，避免重新顯示庫存時自行清空商店設定。
});
el("wholesale-search").addEventListener("input",renderWholesale);
el("wholesale-shop-save").addEventListener("click",async()=>{
  const houseId=selectedWholesaleHouseId;
  const category=el("wholesale-category").value;
  const title=el("wholesale-shop-title").value.trim();
  const previous=(state.myShops??[]).find(x=>x.houseId===houseId);
  const changed=previous&&previous.category!==category&&previous.inventory.length>0;
  const confirmClear=Boolean(changed)&&window.confirm(
    "原版切換商店類別會永久清空現有的 "+previous.inventory.length+
    " 種進貨庫存且不退費。確定繼續嗎？"
  );
  if(changed&&!confirmClear)return;
  try{
    state=await api("shop/config",{houseId,category,title,confirmClear});
    render();
    notify(state.wholesaleResult.stockCleared?
      "商店類別已變更，原有貨物依原版規則清除。":"住宅商店設定已儲存。");
  }catch(error){notify(error.message,true);}
});

// 只更新課程卡片的倒數與狀態；完整課程資格仍由伺服器判斷。
let trainingTileUpdates=[];
let trainingExpiryRefreshBusy=false;
const trainingExpiryRefreshRequested=new Set();
function formatTrainingWait(ms){
  const seconds=Math.ceil(Math.max(0,ms)/1000);
  const hours=Math.floor(seconds/3600);
  return String(hours).padStart(2,"0")+":"+
    String(Math.floor((seconds%3600)/60)).padStart(2,"0")+":"+
    String(seconds%60).padStart(2,"0");
}
function schoolWaitUntilTomorrow(now){
  const character=state?.character;
  if(!character?.lastSchoolDay)return 0;
  const zone=state.gameTimeZone||"Asia/Taipei";
  const at=new Date(now);
  const today=new Intl.DateTimeFormat("en-CA",{
    timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"
  }).format(at);
  if(character.lastSchoolDay!==today)return 0;
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:zone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(at);
  const units=Object.fromEntries(parts.map(part=>[part.type,Number(part.value)]));
  return ((24-(units.hour||0))*3600-(units.minute||0)*60-(units.second||0))*1000-
    at.getMilliseconds();
}
function trainingWaits(now=browserGameNow()){
  return {
    school:Math.max(0,schoolWaitUntilTomorrow(now)),
    gym:Math.max(0,(state?.character?.gymReadyAt??0)-now),
    classroom:Math.max(0,(state?.character?.classroomReadyAt??0)-now)
  };
}
function updateTrainingCountdowns(){
  if(!state?.character||el("game").hidden)return;
  const waits=trainingWaits();
  text("school-status",waits.school>0?
    "今天已完成課程，明日重置剩餘 "+formatTrainingWait(waits.school):"今天還可以上課");
  text("gym-status",waits.gym>0?
    "距離下次訓練 "+formatTrainingWait(waits.gym):"現在可以訓練");
  text("classroom-status",waits.classroom>0?
    "距離下次教室課程 "+formatTrainingWait(waits.classroom):"目前可以上課");
  for(const update of trainingTileUpdates)update(waits);
  // 到期後重新取得後端資格判斷，避免舊快照殘留冷卻錯誤。
  const character=state.character;
  const expired=[
    [state.schoolRemainingToday&&character.lastSchoolDay&&waits.school===0,
      "school:"+character.lastSchoolDay],
    [state.gymCooldownMs>0&&character.gymReadyAt&&waits.gym===0,
      "gym:"+character.gymReadyAt],
    [state.classroomCooldownMs>0&&character.classroomReadyAt&&waits.classroom===0,
      "classroom:"+character.classroomReadyAt]
  ].find(([due,key])=>due&&!trainingExpiryRefreshRequested.has(key));
  if(expired&&!trainingExpiryRefreshBusy){
    trainingExpiryRefreshRequested.add(expired[1]);
    trainingExpiryRefreshBusy=true;
    api("state").then(fresh=>{state=fresh;render();})
      .catch(()=>{}) // 若無法連線，既有 30 秒狀態同步仍會重試。
      .finally(()=>{trainingExpiryRefreshBusy=false;});
  }
}
function renderTraining() {
  trainingTileUpdates=[];
  const oldChoices=new Map([...el("classroom-lessons").querySelectorAll("select[data-lesson-key]")]
    .map(item=>[item.dataset.lessonKey,item.value]));
  const byType = {
    school: el("school-lessons"),
    gym: el("gym-lessons"),
    classroom: el("classroom-lessons")
  };
  Object.values(byType).forEach(target => target.replaceChildren());
  const cards=state.classroomCreditCards??[];
  for (const lesson of state.trainingLessons || []) {
    const target = byType[lesson.type];
    if (!target) continue;
    const tile = document.createElement("div");
    tile.className = "training-tile";
    const name = document.createElement("strong");
    name.textContent = lesson.name;
    const cost = document.createElement("p");
    cost.className = "small";
    cost.textContent = lesson.type==="classroom"?
      "學費 "+money(lesson.price)+"，身體消耗 "+lesson.bodyCost+
      "、頭腦消耗 "+lesson.brainCost+"，體重預計減少 "+
      (lesson.weightLoss??0).toFixed(2)+" 公斤，間隔 "+
      (lesson.cooldownMs/60_000)+" 分鐘" :
      "費用 " + money(lesson.price) + "，" +
      (lesson.type === "school" ? "頭腦" : "身體") +
      "能量消耗 " + lesson.energyCost;
    const gains = document.createElement("p");
    gains.className = "small";
    const values = Object.entries(lesson.gains)
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => (labels[key] || key) + " +" + amount);
    gains.textContent = values.length ? values.join("、") : "沒有額外能力增幅";
    const submit = document.createElement("button");
    submit.type = "button";
    const blocked = document.createElement("p");
    blocked.className = "training-blocked";
    const countdown=document.createElement("p");
    countdown.className="training-countdown";
    countdown.setAttribute("role","timer");
    countdown.setAttribute("aria-live","off");
    let paymentSelect=null;
    if(lesson.type==="classroom"&&cards.length){
      const label=document.createElement("label");
      label.textContent="學費付款方式";
      paymentSelect=document.createElement("select");
      paymentSelect.dataset.lessonKey=lesson.key;
      const cash=document.createElement("option");
      cash.value="cash";
      cash.textContent="現金付款";
      paymentSelect.append(cash);
      for(const card of cards){
        const opt=document.createElement("option");
        opt.value="credit:"+card.sourceLine;
        opt.textContent=card.name+"（普通存款扣款）";
        paymentSelect.append(opt);
      }
      const previous=oldChoices.get(lesson.key);
      if(previous&&[...paymentSelect.options].some(opt=>opt.value===previous))
        paymentSelect.value=previous;
      else if(lesson.cashReason&&lesson.creditReason===null)
        paymentSelect.value="credit:"+cards[0].sourceLine;
      label.append(paymentSelect);
      tile.append(label);
    }
    function update(waits=trainingWaits()){
      const usingCredit=paymentSelect?.value.startsWith("credit:")??false;
      const originalReason=lesson.type==="classroom"?
        (usingCredit?lesson.creditReason:lesson.cashReason):lesson.reason;
      const wait=waits[lesson.type];
      const cooldownReason=lesson.type==="school"?/^今日已經上過/.test(originalReason??""):
        lesson.type==="gym"?/^健身房還需要等待/.test(originalReason??""):
        /^教室還需要等待/.test(originalReason??"");
      // 冷卻到期但尚未取得新資格快照時，不提前解鎖。
      const reason=wait>0?(cooldownReason?null:originalReason):
        cooldownReason?"正在更新課程狀態…":originalReason;
      const unavailable=wait>0||Boolean(reason);
      submit.textContent=unavailable?"目前不可進行":
        lesson.type==="school"?"參加課程":"開始訓練";
      submit.disabled=unavailable;
      tile.classList.toggle("is-unavailable",unavailable);
      countdown.textContent=wait>0?
        (lesson.type==="school"?"今日課程已完成；明日重置剩餘 ":"冷卻剩餘 ")+
        formatTrainingWait(wait):"";
      countdown.hidden=wait<=0;
      blocked.textContent=reason??"";
      blocked.hidden=!reason;
    }
    // 付款方式切換時同步更新灰階與停用原因，不修改後端的付款資格。
    tile.prepend(name,cost,gains);
    tile.append(countdown,blocked,submit);
    paymentSelect?.addEventListener("change",()=>update());
    trainingTileUpdates.push(update);
    update();
    submit.addEventListener("click",()=>{
      const value=paymentSelect?.value??"cash";
      const payload=value.startsWith("credit:")?
        {payment:"credit",sourceLine:Number(value.slice(7))}:{payment:"cash"};
      actionTraining(lesson.key,payload);
    });
    target.append(tile);
  }
  updateTrainingCountdowns();
}

function actionTraining(key,payment={payment:"cash"}) {
  action("train", { key,...payment });
}
function updateLoanQuote() {
  const loan=state?.bankLoan;
  const selection=el("loan-plan");
  const chosen=loan?.plans.find(p=>String(p.payments)===selection.value);
  const submit=el("loan-borrow");
  if (!loan || loan.active || !loan.maxPrincipal || !chosen) {
    submit.disabled=true;
    text("loan-quote",loan?.active ?
      "必須先清償目前的貸款，才能再次借款。" :
      "目前沒有可借款額度，請先累積存款與工作經驗。");
    return;
  }
  submit.disabled=false;
  text("loan-quote","借款額度：" + money(loan.maxPrincipal) +
    "，每日還款：" + money(chosen.dailyPayment) +
    "，全部 " + chosen.payments + " 期總計：" + money(chosen.totalRepayment) + "。");
}
function renderLoan() {
  const loan=state?.bankLoan;
  const select=el("loan-plan");
  const previous=select.value;
  select.replaceChildren();
  for(const plan of loan?.plans ?? []){
    const option=document.createElement("option");
    option.value=String(plan.payments);
    option.textContent=plan.payments+" 日（利息 "+plan.interestPercent+"%）";
    select.append(option);
  }
  if (loan?.plans.some(x=>String(x.payments)===previous)) select.value=previous;
  const form=el("loan-borrow-form");
  form.hidden=Boolean(loan?.active);
  const payoff=el("loan-payoff");
  payoff.hidden=!loan?.active;
  if (loan?.active) {
    text("loan-status","原始借款：" + money(loan.originalPrincipal) +
      "，每日還款：" + money(loan.dailyPayment) +
      "，尚餘 " + loan.remainingPayments + " 期，待清償：" +
      money(loan.totalOutstanding) +
      (loan.missedAttempts ? "，歷史未繳次數：" + loan.missedAttempts : "") + "。");
  } else {
    text("loan-status","目前無未清償貸款。評估最高額度：" +
      money(loan?.maxPrincipal ?? 0) + "。");
  }
  updateLoanQuote();
}

function renderBank() {
  el("bank-transfer-panel").hidden = state.mode !== "multi";
  const account = state.bankAccount;
  if (!account) return;
  text("bank-available-cash",money(state.character.money));
  text("bank-available-balance",money(state.character.bank));
  renderLoan();
  text("term-balance", "目前定期存款：" + money(account.termBalance));
  text("bank-interest-day", account.lastInterestDay
    ? "最近已計息日期：" + account.lastInterestDay
    : "尚無計息紀錄，將以首次讀取日期開始記錄。");
  el("term-cancel").disabled = account.termBalance <= 0;
  const target = el("bank-ledger-list");
  target.replaceChildren();
  const filter = el("bank-ledger-filter").value;
  const rows = (state.bankLedger || []).filter(
    item => filter === "all" || item.type === filter
  );
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = "目前沒有符合條件的銀行交易紀錄。";
    target.append(empty);
    return;
  }
  const list = document.createElement("ol");
  list.className = "bank-ledger-list";
  for (const item of rows) {
    const li = document.createElement("li");
    const who = item.type === "ordinary" ? "普通存款" : "超級定期";
    const date = new Date(item.occurredAt).toLocaleString("zh-TW");
    const amount = item.credit > 0 ? "入帳 " + money(item.credit) :
      item.debit > 0 ? "支出 " + money(item.debit) : "金額未變動";
    li.textContent = date + "｜" + who + "｜" + item.action + "｜" +
      amount + "｜餘額 " + money(item.balance);
    list.append(li);
  }
  target.append(list);
}

function render() {
  if (!state) return;
  const solo = state.mode === "solo";
  syncedGameMs=state.gameTimeMs??Date.now();
  syncedAtRealMs=Date.now();
  updateTownTheme();
  text("mode", solo ? "單機模式" : "多人模式");
  const lobby=solo && Boolean(state.character) && soloAtHome;
  el("auth").hidden = solo || Boolean(state.user);
  el("create").hidden = !state.user || Boolean(state.character);
  el("solo-lobby").hidden=!lobby;
  if(lobby)text("solo-character-name",state.character.name);
  el("landing").hidden=Boolean(state.character)&&!lobby;
  el("game").hidden = !state.character || lobby;
  el("logout").hidden = !state.user || lobby || (solo && !state.character);
  el("logout").textContent=solo?"離開遊戲":"登出";
  renderLegacyIcon();
  if (!state.character || lobby) {
    if(!publicPreview&&!previewLoading)loadPublicPreview();
    updateCompactVisibility();
    el("event-popup").hidden=true;
    return;
  }
  const c = state.character;
  renderSoloTime();
  text("character-name", c.name);
  text("current-town", state.towns.find(t => t.id === c.townId)?.name || "未知");
  text("money", money(c.money));
  text("bank", money(c.bank));
  renderBank();
  text("body-energy", c.bodyEnergy + " / " + state.maxBodyEnergy);
  text("brain-energy", c.brainEnergy + " / " + state.maxBrainEnergy);
  renderCompactStatus(c);
  selectProfileView(activeProfileView);
  // 原版 town_maker.cgi：職業名稱與等級同列；移入提示才看總經驗與下級剩餘值。
  // Web 直接把「本級 / 100 XP」放在角色狀態，精通 Lv.15 獨立用文字標示。
  const hasCurrentJob=Boolean(state.currentJob);
  const jobExperience=hasCurrentJob?Math.max(0,c.jobExperience??0):0;
  const jobLevel=hasCurrentJob?state.jobLevel:0;
  const currentLevelXp=jobExperience%100;
  text("current-job",hasCurrentJob?state.currentJob.name+"（Lv."+jobLevel+"）":"尚未就職");
  el("job-level-progress").hidden=!hasCurrentJob;
  text("job-level-xp","本級經驗 "+currentLevelXp+" / 100 XP");
  text("job-next-level","距離 Lv."+(jobLevel+1)+" 還差 "+(100-currentLevelXp)+" XP");
  el("job-level-bar").value=currentLevelXp;
  text("job-mastery-status",!hasCurrentJob?"尚未就職":
    jobLevel>=15?"已達 Lv.15 精通門檻":
    "距離 Lv.15 精通還需 "+(1500-jobExperience)+" XP");
  text("work-count", c.workCount + " 次（目前職業 " + c.jobWorkCount + " 次）");
  text("job-experience", jobExperience + " XP");
  // masteredJob 是原版單一前置職業欄位，並非完整履歷。
  text("mastered-job", c.masteredJob || "無");
  text("measurements", c.height + " 公分／" + c.weight + " 公斤");
  renderDining();
  renderRetail();
  renderVending();
  renderFishing();
  renderCrafting();
  renderArcadeDice();
  renderArcadeHighLow();
  renderArcadeDonuts();
  renderInstantLoto();
  renderLoto6();
  renderMultiCard();
  renderEquipment();
  renderGiftShop();
  renderMailbox();
  renderRecycle();
  renderWholesale();
  renderInsurance();
  const ready = Boolean(state.currentJob) && state.workCooldownMs === 0 &&
    state.condition?.baseExperience !== null;
  el("work").disabled = !ready || savingSalaryPayment;
  // 地圖快捷「工作」僅是前往工作頁面，不執行工作，也不受出勤冷卻限制。
  el("home-work").disabled = false;
  text("cooldown", !state.currentJob ? "請先前往職業介紹所選擇工作。" :
    state.workCooldownMs > 0 ? "距離下次工作約 " + Math.ceil(state.workCooldownMs / 1000) + " 秒。" :
      "工作冷卻時間已結束。");
  const job=state.currentJob;
  const workJob=job?state.jobs?.find(entry=>entry.key===job.key):null;
  text("work-cost-status",workJob?
    "每次工作消耗：身體能量 "+workJob.bodyCost+"、頭腦能量 "+workJob.brainCost+"。":"");
  text("work-payday-status",!job?"尚未任職，無薪資發放週期。":
    job.payEvery===1?"目前職業：每次完成工作即發薪；收款方式："+
      (c.salaryPayment==="bank"?"普通銀行存款":"現金")+"。":
    "目前職業：每 "+job.payEvery+" 次工作才發薪一次，"+
      "本週期已出勤 "+job.workProgress+" / "+job.payEvery+
      " 次，再完成 "+job.worksUntilPayday+" 次才會入帳。"+
      "收款方式："+(c.salaryPayment==="bank"?"普通銀行存款":"現金")+"。");
  const attrs = el("attributes");
  attrs.replaceChildren();
  renderAbilities(c.stats);
  text("residents", state.residents.length ? state.residents.join("、") : "目前沒有其他玩家在這個城鎮。");
  renderTowns();
  renderTownMap();
  renderHouses();
  if (activeRoom && !state.townHouses.some(house => house.id === activeRoom.houseId))
    closeRoom();
  renderTraining();
  renderJobs();
}

async function action(path, data, message) {
  try {
    state = await api(path, data);
    if (path === "move") {
      const result=state.travelResult;
      const town=state.towns.find(t=>t.id===result.toTownId);
      notify("已搭電車抵達 "+(town?.name??"目的地")+
        "，依原版票價支付現金 "+money(result.fare)+"。",false,{title:"電車移動結果"});
    } else if (path === "work") {
      const result = state.result;
      const messages = ["工作完成（狀態："+(result.condition??"普通")+"），職業經驗 "+
        (result.experienceGain>=0?"+":"")+result.experienceGain+" 點。"];
      const destination=result.payment==="bank"?"（已存入銀行普通存款）":"（已領取現金）";
      if (result.paid) messages.push("獲得薪資 " + money(result.paid) + destination+"。");
      else messages.push("本次尚未到發薪次數（目前 "+result.pending+
        " / "+result.payEvery+" 次出勤；再工作 "+result.worksUntilPayday+
        " 次發薪），所以此次沒有薪資入帳。");
      if (result.bonus) messages.push("升級獎金 " + money(result.bonus) + destination+"。");
      if (result.leveledUp) messages.push("職業等級提升至 " + result.jobLevel + " 級。");
      if (result.mastered) messages.push("已精通目前職業，開放相關進階職業。");
      notify(messages.join("\n"),false,{title:"工作結果"});
    } else if (path === "house/build") {
      notify("住宅建造完成，費用：" + money(state.houseResult.quote.total) + "。");
    } else if (path === "house/remodel") {
      closeRoom();
      notify("房屋改裝完成，支付現金 " + money(state.houseRemodelResult.quote.total) + "。");
    } else if (path === "house/sell") {
      closeRoom();
      notify("住宅已出售，土地地價退還 " + money(state.houseSaleResult.refund) + " 至現金。");
    } else if (path === "events/cockroach/claim") {
      const result=state.cockroachResult;
      notify(result.status==="caught"?
        "已在期限內拍死蟑螂，得到 "+money(result.reward)+
        " 與 K 點數 3，外貌變化 "+result.looks+"。" :
        "蟑螂已逃走，沒有獲得獎勵。");
    } else if (path === "hospital/treat") {
      notify("已完成醫院治療，原診斷：" + state.hospitalResult.previousDisease +
        "，支付 " + money(state.hospitalResult.paid) + "，疾病指數已恢復為 50。");
    } else if (path === "meal/eat") {
      const result=state.mealResult;
      const gains=Object.entries(result.gained).filter(([,value])=>value>0)
        .map(([key,value])=>(labels[key]||key)+" +"+value).join("、");
      notify("已享用 "+result.name+"，支付 "+money(result.paid)+
        "，體重增加 "+result.weightGain+" 公斤"+
        (gains?"，能力提升："+gains:"")+"。");
    } else if (path === "train") {
      const result = state.trainingResult;
      const gains = Object.entries(result.gained)
        .filter(([, amount]) => amount > 0)
        .map(([key, amount]) => (labels[key] || key) + " +" + amount)
        .join("、");
      notify("完成" + result.name + "，"+
        (result.payment==="credit"?"普通銀行存款扣除 ":"現金花費 ")+money(result.paid) +
        (gains ? "，能力提升：" + gains : "") +
        (result.weightLoss ? "，體重減少 "+result.weightLoss.toFixed(2)+" 公斤" : "") + "。");
    } else if (path === "bank") {
      const result=state.bankResult;
      notify((result.action==="deposit"?"存款":"提款")+"完成："+money(data.amount)+
        "\n目前現金："+money(result.money)+"\n普通銀行存款："+money(result.bank)+"。",
        false,{title:result.action==="deposit"?"存款完成":"提款完成"});
    } else if (message) notify(message,false,{inline:path==="map/tile"||path==="job/payment",
      source:path==="map/tile"?el("map-selection"):undefined});
    if (path === "login" || path === "register") closeRoom();
    render();
  } catch (error) { notify(error.message, true); }
}

function formValues(form) { return Object.fromEntries(new FormData(form)); }

el("login-form").addEventListener("submit", event => {
  event.preventDefault();
  action("login", formValues(event.currentTarget), "登入成功");
});
el("register-form").addEventListener("submit", event => {
  event.preventDefault();
  action("register", formValues(event.currentTarget), "帳號已建立，請建立角色");
});
const statGroups = {
  brain: { keys: ["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu"], max: 200 },
  body: { keys: ["looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku"], max: 200 },
  other: { keys: ["love","unique","etti"], max: 100 }
};
function updateStatTotals() {
  const form = el("create-form");
  let valid = true;
  for (const [key, group] of Object.entries(statGroups)) {
    const values = group.keys.map(name => Number(form.elements.namedItem(name).value));
    const total = values.reduce((sum, num) => sum + num, 0);
    const ok = values.every(num => Number.isSafeInteger(num) && num >= 1) && total <= group.max;
    text("sum-" + key, total + " / " + group.max + (ok ? "" : "（不符合限制）"));
    valid &&= ok;
  }
  el("create-submit").disabled = !valid;
}
el("create-form").addEventListener("input", updateStatTotals);
updateStatTotals();
el("create-form").addEventListener("submit", event => {
  event.preventDefault();
  const data = formValues(event.currentTarget);
  const stats = Object.fromEntries(Object.values(statGroups).flatMap(group =>
    group.keys.map(key => [key, Number(data[key])])
  ));
  action("character", { name: data.name, gender: data.gender, stats }, "角色建立完成");
});
el("bank-form").addEventListener("submit", event => {
  event.preventDefault();
  const actionName = event.submitter?.value === "withdraw" ? "withdraw" : "deposit";
  const amount = Number(new FormData(event.currentTarget).get("amount"));
  action("bank", { action: actionName, amount });
});
let pendingTransfer = null;
el("bank-transfer-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (state?.mode !== "multi") return;
  const data = formValues(form);
  const recipientName = data.recipientName.trim();
  const amount = Number(data.amount);
  if (!recipientName || !Number.isSafeInteger(amount) || amount < 1 ||
      amount > 1000000000000) {
    return notify("請確認收款角色名稱與轉帳金額。", true);
  }
  if (!window.confirm("確定從普通存款轉帳 " + money(amount) +
      " 給「" + recipientName + "」嗎？請先確認收款人姓名。")) return;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  // 回應遺失時，重試相同收款人與金額必須沿用同一識別碼。
  if (!pendingTransfer || pendingTransfer.recipientName !== recipientName ||
      pendingTransfer.amount !== amount) {
    pendingTransfer = { recipientName, amount, requestId: crypto.randomUUID() };
  }
  const requestId = pendingTransfer.requestId;
  try {
    state = await api("bank/transfer", {recipientName,amount,requestId});
    render();
    notify(state.transferResult.duplicate ?
      "這筆轉帳已處理過，沒有重複扣款。" :
      "成功轉帳 " + money(amount) + " 給「" + recipientName + "」。");
    pendingTransfer = null;
    form.reset();
  } catch(error) {
    notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
});
let pendingInsurancePurchase=null;
el("insurance-quantity").addEventListener("change",renderInsurance);
el("insurance-buy-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const quantity=Number(el("insurance-quantity").value);
  const item=state?.insurance;
  if(!item||!Number.isSafeInteger(quantity)||quantity<1||quantity>item.maxQuantity)
    return notify("健康保險份數不正確。",true);
  const total=quantity*item.price;
  if(!window.confirm("確定支付 "+money(total)+" 購買健康保險 "+
    quantity+" 份嗎？本入口使用 Web 版暫行基準價。"))return;
  if(!pendingInsurancePurchase||pendingInsurancePurchase.quantity!==quantity)
    pendingInsurancePurchase={quantity,requestId:crypto.randomUUID()};
  const submit=el("insurance-buy");
  submit.disabled=true;
  try {
    state=await api("inventory/insurance/buy",pendingInsurancePurchase);
    render();
    const result=state.insuranceResult;
    notify(result.replayed?"同一筆保險購買已處理，沒有重複扣款。":
      "已支付 "+money(result.paid)+" 購買 "+result.quantity+
      " 份健康保險，醫院費用立即套用折抵。");
    pendingInsurancePurchase=null;
  }catch(error){notify(error.message,true);}
  finally{renderInsurance();}
});
el("cockroach-claim").addEventListener("click",()=>action("events/cockroach/claim",{}));
setInterval(updateCockroachCountdown,250);
el("hospital-treat").addEventListener("click",()=>{
  const quote=state?.hospital;
  if(!quote) return;
  if(window.confirm("確定支付 " + money(quote.price) + " 接受醫院治療嗎？")) {
    action("hospital/treat",{});
  }
});
el("loan-plan").addEventListener("change", updateLoanQuote);
el("loan-borrow-form").addEventListener("submit", event=>{
  event.preventDefault();
  const plan=state?.bankLoan?.plans.find(x=>String(x.payments)===el("loan-plan").value);
  if (!plan || state.bankLoan?.active || state.bankLoan?.maxPrincipal<=0) return;
  if (!window.confirm("確定借入 " + money(state.bankLoan.maxPrincipal) +
      "，選擇 " + plan.payments + " 期每日支付 " + money(plan.dailyPayment) +
      " 嗎？未清償期間無法再次借款。")) return;
  action("bank/loan/borrow",{payments:plan.payments},
    "貸款已撥入普通帳戶。");
});
el("loan-payoff").addEventListener("click",()=>{
  const amount=state?.bankLoan?.totalOutstanding ?? 0;
  if (!state?.bankLoan?.active || amount<=0) return;
  if (!window.confirm("確定從普通存款一次支付 " + money(amount) +
      " 以清償貸款嗎？")) return;
  action("bank/loan/payoff",{},"剩餘貸款已全額清償。");
});
el("retail-shop-select").addEventListener("change",renderRetail);
el("retail-search").addEventListener("input",renderRetail);
el("meal-menu").addEventListener("change",renderDining);
el("bank-ledger-filter").addEventListener("change", renderBank);
el("term-deposit-form").addEventListener("submit", event => {
  event.preventDefault();
  const units = Number(new FormData(event.currentTarget).get("units"));
  if (!Number.isSafeInteger(units) || units < 1 || !Number.isSafeInteger(units*1000000))
    return notify("定期存款單位必須為正整數。", true);
  action("bank/term", {action:"deposit",units},
    "已存入超級定期 " + money(units*1000000) + "。");
});
el("term-cancel").addEventListener("click", () => {
  const amount=state?.bankAccount?.termBalance ?? 0;
  if (amount <= 0) return;
  if (window.confirm("確定解約全部超級定期存款嗎？將領回 " +
    money(amount) + " 至現金，不能部分提款。")) {
    action("bank/term", {action:"cancel"}, "超級定期已解約。");
  }
});
el("logout").addEventListener("click", async () => {
  if(state?.mode==="solo"){
    soloAtHome=true;
    try{sessionStorage.setItem("town-solo-at-home","1");}catch{}
    closeRoom();
    render();
    notify("已返回單機首頁，角色及遊戲進度均已保留。");
    return;
  }
  try {
    await api("logout",{});
    pendingTransfer=null;
    closeRoom();
    state=await api("state");
    render();
    notify("已登出多人模式帳號");
  }catch(error){notify(error.message,true);}
});
el("solo-continue").addEventListener("click",()=>{
  soloAtHome=false;
  try{sessionStorage.removeItem("town-solo-at-home");}catch{}
  render();
  notify("已繼續單機遊戲。",false,{inline:true});
});
let soloDeleteBusy=false;
el("solo-delete-form").addEventListener("submit",async event=>{
  event.preventDefault();
  if(soloDeleteBusy||state?.mode!=="solo"||!soloAtHome||!state?.character)return;
  const entered=el("solo-delete-name").value;
  if(entered!==state.character.name){
    notify("角色名稱不符，沒有刪除任何資料。",true);
    return;
  }
  if(!el("solo-delete-ack").checked)return;
  const confirmed=window.confirm("確定永久刪除「"+entered+"」的角色進度、住宅、物品及所有相關紀錄嗎？\n\n此操作不可復原；城鎮地圖與單機時間會保留。");
  if(!confirmed)return;
  soloDeleteBusy=true;
  el("solo-delete-submit").disabled=true;
  try{
    state=await api("solo/character/delete",{characterName:entered,confirm:true});
    // 刪除後回建角畫面；已保存的城鎮與單機虛擬時鐘繼續沿用。
    soloAtHome=false;
    try{sessionStorage.removeItem("town-solo-at-home");}catch{}
    closeRoom();
    selectedMapCell=null;
    selectedHouseSpot=null;
    activeFacilityTab="jobs";
    dismissedEventKey=null;
    try{sessionStorage.removeItem("town-dismissed-event");}catch{}
    el("solo-delete-form").reset();
    el("solo-delete-details").open=false;
    render();
    notify("已刪除角色及相關資料，可以建立新角色。城鎮地圖與單機時間已保留。");
  }catch(error){notify(error.message,true);}
  finally{
    soloDeleteBusy=false;
    el("solo-delete-submit").disabled=false;
  }
});
el("solo-time-panel").addEventListener("click",async event=>{
  const target=event.target.closest("button[data-advance]");
  if(!target||state?.mode!=="solo"||timeAdvanceBusy)return;
  const preset=target.dataset.advance;
  if(!["5m","30m","1h","1d"].includes(preset))return;
  timeAdvanceBusy=true;
  renderSoloTime();
  try{
    state=await api("solo/time/advance",{preset});
    render();
    const amount={"5m":"5 分鐘","30m":"30 分鐘","1h":"1 小時","1d":"1 天"}[preset];
    notify("已將單機遊戲時間快轉 "+amount+"，冷卻及每日結算已更新。");
  }catch(error){notify(error.message,true);}
  finally{timeAdvanceBusy=false;renderSoloTime();}
});
setInterval(()=>{
  updateTownTheme(); // 跨越原版時段分界時，即使沒操作也會更新背景。
  updateInventoryCooldowns(); // 使用伺服器遊戲時間倒數，不依賴瀏覽器本地時鐘。
  if(state?.mode==="solo"&&state?.character&&!soloAtHome)
    renderSoloTime(); // 同步顯示遊戲時鐘，限時事件結束後也恢復快轉按鈕
  updateTrainingCountdowns(); // 每秒刷新課程灰階和剩餘時間，不重建卡片。
},1000);
el("room-close").addEventListener("click", closeRoom);
el("room-config-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!activeRoom?.owner) return;
  const slots = [...el("room-slot-inputs").querySelectorAll(".room-slot-editor")]
    .map(block => ({
      type: block.querySelector(".room-slot-type").value,
      title: block.querySelector(".room-slot-title").value,
      url: block.querySelector(".room-slot-url").value
    }));
  roomAction("house/room/config",
    { houseId:activeRoom.houseId, slots }, "室內配置已儲存。", true);
});
el("house-design").addEventListener("change", updateHouseQuote);
el("house-interior").addEventListener("change", updateHouseQuote);
el("house-payment").addEventListener("change", updateHouseQuote);
el("house-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!selectedHouseSpot) return notify("請先在地圖點選空地。", true);
  const d = formValues(event.currentTarget);
  action("house/build", {
    row: selectedHouseSpot.row, column: selectedHouseSpot.column,
    image: d.image, interiorRank: Number(d.interiorRank), payment: d.payment
  });
});
el("preview-town").addEventListener("change",event=>{
  const townId=Number(event.currentTarget.value);
  if(Number.isSafeInteger(townId)&&townId>=0&&townId<=3)
    loadPublicPreview(townId);
});
el("facility-tabs").addEventListener("click",event=>{
  const tab=event.target.closest('button[role="tab"][data-pane]');
  if(tab)selectFacilityTab(tab.dataset.pane);
});
el("facility-tabs").addEventListener("keydown",event=>{
  if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;
  const index=FACILITY_TAB_NAMES.indexOf(activeFacilityTab);
  const next=event.key==="Home"?0:event.key==="End"?FACILITY_TAB_NAMES.length-1:
    (index+(event.key==="ArrowRight"?1:-1)+FACILITY_TAB_NAMES.length)%FACILITY_TAB_NAMES.length;
  event.preventDefault();
  selectFacilityTab(FACILITY_TAB_NAMES[next],{focusTab:true});
});
el("event-alert").addEventListener("click",()=>{
  dismissEventPopup();
  goToFacility("event-panel");
});
el("event-popup-claim").addEventListener("click",()=>{
  if(state?.cockroachChallenge?.status==="active")
    action("events/cockroach/claim",{});
});
el("event-popup-close").addEventListener("click",dismissEventPopup);
el("profile-view-tabs").addEventListener("click",event=>{
  const button=event.target.closest("button[data-profile-view]");
  if(button)selectProfileView(button.dataset.profileView);
});
el("profile-view-tabs").addEventListener("keydown",event=>{
  if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;
  const index=PROFILE_VIEWS.indexOf(activeProfileView);
  const next=event.key==="Home"?0:event.key==="End"?PROFILE_VIEWS.length-1:
    (index+(event.key==="ArrowRight"?1:-1)+PROFILE_VIEWS.length)%PROFILE_VIEWS.length;
  event.preventDefault();
  selectProfileView(PROFILE_VIEWS[next],{focus:true});
});
el("mail-compose").addEventListener("submit",event=>{
  event.preventDefault();
  const values=formValues(event.currentTarget);
  const recipientName=String(values.recipientName??"").trim();
  const message=String(values.message??"").trim();
  if(!recipientName||recipientName.length>40||!message||message.length>1000)
    return notify("請輸入收件角色名稱與 1～1,000 字的訊息。",true);
  submitPrivateMail(recipientName,message);
});
el("facility-shortcuts").addEventListener("click",event=>{
  const button=event.target.closest("button[data-facility]");
  if(button)goToFacility(button.dataset.facility);
});
el("solo-starter-create").addEventListener("click",()=>{
  if(state?.mode!=="solo"||!state?.character||state.map?.configured)return;
  if(!window.confirm("將在目前城鎮建立一張 Web 試玩街區：包含原版已確認的商店、食堂、工作入口、教室及住宅空地。這不是遺失的原版地圖；已有配置的城鎮無法套用。要繼續嗎？"))return;
  action("solo/map/starter",{},"已建立單機試玩街區，可點選百貨、住宅用空地與其他設施開始遊玩。");
});
el("map-edit-toggle").addEventListener("change", () => {
  el("map-palette").disabled = !el("map-edit-toggle").checked;
  text("map-selection", el("map-edit-toggle").checked
    ? "編輯模式已啟用。點選街區格子即可設定為選單中的設施。"
    : "編輯模式已關閉。點選格子可查看位置與設施。");
});
el("legacy-icon-toggle").addEventListener("click", () => {
  const icon = state?.legacyPlayerIcon;
  if (!state?.character || icon?.status !== "available") return;
  if (loadedLegacyIconUrl === icon.url) {
    clearLegacyIconPreview();
    renderLegacyIcon();
    return;
  }
  requestedLegacyIconUrl = icon.url;
  const image = el("legacy-icon-image");
  image.hidden = true;
  // 機密資訊不寫入訊息或文字 DOM，且原版 URL 僅以 src 屬性使用。
  image.src = icon.url;
  renderLegacyIcon();
});
el("legacy-icon-image").addEventListener("load", () => {
  if (requestedLegacyIconUrl && state?.legacyPlayerIcon?.url === requestedLegacyIconUrl) {
    loadedLegacyIconUrl = requestedLegacyIconUrl;
    renderLegacyIcon();
  }
});
el("legacy-icon-image").addEventListener("error", () => {
  if (!requestedLegacyIconUrl) return;
  clearLegacyIconPreview();
  renderLegacyIcon();
  text("legacy-icon-help", "原版圖示無法載入，可再次按下嘗試。");
});
el("refresh").addEventListener("click", async () => {
  try { state = await api("state"); render(); notify("遊戲資料已更新",false,{inline:true}); }
  catch (error) { notify(error.message, true); }
});
el("work").addEventListener("click", () => action("work", {}));
selectFacilityTab(activeFacilityTab);
el("job-search").addEventListener("input", renderJobs);
el("job-filter").addEventListener("change", renderJobs);
// 收款偏好必須先由伺服器確認儲存，才允許下一次工作；
 // 避免使用者連續點選時，工作請求先於收款偏好請求完成。
let savingSalaryPayment=false;
el("salary-payment").addEventListener("change",async()=>{
  if(savingSalaryPayment)return;
  const payment=el("salary-payment").value;
  savingSalaryPayment=true;
  el("salary-payment").disabled=true;
  el("work").disabled=true;
  el("home-work").disabled=true;
  try {
    await action("job/payment",{payment},
      payment==="bank"?"往後發薪改存銀行普通存款。":"往後發薪改為領取現金。");
  } finally {
    savingSalaryPayment=false;
    el("salary-payment").disabled=false;
    render(); // 儲存失敗時恢復伺服器已確認的選項與工作按鈕
  }
});
(async () => {
  try { state = await api("state"); render(); }
  catch (error) { notify("無法連線至遊戲伺服器：" + error.message, true); }
})();
setInterval(async () => {
  if (!state?.character) return;
  try { state = await api("state"); render(); } catch {}
}, 30000);
