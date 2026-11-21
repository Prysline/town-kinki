// TOWN 原版 dat_dir/syouhin.cgi：「日用品」15 筆原始商品。
// 只提供繁體中文顯示名稱與分類；原始名稱、來源行、SKU、商品效果、耐久單位和交易邏輯不變。
// 「ブラタン」仍以音譯保留專有縮寫，不推定其背後指涉。
export const RETAIL_DAILY_GOODS_ZH_TW=Object.freeze({
  "健康保険": "健康保險",
  "谷保天満宮のお守り": "谷保天滿宮護身符",
  "学業成就のお守り": "學業成就護身符",
  "恋のお守り": "戀愛護身符",
  "健康のお守り": "健康護身符",
  "人生ゲーム": "人生遊戲",
  "人生ゲームDX": "人生遊戲DX",
  "ボンゴ": "邦哥鼓",
  "備長炭": "備長炭",
  "バーチャル農場ネタバレ": "虛擬農場劇透",
  "クレジットカード": "信用卡",
  "ゴールドクレジットカード": "金卡信用卡",
  "スペシャルクレジットカード": "特別信用卡",
  "ブラタンメンバーズカード": "布拉坦會員卡",
  "防犯カメラ": "防盜監視器"
});

export const displayRetailDailyGoodsName=name=>RETAIL_DAILY_GOODS_ZH_TW[name]??name;
export const displayRetailDailyGoodsCategory=category=>category==="日用品"?"日用品":category;
