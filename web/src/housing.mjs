// 房屋規則移植自 town_ini.cgi、command.pl 的一般住宅建築流程。
// 本階段只支援第一筆一般住宅；原版後續建物分店、公司與商店尚未移植。
import { readTownMap, storeTownMap } from "./town-storage.mjs";
import { describeTile, tileIndex } from "./town-map.mjs";
import { TOWNS } from "./engine.mjs";

export const INTERIOR_LABELS = Object.freeze(["A 級（四個內容欄位）","B 級（三個內容欄位）","C 級（兩個內容欄位）","D 級（一個內容欄位）"]);
export const RESIDENTIAL_LOTS = Object.freeze(["空地","空地2","空地3","空地4"]);
export const MAX_NORMAL_HOUSES = 1;

function priceInWan(value) {
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(number) || !Number.isSafeInteger(number * 10000)) {
    return null; // 舊版存在超過 JS 安全整數範圍的天價紀念建築
  }
  return number;
}

export function parseHouseCatalog(townIni, commandSource) {
  const land = townIni.match(/@town_tika_hairetu\s*=\s*\(([^;]+)\);/);
  const images = townIni.match(/%ie_hash\s*=\s*\(([^;]+)\);/);
  const interior = townIni.match(/@housu_nedan\s*=\s*\(([^;]+)\);/);
  const limit = commandSource.match(/\$mochiie_max\s*=\s*(\d+)\s*;/);
  if (!land || !images || !interior || !limit) throw new Error("無法讀取原版建築設定");
  const listNumbers = text => [...text.matchAll(/['"]?(\d+)['"]?/g)].map(m => priceInWan(m[1]));
  const landWan = listNumbers(land[1]);
  const interiorWan = listNumbers(interior[1]);
  const legacyMaximumHouses = Number(limit[1]);
  if (landWan.length !== TOWNS.length || interiorWan.length !== 4 || landWan.some(v => v === null) || interiorWan.some(v => v === null)) {
    throw new Error("原版城鎮地價或室內費用無法辨識");
  }
  const houses = [];
  const matcher = /'([^']+)'\s*,\s*(?:'(\d+)'|(\d+))/g;
  for (const result of images[1].matchAll(matcher)) {
    const image = result[1];
    const amount = priceInWan(result[2] ?? result[3]);
    if (!/^house\/[A-Za-z0-9_-]+\.gif$/.test(image)) continue;
    houses.push({ id: image, image, priceWan: amount,
      supported: amount !== null });
  }
  if (!houses.length) throw new Error("原版住宅外觀資料無法讀取");
  return {
    landWan, interiorWan, legacyMaximumHouses,
    houses: houses.sort((a,b) => (a.priceWan ?? Infinity) - (b.priceWan ?? Infinity))
  };
}

export function getHouseQuote(catalog, townId, imageId, interiorRank, existingNormalHouses = 0) {
  if (!Number.isInteger(townId) || !TOWNS.some(t => t.id === townId)) throw new Error("不存在的城鎮");
  if (!Number.isInteger(interiorRank) || interiorRank < 0 || interiorRank >= 4) throw new Error("無效的房屋室內等級");
  const house = catalog.houses.find(item => item.id === imageId);
  if (!house || !house.supported) throw new Error("尚未支援的房屋外觀或價格");
  if (!Number.isInteger(existingNormalHouses) || existingNormalHouses < 0) throw new Error("無效的住宅數量");
  if (existingNormalHouses >= MAX_NORMAL_HOUSES) throw new Error("目前僅支援建造第一筆一般住宅");
  const landWan = catalog.landWan[townId];
  const appearanceWan = house.priceWan;
  const interiorWan = catalog.interiorWan[interiorRank];
  const totalWan = landWan + appearanceWan + interiorWan;
  const total = totalWan * 10000;
  if (!Number.isSafeInteger(total)) throw new Error("房屋價格超出目前支援範圍");
  return { townId, image: house.image, interiorRank, landWan, appearanceWan, interiorWan, totalWan, total };
}

export function initHousingTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS houses (",
    "id INTEGER PRIMARY KEY,",
    "owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,",
    "row_num INTEGER NOT NULL CHECK(row_num BETWEEN 0 AND 11),",
    "column_num INTEGER NOT NULL CHECK(column_num BETWEEN 0 AND 15),",
    "name TEXT NOT NULL,",
    "image TEXT NOT NULL,",
    "interior_rank INTEGER NOT NULL CHECK(interior_rank BETWEEN 0 AND 3),",
    "purchase_price INTEGER NOT NULL,",
    "original_plot TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,",
    "UNIQUE(town_id,row_num,column_num)",
    ");"
  ].join(""));
  db.exec("CREATE INDEX IF NOT EXISTS houses_owner_idx ON houses(owner_user_id)");
  db.exec([
    "CREATE TABLE IF NOT EXISTS house_events (",
    "id INTEGER PRIMARY KEY,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "house_id INTEGER NOT NULL,",
    "event_type TEXT NOT NULL CHECK(event_type IN ('built','sold')),",
    "town_id INTEGER NOT NULL,",
    "row_num INTEGER NOT NULL,",
    "column_num INTEGER NOT NULL,",
    "house_name TEXT NOT NULL,",
    "image TEXT NOT NULL,",
    "amount INTEGER NOT NULL CHECK(amount>=0),",
    "created_at INTEGER NOT NULL",
    ");"
  ].join(""));
  db.exec("CREATE INDEX IF NOT EXISTS house_events_user_idx ON house_events(user_id,id)");
}

export function listHouses(db, ownerUserId = null) {
  const query = "SELECT h.id,h.owner_user_id,h.town_id,h.row_num,h.column_num,h.name,h.image,h.interior_rank,h.purchase_price,h.original_plot,h.created_at,c.name AS owner_name FROM houses h JOIN characters c ON c.user_id=h.owner_user_id";
  const records = ownerUserId === null
    ? db.prepare(query + " ORDER BY h.town_id,h.id").all()
    : db.prepare(query + " WHERE h.owner_user_id=? ORDER BY h.id").all(ownerUserId);
  return records.map(h => ({
    id: h.id, ownerUserId: h.owner_user_id, ownerName: h.owner_name,
    townId: h.town_id, townName: TOWNS[h.town_id]?.name ?? "未知城鎮",
    row: h.row_num, column: h.column_num, location: "ABCDEFGHIJKL"[h.row_num] + (h.column_num + 1),
    name: h.name, image: h.image, interiorRank: h.interior_rank,
    purchasePrice: h.purchase_price, originalPlot: h.original_plot, builtAt: h.created_at
  }));
}

export function publicHouseCatalog(catalog, townId, existingNormalHouses) {
  return {
    townId, landWan: catalog.landWan[townId],
    interiorOptions: INTERIOR_LABELS.map((label, index) => ({ rank:index, label, priceWan: catalog.interiorWan[index] })),
    designs: catalog.houses.map(item => ({ id: item.id, image: item.image, priceWan: item.priceWan, supported: item.supported })),
    canBuild: existingNormalHouses < MAX_NORMAL_HOUSES,
    maxNormalHouses: MAX_NORMAL_HOUSES,
    originalMaximumBuildings: catalog.legacyMaximumHouses
  };
}

export function getHouseSaleQuote(catalog, townId) {
  if (!Number.isInteger(townId) || !TOWNS.some(town => town.id === townId))
    throw new Error("不存在的城鎮");
  // original_house.cgi：出售僅退還城鎮土地地價，不退外觀與內裝。
  const landWan = catalog.landWan[townId];
  const refund = landWan * 10000;
  if (!Number.isSafeInteger(refund) || refund <= 0)
    throw new Error("土地退款金額無效");
  return { townId, landWan, refund };
}

export function listHouseEvents(db, userId, limit = 20) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("無效的玩家");
  const capped = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 20;
  return db.prepare(
    "SELECT id,house_id,event_type,town_id,row_num,column_num,house_name,image,amount,created_at FROM house_events WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ).all(userId, capped).map(row => ({
    id: row.id, houseId: row.house_id, action: row.event_type,
    townId: row.town_id, townName: TOWNS[row.town_id]?.name ?? "未知城鎮",
    location: "ABCDEFGHIJKL"[row.row_num] + (row.column_num + 1),
    houseName: row.house_name, image: row.image,
    amount: row.amount, occurredAt: row.created_at
  }));
}

export function sellHouse(db, catalog, userId, houseId, now = Date.now()) {
  if (!Number.isSafeInteger(houseId) || houseId < 1)
    throw new Error("無效的房屋編號");
  db.exec("BEGIN IMMEDIATE");
  try {
    const house = db.prepare(
      "SELECT * FROM houses WHERE id=? AND owner_user_id=?"
    ).get(houseId, userId);
    if (!house) throw new Error("找不到你擁有的房屋，可能已出售");
    if (!RESIDENTIAL_LOTS.includes(house.original_plot))
      throw new Error("無法確認住宅的原始空地種類");
    const character = db.prepare("SELECT money FROM characters WHERE user_id=?").get(userId);
    if (!character) throw new Error("請先建立角色");
    const map = readTownMap(db, house.town_id);
    const idx = house.row_num * 16 + house.column_num;
    const expected = "webhouse_" + house.id + "=" + house.original_plot;
    if (map.tiles[idx] !== expected)
      throw new Error("街區與房屋所有權資料不一致，停止出售以避免資料遺失");
    const quote = getHouseSaleQuote(catalog, house.town_id);
    const newMoney = character.money + quote.refund;
    if (!Number.isSafeInteger(newMoney)) throw new Error("出售後金額超出可處理範圍");
    const restored = [...map.tiles];
    restored[idx] = house.original_plot;
    storeTownMap(db, house.town_id, {
      tiles: restored, originalName: map.originalName,
      originalRecord: map.fields ? map.fields.join("<>") + "\n" : ""
    }, "web-edited");
    db.prepare("DELETE FROM houses WHERE id=? AND owner_user_id=?").run(house.id,userId);
    db.prepare("UPDATE characters SET money=? WHERE user_id=?").run(newMoney,userId);
    db.prepare(
      "INSERT INTO house_events(user_id,house_id,event_type,town_id,row_num,column_num,house_name,image,amount,created_at) VALUES(?,?,'sold',?,?,?,?,?,?,?)"
    ).run(userId,house.id,house.town_id,house.row_num,house.column_num,house.name,
      house.image,quote.refund,now);
    db.exec("COMMIT");
    return {houseId, location:"ABCDEFGHIJKL"[house.row_num]+(house.column_num+1),
      originalPlot:house.original_plot, ...quote};
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function buildHouse(db, catalog, userId, position, options, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const character = db.prepare("SELECT id,name,town_id,money,bank FROM characters WHERE user_id=?").get(userId);
    if (!character) throw new Error("請先建立角色");
    if (!Number.isInteger(position?.row) || !Number.isInteger(position?.column)) throw new Error("無效的街區格子位置");
    const idx = tileIndex(position.row, position.column);
    const map = readTownMap(db, character.town_id);
    const offset = position.row * 16 + position.column;
    const raw = map.tiles[offset];
    if (!RESIDENTIAL_LOTS.includes(raw)) throw new Error("選定位置不是可建造的空地");
    const count = db.prepare("SELECT COUNT(*) AS n FROM houses WHERE owner_user_id=?").get(userId).n;
    const quote = getHouseQuote(catalog, character.town_id, options?.image, options?.interiorRank, count);
    const source = options?.payment;
    if (!["cash","bank"].includes(source)) throw new Error("無效的付款方式");
    const available = source === "cash" ? character.money : character.bank;
    if (available < quote.total) throw new Error(source === "cash" ? "現金不足以支付建造費" : "銀行存款不足以支付建造費");
    const balance = available - quote.total;
    if (!Number.isSafeInteger(balance)) throw new Error("金額超出可處理範圍");
    const name = character.name + "的家";
    // 不重用已出售房屋編號，避免延遲送達的舊出售請求誤傷新屋。
    // 相容舊版 houses(id INTEGER PRIMARY KEY) 的既有 SQLite 資料庫。
    const houseId = db.prepare(
      "SELECT MAX(COALESCE((SELECT MAX(id) FROM houses),0),COALESCE((SELECT MAX(house_id) FROM house_events),0))+1 AS id"
    ).get().id;
    if (!Number.isSafeInteger(houseId) || houseId < 1) throw new Error("住宅編號已超出支援範圍");
    db.prepare(
      "INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,interior_rank,purchase_price,original_plot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).run(houseId, userId, character.town_id, position.row, position.column, name,
      quote.image, quote.interiorRank, quote.total, raw, now);
    // 使用明確的 Web 識別碼，避免誤認與原版居民 ID 相同。
    const updatedTiles = [...map.tiles];
    updatedTiles[offset] = "webhouse_" + houseId + "=" + raw;
    storeTownMap(db, character.town_id, {
      tiles: updatedTiles, originalName: map.originalName,
      originalRecord: map.fields ? map.fields.join("<>") + "\n" : ""
    }, "web-edited");
    const field = source === "cash" ? "money" : "bank";
    db.prepare("UPDATE characters SET " + field + "=? WHERE user_id=?").run(balance, userId);
    db.prepare(
      "INSERT INTO house_events(user_id,house_id,event_type,town_id,row_num,column_num,house_name,image,amount,created_at) VALUES(?,?,'built',?,?,?,?,?,?,?)"
    ).run(userId,houseId,character.town_id,position.row,position.column,name,
      quote.image,quote.total,now);
    db.exec("COMMIT");
    return { houseId, quote };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function renameHouse(db, userId, houseId, name) {
  if (!Number.isSafeInteger(houseId) || houseId < 1) throw new Error("無效的房屋編號");
  if (typeof name !== "string" || !/^[\p{L}\p{N} _（）()、・]{1,28}$/u.test(name.trim()))
    throw new Error("房屋名稱需要 1 至 28 個有效字元");
  const result = db.prepare("UPDATE houses SET name=? WHERE id=? AND owner_user_id=?")
    .run(name.trim(), houseId, userId);
  if (!result.changes) throw new Error("找不到你擁有的房屋");
  return { houseId, name:name.trim() };
}
