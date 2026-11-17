import test from "node:test";
import assert from "node:assert/strict";
import {
  createCharacterData, decodeLegacyText, jobEligibility, parseLegacyJobs,
  recoverEnergy, selectJob, performWork, WORK_COOLDOWN_MS
} from "../src/engine.mjs";

const first = [
  "職業番号<>職業名<>國<>數",
  "1<>日払いバイト<>0<>0<>0<>0<>0<>0<>0<>15<><>0<>0<>0<>0<>0<>0<>0<>1000<>1<>0<>0<>0<><><>10<>10<>1<><>0<>5",
  "50<>看護師長<>80<>120<>120<>80<>0<>0<>0<>17<><>0<>120<>120<>0<>0<>0<>0<>6000<>10<>0<>0<>0<><>0<>50<>35<>2<>看護師<>35<>8"
].join("\n");

test("舊版職業清單可匯入並保留穩定鍵", () => {
  const [partTime, senior] = parseLegacyJobs(first);
  assert.equal(partTime.name, "日薪打工");
  assert.equal(partTime.key, "legacy-2");
  assert.equal(partTime.salary, 1000);
  assert.equal(partTime.bodyCost, 10);
  assert.equal(senior.previousJob, "看護師");
  assert.equal(senior.requirements.kokugo, 80);
});

test("能量依伺服器時間恢復，但不超出上限", () => {
  const initial = createCharacterData("玩家", "other", 100000);
  const damaged = { ...initial, bodyEnergy: 75, brainEnergy: 95 };
  const recovered = recoverEnergy(damaged, 100000 + 30000);
  assert.equal(recovered.bodyEnergy, 78);
  assert.equal(recovered.brainEnergy, 98);
  assert.equal(recoverEnergy(damaged, 100000 + 1000000).bodyEnergy, 100);
});

test("工作需有職業，且受到冷卻與能量限制", () => {
  const [job] = parseLegacyJobs(first);
  const initial = createCharacterData("玩家", "other", 100000);
  assert.equal(jobEligibility(initial, job), null);
  const hired = selectJob(initial, job);
  const firstWork = performWork(hired, job, 100001);
  assert.equal(firstWork.paid, 1000);
  assert.equal(firstWork.character.money, 11000);
  assert.throws(() => performWork(firstWork.character, job, 100002), /等待/);
  const later = performWork(firstWork.character, job, 100001 + WORK_COOLDOWN_MS);
  assert.equal(later.character.workCount, 2);
});

test("未移植的升職條件不能被繞過", () => {
  const [, senior] = parseLegacyJobs(first);
  assert.match(jobEligibility(createCharacterData("玩家"), senior), /精通/);
});

test("舊日文資料可使用 UTF-8 或 Shift_JIS 解碼", () => {
  assert.equal(decodeLegacyText(new TextEncoder().encode("看護師")), "看護師");
});
