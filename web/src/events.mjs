// 原版 event.pl::event_happen：三分之一機率從 44 個事件中抽一個。
// 本階段僅移植兩個會改變 byouki_sisuu 的事件（編號 4 與 15）。
// 原 CGI 在進入主畫面時抽取，Web 版改為每個遊戲日最多抽取一次。
export const ORIGINAL_EVENT_COUNT = 44;
export const ORIGINAL_EVENT_CHANCE = 3;
export const ILLNESS_EVENTS = Object.freeze({
  4: Object.freeze({
    key:"caughtCold",originalId:4,title:"突然感冒",
    description:"不小心感冒了。",healthIndex:-15
  }),
  15: Object.freeze({
    key:"sleptUncovered",originalId:15,title:"夜間著涼",
    description:"睡覺時沒有蓋好被子，身體不太舒服。",healthIndex:-8
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
      "SELECT health_index,last_event_day FROM characters WHERE user_id=?"
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
    db.prepare("UPDATE characters SET last_event_day=? WHERE user_id=?")
      .run(day,userId);
    if(result.event){
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=?")
        .run(result.event.healthIndex,userId);
      db.prepare(
        "INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at) VALUES(?,?,?,?,?,?,?)"
      ).run(userId,day,result.event.key,result.event.originalId,
        old.health_index,result.event.healthIndex,now);
    }
    db.exec("COMMIT");
    return {checked:true,initial:false,event:result.event,
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
    "SELECT id,day,event_key,original_id,old_health_index,new_health_index,created_at FROM character_events WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ).all(userId,capped).map(row=>{
    const event=ILLNESS_EVENTS[row.original_id];
    return {id:row.id,day:row.day,key:row.event_key,
      originalId:row.original_id,title:event?.title??"未知事件",
      description:event?.description??"",
      oldHealthIndex:row.old_health_index,newHealthIndex:row.new_health_index,
      occurredAt:row.created_at};
  });
}
