import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const delay = ms => new Promise(done => setTimeout(done, ms));
async function freePort() {
  const server = createServer();
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => ok(port));
    });
  });
}
async function start(mode, seed) {
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), "town-web-"));
  if (seed) seed(directory);
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: root, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), GAME_MODE: mode, DATA_DIR: directory }
  });
  let log = "";
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  const url = "http://127.0.0.1:" + port;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(url + "/api/state", { signal: AbortSignal.timeout(400) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  if (!ready) {
    child.kill();
    throw new Error("無法啟動測試伺服器：" + log);
  }
  return {
    url,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise(done => child.once("exit", done));
        child.kill();
        await Promise.race([exited, delay(1500)]);
      }
      rmSync(directory, { force: true, recursive: true });
    }
  };
}
async function api(base, route, body, cookie) {
  const response = await fetch(base + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status, result: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

const defaultStats = () => Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","love","unique","etti"].map(key => [key,20]));

test("單機：原版配點限制、建角、選職、工作、存提款與冷卻", async () => {
  const srv = await start("solo");
  try {
    const initial = await api(srv.url, "state");
    assert.equal(initial.result.user.username, "單機玩家");
    const badStats = defaultStats();
    badStats.kokugo = 199;
    assert.equal((await api(srv.url, "character", { name: "測試居民", gender: "other", stats: badStats })).status, 400);
    const created = await api(srv.url, "character", { name: "測試居民", gender: "other", stats: defaultStats() });
    assert.equal(created.status, 200);
    assert.equal(created.result.jobs.find(job => job.key === "legacy-2").name, "日薪打工");
    const job = await api(srv.url, "job", { key: "legacy-2" });
    assert.equal(job.status, 200);
    const work = await api(srv.url, "work", {});
    assert.equal(work.status, 200);
    assert.equal(work.result.character.money, 101000);
    assert.equal(work.result.character.jobExperience >= 6, true);
    assert.equal(work.result.result.paid, 1000);
    assert.equal((await api(srv.url, "work", {})).status, 400);
    const deposit = await api(srv.url, "bank", { action: "deposit", amount: 2000 });
    assert.equal(deposit.status, 200);
    assert.equal(deposit.result.character.bank, 2000);
    assert.equal(deposit.result.character.money, 99000);
    const withdraw = await api(srv.url, "bank", { action: "withdraw", amount: 500 });
    assert.equal(withdraw.status, 200);
    assert.equal(withdraw.result.character.bank, 1500);
    assert.equal(withdraw.result.character.money, 99500);
    assert.equal((await api(srv.url, "bank", { action: "withdraw", amount: 2500 })).status, 400);
  } finally { await srv.stop(); }
});

test("多人：兩位玩家可獨立登入並看見同城居民", async () => {
  const srv = await start("multi");
  try {
    assert.equal((await api(srv.url, "state")).result.user, null);
    const a = await api(srv.url, "register", { username: "player_one", password: "pass-for-first-123" });
    assert.equal(a.status, 200);
    assert.ok(a.cookie);
    assert.equal((await api(srv.url, "character", { name: "第一位居民", gender: "male", stats: defaultStats() }, a.cookie)).status, 200);
    const b = await api(srv.url, "register", { username: "player_two", password: "pass-for-second-123" });
    assert.equal(b.status, 200);
    assert.equal((await api(srv.url, "character", { name: "第二位居民", gender: "female", stats: defaultStats() }, b.cookie)).status, 200);
    const view = await api(srv.url, "state", undefined, a.cookie);
    assert.equal(view.result.character.name, "第一位居民");
    assert.deepEqual(view.result.residents, ["第二位居民"]);
    await api(srv.url, "logout", {}, a.cookie);
    assert.equal((await api(srv.url, "state", undefined, a.cookie)).result.user, null);
  } finally { await srv.stop(); }
});


test("既有第一階段 SQLite 角色可無破壞升級資料欄位", async () => {
  const seed = directory => {
    const database = new DatabaseSync(join(directory, "solo.sqlite"));
    database.exec([
      "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);",
      "CREATE TABLE characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL UNIQUE, gender TEXT NOT NULL, town_id INTEGER NOT NULL, money INTEGER NOT NULL, bank INTEGER NOT NULL, body_energy INTEGER NOT NULL, brain_energy INTEGER NOT NULL, recovered_at INTEGER NOT NULL, job_id TEXT, work_progress INTEGER NOT NULL, last_work_at INTEGER NOT NULL, work_count INTEGER NOT NULL, height INTEGER NOT NULL, bmi REAL NOT NULL, stats_json TEXT NOT NULL);"
    ].join("\n"));
    database.prepare("INSERT INTO users(id,username,password_salt,password_hash,created_at) VALUES(1,?,?,?,?)")
      .run("__local_player__", "salt", "hash", Date.now());
    database.prepare("INSERT INTO characters(user_id,name,gender,town_id,money,bank,body_energy,brain_energy,recovered_at,job_id,work_progress,last_work_at,work_count,height,bmi,stats_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(1, "舊版居民", "other", 0, 50000, 1000, 10, 20, Date.now(), null, 0, 0, 2, 165, 22, JSON.stringify(defaultStats()));
    database.close();
  };
  const srv = await start("solo", seed);
  try {
    const state = await api(srv.url, "state");
    assert.equal(state.status, 200);
    assert.equal(state.result.character.name, "舊版居民");
    assert.equal(state.result.character.money, 50000);
    assert.equal(state.result.character.workCount, 2);
    assert.equal(state.result.character.jobExperience, 0);
    const deposited = await api(srv.url, "bank", { action: "deposit", amount: 1000 });
    assert.equal(deposited.status, 200);
    assert.equal(deposited.result.character.money, 49000);
    assert.equal(deposited.result.character.bank, 2000);
  } finally { await srv.stop(); }
});
