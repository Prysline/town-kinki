// 只處理原版 dat_dir/otakara.cgi 的 110 筆寶箱獎品之 Web 顯示。
// 五組 17 項能力縮寫逐一核對原始 33 欄；不更動獎池、機率、金額或道具效果。
// 原文 冷えピタクール 暫待使用者確認商品式名稱，未知值保持原文。
const STAT_SUFFIXES=Object.freeze({
  "国":"國語",
  "数":"數學",
  "理":"理科",
  "社":"社會",
  "英":"英語",
  "音":"音樂",
  "美":"美術",
  "ル":"外貌",
  "体":"體力",
  "健":"健康",
  "ス":"速度",
  "パ":"力量",
  "腕":"臂力",
  "脚":"腿力",
  "L":"LOVE",
  "面":"有趣度",
  "H":"情色度"
});
const SERIES=Object.freeze([
  Object.freeze({original:"銀のコイン",display:"銀幣"}),
  Object.freeze({original:"銀箔",display:"銀箔"}),
  Object.freeze({original:"銅のメダル",display:"銅牌"}),
  Object.freeze({original:"ティッシュ",display:"面紙"}),
  Object.freeze({original:"金箔",display:"金箔"})
]);
const SERIES_NAMES=Object.fromEntries(SERIES.flatMap(({original,display})=>
  Object.entries(STAT_SUFFIXES).map(([suffix,stat])=>
    [original+" "+suffix,display+"（"+stat+"）"])));
export const TREASURE_REWARD_NAMES_ZH_TW=Object.freeze({
  ...SERIES_NAMES,
  "豪華クルージング":"豪華遊輪之旅",
  "究極の純プラチナカー":"究極純鉑金車"
});
const TREASURE_CATEGORIES=Object.freeze({
  "銅の箱":"銅箱",
  "銀の箱":"銀箱",
  "スペシャル":"特殊寶箱"
});
export const displayTreasureRewardName=name=>TREASURE_REWARD_NAMES_ZH_TW[name]??name;
export const displayTreasureRewardCategory=category=>TREASURE_CATEGORIES[category]??category;
