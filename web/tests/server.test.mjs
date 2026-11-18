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
    url, directory,
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
    const trained = await api(srv.url, "train", { key: "school-3" });
    assert.equal(trained.status, 200);
    assert.equal(trained.result.character.money, 35000);
    assert.equal(trained.result.character.stats.kokugo, 30);
    assert.equal(trained.result.schoolRemainingToday, true);
  } finally { await srv.stop(); }
});


test("單機：學校與健身房使用原始資料並防止重複取得能力值", async () => {
  const srv = await start("solo");
  try {
    const created = await api(srv.url, "character", {
      name: "訓練居民", gender: "other", stats: defaultStats()
    });
    assert.equal(created.status, 200);
    assert.equal(created.result.trainingLessons.filter(x => x.type === "school").length, 6);
    assert.equal(created.result.trainingLessons.filter(x => x.type === "gym").length, 9);

    const result = await api(srv.url, "train", {
      key: "school-2", price: 0, gained: { eigo: 99999 }
    });
    assert.equal(result.status, 200);
    assert.equal(result.result.character.stats.eigo, 30);
    assert.equal(result.result.character.money, 84000);
    assert.equal(result.result.trainingResult.paid, 16000);

    const duplicate = await api(srv.url, "train", { key: "school-3" });
    assert.equal(duplicate.status, 400);
    assert.equal((await api(srv.url, "state")).result.character.stats.kokugo, 21);

    const gym = await api(srv.url, "train", { key: "gym-3" });
    assert.equal(gym.status, 200);
    assert.equal(gym.result.character.money, 83200);
    assert.equal(gym.result.character.stats.kenkou, 23);
    const gymAgain = await api(srv.url, "train", { key: "gym-2" });
    assert.equal(gymAgain.status, 400);
    assert.equal((await api(srv.url, "state")).result.character.money, 83200);
    assert.equal((await api(srv.url, "train", { key: "gym-999" })).status, 404);
  } finally { await srv.stop(); }
});

test("多人：課程限制分別記錄在每位玩家資料中", async () => {
  const srv = await start("multi");
  try {
    const a = await api(srv.url, "register", { username: "trainuserone", password: "correct-horse-battery" });
    const b = await api(srv.url, "register", { username: "trainusertwo", password: "some-other-password" });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    await api(srv.url, "character", { name: "學員甲", gender: "female", stats: defaultStats() }, a.cookie);
    await api(srv.url, "character", { name: "學員乙", gender: "male", stats: defaultStats() }, b.cookie);
    const trained = await api(srv.url, "train", { key: "school-2" }, a.cookie);
    assert.equal(trained.status, 200);
    assert.equal(trained.result.schoolRemainingToday, true);
    assert.equal((await api(srv.url, "train", { key: "school-3" }, a.cookie)).status, 400);
    const other = await api(srv.url, "state", undefined, b.cookie);
    assert.equal(other.result.schoolRemainingToday, false);
    assert.equal(other.result.character.stats.eigo, 20);
    const trainedB = await api(srv.url, "train", { key: "school-2" }, b.cookie);
    assert.equal(trainedB.status, 200);
    assert.equal(trainedB.result.character.stats.eigo, 30);
    assert.equal((await api(srv.url, "train", { key: "gym-3" })).status, 401);
  } finally { await srv.stop(); }
});


test("單機：可配置原版街區圖示，切換城鎮後地圖保留", async () => {
  const srv = await start("solo");
  try {
    await api(srv.url, "character", { name: "地圖編輯者", gender: "other", stats: defaultStats() });
    const initial = await api(srv.url, "state");
    assert.equal(initial.result.map.configured, false);
    assert.equal(initial.result.map.editable, true);
    assert.equal(initial.result.map.cells.length, 192);
    const updated = await api(srv.url, "map/tile", { row: 0, column: 0, symbol: "銀行" });
    assert.equal(updated.status, 200);
    assert.equal(updated.result.map.configured, true);
    assert.equal(updated.result.map.cells[0].image, "bank.gif");
    assert.equal(updated.result.map.cells[0].raw, "銀行");
    assert.equal((await api(srv.url, "map/tile", { row: 1, column: 1, symbol: "../../secret" })).status, 400);
    assert.equal((await api(srv.url, "map/tile", { row: 12, column: 0, symbol: "銀行" })).status, 400);
    const next = await api(srv.url, "move", { townId: 1 });
    assert.equal(next.status, 200);
    assert.equal(next.result.map.configured, false);
    const back = await api(srv.url, "move", { townId: 0 });
    assert.equal(back.status, 200);
    assert.equal(back.result.map.cells[0].raw, "銀行");
    const removed = await api(srv.url, "map/tile", { row: 0, column: 0, symbol: "" });
    assert.equal(removed.status, 200);
    assert.equal(removed.result.map.cells[0].raw, "");
  } finally { await srv.stop(); }
});

test("多人：載入同一座街區地圖，但普通玩家無法修改伺服器地圖", async () => {
  const seed = directory => {
    const db = new DatabaseSync(join(directory, "multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, tiles_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const grid = Array(192).fill("");
    grid[0] = "駅";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(0, "京阪神ストリート", "legacy-import", JSON.stringify(grid), Date.now());
    db.close();
  };
  const srv = await start("multi", seed);
  try {
    const first = await api(srv.url, "register", { username: "mapresidentone", password: "password-for-map-one" });
    const second = await api(srv.url, "register", { username: "mapresidenttwo", password: "password-for-map-two" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    await api(srv.url, "character", { name: "地圖玩家甲", gender: "male", stats: defaultStats() }, first.cookie);
    await api(srv.url, "character", { name: "地圖玩家乙", gender: "female", stats: defaultStats() }, second.cookie);
    const viewA = await api(srv.url, "state", undefined, first.cookie);
    const viewB = await api(srv.url, "state", undefined, second.cookie);
    assert.equal(viewA.result.map.cells[0].raw, "駅");
    assert.equal(viewB.result.map.cells[0].raw, "駅");
    assert.equal(viewA.result.map.editable, false);
    assert.equal(viewB.result.map.editable, false);
    const forbidden = await api(srv.url, "map/tile", { row: 0, column: 0, symbol: "銀行" }, first.cookie);
    assert.equal(forbidden.status, 403);
    assert.equal((await api(srv.url, "state", undefined, second.cookie)).result.map.cells[0].raw, "駅");
  } finally { await srv.stop(); }
});


test("單機：從街區空地建屋、以原版費率支付、儲存後不允許覆蓋或再次建屋", async () => {
  const srv = await start("solo");
  try {
    const created = await api(srv.url, "character",
      { name: "購屋測試", gender: "other", stats: defaultStats() });
    assert.equal(created.status, 200);
    await api(srv.url, "move", { townId:3 });
    assert.equal((await api(srv.url, "map/tile", { row:0,column:0,symbol:"空地" })).status, 200);
    assert.equal((await api(srv.url, "map/tile", { row:0,column:1,symbol:"空地2" })).status, 200);
    const db = new DatabaseSync(join(srv.directory, "solo.sqlite"));
    try { db.prepare("UPDATE characters SET money=10000000 WHERE name='購屋測試'").run(); }
    finally { db.close(); }
    const built = await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash",price:1
    });
    assert.equal(built.status,200);
    assert.equal(built.result.houseResult.quote.total,6500000);
    assert.equal(built.result.character.money,3500000);
    assert.equal(built.result.houses.length,1);
    assert.equal(built.result.houses[0].name,"購屋測試的家");
    assert.equal(built.result.map.cells[0].category,"house");
    assert.equal(built.result.map.cells[0].image,"house/kamakura.gif");
    assert.equal((await api(srv.url, "map/tile", {row:0,column:0,symbol:""})).status,400);
    assert.equal((await api(srv.url, "house/build", {
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    })).status,400);
    assert.equal((await api(srv.url, "house/build", {
      row:0,column:1,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    })).status,400);
    const renamed = await api(srv.url,"house/rename",{
      houseId:built.result.houses[0].id,name:"湖畔住宅"
    });
    assert.equal(renamed.status,200);
    assert.equal(renamed.result.map.cells[0].label.includes("湖畔住宅"),true);
    assert.equal((await api(srv.url, "state")).result.character.money,3500000);
  } finally { await srv.stop(); }
});

test("多人：爭購同一塊地時只有一人成功，且房屋資料可以共享、不可竄改", async () => {
  const seed = directory => {
    const db = new DatabaseSync(join(directory, "multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, tiles_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const tiles = Array(192).fill("");
    tiles[0] = "空地";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?, ?,?)")
      .run(0,"京阪神ストリート","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv = await start("multi",seed);
  try {
    const a = await api(srv.url,"register",{username:"housingone",password:"housing-password-one"});
    const b = await api(srv.url,"register",{username:"housingtwo",password:"housing-password-two"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"建屋甲",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"建屋乙",gender:"female",stats:defaultStats()},b.cookie);
    const db = new DatabaseSync(join(srv.directory, "multi.sqlite"));
    try { db.prepare("UPDATE characters SET bank=100000000").run(); } finally { db.close(); }
    const options={row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"};
    const outcomes=await Promise.all([
      api(srv.url,"house/build",options,a.cookie),
      api(srv.url,"house/build",options,b.cookie)
    ]);
    assert.deepEqual(outcomes.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const resultA=await api(srv.url,"state",undefined,a.cookie);
    const resultB=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(resultA.result.townHouses.length,1);
    assert.equal(resultB.result.townHouses.length,1);
    assert.equal(resultA.result.map.cells[0].category,"house");
    assert.equal(resultB.result.map.cells[0].category,"house");
    const owner=resultA.result.townHouses[0];
    const enemyCookie=owner.ownerName==="建屋甲"?b.cookie:a.cookie;
    assert.equal((await api(srv.url,"house/rename",{houseId:owner.id,name:"竄改別人房屋"},enemyCookie)).status,400);
    assert.equal((await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"},enemyCookie)).status,403);
    const dbAfter=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      assert.equal(dbAfter.prepare("SELECT COUNT(*) n FROM houses").get().n,1);
      assert.equal(dbAfter.prepare("SELECT COUNT(*) n FROM characters WHERE bank=100000000-51500000").get().n,1);
      assert.equal(dbAfter.prepare("SELECT COUNT(*) n FROM characters WHERE bank=100000000").get().n,1);
    } finally { dbAfter.close(); }
  } finally { await srv.stop(); }
});


test("單機：出售住宅僅退地價、保留交易紀錄並可重新建屋", async () => {
  const srv = await start("solo");
  try {
    const created = await api(srv.url, "character",
      { name: "搬家居民", gender: "other", stats: defaultStats() });
    assert.equal(created.status, 200);
    await api(srv.url, "move", { townId:3 });
    await api(srv.url, "map/tile", { row:0,column:0,symbol:"空地2" });
    await api(srv.url, "map/tile", { row:0,column:1,symbol:"空地3" });
    const db = new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try { db.prepare("UPDATE characters SET money=20000000 WHERE name='搬家居民'").run(); }
    finally { db.close(); }
    const first = await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(first.status,200);
    assert.equal(first.result.character.money,13500000);
    assert.equal(first.result.houses[0].saleRefund,5000000);
    assert.equal(first.result.houseEvents.length,1);
    assert.equal(first.result.houseEvents[0].action,"built");
    const id=first.result.houses[0].id;
    const sold=await api(srv.url,"house/sell",{houseId:id,refund:999999999});
    assert.equal(sold.status,200);
    assert.equal(sold.result.houseSaleResult.refund,5000000);
    assert.equal(sold.result.character.money,18500000);
    assert.equal(sold.result.map.cells[0].raw,"空地2");
    assert.equal(sold.result.houses.length,0);
    assert.equal(sold.result.houseCatalog.canBuild,true);
    assert.deepEqual(sold.result.houseEvents.map(x=>x.action),["sold","built"]);
    assert.equal((await api(srv.url,"house/sell",{houseId:id})).status,400);
    assert.equal((await api(srv.url,"state")).result.character.money,18500000);
    const second=await api(srv.url,"house/build",{
      row:0,column:1,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(second.status,200);
    assert.equal(second.result.houses.length,1);
    assert.equal(second.result.houses[0].location,"A2");
    assert.notEqual(second.result.houses[0].id,id);
    assert.equal((await api(srv.url,"house/sell",{houseId:id})).status,400);
    assert.equal(second.result.houseEvents.length,3);
    assert.equal(second.result.character.money,12000000);
  } finally { await srv.stop(); }
});

test("多人：非屋主不得出售，兩個同時出售請求只退一次錢並釋放土地", async () => {
  const seed = directory => {
    const db = new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, tiles_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const tiles = Array(192).fill("");
    tiles[0]="空地3";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(3,"和歌山アイランド","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try {
    const a=await api(srv.url,"register",{username:"houseSellerOne",password:"house-seller-password-one"});
    const b=await api(srv.url,"register",{username:"houseBuyerTwo",password:"house-buyer-password-two"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"屋主甲",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"買家乙",gender:"female",stats:defaultStats()},b.cookie);
    await api(srv.url,"move",{townId:3},a.cookie);
    await api(srv.url,"move",{townId:3},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db.prepare("UPDATE characters SET bank=20000000").run();} finally {db.close();}
    const first=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },a.cookie);
    assert.equal(first.status,200);
    const id=first.result.houses[0].id;
    assert.equal((await api(srv.url,"house/sell",{houseId:id},b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/sell",{houseId:id})).status,401);
    const sales=await Promise.all([
      api(srv.url,"house/sell",{houseId:id},a.cookie),
      api(srv.url,"house/sell",{houseId:id},a.cookie)
    ]);
    assert.deepEqual(sales.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const after=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(after.result.character.money,5100000);
    assert.equal(after.result.character.bank,13500000);
    assert.equal(after.result.map.cells[0].raw,"空地3");
    assert.equal(after.result.townHouses.length,0);
    assert.equal(after.result.houseEvents.filter(x=>x.action==="sold").length,1);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.character.money,100000);
    const repurchased=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },b.cookie);
    assert.equal(repurchased.status,200);
    assert.equal(repurchased.result.townHouses[0].ownerName,"買家乙");
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.houseEvents.length,2);
  } finally { await srv.stop(); }
});
