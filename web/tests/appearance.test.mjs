import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { safeLegacyIconUrl, legacyPlayerIcon } from "../src/appearance.mjs";

test("原始 town_lib.pl 確認 kounyuu 是玩家圖示 URL，game.cgi::battle 是 32x32", () => {
  const town = readFileSync(new URL("../../town_lib.pl", import.meta.url), "utf8");
  const game = readFileSync(new URL("../../game.cgi", import.meta.url), "utf8");
  assert.match(town, /kounyuu＝アイコンURL/);
  assert.match(game, /<img src=\$kounyuu width=32 height=32/);
});

test("原版圖示只允許使用者主動預覽安全 HTTPS URL，拒絕不安全方案或主機", () => {
  const positive = [
    ["https://example.com/a.png", "https://example.com/a.png"],
    ["https://images.example.org/icon.gif?size=32", "https://images.example.org/icon.gif?size=32"]
  ];
  for (const [input, expected] of positive)
    assert.equal(safeLegacyIconUrl(input), expected);
  for (const unsafe of [
    "", "http://example.com/a.gif", "//example.com/a.gif", "javascript:alert(1)",
    "data:image/png;base64,AA==", "file:///etc/passwd", "https://localhost/a.gif",
    "https://foo.local/a.gif", "https://example.internal/img",
    "https://127.0.0.1/a.gif", "https://[::1]/a.gif",
    "https://user:secret@example.com/a.gif", "https://example.com:8080/a.gif",
    "https://example.com\\@attacker.example/a.gif",
    "https://example.com/a image.png", "https://example.com/a.png\n",
    "https://example.com/"+("a".repeat(2100))
  ]) assert.equal(safeLegacyIconUrl(unsafe), null, unsafe);
});

test("不存在舊角色匯入表或無圖示時，不影響新玩家與狀態快照", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.deepEqual(legacyPlayerIcon(db,1),{status:"none"});
    assert.deepEqual(legacyPlayerIcon(db,0),{status:"none"});
    db.exec("CREATE TABLE legacy_character_imports(target_user_id INTEGER PRIMARY KEY,unmapped_json TEXT NOT NULL)");
    assert.deepEqual(legacyPlayerIcon(db,1),{status:"none"});
    db.prepare("INSERT INTO legacy_character_imports VALUES(?,?)").run(1,'{"kounyuu":""}');
    assert.deepEqual(legacyPlayerIcon(db,1),{status:"none"});
  } finally { db.close(); }
});

test("舊玩家圖示只從本人的唯讀 unmapped_json 取得，不能跨帳號讀取", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE legacy_character_imports(target_user_id INTEGER PRIMARY KEY,unmapped_json TEXT NOT NULL)");
    const insert=db.prepare("INSERT INTO legacy_character_imports VALUES(?,?)");
    insert.run(1,JSON.stringify({kounyuu:"https://cdn.example.net/owner.gif",house_type:"original"}));
    insert.run(2,JSON.stringify({kounyuu:"http://old.example.net/other.gif"}));
    assert.deepEqual(legacyPlayerIcon(db,1),{
      status:"available",url:"https://cdn.example.net/owner.gif"
    });
    assert.deepEqual(legacyPlayerIcon(db,2),{status:"blocked"});
    assert.deepEqual(legacyPlayerIcon(db,3),{status:"none"});
    const saved=db.prepare("SELECT unmapped_json FROM legacy_character_imports WHERE target_user_id=1").get();
    assert.equal(JSON.parse(saved.unmapped_json).house_type,"original");
    db.prepare("UPDATE legacy_character_imports SET unmapped_json='not-json' WHERE target_user_id=2").run();
    assert.deepEqual(legacyPlayerIcon(db,2),{status:"blocked"});
  } finally { db.close(); }
});

test("Web 不在載入狀態時外連原版圖示，必須提供本人可點選的按鈕", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url),"utf8");
  const js = readFileSync(new URL("../public/app.js", import.meta.url),"utf8");
  const server = readFileSync(new URL("../src/server.mjs", import.meta.url),"utf8");
  const css = readFileSync(new URL("../public/style.css", import.meta.url),"utf8");
  assert.match(html, /id="legacy-icon-panel"[^>]*hidden/);
  assert.match(html, /id="legacy-icon-image"[^>]*referrerpolicy="no-referrer"/);
  assert.match(html, /id="legacy-icon-toggle"[^>]*type="button"/);
  assert.doesNotMatch(html, /id="legacy-icon-image"[^>]*src=/);
  assert.match(server, /legacyPlayerIcon: updated \? legacyPlayerIcon\(db,user\.id\)/);
  assert.match(server, /img-src 'self' data: https:/);
  assert.match(js, /el\("legacy-icon-toggle"\)\.addEventListener\("click"/);
  assert.match(js, /image\.src = icon\.url/);
  assert.match(js, /image\.removeAttribute\("src"\)/);
  assert.match(css, /\.legacy-icon-panel\[hidden\]\{display:none\}/);
});
