// 原版 town_lib.pl::kozin_sprit 的 69 個角色欄位。
// 本模組只解讀原始記錄，不執行來源 CGI，也不沿用原版明文密碼。
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { basename } from "node:path";
import {
  STAT_KEYS, TOWNS, bodyMassIndex, maxBodyEnergy, maxBrainEnergy,
  parseLegacyJobs, decodeLegacyText
} from "./engine.mjs";
import { calendarDay } from "./training.mjs";

export const LEGACY_CHARACTER_FIELDS = Object.freeze([
  "k_id","name","pass","money","bank","job",
  "kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu",
  "looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku",
  "love","unique","etti","first_access","kounyuu","sex","access_byou",
  "access_time","host","house_name","house_type","byoumei","mise_type",
  "last_mailcheck","super_teiki","energy","last_ene_time","next_tra",
  "last_syokuzi_split","sintyou","taijuu","nou_energy",
  "last_nouene_time","job_keiken","job_kaisuu","last_school",
  "byouki_sisuu","loan_nitigaku","loan_kaisuu","k_sousisan","jobsyu",
  "k_yobi3","kpoint","idou_jikan","brauza","shiharai","syoukai_id",
  "aki","oto","hatugen","fontsize","buki_name","buki","bougu_name",
  "bougu","mahou_name","mahou","omamori_name","omamori"
]);
const STAT_LIMIT = 1000000000;
function positiveInteger(value, field, minimum = 0) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error("原版欄位「" + field + "」不是非負整數");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum)
    throw new Error("原版欄位「" + field + "」超出支援範圍");
  return n;
}
function optionalInteger(value, field, fallback = 0) {
  if (value === "" || value == null) return fallback;
  return positiveInteger(value,field);
}
function originalTime(value) {
  if (!/^\d{1,12}$/.test(value ?? "")) return 0;
  const result = Number(value) * 1000;
  return Number.isSafeInteger(result) ? result : 0;
}
function safeName(name) {
  return typeof name === "string" &&
    /^[\p{L}\p{N}_ ]{1,18}$/u.test(name.trim());
}
function balanceOf(row, name) {
  return optionalInteger(row[name], name);
}
function sanitizeArchive(row) {
  // 只保留移植尚未支援、但未來需要對照的非認證欄位。
  // 不保存 pass、host、brauza、shiharai 及其他可用於身分追蹤的原始環境資訊。
  const keys = [
    "kounyuu","house_type","byoumei","mise_type","next_tra",
    "last_syokuzi_split","byouki_sisuu","loan_nitigaku","loan_kaisuu",
    "k_sousisan","jobsyu","kpoint","idou_jikan",
    "buki_name","buki","bougu_name","bougu","mahou_name",
    "mahou","omamori_name","omamori"
  ];
  return Object.fromEntries(keys.filter(key => row[key]).map(key => [key,row[key]]));
}

export function parseLegacyCharacterRecords(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("原版角色檔案是空的");
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 100000) throw new Error("原版角色數量超過單次轉檔上限");
  return lines.map((line, index) => {
    const values = line.split("<>");
    if (values.length > LEGACY_CHARACTER_FIELDS.length &&
        values[values.length-1] === "") values.pop();
    if (values.length < 46 || values.length > LEGACY_CHARACTER_FIELDS.length)
      throw new Error("原版第 " + (index+1) + " 筆角色欄位數異常：" + values.length);
    const row = Object.fromEntries(LEGACY_CHARACTER_FIELDS.map((key,i) => [key,values[i] ?? ""]));
    if (!/^\d{1,16}$/.test(row.k_id) || !row.name.trim())
      throw new Error("原版第 " + (index+1) + " 筆角色識別碼或名稱無效");
    return { row, sourceLine:index+1, fieldCount:values.length,
      sourceHash:createHash("sha256").update(line).digest("hex") };
  });
}

export function inspectLegacyCharacter(record, jobs, options = {}) {
  if (!record?.row) throw new Error("原版角色資料不存在");
  const row = record.row;
  const name = options.name ?? row.name.trim();
  if (!safeName(name)) throw new Error("角色名稱不符合 Web 版規格，請使用 --name 指定 1 至 18 字的新名稱");
  const stats = Object.fromEntries(STAT_KEYS.map(key => {
    const n = positiveInteger(row[key], key, 1);
    if (n > STAT_LIMIT) throw new Error("原版能力值超出目前可安全處理的範圍：" + key);
    return [key,n];
  }));
  const money = balanceOf(row,"money"), bank = balanceOf(row,"bank");
  const term = balanceOf(row,"super_teiki");
  const height = optionalInteger(row.sintyou,"sintyou",165);
  const weight = optionalInteger(row.taijuu,"taijuu",60);
  if (height < 100 || height > 250 || weight < 1 || weight > 500)
    throw new Error("原版身高或體重超出 Web 版支援範圍");
  const gender = row.sex === "m" ? "male" : row.sex === "f" ? "female" : "other";
  const matchedJob = jobs.find(job => job.originalName === row.job);
  const warnings = [];
  if (!matchedJob) warnings.push("原始職業目前找不到對應項目，匯入後將以日薪打工顯示，保留原職業名稱供日後轉檔");
  if (optionalInteger(row.loan_kaisuu,"loan_kaisuu") > 0 ||
      optionalInteger(row.loan_nitigaku,"loan_nitigaku") > 0)
    warnings.push("原版尚有未結清的貸款資料，Web 版貸款系統尚未移植");
  if (row.house_type) warnings.push("原版婚姻／家庭關係尚未匯入");
  if (row.byoumei || optionalInteger(row.byouki_sisuu,"byouki_sisuu") > 0)
    warnings.push("原版疾病狀態尚未匯入");
  if (row.kounyuu || row.buki || row.bougu || row.mahou)
    warnings.push("原版道具、裝備或購買圖示相關資料尚未匯入");
  if (record.fieldCount < LEGACY_CHARACTER_FIELDS.length)
    warnings.push("原版紀錄缺少部分尾端可選欄位，已依缺省值處理");
  const firstAccess = originalTime(row.first_access);
  if (!firstAccess) warnings.push("無法確定原版角色首次建立時間");
  const limit = (value, max) => Math.min(max, value);
  const bodyMax = maxBodyEnergy(stats), brainMax = maxBrainEnergy(stats);
  const jobCount = optionalInteger(row.job_kaisuu,"job_kaisuu");
  const schoolTime = originalTime(row.last_school);
  if (optionalInteger(row.energy,"energy",bodyMax) > bodyMax ||
      optionalInteger(row.nou_energy,"nou_energy",brainMax) > brainMax)
    warnings.push("原版能量超出目前 Web 計算上限，將暫時限制在 Web 版能量上限內");
  if (row.last_ene_time || row.last_nouene_time)
    warnings.push("原版個別的體力與頭腦恢復時間尚未精確移植，Web 版會重新開始計時");
  const currentNow = options.now ?? Date.now();
  const timeZone = options.timeZone ?? "Asia/Taipei";
  const character = {
    name,gender,townId:0,money,bank,
    bodyEnergy:limit(optionalInteger(row.energy,"energy",bodyMax),bodyMax),
    brainEnergy:limit(optionalInteger(row.nou_energy,"nou_energy",brainMax),brainMax),
    recoveredAt:currentNow,
    jobId:matchedJob?.key ?? jobs[0]?.key ?? "legacy-2",
    workProgress:matchedJob ? jobCount % matchedJob.payEvery : 0,
    lastWorkAt:originalTime(row.house_name),
    workCount:jobCount,jobWorkCount:jobCount,
    jobExperience:optionalInteger(row.job_keiken,"job_keiken"),
    masteredJob:row.jobsyu || null,
    lastSchoolDay:schoolTime?calendarDay(schoolTime,timeZone):"",
    lastGymAt:0,gymReadyAt:0,
    height,weight,bmi:bodyMassIndex(height,weight),stats,
    createdAt:firstAccess || 0
  };
  return {
    originalId:row.k_id,originalName:row.name,character,
    termBalance:term,originalJob:row.job, warnings,
    sourceHash:record.sourceHash,fieldCount:record.fieldCount,
    unmapped:sanitizeArchive(row)
  };
}

export function initLegacyImportTable(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS legacy_character_imports(",
    "original_id TEXT PRIMARY KEY,",
    "target_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,",
    "original_name TEXT NOT NULL,",
    "original_job TEXT NOT NULL,",
    "source_hash TEXT NOT NULL,",
    "source_file TEXT NOT NULL,",
    "field_count INTEGER NOT NULL,",
    "unmapped_json TEXT NOT NULL,",
    "warnings_json TEXT NOT NULL,",
    "created_at INTEGER NOT NULL);"
  ].join("\n"));
}

export function importLegacyCharacter(db, inspected, options) {
  const {mode,username,password,sourceFile,now=Date.now(),today=calendarDay(now)} = options;
  if (!["solo","multi"].includes(mode)) throw new Error("匯入模式無效");
  if (mode === "multi" &&
      (typeof username !== "string" || !/^[\p{L}\p{N}_]{2,24}$/u.test(username) ||
       username.startsWith("__") || typeof password !== "string" ||
       password.length < 8 || password.length > 128))
    throw new Error("多人匯入需要合法新帳號與獨立的新密碼（長度 8 至 128）");
  if (mode === "solo" && (username || password))
    throw new Error("單機匯入不可指定多人帳號與密碼");
  const required = ["users","characters","bank_accounts"];
  for (const table of required) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      throw new Error("資料庫尚未初始化，請先啟動並關閉 Web 伺服器，再執行匯入");
  }
  initLegacyImportTable(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM legacy_character_imports WHERE original_id=?").get(inspected.originalId))
      throw new Error("原版角色 ID 已匯入，拒絕重複執行");
    if (db.prepare("SELECT 1 FROM characters WHERE name=?").get(inspected.character.name))
      throw new Error("Web 版已有相同角色名稱，拒絕覆蓋");
    let userId;
    if (mode === "solo") {
      const user = db.prepare("SELECT id FROM users WHERE username='__local_player__'").get();
      if (user) {
        userId=user.id;
        if (db.prepare("SELECT 1 FROM characters WHERE user_id=?").get(userId))
          throw new Error("單機玩家已有角色，拒絕覆蓋");
      } else {
        const salt=randomBytes(16).toString("hex");
        const hash=scryptSync(randomBytes(32).toString("hex"),salt,64).toString("hex");
        userId=Number(db.prepare(
          "INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)"
        ).run("__local_player__",salt,hash,now).lastInsertRowid);
      }
    } else {
      if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username))
        throw new Error("多人帳號名稱已存在，拒絕覆蓋");
      const salt=randomBytes(16).toString("hex");
      const hash=scryptSync(password,salt,64).toString("hex");
      userId=Number(db.prepare(
        "INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)"
      ).run(username,salt,hash,now).lastInsertRowid);
    }
    const c=inspected.character;
    db.prepare([
      "INSERT INTO characters(user_id,name,gender,town_id,money,bank,body_energy,brain_energy,",
      "recovered_at,job_id,work_progress,last_work_at,work_count,height,bmi,stats_json,",
      "weight,job_experience,job_work_count,mastered_job,last_school_day,last_gym_at,gym_ready_at,created_at)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,c.name,c.gender,c.townId,c.money,c.bank,
      c.bodyEnergy,c.brainEnergy,c.recoveredAt,c.jobId,c.workProgress,c.lastWorkAt,
      c.workCount,c.height,c.bmi,JSON.stringify(c.stats),c.weight,c.jobExperience,
      c.jobWorkCount,c.masteredJob,c.lastSchoolDay,c.lastGymAt,c.gymReadyAt,c.createdAt);
    db.prepare(
      "INSERT INTO bank_accounts(user_id,term_balance,last_interest_day) VALUES(?,?,?)"
    ).run(userId,inspected.termBalance,today);
    db.prepare([
      "INSERT INTO legacy_character_imports(original_id,target_user_id,original_name,original_job,",
      "source_hash,source_file,field_count,unmapped_json,warnings_json,created_at)",
      "VALUES(?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(inspected.originalId,userId,inspected.originalName,
      inspected.originalJob,inspected.sourceHash,basename(sourceFile),
      inspected.fieldCount,JSON.stringify(inspected.unmapped),
      JSON.stringify(inspected.warnings),now);
    db.exec("COMMIT");
    return {userId,originalId:inspected.originalId,name:c.name};
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
