import test from "node:test";
import assert from "node:assert/strict";
import {createCharacterData,performWork,maxBodyEnergy,maxBrainEnergy} from "../src/engine.mjs";
import {
  DEFAULT_HEALTH_INDEX,TREATMENT_COSTS,diseaseFromIndex,healthIndexDelta,
  healthStatus,settleDailyHealth,conditionWithIllness,getTreatmentQuote,treatAtHospital
} from "../src/health.mjs";
import {deriveCondition} from "../src/dining.mjs";

const NOW=1_700_000_000_000;
const fresh=()=>createCharacterData("醫療測試","other",NOW);

test("疾病門檻依原版比較運算子，包含臨界值與不同嚴重程度",()=>{
  const cases=[
    [50,"healthy"],[0,"healthy"],[-1,"slightCold"],[-10,"slightCold"],
    [-11,"cold"],[-15,"cold"],[-16,"diarrhea"],[-20,"diarrhea"],
    [-21,"pneumonia"],[-40,"pneumonia"],[-41,"tuberculosis"],
    [-70,"tuberculosis"],[-71,"brainTumor"],[-100,"brainTumor"],
    [-101,"cancer"]
  ];
  for(const [index,key] of cases) assert.equal(diseaseFromIndex(index).key,key,index+" 指數");
  assert.throws(()=>diseaseFromIndex(0.5),/疾病指數/);
  assert.equal(healthStatus(fresh()).index,DEFAULT_HEALTH_INDEX);
  assert.equal(healthStatus(fresh()).lastSettledDay,"");
});

test("醫院依原版各病名收費，腦瘤採畫面標示的 64000 元",()=>{
  assert.deepEqual(TREATMENT_COSTS,{
    healthy:10000,slightCold:18000,cold:28000,diarrhea:32000,
    pneumonia:35000,tuberculosis:48000,brainTumor:64000,cancer:88000
  });
  for(const [index,key] of [
    [50,"healthy"],[-1,"slightCold"],[-11,"cold"],[-16,"diarrhea"],
    [-21,"pneumonia"],[-41,"tuberculosis"],[-71,"brainTumor"],[-101,"cancer"]
  ]) {
    const q=getTreatmentQuote({...fresh(),healthIndex:index});
    assert.equal(q.disease.key,key);
    assert.equal(q.price,TREATMENT_COSTS[key]);
    assert.equal(getTreatmentQuote({...fresh(),healthIndex:index},true).price,
      Math.floor(TREATMENT_COSTS[key]/3));
    assert.equal(q.hasInsurance,false);
  }
  assert.throws(()=>getTreatmentQuote(fresh(),"yes"),/保險/);
});

test("醫院扣除現金並回復疾病指數 50，不可欠款、不改銀行或能力",()=>{
  const base={...fresh(),healthIndex:-71,bank:10000000};
  const cured=treatAtHospital(base,NOW+5000);
  assert.equal(cured.previousDisease,"腦瘤");
  assert.equal(cured.paid,64000);
  assert.equal(cured.character.healthIndex,50);
  assert.equal(cured.character.money,36000);
  assert.equal(cured.character.bank,10000000);
  assert.deepEqual(cured.character.stats,base.stats);
  assert.equal(base.healthIndex,-71);
  assert.throws(()=>treatAtHospital({...base,money:63999}),/現金不足/);
  assert.equal(treatAtHospital({...fresh(),healthIndex:50}).paid,10000);
});

test("疾病指數增減依原版，包含不良狀態減去負一的既存計算",()=>{
  assert.deepEqual(["excellent","good","normal","poor","bad","worst"].map(
    healthIndexDelta),[2,1,0,1,-3,0]);
  const c=fresh(),mb=maxBodyEnergy(c.stats),mn=maxBrainEnergy(c.stats);
  const legacy=settleDailyHealth(c,"2026-11-18",mb,mn,NOW);
  assert.equal(legacy.applied,false);
  assert.equal(legacy.character.healthIndex,50);
  const first={...legacy.character,lastMealAt:NOW-2*3600000};
  const next=settleDailyHealth(first,"2026-11-19",mb,mn,NOW);
  assert.equal(next.applied,true);
  assert.equal(next.delta,2);
  assert.equal(next.character.healthIndex,52);
  const repeat=settleDailyHealth(next.character,"2026-11-19",mb,mn,NOW);
  assert.equal(repeat.applied,false);
  assert.equal(repeat.character.healthIndex,52);
  const absent=settleDailyHealth({...next.character,lastMealAt:0},
    "2026-11-20",mb,mn,NOW);
  assert.equal(absent.applied,false);
  assert.equal(absent.character.healthIndex,52);
  assert.equal(absent.character.lastHealthDay,"2026-11-20");
  assert.equal(settleDailyHealth(absent.character,"2026-11-19",mb,mn,NOW).applied,false);
  assert.throws(()=>settleDailyHealth(c,"wrong",mb,mn,NOW),/日期/);
});

test("一般身體狀態會被疾病覆蓋，普通感冒減少工作經驗、嚴重疾病禁止工作",()=>{
  const base={...fresh(),lastMealAt:NOW-2*3600000};
  const condition=deriveCondition(base,maxBodyEnergy(base.stats),
    maxBrainEnergy(base.stats),NOW);
  assert.equal(conditionWithIllness(condition,base),condition);
  assert.equal(conditionWithIllness(condition,{...base,healthIndex:-13}).baseExperience,-14);
  assert.equal(conditionWithIllness(condition,{...base,healthIndex:-21}).baseExperience,-20);
  assert.equal(conditionWithIllness(condition,{...base,healthIndex:-41}).baseExperience,null);
  const job={
    key:"legacy-2",originalName:"臨時工",salary:1000,payEvery:1,
    previousJob:null,gender:null,bmiMin:0,bmiMax:0,minHeight:0,
    bodyCost:10,brainCost:0,bonusRate:0,raiseRate:0,
    requirements:Object.fromEntries(Object.keys(base.stats).map(key=>[key,0]))
  };
  const sick={...base,healthIndex:-13,jobExperience:50};
  const work=performWork(sick,job,NOW+1,()=>0);
  assert.equal(work.experienceGain,-13);
  assert.equal(work.character.jobExperience,37);
  assert.equal(work.condition,"感冒");
  assert.throws(()=>performWork({...base,healthIndex:-41},job,NOW+1,()=>0),/疾病/);
  const recovered=treatAtHospital({...base,healthIndex:-13},NOW).character;
  assert.equal(performWork(recovered,job,NOW+1,()=>0).condition,"最佳");
});
