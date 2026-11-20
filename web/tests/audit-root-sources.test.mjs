import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync,statSync } from "node:fs";
import { decodeLegacyText } from "../src/engine.mjs";

const root=new URL("../../",import.meta.url);
const read=(path)=>decodeLegacyText(readFileSync(new URL(path,root)));
const doc=readFileSync(new URL("../docs/phase30-root-source-classification.md",import.meta.url),"utf8");
const matrix=readFileSync(new URL("../docs/migration-audit.md",import.meta.url),"utf8");

test("根目錄 CGI/PL 來源檔案數與第二層清冊同步",()=>{
  const files=readdirSync(root).filter(name=>/\.(?:cgi|pl)$/.test(name)).sort();
  assert.equal(files.length,67,"來源增加／刪除時必須更新第二層盤點");
  for(const name of ["check.cgi","host.cgi","unei_2.pl","unit_temp.pl",
    "dene2.cgi","guestlog_00.cgi","hostime.cgi"])
    assert.ok(files.includes(name),name);
});

test("原版 unit_temp.pl 確實完全等於 unit.pl，不可重複統計遊戲入口",()=>{
  assert.deepEqual(readFileSync(new URL("unit_temp.pl",root)),
    readFileSync(new URL("unit.pl",root)));
  assert.match(doc,/同版副本，不是新設施/);
});

test("管理、診斷程式不得算成可玩 CGI；零位元組檔不可臆測行為",()=>{
  for(const file of ["dene2.cgi","guestlog_00.cgi","hostime.cgi","atakka.cgi"])
    assert.equal(statSync(new URL(file,root)).size,0,file+" 並非可執行 CGI");
  assert.match(read("check.cgi"),/eval \$cgiroom_perl/);
  assert.match(read("host.cgi"),/許可ホスト変更/);
  assert.match(doc,/不列入玩家移植/);
});

test("原版住宅確有員工教育模組且目前未移植，清冊獨立保留",()=>{
  assert.match(read("original_house.cgi"),/require '\.\/unei_2\.pl';/);
  assert.match(read("original_house.cgi"),/\&unei_2;/);
  assert.match(read("unei_2.pl"),/sub unei_2\s*\{/);
  assert.match(read("unei_2.pl"),/\$syainjougen\s*=\s*5/);
  assert.match(read("unei_2.pl"),/\$in\{'command'\} eq "do_unei"/);
  assert.match(matrix,/HS-04 企業員工教育／員工紀錄/);
  assert.match(doc,/HS-04/);
});
