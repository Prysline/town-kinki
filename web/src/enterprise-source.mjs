// Original command.pl / top.pl / unei_2.pl / kaishiya.pl / town_lib.pl.
// Approved differences: fee A (solvency), daily income B (independent).
import {STAT_KEYS} from "./engine.mjs";
export const EXTRA_KINDS=Object.freeze(["branch","operation","corporation","resale"]);
export const TRAIN_AMOUNTS=Object.freeze([1,2,3,5,10,20,30,50,80,100,200,300,500,800,1000]);
const safe=(n)=>{if(!Number.isSafeInteger(n)||n<0)throw Error("企業數值超出安全範圍");return n;};
export function parseEnterpriseRules(command,operation,corporation,house){
 const n=(s,k)=>{const m=s.match(new RegExp("\\$"+k+"\\s*=\\s*[\"']?(\\d+(?:\\.\\d+)?)[\"']?\\s*;"));if(!m)throw Error("找不到原版設定 "+k);return Number(m[1]);};
 const prices=command.match(/@housu_tuika2\s*=\s*\(([^)]+)\)/);
 if(!prices)throw Error("找不到追加建築費");
 const extraWan=prices[1].split(",").map(Number);
 const rule={maxBuildings:n(command,"mochiie_max"),appearanceMultiplier:n(command,"ie_bairitu"),extraWan,
  operationCap:n(operation,"syainjougen"),perOfficer:n(corporation,"syain_tantou"),officerCap:n(corporation,"yakuin_jougen"),
  intervalSeconds:n(operation,"unei_time")*3600,efficiency:n(operation,"unei_koritu"),fee:n(operation,"unei_hiyou"),
  height:n(operation,"unei_yobi5s"),weight:n(operation,"unei_yobi6s"),
  retainOnSale:/\$baikyku_syoumetu\s*=\s*'no'/.test(house),
  retainExtraEmployees:/\$syinsyoukyo\s*=\s*'no'/.test(corporation)};
 if(extraWan.length!==4||extraWan.some(x=>!Number.isSafeInteger(x)||x<0)||
  n(corporation,"unei_time")*3600!==rule.intervalSeconds||n(corporation,"unei_koritu")!==rule.efficiency||n(corporation,"kyouikuhiyou")!==rule.fee)throw Error("原版企業共同設定不一致");
 return Object.freeze(rule);
}
export function quoteExtraBuilding(rules,catalog,{townId,image,kind,existingKinds,assets,stats}){
 const index=EXTRA_KINDS.indexOf(kind);
 if(index<0||!Array.isArray(existingKinds)||!existingKinds.length||existingKinds.length>=rules.maxBuildings||existingKinds.includes(kind))throw Error("不符合追加建物種類或數量");
 if(index>=2&&(assets<100000000||STAT_KEYS.some(k=>!(stats?.[k]>=10000))))throw Error("基本能力審查未通過");
 const appearance=catalog.houses.find(h=>h.id===image&&h.supported);
 const landWan=catalog.landWan[townId];
 if(!appearance||!Number.isSafeInteger(landWan))throw Error("無效建築外觀或城鎮");
 const appearanceWan=safe(appearance.priceWan*rules.appearanceMultiplier),extraWan=rules.extraWan[index];
 return {townId,image:appearance.image,kind,landWan,appearanceWan,extraWan,total:safe((landWan+appearanceWan+extraWan)*10000)};
}
export function emptyEmployee(rules){
 return {stats:Object.fromEntries(STAT_KEYS.map(k=>[k,0])),height:rules.height,weight:rules.weight,lastTrained:0,job:"",score:0,foodTenths:0};
}
function checkStats(stats){for(const k of STAT_KEYS)safe(stats?.[k]);}
export function employeeCap(rules,kind,officerCount){
 if(kind==="operation")return rules.operationCap;
 if(kind!=="corporation"||!Number.isSafeInteger(officerCount)||officerCount<1||officerCount>rules.officerCap)throw Error("無效企業役員數");
 return rules.perOfficer*officerCount;
}
export function employeeIncome(employee,jobs){
 const salaries=new Map(jobs.map(j=>[j.originalName,j.salary]));
 return safe(Math.trunc(((salaries.get(employee.job)??0)*10+safe(employee.score)*10)/4));
}
export function projectEmployee(employee,jobs){
 checkStats(employee.stats);
 const height=employee.height||170,weight=employee.weight||65;
 const score=safe(Math.trunc(STAT_KEYS.reduce((sum,k)=>sum+employee.stats[k],0)*(height+weight)/20));
 const sorted=[...jobs].sort((a,b)=>b.salary-a.salary);
 // Perl loop leaves the last job in globals if all rows fail; only empty name becomes 浮浪者.
 const selected=sorted.find(j=>STAT_KEYS.every(k=>employee.stats[k]>=j.requirements[k]))??sorted.at(-1);
 const next={...employee,height,weight,score,job:selected?.originalName||"浮浪者"};
 return {...next,displayIncome:employeeIncome({...next,job:employee.job},jobs)};
}
export function trainEmployees(rules,jobs,{kind,employees,indices,actorStats,cash,bank,payment,creditValid,stat,amount,nowSeconds}){
 if(!["operation","corporation"].includes(kind)||!TRAIN_AMOUNTS.includes(amount)||!Number.isSafeInteger(nowSeconds)||nowSeconds<0||
 !Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length||
 (kind==="operation"&&indices.length!==1)||!indices.every(i=>Number.isInteger(i)&&i>=0&&i<employees.length))throw Error("無效教育選項");
 const food=stat==="food"&&kind==="corporation";
 if(!food&&!STAT_KEYS.includes(stat))throw Error("無效能力項目");
 checkStats(actorStats);safe(cash);safe(bank);
 if(!["cash","credit"].includes(payment)||(payment==="credit"&&!creditValid))throw Error("付款方式無效或信用卡已失效");
 for(const i of indices)if(nowSeconds-employees[i].lastTrained<rules.intervalSeconds)throw Error("尚未達到員工教育間隔");
 const consumed=food?0:safe(amount*indices.length);
 if(!food&&actorStats[stat]<consumed)throw Error("個人能力不足");
 const gain=Math.trunc(amount/rules.efficiency),cost=safe(gain*rules.fee*indices.length);
 if((payment==="cash"?cash:bank)<cost)throw Error("教育費不足");
 const updatedStats={...actorStats};if(!food)updatedStats[stat]-=consumed;
 const selected=new Set(indices);
 const rows=employees.map((e,i)=>{
  if(!selected.has(i))return projectEmployee(e,jobs);
  const next={...e,stats:{...e.stats},lastTrained:nowSeconds};
  if(food)next.foodTenths=safe((e.foodTenths??0)+gain);
  else next.stats[stat]=safe(next.stats[stat]+gain);
  return projectEmployee(next,jobs);
 });
 return {employees:rows,actorStats:updatedStats,cash:cash-(payment==="cash"?cost:0),bank:bank-(payment==="credit"?cost:0),gain,cost,consumed};
}
export function projectEnterpriseIncome({operation=[],corporation=[],officerIds=[],ownerId},jobs){
 const sum=rows=>safe(rows.reduce((s,e)=>safe(s+employeeIncome(e,jobs)),0));
 const operating=sum(operation),corporate=sum(corporation);
 const others=[...new Set(officerIds)].filter(id=>id!==ownerId);
 return {operating,corporate,ownerTotal:safe(operating+corporate),officers:others.map(userId=>({userId,amount:corporate}))};
}
