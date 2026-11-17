import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  MAP_ROWS, MAP_COLUMNS, MAP_CELL_COUNT, tileIndex, cellLocation,
  emptyTownMap, parseLegacyTown, serializeLegacyTown, describeTile,
  setTile, availableMapSymbols
} from "../src/town-map.mjs";
import {
  initTownMapTable, readTownMap, storeTownMap, publicTownMap, editTownTile
} from "../src/town-storage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = () => {
  const fields = Array(266).fill("");
  fields[0] = "京阪神ストリート";
  fields[1] = "11";
  fields[2] = "3000";
  fields[3] = "900";
  fields[259] = "5000";
  fields[22] = "銀行";
  fields[23] = "道１";
  fields[224] = "42_1=空地";
  fields[260] = "1337000000";
  return fields.join("<>") + "<>\n";
};

test("原始街區精確使用 12×16 格，A1=22、L16=224", () => {
  assert.equal(MAP_ROWS, 12);
  assert.equal(MAP_COLUMNS, 16);
  assert.equal(MAP_CELL_COUNT, 192);
  assert.equal(tileIndex(0, 0), 22);
  assert.equal(tileIndex(11, 15), 224);
  assert.equal(cellLocation(0, 0), "A1");
  assert.equal(cellLocation(11, 15), "L16");
  assert.throws(() => tileIndex(12, 0), /無效/);
  assert.throws(() => tileIndex(0, 16), /無效/);
  assert.equal(emptyTownMap().length, 192);
});

test("匯入原版 townlog 格式能保留住宅、道路、城鎮欄位", () => {
  const map = parseLegacyTown(source());
  assert.equal(map.tiles.length, 192);
  assert.equal(map.tiles[0], "銀行");
  assert.equal(map.tiles[1], "道１");
  assert.equal(map.tiles[191], "42_1=空地");
  assert.equal(map.originalName, "京阪神ストリート");
  assert.equal(map.population, "11");
  assert.equal(map.landPrice, "5000");
  assert.equal(map.fields[260], "1337000000");
  assert.equal(serializeLegacyTown(map), source());
});

test("不能把 fork 中的空 townlog 當作已有地圖，亦拒絕缺欄位資料", () => {
  assert.throws(() => parseLegacyTown(""), /沒有內容/);
  assert.throws(() => parseLegacyTown("地圖<>人口<>銀行"), /欄位不足/);
});

test("原版符號使用固定圖示白名單，未知與玩家住宅安全保留", () => {
  assert.equal(describeTile("銀行").image, "bank.gif");
  assert.equal(describeTile("道１").image, "road/1.gif");
  assert.equal(describeTile("42_1=空地").category, "house");
  assert.equal(describeTile("../../secret").image, null);
  assert.equal(describeTile("../../secret").category, "unknown");
  const list = availableMapSymbols();
  assert.ok(list.some(x => x.key === "銀行"));
  assert.ok(list.some(x => x.key === "空地3"));
  assert.ok(!list.some(x => x.key === "../../secret"));
});

test("格子編輯不可修改地圖尺寸、插入未知路徑或跳出格子", () => {
  const original = emptyTownMap();
  const changed = setTile(original, 5, 3, "銀行");
  assert.equal(changed[5 * 16 + 3], "銀行");
  assert.equal(original[5 * 16 + 3], "");
  assert.throws(() => setTile(original, 0, 0, "../../secret"), /不支援/);
  assert.throws(() => setTile(original, 0, 16, "銀行"), /無效/);
  assert.throws(() => setTile(original, -1, 0, "銀行"), /無效/);
  assert.throws(() => setTile(["銀行"], 0, 0, "銀行"), /格數/);
});

test("SQLite 地圖有未配置狀態，單機修改之後持久保存，四城獨立", () => {
  const db = new DatabaseSync(":memory:");
  try {
    initTownMapTable(db);
    const empty = readTownMap(db, 0);
    assert.equal(empty.configured, false);
    assert.equal(empty.tiles.length, 192);
    editTownTile(db, 0, 0, 0, "銀行");
    editTownTile(db, 0, 0, 1, "道１");
    const current = readTownMap(db, 0);
    assert.equal(current.configured, true);
    assert.equal(current.tiles[0], "銀行");
    assert.equal(current.tiles[1], "道１");
    assert.equal(current.source, "web-edited");
    assert.equal(readTownMap(db, 1).configured, false);
    const publicView = publicTownMap(db, 0, true);
    assert.equal(publicView.cells.length, 192);
    assert.equal(publicView.cells[0].image, "bank.gif");
    assert.equal(publicView.palette[0].key, "");
    assert.equal(publicTownMap(db, 0, false).palette.length, 0);
  } finally { db.close(); }
});

test("匯入地圖再編輯與匯出時，保留額外原始欄位", () => {
  const db = new DatabaseSync(":memory:");
  try {
    initTownMapTable(db);
    const originalRecord = source();
    storeTownMap(db, 0, { ...parseLegacyTown(originalRecord), originalRecord }, "legacy-import");
    editTownTile(db, 0, 0, 0, "役場");
    const stored = readTownMap(db, 0);
    assert.equal(stored.tiles[0], "役場");
    assert.equal(stored.fields[260], "1337000000");
    const serialized = serializeLegacyTown(stored);
    const result = parseLegacyTown(serialized);
    assert.equal(result.fields[260], "1337000000");
    assert.equal(result.tiles[0], "役場");
    assert.equal(result.tiles[191], "42_1=空地");
  } finally { db.close(); }
});

test("命令列可對舊城鎮檔案匯入及輸出，不會默默覆蓋地圖", () => {
  const dir = mkdtempSync(join(tmpdir(), "town-layout-"));
  try {
    const original = join(dir, "townlog0.cgi");
    const exported = join(dir, "exported.cgi");
    writeFileSync(original, source(), "utf8");
    const script = resolve(root, "scripts", "town-map.mjs");
    const args = ["--town", "0", "--mode", "multi"];
    const run = extra => spawnSync(process.execPath, [script, ...args, ...extra], {
      cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: "utf8"
    });
    const first = run(["--import", original]);
    assert.equal(first.status, 0, first.stderr);
    const second = run(["--import", original]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /已有地圖/);
    const output = run(["--export", exported]);
    assert.equal(output.status, 0, output.stderr);
    assert.deepEqual(parseLegacyTown(readFileSync(exported, "utf8")).tiles, parseLegacyTown(source()).tiles);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
