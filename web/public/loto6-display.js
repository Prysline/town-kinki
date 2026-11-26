// 開獎原因僅轉換玩家可見文字，不修改 API 或資料庫 reason。
export function displayLoto6DrawReason(reason){
  if(reason==="06:00")return "06:00時段";
  if(reason==="200 tickets")return "累計售出 200 注開獎";
  return "開獎原因未記錄";
}
