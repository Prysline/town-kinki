const el = id => document.getElementById(id);
let state = null;
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
        selectedMapCell = name;
        if (!el("map-edit-toggle").checked) {
          selectedHouseSpot = { row, column: col };
          updateHouseQuote();
        }
        text("map-selection", name + "：" + cell.label +
          (cell.raw && cell.category === "unknown" ? "（" + cell.raw + "）" : ""));
        if (map.editable && el("map-edit-toggle").checked) {
          action("map/tile", { row, column: col, symbol: el("map-palette").value },
            name + " 的街區內容已儲存。");
        } else {
          board.querySelectorAll(".map-cell.selected").forEach(node => node.classList.remove("selected"));
          button.classList.add("selected");
        }
      });
      board.append(button);
    }
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
    const box = document.createElement("form");
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
    box.append(img, title, where, label, button);
    box.addEventListener("submit", event => {
      event.preventDefault();
      action("house/rename", { houseId: house.id, name: input.value }, "已更新住宅名稱。");
    });
    listing.append(box);
  }
  updateHouseQuote();
}

function renderTowns() {
  const target = el("towns");
  target.replaceChildren();
  for (const town of state.towns) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "town" + (town.id === state.character.townId ? " active" : "");
    button.disabled = town.id === state.character.townId;
    const title = document.createElement("span");
    const hint = document.createElement("small");
    title.textContent = town.name;
    hint.textContent = town.id === state.character.townId ? "目前所在地" : "前往這個城鎮";
    button.append(title, hint);
    button.addEventListener("click", () => action("move", { townId: town.id }, "已移動至" + town.name));
    target.append(button);
  }
}

function renderJobs() {
  if (!state?.character) return;
  const target = el("jobs");
  const search = el("job-search").value.trim().toLocaleLowerCase("zh-TW");
  const availableOnly = el("job-filter").value === "available";
  const filtered = state.jobs.filter(job =>
    (!availableOnly || !job.reason) && job.name.toLocaleLowerCase("zh-TW").includes(search)
  );
  text("job-count", "符合條件：" + filtered.length + " / " + state.jobs.length);
  target.replaceChildren();
  for (const job of filtered) {
    const row = document.createElement("div");
    row.className = "job" + (job.key === state.character.jobId ? " active" : "");
    const meta = document.createElement("div");
    const title = document.createElement("span");
    const desc = document.createElement("small");
    title.textContent = job.name + (job.translated ? "" : "（未翻譯）");
    desc.textContent = "薪資 " + money(job.salary) + "／每 " + job.payEvery +
      " 次工作 · 體力 " + job.bodyCost + " · 頭腦 " + job.brainCost +
      (job.reason ? " · " + job.reason : "");
    meta.append(title, desc);
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

function renderTraining() {
  const byType = {
    school: el("school-lessons"),
    gym: el("gym-lessons")
  };
  Object.values(byType).forEach(target => target.replaceChildren());
  const statusSchool = state.schoolRemainingToday ? "今天已完成課程" : "今天還可以上課";
  const wait = state.gymCooldownMs ?? 0;
  text("school-status", statusSchool);
  text("gym-status", wait > 0 ? "距離下次訓練約 " + Math.ceil(wait / 60_000) + " 分鐘" : "現在可以訓練");
  for (const lesson of state.trainingLessons || []) {
    const target = byType[lesson.type];
    if (!target) continue;
    const tile = document.createElement("div");
    tile.className = "training-tile";
    const name = document.createElement("strong");
    name.textContent = lesson.name;
    const cost = document.createElement("p");
    cost.className = "small";
    cost.textContent = "費用 " + money(lesson.price) + "，" +
      (lesson.type === "school" ? "頭腦" : "身體") +
      "能量消耗 " + lesson.energyCost;
    const gains = document.createElement("p");
    gains.className = "small";
    const values = Object.entries(lesson.gains)
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => (labels[key] || key) + " +" + amount);
    gains.textContent = values.length ? values.join("、") : "沒有額外能力增幅";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = lesson.reason ? "目前不可進行" : lesson.type === "school" ? "參加課程" : "開始訓練";
    action.disabled = Boolean(lesson.reason);
    if (lesson.reason) {
      const blocked = document.createElement("p");
      blocked.className = "training-blocked";
      blocked.textContent = lesson.reason;
      tile.append(name, cost, gains, blocked, action);
    } else {
      tile.append(name, cost, gains, action);
    }
    action.addEventListener("click", () => actionTraining(lesson.key));
    target.append(tile);
  }
}

function actionTraining(key) {
  action("train", { key });
}

function render() {
  if (!state) return;
  const solo = state.mode === "solo";
  text("mode", solo ? "單機模式" : "多人模式");
  el("auth").hidden = solo || Boolean(state.user);
  el("create").hidden = !state.user || Boolean(state.character);
  el("game").hidden = !state.character;
  el("logout").hidden = solo || !state.user;
  if (!state.character) return;
  const c = state.character;
  text("character-name", c.name);
  text("current-town", state.towns.find(t => t.id === c.townId)?.name || "未知");
  text("money", money(c.money));
  text("bank", money(c.bank));
  text("body-energy", c.bodyEnergy + " / " + state.maxBodyEnergy);
  text("brain-energy", c.brainEnergy + " / " + state.maxBrainEnergy);
  text("current-job", state.currentJob?.name || "尚未就職");
  text("work-count", c.workCount + " 次（目前職業 " + c.jobWorkCount + " 次）");
  text("job-experience", c.jobExperience + " 點");
  text("job-level", state.jobLevel + " 級");
  text("mastered-job", c.masteredJob || "無");
  text("measurements", c.height + " 公分／" + c.weight + " 公斤");
  const ready = Boolean(state.currentJob) && state.workCooldownMs === 0;
  el("work").disabled = !ready;
  text("cooldown", !state.currentJob ? "請先前往職業介紹所選擇工作。" :
    state.workCooldownMs > 0 ? "距離下次工作約 " + Math.ceil(state.workCooldownMs / 1000) + " 秒。" :
      "工作冷卻時間已結束。");
  const attrs = el("attributes");
  attrs.replaceChildren();
  for (const [key, label] of Object.entries(labels)) addRow(attrs, label, c.stats[key] ?? 0);
  text("residents", state.residents.length ? state.residents.join("、") : "目前沒有其他玩家在這個城鎮。");
  renderTowns();
  renderTownMap();
  renderHouses();
  renderTraining();
  renderJobs();
}

async function action(path, data, message) {
  try {
    state = await api(path, data);
    if (path === "work") {
      const result = state.result;
      const messages = ["工作完成，職業經驗 +" + result.experienceGain + " 點。"];
      if (result.paid) messages.push("獲得薪資 " + money(result.paid) + "。");
      if (result.bonus) messages.push("升級獎金 " + money(result.bonus) + "。");
      if (result.leveledUp) messages.push("職業等級提升至 " + result.jobLevel + " 級。");
      if (result.mastered) messages.push("已精通目前職業，開放相關進階職業。");
      notify(messages.join(" "));
    } else if (path === "house/build") {
      notify("住宅建造完成，費用：" + money(state.houseResult.quote.total) + "。");
    } else if (path === "train") {
      const result = state.trainingResult;
      const gains = Object.entries(result.gained)
        .filter(([, amount]) => amount > 0)
        .map(([key, amount]) => (labels[key] || key) + " +" + amount)
        .join("、");
      notify("完成" + result.name + "，花費 " + money(result.paid) +
        (gains ? "，能力提升：" + gains : "") + "。");
    } else if (message) notify(message);
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
el("logout").addEventListener("click", async () => {
  try { await api("logout", {}); state = await api("state"); render(); notify("已登出"); }
  catch (error) { notify(error.message, true); }
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
el("map-edit-toggle").addEventListener("change", () => {
  el("map-palette").disabled = !el("map-edit-toggle").checked;
  text("map-selection", el("map-edit-toggle").checked
    ? "編輯模式已啟用。點選街區格子即可設定為選單中的設施。"
    : "編輯模式已關閉。點選格子可查看位置與設施。");
});
el("refresh").addEventListener("click", async () => {
  try { state = await api("state"); render(); notify("遊戲資料已更新"); }
  catch (error) { notify(error.message, true); }
});
el("work").addEventListener("click", () => action("work", {}));
el("job-search").addEventListener("input", renderJobs);
el("job-filter").addEventListener("change", renderJobs);
(async () => {
  try { state = await api("state"); render(); }
  catch (error) { notify("無法連線至遊戲伺服器：" + error.message, true); }
})();
setInterval(async () => {
  if (!state?.character) return;
  try { state = await api("state"); render(); } catch {}
}, 30000);
