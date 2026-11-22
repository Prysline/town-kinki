// TOWN 原版 dat_dir/syouhin.cgi：デパート 3、スーパー 6、合成 4；共 13 列。
// 僅前端顯示層翻譯；不修改原始鍵、SKU、交易、效果、耐久與備註。
// 特製卵っち 等特殊名稱可再依玩家校對；Tomcat 保留英文原名，MHP2G 採用臺灣慣用完整作品名。
// 合成商品「コーヒー」與既有裝備／販賣機翻譯共用同一繁中名稱，避免撞鍵。
export const RETAIL_DEPARTMENT_ZH_TW=Object.freeze({
  "お歳暮": "歲末贈禮",
  "お中元": "中元贈禮",
  "福袋": "福袋"
});
export const RETAIL_SUPERMARKET_ZH_TW=Object.freeze({
  "激安健康器具": "超低價健身器材",
  "激安パズル": "超低價拼圖",
  "特製卵っち": "特製電子雞",
  "トムキャット": "Tomcat",
  "断食セット": "斷食套組",
  "MHP2G": "魔物獵人攜帶版2nd G"
});
export const RETAIL_CRAFTING_ZH_TW=Object.freeze({
  "冷蔵庫": "冰箱",
  "ポット": "熱水壺",
  "コーヒー豆": "咖啡豆",
  "コーヒー": "咖啡"
});
const NAME_MAP=Object.freeze({...RETAIL_DEPARTMENT_ZH_TW,...RETAIL_SUPERMARKET_ZH_TW,...RETAIL_CRAFTING_ZH_TW});
const CATEGORY_MAP=Object.freeze({"デパート":"百貨公司","スーパー":"超級市場","合成":"合成"});
export const displayRetailDepartmentSupermarketCraftingName=name=>NAME_MAP[name]??name;
export const displayRetailDepartmentSupermarketCraftingCategory=category=>CATEGORY_MAP[category]??category;
