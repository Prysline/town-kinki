#!/usr/bin/env node
// 從單筆 member/<ID>/log.cgi 或多筆 log_dir/memberlog.cgi 安全匯入角色。
// 必須先執行 --preview。正式匯入需要 --apply --accept-partial，原始 CGI 保留獨立備份。
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { resolve, basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { decodeLegacyText, parseLegacyJobs } from "../src/engine.mjs";
import { calendarDay } from "../src/training.mjs";
import {
  parseLegacyCharacterRecords, inspectLegacyCharacter, importLegacyCharacter
} from "../src/legacy-character.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repoRoot = resolve(webRoot,"..");

function parseArgs(argv) {
  const args = {};
  const keys = new Set(["--file","--mode","--id","--username","--name"]);
  const flags = new Set(["--preview","--apply","--accept-partial"]);
  for(let i=0;i<argv.length;i++){
    const token=argv[i];
    if (keys.has(token)) {
      if (!argv[i+1] || argv[i+1].startsWith("--") || Object.hasOwn(args,token))
        throw new Error("請提供且僅指定一次參數：" + token);
      args[token]=argv[++i];
    } else if(flags.has(token)) {
      if(args[token]) throw new Error("參數重複：" + token);
      args[token]=true;
    } else throw new Error("不支援的參數：" + token);
  }
  if (!args["--file"]) throw new Error("請使用 --file 指定原始 CGI 角色存檔");
  if (Boolean(args["--preview"]) === Boolean(args["--apply"]))
    throw new Error("請選擇 --preview 或 --apply，不能兩者同時使用");
  if (args["--mode"] && !["solo","multi"].includes(args["--mode"]))
    throw new Error("模式僅支援 solo 或 multi");
  if (args["--apply"] && !args["--mode"])
    throw new Error("正式匯入必須明確指定 --mode solo 或 --mode multi");
  if (args["--apply"] && !args["--accept-partial"])
    throw new Error("原版其他系統尚未移植，正式匯入需要明確指定 --accept-partial");
  return args;
}

function backupSource(bytes,source,mode) {
  const dataDir=resolve(process.env.DATA_DIR || resolve(webRoot,"data"));
  const folder=join(dataDir,"legacy-backups");
  mkdirSync(folder,{recursive:true,mode:0o700});
  const hash=createHash("sha256").update(bytes).digest("hex");
  const safeFilename=basename(source).replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,70);
  const dest=join(folder,mode+"-"+hash.slice(0,20)+"-"+safeFilename);
  if(!existsSync(dest)) {
    writeFileSync(dest,bytes,{flag:"wx",mode:0o600});
    if(process.platform !== "win32")chmodSync(dest,0o600);
  } else {
    const previous=createHash("sha256").update(readFileSync(dest)).digest("hex");
    if(previous!==hash)throw new Error("備份名稱重複且內容不同，停止匯入");
  }
  return dest;
}

try {
  const opts=parseArgs(process.argv.slice(2));
  const source=resolve(opts["--file"]);
  const bytes=readFileSync(source);
  if(bytes.length > 32*1024*1024)throw new Error("單次角色檔案超出 32 MiB 上限");
  const records=parseLegacyCharacterRecords(decodeLegacyText(bytes));
  const id=opts["--id"];
  if(!id && records.length !== 1)
    throw new Error("檔案包含 "+records.length+" 筆角色，請使用 --id 指定原版角色編號");
  const candidates=id?records.filter(r=>r.row.k_id===id):records;
  if(candidates.length!==1)
    throw new Error("無法唯一找到指定原版角色 ID，請檢查重複或不存在的編號");
  const jobFile=resolve(repoRoot,"dat_dir","job.cgi");
  const jobs=parseLegacyJobs(decodeLegacyText(readFileSync(jobFile)));
  if(!jobs.length)throw new Error("無法讀取原始職業檔案");
  const mode=opts["--mode"] || "solo";
  const now=Date.now();
  const timeZone=process.env.GAME_TIMEZONE || "Asia/Taipei";
  const inspected=inspectLegacyCharacter(candidates[0],jobs,{
    name:opts["--name"],now,timeZone
  });
  const output={
    sourceFile:basename(source),sourceLine:candidates[0].sourceLine,
    originalId:inspected.originalId,originalName:inspected.originalName,
    webName:inspected.character.name,originalJob:inspected.originalJob,
    webJob:jobs.find(j=>j.key===inspected.character.jobId)?.name,
    money:inspected.character.money,ordinaryBank:inspected.character.bank,
    termBank:inspected.termBalance,stats:inspected.character.stats,
    warnings:inspected.warnings,
    note:"原版密碼不移轉。原始房屋、裝備、婚姻、疾病、貸款及其他未移植系統，僅保存必要的非認證備查欄位。"
  };
  console.log(JSON.stringify(output,null,2));
  if(opts["--preview"]) {
    console.log("預覽完成，未變更資料庫、未複製或修改來源檔案。");
  } else {
    const dbDir=resolve(process.env.DATA_DIR || resolve(webRoot,"data"));
    const path=join(dbDir,mode+".sqlite");
    if(!existsSync(path))
      throw new Error("資料庫尚未初始化，請先執行 npm start 再關閉伺服器");
    const password=process.env.TOWN_IMPORT_PASSWORD;
    if(mode==="multi" && (!password || !opts["--username"]))
      throw new Error("多人匯入需要 --username 和環境變數 TOWN_IMPORT_PASSWORD；不可使用原版密碼");
    const backup=backupSource(bytes,source,mode);
    const db=new DatabaseSync(path);
    try{
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=2500");
      const result=importLegacyCharacter(db,inspected,{
        mode,username:opts["--username"],password,
        sourceFile:source,now,today:calendarDay(now,timeZone)
      });
      console.log("已匯入角色："+result.name+"（原版 ID "+result.originalId+"）。");
      console.log("原始檔案的獨立備份位置："+backup);
      if(mode==="multi")console.log("請使用指定的新帳號密碼登入；原版密碼不再適用。");
    }finally{db.close();}
  }
} catch(error) {
  console.error("角色轉檔失敗："+error.message);
  process.exitCode=1;
}
