import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCharacterData, decodeLegacyText } from "../src/engine.mjs";
import {
  parseLegacySchool, parseLegacyGym, parseLegacyClassroom, calendarDay,
  trainingAvailability, performTraining
} from "../src/training.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readLegacy = path => decodeLegacyText(readFileSync(resolve(root, "dat_dir", path)));
const schools = parseLegacySchool(readLegacy("school.cgi"));
const gyms = parseLegacyGym(readLegacy("gym.cgi"));
const classrooms = parseLegacyClassroom(readLegacy("kyushitu.cgi"));

test("原始學校與健身房清單全部解析並保留識別碼及繁體中文名稱", () => {
  assert.equal(schools.length, 6);
  assert.equal(gyms.length, 9);
  assert.equal(schools[0].key, "school-2");
  assert.equal(schools[0].originalName, "英会話講座");
  assert.equal(schools[0].name, "英語會話課程");
  assert.equal(schools[0].price, 16000);
  assert.equal(schools[0].energyCost, 16);
  assert.equal(schools[0].gains.eigo, 10);
  assert.equal(gyms[1].name, "健走");
  assert.equal(gyms[1].price, 800);
  assert.equal(gyms[1].energyCost, 8);
  assert.equal(gyms[1].cooldownMs, 15 * 60 * 1000);
  assert.equal(gyms[1].gains.tairyoku, 2);
});

test("課程消耗現金與頭腦能量，依原始資料增加能力", () => {
  const now = Date.UTC(2026, 10, 18, 5);
  const player = createCharacterData("學生", "other", now);
  const beforeBrain = player.brainEnergy;
  const result = performTraining(player, schools[0], now, "2026-11-18");
  assert.equal(result.paid, 16000);
  assert.equal(result.character.money, 84000);
  assert.equal(result.character.brainEnergy, beforeBrain - 16);
  assert.equal(result.character.stats.eigo, player.stats.eigo + 10);
  assert.equal(result.character.stats.kokugo, player.stats.kokugo + 1);
  assert.equal(result.character.lastSchoolDay, "2026-11-18");
  assert.equal(player.money, 100000);
});

test("同一天只能上一堂課，隔日可恢復上課", () => {
  const now = Date.UTC(2026, 10, 18, 5);
  const player = createCharacterData("學生", "other", now);
  const done = performTraining(player, schools[0], now, "2026-11-18").character;
  assert.match(trainingAvailability(done, schools[1], now + 60_000, "2026-11-18"), /今日已經/);
  assert.throws(() => performTraining(done, schools[1], now + 60_000, "2026-11-18"), /今日已經/);
  const nextDay = now + 24 * 60 * 60 * 1000;
  assert.equal(trainingAvailability(done, schools[1], nextDay, "2026-11-19"), null);
  assert.equal(performTraining(done, schools[1], nextDay, "2026-11-19").character.lastSchoolDay, "2026-11-19");
});

test("健身房冷卻使用已完成的訓練間隔，不能換課程繞過", () => {
  const now = Date.UTC(2026, 10, 18, 5);
  const player = createCharacterData("居民", "other", now);
  const walk = gyms.find(g => g.originalName === "ウォーキング");
  const swim = gyms.find(g => g.originalName === "スイミング");
  const completed = performTraining(player, walk, now, "2026-11-18").character;
  assert.equal(completed.money, 99200);
  assert.equal(completed.stats.kenkou, player.stats.kenkou + 3);
  assert.equal(completed.bodyEnergy, player.bodyEnergy - 8);
  assert.equal(completed.gymReadyAt, now + 15 * 60 * 1000);
  assert.match(trainingAvailability(completed, swim, now + 60_000, "2026-11-18"), /健身房還需要/);
  assert.equal(trainingAvailability(completed, swim, now + 15 * 60 * 1000, "2026-11-18"), null);
});

test("不允許餘額不足、能量不足、無效訓練與不合法舊資料", () => {
  const now = Date.UTC(2026, 10, 18, 5);
  const p = createCharacterData("居民", "other", now);
  const poor = { ...p, money: 0 };
  assert.match(trainingAvailability(poor, schools[0], now, "2026-11-18"), /現金不足/);
  assert.throws(() => performTraining(poor, schools[0], now, "2026-11-18"), /現金不足/);
  const tired = { ...p, brainEnergy: 0 };
  assert.match(trainingAvailability(tired, schools[0], now, "2026-11-18"), /頭腦能量不足/);
  assert.match(trainingAvailability(p, null, now, "2026-11-18"), /找不到訓練/);
  assert.throws(() => parseLegacySchool("header\n異常課程<>-1<>0<>0"), /無效/);
});

test("日界線依指定世界時區判定，不依玩家瀏覽器時區", () => {
  const at = Date.UTC(2026, 10, 17, 16, 30);
  const day = calendarDay(at, "Asia/Taipei");
  assert.equal(day.replace(/\D/g, ""), "20261118");
});

test("原版 kyushitu.cgi 四堂教室課程逐欄解析，保留全部 17 項能力",()=>{
  assert.equal(classrooms.length,4);
  assert.deepEqual(classrooms.map(x=>x.key),[
    "classroom-2","classroom-3","classroom-4","classroom-5"
  ]);
  assert.deepEqual(classrooms.map(x=>x.price),[10000,20000,5000000,10000000]);
  assert.deepEqual(classrooms.map(x=>x.cooldownMs),[2,10,50,100].map(m=>m*60_000));
  assert.deepEqual(classrooms.map(x=>[x.bodyCost,x.brainCost]),
    [[10,10],[20,0],[50,50],[100,100]]);
  assert.equal(Object.keys(classrooms[0].gains).length,17);
  assert.deepEqual(Object.values(classrooms[0].gains),Array(17).fill(1));
  assert.equal(classrooms[1].gains.looks,10);
  assert.equal(classrooms[2].gains.unique,500);
  assert.equal(classrooms[3].gains.etti,100);
  assert.throws(()=>parseLegacyClassroom("標頭\n壞課程<>2<>3"),/無效/);
  assert.throws(()=>parseLegacyClassroom("標頭\n"+[
    "壞課程",...Array(17).fill("0"),"-1","無","1","1","1"
  ].join("<>")) ,/無效數字/);
});

test("教室 cash 路徑完整扣費、雙能量、能力、減重與 BMI，和原版 kyushitu_go 同源",()=>{
  const now=Date.UTC(2026,10,18,5);
  const p=createCharacterData("教室測試","other",now);
  const result=performTraining(p,classrooms[0],now);
  const after=result.character;
  assert.equal(result.paid,10000);
  assert.equal(after.money,90000);
  assert.equal(after.bodyEnergy,p.bodyEnergy-10);
  assert.equal(after.brainEnergy,p.brainEnergy-10);
  assert.equal(after.stats.kokugo,p.stats.kokugo+1);
  assert.equal(after.stats.looks,p.stats.looks+1);
  assert.equal(after.stats.etti,p.stats.etti+1);
  assert.equal(after.weight,59.8);
  assert.equal(result.weightLoss,0.2);
  assert.notEqual(after.bmi,undefined);
  assert.equal(after.classroomReadyAt,now+120_000);
  assert.equal(after.gymReadyAt,0);
  assert.equal(after.lastSchoolDay,"");
  assert.equal(p.money,100000,"原始角色不可原地變更");
  assert.match(trainingAvailability(after,classrooms[1],now+60_000),/教室還需要等待/);
  assert.throws(()=>performTraining(after,classrooms[1],now+60_000),/教室還需要等待/);
  assert.equal(trainingAvailability(after,classrooms[0],now+120_000),null);
});

test("教室獨立檢查雙能量、現金，健身房和教室不共用訓練冷卻",()=>{
  const now=Date.UTC(2026,10,18,5);
  const p=createCharacterData("健身居民","other",now);
  assert.match(trainingAvailability({...p,money:9999},classrooms[0],now),/現金不足/);
  assert.match(trainingAvailability({...p,bodyEnergy:9},classrooms[0],now),/身體能量不足/);
  assert.match(trainingAvailability({...p,brainEnergy:9},classrooms[0],now),/頭腦能量不足/);
  const classDone=performTraining(p,classrooms[0],now).character;
  const walk=gyms.find(x=>x.originalName==="ウォーキング");
  assert.equal(trainingAvailability(classDone,walk,now+1_000),null);
  const gymDone=performTraining(p,walk,now).character;
  assert.equal(trainingAvailability(gymDone,classrooms[0],now+1_000),null);
});
