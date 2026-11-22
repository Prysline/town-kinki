// TOWN 原版 dat_dir/syouhin.cgi：「ちゃんこ」2–9 行 8 筆、「金の箱」405 行 1 筆。
// 只翻譯顯示名稱及分類；原始名稱、SKU、能力、特殊效果、使用限制、物品備註均維持原版。
// 「どすこい」是相撲喊聲，系列在繁中顯示採「相撲」前綴；不據譯名推定食品／禮品用途。
// 「ランドマスター」保留作品專名 Landmaster；原始備註提到移動，但 town_ini.cgi 未列入移動清單。
export const RETAIL_CHANKO_ZH_TW=Object.freeze({
  "どすこいプレゼント": "相撲禮物",
  "どすこいちゃんこ": "相撲火鍋",
  "どすこいつまみ食い": "相撲偷吃",
  "どすこい訓練": "相撲訓練",
  "どすこいスーパープレゼント": "超級相撲禮物",
  "どすこいスーパーちゃんこ": "超級相撲火鍋",
  "どすこいスーパーつまみ食い": "超級相撲偷吃",
  "どすこいスーパー訓練": "超級相撲訓練"
});
export const RETAIL_GOLD_BOX_ZH_TW=Object.freeze({
  "ランドマスター": "Landmaster"
});
const NAME_MAP=Object.freeze({...RETAIL_CHANKO_ZH_TW,...RETAIL_GOLD_BOX_ZH_TW});
const CATEGORY_MAP=Object.freeze({"ちゃんこ":"相撲火鍋","金の箱":"金色寶箱"});
export const displayRetailChankoGoldName=name=>NAME_MAP[name]??name;
export const displayRetailChankoGoldCategory=category=>CATEGORY_MAP[category]??category;
