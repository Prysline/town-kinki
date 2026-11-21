// TOWN 原版 dat_dir/syouhin.cgi：乗り物 11、ペット 7、餌 4，合計 22 列。
// 僅顯示層翻譯：保留原始 CGI 名稱、分類、SKU、效果、備註與耐久。
// 特有品牌及角色保留原名以防混淆；ナナハン指 750cc，ローラースルーGOGO 是三輪滑板車。
export const RETAIL_VEHICLES_ZH_TW=Object.freeze({
  "アルファロメオ": "Alfa Romeo（愛快羅密歐）",
  "ボルボ": "Volvo（富豪）",
  "ロールスロイス": "Rolls-Royce（勞斯萊斯）",
  "カローラ": "Toyota Corolla",
  "ナナハン": "750cc 重機",
  "ドゥカティ": "Ducati（杜卡迪）",
  "自転車": "腳踏車",
  "スカイラインGTR": "Nissan Skyline GT-R",
  "ベンツ": "Mercedes-Benz（賓士）",
  "スーパーカブ": "Honda Super Cub",
  "ローラースルーゴーゴー": "Roller Through GOGO（三輪滑板車）"
});
export const RETAIL_PETS_ZH_TW=Object.freeze({
  "キリン": "長頸鹿",
  "子猫": "小貓",
  "子豚": "小豬",
  "豚": "豬",
  "チンパンジー": "黑猩猩",
  "ゴリラ": "大猩猩",
  "ガチャピン": "Gachapin（綠色恐龍）"
});
export const RETAIL_BAIT_ZH_TW=Object.freeze({
  "魚ルアー（中）": "釣魚路亞（中）",
  "魚ルアー（小）": "釣魚路亞（小）",
  "魚ルアー（大）": "釣魚路亞（大）",
  "小エビ": "小蝦米"
});
const NAME_MAP=Object.freeze({
  ...RETAIL_VEHICLES_ZH_TW,...RETAIL_PETS_ZH_TW,...RETAIL_BAIT_ZH_TW
});
const CATEGORY_MAP=Object.freeze({"乗り物":"交通工具","ペット":"寵物","餌":"餌料"});
export const displayRetailTransportPetsBaitName=name=>NAME_MAP[name]??name;
export const displayRetailTransportPetsBaitCategory=category=>CATEGORY_MAP[category]??category;
