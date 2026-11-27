import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyCouponCatalog, requireLegacyCouponReward } from "../src/coupon-catalog.mjs";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/coupon.cgi",import.meta.url)));
const legacy=decodeLegacyText(readFileSync(new URL("../../coupon.cgi",import.meta.url)));

test("原版 coupon.cgi 有憑序號與名稱核對、依券點數扣耐久及新增獎品",()=>{
  assert.match(legacy,/sub coupon_do\s*\{/);
  assert.match(legacy,/\$in\{'koniyubangou'\}/);
  assert.match(legacy,/\$in\{'syouhin'\} ne \$syo_hinmoku/);
  assert.match(legacy,/\$syo_taikyuu\s*-=\s*\$tensuu/);
  assert.match(legacy,/push \(@new_myitem_hairetu,\$syo_temp\)/);
});

test("解析此 fork 的全部 30 筆原始兌換獎品，完整保留 33 欄和行序",()=>{
  const rewards=parseLegacyCouponCatalog(source);
  assert.equal(rewards.length,30);
  assert.deepEqual(rewards.map(x=>x.sourceIndex),Array.from({length:30},(_,i)=>i));
  assert.equal(rewards[0].originalName,"福引券");
  assert.equal(rewards[0].requiredCoupons,1);
  assert.equal(rewards[0].rewardDurabilityUnit,"日");
  assert.equal(rewards[1].originalName,"４次元福袋");
  assert.equal(rewards[1].requiredCoupons,150);
  assert.equal(rewards[29].originalName,"メダル H");
  assert.equal(rewards[29].requiredCoupons,5);
  for(const reward of rewards){
    assert.equal(reward.rawFields.length,33);
    assert.equal(reward.rawFields[0],reward.rewardCategory);
    assert.equal(reward.rawFields[1],reward.originalName);
    assert.ok(Object.isFrozen(reward.rawFields));
    assert.ok(Object.isFrozen(reward));
  }
  assert.ok(Object.isFrozen(rewards));
});

test("來源序號和商品名稱須同時正確，不能偽造券價或以外來商品兌換",()=>{
  const rewards=parseLegacyCouponCatalog(source);
  assert.equal(requireLegacyCouponReward(rewards,0,"福引券"),rewards[0]);
  assert.throws(()=>requireLegacyCouponReward(rewards,0,"４次元福袋"),/不一致/);
  assert.throws(()=>requireLegacyCouponReward(rewards,30,"偽造"),/不一致/);
  assert.throws(()=>requireLegacyCouponReward(rewards,-1,"福引券"),/格式/);
  assert.throws(()=>requireLegacyCouponReward(rewards,"0","福引券"),/格式/);
});

test("拒絕資料缺欄、券價零值／負數、獎品耐久非法，且不虛構券到期欄位",()=>{
  const first=source.split(/\r?\n/).find(Boolean);
  const parts=first.split("<>");
  assert.equal(parts.length,34);
  assert.throws(()=>parseLegacyCouponCatalog(""),/數量/);
  assert.throws(()=>parseLegacyCouponCatalog("bad"),/欄位數/);
  assert.throws(()=>parseLegacyCouponCatalog(first.replace("クーポン交換品:1","クーポン交換品:0")) ,/點數或名稱/);
  assert.throws(()=>parseLegacyCouponCatalog(first.replace("クーポン交換品:1","クーポン交換品:-1")) ,/點數或名稱/);
  const withBadDur=[...parts];withBadDur[21]="-1";
  assert.throws(()=>parseLegacyCouponCatalog(withBadDur.join("<>")) ,/耐久/);
  const withBadUnit=[...parts];withBadUnit[22]="年";
  assert.throws(()=>parseLegacyCouponCatalog(withBadUnit.join("<>")) ,/耐久/);
  const reward=parseLegacyCouponCatalog(first)[0];
  assert.equal("expiresAt" in reward,false);
  assert.equal("couponExpiry" in reward,false);
});
