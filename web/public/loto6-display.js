// 開獎原因僅轉換玩家可見文字，不修改 API 或資料庫 reason。
export function displayLoto6DrawReason(reason){
  if(reason==="06:00")return "06:00時段";
  if(reason==="200 tickets")return "累計售出 200 注開獎";
  return "開獎原因未記錄";
}

// 通知用完整原因；最近開獎紀錄保留已確認的精簡用詞。
export function formatLoto6DrawNotice(result,formatMoney){
  if(!result.drawn)return "目前尚未到達六號樂透的 06:00 開獎時間，彩券也未累計售出 200 注。";
  const reason=result.reason==="06:00"?"每日 06:00 定時開獎":
    result.reason==="200 tickets"?"彩券已累計售出 200 注":displayLoto6DrawReason(result.reason);
  return "六號樂透已開獎（"+reason+"），中獎號碼 "+
    result.winningNumbers.join("、")+
    "。共結算 "+result.ticketCount+" 注，獎金合計 "+
    formatMoney(result.totalPrize)+" 匯入各玩家的普通銀行。";
}
