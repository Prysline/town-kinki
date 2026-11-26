import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyCouponCatalog,requireLegacyCouponReward} from "../src/coupon-catalog.mjs";
import {displayRetailItemName,displayRetailItemCategory} from "../public/retail-item-translations.js";
import {RETAIL_GIFTS_ZH_TW} from "../public/retail-gift-translations.js";
import {COUPON_REWARD_NAMES_ZH_TW,displayCouponRewardCategory} from "../public/coupon-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/coupon.cgi",import.meta.url)));
const catalog=parseLegacyCouponCatalog(raw);
const reused={
  "ポルシェ": "保時捷",
  "ジャガー": "捷豹",
  "キャデラック": "凱迪拉克"
};
const medalSpecs=[
  {
    "name": "メダル 国",
    "field": 2,
    "display": "國語獎牌"
  },
  {
    "name": "メダル 数",
    "field": 3,
    "display": "數學獎牌"
  },
  {
    "name": "メダル 理",
    "field": 4,
    "display": "理科獎牌"
  },
  {
    "name": "メダル 社",
    "field": 5,
    "display": "社會獎牌"
  },
  {
    "name": "メダル 英",
    "field": 6,
    "display": "英語獎牌"
  },
  {
    "name": "メダル 音",
    "field": 7,
    "display": "音樂獎牌"
  },
  {
    "name": "メダル 美",
    "field": 8,
    "display": "美術獎牌"
  },
  {
    "name": "メダル ル",
    "field": 10,
    "display": "外貌獎牌"
  },
  {
    "name": "メダル 体",
    "field": 11,
    "display": "體力獎牌"
  },
  {
    "name": "メダル 健",
    "field": 12,
    "display": "健康獎牌"
  },
  {
    "name": "メダル ス",
    "field": 13,
    "display": "速度獎牌"
  },
  {
    "name": "メダル パ",
    "field": 14,
    "display": "力量獎牌"
  },
  {
    "name": "メダル 腕",
    "field": 15,
    "display": "臂力獎牌"
  },
  {
    "name": "メダル 脚",
    "field": 16,
    "display": "腿力獎牌"
  },
  {
    "name": "メダル L",
    "field": 18,
    "display": "LOVE 獎牌"
  },
  {
    "name": "メダル 面",
    "field": 19,
    "display": "有趣度獎牌"
  },
  {
    "name": "メダル H",
    "field": 20,
    "display": "情色度獎牌"
  }
];
const statIndices=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];

test("30 筆來源獎品逐列具備繁中譯名，其中 3 筆重用原有零售譯名、其餘 27 筆新增",()=>{
  assert.equal(catalog.length,30);
  assert.equal(new Set(catalog.map(x=>x.originalName)).size,30);
  assert.equal(Object.keys(COUPON_REWARD_NAMES_ZH_TW).length,27);
  assert.deepEqual(Object.keys(reused).sort(),["キャデラック","ジャガー","ポルシェ"].sort());
  const all=new Set([...Object.keys(COUPON_REWARD_NAMES_ZH_TW),...Object.keys(reused)]);
  assert.deepEqual([...all].sort(),catalog.map(x=>x.originalName).sort());
  for(const reward of catalog){
    const expected=COUPON_REWARD_NAMES_ZH_TW[reward.originalName]??reused[reward.originalName];
    assert.ok(expected&&expected.trim(),reward.originalName);
    assert.equal(displayRetailItemName(reward.originalName),expected,reward.originalName);
    assert.equal(reward.rawFields[1],reward.originalName);
    assert.equal(reward.rawFields[0],reward.rewardCategory);
    assert.equal(displayRetailItemCategory(reward.rewardCategory),"優惠券獎品（"+reward.requiredCoupons+" 點）");
    assert.equal(requireLegacyCouponReward(catalog,reward.sourceIndex,reward.originalName),reward);
    if(expected!==reward.originalName)
      assert.throws(()=>requireLegacyCouponReward(catalog,reward.sourceIndex,expected),/不一致/);
    assert.equal(reward.sourceIndex,catalog.indexOf(reward));
    assert.equal(reward.rawFields.length,33);
  }
  for(const [original,chinese] of Object.entries(reused))
    assert.equal(RETAIL_GIFTS_ZH_TW[original],chinese);
});

test("17 款能力獎牌根據來源 33 欄唯一非零能力與 UI 的既有中文能力名核對",()=>{
  assert.equal(medalSpecs.length,17);
  assert.deepEqual(medalSpecs.map(x=>x.field),statIndices);
  for(const {name,field,display} of medalSpecs){
    const prize=catalog.find(x=>x.originalName===name);
    assert.ok(prize,name);
    assert.equal(prize.requiredCoupons,5);
    assert.equal(prize.rawFields[field],"5",name+" 欄位 "+field);
    for(const index of statIndices)if(index!==field)
      assert.equal(prize.rawFields[index],"0",name+" 非對應能力 "+index);
    assert.equal(displayRetailItemName(name),display);
  }
});

test("優惠券兌換、通知、商店、歷史與背包只變更顯示，序號及原始名稱傳給 API",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const head=app.indexOf("const couponPendingMemory=new Map();");
  const tail=app.indexOf("function renderDining()",head);
  assert.ok(head>=0&&tail>head);
  const ui=app.slice(head,tail);
  for(const name of [
    "displayRetailItemName(reward.originalName)",
    "displayRetailItemName(result.originalName)",
    "displayRetailItemName(entry.originalName)"
  ])assert.ok(ui.includes(name),name);
  assert.match(ui,/sourceIndex:reward\.sourceIndex,originalName:reward\.originalName/);
  assert.match(ui,/value\.sourceIndex===reward\.sourceIndex&&value\.originalName===reward\.originalName/);
  assert.match(ui,/result\.sourceIndex!==reward\.sourceIndex\|\|result\.originalName!==reward\.originalName/);
  assert.match(ui,/api\("coupon\/redeem",pendingCouponRedemption\)/);
  assert.doesNotMatch(ui,/「クーポン」/);
  assert.match(app,/name\.textContent=displayRetailItemName\(item\.name\)/);
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.doesNotMatch(html,/有「クーポン」建築的城鎮/);
  assert.match(html,/有「優惠券兌換所」的城鎮/);
});

test("券價仍是原始類別標記，未知名稱與分類維持原樣，不翻譯使用者自訂內容",()=>{
  const expected=[1,150,150,100,100,100,100,50,25,25,25,25,25,
    ...Array(17).fill(5)];
  assert.deepEqual(catalog.map(x=>x.requiredCoupons),expected);
  assert.equal(displayRetailItemName("玩家自己輸入的留言"),"玩家自己輸入的留言");
  assert.equal(displayRetailItemCategory("玩家自訂類別"),"玩家自訂類別");
  assert.equal(displayCouponRewardCategory("クーポン交換品:150"),"優惠券獎品（150 點）");
  assert.equal(displayCouponRewardCategory("クーポン交換品:0"),"クーポン交換品:0");
  assert.equal(displayCouponRewardCategory("クーポン交換品:test"),"クーポン交換品:test");
});
