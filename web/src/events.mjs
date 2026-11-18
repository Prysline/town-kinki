// 原版 event.pl::event_happen：三分之一機率從 44 個事件中抽一個。
// 第十六階段加入 15 種不需額外道具的經濟、能力與體重事件。
// 原 CGI 在進入主畫面時抽取，Web 版改為每個遊戲日最多抽取一次。
import { resolveNonItemEvent } from "./event-effects.mjs";

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
    "CREATE INDEX IF NOT EXISTS character_events_user_idx ON character_events(user_id,id);"
  ].join("\n"));
  const columns=db.prepare("PRAGMA table_info(character_events)").all();
  if(!columns.some(c=>c.name==="description"))
    db.exec("ALTER TABLE character_events ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if(!columns.some(c=>c.name==="effects_json"))
    db.exec("ALTER TABLE character_events ADD COLUMN effects_json TEXT NOT NULL DEFAULT '{}'");
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
    const old=db.prepare(
      "SELECT health_index,last_event_day,money,weight,height,bmi,stats_json FROM characters WHERE user_id=?"
    ).get(userId);
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
    const effect=result.event?
      {event:result.event,changes:{health_index:result.event.healthIndex},
        effects:{healthIndex:{from:old.health_index,to:result.event.healthIndex}}}:
      (result.drawn ? resolveNonItemEvent(result.originalId,old,random):null);
    db.prepare("UPDATE characters SET last_event_day=? WHERE user_id=?")
      .run(day,userId);
    if(effect){
      const allowed=["health_index","money","weight","bmi","stats_json"];
      const fields=Object.entries(effect.changes);
      if(fields.some(([key])=>!allowed.includes(key)))throw new Error("無效的事件欄位");
      if(fields.length){
        db.prepare("UPDATE characters SET "+fields.map(([key])=>key+"=?").join(",")+
          " WHERE user_id=?").run(...fields.map(([,value])=>value),userId);
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
        row.event_key==="literature"?"國語事件":
        row.event_key==="mathematics"?"數學事件":
        row.event_key==="science"?"理科事件":
        row.event_key==="history"?"社會事件":
        row.event_key==="arts"?"美術事件":"未知事件"),
      description:row.description||event?.description||"",
      effects:JSON.parse(row.effects_json||"{}"),
      oldHealthIndex:row.old_health_index,newHealthIndex:row.new_health_index,
      occurredAt:row.created_at};
  });
}
