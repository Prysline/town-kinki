import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseHouseCatalog, getHouseQuote, initHousingTables, listHouses, publicHouseCatalog, buildHouse, renameHouse } from "../src/housing.mjs";
import { initTownMapTable, storeTownMap, readTownMap, editTownTile } from "../src/town-storage.mjs";
import { emptyTownMap, describeTile } from "../src/town-map.mjs";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cfg = readFileSync(resolve(repoRoot, "town_ini.cgi"), "utf8");
const commands = readFileSync(resolve(repoRoot, "command.pl"), "utf8");
const catalog = parseHouseCatalog(cfg, commands);
const smallHouse = "house/kamakura.gif";
const largeHouse = "house/house_1.gif";

function createDb() {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);",
    "CREATE TABLE characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, town_id INTEGER NOT NULL, money INTEGER NOT NULL, bank INTEGER NOT NULL);"
  ].join("\n"));
  initTownMapTable(db);
  initHousingTables(db);
  db.prepare("INSERT INTO users(id,username) VALUES(1,'player1'),(2,'player2')").run();
  db.prepare("INSERT INTO characters(user_id,name,town_id,money,bank) VALUES(1,'甲',3,100000000,100000000),(2,'乙',3,100000000,100000000)").run();
  const tiles = emptyTownMap();
  tiles[0] = "空地";
  tiles[1] = "空地2";
  tiles[2] = "空地3";
  tiles[3] = "銀行";
  tiles[4] = "42_1=空地";
  storeTownMap(db, 3, {tiles}, "web-edited");
  return db;
}

test("原版外觀、室內等級、城鎮地價與最多五棟相關建築設定能解析", () => {
  assert.equal(catalog.landWan.join(","), "5000,2000,1000,500");
  assert.deepEqual(catalog.interiorWan, [1200,800,400,100]);
  assert.equal(catalog.legacyMaximumHouses, 5);
  assert.ok(catalog.houses.length >= 60);
  assert.equal(catalog.houses.find(x=>x.id === smallHouse).priceWan, 50);
  assert.equal(catalog.houses.find(x=>x.id === largeHouse).priceWan, 160);
  assert.ok(catalog.houses.some(x=>x.supported === false));
  assert.ok(publicHouseCatalog(catalog, 3, 0).canBuild);
  assert.equal(publicHouseCatalog(catalog, 3, 1).canBuild, false);
});

test("原版住宅價格依城鎮地價、外觀與室內等級加總，並以萬圓轉為元", () => {
  const quote = getHouseQuote(catalog, 3, smallHouse, 3);
  assert.equal(quote.landWan, 500);
  assert.equal(quote.appearanceWan, 50);
  assert.equal(quote.interiorWan, 100);
  assert.equal(quote.totalWan, 650);
  assert.equal(quote.total, 6500000);
  assert.equal(getHouseQuote(catalog, 0, largeHouse, 0).total, 63600000);
  assert.throws(() => getHouseQuote(catalog, 3, "house/not-there.gif", 3), /外觀/);
  assert.throws(() => getHouseQuote(catalog, 3, smallHouse, -1), /室內/);
  assert.throws(() => getHouseQuote(catalog, 3, smallHouse, 3, 1), /第一筆/);
});

test("建造住宅為交易式原子操作：扣現金、保留舊空地代碼及登記所有權", () => {
  const db = createDb();
  try {
    const result = buildHouse(db, catalog, 1, {row:0,column:0},
      {image:smallHouse,interiorRank:3,payment:"cash"}, 123456);
    assert.equal(result.quote.total, 6500000);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money, 93500000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank, 100000000);
    const owner = listHouses(db, 1);
    assert.equal(owner.length, 1);
    assert.equal(owner[0].name, "甲的家");
    assert.equal(owner[0].ownerUserId, 1);
    assert.equal(owner[0].originalPlot, "空地");
    assert.equal(owner[0].location, "A1");
    assert.equal(owner[0].builtAt, 123456);
    const tile = readTownMap(db, 3).tiles[0];
    assert.equal(tile, "webhouse_" + result.houseId + "=空地");
    assert.equal(describeTile(tile).category, "house");
  } finally { db.close(); }
});

test("房屋不可重複購買，同一位玩家不可在不同格子建造第二筆一般住宅", () => {
  const db = createDb();
  try {
    const options = {image:smallHouse,interiorRank:3,payment:"cash"};
    buildHouse(db,catalog,1,{row:0,column:0},options);
    assert.throws(() => buildHouse(db,catalog,2,{row:0,column:0},options), /不是可建造/);
    assert.throws(() => buildHouse(db,catalog,1,{row:0,column:1},options), /第一筆/);
    const second = buildHouse(db,catalog,2,{row:0,column:1},options);
    assert.equal(second.quote.total,6500000);
    assert.equal(listHouses(db).length,2);
  } finally { db.close(); }
});

test("銀行存款付款、不足款項、偽造費用及非空地均不會破壞資產", () => {
  const db = createDb();
  try {
    const moneyBefore = db.prepare("SELECT money,bank FROM characters WHERE user_id=1").get();
    assert.throws(() => buildHouse(db,catalog,1,{row:0,column:3},
      {image:smallHouse,interiorRank:3,payment:"cash"}), /不是可建造/);
    assert.throws(() => buildHouse(db,catalog,1,{row:0,column:4},
      {image:smallHouse,interiorRank:3,payment:"cash"}), /不是可建造/);
    assert.throws(() => buildHouse(db,catalog,1,{row:0,column:0},
      {image:smallHouse,interiorRank:3,payment:"free"}), /付款方式/);
    assert.deepEqual(db.prepare("SELECT money,bank FROM characters WHERE user_id=1").get(), moneyBefore);
    db.prepare("UPDATE characters SET money=50 WHERE user_id=1").run();
    assert.throws(() => buildHouse(db,catalog,1,{row:0,column:0},
      {image:smallHouse,interiorRank:3,payment:"cash",price:1}), /現金不足/);
    assert.equal(readTownMap(db,3).tiles[0],"空地");
    assert.equal(listHouses(db).length,0);
    const result = buildHouse(db,catalog,1,{row:0,column:2},
      {image:smallHouse,interiorRank:3,payment:"bank",price:1});
    assert.equal(result.quote.total,6500000);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,50);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,93500000);
  } finally { db.close(); }
});

test("已建造房屋不可由單機編輯器刪除或覆蓋，原版舊屋也不可修改", () => {
  const db = createDb();
  try {
    buildHouse(db,catalog,1,{row:0,column:0},
      {image:smallHouse,interiorRank:3,payment:"cash"});
    assert.throws(() => editTownTile(db,3,0,0,""), /不可/);
    assert.throws(() => editTownTile(db,3,0,0,"銀行"), /不可/);
    assert.throws(() => editTownTile(db,3,0,4,"空地"), /不可/);
    assert.equal(readTownMap(db,3).tiles[0].startsWith("webhouse_"),true);
  } finally { db.close(); }
});

test("只能替自己的房屋改名，不允許他人或無效名稱", () => {
  const db = createDb();
  try {
    const result = buildHouse(db,catalog,1,{row:0,column:0},
      {image:smallHouse,interiorRank:3,payment:"cash"});
    assert.throws(() => renameHouse(db,2,result.houseId,"竄改名稱"),/找不到你擁有/);
    assert.throws(() => renameHouse(db,1,result.houseId,"<img src=x>"),/有效字元/);
    assert.deepEqual(renameHouse(db,1,result.houseId,"綠色小屋"),{houseId:result.houseId,name:"綠色小屋"});
    assert.equal(listHouses(db,1)[0].name,"綠色小屋");
  } finally { db.close(); }
});
