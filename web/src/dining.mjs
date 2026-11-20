// 依原版 top.pl（空腹度）、town_lib.pl（BMI）與 command.pl（食堂）移植。
// 兩份食堂資料目前固定列出，原版每日抽選／共用庫存待另行完成。
export const MEAL_COOLDOWN_MS = 60 * 60 * 1000;
export const HUNGER_LABELS = Object.freeze({
  untracked:"尚無用餐紀錄", full:"飽足", comfortable:"剛剛好",
  slightlyHungry:"稍微餓了", hungry:"飢餓", veryHungry:"非常飢餓",
  starving:"極度飢餓", dangerous:"快餓昏了", critical:"瀕臨餓死"
});
const TRANSLATIONS = Object.freeze({
  "牛丼":"牛肉蓋飯","親子丼":"親子丼","うどん":"烏龍麵",
  "お寿司":"壽司","うな重":"鰻魚飯","カツ丼":"炸豬排蓋飯",
  "天丼":"天婦羅蓋飯","ショウガ焼き定食":"薑汁燒肉定食",
  "チャーハン":"炒飯","オムライス":"蛋包飯",
  "カレーライス":"咖哩飯","ラーメン":"拉麵","そば":"蕎麥麵",
  "焼きそば":"炒麵","おにぎり":"飯糰","ハンバーグ":"漢堡排",
  "ピザ":"披薩","スパゲティ":"義大利麵","サンドイッチ":"三明治"
});
const STAT_POSITIONS = Object.freeze({
  kokugo:2,suugaku:3,rika:4,syakai:5,eigo:6,ongaku:7,bijutu:8,
  looks:10,tairyoku:11,kenkou:12,speed:13,power:14,
  wanryoku:15,kyakuryoku:16,love:18,unique:19,etti:20
});
function sourceNumber(value, field) {
  if (!/^\d+$/.test(value)) throw new Error("舊版食物資料的" + field + "不是非負整數");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("舊版食物資料數字過大");
  return number;
}
export function parseLegacyMeals(source, menu = "main") {
  if (!["main","second"].includes(menu)) throw new Error("無效的菜單種類");
  if (typeof source !== "string") throw new Error("無效的菜單資料");
  return source.split(/\r?\n/).slice(1).flatMap((line,index)=>{
    if (!line.trim()) return [];
    const f=line.replace(/\r$/,"").split("<>");
    if (f[0] !== "食") return [];
    if (f.length < 26 || !f[1]) throw new Error("舊版食物資料列缺漏");
    const gains=Object.fromEntries(Object.entries(STAT_POSITIONS).map(
      ([key,pos])=>[key,sourceNumber(f[pos],key)]
    ));
    const price=sourceNumber(f[17],"售價")*3;
    const calories=sourceNumber(f[25],"熱量");
    if (!Number.isSafeInteger(price)) throw new Error("食物售價超出安全上限");
    const originalName=f[1];
    const base=originalName.replace(/2$/,"");
    return [{
      key:"meal-"+menu+"-"+(index+2),
      name:TRANSLATIONS[base] || originalName,
      originalName,menu,price,calories,gains
    }];
  });
}
export function hungerStatus(lastMealAt,now=Date.now(),mealInterval=MEAL_COOLDOWN_MS) {
  if (!Number.isSafeInteger(now)||now<0) throw new Error("無效的時間");
  if (!Number.isSafeInteger(lastMealAt)||lastMealAt<0) throw new Error("無效的用餐時間");
  // 新／舊版 Web 尚未記錄用餐時，不回推數千天的飢餓與角色死亡。
  if (lastMealAt===0) return {key:"untracked",label:HUNGER_LABELS.untracked,
    elapsedMs:null,nextMealAt:null,canEat:true};
  const delta=Math.max(0,now-lastMealAt);
  const hour=60*60*1000;
  const key=delta<mealInterval?"full":
    delta<mealInterval+2*hour?"comfortable":
    delta<mealInterval+12*hour?"slightlyHungry":
    delta<mealInterval+24*hour?"hungry":
    delta<mealInterval+48*hour?"veryHungry":
    delta<mealInterval+96*hour?"starving":
    delta<mealInterval+24*hour*2995?"dangerous":"critical";
  return {key,label:HUNGER_LABELS[key],elapsedMs:delta,
    nextMealAt:lastMealAt+mealInterval,canEat:delta>=mealInterval};
}
// 原版 basic.cgi 先以 Perl sprintf("%.1f") 格式化體重，town_lib.pl 再 int(BMI)。
// JS Math.round(weight*10) 在 17.95、24.95 等二進位浮點邊界與 Perl 不同。
// Number.toFixed(1) 保留原始 IEEE-754 值的十進位捨入；只有精確中點時，
// Perl 的 sprintf 採「五捨六入、五取偶」（round half to even），toFixed 則向上取。
// 0.1 的精確二進位中點只會出現在 *.25 / *.75 等四分之一數值。
function perlWeightOneDecimal(weight) {
  const rounded=Number(weight.toFixed(1));
  const quarters=weight*4;
  const lowerTenth=Math.floor(weight*10);
  return Number.isSafeInteger(quarters) && quarters%2!==0 && lowerTenth%2===0
    ? lowerTenth/10 : rounded;
}
export function legacyPhysiqueBmi(height,weight) {
  if (!Number.isFinite(height)||height<=0||!Number.isFinite(weight)||weight<0)
    throw new Error("無效的身高體重");
  const roundedWeight=perlWeightOneDecimal(weight);
  const bmi=Math.trunc(roundedWeight/((height/100)**2));
  if (!Number.isFinite(bmi)) throw new Error("無效的身高體重");
  return bmi;
}
export function physiqueStatus(height,weight) {
  const bmi=legacyPhysiqueBmi(height,weight);
  const key=bmi>=26?"obese":bmi>=24?"overweight":bmi>=20?"normal":
    bmi>=18?"underweight":"veryUnderweight";
  const labels={obese:"肥胖",overweight:"稍微偏胖",normal:"標準",
    underweight:"稍微偏瘦",veryUnderweight:"過度消瘦"};
  const multipliers={obese:0.8,overweight:0.95,normal:1,
    underweight:0.95,veryUnderweight:0.8};
  return {bmi,key,label:labels[key],multiplier:multipliers[key]};
}
export function deriveCondition(character,maxBody,maxBrain,now=Date.now()) {
  const hunger=hungerStatus(character.lastMealAt??0,now);
  const physique=physiqueStatus(character.height,character.weight);
  if (hunger.key==="untracked") return {
    key:"normal",label:"普通",baseExperience:5,score:null,
    hunger,physique,provisional:true
  };
  const bodyPercent=Math.trunc(Math.max(0,character.bodyEnergy)/Math.max(1,maxBody)*100);
  const brainPercent=Math.trunc(Math.max(0,character.brainEnergy)/Math.max(1,maxBrain)*100);
  const hungerMultiplier={
    full:0.8,comfortable:1,slightlyHungry:0.9,hungry:0.7,
    veryHungry:0.6,starving:0.5,dangerous:0.3,critical:0.3
  }[hunger.key];
  const score=((bodyPercent+brainPercent)/2+(character.stats.kenkou??0)/100)*
    hungerMultiplier*physique.multiplier;
  const key=score>98?"excellent":score>75?"good":score>50?"normal":
    score>30?"poor":score>10?"bad":"worst";
  const labels={excellent:"最佳",good:"良好",normal:"普通",poor:"不良",
    bad:"差",worst:"最差"};
  const bases={excellent:15,good:10,normal:5,poor:1,bad:-5,worst:null};
  return {key,label:labels[key],baseExperience:bases[key],
    score:Math.round(score*100)/100,hunger,physique,provisional:false};
}
export function eatMeal(character,meal,now=Date.now()) {
  if (!meal || typeof meal!=="object" || typeof meal.key!=="string" ||
      !Number.isSafeInteger(meal.price)||meal.price<0 ||
      !Number.isSafeInteger(meal.calories)||meal.calories<0)
    throw new Error("無效的食堂餐點");
  const hunger=hungerStatus(character.lastMealAt??0,now);
  if (!hunger.canEat) throw new Error("用餐後需等待 60 分鐘才能再次用餐");
  if (character.money<meal.price) throw new Error("現金不足以支付餐費");
  const stats={...character.stats};
  for(const [key,amount] of Object.entries(meal.gains??{})) {
    if (!Object.hasOwn(STAT_POSITIONS,key)||!Number.isSafeInteger(amount)||amount<0)
      throw new Error("餐點的能力增加資料不正確");
    if (!Number.isSafeInteger((stats[key]??0)+amount)) throw new Error("角色能力超出安全範圍");
    stats[key]=(stats[key]??0)+amount;
  }
  const weight=Math.round((character.weight+meal.calories/1000)*100)/100;
  if (!Number.isFinite(weight)||weight<=0) throw new Error("角色體重資料不正確");
  const next={...character,money:character.money-meal.price,stats,weight,
    bmi:Math.round(weight/((character.height/100)**2)*10)/10,lastMealAt:now};
  return {character:next,meal:meal.name,paid:meal.price,
    gained:meal.gains,weightGain:meal.calories/1000};
}
