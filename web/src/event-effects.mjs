// 從原版 event.pl::event_happen 移植不需額外道具與其他模組的事件分支。
import { maxBodyEnergy, maxBrainEnergy } from "./engine.mjs";
// 原 CGI 可產生負數金錢／能力；Web 版為保持既有非負值模型將扣除量限制在當前持有量。
const STAT_EVENTS = Object.freeze({
  7:{key:"literature",title:"國語事件",stat:"kokugo",label:"國語",
    positive:"閱讀文學後有所領悟",negative:"長時間使用電腦，忘記了一些漢字"},
  8:{key:"mathematics",title:"數學事件",stat:"suugaku",label:"數學",
    positive:"玩了數學益智遊戲",negative:"患上數字恐懼症"},
  9:{key:"science",title:"理科事件",stat:"rika",label:"理科",
    positive:"看了電視上的科學節目",negative:"做理科實驗時打破了試管"},
  10:{key:"history",title:"社會事件",stat:"syakai",label:"社會",
    positive:"閱讀了歷史書",negative:"對社會的關心漸漸消退"},
  12:{key:"arts",title:"美術事件",stat:"bijutu",label:"美術",
    positive:"對藝術產生興趣",negative:"在美術課睡著了"}
});
export const NON_ITEM_EVENT_IDS = Object.freeze([
  1,2,5,6,7,8,9,10,12,13,14,24,25,26,27,33,39,41,43
]);

function draw(random,n) {
  const value=random();
  if (typeof value!=="number"||!Number.isFinite(value)||value<0||value>=1)
    throw new Error("事件亂數產生器回傳無效數值");
  return Math.floor(value*n)+1;
}
function int(value,label) {
  if(!Number.isSafeInteger(value)||value<0)throw new Error("角色"+label+"資料不正確");
  return value;
}
function changeMoney(old,delta) {
  int(old,"現金");
  if(!Number.isSafeInteger(delta))throw new Error("無效的事件現金變化");
  const result=BigInt(old)+BigInt(delta);
  if(result>BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("事件現金超出安全整數範圍");
  const money=result<0n?0:Number(result);
  return {money,actualDelta:money-old};
}
function changeWeight(old,delta,height) {
  if(typeof old!=="number"||!Number.isFinite(old)||old<=0||
    typeof height!=="number"||!Number.isFinite(height)||height<=0)
    throw new Error("角色身高體重資料不正確");
  const weight=Math.max(0.01,Math.round((old+delta)*100)/100);
  const bmi=Math.round(weight/((height/100)**2)*10)/10;
  return {weight,bmi,actualDelta:Math.round((weight-old)*100)/100};
}
function changeStat(old,key,delta) {
  const stats=JSON.parse(old);
  if(!stats||typeof stats!=="object"||Array.isArray(stats))throw new Error("角色能力資料不正確");
  int(stats[key],key);
  const next=Math.max(0,stats[key]+delta);
  if(!Number.isSafeInteger(next))throw new Error("事件能力值超出安全整數範圍");
  return {stats_json:JSON.stringify({...stats,[key]:next}),actualDelta:next-stats[key]};
}
export function resolveNonItemEvent(originalId,character,random=Math.random) {
  if(!Number.isSafeInteger(originalId)||!NON_ITEM_EVENT_IDS.includes(originalId))
    return null;
  if(typeof random!=="function")throw new Error("事件亂數產生器不正確");
  const event={originalId, key:"",title:"",description:""};
  const changes={};
  let effects={};
  function addMoney(delta) {
    const computed=changeMoney(character.money,delta);
    changes.money=computed.money;
    effects.money=computed.actualDelta;
    return computed.actualDelta;
  }
  function addWeight(delta) {
    const computed=changeWeight(character.weight,delta,character.height);
    changes.weight=computed.weight;
    changes.bmi=computed.bmi;
    effects.weight=computed.actualDelta;
    return computed.actualDelta;
  }
  function adjustEnergy(column,delta,limit=null) {
    const old=int(character[column],column==="body_energy"?"身體能量":"頭腦能量");
    const next=Math.max(0,Math.min(limit??Number.MAX_SAFE_INTEGER,old+delta));
    if(!Number.isSafeInteger(next))throw new Error("事件能量值超出安全範圍");
    changes[column]=next;
    effects[column==="body_energy"?"bodyEnergy":"brainEnergy"]=next-old;
    return next-old;
  }
  function grantEnergy(amount){
    const stats=JSON.parse(character.stats_json);
    const bodyMax=maxBodyEnergy(stats),brainMax=maxBrainEnergy(stats);
    if(!Number.isSafeInteger(bodyMax)||bodyMax<0||!Number.isSafeInteger(brainMax)||brainMax<0)
      throw new Error("角色能量上限資料不正確");
    const body=adjustEnergy("body_energy",amount,bodyMax);
    const brain=adjustEnergy("brain_energy",amount,brainMax);
    return {body,brain};
  }
  function subtractEnergy(column,divisor) {
    const existing=int(character[column],column);
    return adjustEnergy(column,-Math.floor(existing/divisor));
  }
  function addJobExperience(delta){
    const old=int(character.job_experience,"職業經驗");
    const next=Math.max(0,old+delta);
    if(!Number.isSafeInteger(next))throw new Error("事件職業經驗超出安全範圍");
    changes.job_experience=next;
    effects.jobExperience=next-old;
    return next-old;
  }
  switch(originalId) {
    case 1: {
      event.key="pickpocket";event.title="扒手事件";
      const amount=draw(random,100000);
      if(draw(random,2)===1){
        const lost= -addMoney(-Math.min(character.money,amount));
        event.description=lost===0?"遇到扒手，但身上沒有現金可偷。":
          "遇到扒手，損失現金 "+lost+" 元。";
      }else{
        const received=addMoney(amount);
        event.description="抓到扒手，獲得謝禮 "+received+" 元。";
      }
      break;
    }
    case 2:{
      event.key="foundWallet";event.title="撿到錢包";
      const amount=addMoney(draw(random,10000));
      event.description="在路上撿到錢包，將裡面的 "+amount+" 元據為己有。";
      break;
    }
    case 5:{
      event.key="collectionFee";event.title="NHK 收費";
      const charged= -addMoney(-1000);
      event.description="NHK 收費員來訪，支付 "+charged+" 元。";
      break;
    }
    case 6:{
      event.key="heartbreakBinge";event.title="失戀暴食";
      const gained=addWeight(5);
      event.description="失戀後暴飲暴食，體重增加 "+gained+" 公斤。";
      break;
    }
    case 7:case 8:case 9:case 10:case 12:{
      const option=STAT_EVENTS[originalId];
      event.key=option.key;event.title=option.title;
      const positive=draw(random,2)===1;
      const change=changeStat(character.stats_json,option.stat,positive?3:-3);
      changes.stats_json=change.stats_json;
      effects.stats={[option.stat]:change.actualDelta};
      event.description=(positive?option.positive:option.negative)+"，"+
        option.label+(change.actualDelta>=0?"+":"")+change.actualDelta+"。";
      break;
    }
    case 13:{
      event.key="luckyDraw";event.title="幸運抽籤";
      const amount=addMoney(draw(random,15)*10000);
      event.description="幸運抽籤中獎，獲得 "+amount+" 元。";
      break;
    }
    case 14:{
      event.key="kindFeeling";event.title="溫柔心情";
      const change=changeStat(character.stats_json,"love",5);
      changes.stats_json=change.stats_json;
      effects.stats={love:change.actualDelta};
      event.description="突然充滿溫柔的感覺，LOVE +"+change.actualDelta+"。";
      break;
    }
    case 24:{
      event.key="lottery";event.title="樂透彩券";
      if(draw(random,10)===1) {
        const amount=addMoney(draw(random,10)*1000000);
        event.description="中了樂透彩券，獲得 "+amount+" 元。";
      }else{
        const lost= -addMoney(-3000);
        event.description="花費 "+lost+" 元購買樂透彩券，沒有中獎。";
      }
      break;
    }
    case 25:{
      event.key="osakaScolding";event.title="大阪阿姨說教";
      const loss= -addWeight(-1);
      event.description="被大阪阿姨說教後精神緊繃，體重減少 "+loss+" 公斤。";
      break;
    }
    case 26:{
      event.key="streetFight";event.title="街頭衝突";
      const outcome=draw(random,5);
      if(outcome===1){
        const loss=-subtractEnergy("body_energy",3);
        event.description="遭到街頭衝突波及，身體能量減少 "+loss+" 點。";
      }else if(outcome===2){
        const loss=-subtractEnergy("brain_energy",3);
        event.description="遭到街頭衝突波及，頭腦能量減少 "+loss+" 點。";
      }else if(outcome===3){
        const body=-subtractEnergy("body_energy",4);
        const brain=-subtractEnergy("brain_energy",4);
        event.description="遭到街頭衝突波及，身體與頭腦能量分別減少 "+body+"、"+brain+" 點。";
      }else{
        event.description="發現街頭衝突將要發生，及時離開而沒有受傷。";
      }
      break;
    }
    case 27:{
      event.key="hotspring";event.title="溫泉招待券";
      const gained=grantEnergy(1000);
      event.description="收到溫泉招待券，身體與頭腦能量分別恢復 "+gained.body+"、"+gained.brain+" 點。";
      break;
    }
    case 33:{
      event.key="localEncounter";event.title="地方偶遇";
      const outcome=draw(random,3);
      if(outcome===1){
        const change=changeStat(character.stats_json,"unique",3);
        changes.stats_json=change.stats_json;
        effects.stats={unique:change.actualDelta};
        event.description="遇見吉本藝人，有趣度增加 "+change.actualDelta+" 點。";
      }else if(outcome===2){
        const loss=-subtractEnergy("body_energy",3);
        event.description="在奈良被鹿踩到，身體能量減少 "+loss+" 點。";
      }else{
        const loss=-subtractEnergy("body_energy",2);
        const cost=-addMoney(-50000);
        event.description="在琵琶湖溺水，身體能量減少 "+loss+" 點，支付救援費 "+cost+" 元。";
      }
      break;
    }
    case 39:{
      event.key="workFocus";event.title="工作專注度";
      const fullEnergy=int(character.body_energy,"身體能量")>=500 &&
        int(character.brain_energy,"頭腦能量")>=500;
      const change=addJobExperience(fullEnergy?10:-5);
      event.description=fullEnergy?"工作特別專注，職業經驗增加 "+change+" 點。":
        "工作時精神不濟，職業經驗減少 "+(-change)+" 點。";
      break;
    }
    case 41:{
      event.key="vendingChange";event.title="自動販賣機找零";
      const amount=addMoney(1000);
      event.description="發現自動販賣機忘了拿的找零，撿到 "+amount+" 元。";
      break;
    }
    case 43:{
      event.key="heartbreakWeightLoss";event.title="失戀消瘦";
      const loss= -addWeight(-5);
      event.description="失戀後吃不下東西，體重減少 "+loss+" 公斤。";
      break;
    }
  }
  return {event,changes,effects};
}
