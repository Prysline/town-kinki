// TOWN dat_dir/syouhin.cgi：「東北名産店」14、「関西名産店」8，共 22 筆。
// 名產與地方文化名稱只作 UI 繁中顯示。原始商品鍵、分類、SKU、效果、耐久、備註保持不變。
// 「食い倒れ」保留關西飲食諧趣；原文「楽天ゴールデンゴールズ」「新型野郎箪笥」依字面保留特殊命名。
export const RETAIL_TOHOKU_SPECIALTIES_ZH_TW=Object.freeze({
  "笹かまぼこ": "笹葉魚板",
  "きりたんぽ鍋セット": "烤米棒鍋組",
  "蔵王温泉湯の花": "藏王溫泉湯之花",
  "秋田名物稲庭うどん": "秋田名產稻庭烏龍麵",
  "鉄瓶": "鐵壺",
  "宮城伝統こけし": "宮城傳統木芥子人偶",
  "天童将棋駒": "天童將棋棋子",
  "白神山地ガイドマップ": "白神山地導覽地圖",
  "仙台名物牛タン焼き": "仙台名產烤牛舌",
  "玉虫塗の名刺入": "玉蟲塗名片夾",
  "仙台名物ずんだもち": "仙台名產毛豆麻糬",
  "平泉の文化遺産見学ツアー旅行券": "平泉文化遺產參觀旅遊券",
  "新型野郎箪笥": "新型野郎衣櫃",
  "楽天ゴールデンゴールズ試合観覧特別優待券": "樂天 Golden Goals 賽事特別優待券"
});
export const RETAIL_KANSAI_SPECIALTIES_ZH_TW=Object.freeze({
  "お好み焼き": "大阪燒",
  "たこ焼き": "章魚燒",
  "食い倒れ弁当": "吃到破產便當",
  "鳥取砂丘の砂": "鳥取砂丘的沙",
  "食い倒れ人形": "食倒太郎人偶",
  "琵琶湖の水": "琵琶湖湖水",
  "有田みかん": "有田蜜柑",
  "阪神タイガースの公式チケット": "阪神虎官方門票"
});
const NAME_MAP=Object.freeze({...RETAIL_TOHOKU_SPECIALTIES_ZH_TW,...RETAIL_KANSAI_SPECIALTIES_ZH_TW});
const CATEGORY_MAP=Object.freeze({"東北名産店":"東北名產店","関西名産店":"關西名產店"});
export const displayRetailRegionalName=name=>NAME_MAP[name]??name;
export const displayRetailRegionalCategory=category=>CATEGORY_MAP[category]??category;
