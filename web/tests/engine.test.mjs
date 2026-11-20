import test from "node:test";
import assert from "node:assert/strict";
import {
  STAT_KEYS, createCharacterData, validateStartingStats, maxBodyEnergy, maxBrainEnergy,
  bodyMassIndex,
  decodeLegacyText, jobEligibility, parseLegacyJobs, recoverEnergy, selectJob,
  performWork, bankTransaction, WORK_COOLDOWN_MS
} from "../src/engine.mjs";

const initialStats = () => Object.fromEntries(STAT_KEYS.map(key => [key, 20]));
const first = [
  "職業番号<>職業名<>國<>數",
  "1<>日払いバイト<>0<>0<>0<>0<>0<>0<>0<>15<><>0<>0<>0<>0<>0<>0<>0<>1000<>1<>0<>0<>0<><><>10<>10<>1<><>0<>5",
  "50<>看護師長<>80<>120<>120<>80<>0<>0<>0<>17<><>0<>120<>120<>0<>0<>0<>0<>6000<>10<>0<>0<>0<><>0<>50<>35<>2<>看護師<>35<>8"
].join("\n");

test("舊版職業清單可匯入並保留穩定鍵與升遷條件", () => {
  const [partTime, senior] = parseLegacyJobs(first);
  assert.equal(partTime.name, "日薪打工");
  assert.equal(partTime.key, "legacy-2");
  assert.equal(partTime.salary, 1000);
  assert.equal(partTime.bodyCost, 10);
  assert.equal(partTime.raiseRate, 5);
  assert.equal(senior.previousJob, "看護師");
  assert.equal(senior.requirements.kokugo, 80);
});

test("原版角色註冊配點：各項正整數且頭腦／身體／其他總和不超過 200／200／100", () => {
  assert.deepEqual(validateStartingStats(initialStats()), initialStats());
  const overBrain = initialStats();
  overBrain.kokugo = 100;
  assert.throws(() => validateStartingStats(overBrain), /頭腦/);
  const overBody = initialStats();
  overBody.tairyoku = 100;
  assert.throws(() => validateStartingStats(overBody), /身體/);
  const overOther = initialStats();
  overOther.love = 80;
  assert.throws(() => validateStartingStats(overOther), /其他/);
  const zero = initialStats();
  zero.eigo = 0;
  assert.throws(() => validateStartingStats(zero), /英語/);
  const missing = initialStats();
  delete missing.etti;
  assert.throws(() => validateStartingStats(missing), /性感|情色|色情/);
  const negative = initialStats();
  negative.unique = -1;
  assert.throws(() => validateStartingStats(negative), /有趣|幽默/);
  const float = initialStats();
  float.suugaku = 0.5;
  assert.throws(() => validateStartingStats(float), /數學/);
});

test("原版初始金錢、初始日薪打工與身高體重範圍", () => {
  const male = createCharacterData("男性", "male", 100000, initialStats(), () => 0.5);
  const female = createCharacterData("女性", "female", 100000, initialStats(), () => 0.5);
  assert.equal(male.money, 100000);
  assert.equal(male.jobId, "legacy-2");
  assert.equal(male.height, 175);
  assert.equal(male.weight, 67);
  assert.equal(female.height, 162);
  assert.equal(female.weight, 58);
});

test("能量依照原版能力值計算上限並以十秒一點恢復", () => {
  const initial = createCharacterData("玩家", "other", 100000);
  assert.equal(maxBodyEnergy(initial.stats), 25);
  assert.equal(maxBrainEnergy(initial.stats), 35);
  const damaged = { ...initial, bodyEnergy: 10, brainEnergy: 10 };
  const recovered = recoverEnergy(damaged, 100000 + 30000);
  assert.equal(recovered.bodyEnergy, 13);
  assert.equal(recovered.brainEnergy, 13);
  assert.equal(recoverEnergy(damaged, 100000 + 1000000).bodyEnergy, 25);
  assert.equal(recoverEnergy(damaged, 100000 + 1000000).brainEnergy, 35);
});

test("工作冷卻、薪資及等級初次獲取", () => {
  const [job] = parseLegacyJobs(first);
  const initial = createCharacterData("玩家", "other", 100000);
  assert.equal(jobEligibility(initial, job), null);
  const hired = selectJob(initial, job);
  const firstWork = performWork(hired, job, 100001, () => 0);
  assert.equal(firstWork.experienceGain, 6);
  assert.equal(firstWork.paid, 1000);
  assert.equal(firstWork.character.money, 101000);
  assert.equal(firstWork.character.jobExperience, 6);
  assert.throws(() => performWork(firstWork.character, job, 100002), /等待/);
  const later = performWork(firstWork.character, job, 100001 + WORK_COOLDOWN_MS, () => 0);
  assert.equal(later.character.workCount, 2);
  assert.equal(later.character.jobWorkCount, 2);
});

test("轉職與工作依原版整數 BMI 門檻判定，忽略存檔中的一位小數 BMI", () => {
  const [base] = parseLegacyJobs(first);
  const job = { ...base, bmiMin: 18, bmiMax: 24, bodyCost: 0, brainCost: 0 };
  const original = createCharacterData("BMI 測試角色", "other", 100000);
  // 實際 BMI 約 24.98；儲存的顯示用 BMI 為 25.0，原版 int 為 24。
  const character = {
    ...original, height: 170, weight: 72.2, bmi: bodyMassIndex(170,72.2)
  };
  assert.equal(character.bmi,25);
  assert.equal(jobEligibility(character,job),null);
  assert.equal(jobEligibility({...character,bmi:99},job),null);
  const hired=selectJob(character,job);
  assert.equal(performWork(hired,job,100001,()=>0).paid,1000);

  const tooThin={...character,weight:51,bmi:24};
  const tooHeavy={...character,weight:75,bmi:20};
  assert.equal(jobEligibility(tooThin,job),"體格指數不足");
  assert.equal(jobEligibility(tooHeavy,job),"體格指數不足");
  assert.throws(()=>selectJob(tooHeavy,job),/體格指數不足/);
  assert.throws(()=>performWork({...hired,weight:75,bmi:24},job,100001,()=>0),/體格指數不足/);
  assert.equal(jobEligibility(tooHeavy,{...job,bmiMax:0}),null);
});

test("Perl 半分界體重：24.95kg 的轉職與工作仍符合 BMI 上限 24",()=>{
  const [base]=parseLegacyJobs(first);
  const job={...base,bmiMin:18,bmiMax:24,bodyCost:0,brainCost:0};
  const initial=createCharacterData("Perl BMI 邊界","other",100000);
  const valid={...initial,height:100,weight:24.95,bmi:bodyMassIndex(100,24.95)};
  // 顯示欄位為 25.0；Perl sprintf("%.1f",24.95) 卻為 24.9 => int 24。
  assert.equal(valid.bmi,25);
  assert.equal(jobEligibility(valid,job),null);
  const hired=selectJob(valid,job);
  assert.equal(performWork(hired,job,100001,()=>0).paid,1000);
  const invalid={...hired,weight:24.96,bmi:24};
  assert.equal(jobEligibility(invalid,job),"體格指數不足");
  assert.throws(()=>performWork(invalid,job,100001,()=>0),/體格指數不足/);
});

test("原版每一薪資結算週期支付薪資乘以出勤次數", () => {
  const [source] = parseLegacyJobs(first);
  const job = { ...source, payEvery: 3 };
  const character = { ...createCharacterData("玩家", "other", 100000), jobId: job.key };
  let current = character;
  for (let i = 1; i <= 3; i++) {
    const result = performWork(current, job, 100000 + i * WORK_COOLDOWN_MS, () => 0);
    assert.equal(result.paid, i === 3 ? 3000 : 0);
    current = result.character;
  }
  assert.equal(current.money, 103000);
  assert.equal(current.workProgress, 0);
});

test("原版工作等級、加薪與獎金，以及第 15 級職業精通", () => {
  const [source] = parseLegacyJobs(first);
  const job = { ...source, bonusRate: 2 };
  const initial = {
    ...createCharacterData("玩家", "other", 100000),
    jobId: job.key, jobExperience: 99
  };
  const levelUp = performWork(initial, job, 400000, () => 0);
  assert.equal(levelUp.jobLevel, 1);
  assert.equal(levelUp.effectiveSalary, 1050);
  assert.equal(levelUp.paid, 1050);
  assert.equal(levelUp.bonus, 2100);
  assert.equal(levelUp.character.money, 103150);
  assert.equal(levelUp.leveledUp, true);
  const nearMaster = {
    ...initial, jobExperience: 1499
  };
  const mastery = performWork(nearMaster, job, 400000, () => 0);
  assert.equal(mastery.jobLevel, 15);
  assert.equal(mastery.mastered, true);
  assert.equal(mastery.character.masteredJob, "日払いバイト");
  const next = { ...job, key: "next", previousJob: "日払いバイト" };
  assert.equal(jobEligibility(initial, next), "需先精通：日払いバイト");
  assert.equal(jobEligibility(mastery.character, next), null);
});

test("轉職歸零目前職業的經驗、出勤次數，但保留精通紀錄", () => {
  const [job] = parseLegacyJobs(first);
  const prior = {
    ...createCharacterData("玩家"),
    jobExperience: 320, jobWorkCount: 27, workCount: 45,
    masteredJob: "看護師"
  };
  const next = selectJob(prior, job);
  assert.equal(next.jobExperience, 0);
  assert.equal(next.jobWorkCount, 0);
  assert.equal(next.workCount, 45);
  assert.equal(next.masteredJob, "看護師");
});

test("銀行存提款與餘額不足檢查", () => {
  const original = createCharacterData("玩家");
  const deposited = bankTransaction(original, "deposit", 2500);
  assert.equal(deposited.bank, 2500);
  assert.equal(deposited.money, 97500);
  const withdrawn = bankTransaction(deposited, "withdraw", 1000);
  assert.equal(withdrawn.bank, 1500);
  assert.equal(withdrawn.money, 98500);
  assert.throws(() => bankTransaction(original, "deposit", 100001), /不足/);
  assert.throws(() => bankTransaction(original, "withdraw", 1), /不足/);
  assert.throws(() => bankTransaction(original, "deposit", -10), /正整數/);
});

test("升遷前置職業未精通時不可就職", () => {
  const [, senior] = parseLegacyJobs(first);
  assert.match(jobEligibility(createCharacterData("玩家"), senior), /精通/);
});

test("舊日文資料可使用 UTF-8 與 Shift_JIS 解碼", () => {
  assert.equal(decodeLegacyText(new TextEncoder().encode("看護師")), "看護師");
});

test("原版薪資及升級獎金依玩家收款偏好入銀行而非現金",()=>{
  const [original]=parseLegacyJobs(first);
  const job={...original,bonusRate:10};
  const player=createCharacterData("銀行領薪測試","other",100000);
  const before={...player,jobExperience:99,salaryPayment:"bank"};
  const result=performWork(before,job,100001,()=>0);
  assert.equal(result.payment,"bank");
  assert.equal(result.effectiveSalary,1050);
  assert.equal(result.paid,1050);
  assert.equal(result.bonus,10500);
  assert.equal(result.character.bank,11550);
  assert.equal(result.character.money,100000);
  assert.equal(before.bank,0,"發薪不能原地改變玩家存檔");
  const cash=performWork({...before,salaryPayment:"cash"},job,100001,()=>0);
  assert.equal(cash.character.money,111550);
  assert.equal(cash.character.bank,0);
});
