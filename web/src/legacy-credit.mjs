// kyushitu.cgi L69–83、L109–116：只有持有有效「クレジット」原版日用品，
// 才可選銀行付教室學費。此處不虛構購買功能，也不修改匯入的原始 33 欄。
import { DAY_MS } from "./inventory.mjs";

function eligibleCard(row, now) {
  if(row.effect!=="クレジット"||row.durability_unit!=="日"||
    !Number.isSafeInteger(row.durability)||row.durability<=0||
    !Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)return null;
  let fields;
  try{fields=JSON.parse(row.raw_fields_json);}catch{return null;}
  if(!Array.isArray(fields)||fields.length!==33||
    fields[0]!==row.category||fields[1]!==row.original_name||
    fields[9]!=="クレジット"||fields[22]!=="日"||
    fields[21]!==String(row.durability)||
    fields[30]!==String(row.purchased_at))return null;
  const purchasedAt=row.purchased_at*1000;
  const expiresAt=purchasedAt+row.durability*DAY_MS;
  if(!Number.isSafeInteger(purchasedAt)||!Number.isSafeInteger(expiresAt)||
    now<purchasedAt||now>=expiresAt)return null;
  return {sourceLine:row.source_line,name:row.original_name,expiresAt};
}

export function listValidClassroomCreditCards(db,userId,now=Date.now()){
  if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(now)||now<0)
    throw new Error("無效的信用付款查詢");
  // 只從真正匯入到本人帳號的原版物品挑卡；不可傳任何任意商品名作付款授權。
  const rows=db.prepare([
    "SELECT source_line,category,original_name,effect,durability,",
    "durability_unit,purchased_at,raw_fields_json",
    "FROM legacy_inventory_items",
    "WHERE user_id=? AND effect='クレジット'",
    "ORDER BY source_line LIMIT 100"
  ].join(" ")).all(userId);
  return rows.flatMap(row=>{
    const card=eligibleCard(row,now);
    return card?[card]:[];
  });
}

export function requireClassroomCreditCard(db,userId,sourceLine,now=Date.now()){
  if(!Number.isSafeInteger(sourceLine)||sourceLine<1)
    throw new Error("請選擇有效的本人信用卡");
  const card=listValidClassroomCreditCards(db,userId,now)
    .find(item=>item.sourceLine===sourceLine);
  if(!card)throw new Error("沒有有效且屬於本人的原版信用卡");
  return card;
}
