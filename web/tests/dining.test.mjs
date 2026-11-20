import test from "node:test";
import assert from "node:assert/strict";
import { createCharacterData,performWork,maxBodyEnergy,maxBrainEnergy } from "../src/engine.mjs";
import {
  parseLegacyMeals,hungerStatus,legacyPhysiqueBmi,physiqueStatus,deriveCondition,
  eatMeal,MEAL_COOLDOWN_MS
} from "../src/dining.mjs";

function mealRow(category="食",name="牛丼",price=200,calories=720){
  const f=Array(33).fill("0");
  f[0]=category;
  f[1]=name;
  f[9]="無";
  f[11]="2";f[12]="1";f[14]="1";f[15]="1";f[16]="1";
  f[17]=String(price);f[25]=String(calories);
  return f.join("<>")+"<>";
}
const input="種類<>品目<>\n"+mealRow()+"\n"+mealRow("商店","其他")+" \n";
const NOW=1_700_000_000_000;
const plain=()=>createCharacterData("食堂測試","other",NOW);

test("原版食堂商品資料只取食品，售價三倍，能力值與熱量照原欄位",()=>{
  const menu=parseLegacyMeals(input,"main");
  assert.equal(menu.length,1);
  assert.equal(menu[0].key,"meal-main-2");
  assert.equal(menu[0].originalName,"牛丼");
  assert.equal(menu[0].name,"牛肉蓋飯");
  assert.equal(menu[0].price,600);
  assert.equal(menu[0].calories,720);
  assert.equal(menu[0].gains.tairyoku,2);
  assert.equal(menu[0].gains.kenkou,1);
  assert.equal(menu[0].gains.power,1);
  assert.equal(menu[0].gains.kokugo,0);
  assert.equal(parseLegacyMeals(input.replace("牛丼","牛丼2"),"second")[0].key,"meal-second-2");
  assert.throws(()=>parseLegacyMeals("HEADER\n食<>牛丼<>bad","main"),/缺漏/);
  assert.throws(()=>parseLegacyMeals(input,"third"),/菜單/);
});

test("原版飽足度時間門檻及首次舊角色沒有用餐記錄的相容性",()=>{
  const t=NOW,h=3600000;
  assert.equal(MEAL_COOLDOWN_MS,h);
  assert.equal(hungerStatus(0,t).key,"untracked");
  assert.equal(hungerStatus(0,t).canEat,true);
  for(const [seconds,key] of [
    [0,"full"],[3599,"full"],[3600,"comfortable"],
    [10799,"comfortable"],[10800,"slightlyHungry"],
    [46799,"slightlyHungry"],[46800,"hungry"],
    [90000,"veryHungry"],[176400,"starving"],
    [349200,"dangerous"],[(1+24*2995)*3600,"critical"]
  ]){
    assert.equal(hungerStatus(t,t+seconds*1000).key,key,seconds+" 秒");
  }
  assert.equal(hungerStatus(t,t+3600000).canEat,true);
  assert.equal(hungerStatus(t,t+1000).canEat,false);
});

test("原版 BMI 整數分段，健康及精力與飽足一起構成角色工作狀態",()=>{
  const height=170;
  assert.equal(physiqueStatus(height,49).key,"veryUnderweight");
  assert.equal(physiqueStatus(height,53).key,"underweight");
  assert.equal(physiqueStatus(height,61).key,"normal");
  assert.equal(physiqueStatus(height,70).key,"overweight");
  assert.equal(physiqueStatus(height,76).key,"obese");
  const c=plain();
  const maxBody=maxBodyEnergy(c.stats),maxBrain=maxBrainEnergy(c.stats);
  assert.equal(deriveCondition(c,maxBody,maxBrain,NOW).baseExperience,5);
  const full=deriveCondition({...c,lastMealAt:NOW},maxBody,maxBrain,NOW);
  assert.equal(full.key,"good");
  assert.equal(full.baseExperience,10);
  const comfortable=deriveCondition({...c,lastMealAt:NOW-3600000},maxBody,maxBrain,NOW);
  assert.equal(comfortable.key,"excellent");
  assert.equal(comfortable.baseExperience,15);
  const extremelyWeak=deriveCondition({...c,lastMealAt:NOW-30*86400000,
    bodyEnergy:0,brainEnergy:0},maxBody,maxBrain,NOW);
  assert.equal(extremelyWeak.key,"worst");
  assert.equal(extremelyWeak.baseExperience,null);
});


test("原版 BMI 先將體重四捨五入至 0.1kg，再取整數分類",()=>{
  // 原 CGI 的 basic.cgi::job_change/do_work 先 sprintf("%.1f", $taijuu)，
  // town_lib.pl::check_BMI 隨後以 int 取得 BMI。
  assert.equal(legacyPhysiqueBmi(100,17.94),17);
  assert.equal(legacyPhysiqueBmi(100,17.96),18);
  assert.equal(legacyPhysiqueBmi(100,24.94),24);
  assert.equal(legacyPhysiqueBmi(100,24.96),25);
  assert.equal(legacyPhysiqueBmi(100,25.96),26);
  assert.equal(physiqueStatus(100,17.96).key,"underweight");
  assert.equal(physiqueStatus(100,25.96).key,"obese");
  assert.throws(()=>legacyPhysiqueBmi(0,70),/身高體重/);
  assert.throws(()=>legacyPhysiqueBmi(170,-1),/身高體重/);
});

test("原版 Perl sprintf 四捨五入與半偶數捨入：BMI 18、24、26 邊界不可錯判",()=>{
  // 參照原版 basic.cgi::job_change/do_work 的 sprintf("%.1f")，
  // 在 Perl 5 / IEEE-754 以數字參數格式化的實際結果：
  // 17.95 => 17.9；24.95 => 24.9；25.95 => 25.9。
  assert.equal(legacyPhysiqueBmi(100,17.95),17);
  assert.equal(legacyPhysiqueBmi(100,18.05),18);
  assert.equal(legacyPhysiqueBmi(100,24.95),24);
  assert.equal(legacyPhysiqueBmi(100,25.95),25);
  assert.equal(legacyPhysiqueBmi(100,25.96),26);
  assert.equal(physiqueStatus(100,17.95).key,"veryUnderweight");
  assert.equal(physiqueStatus(100,24.95).key,"overweight");
  assert.equal(physiqueStatus(100,25.95).key,"overweight");
  assert.equal(physiqueStatus(100,25.96).key,"obese");
  // 50.25 是可精確表示的二進位中點：Perl sprintf => 50.2，非 50.3。
  assert.equal(legacyPhysiqueBmi(50,50.25),200);
  assert.equal(legacyPhysiqueBmi(50,50.75),203);
});

test("用餐扣現金、增加指定能力和體重，冷卻期間不可再次用餐",()=>{
  const meal=parseLegacyMeals(input)[0],char=plain();
  const eaten=eatMeal(char,meal,NOW);
  assert.equal(eaten.meal,"牛肉蓋飯");
  assert.equal(eaten.paid,600);
  assert.equal(eaten.weightGain,0.72);
  assert.equal(eaten.character.money,99400);
  assert.equal(eaten.character.weight,60.72);
  assert.equal(eaten.character.lastMealAt,NOW);
  assert.equal(eaten.character.stats.tairyoku,char.stats.tairyoku+2);
  assert.equal(eaten.character.stats.kenkou,char.stats.kenkou+1);
  assert.equal(char.stats.tairyoku,20);
  assert.throws(()=>eatMeal(eaten.character,meal,NOW+2000),/60 分鐘/);
  assert.equal(eatMeal(eaten.character,meal,NOW+MEAL_COOLDOWN_MS).character.money,98800);
  assert.throws(()=>eatMeal({...char,money:100},meal,NOW),/現金不足/);
});

test("用餐後狀態影響工作經驗值，而未記錄用餐的舊角色保留普通狀態",()=>{
  const meal=parseLegacyMeals(input)[0],char=plain();
  const job={
    key:"legacy-2",originalName:"臨時工",salary:1000,payEvery:1,
    previousJob:null,gender:null,bmiMin:0,bmiMax:0,minHeight:0,
    bodyCost:10,brainCost:0,bonusRate:0,raiseRate:0,
    requirements:Object.fromEntries(Object.keys(char.stats).map(key=>[key,0]))
  };
  assert.equal(performWork(char,job,NOW+1,()=>0).experienceGain,6);
  const afterMeal=eatMeal(char,meal,NOW).character;
  const worked=performWork(afterMeal,job,NOW+1,()=>0);
  assert.equal(worked.condition,"良好");
  assert.equal(worked.experienceGain,11);
  assert.equal(worked.character.lastMealAt,NOW);
  const depleted={...afterMeal,bodyEnergy:0,brainEnergy:0,
    lastMealAt:NOW-1000,recoveredAt:NOW+1};
  assert.throws(()=>performWork(depleted,job,NOW+1,()=>0),/能量不足/);
});

test("餐點資料格式及價錢不能用負數、超過安全範圍或錯誤欄位偽造",()=>{
  const meal=parseLegacyMeals(input)[0],c=plain();
  assert.throws(()=>parseLegacyMeals(input.replace("<>200<>","<>-200<>")),/非負整數/);
  assert.throws(()=>eatMeal(c,{...meal,gains:{kenkou:-1}},NOW),/不正確/);
  assert.throws(()=>eatMeal(c,{...meal,gains:{unknown:1}},NOW),/不正確/);
  assert.throws(()=>eatMeal(c,{...meal,price:Number.MAX_SAFE_INTEGER+1},NOW),/無效/);
  assert.throws(()=>hungerStatus(-1,NOW),/用餐時間/);
});
