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


test("單機：房屋室內欄位、留言板與搬家後個人資料保留", async () => {
  const srv = await start("solo");
  try {
    assert.equal((await api(srv.url, "character", {
      name:"室內測試",gender:"other",stats:defaultStats()
    })).status,200);
    await api(srv.url,"move",{townId:3});
    await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"});
    await api(srv.url,"map/tile",{row:0,column:1,symbol:"空地2"});
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {db.prepare("UPDATE characters SET money=20000000 WHERE name='室內測試'").run();}
    finally {db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:1,payment:"cash"
    });
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    const visitRoute="house/visit?houseId="+houseId;
    const initially=await api(srv.url,visitRoute);
    assert.equal(initially.status,200);
    assert.equal(initially.result.capacity,3);
    assert.equal(initially.result.available.length,0);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"第一區"},{type:"3",title:"屋主公告"}]
    })).status,400);
    const setting=await api(srv.url,"house/room/config",{
      houseId,slots:[
        {type:"0",title:"一般留言區"},
        {type:"3",title:"公告區"},
        {type:"2",title:"參考網站",url:"https://example.com/town"}
      ]
    });
    assert.equal(setting.status,200);
    const room=await api(srv.url,visitRoute);
    assert.equal(room.result.available.length,3);
    assert.equal(room.result.selected.type,"0");
    assert.equal(room.result.owner,true);
    const posted=await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"我的第一篇室內留言"
    });
    assert.equal(posted.status,200);
    const announcement=await api(srv.url,"house/room/post",{
      houseId,slotIndex:1,body:"屋主新公告"
    });
    assert.equal(announcement.status,200);
    assert.equal((await api(srv.url,visitRoute)).result.posts[0].body,"我的第一篇室內留言");
    assert.equal((await api(srv.url,visitRoute+"&slot=1")).result.posts[0].body,"屋主新公告");
    assert.equal((await api(srv.url,visitRoute+"&slot=2")).result.selected.url,"https://example.com/town");
    const sold=await api(srv.url,"house/sell",{houseId});
    assert.equal(sold.status,200);
    assert.equal((await api(srv.url,visitRoute)).status,400);
    const second=await api(srv.url,"house/build",{
      row:0,column:1,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(second.status,200);
    const newId=second.result.houses[0].id;
    const moved=await api(srv.url,"house/visit?houseId="+newId);
    assert.equal(moved.status,200);
    assert.equal(moved.result.capacity,1);
    assert.deepEqual(moved.result.available.map(s=>s.title),["一般留言區"]);
    assert.equal(moved.result.posts[0].body,"我的第一篇室內留言");
  } finally {await srv.stop();}
});

test("多人：訪客可留言但不可改設定，屋主公告與自訂網址受權限限制", async () => {
  const seed=directory => {
    const db=new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,original_name TEXT NOT NULL DEFAULT '',original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    const tiles=Array(192).fill("");
    tiles[0]="空地";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(3,"和歌山アイランド","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try {
    const a=await api(srv.url,"register",{username:"roomOwner",password:"good-long-room-password1"});
    const b=await api(srv.url,"register",{username:"roomVisitor",password:"good-long-room-password2"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"房主玩家",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"參觀玩家",gender:"female",stats:defaultStats()},b.cookie);
    await api(srv.url,"move",{townId:3},a.cookie);
    await api(srv.url,"move",{townId:3},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try { db.prepare("UPDATE characters SET bank=20000000").run(); }
    finally {db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },a.cookie);
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    const visit="house/visit?houseId="+houseId;
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"偽造"}]
    },b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"大家留言"}]
    },a.cookie)).status,200);
    const guest=await api(srv.url,visit,undefined,b.cookie);
    assert.equal(guest.status,200);
    assert.equal(guest.result.owner,false);
    assert.equal(guest.result.editableSlots,null);
    assert.equal(guest.result.canPost,true);
    const post=await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"訪客的留言"
    },b.cookie);
    assert.equal(post.status,200);
    assert.equal((await api(srv.url,visit,undefined,a.cookie)).result.posts[0].body,"訪客的留言");
    const visitorPostId=(await api(srv.url,visit,undefined,b.cookie)).result.posts[0].id;
    assert.equal((await api(srv.url,"house/room/delete",{
      houseId,postId:visitorPostId
    },b.cookie)).status,200);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"3",title:"屋主公告"}]
    },a.cookie)).status,200);
    const readOnly=await api(srv.url,visit,undefined,b.cookie);
    assert.equal(readOnly.result.canPost,false);
    assert.equal(readOnly.result.posts.length,0);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"訪客越權公告"
    },b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"正式公告"
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).result.posts[0].body,"正式公告");
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"1",title:"商店"}]
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"2",title:"偽連結",url:"javascript:alert(1)"}]
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"2",title:"外部網站",url:"https://example.org/"}]
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).result.selected.url,"https://example.org/");
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"不允許留言"
    },b.cookie)).status,400);
    await api(srv.url,"move",{townId:0},b.cookie);
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).status,400);
    assert.equal((await api(srv.url,visit)).status,401);
  } finally { await srv.stop(); }
});


test("單機：改裝保留住宅位置與留言，室內降級隱藏額外欄位，升級後恢復", async () => {
  const srv=await start("solo");
  try {
    await api(srv.url,"character",{name:"改裝玩家",gender:"other",stats:defaultStats()});
    await api(srv.url,"move",{townId:3});
    await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"});
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {db.prepare("UPDATE characters SET money=90000000 WHERE name='改裝玩家'").run();}
    finally {db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"常用留言"}]
    })).status,200);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"改裝前留言"
    })).status,200);
    const improved=await api(srv.url,"house/remodel",{
      houseId,image:"house/house_1.gif",interiorRank:0,total:1,payment:"bank"
    });
    assert.equal(improved.status,200);
    assert.equal(improved.result.houseRemodelResult.quote.total,13600000);
    assert.equal(improved.result.houses[0].image,"house/house_1.gif");
    assert.equal(improved.result.houses[0].interiorRank,0);
    assert.equal(improved.result.character.money,90000000-6500000-13600000);
    assert.equal(improved.result.map.cells[0].image,"house/house_1.gif");
    assert.equal(improved.result.map.cells[0].raw,"webhouse_"+houseId+"=空地");
    assert.equal(improved.result.houseRemodelEvents[0].amount,13600000);
    assert.equal(improved.result.houses[0].purchasePrice,6500000);
    const first=await api(srv.url,"house/visit?houseId="+houseId);
    assert.equal(first.result.capacity,4);
    assert.equal(first.result.posts[0].body,"改裝前留言");
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[
        {type:"0",title:"常用留言"},
        {type:"3",title:"公告區"},
        {type:"2",title:"房屋網站",url:"https://example.com/"},
        {type:"0",title:"第四區"}
      ]
    })).status,200);
    const reduced=await api(srv.url,"house/remodel",{
      houseId,image:null,interiorRank:3
    });
    assert.equal(reduced.status,200);
    assert.equal(reduced.result.houseRemodelResult.quote.total,1000000);
    assert.equal(reduced.result.houses[0].interiorRank,3);
    const one=await api(srv.url,"house/visit?houseId="+houseId);
    assert.equal(one.result.capacity,1);
    assert.equal(one.result.available.length,1);
    assert.equal((await api(srv.url,"house/visit?houseId="+houseId+"&slot=2")).status,400);
    const again=await api(srv.url,"house/remodel",{
      houseId,image:null,interiorRank:0
    });
    assert.equal(again.status,200);
    const restored=await api(srv.url,"house/visit?houseId="+houseId+"&slot=2");
    assert.equal(restored.status,200);
    assert.equal(restored.result.selected.title,"房屋網站");
    assert.equal(restored.result.selected.url,"https://example.com/");
    const firstAgain=await api(srv.url,"house/visit?houseId="+houseId+"&slot=0");
    assert.equal(firstAgain.result.posts[0].body,"改裝前留言");
    assert.equal(again.result.houseRemodelEvents.length,3);
  } finally {await srv.stop();}
});

test("多人：非屋主無法改裝，同時改裝依伺服器餘額只扣一次", async () => {
  const seed=directory => {
    const db=new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    const tiles=Array(192).fill("");
    tiles[0]="空地";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(3,"和歌山アイランド","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try {
    const a=await api(srv.url,"register",{username:"remodelOwner",password:"secure-remodel-owner"});
    const b=await api(srv.url,"register",{username:"remodelGuest",password:"secure-remodel-guest"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"房主",gender:"other",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"其他居民",gender:"other",stats:defaultStats()},b.cookie);
    await api(srv.url,"move",{townId:3},a.cookie);
    await api(srv.url,"move",{townId:3},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db.prepare("UPDATE characters SET bank=10000000").run();}
    finally {db.close();}
    const house=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },a.cookie);
    assert.equal(house.status,200);
    const houseId=house.result.houses[0].id;
    const db2=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db2.prepare("UPDATE characters SET money=2000000 WHERE name='房主'").run();}
    finally {db2.close();}
    const options={houseId,image:"house/house_1.gif",interiorRank:null,price:1};
    assert.equal((await api(srv.url,"house/remodel",options,b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/remodel",{...options,interiorRank:99},a.cookie)).status,400);
    const result=await Promise.all([
      api(srv.url,"house/remodel",options,a.cookie),
      api(srv.url,"house/remodel",options,a.cookie)
    ]);
    assert.deepEqual(result.map(r=>r.status).sort((x,y)=>x-y),[200,400]);
    const stateA=await api(srv.url,"state",undefined,a.cookie);
    const stateB=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(stateA.result.character.money,400000);
    assert.equal(stateA.result.character.bank,3500000);
    assert.equal(stateA.result.houseRemodelEvents.length,1);
    assert.equal(stateB.result.houseRemodelEvents.length,0);
    assert.equal(stateA.result.townHouses[0].image,"house/house_1.gif");
    assert.equal(stateB.result.map.cells[0].image,"house/house_1.gif");
    assert.equal((await api(srv.url,"house/remodel",{houseId,image:null,interiorRank:null},a.cookie)).status,400);
    assert.equal((await api(srv.url,"house/remodel",options)).status,401);
    assert.equal((await api(srv.url,"house/remodel",{...options,houseId:999},a.cookie)).status,400);
  } finally {await srv.stop();}
});


test("單機：普通與定期存款每日計息一次，帳簿記錄與全額解約均能持久化", async () => {
  const srv=await start("solo");
  try {
    const created=await api(srv.url,"character",{
      name:"銀行測試居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.bankAccount.termBalance,0);
    assert.equal(created.result.bankLedger.length,0);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      db.prepare("UPDATE characters SET money=5000000,bank=2000000 WHERE name='銀行測試居民'").run();
      db.prepare("UPDATE bank_accounts SET term_balance=3000000,last_interest_day='2025-01-01'").run();
    } finally {db.close();}
    const first=await api(srv.url,"state");
    assert.equal(first.status,200);
    assert.equal(first.result.character.bank,2010000);
    assert.equal(first.result.bankAccount.termBalance,3030000);
    assert.deepEqual(first.result.bankLedger.map(x=>[x.action,x.credit]),[
      ["超級定期利息",30000],["普通存款利息",10000]
    ]);
    const second=await api(srv.url,"state");
    assert.equal(second.result.character.bank,2010000);
    assert.equal(second.result.bankAccount.termBalance,3030000);
    assert.equal(second.result.bankLedger.length,2);
    assert.equal((await api(srv.url,"bank/term",{action:"deposit",units:0.5})).status,400);
    assert.equal((await api(srv.url,"bank/term",{action:"deposit",units:10})).status,400);
    const deposit=await api(srv.url,"bank/term",{action:"deposit",units:2});
    assert.equal(deposit.status,200);
    assert.equal(deposit.result.character.money,3000000);
    assert.equal(deposit.result.bankAccount.termBalance,5030000);
    assert.equal(deposit.result.bankLedger[0].credit,2000000);
    assert.equal((await api(srv.url,"bank/term",{action:"cancel",amount:1})).status,400);
    const canceled=await api(srv.url,"bank/term",{action:"cancel"});
    assert.equal(canceled.status,200);
    assert.equal(canceled.result.character.money,8030000);
    assert.equal(canceled.result.bankAccount.termBalance,0);
    assert.equal(canceled.result.bankLedger[0].debit,5030000);
    assert.equal((await api(srv.url,"bank/term",{action:"cancel"})).status,400);
    const ordinary=await api(srv.url,"bank",{action:"deposit",amount:1000000});
    assert.equal(ordinary.status,200);
    assert.equal(ordinary.result.character.money,7030000);
    assert.equal(ordinary.result.character.bank,3010000);
    assert.equal(ordinary.result.bankLedger[0].type,"ordinary");
    assert.equal(ordinary.result.bankLedger[0].balance,3010000);
    const latest=await api(srv.url,"state");
    assert.equal(latest.result.bankLedger.length,5);
    assert.equal(latest.result.bankAccount.termBalance,0);
    assert.equal(latest.result.character.money,7030000);
  } finally {await srv.stop();}
});

test("多人：普通帳戶與定期獨立保存，同一帳號並行請求不能超額扣款或重複解約",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{
      username:"bankAccountOwner",password:"bank-account-owner-pass"
    });
    const b=await api(srv.url,"register",{
      username:"bankAccountGuest",password:"bank-account-guest-pass"
    });
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"帳戶甲",gender:"male",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"帳戶乙",gender:"female",stats:defaultStats()
    },b.cookie)).status,200);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      db.prepare("UPDATE characters SET money=5000000,bank=1000000 WHERE name='帳戶甲'").run();
    } finally {db.close();}
    const option={action:"deposit",units:4};
    const two=await Promise.all([
      api(srv.url,"bank/term",option,a.cookie),
      api(srv.url,"bank/term",option,a.cookie)
    ]);
    assert.deepEqual(two.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const owner=await api(srv.url,"state",undefined,a.cookie);
    const guest=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(owner.result.character.money,1000000);
    assert.equal(owner.result.bankAccount.termBalance,4000000);
    assert.equal(owner.result.bankLedger.length,1);
    assert.equal(guest.result.bankAccount.termBalance,0);
    assert.equal(guest.result.bankLedger.length,0);
    const canceled=await Promise.all([
      api(srv.url,"bank/term",{action:"cancel"},a.cookie),
      api(srv.url,"bank/term",{action:"cancel"},a.cookie)
    ]);
    assert.deepEqual(canceled.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const after=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(after.result.character.money,5000000);
    assert.equal(after.result.bankAccount.termBalance,0);
    assert.equal(after.result.bankLedger.length,2);
    const withdrawals=await Promise.all([
      api(srv.url,"bank",{action:"withdraw",amount:750000},a.cookie),
      api(srv.url,"bank",{action:"withdraw",amount:750000},a.cookie)
    ]);
    assert.deepEqual(withdrawals.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const end=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(end.result.character.bank,250000);
    assert.equal(end.result.character.money,5750000);
    assert.equal(end.result.bankLedger.length,3);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.bankLedger.length,0);
    assert.equal((await api(srv.url,"bank/term",{action:"deposit",units:1})).status,401);
  } finally {await srv.stop();}
});
