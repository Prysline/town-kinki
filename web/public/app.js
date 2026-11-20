import { townCellAction } from "./town-home.js";
import { shouldShowCompactEnergy } from "./energy-visibility.js";
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

function notify(message, error = false) {
  const target = el("notice");
  target.hidden = false;
  target.textContent = message;
  target.classList.toggle("error", error);
}

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
const FACILITY_TAB_NAMES = Object.freeze(["house","dining","shops","training","jobs","bank","hospital","events"]);
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
  el("compact-status").hidden=!show;
  document.body.classList.toggle("compact-status-active",show);
}
function renderCompactStatus(character){
  text("compact-character-name",character.name);
  text("compact-body-energy",character.bodyEnergy+" / "+state.maxBodyEnergy);
  text("compact-brain-energy",character.brainEnergy+" / "+state.maxBrainEnergy);
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
          }
          else if(destination.kind==="station"){
            el("station-heading").scrollIntoView({behavior:"smooth",block:"start"});
            el("towns").querySelector("button:not(:disabled)")?.focus({preventScroll:true});
          }
          else if(destination.kind==="unavailable")
            notify(name+"："+cell.label+" 尚未移植或尚無對應 Web 入口。");
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
      slot.type === "3" ? "屋主公告板" : "自訂網址");
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
    "檢視職業條件（"+demanded.length+" 項能力門檻）":"檢視職業條件與待遇";
  details.append(summary);

  const other=document.createElement("div");
  other.className="job-condition-grid";
  const status=[];
  if(job.bmiMin||job.bmiMax){
    const bmi=(job.bmiMin||"不限")+"～"+(job.bmiMax||"不限");
    const current=state.physique?.bmi;
    status.push(["BMI",bmi,
      (job.bmiMin&&current<job.bmiMin)||
      (job.bmiMax&&current>job.bmiMax)]);
  }
  if(job.minHeight>0)
    status.push(["身高",job.minHeight+" cm 以上",
      state.character.height<job.minHeight]);
  if(job.gender)
    status.push(["性別",job.gender==="male"?"男":"女",
      state.character.gender!==job.gender]);
  if(job.previousJob)
    status.push(["前置精通",job.previousJob,
      state.character.masteredJob!==job.previousJob]);
  for(const [label,required,missing] of status){
    const row=document.createElement("div");
    row.className="job-condition"+(missing?" job-condition-missing":"");
    row.textContent=label+"：要求 "+required;
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
      row.className="job-condition"+(current<required?" job-condition-missing":"");
      row.textContent=labels[key]+"：要求 "+required;
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
    title.textContent = job.name + (job.translated ? "" : "（未翻譯）");
    desc.textContent = "薪資 " + money(job.salary) + "／每 " + job.payEvery +
      " 次工作 · 體力 " + job.bodyCost + " · 頭腦 " + job.brainCost +
      (job.reason ? " · " + job.reason : "");
    const requirements=jobRequirementsPanel(job);
    requirements.open=expanded.has(job.key);
    meta.append(title, desc, requirements);
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
  if(!window.confirm("確定使用「"+name+"」一次嗎？將消耗一次原始耐久。"))return;
  if(!pendingLegacyUse||pendingLegacyUse.sourceLine!==sourceLine)
    pendingLegacyUse={sourceLine,requestId:crypto.randomUUID()};
  try{
    state=await api("inventory/legacy/use",pendingLegacyUse);
    const result=state.itemUseResult;
    pendingLegacyUse=null;
    render();
    notify(result.replayed?
      "相同道具使用請求已處理，沒有重複扣除耐久。" :
      "已使用「"+result.name+"」，效果已套用。");
  }catch(error){
    notify(error.message,true);
    renderLegacyItems();
  }
}
function renderLegacyItems() {
  const target=el("legacy-inventory-list");
  target.replaceChildren();
  const actions=new Map((state.legacyItemActions??[]).map(x=>[x.sourceLine,x]));
  if(!state.legacyInventory?.length){
    const note=document.createElement("p");
    note.className="small";
    note.textContent="尚未匯入原版物品存檔。";
    target.append(note);
  }else{
    const list=document.createElement("ol");
    list.className="health-event-list";
    for(const item of state.legacyInventory){
      const row=document.createElement("li");
      const actionInfo=actions.get(item.sourceLine);
      const label=document.createElement("span");
      label.textContent=item.category+"｜"+item.name+"｜剩餘耐久 "+
        (actionInfo?.remaining??item.durability)+" "+
        (item.unit||"（未標示單位）")+
        (item.origin==="retail"?"｜百貨店新購入":"｜原始存檔第 "+item.sourceLine+" 行")+
        (actionInfo?"（已支援使用）":item.name==="健康保険"&&state.insurance?.active?
        "（醫院自動生效，不需手動使用）":item.origin==="retail"?"（尚未支援直接使用）":"（唯讀封存）");
      row.append(label);
      if(actionInfo){
        const button=document.createElement("button");
        button.type="button";
        button.className="secondary";
        button.textContent=actionInfo.canUse?"使用一次":"目前無法使用";
        button.disabled=!actionInfo.canUse;
        button.addEventListener("click",()=>submitLegacyUse(item.sourceLine,item.name));
        row.append(button);
        if(actionInfo.reason){
          const note=document.createElement("p");
          note.className="small";
          note.textContent=actionInfo.reason;
          row.append(note);
        }
      }
      list.append(row);
    }
    target.append(list);
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
        "｜"+item.name+"｜能力變化 "+
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
  text("event-coupon-count","Web 事件所得優惠券："+(state.couponBalance ?? 0)+" 張（兌換所尚未移植）");
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
    "，購買「"+item.name+"」×"+quantity+" 嗎？"))return;
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
      "已購入「"+result.name+"」×"+result.quantity+"，"+
      (result.payment==="bank"?"普通存款":"現金")+"支付 "+money(result.paid)+
      (result.merged?"；耐久已合併至原持有物。":"；物品已加入本人清單。"));
  }catch(error){notify(error.message,true);}
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
     item.category.toLocaleLowerCase("zh-TW").includes(search)));
  text("retail-status",!choices.length?
    "目前城鎮沒有已配置的百貨店。請先在地圖中找到百貨店，單機模式可配置原版建築代碼。" :
    !choices.includes(shop)?"這間百貨店不在目前城鎮。" :
    (state.retailDay??"今日")+"｜符合搜尋的商品 "+goods.length+
    " 種，最多先顯示 30 筆。每筆可買 1～5 件；一般持有上限 25 格、購入禮品 10 格。");
  const target=el("retail-items");
  target.replaceChildren();
  const cards=state.classroomCreditCards??[];
  for(const item of goods.slice(0,30)){
    const tile=document.createElement("div");tile.className="training-tile";
    const name=document.createElement("strong");name.textContent=item.name;
    const note=document.createElement("p");note.className="small";
    note.textContent=item.category+"｜單價 "+money(item.price)+
      "｜耐久 "+item.durability+item.unit+"｜剩餘庫存 "+item.stock;
    const qtyLabel=document.createElement("label");
    qtyLabel.textContent="數量";
    const qty=document.createElement("select");
    qty.setAttribute("aria-label",item.name+"購買數量");
    for(let n=1;n<=5;n++){
      const option=document.createElement("option");
      option.value=String(n);option.textContent=n+" 件";
      option.disabled=n>item.stock;
      qty.append(option);
    }
    qtyLabel.append(qty);
    const paymentLabel=document.createElement("label");
    paymentLabel.textContent="付款方式";
    const payment=document.createElement("select");
    payment.setAttribute("aria-label",item.name+"付款方式");
    const cashOption=document.createElement("option");
    cashOption.value="cash";cashOption.textContent="現金";
    payment.append(cashOption);
    for(const card of cards){
      const option=document.createElement("option");
      option.value="card:"+card.sourceLine;
      option.textContent="信用卡："+card.name;
      payment.append(option);
    }
    paymentLabel.append(payment);
    const quote=document.createElement("p");quote.className="small";
    const button=document.createElement("button");
    button.type="button";
    const update=()=>{
      const quantity=Number(qty.value);
      const total=item.price*quantity;
      const bank=payment.value.startsWith("card:");
      const balance=bank?state.character.bank:state.character.money;
      const affordable=Number.isSafeInteger(total)&&total<=balance;
      quote.textContent="合計 "+money(total)+"（"+(bank?"普通存款":"現金")+"）"+
        (!affordable?"｜餘額不足":quantity>item.stock?"｜庫存不足":"");
      button.disabled=quantity>item.stock||item.stock<=0||!affordable;
      button.textContent=item.stock<=0?"今日售完":!affordable?"餘額不足":"購買";
    };
    qty.addEventListener("change",update);
    payment.addEventListener("change",update);
    button.addEventListener("click",()=>{
      const bank=payment.value.startsWith("card:");
      submitRetailPurchase(item,Number(qty.value),bank?"bank":"cash",
        bank?Number(payment.value.slice(5)):undefined);
    });
    update();
    tile.append(name,note,qtyLabel,paymentLabel,quote,button);
    target.append(tile);
  }
  if(!goods.length){
    const empty=document.createElement("p");empty.className="small";
    empty.textContent=choices.length?"目前沒有符合條件的上架商品。":"尚無可進入的百貨店。";
    target.append(empty);
  }
  const receipts=el("retail-purchases");
  receipts.replaceChildren();
  const list=document.createElement("ol");list.className="health-event-list";
  for(const purchase of (state.retailPurchases??[]).filter(x=>x.shop!=="vending")){
    const line=document.createElement("li");
    line.textContent=new Date(purchase.createdAt).toLocaleString("zh-TW")+
      "｜"+(purchase.shop==="depart2"?"百貨二":"百貨一")+"｜"+purchase.name+
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
     "，購買「"+item.name+"」×"+quantity+" 嗎？"))return;
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
      "已在自動販賣機買入「"+result.name+"」×"+result.quantity+
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
  const target=el("vending-items");
  target.replaceChildren();
  const cards=state.classroomCreditCards??[];
  for(const item of goods){
    const tile=document.createElement("div");
    tile.className="training-tile";
    const name=document.createElement("strong");
    name.textContent=item.name;
    const note=document.createElement("p");
    note.className="small";
    note.textContent=item.category+"｜單價 "+money(item.price)+
      "｜耐久 "+item.durability+item.unit+"｜剩餘庫存 "+item.stock;
    const qtyLabel=document.createElement("label");
    qtyLabel.textContent="數量";
    const qty=document.createElement("select");
    qty.setAttribute("aria-label",item.name+"自販機購買數量");
    for(let n=1;n<=5;n++){
      const option=document.createElement("option");
      option.value=String(n);
      option.textContent=n+" 件";
      option.disabled=n>item.stock;
      qty.append(option);
    }
    qtyLabel.append(qty);
    const paymentLabel=document.createElement("label");
    paymentLabel.textContent="付款方式";
    const pay=document.createElement("select");
    pay.setAttribute("aria-label",item.name+"自販機付款方式");
    const cash=document.createElement("option");
    cash.value="cash";cash.textContent="現金";
    pay.append(cash);
    for(const card of cards){
      const option=document.createElement("option");
      option.value="card:"+card.sourceLine;
      option.textContent="信用卡："+card.name;
      pay.append(option);
    }
    paymentLabel.append(pay);
    const quote=document.createElement("p");
    quote.className="small";
    const button=document.createElement("button");
    button.type="button";
    const update=()=>{
      const quantity=Number(qty.value);
      const total=quantity*item.price;
      const credit=pay.value.startsWith("card:");
      const balance=credit?state.character.bank:state.character.money;
      const affordable=Number.isSafeInteger(total)&&total<=balance;
      quote.textContent="合計 "+money(total)+"（"+(credit?"普通存款":"現金")+"）"+
        (!affordable?"｜餘額不足":quantity>item.stock?"｜庫存不足":"");
      button.disabled=item.stock<=0||quantity>item.stock||!affordable;
      button.textContent=item.stock<=0?"本期售完":!affordable?"餘額不足":"購買";
    };
    qty.addEventListener("change",update);
    pay.addEventListener("change",update);
    button.addEventListener("click",()=>{
      const credit=pay.value.startsWith("card:");
      submitVendingPurchase(item,Number(qty.value),credit?"bank":"cash",
        credit?Number(pay.value.slice(5)):undefined);
    });
    update();
    tile.append(name,note,qtyLabel,paymentLabel,quote,button);
    target.append(tile);
  }
  if(!goods.length){
    const note=document.createElement("p");
    note.className="small";
    note.textContent=available?"本期沒有可售飲料。":"請先進入城鎮中的自動販賣機。";
    target.append(note);
  }
  const history=el("vending-purchases");
  history.replaceChildren();
  const list=document.createElement("ol");
  list.className="health-event-list";
  for(const entry of (state.retailPurchases??[]).filter(x=>x.shop==="vending")){
    const line=document.createElement("li");
    line.textContent=new Date(entry.createdAt).toLocaleString("zh-TW")+
      "｜"+entry.name+" ×"+entry.quantity+"｜"+
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
  if(!window.confirm("確定"+captions[action]+"「"+name+"」嗎？"+
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
      "已"+captions[action]+"「"+result.name+"」。"+
      (action==="buy"||action==="forge")?"從現金扣除 "+money(-result.amount):
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
    heading.textContent=item.name+"｜"+item.category;
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
    title.textContent=item.name+"｜"+item.category+"｜"+
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
        input.setAttribute("aria-label",item.name+"鍛造"+label);
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
      label+"｜"+tx.name+"｜"+
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

function renderTraining() {
  const oldChoices=new Map([...el("classroom-lessons").querySelectorAll("select[data-lesson-key]")]
    .map(item=>[item.dataset.lessonKey,item.value]));
  const byType = {
    school: el("school-lessons"),
    gym: el("gym-lessons"),
    classroom: el("classroom-lessons")
  };
  Object.values(byType).forEach(target => target.replaceChildren());
  const statusSchool = state.schoolRemainingToday ? "今天已完成課程" : "今天還可以上課";
  const wait = state.gymCooldownMs ?? 0;
  text("school-status", statusSchool);
  text("gym-status", wait > 0 ? "距離下次訓練約 " + Math.ceil(wait / 60_000) + " 分鐘" : "現在可以訓練");
  const classroomWait=state.classroomCooldownMs??0;
  text("classroom-status",classroomWait>0?
    "距離下次教室課程約 "+Math.ceil(classroomWait/60_000)+" 分鐘":"目前可以上課");
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
    function update(){
      const usingCredit=paymentSelect?.value.startsWith("credit:")??false;
      const reason=lesson.type==="classroom"?
        (usingCredit?lesson.creditReason:lesson.cashReason):lesson.reason;
      submit.textContent=reason?"目前不可進行":
        lesson.type==="school"?"參加課程":"開始訓練";
      submit.disabled=Boolean(reason);
      blocked.textContent=reason??"";
      blocked.hidden=!reason;
    }
    // 保留原版課程先說明數值、再選付款，最後提交。
    tile.prepend(name,cost,gains);
    tile.append(blocked,submit);
    paymentSelect?.addEventListener("change",update);
    update();
    submit.addEventListener("click",()=>{
      const value=paymentSelect?.value??"cash";
      const payload=value.startsWith("credit:")?
        {payment:"credit",sourceLine:Number(value.slice(7))}:{payment:"cash"};
      actionTraining(lesson.key,payload);
    });
    target.append(tile);
  }
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
  text("current-job", state.currentJob?.name || "尚未就職");
  text("work-count", c.workCount + " 次（目前職業 " + c.jobWorkCount + " 次）");
  text("job-experience", c.jobExperience + " 點");
  text("job-level", state.jobLevel + " 級");
  // 原版 town_maker.cgi：每 100 經驗升一級，basic.cgi 達 15 級精通。
  // 只呈現目前職業的進度；masteredJob 是先前已精通的職業，兩者不得混用。
  const currentMasteryXp=state.currentJob?Math.max(0,c.jobExperience??0):0;
  const masteryTargetXp=1500;
  const masteryReached=Boolean(state.currentJob&&state.jobLevel>=15);
  const masteryText=!state.currentJob?"尚未就職":
    masteryReached?"已達精通門檻（15 級，"+currentMasteryXp+" 經驗）":
    "目前 "+Math.min(currentMasteryXp,masteryTargetXp)+" / "+masteryTargetXp+
      " 經驗（"+state.jobLevel+" / 15 級），距離精通還需 "+
      (masteryTargetXp-currentMasteryXp)+" 經驗";
  text("job-mastery-status",masteryText);
  el("job-mastery-bar").value=Math.min(currentMasteryXp,masteryTargetXp);
  text("jobs-mastery-status","目前職業精通進度："+masteryText+"。");
  text("mastered-job", c.masteredJob || "無");
  text("measurements", c.height + " 公分／" + c.weight + " 公斤");
  renderDining();
  renderRetail();
  renderVending();
  renderEquipment();
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
        "，依原版票價支付現金 "+money(result.fare)+"。");
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
      notify(messages.join(" "));
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
    } else if (message) notify(message);
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
  action("bank", { action: actionName, amount },
    (actionName === "deposit" ? "存款" : "提款") + "完成：" + money(amount));
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
  notify("已繼續單機遊戲。");
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
  if(state?.mode==="solo"&&state?.character&&!soloAtHome)
    renderSoloTime(); // 同步顯示遊戲時鐘，限時事件結束後也恢復快轉按鈕
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
el("facility-shortcuts").addEventListener("click",event=>{
  const button=event.target.closest("button[data-facility]");
  if(button)goToFacility(button.dataset.facility);
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
  try { state = await api("state"); render(); notify("遊戲資料已更新"); }
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
