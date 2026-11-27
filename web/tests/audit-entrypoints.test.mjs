import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";

const original = decodeLegacyText(readFileSync(new URL("../../unit.pl", import.meta.url)));
const mapCode = readFileSync(new URL("../src/town-map.mjs", import.meta.url), "utf8");
const audit = readFileSync(new URL("../docs/phase30-entrypoint-coverage.md", import.meta.url), "utf8");

function originalFormKeys(source) {
  const lines = source.split(/\r?\n/);
  const names = [];
  for (let i=0;i<lines.length;i++) {
    const match = lines[i].match(/^\s*"([^"]+)"\s*=>\s*/);
    if (!match) continue;
    // 溫泉是 %unit 中唯一跨行 form，不可只看定義當行而漏列。
    const block = match[1] === "温泉" ? lines.slice(i,i+10).join("\n") : lines[i];
    if (block.includes("<form")) names.push(match[1]);
  }
  return names;
}

function auditEntries(source) {
  return [...source.matchAll(/^\| \[`([^`]+)`\]\(\.\.\/\.\.\/unit\.pl#L\d+\) \| [^|]* \| [^|]* \| (有|無) \|/gm)]
    .map(match => ({name:match[1],known:match[2] === "有"}));
}

test("原版 unit.pl 所有互動設施有且只有一筆對應盤點（包含跨行溫泉）", () => {
  const originalKeys = originalFormKeys(original);
  const rows = auditEntries(audit);
  assert.equal(new Set(originalKeys).size,originalKeys.length);
  assert.equal(new Set(rows.map(row=>row.name)).size,rows.length);
  assert.deepEqual(
    rows.map(row=>row.name).sort(),
    originalKeys.sort(),
    "原版新增／刪除入口時請同步修改 phase30-entrypoint-coverage.md"
  );
  assert.ok(rows.some(row=>row.name==="温泉"));
});

test("盤點的 Web 地圖代碼有無，與實際 MAP_SYMBOLS 一致", () => {
  const known = new Set([...mapCode.matchAll(/\["([^"]+)",\s*"[^"]+",\s*(?:null|"[^"]+"),\s*"(?:[a-z]+)"\]/g)]
    .map(match=>match[1]));
  const rows = auditEntries(audit);
  for (const row of rows)
    assert.equal(row.known,known.has(row.name),row.name+" 地圖代碼狀態需要更新");
  assert.equal(rows.length,43);
  assert.equal(rows.filter(row=>row.known).length,32);
});
