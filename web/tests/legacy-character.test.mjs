import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve,dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { decodeLegacyText,parseLegacyJobs,STAT_KEYS } from "../src/engine.mjs";
import { initBankTables } from "../src/banking.mjs";
import {
  LEGACY_CHARACTER_FIELDS,parseLegacyCharacterRecords,
  inspectLegacyCharacter,importLegacyCharacter,initLegacyImportTable
} from "../src/legacy-character.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const base=resolve(root,"..");
const jobs=parseLegacyJobs(decodeLegacyText(readFileSync(join(base,"dat_dir","job.cgi"))));

function fixture(overrides={},n=69) {
  const values=Array(LEGACY_CHARACTER_FIELDS.length).fill("");
  const initial={
    k_id:"00042",name:"古代居民",pass:"OLD_PLAINTEXT_SECRET",
    money:"5000000",bank:"2000000",job:"日払いバイト",
    first_access:"1700000000",sex:"m",access_byou:"1700000200",
    super_teiki:"3000000",energy:"40",nou_energy:"35",
    sintyou:"178",taijuu:"73",job_keiken:"350",job_kaisuu:"12",
    jobsyu:"日払いバイト",house_name:"1700000222",
    house_type:"",last_syokuzi_split:"1690000000=0=0=0",
    loan_nitigaku:"0",loan_kaisuu:"0",byouki_sisuu:"0"
  };
  for(const key of STAT_KEYS)initial[key]="20";
  for(const [key,value] of Object.entries({...initial,...overrides})) {
    const i=LEGACY_CHARACTER_FIELDS.indexOf(key);
    if(i<0)throw Error("unknown fixture field "+key);
    values[i]=String(value);
  }
  return values.slice(0,n).join("<>")+"<>\n";
}
function getRecord(overrides) {
  return parseLegacyCharacterRecords(fixture(overrides))[0];
}
function createDb(filename=":memory:") {
  const db=new DatabaseSync(filename);
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL COLLATE NOCASE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);",
    "CREATE TABLE characters (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,name TEXT UNIQUE NOT NULL,gender TEXT NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,recovered_at INTEGER NOT NULL,job_id TEXT,work_progress INTEGER NOT NULL,last_work_at INTEGER NOT NULL,work_count INTEGER NOT NULL,height INTEGER NOT NULL,bmi REAL NOT NULL,stats_json TEXT NOT NULL,weight REAL NOT NULL,job_experience INTEGER NOT NULL,job_work_count INTEGER NOT NULL,mastered_job TEXT,last_school_day TEXT NOT NULL,last_gym_at INTEGER NOT NULL,gym_ready_at INTEGER NOT NULL,created_at INTEGER NOT NULL);"
  ].join("\n"));
  initBankTables(db);
  return db;
}
const opts={
  mode:"multi",username:"legacyuser42",password:"New-Strong-Password-123",
  sourceFile:"/tmp/private/00042/log.cgi",now:1760000000000,today:"2026-11-18"
};

test("從原版 kozin_sprit 精確核對 69 欄順序、識別碼與資產位置", () => {
  const source=readFileSync(join(base,"town_lib.pl"),"utf8");
  const match=source.match(/sub kozin_sprit\s*\{\s*\(([^)]+)\)\s*=\s*split/);
  assert.ok(match,"原版必須保留 kozin_sprit 定義");
  assert.deepEqual(match[1].split(",").map(s=>s.trim().slice(1)),LEGACY_CHARACTER_FIELDS);
  assert.equal(LEGACY_CHARACTER_FIELDS.length,69);
  assert.equal(LEGACY_CHARACTER_FIELDS[23],"first_access");
  assert.equal(LEGACY_CHARACTER_FIELDS[34],"super_teiki");
  assert.equal(LEGACY_CHARACTER_FIELDS[47],"loan_nitigaku");
  const records=parseLegacyCharacterRecords(fixture());
  assert.equal(records.length,1);
  assert.equal(records[0].fieldCount,69);
  assert.equal(records[0].row.k_id,"00042");
  assert.equal(records[0].row.pass,"OLD_PLAINTEXT_SECRET");
});

test("預覽精確保留現金、普通與定期、能力、工作經驗與角色建立時間", () => {
  const checked=inspectLegacyCharacter(getRecord(),jobs,{now:1760000000000,timeZone:"Asia/Taipei"});
  assert.equal(checked.originalId,"00042");
  assert.equal(checked.originalName,"古代居民");
  assert.equal(checked.character.gender,"male");
  assert.equal(checked.character.money,5000000);
  assert.equal(checked.character.bank,2000000);
  assert.equal(checked.termBalance,3000000);
  assert.equal(checked.character.height,178);
  assert.equal(checked.character.weight,73);
  assert.equal(checked.character.jobExperience,350);
  assert.equal(checked.character.jobWorkCount,12);
  assert.equal(checked.character.workCount,12);
  assert.equal(checked.character.masteredJob,"日払いバイト");
  assert.equal(checked.character.createdAt,1700000000000);
  assert.equal(checked.character.lastWorkAt,1700000222000);
  assert.ok(checked.character.jobId.startsWith("legacy-"));
  assert.equal(checked.character.stats.kokugo,20);
  assert.equal(checked.unmapped.last_syokuzi_split,"1690000000=0=0=0");
  assert.equal(checked.unmapped.pass,undefined);
  assert.equal(checked.unmapped.host,undefined);
});

test("多筆角色列表可依原版 ID 取出，不因欄位換行與尾端缺省而錯位", () => {
  const full=fixture({k_id:"001",name:"甲"})+fixture({k_id:"002",name:"乙"});
  const rows=parseLegacyCharacterRecords(full);
  assert.equal(rows.length,2);
  assert.equal(rows[1].row.name,"乙");
  const short=parseLegacyCharacterRecords(fixture({},50))[0];
  const checked=inspectLegacyCharacter(short,jobs);
  assert.ok(checked.warnings.some(x=>x.includes("尾端可選")));
  assert.equal(checked.termBalance,3000000);
  assert.equal(checked.character.jobExperience,350);
  assert.throws(()=>parseLegacyCharacterRecords(""),/空/);
  assert.throws(()=>parseLegacyCharacterRecords("invalid<>broken"),/欄位數/);
});

test("不合法現金、存款或能力值被阻擋，未知原版職業不會虛構其對應", () => {
  for(const [key,value] of [["money","-1"],["bank","Infinity"],["super_teiki","1e10"],["kokugo","0"],["kokugo","NaN"]]) {
    assert.throws(()=>inspectLegacyCharacter(getRecord({[key]:value}),jobs),/欄位|能力/);
  }
  const unknown=inspectLegacyCharacter(getRecord({job:"未知高級職業",house_type:"123",loan_kaisuu:"5",loan_nitigaku:"1200"}),jobs);
  assert.ok(unknown.warnings.some(x=>x.includes("原始職業")));
  assert.ok(unknown.warnings.some(x=>x.includes("貸款")));
  assert.ok(unknown.warnings.some(x=>x.includes("婚姻")));
  assert.equal(unknown.originalJob,"未知高級職業");
  assert.equal(unknown.unmapped.loan_kaisuu,"5");
  assert.equal(unknown.character.jobId,jobs[0].key);
  assert.throws(()=>inspectLegacyCharacter(getRecord({name:"<script>"}),jobs),/角色名稱/);
  assert.equal(inspectLegacyCharacter(getRecord({name:"<script>"}),jobs,{name:"安全名稱"}).character.name,"安全名稱");
});

test("正式匯入多人新帳號採獨立密碼，不保存原始明文密碼，且不可重複匯入", () => {
  const db=createDb();
  try{
    const inspected=inspectLegacyCharacter(getRecord(),jobs,{now:opts.now});
    const result=importLegacyCharacter(db,inspected,opts);
    assert.equal(result.originalId,"00042");
    assert.equal(result.name,"古代居民");
    const user=db.prepare("SELECT * FROM users WHERE id=?").get(result.userId);
    assert.equal(user.username,opts.username);
    assert.equal(user.password_hash.length,128);
    assert.notEqual(user.password_hash,createHash("sha256").update("OLD_PLAINTEXT_SECRET").digest("hex"));
    const ch=db.prepare("SELECT * FROM characters WHERE user_id=?").get(result.userId);
    assert.equal(ch.money,5000000);
    assert.equal(ch.bank,2000000);
    assert.equal(ch.created_at,1700000000000);
    assert.equal(ch.job_experience,350);
    assert.equal(JSON.parse(ch.stats_json).etti,20);
    const term=db.prepare("SELECT * FROM bank_accounts WHERE user_id=?").get(result.userId);
    assert.equal(term.term_balance,3000000);
    assert.equal(term.last_interest_day,opts.today);
    const ref=db.prepare("SELECT * FROM legacy_character_imports WHERE original_id=?").get("00042");
    assert.equal(ref.original_name,"古代居民");
    assert.equal(ref.source_file,"log.cgi");
    assert.ok(/^[a-f0-9]{64}$/.test(ref.source_hash));
    assert.equal(ref.unmapped_json.includes("OLD_PLAINTEXT_SECRET"),false);
    assert.equal(ref.unmapped_json.includes("1700000000"),true);
    assert.throws(()=>importLegacyCharacter(db,inspected,{...opts,username:"anotheruser"}),/已匯入/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM characters").get().n,1);
    initLegacyImportTable(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_character_imports").get().n,1);
  }finally{db.close();}
});

test("單機匯入僅能填入未建立角色的本機帳號，不允許覆蓋舊玩家",()=>{
  const db=createDb();
  try{
    const inspected=inspectLegacyCharacter(getRecord(),jobs);
    const first=importLegacyCharacter(db,inspected,{
      mode:"solo",sourceFile:"original.cgi",now:1760000000000,today:"2026-11-18"
    });
    assert.equal(db.prepare("SELECT username FROM users WHERE id=?").get(first.userId).username,"__local_player__");
    assert.throws(()=>importLegacyCharacter(db,inspectLegacyCharacter(getRecord({k_id:"00043",name:"第二人"}),jobs),{
      mode:"solo",sourceFile:"second.cgi",today:"2026-11-18"
    }),/已有角色/);
  }finally{db.close();}
});

test("用戶名稱衝突、既有角色名稱或錯誤密碼均保持原有資料",()=>{
  const db=createDb();
  try{
    const inspected=inspectLegacyCharacter(getRecord(),jobs);
    assert.throws(()=>importLegacyCharacter(db,inspected,{...opts,password:"short"}),/新密碼/);
    assert.throws(()=>importLegacyCharacter(db,inspected,{...opts,username:"__internal"}),/新帳號/);
    const first=importLegacyCharacter(db,inspected,opts);
    const another=inspectLegacyCharacter(getRecord({k_id:"00043",name:"古代居民"}),jobs);
    assert.throws(()=>importLegacyCharacter(db,another,{...opts,username:"another43"}),/相同角色名稱/);
    assert.throws(()=>importLegacyCharacter(db,inspectLegacyCharacter(getRecord({k_id:"00044",name:"別人"}),jobs),{
      ...opts,username:opts.username
    }),/帳號名稱已存在/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM characters").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n,1);
    assert.ok(first.userId>0);
  }finally{db.close();}
});

test("命令列預覽不建立資料庫或備份，套用需明確確認並保留原始位元組備份",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-legacy-import-"));
  try{
    const file=join(dir,"old.cgi");
    const src=fixture();
    writeFileSync(file,src);
    const script=join(root,"scripts","legacy-character.mjs");
    const run=(args,env={})=>spawnSync(process.execPath,[script,...args],{
      cwd:root,encoding:"utf8",env:{...process.env,DATA_DIR:dir,...env}
    });
    const prev=run(["--file",file,"--preview"]);
    assert.equal(prev.status,0,prev.stderr);
    assert.match(prev.stdout,/預覽完成/);
    assert.doesNotMatch(prev.stdout,/OLD_PLAINTEXT_SECRET/);
    const denied=run(["--file",file,"--apply","--mode","solo"]);
    assert.notEqual(denied.status,0);
    assert.match(denied.stderr,/accept-partial/);
    const dbpath=join(dir,"solo.sqlite");
    const db=createDb(dbpath);db.close();
    const imported=run(["--file",file,"--apply","--mode","solo","--accept-partial"]);
    assert.equal(imported.status,0,imported.stderr);
    assert.match(imported.stdout,/已匯入角色/);
    assert.doesNotMatch(imported.stdout,/OLD_PLAINTEXT_SECRET/);
    const stored=new DatabaseSync(dbpath);
    try{assert.equal(stored.prepare("SELECT COUNT(*) n FROM characters").get().n,1);}
    finally{stored.close();}
    const duplicate=run(["--file",file,"--apply","--mode","solo","--accept-partial"]);
    assert.notEqual(duplicate.status,0);
    assert.match(duplicate.stderr,/已匯入/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("多筆匯入來源必須指定唯一 ID，且來源內容不會因選取順序改變",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-member-list-"));
  try{
    const file=join(dir,"members.cgi");
    writeFileSync(file,fixture({k_id:"100",name:"甲"})+fixture({k_id:"101",name:"乙"}));
    const script=join(root,"scripts","legacy-character.mjs");
    const run=(args)=>spawnSync(process.execPath,[script,"--file",file,"--preview",...args],{
      cwd:root,encoding:"utf8"
    });
    assert.match(run([]).stderr,/--id/);
    const selected=run(["--id","101"]);
    assert.equal(selected.status,0,selected.stderr);
    assert.match(selected.stdout,/"originalId": "101"/);
    assert.match(selected.stdout,/"originalName": "乙"/);
    assert.match(run(["--id","999"]).stderr,/無法唯一找到/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
