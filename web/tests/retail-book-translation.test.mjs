import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog,retailItemDetails } from "../src/retail.mjs";
import { EQUIPMENT_ZH_TW } from "../public/item-translations.js";
import { RETAIL_BOOKS_ZH_TW,displayRetailBookName,displayRetailBookCategory } from "../public/retail-book-translations.js";
import { displayRetailItemName,displayRetailItemCategory } from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({line:i+1,fields:line.split("<>")}));
const books=rows.filter(x=>x.fields[0]==="書籍");
const STATS=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];

test("書籍 47 筆原始商品（45 種名稱）每列均有繁中譯名",()=>{
  assert.equal(books.length,47);
  assert.equal(Object.keys(RETAIL_BOOKS_ZH_TW).length,45);
  assert.deepEqual(books.map(x=>x.line),Array.from({length:47},(_,i)=>406+i));
  for(const {fields} of books){
    assert.ok(Object.hasOwn(RETAIL_BOOKS_ZH_TW,fields[1]),fields[1]);
    assert.equal(displayRetailBookName(fields[1]),RETAIL_BOOKS_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_BOOKS_ZH_TW[fields[1]]);
  }
  for(const name of Object.keys(RETAIL_BOOKS_ZH_TW))
    assert.ok(books.some(x=>x.fields[1]===name),"原版沒有這個商品名："+name);
  assert.equal(displayRetailBookCategory("書籍"),"書籍");
  assert.equal(displayRetailItemCategory("書籍"),"書籍");
  assert.equal(displayRetailItemName("未知書名"),"未知書名");
});

test("書籍同名的兩組商品保留不同 SKU／來源列，但使用相同譯名",()=>{
  const duplicates=new Map();
  for(const row of books)duplicates.set(row.fields[1],[...(duplicates.get(row.fields[1])??[]),row.line]);
  assert.deepEqual([...duplicates].filter(([_,lines])=>lines.length>1),[
    ["頭の体操",[413,444]],
    ["トリビアの泉ブックス",[422,445]]
  ]);
  assert.equal(displayRetailItemName("頭の体操"),"腦力體操");
  assert.equal(displayRetailItemName("トリビアの泉ブックス"),"冷知識之泉書系");
  assert.equal(RETAIL_BOOKS_ZH_TW["聖書"],EQUIPMENT_ZH_TW["聖書"]);
  assert.equal(displayRetailItemName("聖書"),"《聖經》");
});

test("書籍販售與使用仍依 CGI 原始資料，不把「万能,」解讀成確定療效",()=>{
  const catalog=parseLegacyRetailCatalog(raw).filter(item=>item.category==="書籍");
  assert.equal(catalog.length,47);
  assert.equal(new Set(catalog.map(x=>x.sku)).size,47);
  for(const item of catalog){
    const row=books.find(x=>x.line===item.originalLine);
    assert.ok(row,item.name);
    assert.equal(item.sku,"legacy-"+row.line);
    assert.equal(item.name,row.fields[1]);
    assert.equal(item.category,row.fields[0]);
    assert.equal(item.effect,row.fields[9]);
    assert.equal(item.rawFields[17],row.fields[17]);
    assert.equal(item.rawFields[21],row.fields[21]);
    assert.equal(item.rawFields[22],row.fields[22]);
    assert.deepEqual(STATS.map(i=>item.rawFields[i]),STATS.map(i=>row.fields[i]));
    assert.equal(retailItemDetails(item).effectCode,item.effect);
  }
  const original=name=>books.find(x=>x.fields[1]===name).fields;
  assert.equal(original("体重アップの秘訣")[9],"ウエイトアップ,1");
  assert.equal(original("無駄知識を覚える本")[9],"万能,");
  assert.equal(original("無駄知識を覚える本")[22],"日");
  assert.equal(original("こちら葛飾区亀有公園前派出所　全巻")[22],"日");
  assert.equal(original("全２４巻百科事典")[29],"※専門店限定商品。");
  assert.equal(original("HUNTER×HUNTER")[29].includes("富樫義博"),true);
  assert.equal(original("一志松本の滑らない話")[1],"一志松本の滑らない話");
});

test("已核對台灣版書名與原始拼字只影響顯示，不改識別",()=>{
  const cases={
    "ノルウェイの森":"挪威的森林",
    "バカの壁":"傻瓜的圍牆",
    "ワンピース":"航海王",
    "バガボンド":"浪人劍客",
    "バッテリー":"野球少年",
    "HUNTER×HUNTER":"獵人",
    "ハリー・ポッターと不死鳥の騎士団":"哈利波特：鳳凰會的密令",
    "ハリー・ポッターと死の秘宝":"哈利波特：死神的聖物",
    "一志松本の滑らない話":"松本人志的絕不冷場故事",
    "鉄拳作品集　こんな○○は××だ!　3":"鐵拳作品集：這樣的○○是××！第3集",
    "ニューズウイーク":"Newsweek",
    "フラワー":"Flower"
  };
  for(const [name,expected] of Object.entries(cases))
    assert.equal(displayRetailItemName(name),expected,name);
});
