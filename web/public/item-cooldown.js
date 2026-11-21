// 倒數僅用伺服器回傳的遊戲時間 readyAt，時間標籤每秒重新計算。
// 這不是解鎖判斷：真正的可使用狀態由後端重新核對。
export function itemCooldownRemaining(action,gameNow){
  const readyAt=action?.readyAt;
  if(action?.canUse||!Number.isFinite(gameNow)||
     !Number.isSafeInteger(readyAt)||readyAt<=gameNow)return 0;
  return readyAt-gameNow;
}
export function formatItemCountdown(milliseconds){
  const seconds=Math.ceil(Math.max(0,milliseconds)/1000);
  const day=Math.floor(seconds/86400);
  const hour=Math.floor((seconds%86400)/3600);
  const minute=Math.floor((seconds%3600)/60);
  const second=seconds%60;
  const pad=n=>String(n).padStart(2,"0");
  return (day?day+" 天 ":"")+(day||hour?pad(hour)+":":"")+
    pad(minute)+":"+pad(second);
}
export function itemCooldownText(action,gameNow){
  const remaining=itemCooldownRemaining(action,gameNow);
  if(remaining<=0)return "";
  const prefix=action.reason==="尚未到原版商品購入時間"?
    "距離購入時間 ":"冷卻剩餘 ";
  return prefix+formatItemCountdown(remaining);
}

/* 原版以購入日計算「日」耐久的剩餘天數；沒有效日期的資料不推定。 */
export function itemRemainingDurability(item,action,gameNow){
  if(Number.isSafeInteger(action?.remaining))return action.remaining;
  if(Number.isSafeInteger(item?.remaining)&&item.remaining>=0)return item.remaining;
  if(item?.unit==="日"&&Number.isSafeInteger(item.purchasedAt)&&item.purchasedAt>0&&
     Number.isSafeInteger(item.durability)&&Number.isFinite(gameNow)){
    const elapsed=Math.max(0,Math.floor((Math.floor(gameNow/1000)-item.purchasedAt)/86400));
    return Math.max(0,item.durability-elapsed);
  }
  return item?.durability??0;
}
