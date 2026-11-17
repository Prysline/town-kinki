// TOWN 訓練系統：直接讀取原版 dat_dir/school.cgi 與 gym.cgi。
// 原版手冊規定學校每日一堂；本 fork 缺少完整訓練邏輯，其他行為為 Web 移植規則。
import { STAT_LABELS, recoverEnergy } from "./engine.mjs";

const BRAIN = ["kokugo", "suugaku", "rika", "syakai", "eigo", "ongaku", "bijutu"];
const BODY = ["looks", "tairyoku", "kenkou", "speed", "power", "wanryoku", "kyakuryoku"];

export const SCHOOL_ZH_TW = Object.freeze({
  "英会話講座": "英語會話課程",
  "日本語講座": "日語課程",
  "パソコン教室": "電腦課程",
  "デザイン講座": "設計課程",
  "ヴォーカル講座": "聲樂課程",
  "社会科学講義": "社會科學課程"
});

export const GYM_ZH_TW = Object.freeze({
  "スイミング": "游泳",
  "ウォーキング": "健走",
  "エアロビクス": "有氧運動",
  "ダンス": "舞蹈",
  "ストレッチ": "伸展運動",
  "テニス": "網球",
  "ゴルフ": "高爾夫球",
  "体力アップ": "體力強化",
  "健康アップ": "健康強化"
});

const wholeNumber = value => {
  if (!/^\d+$/.test(value)) throw new Error("訓練資料中包含無效數字");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("訓練資料數字超出上限");
  return number;
};

function records(source, type) {
  return source.split(/\r?\n/).slice(1).flatMap((line, index) => {
    if (!line.trim()) return [];
    const fields = line.replace(/\r$/, "").split("<>");
    const school = type === "school";
    const len = school ? 11 : 13;
    if (fields.length < len) throw new Error("無效的舊版訓練資料列：" + (index + 2));
    const originalName = fields[0];
    const keys = school ? BRAIN : BODY;
    const gains = Object.fromEntries(keys.map((key, i) => [key, wholeNumber(fields[i + 1])]));
    if (!school) gains.etti = wholeNumber(fields[10]);
    const price = wholeNumber(fields[8]);
    const energyCost = wholeNumber(fields[school ? 10 : 12]);
    const cooldownMs = school ? 0 : wholeNumber(fields[11]) * 60 * 1000;
    return [{
      key: type + "-" + (index + 2), type, originalName,
      name: (school ? SCHOOL_ZH_TW : GYM_ZH_TW)[originalName] ?? originalName,
      price, energyCost, gains, cooldownMs,
      // 原版 gym_kouka / school_kouka 可能對其他行為有影響，尚未移植。
      extraEffect: fields[9]
    }];
  });
}

export function parseLegacySchool(source) {
  return records(source, "school");
}

export function parseLegacyGym(source) {
  return records(source, "gym");
}

// 世界時間由多人伺服器統一決定；單機與多人共用同一套函式。
export function calendarDay(now = Date.now(), timeZone = "Asia/Taipei") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

export function trainingAvailability(character, lesson, now = Date.now(), day = calendarDay(now)) {
  if (!lesson || !["school", "gym"].includes(lesson.type)) return "找不到訓練課程";
  const current = recoverEnergy(character, now);
  if (lesson.type === "school" && current.lastSchoolDay === day)
    return "今日已經上過一堂課，請明天再來";
  if (lesson.type === "gym" && current.gymReadyAt > now)
    return "健身房還需要等待 " + Math.ceil((current.gymReadyAt - now) / 1000) + " 秒";
  if (current.money < lesson.price) return "現金不足";
  if (lesson.type === "school" && current.brainEnergy < lesson.energyCost)
    return "頭腦能量不足";
  if (lesson.type === "gym" && current.bodyEnergy < lesson.energyCost)
    return "身體能量不足";
  return null;
}

export function performTraining(character, lesson, now = Date.now(), day = calendarDay(now)) {
  const current = recoverEnergy(character, now);
  const reason = trainingAvailability(current, lesson, now, day);
  if (reason) throw new Error(reason);
  const stats = { ...current.stats };
  for (const [key, amount] of Object.entries(lesson.gains)) {
    if (!Object.hasOwn(STAT_LABELS, key)) throw new Error("不支援的能力值");
    stats[key] = (stats[key] ?? 0) + amount;
  }
  const next = {
    ...current, money: current.money - lesson.price, stats,
    ...(lesson.type === "school"
      ? { brainEnergy: current.brainEnergy - lesson.energyCost, lastSchoolDay: day }
      : { bodyEnergy: current.bodyEnergy - lesson.energyCost,
          lastGymAt: now, gymReadyAt: now + lesson.cooldownMs })
  };
  return { character: next, gained: lesson.gains, paid: lesson.price, lesson: lesson.name };
}
