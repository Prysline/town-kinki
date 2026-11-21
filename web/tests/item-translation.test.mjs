import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyEquipmentCatalog } from "../src/equipment.mjs";
import { parseLegacyVendingCatalog } from "../src/vending.mjs";
import {
  EQUIPMENT_ZH_TW,VENDING_ZH_TW,
  displayEquipmentName,displayVendingName,displayKnownItemName,
  displayEquipmentCategory,displayKnownItemCategory
} from "../public/item-translations.js";

const equipmentSource=decodeLegacyText(readFileSync(new URL("../../dat_dir/soubi.cgi",import.meta.url)));
const vendingSource=decodeLegacyText(readFileSync(new URL("../../dat_dir/jihanki.cgi",import.meta.url)));
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("裝備屋 27 個原版名稱全部對照繁體中文，SKU／類別／原始名稱不變",()=>{
  const items=parseLegacyEquipmentCatalog(equipmentSource);
  assert.equal(items.length,27);
  assert.equal(Object.keys(EQUIPMENT_ZH_TW).length,27);
  const sourceNames=new Set(items.map(item=>item.name));
  assert.equal(sourceNames.size,27);
  for(const item of items){
    assert.ok(Object.hasOwn(EQUIPMENT_ZH_TW,item.name),item.name);
    assert.ok(displayEquipmentName(item.name)?.trim(),item.name);
    assert.equal(displayKnownItemName(item.name),EQUIPMENT_ZH_TW[item.name]);
    assert.ok(item.sku.startsWith("equip-"));
  }
  for(const originalName of Object.keys(EQUIPMENT_ZH_TW))
    assert.ok(sourceNames.has(originalName),"來源不存在的裝備譯名："+originalName);
});

test("自動販賣機 12 種可販售飲料全部有繁體中文名稱；原版第一行不算貨品",()=>{
  const items=parseLegacyVendingCatalog(vendingSource);
  assert.equal(items.length,12);
  assert.equal(Object.keys(VENDING_ZH_TW).length,12);
  const names=new Set(items.map(item=>item.name));
  for(const item of items){
    assert.ok(Object.hasOwn(VENDING_ZH_TW,item.name),item.name);
    assert.ok(displayVendingName(item.name)?.trim(),item.name);
    assert.equal(displayKnownItemName(item.name),VENDING_ZH_TW[item.name]);
    assert.equal(item.category,"ドリンク");
    assert.ok(item.sku.startsWith("vending-"));
  }
  assert.equal(VENDING_ZH_TW["ブラジャードリンク"],"胸罩飲料");
  assert.ok(!names.has("元気ミルク"));
  for(const originalName of Object.keys(VENDING_ZH_TW))
    assert.ok(names.has(originalName),"來源不存在的飲料譯名："+originalName);
});

test("未知物品回退原文，分類顯示翻譯不改原始分類",()=>{
  assert.equal(displayEquipmentName("未知裝備"),"未知裝備");
  assert.equal(displayVendingName("未知飲料"),"未知飲料");
  assert.equal(displayKnownItemName("未知物品"),"未知物品");
  assert.equal(displayEquipmentCategory("御守"),"護身符");
  assert.equal(displayKnownItemCategory("ドリンク"),"飲料");
  assert.equal(displayKnownItemCategory("武器"),"武器");
  assert.equal(displayKnownItemCategory("原始分類"),"原始分類");
});

test("商店、背包、裝備與購買紀錄使用中文顯示，提交 API 保留原始物品名稱與 SKU",()=>{
  assert.match(app,/import \{ displayEquipmentName,displayVendingName,displayKnownItemName/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName/);
  assert.match(app,/document\.createTextNode\(displayProductName\(item\.name\)\)/);
  assert.match(app,/displayVendingName\(entry\.name\)/);
  assert.match(app,/displayVendingName\(result\.name\)/);
  assert.match(app,/name\.textContent=displayRetailItemName\(item\.name\)/);
  assert.match(app,/displayEquipmentName\(item\.name\)/);
  assert.match(app,/displayEquipmentName\(tx\.name\)/);
  assert.match(app,/displayEquipmentName\(result\.name\)/);
  assert.match(app,/displayKnownItemCategory\(category\)/);
  assert.match(app,/sku:item\.sku,itemId:null,name:item\.name/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
});
