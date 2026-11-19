// 原版 event.pl::event_happen：三分之一機率從 44 個事件中抽一個。
// 第十六階段加入 15 種不需額外道具的經濟、能力與體重事件。
// 原 CGI 在進入主畫面時抽取，Web 版改為每個遊戲日最多抽取一次。
import { resolveNonItemEvent } from "./event-effects.mjs";
import { recordBankEntry } from "./banking.mjs";
import { EVENT_BONUS_ITEMS,EVENT_REQUIRED_SETS,findEventBonusItem,consumeEventBonusItem } from "./event-item-bonus.mjs";

export const ORIGINAL_EVENT_COUNT = 44;
export const ORIGINAL_EVENT_CHANCE = 3;
export const ILLNESS_EVENTS = Object.freeze({
  4: Object.freeze({
    key:"caughtCold",originalId:4,title:"感冒事件",
    description:"感冒了。",healthIndex:-15
  }),
  15: Object.freeze({
    key:"sleptUncovered",originalId:15,title:"睡覺後身體不適",
    description:"裸體睡覺，似乎因此身體不舒服了。",healthIndex:-8
  })
});

function drawInteger(random,count) {
  const value=random();
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>=1)
    throw new Error("事件亂數產生器回傳無效數值");
  return Math.floor(value*count)+1;
}
export function rollOriginalIllnessEvent(random=Math.random) {
  if (typeof random!=="function") throw new Error("事件亂數產生器不正確");
  // event.pl: $hassei_rand=int(rand(3))+1; $event_rand=int(rand(44))+1
  const happened=drawInteger(random,ORIGINAL_EVENT_CHANCE)===1;
  if(!happened) return {drawn:false,originalId:null,event:null};
  const originalId=drawInteger(random,ORIGINAL_EVENT_COUNT);
  const event=ILLNESS_EVENTS[originalId]??null;
  return {drawn:true,originalId,event};
}
export function initCharacterEvents(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS character_events(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "day TEXT NOT NULL,",
    "event_key TEXT NOT NULL,",
    "original_id INTEGER NOT NULL,",
    "old_health_index INTEGER NOT NULL,",
    "new_health_index INTEGER NOT NULL,",
    "created_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS character_events_user_idx ON character_events(user_id,id);",
    "CREATE TABLE IF NOT EXISTS character_coupons(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0));"
  ].join("\n"));
  const columns=db.prepare("PRAGMA table_info(character_events)").all();
  if(!columns.some(c=>c.name==="description"))
    db.exec("ALTER TABLE character_events ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if(!columns.some(c=>c.name==="effects_json"))
    db.exec("ALTER TABLE character_events ADD COLUMN effects_json TEXT NOT NULL DEFAULT '{}'");
}
// Web 版事件累加紀錄；不覆寫從原版 mono.cgi 匯入的 33 欄唯讀封存。
export function getCouponBalance(db,userId) {
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的角色帳號");
  const quantity=db.prepare("SELECT quantity FROM character_coupons WHERE user_id=?")
    .get(userId)?.quantity??0;
  if(!Number.isSafeInteger(quantity)||quantity<0)
    throw new Error("優惠券餘額資料不正確");
  return quantity;
}
function creditEventCoupons(db,userId,quantity){
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>5)
    throw new Error("事件優惠券數量不正確");
  const newBalance=getCouponBalance(db,userId)+quantity;
  if(!Number.isSafeInteger(newBalance))
    throw new Error("事件優惠券餘額超出安全整數範圍");
  db.prepare([
    "INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)",
    "ON CONFLICT(user_id) DO UPDATE SET quantity=excluded.quantity"
  ].join(" ")).run(userId,newBalance);
}

function validDay(day) {
  return typeof day==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(day);
}
export function settleDailyIllnessEvent(db,userId,day,now=Date.now(),random=Math.random) {
  if(!Number.isSafeInteger(userId)||userId<1) throw new Error("無效的角色帳號");
  if(!validDay(day)||!Number.isSafeInteger(now)||now<0)
    throw new Error("無效的事件日期或時間");
  db.exec("BEGIN IMMEDIATE");
  try {
    const old=db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId);
    if(!old) throw new Error("請先建立角色");
    if(old.last_event_day>=day) {
      db.exec("COMMIT");
      return {checked:false,initial:false,event:null};
    }
    // 舊存檔沒有事件檢查歷史，不將當日新功能啟用視為舊版漏抽事件。
    if(!old.last_event_day){
      db.prepare("UPDATE characters SET last_event_day=? WHERE user_id=?")
        .run(day,userId);
      db.exec("COMMIT");
      return {checked:false,initial:true,event:null};
    }
    const result=rollOriginalIllnessEvent(random);
    const bonusItemName=EVENT_BONUS_ITEMS[result.originalId];
    const eventCanUseDayItem=[16,23].includes(result.originalId);
    const bonusItem=bonusItemName?findEventBonusItem(db,userId,bonusItemName,
      {allowDay:eventCanUseDayItem,now}):null;
    const requiredNames=EVENT_REQUIRED_SETS[result.originalId];
    const requiredItems=requiredNames?.map(name=>findEventBonusItem(db,userId,name))??null;
    const completeSet=requiredItems?.every(Boolean)?requiredItems:null;
    const effect=result.event?
      {event:result.event,changes:{health_index:result.event.healthIndex},
        effects:{healthIndex:{from:old.health_index,to:result.event.healthIndex}}}:
      (result.drawn ? resolveNonItemEvent(result.originalId,old,random,
        requiredNames?(completeSet?.map(item=>item.name)??null):(bonusItem?.name??null)):null);
    // 基礎事件先計算，再於同一筆交易內扣除確實觸發加成的原版物品耐久。
    if(effect?.usedItemName){
      if(!bonusItem||bonusItem.name!==effect.usedItemName)
        throw new Error("原版事件道具加成與持有資料不一致");
      effect.effects.item=consumeEventBonusItem(db,userId,bonusItem);
    }
    if(effect?.extraItemUseName){
      // 第 16 號原作會先消耗一次攝影機，再試著額外消耗一件；可能用盡或轉用下一件。
      const extra=findEventBonusItem(db,userId,effect.extraItemUseName,{allowDay:true,now});
      if(extra)effect.effects.extraItem=consumeEventBonusItem(db,userId,extra);
    }
    if(effect?.usedItemNames){
      if(!completeSet||effect.usedItemNames.length!==completeSet.length||
          effect.usedItemNames.some((name,i)=>name!==completeSet[i].name))
        throw new Error("事件收藏套組與原始物品資料不一致");
      effect.effects.items=completeSet.map(item=>consumeEventBonusItem(db,userId,item));
    }
    // 原版 coupon_get 將新券數加到既有數量；與抽選日、事件歷史一併提交。
    if(effect?.couponAward!=null)
      creditEventCoupons(db,userId,effect.couponAward);
    db.prepare("UPDATE characters SET last_event_day=? WHERE user_id=?")
      .run(day,userId);
    if(effect){
      const allowed=["health_index","money","bank","town_id","weight","bmi","stats_json",
        "body_energy","brain_energy","job_experience","recovered_at"];
      // 身體／頭腦能量變動以當下重新起算每十秒的恢復計時。
      if(effect.changes.body_energy!==undefined ||
         effect.changes.brain_energy!==undefined)
        effect.changes.recovered_at=now;
      const fields=Object.entries(effect.changes);
      if(fields.some(([key])=>!allowed.includes(key)))throw new Error("無效的事件欄位");
      if(fields.length){
        db.prepare("UPDATE characters SET "+fields.map(([key])=>key+"=?").join(",")+
          " WHERE user_id=?").run(...fields.map(([,value])=>value),userId);
      }
      if(effect.changes.bank!==undefined){
        const loss=old.bank-effect.changes.bank;
        if(!Number.isSafeInteger(loss)||loss<0)throw new Error("事件銀行扣款不正確");
        if(loss>0)recordBankEntry(db,userId,"ordinary","空屋竊盜",loss,0,effect.changes.bank,now);
      }
      db.prepare(
        "INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at,description,effects_json) VALUES(?,?,?,?,?,?,?,?,?)"
      ).run(userId,day,effect.event.key,result.originalId,
        old.health_index,effect.changes.health_index??old.health_index,now,
        effect.event.description,JSON.stringify(effect.effects));
    }
    db.exec("COMMIT");
    return {checked:true,initial:false,event:effect?.event??null,
      originalId:result.originalId};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
export function listCharacterEvents(db,userId,limit=15) {
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的角色帳號");
  const capped=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,50)):15;
  return db.prepare(
    "SELECT id,day,event_key,original_id,old_health_index,new_health_index,created_at,description,effects_json FROM character_events WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ).all(userId,capped).map(row=>{
    const event=ILLNESS_EVENTS[row.original_id];
    return {id:row.id,day:row.day,key:row.event_key,
      originalId:row.original_id,title:event?.title??(
        row.event_key==="foundWallet"?"撿到錢包":
        row.event_key==="luckyDraw"?"幸運抽籤":
        row.event_key==="lottery"?"樂透彩券":
        row.event_key==="pickpocket"?"扒手事件":
        row.event_key==="collectionFee"?"NHK 收費":
        row.event_key==="heartbreakBinge"?"失戀暴食":
        row.event_key==="osakaScolding"?"大阪阿姨說教":
        row.event_key==="vendingChange"?"自動販賣機找零":
        row.event_key==="heartbreakWeightLoss"?"失戀消瘦":
        row.event_key==="kindFeeling"?"溫柔心情":
        row.event_key==="bankBurglary"?"銀行存款竊盜":
        row.event_key==="ufoMembership"?"會員卡抽獎或 UFO 綁架":
        row.event_key==="earthquakeInsurance"?"地震與資產運用":
        row.event_key==="gremlin"?"小妖精惡作劇":
        row.event_key==="collectionQuest"?"收藏品檢查":
        row.event_key==="tigersSupport"?"阪神虎隊應援":
        row.event_key==="couponGift"?"獲得優惠券":
        row.event_key==="bookRoyalty"?"書籍版稅":
        row.event_key==="hulaHoopLuck"?"呼拉圈幸運事件":
        row.event_key==="trafficAccident"?"交通意外":
        row.event_key==="perfumeLuck"?"香水幸運事件":
        row.event_key==="romanceBoost"?"愛情與魅力事件":
        row.event_key==="luckyStarSand"?"幸運星砂":
        row.event_key==="englishLesson"?"英語事件":
        row.event_key==="musicLesson"?"音樂事件":
        row.event_key==="literature"?"國語事件":
        row.event_key==="mathematics"?"數學事件":
        row.event_key==="science"?"理科事件":
        row.event_key==="history"?"社會事件":
        row.event_key==="arts"?"美術事件":
        row.event_key==="streetFight"?"街頭衝突":
        row.event_key==="hotspring"?"溫泉招待券":
        row.event_key==="localEncounter"?"地方偶遇":
        row.event_key==="workFocus"?"工作專注度":"未知事件"),
      description:row.description||event?.description||"",
      effects:JSON.parse(row.effects_json||"{}"),
      oldHealthIndex:row.old_health_index,newHealthIndex:row.new_health_index,
      occurredAt:row.created_at};
  });
}
