import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyMeals } from "../src/dining.mjs";
import { MEAL_ZH_TW } from "../src/i18n/meals.zh-TW.mjs";

const mainSource=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
const secondSource=decodeLegacyText(readFileSync(new URL("../../dat_dir/syokudou2.cgi",import.meta.url)));

test("兩間食堂 34 + 35 道原版餐點均顯示繁體中文，原始名稱與鍵不變",()=>{
  const main=parseLegacyMeals(mainSource,"main");
  const second=parseLegacyMeals(secondSource,"second");
  assert.equal(main.length,34);
  assert.equal(second.length,35);
  const baseNames=new Set([...main,...second].map(item=>item.originalName.replace(/2$/,"")));
  assert.equal(baseNames.size,35);
  for(const item of [...main,...second]){
    const base=item.originalName.replace(/2$/,"");
    assert.ok(Object.hasOwn(MEAL_ZH_TW,base),base);
    assert.equal(item.name,MEAL_ZH_TW[base]);
    assert.ok(item.name.trim());
    assert.ok(item.key.startsWith("meal-"+item.menu+"-"));
    assert.equal(item.originalName,base+(item.menu==="second"?"2":""));
  }
});

test("既有翻譯保留，特殊食物名稱翻譯不牽涉用餐判定",()=>{
  assert.equal(MEAL_ZH_TW["牛丼"],"牛肉蓋飯");
  assert.equal(MEAL_ZH_TW["カツ丼"],"炸豬排蓋飯");
  assert.equal(MEAL_ZH_TW["とろろご飯"],"山藥泥飯");
  assert.equal(MEAL_ZH_TW["ハッピーターン"],"Happy Turn米果");
  assert.equal(MEAL_ZH_TW["ブラジャーランチ"],"胸罩午餐");
  const [sample]=parseLegacyMeals(secondSource,"second");
  assert.equal(sample.originalName,"牛丼2");
  assert.equal(sample.name,"牛肉蓋飯");
});

test("未收錄的新餐點回退原文，避免將來源名稱改成翻譯後的資料鍵",()=>{
  const source=mainSource.split(/\r?\n/);
  const original=source.find(x=>x.startsWith("食<>牛丼<>"));
  const replacement=original.replace("食<>牛丼<>","食<>未知餐點<>");
  const meal=parseLegacyMeals(source[0]+"\n"+replacement,"main")[0];
  assert.equal(meal.originalName,"未知餐點");
  assert.equal(meal.name,"未知餐點");
  assert.equal(meal.key,"meal-main-2");
});
