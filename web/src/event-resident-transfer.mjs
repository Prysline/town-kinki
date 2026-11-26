// event.pl::kifu/kifu2/kifu3；呼叫者已持有事件 BEGIN IMMEDIATE。
// 使用者核准：足額才轉帳，不足不耗笛、不變K、不重抽；自抽仍耗笛。
import {settleBankInterestInTransaction,recordBankEntry,refreshBankTaxSnapshot} from "./banking.mjs";
function draw(random,count){
  const r=random();
  if(typeof r!=="number"||!Number.isFinite(r)||r<0||r>=1)throw Error("事件居民亂數無效");
  return Math.floor(r*count);
}
function amount(value){
  if(!Number.isSafeInteger(value)||value<0)throw Error("事件資產超出安全範圍");
  return value;
}
export function settleResidentEventTransfer(db,userId,old,transfer,mode,day,now,random,event){
  const {kind,amount:requested}=transfer;
  if(!["gift","take"].includes(kind)||!Number.isSafeInteger(requested)||requested<1||requested>100000)throw Error("事件轉帳參數無效");
  // Web 模式由伺服器提供；單機只含自己。多人所有有效居民含本人及末列。
  const residents=mode==="solo"?[{user_id:userId}]:
    db.prepare("SELECT c.user_id FROM characters c JOIN users u ON u.id=c.user_id ORDER BY c.user_id").all();
  if(!residents.some(r=>r.user_id===userId))throw Error("事件居民名單缺少本人");
  const targetId=residents[draw(random,residents.length)].user_id;
  if(targetId===userId){
    event.description+="抽到自己，沒有金錢或 K 點變動。";
    return {status:"self",kind,requested,amount:0,kpoint:0};
  }
  // 先結算雙方既有當日銀行義務，避免先刷新稅基而跳過週稅。
  // SAVEPOINT 在不足額時連同暫時結算回復，不將取消交易變成另一玩家的資產異動。
  db.exec("SAVEPOINT resident_event_transfer");
  settleBankInterestInTransaction(db,userId,day,now);
  settleBankInterestInTransaction(db,targetId,day,now);
  const actor=db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId);
  const target=db.prepare("SELECT * FROM characters WHERE user_id=?").get(targetId);
  if(!actor||!target)throw Error("事件居民不存在");
  const cash=amount(actor.money),bank=amount(target.bank);
  if((kind==="gift"?cash:bank)<requested){
    db.exec("ROLLBACK TO resident_event_transfer");
    db.exec("RELEASE resident_event_transfer");
    event.description+="資金不足，取消轉帳，沒有金錢或 K 點變動"+(event.originalId===28?"。":"，不消耗笛子耐久。");
    return {status:"insufficient",kind,requested,amount:0,kpoint:0};
  }
  const cashDelta=kind==="gift"?-requested:requested;
  const bankDelta=-cashDelta,kDelta=kind==="gift"?3:-3;
  const nextCash=amount(cash+cashDelta),nextBank=amount(bank+bankDelta);
  const nextK=actor.kpoint+kDelta;
  if(!Number.isSafeInteger(actor.kpoint)||!Number.isSafeInteger(nextK))throw Error("事件 K 點超出安全範圍");
  db.prepare("UPDATE characters SET money=?,kpoint=? WHERE user_id=?").run(nextCash,nextK,userId);
  db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(nextBank,targetId);
  recordBankEntry(db,targetId,"ordinary",kind==="take"?"惡魔之笛強奪":"收到"+event.title,Math.max(0,-bankDelta),Math.max(0,bankDelta),nextBank,now);
  refreshBankTaxSnapshot(db,userId,day);
  refreshBankTaxSnapshot(db,targetId,day);
  const description=kind==="take"?"被其他居民的惡魔之笛強奪普通存款 "+requested+" 元。":"收到其他居民的"+event.title+" "+requested+" 元，存入普通帳戶。";
  // 對方的事件歷史不改變對方每日抽選標記，也不暴露其餘資產。
  db.prepare("INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at,description,effects_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(targetId,day,event.key,event.originalId,target.health_index,target.health_index,now,description,JSON.stringify({bank:bankDelta,transfer:{status:"received",kind,amount:requested}}));
  db.exec("RELEASE resident_event_transfer");
  event.description+=(kind==="take"?"強奪其他居民普通存款 ":"贈送其他居民 ")+requested+" 元，K 點 "+(kDelta>0?"+":"")+kDelta+"。";
  return {status:"transferred",kind,requested,amount:requested,kpoint:kDelta,money:cashDelta};
}
