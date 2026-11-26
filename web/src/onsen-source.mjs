// AP-05 原版來源計算層，與 WK-01 共用情境公式。
import {originalBodyEnergyMaximum,originalBrainEnergyMaximum} from "./energy-maxima.mjs";
const BATHS=Object.freeze([
  ["futuu","one","普通浴池","onsen_times","nyuuyokuryou"],
  ["koukyuu","two","特別浴池",null,null],
  ["koukyuu_ume","three","梅級浴池","ume_times","ume_hiyou"],
  ["koukyuu_take","fo","竹級浴池","take_times","take_hiyou"],
  ["koukyuu_matu","five","松級浴池","matu_times","matu_hiyou"],
  ["special_dou","six","銅級浴池","dou_times","dou_hiyou"],
  ["special_gin","seven","銀級浴池","gin_times","gin_hiyou"],
  ["special_kin","eight","金級浴池","kin_times","kin_hiyou"]
].map(Object.freeze));
const BODY_WEIGHTS=Object.freeze({looks:12,tairyoku:4,kenkou:4,speed:8,power:8,wanryoku:8,kyakuryoku:8});
const BRAIN_KEYS=Object.freeze(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu"]);
function number(value,label){
  if(!Number.isFinite(value)||value<0)throw Error("原版溫泉來源數值無效："+label);
  return value;
}
function second(value,label){
  if(!Number.isSafeInteger(value)||value<0)throw Error("原版溫泉時間無效："+label);
  return value;
}
function configuredInteger(source,key){
  const expression=new RegExp("^\\s*\\$"+key+"\\s*=\\s*(['\"])([0-9]+)\\1\\s*;","gm");
  const matches=[...source.matchAll(expression)];
  if(matches.length!==1)throw Error("原版溫泉設定缺失或重複："+key);
  const value=Number(matches[0][2]);
  if(!Number.isSafeInteger(value)||value<=0)throw Error("原版溫泉設定無效："+key);
  return value;
}
export function parseOriginalOnsenConfig(source){
  if(typeof source!=="string")throw Error("缺少 town_ini.cgi 原始來源");
  const keys=["sintai_kaihuku","zunou_kaihuku","on_gazou_suu","tokubetu_times","tokubetuburo_hiyou",
    ...BATHS.flatMap(row=>row.slice(3).filter(Boolean))];
  return Object.freeze(Object.fromEntries(keys.map(key=>[key,configuredInteger(source,key)])));
}
// basic.cgi::onsen L1036–1037：入浴/選單 +1；town_maker.cgi::loged_gamen L663–664：出浴無 +1。
export function originalOnsenMaxima(stats,phase="entry"){
  if(phase!=="entry"&&phase!=="exit")throw Error("未知的原版溫泉階段");
  for(const key of [...Object.keys(BODY_WEIGHTS),...BRAIN_KEYS])number(stats?.[key],key);
  const context=phase==="entry"?"onsen-entry":"resident";
  return {body:originalBodyEnergyMaximum(stats,context),brain:originalBrainEnergyMaximum(stats,context)};
}
export function originalOnsenOptions(config,stats,phase="entry"){
  const maxima=originalOnsenMaxima(stats,phase);
  const special=Math.max(2,Math.trunc(Math.max(maxima.body,maxima.brain)/50));
  return BATHS.map(([key,exitKey,label,rateKey,feeKey])=>{
    const rate=rateKey?number(config?.[rateKey],rateKey):special;
    const fee=feeKey?number(config?.[feeKey],feeKey):special*100;
    if(rate<=0||!Number.isSafeInteger(rate)||!Number.isSafeInteger(fee))throw Error("原版溫泉倍率或費用無效");
    return {key,exitKey,label,rate,fee};
  });
}
function bathFor(options,key,field){
  const bath=options.find(b=>b[field]===key);
  if(!bath)throw Error("未知的原版浴池");
  return bath;
}
function project(state,config,now,rate,extra){
  second(now,"now");second(state.lastBodyAt,"lastBodyAt");second(state.lastBrainAt,"lastBrainAt");
  const bodyInterval=number(config.sintai_kaihuku,"sintai_kaihuku");
  const brainInterval=number(config.zunou_kaihuku,"zunou_kaihuku");
  if(bodyInterval<=0||brainInterval<=0)throw Error("原版恢復間隔必須大於零");
  return {
    body:number(state.bodyEnergy,"bodyEnergy")+Math.trunc((now-state.lastBodyAt)/bodyInterval*rate)+extra,
    brain:number(state.brainEnergy,"brainEnergy")+Math.trunc((now-state.lastBrainAt)/brainInterval*rate)+extra
  };
}
const clamp=(n,max)=>Math.max(0,Math.min(max,n));
function secondsToFull(max,value,rate,interval){
  return Math.trunc((max-value)/rate*interval);
}
// basic.cgi L1053–1132：選單以松浴倍率加 1 暫算，未寫入角色。銀列誤用金列時間的
// 原版顯示異常另記於文件；本函式提供各浴池實際來源公式，而非重製該顯示錯誤。
export function quoteOriginalOnsen(state,config,now){
  const maxima=originalOnsenMaxima(state.stats);
  const preview=project(state,config,now,config.matu_times,1);
  return originalOnsenOptions(config,state.stats).map(bath=>({
    ...bath,
    bodySeconds:Math.max(0,secondsToFull(maxima.body,preview.body,bath.rate,config.sintai_kaihuku)),
    brainSeconds:Math.max(0,secondsToFull(maxima.brain,preview.brain,bath.rate,config.zunou_kaihuku))
  }));
}
// 僅回傳能量、原價及原始進場時計算的剩餘秒數，不扣款、不執行 RNG、不寫存檔。
// 銅銀金能力提升及交易安全由後續整合另處理，不能將此函式當作完整入浴。
export function projectOriginalOnsenEntryEnergy(state,config,key,now){
  const bath=bathFor(originalOnsenOptions(config,state.stats),key,"key");
  const maxima=originalOnsenMaxima(state.stats);
  const raw=project(state,config,now,bath.rate,1);
  return {bath,maxima,bodyEnergy:clamp(raw.body,maxima.body),brainEnergy:clamp(raw.brain,maxima.brain),
    lastBodyAt:now,lastBrainAt:now,
    // 原版以 onsec + int(...) + 1，再 localtime(...+1)；保留相對秒數，可能為負。
    sourceBodyDisplayOffset:secondsToFull(maxima.body,raw.body,bath.rate,config.sintai_kaihuku)+2,
    sourceBrainDisplayOffset:secondsToFull(maxima.brain,raw.brain,bath.rate,config.zunou_kaihuku)+2};
}
// town_maker.cgi L668–722：離開以請求中的 iiyudane 選倍率，兩個恢復時計重新設為 now。
// 這是純來源模型；正式 Web 不得信任客戶端提供的 exitKey。
export function projectOriginalOnsenExitEnergy(state,config,exitKey,now){
  const bath=bathFor(originalOnsenOptions(config,state.stats,"exit"),exitKey,"exitKey");
  const maxima=originalOnsenMaxima(state.stats,"exit");
  const raw=project(state,config,now,bath.rate,0);
  return {bath,maxima,bodyEnergy:clamp(raw.body,maxima.body),brainEnergy:clamp(raw.brain,maxima.brain),
    lastBodyAt:now,lastBrainAt:now};
}

// basic.cgi 的能力區段為每個 CGI 請求重新初始化的 Perl 全域變數。
// 僅模型化正常正整數能力的原始分支，不修正作者筆誤或在玩家端執行。
const SILVER_DRAW_KEYS=Object.freeze(Object.keys(BODY_WEIGHTS));
const GOLD_DRAW_KEYS=Object.freeze([...SILVER_DRAW_KEYS,...BRAIN_KEYS,"love","unique","etti"]);
function projectAbilityRolls(stats,key,random,correctTypos){
  if(!BATHS.some(b=>b[0]===key))throw Error("未知的原版浴池");
  const keys=key==="special_dou"?["tairyoku","kenkou"]:
    key==="special_gin"?SILVER_DRAW_KEYS:key==="special_kin"?GOLD_DRAW_KEYS:[];
  const sides=key==="special_dou"?10:20;
  const next={...stats};
  for(const stat of keys){
    if(!Number.isSafeInteger(stats?.[stat])||stats[stat]<(correctTypos?0:1))
      throw Error("能力來源模型數值不正確："+stat);
  }
  const rolls=keys.map(stat=>{
    const value=random();
    if(!Number.isFinite(value)||value<0||value>=1)throw Error("無效的受控亂數");
    return {stat,sides,roll:Math.floor(value*sides)+1};
  });
  const gains={};
  for(const {stat,roll} of rolls){
    // 銀／金：tairyoku_up 與 tairyku_up 不同，未初始化讀成 0，實際體力不變。
    if(!correctTypos&&sides===20&&stat==="tairyoku")continue;
    // spped_up 未初始化，判斷永遠通過，因此 speed_up 1～20 都會增加。
    if(!(!correctTypos&&sides===20&&stat==="speed")&&roll>(sides===10?3:10))continue;
    // $$kyakuryoku 對正整數能力解參照 Perl 的唯讀數字變數。原版在扣款、寫檔前中止。
    // 保留未提交的暫存能力供差分比較，不把這些值當成可保存的交易結果。
    if(!correctTypos&&sides===20&&stat==="kyakuryoku")return {
      status:"source-abort",reason:"read-only-value",rolls,stats:{...stats},gains:{},uncommittedStats:next
    };
    const total=next[stat]+roll;
    if(!Number.isSafeInteger(total))throw Error("能力數值超出安全整數範圍");
    next[stat]=total;
    gains[stat]=roll;
  }
  return {status:"source-ok",rolls,stats:next,gains};
}

// 原始未修復版本只供來源差分，不得當作核准的正式交易規則。
export function projectOriginalOnsenAbilityRolls(stats,key,random=Math.random){
  return projectAbilityRolls(stats,key,random,false);
}
// 使用者決策二 B：僅修復銀／金浴的體力、速度與腿力三處筆誤。
// 不更改原始抽選次數、次序、亂數範圍、費用、倍率或其他能力門檻。
export function projectApprovedOnsenAbilityRolls(stats,key,random=Math.random){
  return projectAbilityRolls(stats,key,random,true);
}
