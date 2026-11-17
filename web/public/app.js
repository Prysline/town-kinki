const el = id => document.getElementById(id);
let state = null;
const labels = {
  kokugo:"國語",suugaku:"數學",rika:"理科",syakai:"社會",eigo:"英語",
  ongaku:"音樂",bijutu:"美術",looks:"外貌",tairyoku:"體力",
  kenkou:"健康",speed:"速度",power:"力量",wanryoku:"臂力",
  kyakuryoku:"腿力",love:"魅力",unique:"幽默",etti:"性感"
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
  text("body-energy", c.bodyEnergy + " / 100");
  text("brain-energy", c.brainEnergy + " / 100");
  text("current-job", state.currentJob?.name || "尚未就職");
  text("work-count", c.workCount + " 次");
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
  renderJobs();
}

async function action(path, data, message) {
  try {
    state = await api(path, data);
    if (path === "work") {
      const amount = state.result.paid;
      notify(amount ? "本次工作獲得 " + money(amount) + "。" : "完成工作，尚未達到薪資結算次數。");
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
el("create-form").addEventListener("submit", event => {
  event.preventDefault();
  action("character", formValues(event.currentTarget), "角色建立完成");
});
el("logout").addEventListener("click", async () => {
  try { await api("logout", {}); state = await api("state"); render(); notify("已登出"); }
  catch (error) { notify(error.message, true); }
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
