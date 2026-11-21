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

export const JOB_ZH_TW = Object.freeze({
  "日払いバイト": "日薪打工", "コンビニ店員": "便利商店店員",
  "コンビニ店長": "便利商店店長", "八百屋さん": "蔬果店員",
  "新聞配達": "送報員", "ファミレス店員": "家庭餐廳店員",
  "ファミレス店長": "家庭餐廳店長", "コック": "廚師",
  "高級レストランのコック": "高級餐廳廚師", "料理の鉄人": "料理達人",
  "美容師": "美髮師", "カリスマ美容師": "人氣美髮師",
  "大工": "木匠", "棟梁": "工頭", "漁師": "漁夫",
  "名漁師": "資深漁夫", "農家": "農夫", "大型農家": "大型農場主",
  "カリスマ農家": "人氣農場主", "サラリーマン": "上班族",
  "部長": "部長", "常務": "常務董事", "社長": "社長",
  "会長": "會長", "看護師": "護理師", "看護師長": "護理長",
  "看護部長": "護理部主任", "教師": "教師",
  "教頭先生": "副校長", "校長先生": "校長", "警官": "警察",
  "警部": "警部", "警視監": "警視監", "警視総監": "警視總監",
  "大学教授": "大學教授", "大学名誉教授": "大學榮譽教授",
  "東大名誉教授": "東京大學榮譽教授", "編集者": "編輯",
  "チーフエディター": "資深編輯", "編集長": "總編輯",
  "銀行員": "銀行行員", "銀行支店長": "銀行分行經理",
  "頭取": "銀行總裁", "商社マン": "貿易公司職員",
  "商社（部長）": "貿易公司部長", "商社（社長）": "貿易公司社長",
  "学者": "學者", "有名学者": "知名學者", "ノーベル賞学者": "諾貝爾獎學者",
  "デザイナー": "設計師", "有名デザイナー": "知名設計師",
  "世界的デザイナー": "世界級設計師", "プログラマー": "程式設計師",
  "有名プログラマー": "知名程式設計師",
  "世界的プログラマー": "世界級程式設計師",
  "作詞家": "作詞家", "有名作詞家": "知名作詞家",
  "超売れっ子作詞家": "當紅作詞家", "作家": "作家",
  "有名作家": "知名作家", "芥川賞作家": "芥川獎作家",
  "作曲家": "作曲家", "有名作曲家": "知名作曲家",
  "グラミー賞作曲家": "葛萊美獎作曲家",
  "ダンサー": "舞者", "有名ダンサー": "知名舞者",
  "スーパーダンサー": "頂尖舞者", "スチュワーデス": "空服員",
  "エリート・スチュワーデス": "菁英空服員"
});

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

export function maxBodyEnergy(stats) {
  return Math.floor(
    stats.tairyoku / 2 + stats.kenkou / 3 + stats.power / 5 +
    stats.wanryoku / 8 + stats.kyakuryoku / 8
  );
}

export function maxBrainEnergy(stats) {
  return Math.floor(STARTING_BUDGETS[0].keys.reduce((sum, key) => sum + stats[key] / 4, 0));
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

export function recoverEnergy(character, now = Date.now()) {
  const ticks = Math.max(0, Math.floor((now - character.recoveredAt) / ENERGY_RECOVERY_MS));
  const maxBody = maxBodyEnergy(character.stats);
  const maxBrain = maxBrainEnergy(character.stats);
  const bodyEnergy = Math.min(maxBody, character.bodyEnergy + ticks);
  const brainEnergy = Math.min(maxBrain, character.brainEnergy + ticks);
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
  const current = recoverEnergy(character, now);
  // basic.cgi::do_work 實際只重新確認能力與 BMI（能量另行檢查）。
  const reason = eligibility(current, job, false, false);
  if (reason) throw new Error(reason);
  if (current.bodyEnergy < job.bodyCost || current.brainEnergy < job.brainCost)
    throw new Error("身體或頭腦能量不足");
  const condition = conditionWithIllness(deriveCondition(current,maxBodyEnergy(current.stats),
    maxBrainEnergy(current.stats),now),current);
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
