import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,existsSync,statSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";

const src=(p)=>decodeLegacyText(readFileSync(new URL("../../"+p,import.meta.url)));
const audit=readFileSync(new URL("../docs/phase30-source-recheck.md",import.meta.url),"utf8");
const matrix=readFileSync(new URL("../docs/migration-audit.md",import.meta.url),"utf8");

test("稅務原版是在主畫面跨日流程，不是役場排行榜",()=>{
  assert.match(src("town_ini.cgi"),/\$zeikin_shitei\s*=\s*'Mon'/);
  const login=src("town_maker.cgi");
  assert.match(login,/if\(\$zeikin_shitei\)/);
  assert.match(login,/\$k_sousisan\s*\*0\.01/);
  assert.match(login,/\$k_sousisan\s*\*0\.07/);
  assert.match(login,/\$bank\s*-=\s*\$hiku_kane/);
  assert.match(login,/kityou_syori\("納税/);
  assert.match(src("yakuba.cgi"),/ランキング/);
  assert.match(matrix,/BK-04 原版定期徵稅 \| town_ini\.cgi/);
  assert.doesNotMatch(matrix,/BK-04 稅務／原版全部資產檔匯入/);
});

test("競馬、合成、兩難度挑戰、隱藏口令有來源可定位",()=>{
  assert.match(src("basic.cgi"),/sub keiba\s*\{/);
  assert.match(src("basic.cgi"),/\$hikarerugaku \+= \$in\{'kane'\.\$_\} \* 500/);
  assert.match(src("gouseiya.cgi"),/sub gousei_do\s*\{/);
  assert.match(src("gouseiya.cgi"),/\$zairyou1,\$zairyou2,\$zairyou3/);
  const arcade=src("gamerand.cgi");
  assert.match(arcade,/action="obatyan\.cgi"/);
  assert.match(src("obatyan.cgi"),/sub battle\s*\{/);
  assert.match(src("prezent2.cgi"),/sub get\s*\{/);
  assert.match(src("prezent2.cgi"),/log_dir\/prezent2\.cgi/);
  for(const id of ["BK-04","GM-02","GM-03","IT-07","SC-09"])
    assert.ok(audit.includes(id),id+" 應在重盤點有來源");
});

test("優惠券原始兌換依點數扣耐久，不擅自加入每日到期規則",()=>{
  const code=src("coupon.cgi");
  assert.match(code,/sub coupon_do\s*\{/);
  assert.match(code,/\$syo_taikyuu\s*-=\s*\$tensuu/);
  assert.match(code,/\$syo_syubetu eq 'ギフト' && \$syo_hinmoku eq 'クーポン'/);
  assert.match(src("dat_dir/coupon.cgi"),/^クーポン交換品:1<>福引券/m);
  const itemRow=matrix.split("\n").find(line=>line.startsWith("| IT-04 "));
  assert.ok(itemRow);
  assert.ok(!itemRow.includes("跨日／過期"),"原版沒有券跨日／過期兌換規則");
});

test("不可將空的封鎖日誌、失效連結或註解表單當可玩 CGI",()=>{
  assert.equal(statSync(new URL("../../atakka.cgi",import.meta.url)).size,0);
  assert.match(src("town_lib.pl"),/open\(AT,"> atakka\.cgi"\)/);
  assert.equal(existsSync(new URL("../../slot.php",import.meta.url)),false);
  assert.equal(existsSync(new URL("../../sugoroku/zinsei.cgi",import.meta.url)),false);
  assert.match(src("gamerand.cgi"),/<!-- <form method=POST action="kuzi\.cgi"> -->/);
  assert.match(audit,/不可統計成原版未移植功能/);
});
