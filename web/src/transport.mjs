// station.cgi::idou L99–116 的原版四城車站票價。
// 原 CGI 在移動畫面以 JavaScript 倒數 5 秒，未在此加入虛構的伺服器冷卻。
const TRAIN_FARES=Object.freeze([
  Object.freeze([0,950,780,1210]),
  Object.freeze([950,0,950,2210]),
  Object.freeze([780,950,0,1530]),
  Object.freeze([1210,2210,1530,0])
]);

export function quoteTrainFare(fromTownId,toTownId) {
  if(!Number.isInteger(fromTownId)||!Number.isInteger(toTownId)||
      !TRAIN_FARES[fromTownId]||!Number.isSafeInteger(TRAIN_FARES[fromTownId][toTownId]))
    throw new Error("不存在的城鎮");
  if(fromTownId===toTownId)throw new Error("已在此城鎮，不需要搭車");
  return TRAIN_FARES[fromTownId][toTownId];
}

// 由伺服器認定玩家實際所在地，不能相信客戶端聲稱的出發城鎮。
export function travelByTrain(character,toTownId) {
  if(!character||!Number.isSafeInteger(character.townId))
    throw new Error("請先建立角色");
  const fare=quoteTrainFare(character.townId,toTownId);
  if(!Number.isSafeInteger(character.money)||character.money<0)
    throw new Error("角色現金數值不正確");
  if(character.money<fare)throw new Error("現金不足以支付車票");
  return {
    character:{...character,money:character.money-fare,townId:toTownId},
    fromTownId:character.townId,toTownId,fare
  };
}

export function trainDestinations(fromTownId) {
  if(!TRAIN_FARES[fromTownId])throw new Error("不存在的城鎮");
  return TRAIN_FARES[fromTownId].map((fare,toTownId)=>({
    townId:toTownId, fare:fromTownId===toTownId?0:fare
  }));
}
