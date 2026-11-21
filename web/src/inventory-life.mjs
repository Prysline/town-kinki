// 原版 basic.cgi::item：耗盡「回」制物品在最後使用間隔結束後清離持有欄；
// 「日」制物品在購入日起算的有效天數歸零後不再屬於持有物。
// 保留資料庫原始 33 欄及使用／交易歷史，僅決定目前是否列入「持有」。
// 無法確認購買或間隔時間的異常匯入資料，不擅自當作已過期刪除。
const DAY_MS=86400000;
const MINUTE_MS=60000;
function safeNonnegative(n){return Number.isSafeInteger(n)&&n>=0;}
export function inventoryLife(row,now=Date.now()){
  const original=row?.durability;
  const unit=row?.durability_unit;
  const used=row?.web_remaining??row?.used_remaining??row?.remaining;
  const remaining=safeNonnegative(used)?used:original;
  const result={remaining:safeNonnegative(remaining)?remaining:0,visible:true,removeAt:null};
  if(!Number.isSafeInteger(now)||now<0||!safeNonnegative(original))return result;
  if(unit==="日"){
    const purchased=row.purchased_at;
    if(!Number.isSafeInteger(purchased)||purchased<=0)return result;
    const removeAt=purchased*1000+original*DAY_MS;
    if(!Number.isSafeInteger(removeAt))return result;
    const elapsed=Math.max(0,Math.floor((Math.floor(now/1000)-purchased)/86400));
    return {remaining:Math.max(0,original-elapsed),visible:now<removeAt,removeAt};
  }
  if(unit!=="回"||result.remaining>0)return result;
  let raw;
  try{raw=JSON.parse(row.raw_fields_json);}catch{return result;}
  if(!Array.isArray(raw)||raw.length!==33||
     raw[0]!==row.category||raw[1]!==row.original_name||
     raw[22]!=="回"||!/^(0|[1-9][0-9]*)$/.test(raw[23]??""))
    return result;
  const interval=Number(raw[23]);
  const lastUsed=row.last_used_at_ms??row.web_last_used_at??
    (safeNonnegative(row.last_used_at)?row.last_used_at*1000:0);
  const removeAt=lastUsed+interval*MINUTE_MS+1;
  if(!safeNonnegative(lastUsed)||!Number.isSafeInteger(removeAt))return result;
  return {remaining:0,visible:now<removeAt,removeAt};
}

// 只讀視圖：背包格數與物品顯示使用相同判斷；不改寫匯入來源與歷史。
export function heldInventoryRows(db,userId,now=Date.now()){
  const table=db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_inventory_items'"
  ).get();
  if(!table)return [];
  const usage=db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_item_usage'"
  ).get();
  const rows=usage?db.prepare([
    "SELECT i.*,u.remaining AS web_remaining,u.last_used_at_ms",
    "FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u",
    "ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? ORDER BY i.source_line"
  ].join(" ")).all(userId):db.prepare(
    "SELECT * FROM legacy_inventory_items WHERE user_id=? ORDER BY source_line"
  ).all(userId);
  return rows.filter(row=>inventoryLife(row,now).visible);
}
