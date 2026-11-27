// 原版 dat_dir/gousei.cgi 12 種成品、15 種獨立材料，僅增加尚未有繁中對照的名稱。
// 冰淇淋與其他已翻譯材料沿用既有零售映射；「健康汁」「金塊」原文已是繁中。
// シロノワール 依台灣客美多官方中文品名「冰與火」。
// 僅 Web 顯示：recipeKey、原始成品名、材料鍵、數量及 33 欄都保持不變。
export const CRAFTING_DISPLAY_NAMES_ZH_TW=Object.freeze({
  "アイスコーヒー":"冰咖啡",
  "ホットコーヒー":"熱咖啡",
  "焙煎アイスコーヒー":"烘焙冰咖啡",
  "焙煎ホットコーヒー":"烘焙熱咖啡",
  "ミルクコーヒー":"牛奶咖啡",
  "シロノワール":"冰與火",
  "韓国語を習う本":"韓語學習書",
  "阪神タイガースの選手のレアなサイン":"阪神虎球員珍稀親筆簽名",
  "万能おばちゃんロボット1号":"萬能阿姨機器人1號",
  "純金製ミグ25":"純金製米格-25戰鬥機",
  "おばちゃんの力":"阿姨的力量"
});
export const CRAFTING_DISPLAY_CATEGORIES_ZH_TW=Object.freeze({
  "本":"書籍",
  "自動車":"汽車"
});
export const displayCraftingName=name=>CRAFTING_DISPLAY_NAMES_ZH_TW[name]??name;
export const displayCraftingCategory=category=>CRAFTING_DISPLAY_CATEGORIES_ZH_TW[category]??category;
