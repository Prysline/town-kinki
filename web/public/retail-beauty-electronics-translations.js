// TOWN 原版 dat_dir/syouhin.cgi：「美容」13 筆、「電化製品」14 筆。
// 本對照只處理繁體中文 UI；資料庫、SKU、原始商品名稱、效果碼與原始分類均不改動。
// 英文產品／型號保留識別度；不在字典內的商品回退原名。
export const RETAIL_BEAUTY_ELECTRONICS_ZH_TW=Object.freeze({
  "ヘアーカラー(髪染め)": "染髮劑",
  "リフレッシュエステ": "舒活美容療程",
  "美顔パック": "美容面膜",
  "油取り紙": "吸油面紙",
  "シャネルの５番": "香奈兒五號香水",
  "シャネルの限定コフレ": "香奈兒限定美妝禮盒",
  "Dior2004限定KIT": "Dior 2004限定套組",
  "ヌーブラ": "NuBra隱形胸罩",
  "フェロモン香水": "費洛蒙香水",
  "幸せを呼ぶ香水": "招來幸福的香水",
  "スリムアップビューティ": "纖體美人",
  "バストアップブラ": "豐胸胸罩",
  "セイ・ノビール": "聖德高",
  "未来型ＰＣ": "未來型電腦",
  "ドラえもん試作一号": "哆啦A夢試作一號",
  "iMac": "iMac",
  "PowerBook": "PowerBook",
  "MacG5": "Mac G5",
  "Apple1": "Apple1",
  "MacintoshClassic": "Macintosh Classic",
  "ibook": "iBook",
  "Vaio": "VAIO",
  "プラズマテレビ": "電漿電視",
  "ThinkPad": "ThinkPad",
  "ダイナブック": "dynabook",
  "MDコンポ": "MD音響",
  "年賀状作成機": "新年賀卡製作機"
});

export const displayRetailBeautyElectronicsName=name=>RETAIL_BEAUTY_ELECTRONICS_ZH_TW[name]??name;
export const displayRetailBeautyElectronicsCategory=category=>
  category==="美容"?"美容用品":category==="電化製品"?"電器用品":category;
