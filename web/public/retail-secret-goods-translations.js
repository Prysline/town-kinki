// TOWN 原版 dat_dir/syouhin.cgi：秘密の商品，第 242–255 行，共 14 列。
// 僅在 UI 顯示時換成繁體中文；原始日文 key、SKU、能力效果、價格、耐久和備註不變。
// 健／ス／パ／腕／脚／英各能力石保留單字風格，實際能力仍依原始 33 欄非零加成判定。
export const RETAIL_SECRET_GOODS_ZH_TW=Object.freeze({
  "ダイヤモンド": "鑽石",
  "知性のリング": "智慧戒指",
  "体力のリング": "體力戒指",
  "エロスのリング": "愛慾戒指",
  "科学のペンダント": "科學墜飾",
  "芸術のペンダント": "藝術墜飾",
  "文化のペンダント": "文化墜飾",
  "体力の石": "體力之石",
  "健の石": "健之石",
  "スの石": "速之石",
  "パの石": "力之石",
  "腕の石": "腕之石",
  "脚の石": "腳之石",
  "英の石": "英之石"
});
const CATEGORY_MAP=Object.freeze({"秘密の商品":"秘密商品"});
export const displayRetailSecretGoodsName=name=>RETAIL_SECRET_GOODS_ZH_TW[name]??name;
export const displayRetailSecretGoodsCategory=category=>CATEGORY_MAP[category]??category;
