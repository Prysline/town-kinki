// 僅處理 Web 玩家介面顯示，魚名原始鍵與獎池仍由 sea.cgi / fishing.mjs 決定。
// 譯名歧義者暫時保留原文，候選詞與原始證據記錄於 web/docs/i18n-fishing-review-zh-TW.md。
export const FISHING_CATCHES_ZH_TW=Object.freeze({
  "小魚":"小魚",
  "ミニたこ":"迷你章魚",
  "中くらいの魚":"中型魚",
  "クラゲ":"水母",
  "でかい魚":"大魚",
  "サメ":"鯊魚",
  "海がめ":"海龜",
  "マグロ":"鮪魚"
});
export const FISHING_CATEGORIES_ZH_TW=Object.freeze({
  "幻の魚":"夢幻魚"
});
export const displayFishingCatchName=name=>FISHING_CATCHES_ZH_TW[name]??name;
export const displayFishingCatchCategory=category=>FISHING_CATEGORIES_ZH_TW[category]??category;
