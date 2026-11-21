import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_DAILY_GOODS_ZH_TW,displayRetailDailyGoodsName,displayRetailDailyGoodsCategory
} from "../public/retail-daily-goods-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({
  line:i+1,fields:line.split("<>")
})).filter(row=>row.fields[0]==="日用品");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const retail=readFileSync(new URL("../src/retail.mjs",import.meta.url),"utf8");

test("日用品原版 15 列／15 種名稱完整覆蓋，原文商品鍵不被改動",()=>{
  assert.equal(rows.length,15);
  const names=new Set(rows.map(x=>x.fields[1]));
  assert.equal(names.size,15);
  assert.equal(Object.keys(RETAIL_DAILY_GOODS_ZH_TW).length,15);
  for(const {fields} of rows){
    assert.ok(Object.hasOwn(RETAIL_DAILY_GOODS_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailDailyGoodsName(fields[1]),RETAIL_DAILY_GOODS_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_DAILY_GOODS_ZH_TW[fields[1]]);
  }
  for(const key of Object.keys(RETAIL_DAILY_GOODS_ZH_TW))
    assert.ok(names.has(key),"來源不存在的日用品："+key);
});

test("原版商品來源行、SKU、類別與耐久單位逐件保持一致",()=>{
  const list=parseLegacyRetailCatalog(raw).filter(item=>item.category==="日用品");
  assert.equal(list.length,15);
  assert.equal(new Set(list.map(item=>item.originalLine)).size,15);
  assert.equal(new Set(list.map(item=>item.sku)).size,15);
  for(const item of list){
    assert.equal(item.rawFields[0],"日用品");
    assert.equal(item.rawFields[1],item.name);
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(displayRetailItemName(item.name),RETAIL_DAILY_GOODS_ZH_TW[item.name]);
  }
});

test("健康保險仍是原版 30 日商品，保留獨立醫院保險期限邏輯",()=>{
  const insurance=rows.find(x=>x.fields[1]==="健康保険");
  assert.equal(insurance.line,356);
  assert.equal(insurance.fields[9],"無");
  assert.equal(insurance.fields[21],"30");
  assert.equal(insurance.fields[22],"日");
  assert.equal(displayRetailItemName(insurance.fields[1]),"健康保險");
  assert.match(retail,/item\.name==="健康保険"/);
  assert.match(retail,/insuranceCoverage\(db,userId,now\)/);
  assert.match(retail,/item_key,active_until,last_purchased_at/);
});

test("四張信用卡原有效期、原始效果及銀行扣款識別不因譯名改變",()=>{
  const cards={
    "クレジットカード":["信用卡","3"],
    "ゴールドクレジットカード":["黃金信用卡","7"],
    "スペシャルクレジットカード":["特別信用卡","5"],
    "ブラタンメンバーズカード":["布拉坦會員卡","7"]
  };
  for(const [original,[display,days]] of Object.entries(cards)){
    const fields=rows.find(x=>x.fields[1]===original)?.fields;
    assert.ok(fields,original);
    assert.equal(fields[9],"クレジット",original);
    assert.equal(fields[21],days,original);
    assert.equal(fields[22],"日",original);
    assert.equal(displayRetailItemName(original),display);
  }
  assert.match(retail,/requireClassroomCreditCard\(db,userId,cardSourceLine,now\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
});

test("護身符、遊戲梗與特殊時效品保留名稱和原作備註",()=>{
  const expected={
    "谷保天満宮のお守り":"谷保天滿宮護身符",
    "学業成就のお守り":"學業成就護身符",
    "恋のお守り":"戀愛護身符",
    "健康のお守り":"健康護身符",
    "人生ゲーム":"人生遊戲",
    "人生ゲームDX":"人生遊戲DX",
    "ボンゴ":"邦哥鼓",
    "備長炭":"備長炭",
    "バーチャル農場ネタバレ":"虛擬農場劇透",
    "防犯カメラ":"防盜監視器"
  };
  for(const [original,translation] of Object.entries(expected))
    assert.equal(displayRetailItemName(original),translation,original);
  const special=rows.find(x=>x.fields[1]==="バーチャル農場ネタバレ").fields;
  assert.equal(special[29],"※専門店限定商品。自分へのご褒美");
  assert.equal(special[17],"75000");
  const camera=rows.find(x=>x.fields[1]==="防犯カメラ").fields;
  assert.equal(camera[21],"10");
  assert.equal(camera[22],"日");
  assert.equal(camera[29],"10日間で使い捨てです。");
  assert.equal(displayRetailDailyGoodsName("未知日用品"),"未知日用品");
  assert.equal(displayRetailDailyGoodsCategory("日用品"),"日用品");
  assert.equal(displayRetailItemCategory("日用品"),"日用品");
});

test("日用品走共用翻譯入口，不新增 app.js 分類特例或修改 API 識別",()=>{
  assert.match(app,/from "\.\/retail-item-translations\.js"/);
  assert.doesNotMatch(app,/from "\.\/retail-daily-goods-translations\.js"/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailItemName/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
