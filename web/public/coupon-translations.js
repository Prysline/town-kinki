// 原版 dat_dir/coupon.cgi 30 筆券獎品中，既有三筆車名重用零售禮品譯名。
// 本檔僅收錄其餘 27 筆新譯名；來源名稱、序號、券價與獎品 33 欄均維持原文。
// 「メダル」縮寫對照根據原始第 2～20 欄的單一能力加值確認。
export const COUPON_REWARD_NAMES_ZH_TW=Object.freeze({
  "福引券":"抽獎券",
  "４次元福袋":"四次元福袋",
  "等身大サンタさん人形":"真人大小聖誕老人玩偶",
  "クリスマスケーキ１年分":"一年份聖誕蛋糕",
  "トナカイの肉１００匹分":"100 隻馴鹿的肉",
  "巨大クリスマスツリー":"巨型聖誕樹",
  "スーパー魔法":"超級魔法",
  "プラチナインゴット":"鉑金錠",
  "フェラーリ":"法拉利",
  "ロータスヨーロッパ":"蓮花 Europa",
  "メダル 国":"國語獎牌",
  "メダル 数":"數學獎牌",
  "メダル 理":"理科獎牌",
  "メダル 社":"社會獎牌",
  "メダル 英":"英語獎牌",
  "メダル 音":"音樂獎牌",
  "メダル 美":"美術獎牌",
  "メダル ル":"外貌獎牌",
  "メダル 体":"體力獎牌",
  "メダル 健":"健康獎牌",
  "メダル ス":"速度獎牌",
  "メダル パ":"力量獎牌",
  "メダル 腕":"臂力獎牌",
  "メダル 脚":"腿力獎牌",
  "メダル L":"LOVE 獎牌",
  "メダル 面":"有趣度獎牌",
  "メダル H":"情色度獎牌"
});
export const displayCouponRewardName=name=>COUPON_REWARD_NAMES_ZH_TW[name]??name;
export function displayCouponRewardCategory(category){
  if(typeof category!=="string")return category;
  const matched=/^クーポン交換品:([1-9][0-9]*)$/.exec(category);
  return matched?"優惠券獎品（"+matched[1]+" 點）":category;
}
