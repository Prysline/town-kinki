// 原版 dat_dir/syouhin.cgi：ギフト（禮品）第 383–404 行，22 列且無重複原名。
// 只在 Web 畫面替換顯示名稱，原始分類、SKU、售價、效能、耐久和備註不動。
// 其中 7 件原版禮品亦存在於 town_ini.cgi 的移動工具清單；仍保留ギフト分類。
// 船艦大和雖有原版移動備註，未列入該清單；不自行加入移動功能。
export const RETAIL_GIFTS_ZH_TW=Object.freeze({
  "本命チョコレート": "本命巧克力",
  "マイ勝負パンティ": "我的決勝內褲",
  "プーさん人形": "小熊維尼玩偶",
  "中田英寿サイン入りユニフォーム": "中田英壽親筆簽名球衣",
  "ティファニーのイヤリング": "蒂芙尼耳環",
  "シャネルの財布": "香奈兒錢包",
  "シャネルのバッグ": "香奈兒包包",
  "ポルシェ": "保時捷",
  "ジャガー": "捷豹",
  "キャデラック": "凱迪拉克",
  "ミグ25": "米格-25戰鬥機",
  "BMW": "BMW",
  "フェアレディZ": "日產 Fairlady Z",
  "ベスパ": "偉士牌",
  "アンティーク時計": "古董鐘錶",
  "ディズニーDENPO": "迪士尼電報",
  "祝花（上）": "祝賀花禮（上等）",
  "祝花（特上）": "祝賀花禮（特上）",
  "祝花（スペシャル）": "祝賀花禮（特別款）",
  "スーパースッポンエキス": "超級鱉精",
  "スッポン定食セット": "鱉料理套餐組",
  "船艦大和": "戰艦大和號"
});
const CATEGORY_MAP=Object.freeze({"ギフト":"禮品"});
export const displayRetailGiftName=name=>RETAIL_GIFTS_ZH_TW[name]??name;
export const displayRetailGiftCategory=category=>CATEGORY_MAP[category]??category;
