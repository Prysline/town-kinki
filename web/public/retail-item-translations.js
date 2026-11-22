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
import { displayRetailRegionalName,displayRetailRegionalCategory } from "./retail-regional-specialties-translations.js";
import { displayRetailDepartmentSupermarketCraftingName,displayRetailDepartmentSupermarketCraftingCategory } from "./retail-department-supermarket-crafting-translations.js";
import { displayRetailGiftName,displayRetailGiftCategory } from "./retail-gift-translations.js";
import { displayRetailSecretGoodsName,displayRetailSecretGoodsCategory } from "./retail-secret-goods-translations.js";

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
  displayRetailRegionalName,
  displayRetailDepartmentSupermarketCraftingName,
  displayRetailGiftName,
  displayRetailSecretGoodsName
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
  displayRetailRegionalCategory,
  displayRetailDepartmentSupermarketCraftingCategory,
  displayRetailGiftCategory,
  displayRetailSecretGoodsCategory
]);

export const displayRetailItemName=name=>
  ITEM_NAME_TRANSLATORS.reduce((value,translate)=>translate(value),name);
export const displayRetailItemCategory=category=>
  ITEM_CATEGORY_TRANSLATORS.reduce((value,translate)=>translate(value),category);
