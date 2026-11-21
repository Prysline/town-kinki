// 原版 coupon.cgi::coupon_do：依獎品行序＋名稱核對、扣「クーポン」點數、
// 完整 33 欄獎品入庫。Web 此階段只扣 character_coupons 的「事件所得」點數；
// 原始 mono.cgi 匯入券仍為唯讀封存，不合併或隱性扣除。
import {initLegacyInventoryTables} from "./legacy-inventory.mjs";
import {getCouponBalance} from "./events.mjs";
import {requireLegacyCouponReward} from "./coupon-catalog.mjs";
import {readTownMap} from "./town-storage.mjs";

export const COUPON_SHOP_SYMBOL="クーポン";
export const COUPON_ITEM_ORIGIN="__web_coupon__";
export const COUPON_INVENTORY_LIMIT=25;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const DAY_SECONDS=86400;
const PRIZE_START_LINE=6000000;

export function initCouponRedemptionTables(db){
  initLegacyInventoryTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS coupon_redemptions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "source_index INTEGER NOT NULL,original_name TEXT NOT NULL,",
    "coupon_cost INTEGER NOT NULL CHECK(coupon_cost>0),",
    "source_line INTEGER NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id),UNIQUE(user_id,source_line));",
    "CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx",
    "ON coupon_redemptions(user_id,id);"
  ].join(" "));
}
export function listCouponRewards(catalog,balance,available){
  return catalog.map(item=>({
    sourceIndex:item.sourceIndex,originalName:item.originalName,
    requiredCoupons:item.requiredCoupons,
    rewardDurability:item.rewardDurability,
    rewardDurabilityUnit:item.rewardDurabilityUnit,
    canRedeem:Boolean(available)&&balance>=item.requiredCoupons,
    reason:!available?"目前所在城鎮沒有優惠券兌換所":
      balance<item.requiredCoupons?"Web 事件優惠券點數不足":null
  }));
}
export function listCouponRedemptions(db,userId,limit=20){
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的兌換角色");
  const count=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,50)):20;
  return db.prepare([
    "SELECT source_index,original_name,coupon_cost,source_line,created_at",
    "FROM coupon_redemptions WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,count).map(row=>({
    sourceIndex:row.source_index,originalName:row.original_name,
    couponCost:row.coupon_cost,sourceLine:row.source_line,
    createdAt:row.created_at
  }));
}
function activeOrdinarySlots(db,userId,now){
  const rows=db.prepare([
    "SELECT i.category,i.durability,i.durability_unit,i.purchased_at,",
    "u.remaining FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u",
    "ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=?"
  ].join(" ")).all(userId);
  const seconds=Math.floor(now/1000);
  return rows.filter(row=>{
    if(row.category==="ギフト"||row.category==="ギフト商品")return false;
    if(row.durability<=0)return false;
    if(row.durability_unit==="回")return (row.remaining??row.durability)>0;
    if(row.durability_unit==="日"){
      if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)
        return true; // 不將不完整舊檔默認可覆蓋的空位
      return row.durability-Math.max(0,Math.floor((seconds-row.purchased_at)/DAY_SECONDS))>0;
    }
    return true; // 未識別耐久單位的舊商品保守視為佔用空間
  }).length;
}
export function redeemEventCoupon(db,userId,catalog,{
  sourceIndex,originalName,requestId,now
}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0)
    throw new Error("優惠券兌換請求格式不正確");
  const reward=requireLegacyCouponReward(catalog,sourceIndex,originalName);
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT source_index,original_name,coupon_cost,source_line",
      "FROM coupon_redemptions WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.source_index!==sourceIndex||previous.original_name!==originalName)
        throw new Error("相同兌換請求編號不可使用於其他獎品");
      db.exec("COMMIT");
      return {sourceIndex,originalName,couponCost:previous.coupon_cost,
        sourceLine:previous.source_line,replayed:true};
    }
    const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!readTownMap(db,character.town_id).tiles.includes(COUPON_SHOP_SYMBOL))
      throw new Error("目前所在城鎮沒有優惠券兌換所");
    if(getCouponBalance(db,userId)<reward.requiredCoupons)
      throw new Error("Web 事件優惠券點數不足；原版匯入券仍為唯讀封存");
    if(activeOrdinarySlots(db,userId,now)>=COUPON_INVENTORY_LIMIT)
      throw new Error("一般持有物已達 25 格限制");
    // 僅角色持有的 Web 事件券可花費；舊版匯入 mono.cgi 不讀寫、不累計。
    const changed=db.prepare([
      "UPDATE character_coupons SET quantity=quantity-?",
      "WHERE user_id=? AND quantity>=?"
    ].join(" ")).run(reward.requiredCoupons,userId,reward.requiredCoupons);
    if(changed.changes!==1)throw new Error("Web 事件優惠券點數不足");
    const max=db.prepare(
      "SELECT COALESCE(MAX(source_line),0) AS max_line FROM legacy_inventory_items WHERE user_id=?"
    ).get(userId).max_line;
    const sourceLine=Math.max(PRIZE_START_LINE,max+1);
    if(!Number.isSafeInteger(sourceLine)||sourceLine<=0)
      throw new Error("獎品來源行號已超出安全範圍");
    const seconds=Math.floor(now/1000);
    if(!Number.isSafeInteger(seconds)||seconds<=0)
      throw new Error("兌換時間超出支援範圍");
    const fields=[...reward.rawFields];
    // coupon.cgi::coupon_do 唯一主動覆寫的是獎品的購入日；原始獎品
    // 類別、效果、耐久、單位與其他 32 個欄位保持來源原樣。
    fields[30]=String(seconds);
    const lastUsed=fields[26]&&/^\d+$/.test(fields[26])?Number(fields[26]):0;
    if(!Number.isSafeInteger(lastUsed)||lastUsed<0)
      throw new Error("原版兌換獎品最後使用時間無效");
    db.prepare([
      "INSERT INTO legacy_inventory_items(",
      "user_id,original_id,source_line,category,original_name,effect,",
      "durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,COUPON_ITEM_ORIGIN,sourceLine,fields[0],fields[1],
      fields[9],reward.rewardDurability,reward.rewardDurabilityUnit,
      seconds,lastUsed,JSON.stringify(fields));
    db.prepare([
      "INSERT INTO coupon_redemptions(",
      "user_id,request_id,source_index,original_name,coupon_cost,source_line,created_at)",
      "VALUES(?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,sourceIndex,reward.originalName,
      reward.requiredCoupons,sourceLine,now);
    db.exec("COMMIT");
    return {sourceIndex,originalName:reward.originalName,
      couponCost:reward.requiredCoupons,sourceLine,replayed:false};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
