import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initInventoryTables, hasActiveHealthInsurance, parseLegacyInsurance, DAY_MS } from "../src/inventory.mjs";
import { decodeLegacyText } from "../src/engine.mjs";
import { LEGACY_ITEM_FIELDS, parseLegacyInventory, importLegacyInventory,
  listLegacyInventoryItems, initLegacyInventoryTables } from "../src/legacy-inventory.mjs";

const here=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const original=resolve(here,"..");
const ORIGINAL_NOW=1700000000000;
const nowSecs=Math.floor(ORIGINAL_NOW/1000);
const insurance=parseLegacyInsurance(decodeLegacyText(readFileSync(join(original,"dat_dir","syouhin.cgi"))));
function item(fields={}) {
  const base={
    category:"日用品",name:"健康保険",durability:"30",durability_unit:"日",
    price:"10000",purchased_at:String(nowSecs-2*86400),last_used_at:"0",
    effect:"無"
  };
  const data={...base,...fields};
  return LEGACY_ITEM_FIELDS.map(k=>data[k]??"").join("<>")+"<>";
}
const record=()=>item()+"\n"+item({
  category:"薬",name:"おばあちゃんの知恵薬",durability:"2",
  durability_unit:"回",effect:"万能,20",purchased_at:"",comment:"原版原始備註<>以外文字"
}).replace("原版原始備註<>以外文字","原版原始備註")+"\n";
function dbFixture(filename=":memory:"){
  const db=new DatabaseSync(filename);
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),money INTEGER NOT NULL);",
    "CREATE TABLE legacy_character_imports(original_id TEXT PRIMARY KEY,target_user_id INTEGER UNIQUE NOT NULL REFERENCES users(id));",
    "INSERT INTO users(id,username) VALUES(1,'first'),(2,'second');",
    "INSERT INTO characters(user_id,money) VALUES(1,80000),(2,50000);",
    "INSERT INTO legacy_character_imports(original_id,target_user_id) VALUES('00042',1),('00043',2);"
  ].join("\n"));
  return db;
}
const opts={originalId:"00042",sourceFile:"/private/member/00042/mono.cgi",now:ORIGINAL_NOW};

test("對照原版 syouhin_sprit 33 欄順序，不擅自改名或遺漏原始欄位",()=>{
  const lib=readFileSync(join(original,"town_lib.pl"),"utf8");
  const match=lib.match(/sub syouhin_sprit\s*\{\s*\(([^)]+)\)\s*=\s*split/);
  assert.ok(match);
  const columns=match[1].split(",").map(x=>x.trim().slice(1));
  assert.equal(columns.length,33);
  assert.equal(LEGACY_ITEM_FIELDS.length,33);
  const indexes=[[0,"syo_syubetu"],[1,"syo_hinmoku"],[9,"syo_kouka"],
    [17,"syo_nedan"],[21,"syo_taikyuu"],[22,"syo_taikyuu_tani"],
    [26,"syo_siyou_date"],[30,"syo_kounyuubi"],[31,"tanka"],[32,"tokubai"]];
  for(const [i,key] of indexes) assert.equal(columns[i],key);
});

test("原版 mono.cgi 多筆解析保留所有原始欄位與行號，僅識別健康保險",()=>{
  const parsed=parseLegacyInventory(record(),{now:ORIGINAL_NOW});
  assert.equal(parsed.records.length,2);
  assert.equal(parsed.records[0].sourceLine,1);
  assert.equal(parsed.records[1].sourceLine,2);
  assert.equal(parsed.records[0].rawFields.length,33);
  assert.equal(parsed.records[1].rawFields[1],"おばあちゃんの知恵薬");
  assert.equal(parsed.records[1].effect,"万能,20");
  assert.equal(parsed.records[1].active,null);
  assert.equal(parsed.records[0].isInsurance,true);
  assert.equal(parsed.records[0].active,true);
  assert.equal(parsed.records[0].expiresAt,ORIGINAL_NOW+28*DAY_MS);
  assert.ok(parsed.warnings.some(x=>x.includes("其他物品")));
  assert.match(parsed.sourceHash,/^[a-f0-9]{64}$/);
});

test("不存在或格式異常的欄位、中途插入分隔符、重複健康保險都拒絕，不會猜測",()=>{
  assert.throws(()=>parseLegacyInventory("日用品<>健康保険",{now:ORIGINAL_NOW}),/欄位數/);
  assert.throws(()=>parseLegacyInventory(record().replace("原版原始備註","備註<>破壞格式"),{now:ORIGINAL_NOW}),/欄位數/);
  assert.throws(()=>parseLegacyInventory(item({durability:"-1"}),{now:ORIGINAL_NOW}),/耐久/);
  assert.throws(()=>parseLegacyInventory(item({purchased_at:""}),{now:ORIGINAL_NOW}),/購入時間/);
  assert.throws(()=>parseLegacyInventory(item({durability_unit:"回"}),{now:ORIGINAL_NOW}),/耐久/);
  assert.throws(()=>parseLegacyInventory(item({purchased_at:String(nowSecs+86400)}),{now:ORIGINAL_NOW}),/晚於/);
  assert.throws(()=>parseLegacyInventory(item()+"\n"+item(),{now:ORIGINAL_NOW}),/多筆健康保險/);
  assert.throws(()=>parseLegacyInventory(item(),{now:ORIGINAL_NOW,sourceHash:"fake"}),/摘要/);
});

test("合法已匯入角色 ID 才能收回原始物品，全部 33 欄存入唯讀封存",()=>{
  const db=dbFixture();
  try{
    const parsed=parseLegacyInventory(record(),{now:ORIGINAL_NOW});
    const summary=importLegacyInventory(db,parsed,opts);
    assert.equal(summary.userId,1);
    assert.equal(summary.items,2);
    assert.equal(summary.insuranceRestored,true);
    assert.equal(summary.insuranceExpiresAt,ORIGINAL_NOW+28*DAY_MS);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,80000);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,50000);
    const archive=db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1 ORDER BY source_line").all();
    assert.equal(archive.length,2);
    assert.deepEqual(JSON.parse(archive[0].raw_fields_json),parsed.records[0].rawFields);
    assert.deepEqual(JSON.parse(archive[1].raw_fields_json),parsed.records[1].rawFields);
    assert.equal(listLegacyInventoryItems(db,1).length,2);
    assert.equal(listLegacyInventoryItems(db,2).length,0);
    assert.equal(listLegacyInventoryItems(db,1)[0].readOnly,true);
    assert.equal(hasActiveHealthInsurance(db,1,insurance,ORIGINAL_NOW),true);
    assert.equal(hasActiveHealthInsurance(db,2,insurance,ORIGINAL_NOW),false);
    assert.equal(db.prepare("SELECT source_file,source_hash,item_count FROM legacy_inventory_imports WHERE original_id='00042'").get().source_file,"mono.cgi");
    assert.throws(()=>importLegacyInventory(db,parsed,opts),/已匯入/);
    assert.throws(()=>importLegacyInventory(db,parsed,{...opts,originalId:"unknown"}),/找不到/);
    initLegacyInventoryTables(db);
    assert.equal(listLegacyInventoryItems(db,1).length,2);
  }finally{db.close();}
});

test("缺少角色匯入對照表或來源 ID 不符，不建立任何持有物封存或交易",()=>{
  const db=dbFixture();
  try{
    db.exec("DROP TABLE legacy_character_imports;");
    const parsed=parseLegacyInventory(record(),{now:ORIGINAL_NOW});
    assert.throws(()=>importLegacyInventory(db,parsed,opts),/先使用原版角色/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='legacy_inventory_items'").get().n,0);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,80000);
  }finally{db.close();}
});

test("既有 Web 保險不得被原版存檔覆蓋，匯入失敗不殘留任何新表",()=>{
  const db=dbFixture();
  try {
    initInventoryTables(db);
    db.prepare("INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at) VALUES(1,'health-insurance',?,?)").run(ORIGINAL_NOW+60*DAY_MS,ORIGINAL_NOW);
    const parsed=parseLegacyInventory(record(),{now:ORIGINAL_NOW});
    assert.throws(()=>importLegacyInventory(db,parsed,opts),/拒絕覆蓋/);
    assert.equal(db.prepare("SELECT active_until FROM inventory_items WHERE user_id=1").get().active_until,ORIGINAL_NOW+60*DAY_MS);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='legacy_inventory_items'").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='legacy_inventory_imports'").get().n,0);
  }finally{db.close();}
});

test("原版健康保險已過期時只封存物品，不啟用折扣，也不覆蓋現有保險",()=>{
  const db=dbFixture();
  try{
    initInventoryTables(db);
    db.prepare("INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at) VALUES(1,'health-insurance',?,?)").run(ORIGINAL_NOW+60*DAY_MS,ORIGINAL_NOW);
    const source=item({durability:"2",purchased_at:String(nowSecs-10*86400)});
    const parsed=parseLegacyInventory(source,{now:ORIGINAL_NOW});
    assert.equal(parsed.insurance.active,false);
    const summary=importLegacyInventory(db,parsed,opts);
    assert.equal(summary.insuranceRestored,false);
    assert.equal(db.prepare("SELECT active_until FROM inventory_items WHERE user_id=1").get().active_until,ORIGINAL_NOW+60*DAY_MS);
    assert.equal(listLegacyInventoryItems(db,1).length,1);
  }finally{db.close();}
});

test("CLI 預覽不寫檔，正式匯入建立私有原始備份且原始檔不被修改",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-mono-import-test-"));
  try{
    const file=join(dir,"mono.cgi");
    const originalBytes=Buffer.from(record(),"utf8");
    writeFileSync(file,originalBytes);
    const dbFile=join(dir,"solo.sqlite");
    const db=dbFixture(dbFile);db.close();
    const script=join(here,"scripts","legacy-inventory.mjs");
    const execute=(params)=>spawnSync(process.execPath,[script,...params],{
      encoding:"utf8",env:{...process.env,DATA_DIR:dir}
    });
    const preview=execute(["--file",file,"--id","00042","--preview"]);
    assert.equal(preview.status,0,preview.stderr);
    assert.match(preview.stdout,/預覽完成/);
    assert.deepEqual(readdirSync(dir).sort(),["mono.cgi","solo.sqlite"]);
    const blocked=execute(["--file",file,"--id","00042","--apply","--mode","solo"]);
    assert.notEqual(blocked.status,0);
    assert.match(blocked.stderr,/accept-partial/);
    const run=execute(["--file",file,"--id","00042","--apply","--mode","solo","--accept-partial"]);
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/已安全保存原版物品/);
    assert.deepEqual(readFileSync(file),originalBytes);
    const backups=readdirSync(join(dir,"legacy-backups"));
    assert.equal(backups.length,1);
    const saved=join(dir,"legacy-backups",backups[0]);
    assert.deepEqual(readFileSync(saved),originalBytes);
    if(process.platform!=="win32")assert.equal(statSync(saved).mode&0o777,0o600);
    const stored=new DatabaseSync(dbFile);
    try{
      assert.equal(listLegacyInventoryItems(stored,1).length,2);
      assert.equal(stored.prepare("SELECT COUNT(*) n FROM legacy_inventory_imports").get().n,1);
    }finally{stored.close();}
    const repeated=execute(["--file",file,"--id","00042","--apply","--mode","solo","--accept-partial"]);
    assert.notEqual(repeated.status,0);
    assert.match(repeated.stderr,/已匯入/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test("CLI 阻擋 member 數字資料夾與 --id 不符，以免指向其他角色的物品檔",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-mono-source-id-"));
  try{
    const folder=join(dir,"member","00043");
    mkdirSync(folder,{recursive:true});
    const file=join(folder,"mono.cgi");
    writeFileSync(file,item(),"utf8");
    const processResult=spawnSync(process.execPath,[
      join(here,"scripts","legacy-inventory.mjs"),
      "--file",file,"--id","00042","--preview"
    ],{encoding:"utf8",env:{...process.env,DATA_DIR:dir}});
    assert.notEqual(processResult.status,0);
    assert.match(processResult.stderr,/與 --id 不符/);
    assert.equal(readdirSync(dir).sort().join(","),"member");
  } finally {rmSync(dir,{recursive:true,force:true});}
});
