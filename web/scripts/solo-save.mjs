#!/usr/bin/env node
// 第67階段：只處理新版 Web 單機 SQLite 存檔；絕不接觸原版 CGI 玩家檔。
// backup 使用 SQLite 線上快照（含 WAL 中已提交交易），不可直接複製使用中的 .sqlite。
// restore 只還原到沒有 solo.sqlite 的新資料夾，不覆寫目前單機存檔。
import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, rmSync, statSync, openSync, readSync, closeSync, realpathSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const REQUIRED_TABLES=["users","characters","solo_clock"];

export function parseOptions(args){
  const [command,...rest]=args;
  if(!["backup","verify","restore"].includes(command))
    throw new Error("用法：solo-save.mjs backup --data-dir <資料夾> --output <備份檔>；verify --file <備份檔>；restore --file <備份檔> --data-dir <新資料夾>");
  if(rest.length%2!==0)throw new Error("每個參數都必須有值");
  const flags={};
  const allowed=new Set(["--data-dir","--output","--file"]);
  for(let i=0;i<rest.length;i+=2){
    if(!allowed.has(rest[i])||flags[rest[i]]!==undefined||
      !rest[i+1]||rest[i+1].startsWith("--"))
      throw new Error("未知、重複或未指定值的參數："+rest[i]);
    flags[rest[i]]=rest[i+1];
  }
  const names=command==="backup"?["--output"]:["--file"];
  if(command==="verify"&&flags["--data-dir"]!==undefined)
    throw new Error("verify 不接受 --data-dir");
  if(command==="verify"&&flags["--output"]!==undefined)
    throw new Error("verify 不接受 --output");
  if(command==="restore"&&flags["--output"]!==undefined)
    throw new Error("restore 不接受 --output");
  if(command==="backup"&&flags["--file"]!==undefined)
    throw new Error("backup 不接受 --file");
  for(const name of names)if(!flags[name])throw new Error("缺少必要參數："+name);
  return {
    command,
    dataDir:resolve(flags["--data-dir"]||process.env.DATA_DIR||resolve(WEB_ROOT,"data")),
    file:resolve(flags["--file"]||flags["--output"])
  };
}

function fileSha256(file){
  const hash=createHash("sha256");
  const fd=openSync(file,"r");
  const chunk=Buffer.allocUnsafe(1024*1024);
  try{
    let n;
    while((n=readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,n));
    return hash.digest("hex");
  }finally{closeSync(fd);}
}
function sourcePath(file){
  if(!existsSync(file)||!statSync(file).isFile())
    throw new Error("找不到單機 SQLite 存檔／備份檔："+file);
  // SQLite 會依真實檔案路徑開啟 WAL，不能只檢查符號連結名稱的旁檔。
  return realpathSync(file);
}
function sourceDatabase(file){
  return new DatabaseSync(sourcePath(file),{readOnly:true});
}

// 單檔備份的 SHA-256 不包含旁檔；有 WAL 內容時不得宣稱可單檔還原。
function hasWalData(file){
  return (statSync(file+"-wal",{throwIfNoEntry:false})?.size??0)>0;
}
function assertStandaloneSnapshot(file,hadWal=false){
  if(hadWal||hasWalData(file))
    throw new Error("來源含有 WAL 內容，不能驗證／還原為單檔備份；請先用 backup 建立一致快照");
}

export function verifySoloDatabase(file){
  file=sourcePath(file);
  const hadWal=hasWalData(file);
  const db=sourceDatabase(file);
  try{
    const integrity=db.prepare("PRAGMA integrity_check").all();
    if(integrity.length!==1||integrity[0].integrity_check!=="ok")
      throw new Error("SQLite 完整性檢查失敗");
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
    if(REQUIRED_TABLES.some(table=>!tables.has(table)))
      throw new Error("不是可繼續遊玩的 Web 單機存檔：缺少必要資料表");
    const foreignKeys=db.prepare("PRAGMA foreign_key_check").all();
    if(foreignKeys.length)throw new Error("SQLite 存檔存在外鍵參照不一致");
    const users=db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    const characters=db.prepare("SELECT COUNT(*) AS n FROM characters").get().n;
    const clock=db.prepare("SELECT COUNT(*) AS n FROM solo_clock WHERE id=1").get().n;
    if(users<1||clock!==1||characters>users)
      throw new Error("單機角色或遊戲時間資料缺失");
    assertStandaloneSnapshot(file,hadWal);
    const summary={users,characters,bytes:statSync(file).size,sha256:fileSha256(file)};
    assertStandaloneSnapshot(file);
    return summary;
  }finally{db.close();}
}

function temporaryPath(target){
  return target+"."+randomBytes(10).toString("hex")+".tmp";
}
function publishNewFile(temp,target){
  // hard link 為同資料夾原子新建：即使另一程序同時建立 target 也不會覆寫。
  linkSync(temp,target);
}

export async function backUpSolo({dataDir,file}){
  const source=resolve(dataDir,"solo.sqlite");
  if(file===source)throw new Error("備份目的地不可是正在使用的單機存檔");
  if(existsSync(file))throw new Error("備份檔已存在，為避免覆寫請改用新檔名");
  mkdirSync(dirname(file),{recursive:true});
  const temp=temporaryPath(file);
  let db;
  try{
    db=sourceDatabase(source);
    // 不直接複製 WAL 模式的 solo.sqlite：backup() 會取得一致的已提交快照。
    await backup(db,temp);
    db.close();db=null;
    chmodSync(temp,0o600);
    const summary=verifySoloDatabase(temp);
    publishNewFile(temp,file);
    return {file,...summary};
  }finally{
    if(db)db.close();
    rmSync(temp,{force:true});
  }
}

export function restoreSolo({dataDir,file}){
  const destination=resolve(dataDir,"solo.sqlite");
  if(file===destination)throw new Error("不能把目前資料庫當成還原來源");
  // 不支援覆寫：必須停用原伺服器，改以全新 DATA_DIR 啟動還原結果。
  if([destination,destination+"-wal",destination+"-shm"].some(existsSync))
    throw new Error("目標已有單機存檔／SQLite WAL，拒絕覆寫；請改用全新 DATA_DIR");
  file=sourcePath(file);
  const original=verifySoloDatabase(file);
  mkdirSync(dataDir,{recursive:true});
  const temp=temporaryPath(destination);
  try{
    copyFileSync(file,temp);
    chmodSync(temp,0o600);
    const copied=verifySoloDatabase(temp);
    if(original.sha256!==copied.sha256)
      throw new Error("複製後的備份雜湊與來源不一致");
    assertStandaloneSnapshot(file);
    if(fileSha256(file)!==original.sha256)
      throw new Error("還原期間來源備份已變動，請使用固定快照");
    assertStandaloneSnapshot(file);
    publishNewFile(temp,destination);
    return {file:destination,...copied};
  }finally{rmSync(temp,{force:true});}
}

async function main(){
  const opts=parseOptions(process.argv.slice(2));
  const result=opts.command==="backup"?await backUpSolo(opts):
    opts.command==="restore"?restoreSolo(opts):{file:opts.file,...verifySoloDatabase(opts.file)};
  const action={backup:"已建立單機存檔快照",verify:"單機備份完整性檢查通過",restore:"已還原單機存檔至新資料夾"}[opts.command];
  console.log(action+"："+result.file);
  console.log("角色數："+result.characters+"；備份檔大小："+result.bytes+" 位元組");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error("單機存檔操作失敗："+error.message);process.exitCode=1;});
