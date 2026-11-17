import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCharacterData, decodeLegacyText } from "../src/engine.mjs";
import {
  parseLegacySchool, parseLegacyGym, calendarDay,
  trainingAvailability, performTraining
} from "../src/training.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readLegacy = path => decodeLegacyText(readFileSync(resolve(root, "dat_dir", path)));
const schools = parseLegacySchool(readLegacy("school.cgi"));
const gyms = parseLegacyGym(readLegacy("gym.cgi"));

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
