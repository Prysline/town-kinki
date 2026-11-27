import { JOB_ZH_TW } from "./i18n/jobs.zh-TW.mjs";
import {originalBodyEnergyMaximum,originalBrainEnergyMaximum} from "./energy-maxima.mjs";
export { JOB_ZH_TW };
// TOWN Web 共用遊戲規則。單機與多人模式共用此模組。
export const TOWNS = Object.freeze([
  { id: 0, name: "京阪神大街", originalName: "京阪神ストリート" },
  { id: 1, name: "近江湖畔", originalName: "近江レイク" },
  { id: 2, name: "奈良市", originalName: "奈良シティ" },
  { id: 3, name: "和歌山島", originalName: "和歌山アイランド" }
]);

export const STARTING_BUDGETS = Object.freeze([
  { id: "brain", label: "頭腦", keys: ["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu"], max: 200 },
  { id: "body", label: "身體", keys: ["looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku"], max: 200 },
  { id: "other", label: "其他", keys: ["love","unique","etti"], max: 100 }
]);
export const WORK_COOLDOWN_MS = 5 * 60 * 1000;
export const ENERGY_RECOVERY_MS = 10 * 1000;
import { deriveCondition, legacyPhysiqueBmi } from "./dining.mjs";
import { conditionWithIllness, DEFAULT_HEALTH_INDEX } from "./health.mjs";

export const STAT_KEYS = [
  "kokugo", "suugaku", "rika", "syakai", "eigo", "ongaku", "bijutu",
  "looks", "tairyoku", "kenkou", "speed", "power", "wanryoku",
  "kyakuryoku", "love", "unique", "etti"
];
export const STAT_LABELS = {
  kokugo: "國語", suugaku: "數學", rika: "理科", syakai: "社會",
  eigo: "英語", ongaku: "音樂", bijutu: "美術",
  looks: "外貌", tairyoku: "體力", kenkou: "健康", speed: "速度",
  power: "力量", wanryoku: "臂力", kyakuryoku: "腿力",
  love: "LOVE", unique: "有趣度", etti: "情色度"
};


const toNumber = (x, fallback = 0) => {
  const number = Number(x);
  return Number.isFinite(number) ? number : fallback;
};

export function decodeLegacyText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  }
}

// 舊檔案的資料欄位以 <> 分隔；穩定鍵使用原始資料列位置，避免重複職業編號互相覆蓋。
export function parseLegacyJobs(source) {
  return source.split(/\r?\n/).slice(1).map((line, index) => {
    if (!line.trim()) return null;
    const v = line.replace(/\r$/, "").split("<>");
    if (v.length < 30 || !/^\d+$/.test(v[0])) return null;
    const requirements = {};
    STAT_KEYS.forEach((key, i) => {
      const sourceIndex = i < 7 ? i + 2 : i < 14 ? i + 4 : i + 6;
      requirements[key] = toNumber(v[sourceIndex]);
    });
    return {
      key: "legacy-" + (index + 2),
      originalId: Number(v[0]),
      originalName: v[1],
      name: JOB_ZH_TW[v[1]] ?? v[1],
      translated: Object.hasOwn(JOB_ZH_TW, v[1]),
      requirements,
      bmiMin: toNumber(v[9]),
      bmiMax: toNumber(v[10]),
      salary: Math.max(0, toNumber(v[18])),
      payEvery: Math.max(1, toNumber(v[19], 1)),
      gender: v[23] === "m" ? "male" : v[23] === "f" ? "female" : null,
      minHeight: toNumber(v[24]),
      bodyCost: Math.max(0, toNumber(v[25])),
      brainCost: Math.max(0, toNumber(v[26])),
      rank: Math.max(1, toNumber(v[27], 1)),
      previousJob: v[28] || null,
      bonusRate: Math.max(0, toNumber(v[29])),
      raiseRate: Math.max(0, toNumber(v[30]))
    };
  }).filter(Boolean);
}

export function validateStartingStats(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("請完整填寫初始能力值");
  const stats = {};
  for (const key of STAT_KEYS) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > 200)
      throw new Error(STAT_LABELS[key] + "必須是大於零的整數");
    stats[key] = input[key];
  }
  for (const group of STARTING_BUDGETS) {
    const sum = group.keys.reduce((total, key) => total + stats[key], 0);
    if (sum > group.max) throw new Error(group.label + "能力值總和不可超過 " + group.max);
  }
  return stats;
}

// Web common reads use the original resident/status maximum by default.
// Work uses its own verified CGI maximum; bath entry has a separate +1 context.
export function maxBodyEnergy(stats,context="resident") {
  return Math.max(0,originalBodyEnergyMaximum(stats,context));
}

export function maxBrainEnergy(stats,context="resident") {
  return Math.max(0,originalBrainEnergyMaximum(stats,context));
}

export function bodyMassIndex(height, weight) {
  return Math.round(weight / ((height / 100) ** 2) * 10) / 10;
}

export function createCharacterData(
  name, gender = "other", now = Date.now(),
  inputStats = Object.fromEntries(STAT_KEYS.map(key => [key, 20])),
  random = Math.random
) {
  const stats = validateStartingStats(inputStats);
  // 原版由性別決定隨機初始身高、體重。未指定性別為 Web 擴充選項。
  const height = gender === "male" ? 165 + Math.floor(random() * 20)
    : gender === "female" ? 150 + Math.floor(random() * 25) : 165;
  const weight = gender === "male" ? 50 + Math.floor(random() * 35)
    : gender === "female" ? 48 + Math.floor(random() * 20) : 60;
  return {
    name, gender, townId: 0, money: 100000, bank: 0,
    bodyEnergy: maxBodyEnergy(stats), brainEnergy: maxBrainEnergy(stats), recoveredAt: now,
    jobId: "legacy-2", salaryPayment:"cash", workProgress: 0, lastWorkAt: 0,
    workCount: 0, jobWorkCount: 0, jobExperience: 0, masteredJob: null,
    lastSchoolDay: "", lastGymAt: 0, gymReadyAt: 0, classroomReadyAt: 0,
    lastMealAt: 0, healthIndex: DEFAULT_HEALTH_INDEX, lastHealthDay: "",
    lastEventDay: "",
    height, weight, bmi: bodyMassIndex(height, weight), stats
  };
}

export function recoverEnergy(character, now = Date.now(), context="resident") {
  const ticks = Math.max(0, Math.floor((now - character.recoveredAt) / ENERGY_RECOVERY_MS));
  const maxBody = maxBodyEnergy(character.stats,context);
  const maxBrain = maxBrainEnergy(character.stats,context);
  const bodyEnergy = Math.max(0,Math.min(maxBody, character.bodyEnergy + ticks));
  const brainEnergy = Math.max(0,Math.min(maxBrain, character.brainEnergy + ticks));
  return {
    ...character, bodyEnergy, brainEnergy,
    recoveredAt: !ticks ? character.recoveredAt :
      bodyEnergy === maxBody && brainEnergy === maxBrain
        ? now : character.recoveredAt + ticks * ENERGY_RECOVERY_MS
  };
}

function eligibility(character, job, checkPrerequisite = true, checkEntryOnly = true) {
  if (checkPrerequisite && job.previousJob && job.previousJob !== character.masteredJob)
    return "需先精通：" + job.previousJob;
  // basic.cgi::job_change 會核對性別；::do_work 不會重新檢查。
  if (checkEntryOnly && job.gender && character.gender !== job.gender)
    return "不符合原始職業的性別限制";
  // 轉職與實際工作均使用原版取整 BMI；不依賴可能陳舊的一位小數存檔欄位。
  const originalBmi=legacyPhysiqueBmi(character.height,character.weight);
  if (originalBmi < job.bmiMin || (job.bmiMax && originalBmi > job.bmiMax)) return "體格指數不足";
  // basic.cgi::job_change 才檢查入職身高，工作後身高改變仍依 BMI 與能力判定。
  if (checkEntryOnly && character.height < job.minHeight) return "身高不足";
  for (const key of STAT_KEYS) {
    if ((character.stats[key] ?? 0) < job.requirements[key]) return STAT_LABELS[key] + "不足";
  }
  return null;
}

export function jobEligibility(character, job) {
  return eligibility(character, job);
}

export function selectJob(character, job) {
  const reason = jobEligibility(character, job);
  if (reason) throw new Error(reason);
  return { ...character, jobId: job.key, workProgress: 0, jobWorkCount: 0, jobExperience: 0 };
}

export function performWork(character, job, now = Date.now(), random = Math.random) {
  if (!job || character.jobId !== job.key) throw new Error("請先選擇職業");
  const remaining = character.lastWorkAt === 0 ? 0 : Math.max(0, WORK_COOLDOWN_MS - (now - character.lastWorkAt));
  if (remaining > 0) throw new Error("還需要等待 " + Math.ceil(remaining / 1000) + " 秒才能工作");
  const current = recoverEnergy(character, now,"work");
  // basic.cgi::do_work 實際只重新確認能力與 BMI（能量另行檢查）。
  const reason = eligibility(current, job, false, false);
  if (reason) throw new Error(reason);
  if (current.bodyEnergy < job.bodyCost || current.brainEnergy < job.brainCost)
    throw new Error("身體或頭腦能量不足");
  // 原版工作接受街道狀態的 cond；Web 仍由伺服器推導，不信任客戶端。
  // 用一般狀態上限投影，不把工作專用上限誤用於居民狀態百分比。
  const resident= recoverEnergy(current,now,"resident");
  const condition = conditionWithIllness(deriveCondition(resident,maxBodyEnergy(resident.stats),
    maxBrainEnergy(resident.stats),now),resident);
  if (condition.baseExperience===null)
    throw new Error("目前疾病或身體狀態過差，無法工作");
  // 原版依一般狀態或疾病類別決定經驗基數，再加 1 至 5 的亂數。
  // 沒有用餐歷史的舊 Web 角色暫按普通狀態處理，不回推飢餓懲罰。
  const experienceGain = condition.baseExperience + Math.floor(random() * 5) + 1;
  const oldLevel = Math.floor((current.jobExperience ?? 0) / 100);
  const jobExperience = Math.max(0,(current.jobExperience ?? 0) + experienceGain);
  const jobLevel = Math.floor(jobExperience / 100);
  const leveledUp = jobLevel > oldLevel;
  // 原版是每次工作以職業基礎薪資與當次等級計算，不累加上一輪的加薪。
  const effectiveSalary = Math.trunc(job.salary * (1 + jobLevel / 100 * job.raiseRate));
  const nextJobCount = (current.jobWorkCount ?? 0) + 1;
  const paid = nextJobCount % job.payEvery === 0 ? effectiveSalary * job.payEvery : 0;
  const bonus = leveledUp ? effectiveSalary * job.bonusRate : 0;
  const payout=paid+bonus;
  const toBank=current.salaryPayment==="bank";
  const destination=toBank?current.bank:current.money;
  if(!Number.isSafeInteger(payout)||payout<0||
      !Number.isSafeInteger(destination)||destination<0||
      !Number.isSafeInteger(destination+payout))
    throw new Error("薪資金額超出安全整數範圍");
  const mastered = leveledUp && jobLevel >= 15 && current.masteredJob !== job.originalName;
  const weight = Math.max(1, Math.round(((current.weight ?? 60) - job.bodyCost / 100) * 100) / 100);
  const next = {
    ...current, bodyEnergy: current.bodyEnergy - job.bodyCost,
    brainEnergy: current.brainEnergy - job.brainCost,
    money: current.money + (toBank?0:payout),
    bank: current.bank + (toBank?payout:0),
    workProgress: nextJobCount % job.payEvery,
    jobWorkCount: nextJobCount,
    jobExperience,
    masteredJob: mastered ? job.originalName : current.masteredJob,
    weight, bmi: bodyMassIndex(current.height, weight),
    lastWorkAt: now, workCount: current.workCount + 1
  };
  return { character: next, paid, pending: next.workProgress,
    experienceGain, jobLevel, leveledUp, bonus, mastered, effectiveSalary,
    condition:condition.label, payment:toBank?"bank":"cash" };
}

export function bankTransaction(character, action, amount) {
  if (!["deposit", "withdraw"].includes(action)) throw new Error("無效的銀行操作");
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("金額必須為正整數");
  if (action === "deposit") {
    if (amount > character.money) throw new Error("現金餘額不足");
    return { ...character, money: character.money - amount, bank: character.bank + amount };
  }
  if (amount > character.bank) throw new Error("銀行存款不足");
  return { ...character, money: character.money + amount, bank: character.bank - amount };
}
