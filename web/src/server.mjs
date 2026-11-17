import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  TOWNS, WORK_COOLDOWN_MS, decodeLegacyText, parseLegacyJobs,
  createCharacterData, recoverEnergy, jobEligibility, selectJob, performWork,
  maxBodyEnergy, maxBrainEnergy, bankTransaction
} from "./engine.mjs";

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
  ["mastered_job", "TEXT"]
]) {
  const currentColumns = db.prepare("PRAGMA table_info(characters)").all();
  if (!currentColumns.some(info => info.name === column)) {
    db.exec("ALTER TABLE characters ADD COLUMN " + column + " " + definition);
  }
}

const jobPath = resolve(REPO_ROOT, "dat_dir", "job.cgi");
if (!existsSync(jobPath)) throw new Error("找不到原始職業檔案：" + jobPath);
const jobs = parseLegacyJobs(decodeLegacyText(readFileSync(jobPath)));
if (!jobs.length) throw new Error("無法讀取舊版職業資料，請檢查 dat_dir/job.cgi");
const jobsByKey = new Map(jobs.map(job => [job.key, job]));

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
    masteredJob: row.mastered_job, stats: JSON.parse(row.stats_json)
  };
}

function getCharacter(userId) {
  return characterFromRow(db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId));
}

function saveCharacter(userId, c) {
  db.prepare("UPDATE characters SET town_id=?,money=?,bank=?,body_energy=?,brain_energy=?,recovered_at=?,job_id=?,work_progress=?,last_work_at=?,work_count=?,height=?,bmi=?,stats_json=?,weight=?,job_experience=?,job_work_count=?,mastered_job=? WHERE user_id=?")
    .run(c.townId, c.money, c.bank, c.bodyEnergy, c.brainEnergy, c.recoveredAt,
      c.jobId, c.workProgress, c.lastWorkAt, c.workCount, c.height, c.bmi,
      JSON.stringify(c.stats), c.weight, c.jobExperience, c.jobWorkCount, c.masteredJob, userId);
}

function addCharacter(userId, c) {
  db.prepare("INSERT INTO characters(user_id,name,gender,town_id,money,bank,body_energy,brain_energy,recovered_at,job_id,work_progress,last_work_at,work_count,height,bmi,stats_json,weight,job_experience,job_work_count,mastered_job) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId,c.name,c.gender,c.townId,c.money,c.bank,c.bodyEnergy,c.brainEnergy,
      c.recoveredAt,c.jobId,c.workProgress,c.lastWorkAt,c.workCount,c.height,
      c.bmi,JSON.stringify(c.stats),c.weight,c.jobExperience,c.jobWorkCount,c.masteredJob);
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
  const character = user ? getCharacter(user.id) : null;
  const updated = character ? recoverEnergy(character, now) : null;
  if (character && updated.recoveredAt !== character.recoveredAt) saveCharacter(user.id, updated);
  const currentJob = updated?.jobId ? jobsByKey.get(updated.jobId) : null;
  const residents = updated
    ? db.prepare("SELECT name FROM characters WHERE town_id=? AND user_id<>? ORDER BY name LIMIT 50")
      .all(updated.townId, user.id).map(row => row.name)
    : [];
  return {
    mode: MODE,
    user: user ? { username: MODE === "solo" ? "單機玩家" : user.username } : null,
    character: updated,
    currentJob: currentJob ? { key: currentJob.key, name: currentJob.name, salary: currentJob.salary, payEvery: currentJob.payEvery } : null,
    maxBodyEnergy: updated ? maxBodyEnergy(updated.stats) : null,
    maxBrainEnergy: updated ? maxBrainEnergy(updated.stats) : null,
    jobLevel: updated ? Math.floor(updated.jobExperience / 100) : 0,
    towns: TOWNS,
    residents,
    workCooldownMs: updated ? Math.max(0, WORK_COOLDOWN_MS - (now - updated.lastWorkAt)) : 0,
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

    if (path === "/api/job") {
      const job = jobsByKey.get(data.key);
      if (!job) throw new HttpError(404, "找不到職業");
      mutateCharacter(user.id, old => ({ character: selectJob(old, job) }));
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/work") {
      const result = mutateCharacter(user.id, old => performWork(old, jobsByKey.get(old.jobId)));
      return sendJson(res, 200, { ...snapshot(user), result: {
        paid: result.paid, pending: result.pending,
        experienceGain: result.experienceGain, jobLevel: result.jobLevel,
        leveledUp: result.leveledUp, bonus: result.bonus, mastered: result.mastered
      } });
    }

    if (path === "/api/bank") {
      const result = mutateCharacter(user.id, old => {
        let next;
        try { next = bankTransaction(old, data.action, data.amount); }
        catch (error) { throw new HttpError(400, error.message); }
        return { character: next };
      });
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
});
