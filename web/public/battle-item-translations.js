// 僅供 Web 玩家顯示：第七階段追蹤新基底的戰鬥、節慶及大阪挑戰來源。
// 原始 33 欄、怪物 ID、掉落權重、事件來源及裝備判定均維持原文。
export const BATTLE_ITEM_ZH_TW=Object.freeze({
  // obatyan.cgi：弱／強共八筆，おばちゃんの力 已沿用合成字典，不重複建檔。
  "関西弁翻訳機":"關西腔翻譯機",
  "おばちゃんの知恵薬":"阿姨的智慧藥",
  "おばちゃんの知恵袋":"阿姨的生活智慧",
  "おばちゃんの知恵薬（スーパー）":"阿姨的智慧藥（超級版）",
  "おばちゃんの知恵袋（スーパー）":"阿姨的生活智慧（超級版）",
  // battle.cgi::otosi_item 實際可掉落的前四筆；第 5 筆龍角不在獎池。
  "薬草":"藥草",
  "上薬草":"上等藥草",
  "特薬草":"特級藥草",
  "秘伝薬草":"秘傳藥草",
  // event.pl::get_itm2 由 SANTA_FIGHT_NAMES 核對的前六筆獎品。
  "悪魔の笛":"惡魔之笛",
  "天使の笛":"天使之笛",
  "４次元福袋":"四次元福袋",
  "等身大サンタさん人形":"等身大聖誕老人偶",
  "クリスマスケーキ１日分":"一日份聖誕蛋糕",
  "トナカイの肉１匹分":"一整隻馴鹿肉",
  // B 聯賽未穿戴裝備的原始預設名，念力已為繁中。
  "素手":"徒手",
  "洋服":"衣服",
  "先祖の霊":"祖先之靈"
});
export const BATTLE_CATEGORY_ZH_TW=Object.freeze({
  "ゲットアイテム":"獲得道具",
  "MB":"B 聯賽獎品"
});
// event.pl::get_itm2：第 29 欄真正有文字的備註僅前兩筆共有此一種類。
export const BATTLE_ITEM_COMMENTS_ZH_TW=Object.freeze({
  "何が起こるのだろう？":"究竟會發生什麼事呢？"
});
export const displayBattleItemName=name=>
  Object.hasOwn(BATTLE_ITEM_ZH_TW,name)?BATTLE_ITEM_ZH_TW[name]:name;
export const displayBattleItemCategory=category=>
  Object.hasOwn(BATTLE_CATEGORY_ZH_TW,category)?BATTLE_CATEGORY_ZH_TW[category]:category;

// dat_dir/battle.cgi：十筆怪物名稱已由使用者確認；僅顯示，不修改來源怪物鍵。
export const BATTLE_MONSTER_ZH_TW=Object.freeze({
  "ドロン":"幽靈",
  "べビードラゴン":"幼龍",
  "ドラゴン":"龍",
  "ベスドロン":"貝斯幽靈",
  "ゴットドラゴンの影":"神龍之影",
  "ボスドロン":"幽靈首領",
  "ゴットドラゴン":"神龍",
  "ドロンシドー":"幽靈席德",
  "ドロンエビル":"邪惡幽靈",
  "ゴットエビルドラゴン":"邪神龍"
});
export const displayBattleMonsterName=name=>
  Object.hasOwn(BATTLE_MONSTER_ZH_TW,name)?BATTLE_MONSTER_ZH_TW[name]:name;
