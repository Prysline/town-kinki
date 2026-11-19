// 從原版 event.pl::event_happen 移植不需完整商店的事件分支。
import { TOWNS, maxBodyEnergy, maxBrainEnergy } from "./engine.mjs";
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
  1,2,3,5,6,7,8,9,10,11,12,13,14,16,17,18,19,20,21,22,23,24,25,26,27,29,30,31,32,33,39,41,42,43,44
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
export function resolveNonItemEvent(originalId,character,random=Math.random,bonusItem=null) {
  if(!Number.isSafeInteger(originalId)||!NON_ITEM_EVENT_IDS.includes(originalId))
    return null;
  if(typeof random!=="function")throw new Error("事件亂數產生器不正確");
  const event={originalId, key:"",title:"",description:""};
  const changes={};
  let effects={};
  let usedItemName=null;
  let usedItemNames=null;
  let extraItemUseName=null;
  let couponAward=null;
  let cockroachChallenge=false;
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
    case 3:{
      event.key="englishLesson";event.title="英語事件";
      const positive=draw(random,2)===1;
      const bonus=positive&&bonusItem==="英文解釈教室"?5:0;
      const updated=changeStat(character.stats_json,"eigo",(positive?3:-3)+bonus);
      changes.stats_json=updated.stats_json;
      effects.stats={eigo:updated.actualDelta};
      event.description=positive?"遇見傳教士，對方親切地教導英語，英語能力增加 3 點。":
        "被英語老師放棄指導，英語能力減少 3 點。";
      if(bonus){
        usedItemName="英文解釈教室";
        event.description+=" 因持有《英文解釈教室》，再增加 5 點。";
      }
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
    case 11:{
      event.key="musicLesson";event.title="音樂事件";
      const positive=draw(random,2)===1;
      // 原版敘述寫「音樂5アップ」，但實際 Perl 程式碼是 $ongaku += 3。
      const bonus=bonusItem==="成り上がり"?3:0;
      const updated=changeStat(character.stats_json,"ongaku",(positive?3:-3)+bonus);
      changes.stats_json=updated.stats_json;
      effects.stats={ongaku:updated.actualDelta};
      event.description=positive?"練習鋼琴，音樂能力增加 3 點。":
        "聚會過度喧鬧，嗓子沙啞，音樂能力減少 3 點。";
      if(bonus){
        usedItemName="成り上がり";
        event.description+=" 閱讀《成り上がり》後，音樂能力再增加 3 點。";
      }
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
    case 16:{
      event.key="bankBurglary";event.title="銀行存款竊盜";
      const bank=int(character.bank,"銀行存款");
      // 原版先檢查防犯カメラ並扣一次耐久，再檢查銀行是否有錢。
      if(bonusItem==="防犯カメラ")usedItemName=bonusItem;
      if(bank<=0){
        event.description="竊賊入屋，但普通銀行帳戶沒有存款，因此空手離開。";
      }else if(usedItemName){
        if(draw(random,5)===1){
          extraItemUseName=bonusItem; // 原版 camera 被破壞時第二次呼叫 motimono_kensa_ev2。
          const stolen=Math.floor(bank/5);
          changes.bank=bank-stolen;
          effects.bank=-stolen;
          event.description="竊賊破壞監視攝影機，普通銀行存款遭竊 "+stolen+" 元。";
        }else{
          const reward=addMoney(100000);
          event.description="監視攝影機協助抓到竊賊，獲得謝禮 "+reward+" 元。";
        }
      }else if(draw(random,2)===1){
        event.description="竊賊入屋，但被鄰居抓住，沒有損失存款。";
      }else{
        const stolen=Math.floor(bank/5);
        changes.bank=bank-stolen;
        effects.bank=-stolen;
        event.description="竊賊偷走存摺，普通銀行存款遭竊 "+stolen+" 元。";
      }
      break;
    }
    case 17:{
      event.key="bookRoyalty";event.title="書籍版稅";
      // 原版無論道具是否存在，皆先抽二分之一的普通結果。
      const choice=draw(random,2);
      if(bonusItem==="おばあちゃんの知恵袋"){
        const amount=addMoney(3000);
        usedItemName=bonusItem;
        event.description="持有《おばあちゃんの知恵袋》，收到出版版稅 "+amount+" 元。";
      }else{
        const amount=addMoney(choice===1?1000:500);
        event.description="收到出版版稅 "+amount+" 元。";
      }
      break;
    }
    case 18:{
      event.key="hulaHoopLuck";event.title="呼拉圈幸運事件";
      const choice=draw(random,2);
      if(bonusItem==="フラフープ"){
        const amount=addMoney(77777);
        usedItemName=bonusItem;
        event.description="《フラフープ》帶來幸運，在家門前撿到 "+amount+" 元。";
      }else if(choice===1){
        const amount=addMoney(5000);
        event.description="在家門前撿到 "+amount+" 元。";
      }else{
        const lost=-addMoney(-500);
        event.description="過去私吞錢包的事被發現，賠償 "+lost+" 元。";
      }
      break;
    }
    case 19:{
      event.key="trafficAccident";event.title="交通意外";
      if(bonusItem==="谷保天満宮のお守り"){
        const amount=addMoney(30000);
        usedItemName=bonusItem;
        event.description="《谷保天満宮のお守り》避開車禍，獲得賠償 "+amount+" 元。";
      }else{
        const stats=JSON.parse(character.stats_json);
        if(int(stats?.speed,"速度")<=180){
          const cost=-addMoney(-30000);
          event.description="被汽車撞傷，支付醫療費 "+cost+" 元。";
        }else{
          event.description="靠敏捷的步伐避開了汽車，沒有受傷。";
        }
      }
      break;
    }
    case 20:{
      event.key="perfumeLuck";event.title="香水幸運事件";
      const choice=draw(random,2);
      if(bonusItem==="幸せを呼ぶ香水"){
        const amount=addMoney(int(character.money,"現金"));
        usedItemName=bonusItem;
        event.description="《幸せを呼ぶ香水》讓現金翻倍，增加 "+amount+" 元。";
      }else if(choice===1){
        // event.pl 顯示「１万円」，實際執行是 $money=$money+100000。
        const amount=addMoney(100000);
        event.description="在家門前撿到 "+amount+" 元。";
      }else{
        const lost=-addMoney(-10000);
        event.description="打柏青哥，輸掉 "+lost+" 元。";
      }
      break;
    }
    case 21:{
      event.key="romanceBoost";event.title="愛情與魅力事件";
      const choice=draw(random,2);
      if(bonusItem==="バイアグラ"){
        const love=changeStat(character.stats_json,"love",3);
        const intimacy=changeStat(love.stats_json,"etti",3);
        changes.stats_json=intimacy.stats_json;
        effects.stats={love:love.actualDelta,etti:intimacy.actualDelta};
        usedItemName=bonusItem;
        event.description="使用《バイアグラ》，LOVE 與親密能力各增加 3 點。";
      }else{
        const delta=choice===1?3:-3;
        const updated=changeStat(character.stats_json,"etti",delta);
        changes.stats_json=updated.stats_json;
        effects.stats={etti:updated.actualDelta};
        event.description=choice===1?"朋友送來滋補品，親密能力增加 "+updated.actualDelta+" 點。":
          "身體不適，親密能力減少 "+(-updated.actualDelta)+" 點。";
      }
      break;
    }
    case 22:{
      event.key="earthquakeInsurance";event.title="地震與資產運用";
      if(bonusItem==="損害保険"){
        usedItemName=bonusItem;
        event.description="遭遇地震，但《損害保険》全額保障了持有的現金。";
      }else if(draw(random,2)===1){
        const money=int(character.money,"現金");
        const remaining=Math.floor(money/3);
        const loss=-addMoney(remaining-money);
        event.description="遭遇地震，現金剩下原有的三分之一，實際損失 "+loss+" 元。";
      }else{
        const earned=addMoney(int(character.money,"現金"));
        event.description="資產運用成功，現金翻倍，增加 "+earned+" 元。";
      }
      break;
    }
    case 23:{
      event.key="ufoMembership";event.title="會員卡抽獎或 UFO 綁架";
      // 原作無論是否持有會員卡，均先抽 int(rand(4))+1。
      const prize=draw(random,4);
      if(bonusItem==="ブラタンメンバーズカード"){
        usedItemName=bonusItem;
        const amount=[10000,100000,500000,1000000][prize-1];
        const earned=addMoney(amount);
        event.description="會員卡特典抽獎，獲得現金 "+earned+" 元。";
      }else{
        // 原作 int(rand(3)) 只會送到 0、1、2 號城鎮，不含第 3 號。
        const from=int(character.town_id,"城鎮");
        if(!TOWNS.some(t=>t.id===from))throw new Error("角色城鎮資料不正確");
        const to=draw(random,3)-1;
        changes.town_id=to;
        effects.townId={from,to};
        event.description="被 UFO 綁架，送到"+TOWNS.find(t=>t.id===to).name+"。";
      }
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
    case 29:{
      event.key="luckyStarSand";event.title="幸運星砂";
      if(bonusItem==="幸せの星砂"){
        const amount=addMoney(int(character.money,"現金"));
        usedItemName=bonusItem;
        event.description="《幸せの星砂》讓現金翻倍，增加 "+amount+" 元。";
      }else{
        const amount=addMoney(10000);
        event.description="在家門前撿到 "+amount+" 元。";
      }
      break;
    }
    case 30:{
      // event.pl::event_happen：int(rand(5))+1 後呼叫 coupon_get 累加持有張數。
      event.key="couponGift";event.title="獲得優惠券";
      couponAward=draw(random,5);
      effects.coupons=couponAward;
      event.description="獲得優惠券 "+couponAward+" 張，已加入 Web 版優惠券餘額。";
      break;
    }
    case 31:{
      event.key="gremlin";event.title="小妖精惡作劇";
      if(bonusItem==="ミグ25"){
        usedItemName=bonusItem;
        event.description="小妖精對《ミグ25》惡作劇，使道具耐久減少 1 次。";
      }else{
        const earned=addMoney(100);
        event.description="在自動販賣機發現 "+earned+" 元。";
      }
      break;
    }
    case 32:{
      event.key="collectionQuest";event.title="收藏品檢查";
      const names=["小さな花束(ラン)","ルパン三世","ファイナルクエスト"];
      // 原版 motimono_kensa_ev2 要求三種全部持有，不是任意一件。
      if(Array.isArray(bonusItem)&&names.every(n=>bonusItem.includes(n))){
        const earned=addMoney(100000);
        usedItemNames=names;
        event.description="收集了三件指定物品，獲得 "+earned+" 元。";
      }else{
        // 原版文字為「撿到 5000 円」，真正執行 $money += 500000。
        const earned=addMoney(500000);
        event.description="沒有集齊指定物品，在路上撿到 "+earned+" 元。";
      }
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
    case 42:{
      event.key="tigersSupport";event.title="阪神虎隊應援";
      const choice=draw(random,2);
      if(bonusItem==="阪神タイガースの公式チケット"){
        usedItemName=bonusItem;
        if(choice===1){
          const delta=adjustEnergy("body_energy",-10000);
          event.description="持票應援時與球迷發生衝突，身體能量減少 "+(-delta)+" 點。";
        }else{
          // Web 依其他事件慣例保護角色目前頭腦能量上限。
          const stats=JSON.parse(character.stats_json);
          const delta=adjustEnergy("brain_energy",100000,maxBrainEnergy(stats));
          event.description="持票應援取得大勝，頭腦能量恢復 "+delta+" 點。";
        }
      }else if(choice===1){
        const boosted=["tairyoku","kenkou","speed","power","wanryoku","kyakuryoku"];
        let current=character.stats_json;
        effects.stats={};
        for(const key of boosted){
          const update=changeStat(current,key,10);
          current=update.stats_json;
          effects.stats[key]=update.actualDelta;
        }
        changes.stats_json=current;
        const delta=adjustEnergy("body_energy",-5000);
        event.description="接受球員特訓，六項體能能力各提升 10 點，身體能量減少 "+(-delta)+" 點。";
      }else{
        const money=int(character.money,"現金");
        const loss=-addMoney(Math.floor(money/2)-money);
        event.description="跌倒時把一半現金掉進河裡，損失 "+loss+" 元。";
      }
      break;
    }
    case 43:{
      event.key="heartbreakWeightLoss";event.title="失戀消瘦";
      const loss= -addWeight(-5);
      event.description="失戀後吃不下東西，體重減少 "+loss+" 公斤。";
      break;
    }
    case 44:{
      // 原版隨機事件本身只建立 20 秒蟑螂挑戰，命中期限後才擲獎金。
      event.key="cockroach";event.title="蟑螂挑戰";
      event.description="蟑螂出現！請在 20 秒內按下拍打按鈕，逾時無獎勵。";
      cockroachChallenge=true;
      effects.cockroach="pending";
      break;
    }
  }
  return {event,changes,effects,usedItemName,usedItemNames,extraItemUseName,couponAward,cockroachChallenge};
}
