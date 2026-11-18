import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOWNS, decodeLegacyText } from "./engine.mjs";
import {
  parseLegacyTown, emptyTownMap, validateTiles, describeTile,
  availableMapSymbols, setTile
} from "./town-map.mjs";

export function initTownMapTable(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS town_maps (",
    " town_id INTEGER PRIMARY KEY,",
    " original_name TEXT NOT NULL DEFAULT '',",
    " original_record TEXT NOT NULL DEFAULT '',",
    " source TEXT NOT NULL,",
    " tiles_json TEXT NOT NULL,",
    " updated_at INTEGER NOT NULL",
    ");"
  ].join(""));
}

export function readTownMap(db, townId) {
  if (!TOWNS.some(town => town.id === townId)) throw new Error("不存在的城鎮");
  const found = db.prepare("SELECT * FROM town_maps WHERE town_id=?").get(townId);
  if (!found) return {
    townId, configured: false, originalName: TOWNS[townId].originalName,
    source: "empty", tiles: emptyTownMap(), fields: null
  };
  return {
    townId, configured: true, originalName: found.original_name,
    source: found.source, tiles: validateTiles(JSON.parse(found.tiles_json)),
    fields: found.original_record ? parseLegacyTown(found.original_record).fields : null
  };
}

export function storeTownMap(db, townId, data, source = "imported") {
  if (!TOWNS.some(town => town.id === townId)) throw new Error("不存在的城鎮");
  const tiles = validateTiles(data.tiles);
  db.prepare([
    "INSERT INTO town_maps(town_id,original_name,original_record,source,tiles_json,updated_at)",
    " VALUES(?,?,?,?,?,?)",
    " ON CONFLICT(town_id) DO UPDATE SET",
    " original_name=excluded.original_name,original_record=excluded.original_record,",
    " source=excluded.source,tiles_json=excluded.tiles_json,updated_at=excluded.updated_at"
  ].join(" ")).run(
    townId, data.originalName ?? TOWNS[townId].originalName,
    data.originalRecord ?? "",
    source, JSON.stringify(tiles), Date.now()
  );
}

export function bootstrapLegacyTownMaps(db, repositoryRoot) {
  const imports = [];
  for (const town of TOWNS) {
    if (db.prepare("SELECT 1 FROM town_maps WHERE town_id=?").get(town.id)) continue;
    const path = resolve(repositoryRoot, "log_dir", "townlog" + town.id + ".cgi");
    if (!existsSync(path)) continue;
    const buffer = readFileSync(path);
    if (!buffer.length) continue;
    const originalRecord = decodeLegacyText(buffer);
    const parsed = parseLegacyTown(originalRecord);
    storeTownMap(db, town.id, { ...parsed, originalRecord }, "legacy");
    imports.push(town.id);
  }
  return imports;
}

const backgrounds = Object.freeze([
  "keihansin.gif", "biwako.gif", "nara.gif", "wakayama.gif"
]);

export function publicTownMap(db, townId, editable = false) {
  const map = readTownMap(db, townId);
  return {
    townId, configured: map.configured, originalName: map.originalName,
    source: map.source, editable,
    background: backgrounds[townId],
    cells: map.tiles.map((raw, index) => ({
      index, row: Math.floor(index / 16), column: index % 16, raw,
      ...describeTile(raw)
    })),
    palette: editable ? [
      { key: "", label: "清除格子", category: "empty", image: null },
      ...availableMapSymbols()
    ] : []
  };
}

export function editTownTile(db, townId, row, column, symbol) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = readTownMap(db, townId);
    const current = previous.tiles[row * 16 + column];
    if (describeTile(current).category === "house")
      throw new Error("房屋已有人持有，不可透過地圖編輯器清除或覆蓋");
    const tiles = setTile(previous.tiles, row, column, symbol);
    storeTownMap(db, townId, {
      tiles, originalName: previous.originalName,
      originalRecord: previous.fields ? previous.fields.join("<>") + "\n" : ""
    }, "web-edited");
    db.exec("COMMIT");
    return readTownMap(db, townId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
