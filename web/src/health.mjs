// 原版 town_maker.cgi 的疾病指數與 basic.cgi::byouin 診療。
import { deriveCondition } from "./dining.mjs";
import { maxBodyEnergy, maxBrainEnergy } from "./engine.mjs";

export const DEFAULT_HEALTH_INDEX = 50;
export const TREATMENT_COSTS = Object.freeze({
  healthy:10000, slightCold:18000, cold:28000, diarrhea:32000,
  pneumonia:35000, tuberculosis:48000, brainTumor:64000, cancer:88000
});
const CONDITIONS = Object.freeze({
  slightCold:{name:"輕微感冒",baseExperience:-8},
  cold:{name:"感冒",baseExperience:-14},
  diarrhea:{name:"腹瀉",baseExperience:-17},
  pneumonia:{name:"肺炎",baseExperience:-20},
  tuberculosis:{name:"結核",baseExperience:null},
  brainTumor:{name:"腦瘤",baseExperience:null},
  cancer:{name:"癌症",baseExperience:null}
});
export function diseaseFromIndex(index) {
  if (!Number.isSafeInteger(index)) throw new Error("疾病指數不正確");
  const key=index< -100?"cancer":index< -70?"brainTumor":
    index< -40?"tuberculosis":index< -20?"pneumonia":
    index< -15?"diarrhea":index< -10?"cold":
    index<0?"slightCold":"healthy";
  return key==="healthy"
    ? {key,name:"健康",baseExperience:null}
    : {key,...CONDITIONS[key]};
}
export function healthIndexDelta(conditionKey) {
  // 原版在狀態「不良」使用 $byouki_sisuu -= -1（實際是增加 1）。
  return ({excellent:2,good:1,normal:0,poor:1,bad:-3,worst:0})[conditionKey] ?? 0;
}
export function healthStatus(character) {
  const index=character.healthIndex??DEFAULT_HEALTH_INDEX;
  const illness=diseaseFromIndex(index);
  return {...illness,index,lastSettledDay:character.lastHealthDay??""};
}
export function settleDailyHealth(character,day,now=Date.now()) {
  if (typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("疾病結算日期不正確");
  const previous=character.lastHealthDay??"";
  if (previous>=day) return {character,applied:false,delta:0};
  if (!previous) return {character:{...character,lastHealthDay:day,
    healthIndex:character.healthIndex??DEFAULT_HEALTH_INDEX},
    applied:false,delta:0};
  const condition=deriveCondition(character,maxBodyEnergy(character.stats),
    maxBrainEnergy(character.stats),now);
  // 舊角色尚未有餐點時間時只做首次登記，不追溯疾病演化。
  if (condition.provisional) return {character:{...character,lastHealthDay:day},
    applied:false,delta:0};
  const delta=healthIndexDelta(condition.key);
  const initial=character.healthIndex??DEFAULT_HEALTH_INDEX;
  if (!Number.isSafeInteger(initial+delta)) throw new Error("疾病指數超出可儲存範圍");
  return {character:{...character,lastHealthDay:day,healthIndex:initial+delta},
    applied:true,delta};
}
export function conditionWithIllness(condition,character) {
  const disease=diseaseFromIndex(character.healthIndex??DEFAULT_HEALTH_INDEX);
  if (disease.key==="healthy") return condition;
  return {...condition,key:disease.key,label:disease.name,
    baseExperience:disease.baseExperience,illness:true};
}
export function getTreatmentQuote(character,hasInsurance=false) {
  if (hasInsurance!==false&&hasInsurance!==true) throw new Error("保險參數不正確");
  const illness=diseaseFromIndex(character.healthIndex??DEFAULT_HEALTH_INDEX);
  const basePrice=TREATMENT_COSTS[illness.key];
  // 原版健康保險可折抵成三分之一；尚無物品管理系統，不能由客戶端自稱已投保。
  const price=hasInsurance?Math.floor(basePrice/3):basePrice;
  return {disease:illness,price,hasInsurance,basePrice};
}
export function treatAtHospital(character,now=Date.now(),hasInsurance=false) {
  const quote=getTreatmentQuote(character,hasInsurance);
  if (!Number.isSafeInteger(character.money)||character.money<quote.price)
    throw new Error("現金不足以支付醫療費");
  return {character:{...character,money:character.money-quote.price,
    healthIndex:DEFAULT_HEALTH_INDEX},paid:quote.price,
    previousDisease:quote.disease.name,treatedAt:now};
}
