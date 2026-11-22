import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyRetailCatalog,retailItemDetails} from "../src/retail.mjs";
import {RETAIL_DVD_ZH_TW,displayRetailDvdName,displayRetailDvdCategory} from "../public/retail-dvd-translations.js";
import {displayRetailItemName,displayRetailItemCategory} from "../public/retail-item-translations.js";

const raw=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const rows=raw.split(/\r?\n/).map((line,i)=>({line:i+1,fields:line.split("<>")}));
const source=rows.filter(x=>x.fields[0]==="DVD");

// 33 個來源鍵包含原版拼字（例如 KILL BIL、vo.1），絕不修成另一個 key。
test("DVD 分類 33 筆原始來源名稱都有台灣繁中顯示譯名",()=>{
  assert.equal(source.length,33);
  assert.equal(Object.keys(RETAIL_DVD_ZH_TW).length,33);
  assert.deepEqual(source.map(x=>x.line),Array.from({length:33},(_,i)=>114+i));
  for(const {fields} of source){
    assert.ok(Object.hasOwn(RETAIL_DVD_ZH_TW,fields[1]),"缺少譯名："+fields[1]);
    assert.equal(displayRetailDvdName(fields[1]),RETAIL_DVD_ZH_TW[fields[1]]);
    assert.equal(displayRetailItemName(fields[1]),RETAIL_DVD_ZH_TW[fields[1]]);
    assert.ok(RETAIL_DVD_ZH_TW[fields[1]].trim());
  }
  for(const key of Object.keys(RETAIL_DVD_ZH_TW))
    assert.ok(source.some(x=>x.fields[1]===key),"不存在的原版商品："+key);
  assert.equal(displayRetailDvdCategory("DVD"),"DVD");
  assert.equal(displayRetailItemCategory("DVD"),"DVD");
  assert.equal(displayRetailDvdName("未知DVD"),"未知DVD");
});

test("DVD 可販售的 33 件仍使用原始 SKU、能力欄、耐久和特殊備註",()=>{
  const catalog=parseLegacyRetailCatalog(raw).filter(x=>x.category==="DVD");
  assert.equal(catalog.length,33);
  assert.equal(new Set(catalog.map(x=>x.sku)).size,33);
  const statIndices=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];
  for(const item of catalog){
    const row=source.find(x=>x.line===item.originalLine);
    assert.ok(row,item.sku);
    assert.equal(item.sku,"legacy-"+row.line);
    assert.equal(item.name,row.fields[1]);
    assert.equal(item.category,"DVD");
    assert.equal(item.effect,"無");
    assert.equal(item.rawFields[22],"回");
    assert.equal(item.rawFields[17],row.fields[17]);
    assert.equal(item.rawFields[21],row.fields[21]);
    assert.deepEqual(statIndices.map(i=>item.rawFields[i]),statIndices.map(i=>row.fields[i]));
    assert.equal(retailItemDetails(item).effectCode,"無");
  }
  const find=name=>source.find(x=>x.fields[1]===name).fields;
  assert.equal(find("一人ごっつ")[29],"※専門店限定商品。");
  assert.equal(find("人生のゲームムービー")[29],"※専門店限定商品。");
  assert.equal(find("KILL BILL vo.1")[1],"KILL BILL vo.1");
  assert.equal(find("KILL BIL限定BOXセット")[1],"KILL BIL限定BOXセット");
});

test("日本電影與台灣熟悉的作品名採人工校對的繁中片名",()=>{
  const cases={
    "勝手にしやがれ":"斷了氣",
    "シャル・ウィ・ダンス":"談談情跳跳舞",
    "トリック":"圈套",
    "ピンポン":"乒乓",
    "死霊のはらわた":"屍變",
    "キューブ":"異次元殺陣",
    "リベリオン":"重裝任務",
    "ハリー・ポッターと賢者の石":"哈利波特：神秘的魔法石",
    "スキージャンプ・ペア　オフィシャル":"雙人跳台滑雪 官方版"
  };
  for(const [original,localized] of Object.entries(cases))
    assert.equal(displayRetailItemName(original),localized,original);
});
