import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {decodeLegacyText,STAT_KEYS} from "../src/engine.mjs";
import {parseOsakaRules,parseOsakaNpcRecord} from "../src/osaka-challenge-core.mjs";
import {initOsakaTables,playOsaka,osakaOverview,migrateOsakaPowerPrizes} from "../src/osaka-challenge.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initEquipmentTables} from "../src/equipment.mjs";
import {useLegacyItem,listLegacyItemActions} from "../src/legacy-item-use.mjs";
import {listLegacyInventoryItems} from "../src/legacy-inventory.mjs";
import {inventorySlotUsage} from "../src/inventory-life.mjs";
const rules=parseOsakaRules(decodeLegacyText(readFileSync(new URL("../../obatyan.cgi",import.meta.url))));
const stats=Object.fromEntries(STAT_KEYS.map(k=>[k,500]));
const now=1800000000000;
const npcs=[];
for(const prefix of ["w","s"])for(let i=1;i<=5;i++){
 const filename=prefix+i+"log.cgi",fields=Array(68).fill("");
 fields[1]="TEST "+filename;STAT_KEYS.forEach((_,j)=>{fields[6+j]="24";});
 npcs.push(parseOsakaNpcRecord(filename,fields.join("<>")));
}
const catalog={available:true,missing:[],npcs};
const seq=(...v)=>n=>{assert.ok(v.length);const x=v.shift();assert.ok(x<n&&x>=0);return x;};
function setup(db){
 db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),town_id INTEGER,money INTEGER,kpoint INTEGER,body_energy INTEGER,brain_energy INTEGER,recovered_at INTEGER,stats_json TEXT,health_index INTEGER DEFAULT 50,weight REAL DEFAULT 60,height INTEGER DEFAULT 165,bmi REAL DEFAULT 22,last_meal_at INTEGER DEFAULT 0);");
 initTownMapTable(db);initEquipmentTables(db);initOsakaTables(db);
 const tiles=Array(192).fill("");tiles[0]="ゲーセン";
 storeTownMap(db,0,{tiles},"test");
 for(const id of [1,2]){
  db.prepare("INSERT INTO users VALUES(?)").run(id);
  db.prepare("INSERT INTO characters(user_id,town_id,money,kpoint,body_energy,brain_energy,recovered_at,stats_json) VALUES(?,0,1000,7,200,200,?,?)").run(id,now,JSON.stringify(stats));
 }
}
const play=(db,id=1,mode="week",requestId="osaka-test-001",time=now,drop=1,extra={})=>playOsaka(db,id,rules,catalog,{mode,requestId,now:time,rng:seq(0,0,drop),...extra});
const character=(db,id=1)=>db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);
const item=(db,line,id=1)=>db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=? AND source_line=?").get(id,line);
test("Osaka SQLite: both modes, first-template same-name stacking, actual item use, cooldown, replay, isolation and restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"osaka-db-"));let db;
 try{
  db=new DatabaseSync(join(dir,"test.sqlite"));setup(db);
  const a=play(db);const line=a.reward.sourceLine;
  assert.equal(a.outcome,"win");assert.equal(a.moneyDelta,1500);assert.equal(character(db).money,2500);assert.equal(character(db,2).money,1000);
  assert.equal(character(db).kpoint,7);assert.equal(item(db,line).durability,3);
  assert.equal(osakaOverview(db,2,catalog).latest,null);
  assert.deepEqual(play(db,1,"week","osaka-test-001",now,1,{rng:()=>{throw Error("reroll");}}),{...a,replayed:true});
  assert.throws(()=>play(db,1,"strong","osaka-test-001"),/變更難度/);
  assert.throws(()=>play(db,1,"strong","osaka-test-002",now+4999),/間隔/);
  const used=useLegacyItem(db,1,line,"osaka-use-001",now);
  assert.equal(used.changes.stats.kokugo,3);assert.equal(used.changes.brainEnergy,-3);
  assert.throws(()=>useLegacyItem(db,1,line,"osaka-use-002",now+1000),/間隔/);
  assert.throws(()=>useLegacyItem(db,2,line,"osaka-use-other",now),/找不到本人/);
  const b=play(db,1,"strong","osaka-test-003",now+5000);
  assert.equal(b.reward.sourceLine,line);assert.equal(b.reward.merged,true);assert.equal(b.moneyDelta,5000);
  assert.equal(item(db,line).durability,7);
  assert.equal(JSON.parse(item(db,line).raw_fields_json)[2],"3");
  assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?").get(line).remaining,7);
  assert.equal(listLegacyItemActions(db,1,{bodyEnergy:200,brainEnergy:200,lastMealAt:0},now+5000)[0].canUse,false);
  db.close();db=new DatabaseSync(join(dir,"test.sqlite"));initOsakaTables(db);
  assert.equal(osakaOverview(db,1,catalog).history.length,2);
  assert.deepEqual(play(db,1,"strong","osaka-test-003",now+5000,1,{rng:()=>{throw Error("reroll");}}),{...b,replayed:true});
  assert.equal(character(db).money,7500);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
test("Osaka SQLite: all eight prizes use verified or approved corrected effects",()=>{
 const db=new DatabaseSync(":memory:");try{setup(db);
 for(const mode of ["week","strong"]){
  const id=mode==="week"?1:2;
  for(let drop=0;drop<4;drop++){
   const at=now+5000*drop;
   const b=play(db,id,mode,"osaka-"+mode+"-drop-"+drop,at,drop);
   const row=item(db,b.reward.sourceLine,id);
   assert.equal(b.reward.blocked,false);
   const used=useLegacyItem(db,id,b.reward.sourceLine,"osaka-"+mode+"-use-"+drop,at);
   if(drop===0){
    const amount=mode==="week"?3:10;
    assert.deepEqual(b.prize.originalRawFields,rules[mode].prizes[0].originalRawFields);
    assert.equal(row.durability,mode==="week"?3:5);
    assert.deepEqual(used.changes.stats,Object.fromEntries(STAT_KEYS.slice(7).map(k=>[k,amount])));
    assert.equal(used.changes.brainEnergy,-10);
    assert.throws(()=>useLegacyItem(db,id,b.reward.sourceLine,"osaka-early-"+mode,at+1000),/間隔/);
   }else{
    const expected=drop===3?(mode==="week"?5:25):(mode==="week"?3:10);
    assert.equal(used.changes.stats.kokugo,expected);
    if(drop===2)assert.equal(used.changes.healthIndex,mode==="week"?15:20);
   }
  }
  assert.equal(inventorySlotUsage(db,id,now+15000).general.used,4);
 }
 const b=play(db,1,"strong","osaka-power-merge",now+20000,0);
 assert.equal(b.reward.merged,true);assert.equal(item(db,b.reward.sourceLine).durability,7);
 assert.equal(JSON.parse(item(db,b.reward.sourceLine).raw_fields_json)[10],"3");
 assert.deepEqual(b.prize.originalRawFields,rules.strong.prizes[0].originalRawFields);
 }finally{db.close();}
});
test("Osaka SQLite: capacity before stacking, rollback, map and catalog checks",()=>{
 const db=new DatabaseSync(":memory:");try{setup(db);
 const a=play(db);const line=a.reward.sourceLine;
 const add=db.prepare("INSERT INTO equipment_items(user_id,sku,type,name,power,accuracy,uses,status,created_at) VALUES(1,?,'武器',?,0,50,1,'stored',?)");
 for(let i=0;i<24;i++)add.run("test-"+i,"test-"+i,now);
 const b=play(db,1,"week","osaka-full-001",now+5000,1);
 assert.equal(b.reward.granted,false);assert.equal(b.reward.reason,"inventory-full");assert.equal(item(db,line).durability,3);
 const before=character(db);
 db.exec("CREATE TRIGGER osaka_fail BEFORE INSERT ON osaka_battles BEGIN SELECT RAISE(ABORT,'forced'); END;");
 assert.throws(()=>play(db,1,"week","osaka-rollback-001",now+10000,2),/forced/);
 assert.deepEqual(character(db),before);
 assert.equal(osakaOverview(db,1,catalog).history.length,2);
 db.exec("DROP TRIGGER osaka_fail; DELETE FROM equipment_items;");
 db.exec("CREATE TRIGGER osaka_fail BEFORE INSERT ON osaka_battles BEGIN SELECT RAISE(ABORT,'forced'); END;");
 assert.throws(()=>play(db,1,"week","osaka-rollback-002",now+10000,2),/forced/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items").get().n,1);
 assert.deepEqual(character(db),before);
 const tiles=Array(192).fill("");tiles[0]="おばちゃん強";storeTownMap(db,0,{tiles},"test");
 assert.deepEqual(osakaOverview(db,1,catalog).locations,{week:false,strong:true});
 assert.throws(()=>play(db,1,"week","osaka-location-001",now+10000),/入口/);
 assert.throws(()=>playOsaka(db,1,rules,{available:false,missing:["test"],npcs:[]},{mode:"strong",requestId:"osaka-missing-001",now:now+10000}),/NPC 資料/);
 }finally{db.close();}
});

test("Osaka upgrade: receipt-proven old power awards preserve first template, correct uses, original receipt and isolation",()=>{
 const db=new DatabaseSync(":memory:");try{setup(db);
 const raw=rules.week.prizes[0].originalRawFields;
 const insert=db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
 for(const id of [1,2])insert.run(id,"__web_osaka_quarantine__",10000000,raw[0],raw[1],raw[9],2,"未核對",now/1000,0,JSON.stringify(raw));
 const receipt=db.prepare("INSERT INTO osaka_battles(user_id,request_id,mode,played_at,result_json) VALUES(1,?,?,?,?)");
 for(const [i,mode] of ["week","strong"].entries()){
  const p=rules[mode].prizes[0];
  receipt.run("old-power-"+i,mode,now+i*5000,JSON.stringify({prizeIndex:0,prize:{name:p.name,rawFields:p.originalRawFields},reward:{granted:true,blocked:true,sourceLine:10000000}}));
 }
 const before=db.prepare("SELECT * FROM osaka_battles ORDER BY id").all();
 assert.deepEqual(migrateOsakaPowerPrizes(db,rules),{migrated:1,skipped:1});
 const upgraded=item(db,10000000);
 assert.equal(upgraded.original_id,"__web_osaka__");assert.equal(upgraded.durability,8);
 assert.equal(upgraded.durability_unit,"回");assert.equal(JSON.parse(upgraded.raw_fields_json)[10],"3");
 assert.equal(item(db,10000000,2).durability_unit,"未核對");
 assert.deepEqual(db.prepare("SELECT * FROM osaka_battles ORDER BY id").all(),before);
 assert.deepEqual(migrateOsakaPowerPrizes(db,rules),{migrated:0,skipped:1});
 assert.equal(useLegacyItem(db,1,10000000,"osaka-upgrade-use",now+10000).changes.stats.power,3);
 }finally{db.close();}
});
