// 原版 coupon.cgi::coupon/coupon_do 使用 dat_dir/coupon.cgi 的 33 欄獎品資料。
// 這裡只安全解析「兌換選項」，不扣券、不產生物品，也不將獎品耐久誤當券有效期。
import { LEGACY_ITEM_FIELDS } from "./legacy-inventory.mjs";

const REWARD_PREFIX=/^クーポン交換品:([1-9][0-9]*)$/;
export function parseLegacyCouponCatalog(source) {
  if(typeof source!=="string")throw new Error("優惠券原始資料不是文字");
  const lines=source.split(/\r?\n/).filter(line=>line.trim()!=="");
  if(!lines.length||lines.length>1000)throw new Error("優惠券獎品清單數量異常");
  return Object.freeze(lines.map((line,index)=>{
    const fields=line.replace(/\r$/,"").split("<>");
    // 原始檔案以 <> 結尾，最後一個空字串不是第 34 欄。
    if(fields.length===34&&fields[33]==="")fields.pop();
    if(fields.length!==LEGACY_ITEM_FIELDS.length ||
       fields.some(value=>value.length>4096))
      throw new Error("原版優惠券獎品第 "+(index+1)+" 行欄位數或長度不正確");
    const match=fields[0].match(REWARD_PREFIX);
    if(!match||!fields[1].trim())
      throw new Error("原版優惠券獎品第 "+(index+1)+" 行缺少兌換點數或名稱");
    const requiredCoupons=Number(match[1]);
    const durability=Number(fields[21]);
    if(!Number.isSafeInteger(requiredCoupons)||requiredCoupons<1||
       !/^[0-9]+$/.test(fields[21])||
       !Number.isSafeInteger(durability)||durability<1||
       !["日","回"].includes(fields[22]))
      throw new Error("原版優惠券獎品第 "+(index+1)+" 行點數或獎品耐久不正確");
    return Object.freeze({
      sourceIndex:index,originalName:fields[1],requiredCoupons,
      rewardCategory:fields[0],rewardDurability:durability,
      rewardDurabilityUnit:fields[22],
      // 保留原始來源 33 欄及順序，以便下一個交易切片原樣交付獎品。
      rawFields:Object.freeze(fields)
    });
  }));
}

// 原版 coupon_do 同時驗證表單的序號與商品名，不相信前端提交的券價或獎品欄位。
export function requireLegacyCouponReward(catalog,sourceIndex,originalName) {
  if(!Array.isArray(catalog)||!Number.isSafeInteger(sourceIndex)||sourceIndex<0||
     typeof originalName!=="string")
    throw new Error("兌換獎品選擇格式不正確");
  const reward=catalog[sourceIndex];
  if(!reward||reward.sourceIndex!==sourceIndex||
     reward.originalName!==originalName)
    throw new Error("原始兌換序號與商品名稱不一致");
  return reward;
}
