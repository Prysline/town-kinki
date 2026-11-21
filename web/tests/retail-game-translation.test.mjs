import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import {
  RETAIL_GAMES_ZH_TW,displayRetailGameName,displayRetailGameCategory
} from "../public/retail-game-translations.js";
import {
  displayRetailItemName,displayRetailItemCategory
} from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({
  line:i+1,fields:line.split("<>")
})).filter(row=>row.fields[0]==="ゲーム");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("遊戲分類原版 17 列、17 個不同名稱均有繁中顯示，無多餘譯名",()=>{
  assert.equal(rows.length,17);
  const names=new Set(rows.map(x=>x.fields[1]));
  assert.equal(names.size,17);
  assert.equal(Object.keys(RETAIL_GAMES_ZH_TW).length,17);
  for(const {fields} of rows){
    assert.ok(Object.hasOwn(RETAIL_GAMES_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailGameName(fields[1]),RETAIL_GAMES_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_GAMES_ZH_TW[fields[1]]);
    assert.ok(displayRetailGameName(fields[1]).trim(),fields[1]);
  }
  for(const original of Object.keys(RETAIL_GAMES_ZH_TW))
    assert.ok(names.has(original),"來源不存在的遊戲："+original);
});

test("原始遊戲商品名稱、分類、來源行、SKU 與資料欄位維持原版",()=>{
  const list=parseLegacyRetailCatalog(raw).filter(item=>item.category==="ゲーム");
  assert.equal(list.length,17);
  assert.equal(new Set(list.map(item=>item.sku)).size,17);
  assert.equal(new Set(list.map(item=>item.originalLine)).size,17);
  for(const item of list){
    assert.equal(item.sku,"legacy-"+item.originalLine);
    assert.equal(item.rawFields[0],"ゲーム");
    assert.equal(item.rawFields[1],item.name);
    assert.equal(displayRetailItemName(item.name),RETAIL_GAMES_ZH_TW[item.name]);
  }
  assert.deepEqual(rows.map(x=>x.line),Array.from({length:17},(_,i)=>339+i));
});

test("臺灣既有遊戲名稱及原版城鎮名稱不混淆",()=>{
  const expected={
    "ポケモン・コロシアム":"寶可夢圓形競技場",
    "ハローキティのおしゃべりABC":"Hello Kitty說說ABC",
    "ときめきメモリアル":"純愛手札",
    "ドラゴンクエストV 天空の花嫁":"勇者鬥惡龍V 天空的新娘",
    "ファイナルファンタジー XII":"太空戰士XII",
    "戦国無双":"戰國無雙",
    "逆転裁判バリューパック":"逆轉裁判超值套組",
    "ブラジャータウン":"胸罩鎮",
    "星のカービィ参上！ドロッチェ団":"星之卡比 怪盜洛切團登場！",
    "キングダムハーツ2ファイナルミックス＋":"王國之心2 Final Mix+"
  };
  for(const [original,translation] of Object.entries(expected))
    assert.equal(displayRetailItemName(original),translation,original);
  assert.equal(displayRetailGameCategory("ゲーム"),"遊戲");
  assert.equal(displayRetailItemCategory("ゲーム"),"遊戲");
  assert.equal(displayRetailGameName("不存在的作品"),"不存在的作品");
});

test("惡搞作品保留混搭笑點，不誤判為真正系列；未改原版效果",()=>{
  assert.equal(displayRetailItemName("ファイナルクエスト"),"最終冒險");
  assert.equal(displayRetailItemName("ドラゴンクファンタジー"),"勇者鬥幻想");
  const spoof=rows.find(x=>x.fields[1]==="ドラゴンクファンタジー").fields;
  assert.equal(spoof[9],"ダイエット,1");
  assert.equal(spoof[29],"ダイエットに効果があります。");
  const town=rows.find(x=>x.fields[1]==="TOWN 改造版").fields;
  assert.equal(town[29],"※専門店限定商品。");
  assert.equal(displayRetailItemName(town[1]),"TOWN 改造版");
});

test("原文特殊大小寫、全形字與不完整括號僅於中文顯示層修飾",()=>{
  assert.equal(displayRetailItemName("Wiisｐort"),"Wii Sports");
  assert.equal(displayRetailItemName("バイオハザード（wiiバージョン"),"惡靈古堡（Wii版）");
  assert.equal(displayRetailItemName("平成教育委員会　DS"),"平成教育委員會 DS");
  const bio=rows.find(x=>x.fields[1]==="バイオハザード（wiiバージョン").fields;
  const kingdom=rows.find(x=>x.fields[1]==="キングダムハーツ2ファイナルミックス＋").fields;
  assert.equal(bio[9],"ステータス");
  assert.equal(bio[21],"6");
  assert.equal(bio[22],"日");
  assert.equal(bio[27],"70");
  assert.equal(bio[28],"50");
  assert.match(bio[29],/wiiなので/);
  assert.equal(kingdom[9],"ステータス");
  assert.equal(kingdom[21],"6");
  assert.equal(kingdom[22],"日");
});

test("沿用共用 UI 入口、中文搜尋及原始 API 識別，沒有修改 app.js 的遊戲特例",()=>{
  assert.match(app,/from "\.\/retail-item-translations\.js"/);
  assert.doesNotMatch(app,/from "\.\/retail-game-translations\.js"/);
  assert.match(app,/const displayProductName=shopName==="自動販賣機"\?displayVendingName:displayRetailItemName/);
  assert.match(app,/displayRetailItemName\(item\.name\)\.toLocaleLowerCase\("zh-TW"\)\.includes\(search\)/);
  assert.match(app,/displayRetailItemCategory\(item\.category\)\.toLocaleLowerCase\("zh-TW"\)/);
  assert.match(app,/pendingRetailPurchase=\{shop:item\.shop,sku:item\.sku,quantity,payment/);
  assert.match(app,/submitLegacyUse\(item\.sourceLine,item\.name\)/);
  assert.match(app,/const duplicate=owned\.some\(x=>x\.name===item\.name\)/);
  assert.match(app,/if\(item\.category!==category\)/);
});
