import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../../town_ini.cgi",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
const server=readFileSync(new URL("../src/server.mjs",import.meta.url),"utf8");

test("一般 25／本人禮品 10／受贈禮品 10／單品 5 組均由原版設定確認",()=>{
  assert.match(source,/\$syoyuu_gendosuu\s*=\s*'25'/);
  assert.match(source,/\$kounyu_gift_gendo\s*=\s*'10'/);
  assert.match(source,/\$gift_gendo\s*=\s*'10'/);
  assert.match(source,/\$item_kosuuseigen\s*=\s*'5'/);
  assert.match(html,/同一商品上限 5 組/);
  assert.match(html,/同一商品上限 5 組[^\n]*不等於 5 個背包格/);
});
test("物品欄顯示三種獨立的有效格數與原版上限，數值由伺服器計算",()=>{
  for(const id of ["inventory-general-usage","inventory-purchased-gift-usage",
    "inventory-received-gift-usage"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/一般物品<\/span><strong id="inventory-general-usage">— \/ 25 格/);
  assert.match(html,/自購禮品<\/span><strong id="inventory-purchased-gift-usage">— \/ 10 格/);
  assert.match(html,/收到的禮品<\/span><strong id="inventory-received-gift-usage">— \/ 10 格/);
  assert.match(app,/const caps=state\.inventoryCapacity/);
  assert.match(app,/Number\.isSafeInteger\(count\)\?count:"—"/);
  assert.match(server,/inventoryCapacity: updated \? inventorySlotUsage\(db,user\.id,now\) : null/);
  assert.match(css,/\.inventory-capacity\{display:grid/);
});
test("物品分類為原生 details／summary，可鍵盤操作，收合選擇跨同步保留",()=>{
  assert.match(app,/const collapsedInventoryCategories=new Set\(\)/);
  assert.match(app,/document\.createElement\("details"\);section\.className="inventory-category"/);
  assert.match(app,/const categoryKey=\(state\.character\?\.name\?\?""\)\+":"\+category/);
  assert.match(app,/section\.open=!collapsedInventoryCategories\.has\(categoryKey\)/);
  assert.match(app,/section\.addEventListener\("toggle"/);
  assert.match(app,/document\.createElement\("summary"\);heading\.className="inventory-category-heading"/);
  assert.match(app,/displayRetailItemCategory\(category\)\+"（"\+grouped\.get\(category\)\.length\+" 件）"/);
  assert.match(app,/categoryItems\.append\(card\)/);
  assert.match(app,/section\.append\(categoryItems\)/);
  assert.match(css,/\.inventory-category-heading:focus-visible/);
  assert.doesNotMatch(app,/document\.createElement\("h4"\);heading\.className="inventory-category-heading"/);
});
