// 原版 dat_dir/syouhin.cgi：百貨「ドリンク」15 種與「アルコール」13 種。
// 自販機已確認的 12 項飲料譯名直接共用，避免同品在百貨和自販機顯示不同名稱。
// 僅顯示轉換，原始名稱、SKU、效果碼、類別及存檔均保留日文。
import { VENDING_ZH_TW } from "./item-translations.js";

export const RETAIL_DRINK_ZH_TW=Object.freeze({
  ...VENDING_ZH_TW,
  "元気ミルク": "活力牛奶",
  "ミルク": "牛奶",
  "シロップ": "糖漿"
});

export const RETAIL_ALCOHOL_ZH_TW=Object.freeze({
  "アロエ酒": "蘆薈酒",
  "朝鮮人参酒": "高麗人蔘酒",
  "ジャックダニエル": "傑克丹尼",
  "ジムビーム": "金賓",
  "フォアローゼス": "四玫瑰",
  "ビール（ピッチャー）": "啤酒（大壺）",
  "ダイキリ": "黛綺莉",
  "カルアミルク": "卡魯瓦牛奶",
  "グラスホッパー": "綠色蚱蜢",
  "XYZ": "XYZ調酒",
  "マルガリータ": "瑪格麗特",
  "ぼったくり": "敲竹槓",
  "ミックスボトル": "綜合酒瓶"
});

export const displayRetailDrinkAlcoholName=name=>
  RETAIL_DRINK_ZH_TW[name]??RETAIL_ALCOHOL_ZH_TW[name]??name;
export const displayRetailDrinkAlcoholCategory=category=>
  category==="ドリンク"?"飲料":category==="アルコール"?"酒類":category;
