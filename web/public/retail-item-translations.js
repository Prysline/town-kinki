// 百貨與背包名稱的唯一前端翻譯入口。新增商品分類時只擴充這裡，無須再改 app.js。
// 所有映射輸入都是原版日文；只在 UI 顯示階段轉換，SKU、效果和 API 原樣保留。
import { displayKnownItemName,displayKnownItemCategory } from "./item-translations.js";
import { displayRetailFoodName,displayRetailFoodCategory } from "./retail-food-translations.js";
import { displayDessertFastFoodName,displayDessertFastFoodCategory } from "./retail-dessert-fastfood-translations.js";
import { displayRetailDrinkAlcoholName,displayRetailDrinkAlcoholCategory } from "./retail-drink-alcohol-translations.js";
import { displayRetailSportsMedicineName,displayRetailSportsMedicineCategory } from "./retail-sports-medicine-translations.js";
import { displayRetailBeautyElectronicsName,displayRetailBeautyElectronicsCategory } from "./retail-beauty-electronics-translations.js";
import { displayRetailFlowerName,displayRetailFlowerCategory } from "./retail-flower-translations.js";
import { displayRetailDailyGoodsName,displayRetailDailyGoodsCategory } from "./retail-daily-goods-translations.js";
import { displayRetailGameName,displayRetailGameCategory } from "./retail-game-translations.js";
import { displayRetailTransportPetsBaitName,displayRetailTransportPetsBaitCategory } from "./retail-transport-pets-bait-translations.js";
import { displayFishingCatchName,displayFishingCatchCategory } from "./fishing-translations.js";
import { displayCouponRewardName,displayCouponRewardCategory } from "./coupon-translations.js";
import { displayTreasureRewardName,displayTreasureRewardCategory } from "./treasure-translations.js";
import { displayCraftingName,displayCraftingCategory } from "./crafting-translations.js";
import { displayRetailRegionalName,displayRetailRegionalCategory } from "./retail-regional-specialties-translations.js";
import { displayRetailDepartmentSupermarketCraftingName,displayRetailDepartmentSupermarketCraftingCategory } from "./retail-department-supermarket-crafting-translations.js";
import { displayRetailGiftName,displayRetailGiftCategory } from "./retail-gift-translations.js";
import { displayRetailSecretGoodsName,displayRetailSecretGoodsCategory } from "./retail-secret-goods-translations.js";
import { displayRetailChankoGoldName,displayRetailChankoGoldCategory } from "./retail-chanko-gold-translations.js";
import { displayRetailDvdName,displayRetailDvdCategory } from "./retail-dvd-translations.js";
import { displayRetailBookName,displayRetailBookCategory } from "./retail-book-translations.js";
import { displayRetailAdultName,displayRetailAdultCategory } from "./retail-adult-translations.js";

const ITEM_NAME_TRANSLATORS=Object.freeze([
  displayKnownItemName,
  displayRetailFoodName,
  displayDessertFastFoodName,
  displayRetailDrinkAlcoholName,
  displayRetailSportsMedicineName,
  displayRetailBeautyElectronicsName,
  displayRetailFlowerName,
  displayRetailDailyGoodsName,
  displayRetailGameName,
  displayRetailTransportPetsBaitName,
  displayFishingCatchName,
  displayCouponRewardName,
  displayTreasureRewardName,
  displayCraftingName,
  displayRetailRegionalName,
  displayRetailDepartmentSupermarketCraftingName,
  displayRetailGiftName,
  displayRetailSecretGoodsName,
  displayRetailChankoGoldName,
  displayRetailDvdName,
  displayRetailBookName,
  displayRetailAdultName
]);
const ITEM_CATEGORY_TRANSLATORS=Object.freeze([
  displayKnownItemCategory,
  displayRetailFoodCategory,
  displayDessertFastFoodCategory,
  displayRetailDrinkAlcoholCategory,
  displayRetailSportsMedicineCategory,
  displayRetailBeautyElectronicsCategory,
  displayRetailFlowerCategory,
  displayRetailDailyGoodsCategory,
  displayRetailGameCategory,
  displayRetailTransportPetsBaitCategory,
  displayFishingCatchCategory,
  displayCouponRewardCategory,
  displayTreasureRewardCategory,
  displayCraftingCategory,
  displayRetailRegionalCategory,
  displayRetailDepartmentSupermarketCraftingCategory,
  displayRetailGiftCategory,
  displayRetailSecretGoodsCategory,
  displayRetailChankoGoldCategory,
  displayRetailDvdCategory,
  displayRetailBookCategory,
  displayRetailAdultCategory
]);

export const displayRetailItemName=name=>
  ITEM_NAME_TRANSLATORS.reduce((value,translate)=>translate(value),name);
const DYNAMIC_ITEM_CATEGORY_ZH_TW=Object.freeze({
  "ギフト商品":"已收禮品",
  "リサイクル":"回收商品"
});
export const displayRetailItemCategory=category=>
  ITEM_CATEGORY_TRANSLATORS.reduce((value,translate)=>translate(value),
    DYNAMIC_ITEM_CATEGORY_ZH_TW[category]??category);
