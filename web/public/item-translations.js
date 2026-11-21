// 僅供 Web 介面顯示的繁體中文譯名。
// 原版日文名稱保留在 API、存檔、購買與裝備邏輯中，不以譯名作為資料鍵。
// dat_dir/soubi.cgi：27 種裝備屋品項。
export const EQUIPMENT_ZH_TW=Object.freeze({
  "HBの鉛筆":"HB鉛筆",
  "輪ゴム鉄砲":"橡皮筋槍",
  "ハンガー":"衣架",
  "ピッケル":"冰鎬",
  "手作りヌンチャク":"手工雙節棍",
  "ヌンチャク（Wii）":"Wii雙節棍控制器",
  "金属バット":"金屬球棒",
  "中華包丁":"中式菜刀",
  "斧":"斧頭",
  "スタンガン":"電擊槍",
  "手榴弾":"手榴彈",
  "根性":"毅力",
  "着ぐるみ":"布偶裝",
  "防弾チョッキ":"防彈背心",
  "アルミの盾":"鋁製盾牌",
  "木の盾":"木盾",
  "銅の盾":"銅盾",
  "銀の盾":"銀盾",
  "金の盾":"金盾",
  "核シェルター":"核災避難所",
  "小学校の教科書":"小學課本",
  "占い入門":"占卜入門",
  "法華経経典":"《法華經》",
  "コーラン":"《古蘭經》",
  "聖書":"《聖經》",
  "３日で覚える黒魔術":"三天學會黑魔術",
  "ど根性だいこん":"超有毅力的白蘿蔔"
});

// dat_dir/jihanki.cgi：原版自販機第一行為控制資料；其餘 12 種是販售目錄。
export const VENDING_ZH_TW=Object.freeze({
  "爽快ミルク":"清爽牛奶",
  "ウエイトアップミルク":"增重牛奶",
  "ダイエットお茶":"減重茶",
  "コーヒー":"咖啡",
  "カフェオレ":"咖啡歐蕾",
  "ジャスミン茶":"茉莉花茶",
  "オレンジジュース":"柳橙汁",
  "メロンソーダ":"哈密瓜汽水",
  "スペシャル健康ジュース":"特製健康果汁",
  "青汁":"青汁",
  "ヨーグルトドリンク":"優格飲料",
  "ブラジャードリンク":"白蘭地薑汁汽水"
});

// 分類僅翻譯畫面文字；原始類別仍用於裝備穿戴與商品資料。
export const EQUIPMENT_CATEGORY_ZH_TW=Object.freeze({
  "武器":"武器","防具":"防具","魔法":"魔法","御守":"護身符"
});
export const displayEquipmentName=name=>EQUIPMENT_ZH_TW[name]??name;
export const displayVendingName=name=>VENDING_ZH_TW[name]??name;
export const displayKnownItemName=name=>
  EQUIPMENT_ZH_TW[name]??VENDING_ZH_TW[name]??name;
export const displayEquipmentCategory=category=>EQUIPMENT_CATEGORY_ZH_TW[category]??category;
export const displayKnownItemCategory=category=>
  category==="ドリンク"?"飲料":displayEquipmentCategory(category);
