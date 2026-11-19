import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  TOWNS, WORK_COOLDOWN_MS, decodeLegacyText, parseLegacyJobs,
  createCharacterData, recoverEnergy, jobEligibility, selectJob, performWork,
  maxBodyEnergy, maxBrainEnergy
} from "./engine.mjs";
import { parseLegacySchool, parseLegacyGym, calendarDay, trainingAvailability, performTraining } from "./training.mjs";
import { initTownMapTable, bootstrapLegacyTownMaps, publicTownMap, editTownTile } from "./town-storage.mjs";
import { parseHouseCatalog, initHousingTables, listHouses, publicHouseCatalog, buildHouse, renameHouse, sellHouse, getHouseSaleQuote, listHouseEvents, remodelHouse, listHouseRemodelEvents } from "./housing.mjs";
import { initRoomsTables, ROOM_TYPES, setRoomSlots, viewRoom, addRoomPost, deleteRoomPost } from "./rooms.mjs";
import { parseLegacyMeals, eatMeal, deriveCondition, hungerStatus, physiqueStatus, MEAL_COOLDOWN_MS } from "./dining.mjs";
import { healthStatus, settleDailyHealth, conditionWithIllness, getTreatmentQuote, treatAtHospital } from "./health.mjs";
import { initCharacterEvents, settleDailyIllnessEvent, listCharacterEvents, getCouponBalance } from "./events.mjs";
import { getCockroachChallenge,claimCockroach } from "./event-cockroach.mjs";
import { parseLegacyInsurance, initInventoryTables, inventoryOverview, hasActiveHealthInsurance, listInsurancePurchases, buyHealthInsurance } from "./inventory.mjs";
import { listLegacyInventoryItems } from "./legacy-inventory.mjs";
import { initLegacyItemUseTables, listLegacyItemActions, listLegacyItemUseHistory, useLegacyItem } from "./legacy-item-use.mjs";
import { initBankTables, settleBankInterest, bankOperation, bankOverview, bankLedger, transferToPlayer, BANK_TRANSFER_LIMIT, NEW_MEMBER_DAYS, NEW_MEMBER_TRANSFER_LIMIT, bankLoanOverview, borrowBankLoan, payoffBankLoan } from "./banking.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(ROOT, "..");
const STATIC_ROOT = resolve(ROOT, "public");
const IMG_ROOT = resolve(REPO_ROOT, "img");
const MODE = process.env.GAME_MODE === "multi" ? "multi" : "solo";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const COOKIE = "town_web_session";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const DATA_DIR = resolve(process.env.DATA_DIR || resolve(ROOT, "data"));
const GAME_TIMEZONE = process.env.GAME_TIMEZONE || "Asia/Taipei";
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(resolve(DATA_DIR, MODE + ".sqlite"));
db.exec([
  "PRAGMA journal_mode=WAL;",
  "PRAGMA foreign_keys=ON;",
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL UNIQUE, gender TEXT NOT NULL, town_id INTEGER NOT NULL, money INTEGER NOT NULL, bank INTEGER NOT NULL, body_energy INTEGER NOT NULL, brain_energy INTEGER NOT NULL, recovered_at INTEGER NOT NULL, job_id TEXT, work_progress INTEGER NOT NULL, last_work_at INTEGER NOT NULL, work_count INTEGER NOT NULL, height INTEGER NOT NULL, bmi REAL NOT NULL, stats_json TEXT NOT NULL);"
].join("\n"));

// 舊版雛形資料庫可直接升級，避免已建立的角色在更新後無法讀取。
for (const [column, definition] of [
  ["weight", "REAL NOT NULL DEFAULT 60"],
  ["job_experience", "INTEGER NOT NULL DEFAULT 0"],
  ["job_work_count", "INTEGER NOT NULL DEFAULT 0"],
  ["mastered_job", "TEXT"],
  ["last_school_day", "TEXT NOT NULL DEFAULT ''"],
  ["last_gym_at", "INTEGER NOT NULL DEFAULT 0"],
  ["gym_ready_at", "INTEGER NOT NULL DEFAULT 0"],
  ["created_at", "INTEGER NOT NULL DEFAULT 0"],
  ["last_meal_at", "INTEGER NOT NULL DEFAULT 0"],
  ["health_index", "INTEGER NOT NULL DEFAULT 50"],
  ["last_health_day", "TEXT NOT NULL DEFAULT ''"],
  ["last_event_day", "TEXT NOT NULL DEFAULT ''"],
  ["kpoint", "INTEGER NOT NULL DEFAULT 0"]
]) {
  const currentColumns = db.prepare("PRAGMA table_info(characters)").all();
  if (!currentColumns.some(info => info.name === column)) {
    db.exec("ALTER TABLE characters ADD COLUMN " + column + " " + definition);
  }
}

initTownMapTable(db);
initHousingTables(db);
initRoomsTables(db);
initBankTables(db);
initCharacterEvents(db);
initInventoryTables(db);
initLegacyItemUseTables(db);
const houseCatalog = parseHouseCatalog(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT, "town_ini.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT, "command.pl")))
);
const importedTownIds = bootstrapLegacyTownMaps(db, REPO_ROOT);

const jobPath = resolve(REPO_ROOT, "dat_dir", "job.cgi");
if (!existsSync(jobPath)) throw new Error("找不到原始職業檔案：" + jobPath);
const jobs = parseLegacyJobs(decodeLegacyText(readFileSync(jobPath)));
if (!jobs.length) throw new Error("無法讀取舊版職業資料，請檢查 dat_dir/job.cgi");
const jobsByKey = new Map(jobs.map(job => [job.key, job]));
const trainingLessons = [
  ...parseLegacySchool(decodeLegacyText(readFileSync(resolve(REPO_ROOT, "dat_dir", "school.cgi")))),
  ...parseLegacyGym(decodeLegacyText(readFileSync(resolve(REPO_ROOT, "dat_dir", "gym.cgi"))))
];
const trainingByKey = new Map(trainingLessons.map(lesson => [lesson.key, lesson]));
const meals = [
  ...parseLegacyMeals(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))),"main"),
  ...parseLegacyMeals(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syokudou2.cgi"))),"second")
];
const mealsByKey = new Map(meals.map(meal => [meal.key,meal]));
const insuranceItem=parseLegacyInsurance(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))));

const sessionHash = token => createHash("sha256").update(token).digest("hex");
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString("hex");

function getSoloUser() {
  let user = db.prepare("SELECT * FROM users WHERE username=?").get("__local_player__");
  if (!user) {
    const salt = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)")
      .run("__local_player__", salt, passwordHash(randomBytes(32).toString("hex"), salt), Date.now());
    user = db.prepare("SELECT * FROM users WHERE username=?").get("__local_player__");
  }
  return user;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(item => {
    const i = item.indexOf("=");
    return i < 0 ? ["", ""] : [item.slice(0, i).trim(), item.slice(i + 1).trim()];
  }));
}

function getUser(req) {
  if (MODE === "solo") return getSoloUser();
  const token = parseCookies(req)[COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?")
    .get(sessionHash(token), Date.now()) ?? null;
}

function newSession(res, userId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(sessionHash(token), userId, Date.now() + 7 * 86400000);
  res.setHeader("Set-Cookie", COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800" + (COOKIE_SECURE ? "; Secure" : ""));
}

function clearSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sessionHash(token));
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (COOKIE_SECURE ? "; Secure" : ""));
}

function characterFromRow(row) {
  if (!row) return null;
  return {
    name: row.name, gender: row.gender, townId: row.town_id,
    money: row.money, bank: row.bank, bodyEnergy: row.body_energy,
    brainEnergy: row.brain_energy, recoveredAt: row.recovered_at,
    jobId: row.job_id, workProgress: row.work_progress,
    lastWorkAt: row.last_work_at, workCount: row.work_count,
    height: row.height, weight: row.weight, bmi: row.bmi,
    jobExperience: row.job_experience, jobWorkCount: row.job_work_count,
    masteredJob: row.mastered_job, stats: JSON.parse(row.stats_json),
    lastSchoolDay: row.last_school_day, lastGymAt: row.last_gym_at,
    gymReadyAt: row.gym_ready_at, lastMealAt: row.last_meal_at,
    healthIndex: row.health_index, lastHealthDay: row.last_health_day,
    lastEventDay: row.last_event_day,
    kpoint: row.kpoint
  };
}

function getCharacter(userId) {
  return characterFromRow(db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId));
}

function saveCharacter(userId, c) {
  db.prepare("UPDATE characters SET town_id=?,money=?,bank=?,body_energy=?,brain_energy=?,recovered_at=?,job_id=?,work_progress=?,last_work_at=?,work_count=?,height=?,bmi=?,stats_json=?,weight=?,job_experience=?,job_work_count=?,mastered_job=?,last_school_day=?,last_gym_at=?,gym_ready_at=?,last_meal_at=?,health_index=?,last_health_day=?,last_event_day=? WHERE user_id=?")
    .run(c.townId, c.money, c.bank, c.bodyEnergy, c.brainEnergy, c.recoveredAt,
      c.jobId, c.workProgress, c.lastWorkAt, c.workCount, c.height, c.bmi,
      JSON.stringify(c.stats), c.weight, c.jobExperience, c.jobWorkCount, c.masteredJob,
      c.lastSchoolDay, c.lastGymAt, c.gymReadyAt, c.lastMealAt ?? 0,
      c.healthIndex ?? 50,c.lastHealthDay ?? "",c.lastEventDay ?? "",userId);
}

function addCharacter(userId, c) {
  db.prepare("INSERT INTO characters(user_id,name,gender,town_id,money,bank,body_energy,brain_energy,recovered_at,job_id,work_progress,last_work_at,work_count,height,bmi,stats_json,weight,job_experience,job_work_count,mastered_job,last_school_day,last_gym_at,gym_ready_at,created_at,last_meal_at,health_index,last_health_day,last_event_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId,c.name,c.gender,c.townId,c.money,c.bank,c.bodyEnergy,c.brainEnergy,
      c.recoveredAt,c.jobId,c.workProgress,c.lastWorkAt,c.workCount,c.height,
      c.bmi,JSON.stringify(c.stats),c.weight,c.jobExperience,c.jobWorkCount,c.masteredJob,
      c.lastSchoolDay,c.lastGymAt,c.gymReadyAt,c.recoveredAt,c.lastMealAt ?? 0,
      c.healthIndex ?? 50,c.lastHealthDay ?? "",c.lastEventDay ?? "");
}

function mutateCharacter(userId, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = getCharacter(userId);
    if (!old) throw new HttpError(409, "請先建立角色");
    const result = callback(recoverEnergy(old));
    saveCharacter(userId, result.character);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function snapshot(user) {
  const now = Date.now();
  const today = calendarDay(now, GAME_TIMEZONE);
  if (user) settleBankInterest(db,user.id,today,now);
  const character = user ? getCharacter(user.id) : null;
  let updated = character ? recoverEnergy(character, now) : null;
  if (updated) {
    updated = settleDailyHealth(updated,today,maxBodyEnergy(updated.stats),
      maxBrainEnergy(updated.stats),now).character;
    if (updated.recoveredAt !== character.recoveredAt ||
        updated.lastHealthDay !== character.lastHealthDay ||
        updated.healthIndex !== character.healthIndex) saveCharacter(user.id,updated);
    // 原版 event_happen 會在主畫面隨機抽取，Web 每日只抽一次。
    if ((updated.lastEventDay??"")<today) {
      settleDailyIllnessEvent(db,user.id,today,now);
      updated = getCharacter(user.id);
    }
  }
  const currentJob = updated?.jobId ? jobsByKey.get(updated.jobId) : null;
  const ownedHouses = updated ? listHouses(db, user.id).map(h => ({
    ...h, saleRefund: getHouseSaleQuote(houseCatalog, h.townId).refund
  })) : [];
  const townHouses = updated ? listHouses(db).filter(h => h.townId === updated.townId) : [];
  const map = updated ? publicTownMap(db, updated.townId, MODE === "solo") : null;
  if (map) for (const house of townHouses) {
    const cell = map.cells[house.row * 16 + house.column];
    if (cell && cell.raw === "webhouse_" + house.id + "=" + house.originalPlot) {
      cell.label = house.name + "（屋主：" + house.ownerName + "）";
      cell.image = house.image;
      cell.category = "house";
      cell.houseId = house.id;
    }
  }
  const residents = updated
    ? db.prepare("SELECT name FROM characters WHERE town_id=? AND user_id<>? ORDER BY name LIMIT 50")
      .all(updated.townId, user.id).map(row => row.name)
    : [];
  return {
    mode: MODE,
    user: user ? { username: MODE === "solo" ? "單機玩家" : user.username } : null,
    character: updated,
    bankAccount: updated ? bankOverview(db,user.id) : null,
    bankLoan: updated ? bankLoanOverview(db,user.id,currentJob) : null,
    bankLedger: updated ? bankLedger(db,user.id) : [],
    bankTransferRules: MODE === "multi" && updated ? {
      maxAmount: BANK_TRANSFER_LIMIT, newMemberDays: NEW_MEMBER_DAYS,
      newMemberMaxExclusive: NEW_MEMBER_TRANSFER_LIMIT
    } : null,
    currentJob: currentJob ? { key: currentJob.key, name: currentJob.name, salary: currentJob.salary, payEvery: currentJob.payEvery } : null,
    condition: updated ? conditionWithIllness(deriveCondition(updated,
      maxBodyEnergy(updated.stats),maxBrainEnergy(updated.stats),now),updated) : null,
    health: updated ? healthStatus(updated) : null,
    healthEvents: updated ? listCharacterEvents(db,user.id) : [],
    couponBalance: updated ? getCouponBalance(db,user.id) : 0,
    cockroachChallenge: updated ? getCockroachChallenge(db,user.id,now) : null,
    hospital: updated ? getTreatmentQuote(updated,hasActiveHealthInsurance(db,user.id,insuranceItem,now)) : null,
    insurance: updated ? inventoryOverview(db,user.id,insuranceItem,now) : null,
    insurancePurchases: updated ? listInsurancePurchases(db,user.id) : [],
    legacyInventory: updated ? listLegacyInventoryItems(db,user.id) : [],
    legacyItemActions: updated ? listLegacyItemActions(db,user.id,updated,now) : [],
    legacyItemHistory: updated ? listLegacyItemUseHistory(db,user.id) : [],
    hunger: updated ? hungerStatus(updated.lastMealAt,now) : null,
    physique: updated ? physiqueStatus(updated.height,updated.weight) : null,
    mealCooldownMs: updated && updated.lastMealAt ?
      Math.max(0,MEAL_COOLDOWN_MS-(now-updated.lastMealAt)) : 0,
    meals: updated ? meals.map(meal=>({
      key:meal.key,name:meal.name,menu:meal.menu,
      price:meal.price,calories:meal.calories,gains:meal.gains,
      reason:updated.lastMealAt && now-updated.lastMealAt<MEAL_COOLDOWN_MS
        ? "用餐後需間隔 60 分鐘" :
        updated.money<meal.price ? "現金不足" : null
    })) : [],
    maxBodyEnergy: updated ? maxBodyEnergy(updated.stats) : null,
    maxBrainEnergy: updated ? maxBrainEnergy(updated.stats) : null,
    jobLevel: updated ? Math.floor(updated.jobExperience / 100) : 0,
    towns: TOWNS,
    map,
    houses: ownedHouses,
    houseEvents: updated ? listHouseEvents(db, user.id) : [],
    houseRemodelEvents: updated ? listHouseRemodelEvents(db, user.id) : [],
    townHouses,
    roomTypes: updated ? ROOM_TYPES : [],
    houseCatalog: updated ? publicHouseCatalog(houseCatalog, updated.townId, ownedHouses.length) : null,
    residents,
    workCooldownMs: updated ? (updated.lastWorkAt === 0 ? 0 : Math.max(0, WORK_COOLDOWN_MS - (now - updated.lastWorkAt))) : 0,
    schoolRemainingToday: updated ? updated.lastSchoolDay === today : false,
    gymCooldownMs: updated ? Math.max(0, updated.gymReadyAt - now) : 0,
    trainingLessons: updated ? trainingLessons.map(lesson => ({
      key: lesson.key, type: lesson.type, name: lesson.name,
      price: lesson.price, energyCost: lesson.energyCost, gains: lesson.gains,
      cooldownMs: lesson.cooldownMs,
      reason: trainingAvailability(updated, lesson, now, today)
    })) : [],
    jobs: updated ? jobs.map(job => ({
      key: job.key, name: job.name, translated: job.translated, rank: job.rank,
      salary: job.salary, payEvery: job.payEvery, bodyCost: job.bodyCost,
      brainCost: job.brainCost, previousJob: job.previousJob,
      reason: jobEligibility(updated, job)
    })) : []
  };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) {
    throw new HttpError(415, "只接受 JSON 請求");
  }
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 16 * 1024) throw new HttpError(413, "資料超出長度限制");
    parts.push(part);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new HttpError(400, "無效的 JSON 格式"); }
  if (typeof data !== "object" || !data || Array.isArray(data)) {
    throw new HttpError(400, "請提供 JSON 物件");
  }
  return data;
}

const safeUsername = str => typeof str === "string" && /^[\p{L}\p{N}_]{2,24}$/u.test(str) && !str.startsWith("__");
const safeCharacterName = str => typeof str === "string" && /^[\p{L}\p{N}_ ]{1,18}$/u.test(str.trim());
const safePassword = str => typeof str === "string" && str.length >= 8 && str.length <= 128;

function safeFile(res, dir, requestPath, prefix) {
  let target;
  try { target = resolve(dir, decodeURIComponent(requestPath.slice(prefix.length))); }
  catch { throw new HttpError(400, "無效的檔案路徑"); }
  if (!target.startsWith(dir + sep)) throw new HttpError(404, "找不到檔案");
  const type = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".gif": "image/gif",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[extname(target).toLowerCase()];
  if (!type || !existsSync(target)) throw new HttpError(404, "找不到檔案");
  res.writeHead(200, {
    "Content-Type": type, "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(readFileSync(target));
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    if (req.method === "GET" && path === "/") return safeFile(res, STATIC_ROOT, "/static/index.html", "/static/");
    if (req.method === "GET" && path.startsWith("/static/")) return safeFile(res, STATIC_ROOT, path, "/static/");
    if (req.method === "GET" && path.startsWith("/legacy-assets/")) return safeFile(res, IMG_ROOT, path, "/legacy-assets/");
    if (req.method === "GET" && path === "/api/state") return sendJson(res, 200, snapshot(getUser(req)));
    if (req.method === "GET" && path === "/api/house/visit") {
      const visitor = getUser(req);
      if (!visitor) throw new HttpError(401, "請先登入");
      const houseId = Number(url.searchParams.get("houseId"));
      const slotParam = url.searchParams.get("slot");
      const slot = slotParam === null ? null : Number(slotParam);
      try { return sendJson(res, 200, viewRoom(db, visitor.id, houseId, slot)); }
      catch (error) { throw new HttpError(400, error.message); }
    }
    if (req.method !== "POST") throw new HttpError(404, "找不到指定的功能");
    const origin = req.headers.origin;
    if (origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === req.headers.host; } catch {}
      if (!sameHost) throw new HttpError(403, "不允許跨來源操作");
    }
    const data = await readBody(req);

    if (path === "/api/register") {
      if (MODE !== "multi") throw new HttpError(404, "單機模式無需註冊");
      if (!safeUsername(data.username) || !safePassword(data.password)) {
        throw new HttpError(400, "帳號須為 2 至 24 個字元；密碼須為 8 至 128 個字元");
      }
      if (db.prepare("SELECT id FROM users WHERE username=?").get(data.username)) {
        throw new HttpError(409, "帳號已被使用");
      }
      const salt = randomBytes(16).toString("hex");
      const created = db.prepare("INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)")
        .run(data.username, salt, passwordHash(data.password, salt), Date.now());
      const user = db.prepare("SELECT * FROM users WHERE id=?").get(Number(created.lastInsertRowid));
      newSession(res, user.id);
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/login") {
      if (MODE !== "multi") throw new HttpError(404, "單機模式無需登入");
      const user = typeof data.username === "string"
        ? db.prepare("SELECT * FROM users WHERE username=?").get(data.username) : null;
      if (!user || !safePassword(data.password)) throw new HttpError(401, "帳號或密碼錯誤");
      const actual = Buffer.from(passwordHash(data.password, user.password_salt), "hex");
      const expected = Buffer.from(user.password_hash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new HttpError(401, "帳號或密碼錯誤");
      }
      newSession(res, user.id);
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/logout") {
      if (MODE === "multi") clearSession(req, res);
      return sendJson(res, 200, { ok: true });
    }

    const user = getUser(req);
    if (!user) throw new HttpError(401, "請先登入");

    if (path === "/api/character") {
      if (!safeCharacterName(data.name) || !["male","female","other"].includes(data.gender)) {
        throw new HttpError(400, "角色名稱或性別不符合格式");
      }
      if (getCharacter(user.id)) throw new HttpError(409, "此帳號已有角色");
      let character;
      try { character = createCharacterData(data.name.trim(), data.gender, Date.now(), data.stats); }
      catch (error) { throw new HttpError(400, error.message); }
      addCharacter(user.id, character);
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/events/cockroach/claim") {
      let result;
      try { result=claimCockroach(db,user.id,Date.now()); }
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),cockroachResult:result});
    }

    if (path === "/api/job") {
      const job = jobsByKey.get(data.key);
      if (!job) throw new HttpError(404, "找不到職業");
      mutateCharacter(user.id, old => ({ character: selectJob(old, job) }));
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/work") {
      let result;
      try { result = mutateCharacter(user.id,old=>performWork(old,jobsByKey.get(old.jobId))); }
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res, 200, { ...snapshot(user), result: {
        paid: result.paid, pending: result.pending,
        experienceGain: result.experienceGain, condition:result.condition,
        jobLevel: result.jobLevel,
        leveledUp: result.leveledUp, bonus: result.bonus, mastered: result.mastered
      } });
    }

    if (path === "/api/hospital/treat") {
      const now=Date.now();
      const result=mutateCharacter(user.id,old=>{
        try {return treatAtHospital(old,now,
          hasActiveHealthInsurance(db,user.id,insuranceItem,now));}
        catch(error){throw new HttpError(400,error.message);}
      });
      return sendJson(res,200,{...snapshot(user),hospitalResult:{
        paid:result.paid,previousDisease:result.previousDisease
      }});
    }

    if (path === "/api/inventory/legacy/use") {
      let result;
      try {
        result=useLegacyItem(db,user.id,data.sourceLine,data.requestId,Date.now());
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),itemUseResult:result});
    }

    if (path === "/api/inventory/insurance/buy") {
      let result;
      try {
        result=buyHealthInsurance(db,user.id,insuranceItem,
          data.quantity,data.requestId,Date.now());
      } catch(error) {throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),insuranceResult:result});
    }

    if (path === "/api/meal/eat") {
      const meal=mealsByKey.get(data.key);
      if (!meal) throw new HttpError(404,"找不到食堂餐點");
      const now=Date.now();
      const result=mutateCharacter(user.id,old=>{
        try {return eatMeal(recoverEnergy(old,now),meal,now);}
        catch(error){throw new HttpError(400,error.message);}
      });
      return sendJson(res,200,{...snapshot(user),mealResult:{
        name:result.meal,paid:result.paid,gained:result.gained,
        weightGain:result.weightGain
      }});
    }

    if (path === "/api/train") {
      const lesson = trainingByKey.get(data.key);
      if (!lesson) throw new HttpError(404, "找不到訓練課程");
      const now = Date.now();
      const today = calendarDay(now, GAME_TIMEZONE);
      const result = mutateCharacter(user.id, old => {
        try { return performTraining(old, lesson, now, today); }
        catch (error) { throw new HttpError(400, error.message); }
      });
      return sendJson(res, 200, { ...snapshot(user), trainingResult: {
        name: result.lesson, gained: result.gained, paid: result.paid
      } });
    }

    if (path === "/api/bank" || path === "/api/bank/term") {
      const now = Date.now();
      const today = calendarDay(now,GAME_TIMEZONE);
      let result;
      try {
        if (path === "/api/bank") {
          result = bankOperation(db,user.id,data.action,data.amount,today,now);
        } else {
          const action = data.action === "deposit" ? "termDeposit" :
            data.action === "cancel" ? "termCancel" : data.action;
          result = bankOperation(db,user.id,action,
            action === "termCancel" ? data.amount : data.units,today,now);
        }
      } catch (error) { throw new HttpError(400,error.message); }
      return sendJson(res, 200, { ...snapshot(user), bankResult: result });
    }

    if (path === "/api/bank/transfer") {
      if (MODE !== "multi") throw new HttpError(403,"單機模式無法轉帳給其他玩家");
      let result;
      try {
        result = transferToPlayer(db,user.id,data.recipientName,data.amount,
          calendarDay(Date.now(),GAME_TIMEZONE),data.requestId);
      } catch(error) { throw new HttpError(400,error.message); }
      return sendJson(res,200,{ ...snapshot(user),transferResult:result });
    }

    if (path === "/api/bank/loan/borrow" || path === "/api/bank/loan/payoff") {
      const now = Date.now();
      const today = calendarDay(now,GAME_TIMEZONE);
      let result;
      try {
        if (path === "/api/bank/loan/borrow") {
          const character = getCharacter(user.id);
          if (!character) throw new Error("請先建立角色");
          const job = jobsByKey.get(character.jobId);
          result = borrowBankLoan(db,user.id,job,data.payments,today,now);
        } else {
          result = payoffBankLoan(db,user.id,today,now);
        }
      } catch (error) { throw new HttpError(400,error.message); }
      return sendJson(res,200,{ ...snapshot(user),loanResult:result });
    }

    if (path === "/api/house/room/config") {
      let result;
      try { result = setRoomSlots(db, user.id, data.houseId, data.slots); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), roomResult: result });
    }

    if (path === "/api/house/room/post") {
      let result;
      try { result = addRoomPost(db, user.id, data.houseId, data.slotIndex, data.body); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), roomResult: result });
    }

    if (path === "/api/house/room/delete") {
      let result;
      try { result = deleteRoomPost(db, user.id, data.houseId, data.postId); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), roomResult: result });
    }

    if (path === "/api/house/build") {
      let result;
      try {
        result = buildHouse(db, houseCatalog, user.id,
          { row: data.row, column: data.column },
          { image: data.image, interiorRank: data.interiorRank, payment: data.payment });
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      return sendJson(res, 200, { ...snapshot(user), houseResult: result });
    }

    if (path === "/api/house/remodel") {
      let result;
      try {
        result = remodelHouse(db, houseCatalog, user.id, data.houseId,
          { image: data.image, interiorRank: data.interiorRank });
      } catch(error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), houseRemodelResult: result });
    }

    if (path === "/api/house/sell") {
      let result;
      try { result = sellHouse(db, houseCatalog, user.id, data.houseId); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), houseSaleResult: result });
    }

    if (path === "/api/house/rename") {
      try { renameHouse(db, user.id, data.houseId, data.name); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/map/tile") {
      if (MODE !== "solo") throw new HttpError(403, "多人模式只能由伺服器管理員匯入街區地圖");
      const character = getCharacter(user.id);
      if (!character) throw new HttpError(409, "請先建立角色");
      try { editTownTile(db, character.townId, data.row, data.column, data.symbol); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/move") {
      if (!Number.isInteger(data.townId) || !TOWNS.some(t => t.id === data.townId)) {
        throw new HttpError(400, "不存在的城鎮");
      }
      mutateCharacter(user.id, old => ({ character: { ...old, townId: data.townId } }));
      return sendJson(res, 200, snapshot(user));
    }
    throw new HttpError(404, "找不到指定的功能");
  } catch (error) {
    if (error?.code?.startsWith("ERR_SQLITE") || /UNIQUE constraint failed/.test(error?.message || "")) {
      return sendJson(res, 409, { error: "資料已存在，請更換名稱" });
    }
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
    if (["請先選擇職業", "身體或頭腦能量不足"].includes(error.message) ||
        error.message?.startsWith("還需要等待") ||
        error.message?.includes("不足") || error.message?.includes("限制") ||
        error.message?.includes("精通")) {
      return sendJson(res, 400, { error: error.message });
    }
    console.error(error);
    return sendJson(res, 500, { error: "伺服器發生錯誤" });
  }
}

createServer(handle).listen(PORT, HOST, () => {
  console.log("TOWN Web [" + MODE + "] http://" + HOST + ":" + PORT);
  console.log("已載入職業：" + jobs.length + "，翻譯：" + jobs.filter(job => job.translated).length);
  console.log("原始地圖匯入城鎮：" + (importedTownIds.length ? importedTownIds.join(", ") : "無，保持未設定狀態"));
});
