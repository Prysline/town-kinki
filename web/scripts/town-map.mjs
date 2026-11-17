#!/usr/bin/env node
// 匯入原版 townlog*.cgi 或輸出 Web 地圖至原版 <> 分隔格式。
// 使用 node scripts/town-map.mjs --town 0 --mode solo --import path/to/townlog0.cgi
// 或 node scripts/town-map.mjs --town 0 --mode multi --export output.cgi
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { decodeLegacyText, TOWNS } from "../src/engine.mjs";
import { parseLegacyTown, serializeLegacyTown } from "../src/town-map.mjs";
import { initTownMapTable, readTownMap, storeTownMap } from "../src/town-storage.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function run() {
  const townId = Number(option("--town"));
  const mode = option("--mode") || "solo";
  const input = option("--import");
  const output = option("--export");
  if (!Number.isInteger(townId) || !TOWNS.some(town => town.id === townId) ||
      !["solo", "multi"].includes(mode) || Boolean(input) === Boolean(output)) {
    throw new Error("用法：--town 0..3 --mode solo|multi (--import 輸入.cgi | --export 輸出.cgi) [--replace]");
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = resolve(process.env.DATA_DIR || resolve(root, "data"));
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, mode + ".sqlite"));
  try {
    initTownMapTable(db);
    if (input) {
      const raw = decodeLegacyText(readFileSync(resolve(input)));
      const parsed = parseLegacyTown(raw);
      const existing = readTownMap(db, townId);
      if (existing.configured && !process.argv.includes("--replace")) {
        throw new Error("這座城鎮已有地圖。若要覆蓋，請明確加入 --replace 並先備份資料庫。");
      }
      storeTownMap(db, townId, { ...parsed, originalRecord: raw }, "legacy-import");
      console.log("已匯入 " + TOWNS[townId].name + " 的 12×16 地圖，共 " +
        parsed.tiles.filter(Boolean).length + " 格有內容。");
    } else {
      const saved = readTownMap(db, townId);
      if (!saved.configured) throw new Error("此城鎮尚無地圖，無法輸出。");
      const serialized = serializeLegacyTown(saved, TOWNS[townId].originalName);
      writeFileSync(resolve(output), serialized, "utf8");
      console.log("已輸出地圖到 " + resolve(output) + "（UTF-8 原版欄位格式）。");
    }
  } finally {
    db.close();
  }
}

try { run(); }
catch (error) {
  console.error("街區匯入／輸出失敗：" + error.message);
  process.exitCode = 1;
}
