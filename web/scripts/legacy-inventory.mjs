#!/usr/bin/env node
// 對照已經由 legacy-character.mjs 匯入的原版角色 ID，安全封存 mono.cgi。
// 預覽不寫任何檔案；正式執行只允許 --apply --accept-partial。
import { readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync } from "node:fs";
import { resolve,basename,dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyInventory,importLegacyInventory } from "../src/legacy-inventory.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
function argsFrom(argv) {
  const args={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(["--preview","--apply","--accept-partial"].includes(key)){
      if(args[key])throw new Error("參數重複："+key);
      args[key]=true;
    }else if(["--file","--id","--mode"].includes(key)){
      if(args[key]||!argv[i+1]||argv[i+1].startsWith("--"))
        throw new Error("請正確提供參數："+key);
      args[key]=argv[++i];
    }else throw new Error("不支援的參數："+key);
  }
  if(!args["--file"]||!args["--id"])
    throw new Error("請同時指定 --file 原始 mono.cgi 路徑及 --id 原始角色編號");
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(args["--id"]))
    throw new Error("原始角色 ID 格式不正確");
  if(Boolean(args["--preview"])===Boolean(args["--apply"]))
    throw new Error("請且僅選擇 --preview 或 --apply");
  if(args["--mode"]&&!["solo","multi"].includes(args["--mode"]))
    throw new Error("--mode 只能是 solo 或 multi");
  if(args["--apply"]&&(!args["--mode"]||!args["--accept-partial"]))
    throw new Error("正式匯入必須加上 --mode 與 --accept-partial");
  return args;
}
function backup(bytes,path,mode) {
  const home=resolve(process.env.DATA_DIR||join(root,"data"));
  const dir=join(home,"legacy-backups");
  mkdirSync(dir,{recursive:true,mode:0o700});
  const hash=createHash("sha256").update(bytes).digest("hex");
  const name=basename(path).replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,64);
  const target=join(dir,mode+"-mono-"+hash.slice(0,20)+"-"+name);
  if(!existsSync(target)){
    writeFileSync(target,bytes,{flag:"wx",mode:0o600});
    if(process.platform!=="win32")chmodSync(target,0o600);
  }else if(createHash("sha256").update(readFileSync(target)).digest("hex")!==hash){
    throw new Error("同名備份內容摘要不同，停止匯入");
  }
  return target;
}
try{
  const options=argsFrom(process.argv.slice(2));
  const source=resolve(options["--file"]);
  const bytes=readFileSync(source);
  if(bytes.length>4*1024*1024)throw new Error("原始物品檔案超出 4 MiB 限制");
  const hash=createHash("sha256").update(bytes).digest("hex");
  const now=Date.now();
  const parsed=parseLegacyInventory(decodeLegacyText(bytes),{now,sourceHash:hash});
  const preview={
    source:basename(source),originalId:options["--id"],itemCount:parsed.records.length,
    items:parsed.records.map(row=>({
      sourceLine:row.sourceLine,category:row.category,name:row.name,
      durability:row.durability,unit:row.durabilityUnit,
      isInsurance:row.isInsurance,insuranceActive:row.isInsurance?row.active:undefined
    })),
    insuranceExpiry:parsed.insurance?.active?
      new Date(parsed.insurance.expiresAt).toISOString():null,
    warnings:parsed.warnings
  };
  console.log(JSON.stringify(preview,null,2));
  if(options["--preview"])console.log("預覽完成，沒有建立或修改資料庫、沒有備份來源檔案。");
  else{
    const dataDir=resolve(process.env.DATA_DIR||join(root,"data"));
    const dbPath=join(dataDir,options["--mode"]+".sqlite");
    if(!existsSync(dbPath))
      throw new Error("Web 資料庫不存在，請先執行 npm start 初始化並關閉伺服器");
    const saved=backup(bytes,source,options["--mode"]);
    const db=new DatabaseSync(dbPath);
    try{
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=2500");
      const result=importLegacyInventory(db,parsed,{
        originalId:options["--id"],sourceFile:source,now
      });
      console.log("已安全保存原版物品："+result.items+" 筆。"+
        (result.insuranceRestored?"已還原有效健康保險。":"沒有需要啟用的健康保險。"));
      console.log("原始檔案的獨立備份："+saved);
    }finally{db.close();}
  }
}catch(error){
  console.error("原版物品匯入失敗："+error.message);
  process.exitCode=1;
}
