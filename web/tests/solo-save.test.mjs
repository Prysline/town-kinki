import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { backUpSolo,restoreSolo,verifySoloDatabase,parseOptions } from "../scripts/solo-save.mjs";

function makeFixture(directory,{orphan=false}={}){
  const dir=join(directory,"data");
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  db.exec([
    "PRAGMA journal_mode=WAL;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);",
    "CREATE TABLE solo_clock(id INTEGER PRIMARY KEY,offset_ms INTEGER);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),name TEXT,money INTEGER);",
    "INSERT INTO users(id,name) VALUES(1,'solo_user');",
    "INSERT INTO solo_clock(id,offset_ms) VALUES(1,60000);",
    "INSERT INTO characters(id,user_id,name,money) VALUES(1,1,'可還原單機角色',101000);"
  ].join("\n"));
  if(orphan){
    db.exec("PRAGMA foreign_keys=OFF;INSERT INTO characters(id,user_id,name,money) VALUES(2,888,'孤立角色',100);");
  }
  return {db,dataDir:dir};
}

test("第67階段：線上 WAL 一致性備份、SHA-256、只還原到新資料夾且保留原單機資產",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-phase67-solo-save-"));
  let db;
  try{
    const fixture=makeFixture(dir);db=fixture.db;
    const target=join(dir,"backups","2026-11-22-solo.sqlite");
    const snapshot=await backUpSolo({dataDir:fixture.dataDir,file:target});
    assert.equal(snapshot.users,1);
    assert.equal(snapshot.characters,1);
    assert.match(snapshot.sha256,/^[0-9a-f]{64}$/);
    assert.equal(verifySoloDatabase(target).sha256,snapshot.sha256);
    assert.equal(existsSync(join(dir,"backups","2026-11-22-solo.sqlite")),true);
    db.exec("UPDATE characters SET money=100 WHERE id=1;");
    assert.equal(db.prepare("SELECT money FROM characters WHERE id=1").get().money,100);
    const restoredDir=join(dir,"restored-solo");
    const restored=restoreSolo({file:target,dataDir:restoredDir});
    assert.equal(restored.sha256,snapshot.sha256);
    const saved=new DatabaseSync(join(restoredDir,"solo.sqlite"),{readOnly:true});
    try{
      assert.equal(saved.prepare("SELECT name FROM characters WHERE id=1").get().name,"可還原單機角色");
      assert.equal(saved.prepare("SELECT money FROM characters WHERE id=1").get().money,101000);
      assert.equal(saved.prepare("SELECT offset_ms FROM solo_clock WHERE id=1").get().offset_ms,60000);
    }finally{saved.close();}
    assert.throws(()=>restoreSolo({file:target,dataDir:restoredDir}),/拒絕覆寫/);
    await assert.rejects(()=>backUpSolo({dataDir:fixture.dataDir,file:target}),/已存在/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE id=1").get().money,100,
      "備份與還原操作均不能偷偷回滾或覆寫正在遊玩的原資料庫");
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test("第67階段：CLI 只接受明確參數，不會把原始CGI檔、已存在單機存檔或不完整資料庫當成可還原資料",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-phase67-guard-"));
  let db;
  try{
    const x=makeFixture(dir);db=x.db;
    const file=join(dir,"export.sqlite");
    assert.throws(()=>parseOptions(["backup","--output","x","--output","y"]),/重複/);
    assert.throws(()=>parseOptions(["restore","--file","x","--output","y"]),/不接受/);
    assert.throws(()=>parseOptions(["backup","--data-dir","x"]),/缺少必要/);
    await assert.rejects(()=>backUpSolo({dataDir:x.dataDir,file:join(x.dataDir,"solo.sqlite")}),/不可/);
    assert.throws(()=>restoreSolo({file:join(x.dataDir,"solo.sqlite"),dataDir:x.dataDir}),/不能/);
    await backUpSolo({dataDir:x.dataDir,file});
    const existing=join(dir,"occupied");
    mkdirSync(existing);
    writeFileSync(join(existing,"solo.sqlite"),"NEVER REPLACE");
    assert.throws(()=>restoreSolo({dataDir:existing,file}),/拒絕覆寫/);
    assert.equal(readFileSync(join(existing,"solo.sqlite"),"utf8"),"NEVER REPLACE");
    const onlySidecar=join(dir,"sidecar-only");
    mkdirSync(onlySidecar);
    writeFileSync(join(onlySidecar,"solo.sqlite-wal"),"ACTIVE WAL");
    assert.throws(()=>restoreSolo({dataDir:onlySidecar,file}),/拒絕覆寫/);
    assert.equal(existsSync(join(onlySidecar,"solo.sqlite")),false);
    const garbage=join(dir,"garbage.sqlite");
    writeFileSync(garbage,"不是合法資料庫");
    assert.throws(()=>verifySoloDatabase(garbage));
    assert.throws(()=>restoreSolo({dataDir:join(dir,"bad-restore"),file:garbage}));
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test("第67階段：外鍵已毀損時拒絕把錯誤資料作備份或還原，正式 CLI 報錯且不建立目標",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-phase67-invalid-"));
  let db;
  try{
    const fixture=makeFixture(dir,{orphan:true});db=fixture.db;
    const bad=join(dir,"invalid.sqlite");
    assert.throws(()=>verifySoloDatabase(join(fixture.dataDir,"solo.sqlite")),/外鍵/);
    await assert.rejects(()=>backUpSolo({dataDir:fixture.dataDir,file:bad}),/外鍵/);
    assert.equal(existsSync(bad),false);
    const invoked=spawnSync(process.execPath,["scripts/solo-save.mjs","backup",
      "--data-dir",fixture.dataDir,"--output",bad],{
      cwd:new URL("..",import.meta.url),encoding:"utf8"
    });
    assert.notEqual(invoked.status,0);
    assert.match(invoked.stderr,/單機存檔操作失敗/);
    assert.equal(existsSync(bad),false);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
