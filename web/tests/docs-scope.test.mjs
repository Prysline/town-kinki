import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("現行專案範圍完全排除原版 CGI 舊玩家檔匯入，但保護新 Web 角色的存檔",()=>{
  const policy=read("../docs/project-scope-no-legacy-player-import.md");
  assert.match(policy,/完全不做／不列待辦/);
  assert.match(policy,/原版 Perl／CGI 舊玩家存檔匯入、轉換、相容和驗收完全不在本專案範圍內/);
  assert.match(policy,/新版 Web SQLite 存檔/);
  assert.match(policy,/原版 33 欄/);
  assert.match(policy,/釣魚／合成／遊樂中心/);
});

test("README 不再教使用者執行 CGI 舊玩家角色／物品的 --apply 轉檔",()=>{
  const readme=read("../README.md");
  assert.match(readme,/完全不需要考慮原版 CGI 舊玩家存檔匯入/);
  assert.match(readme,/新建角色|新玩家/);
  assert.match(readme,/web\/data\/|Web SQLite/);
  assert.doesNotMatch(readme,/node scripts\/legacy-(character|inventory)\.mjs\s+--file/);
  assert.doesNotMatch(readme,/必須先完成角色匯入/);
  assert.doesNotMatch(readme,/根據真實舊版玩家存檔驗證角色/);
});

test("現行差異矩陣和待辦清冊不把舊玩家存檔轉換算作未完成",()=>{
  const audit=read("../docs/migration-audit.md");
  const backlog=read("../docs/phase30-open-audit-backlog.md");
  for(const key of ["DB-01","DB-02","DB-03"]){
    const row=audit.split("\n").find(line=>line.startsWith("| "+key+" "));
    assert.ok(row,"差異矩陣沒有 "+key);
    assert.match(row,/排除/);
    assert.doesNotMatch(row,/\|\s*P[012]\s*\|/);
  }
  assert.match(backlog,/不做原版舊玩家存檔/);
  assert.doesNotMatch(backlog,/原版舊券安全匯入/);
  assert.match(backlog,/新版 Web 存檔/);
});

test("第51階段獎品交付仍已完成，但舊券匯入已退出範圍",()=>{
  const doc=read("../docs/phase51-event-coupon-redemption.md");
  assert.match(doc,/Web 角色事件券的原子兌換/);
  assert.match(doc,/原版舊玩家存檔匯入及其券轉換完全排除/);
  assert.match(doc,/新版 Web 角色存檔/);
});
