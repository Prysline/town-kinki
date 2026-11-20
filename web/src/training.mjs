// 學校、健身房讀取原版資料表；獨立教室有 kyushitu.cgi 真正的執行依據。
// 不將教室的減重與雙能量消耗套到只有資料表的 gym/school。
import { STAT_KEYS, STAT_LABELS, recoverEnergy, bodyMassIndex } from "./engine.mjs";

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

export const CLASSROOM_ZH_TW = Object.freeze({
  "フラフラダンス":"搖搖晃晃舞蹈",
  "フラダンス":"草裙舞",
  "帝王学ミニ":"帝王學入門",
  "帝王学":"帝王學"
});

// kyushitu.cgi L35、L61–65：名稱＋17 項能力＋金額、效果、間隔分鐘、雙能量。
// 原版只為這個獨立教室提供 kyushitu_go 的可執行訓練規則。
export function parseLegacyClassroom(source) {
  return source.split(/\r?\n/).slice(1).flatMap((line,index)=>{
    if(!line.trim())return [];
    const fields=line.replace(/\r$/,"").split("<>");
    if(fields.length<23)throw new Error("無效的原版教室資料列："+(index+2));
    const originalName=fields[0];
    const gains=Object.fromEntries(STAT_KEYS.map((key,i)=>[key,wholeNumber(fields[i+1])]));
    const price=wholeNumber(fields[18]);
    const cooldownMs=wholeNumber(fields[20])*60_000;
    const bodyCost=wholeNumber(fields[21]);
    const brainCost=wholeNumber(fields[22]);
    return [{
      key:"classroom-"+(index+2), type:"classroom", originalName,
      name:CLASSROOM_ZH_TW[originalName]??originalName,
      gains,price,cooldownMs,bodyCost,brainCost,
      weightLoss:(bodyCost+brainCost)/100,
      extraEffect:fields[19]  // 保留原文；來源沒有證明可執行的額外效果
    }];
  });
}

// 世界時間由多人伺服器統一決定；單機與多人共用同一套函式。
export function calendarDay(now = Date.now(), timeZone = "Asia/Taipei") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

// 學校是「遊戲時區每日一次」，不是上課後固定等待 24 小時。
// 找出下一次當地日期切換的 UTC 時刻，避免伺服器系統時區與夏令時間誤差。
export function nextCalendarDayStartMs(now = Date.now(), timeZone = "Asia/Taipei") {
  if (!Number.isFinite(now)) throw new Error("無效的遊戲時間");
  const today=calendarDay(now,timeZone);
  let lower=Math.floor(now);
  let upper=lower+36*60*60*1000;
  if(calendarDay(upper,timeZone)===today)
    throw new Error("無法找到遊戲時區的下一日");
  while(upper-lower>1){
    const middle=Math.floor((lower+upper)/2);
    if(calendarDay(middle,timeZone)===today)lower=middle;
    else upper=middle;
  }
  return upper;
}

export function trainingAvailability(character, lesson, now = Date.now(), day = calendarDay(now), payment = "cash") {
  if (!lesson || !["school", "gym", "classroom"].includes(lesson.type)) return "找不到訓練課程";
  if(payment!=="cash"&&!(lesson.type==="classroom"&&payment==="credit"))
    return "不支援的課程付款方式";
  const current = recoverEnergy(character, now);
  if (lesson.type === "school" && current.lastSchoolDay === day)
    return "今日已經上過一堂課，請明天再來";
  if (lesson.type === "gym" && current.gymReadyAt > now)
    return "健身房還需要等待 " + Math.ceil((current.gymReadyAt - now) / 1000) + " 秒";
  if (lesson.type === "classroom" && (current.classroomReadyAt??0)>now)
    return "教室還需要等待 "+Math.ceil((current.classroomReadyAt-now)/1000)+" 秒";
  if(payment==="credit"){
    if(!Number.isSafeInteger(current.bank)||current.bank<lesson.price)
      return "普通銀行存款不足";
  }else if (current.money < lesson.price) return "現金不足";
  if (lesson.type === "school" && current.brainEnergy < lesson.energyCost)
    return "頭腦能量不足";
  if (lesson.type === "gym" && current.bodyEnergy < lesson.energyCost)
    return "身體能量不足";
  if (lesson.type === "classroom" && current.bodyEnergy < lesson.bodyCost)
    return "身體能量不足";
  if (lesson.type === "classroom" && current.brainEnergy < lesson.brainCost)
    return "頭腦能量不足";
  return null;
}

export function performTraining(character, lesson, now = Date.now(), day = calendarDay(now), payment = "cash") {
  const current = recoverEnergy(character, now);
  const reason = trainingAvailability(current, lesson, now, day, payment);
  if (reason) throw new Error(reason);
  const stats = { ...current.stats };
  for (const [key, amount] of Object.entries(lesson.gains)) {
    if (!Object.hasOwn(STAT_LABELS, key)) throw new Error("不支援的能力值");
    stats[key] = (stats[key] ?? 0) + amount;
  }
  let extra;
  if(lesson.type==="school"){
    extra={brainEnergy:current.brainEnergy-lesson.energyCost,lastSchoolDay:day};
  }else if(lesson.type==="gym"){
    extra={bodyEnergy:current.bodyEnergy-lesson.energyCost,
      lastGymAt:now,gymReadyAt:now+lesson.cooldownMs};
  }else{
    // kyushitu.cgi::kyushitu_go L139–143：扣除兩種能量，體重減少兩種消耗／100。
    // 最低 1kg 為 Web 防止非物理負數的保護；原版未做此保護。
    const weight=Math.max(1,Math.round((current.weight-lesson.weightLoss)*100)/100);
    extra={bodyEnergy:current.bodyEnergy-lesson.bodyCost,
      brainEnergy:current.brainEnergy-lesson.brainCost,
      classroomReadyAt:now+lesson.cooldownMs,
      weight,bmi:bodyMassIndex(current.height,weight)};
  }
  const next={...current,stats,...extra,
    money:current.money-(payment==="cash"?lesson.price:0),
    bank:current.bank-(payment==="credit"?lesson.price:0)};
  return {character:next,gained:lesson.gains,paid:lesson.price,payment,
    lesson:lesson.name,weightLoss:lesson.type==="classroom"?
      Math.round((current.weight-next.weight)*100)/100:0};
}
