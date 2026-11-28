import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {STAT_KEYS,parseLegacyJobs,decodeLegacyText} from "../src/engine.mjs";
import {initHousingTables,buildHouse,parseHouseCatalog,sellHouse} from "../src/housing.mjs";
import {initTownMapTable,storeTownMap,readTownMap} from "../src/town-storage.mjs";
import {initBankTables} from "../src/banking.mjs";
import {parseEnterpriseRules} from "../src/enterprise-source.mjs";
import {initEnterpriseTables,buildExtraEnterprise,enterpriseOverview,mutateEnterprise,settleEnterpriseIncomeInTransaction} from "../src/enterprise-store.mjs";
const src=n=>decodeLegacyText(readFileSync(new URL("../../"+n,import.meta.url)));
const rules=parseEnterpriseRules(src("command.pl"),src("unei_2.pl"),src("kaishiya.pl"),src("original_house.cgi"));
const catalog=parseHouseCatalog(src("town_ini.cgi"),src("command.pl")),jobs=parseLegacyJobs(src("dat_dir/job.cgi"));
const stats=Object.fromEntries(STAT_KEYS.map(k=>[k,10000])),today="2026-11-28",now=1795852800000;
function setup(){
 const db=new DatabaseSync(":memory:");
 db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,name TEXT,town_id INTEGER,money INTEGER,bank INTEGER,stats_json TEXT);INSERT INTO users VALUES(1,'a'),(2,'b'),(3,'c');");
 for(const id of [1,2,3])db.prepare("INSERT INTO characters VALUES(?,?,?,3,200000000,200000000,?)").run(id,id,"居民"+id,JSON.stringify(stats));
 initTownMapTable(db);initHousingTables(db);initBankTables(db);initEnterpriseTables(db);
 storeTownMap(db,3,{tiles:Array(192).fill("空地")},"web-edited");
 buildHouse(db,catalog,1,{row:0,column:0},{image:"house/kamakura.gif",interiorRank:3,payment:"cash"},now);
 return db;
}
const build=(db,kind,column,requestId)=>buildExtraEnterprise(db,rules,catalog,1,{kind,image:"house/kamakura.gif",row:0,column,payment:"cash",requestId,now,today});
test("HS-03 SQLite extra buildings: original quote, one per type, map, replay, retained company data on sale",()=>{
 const db=setup();try{
 const op=build(db,"operation",1,"build_operation");assert.equal(op.quote.total,7000000);
 assert.equal(readTownMap(db,3).tiles[1],"webhouse_"+op.houseId+"=空地");
 assert.equal(build(db,"operation",1,"build_operation").replayed,true);
 assert.throws(()=>build(db,"operation",2,"build_duplicate"),/種類/);
 const co=build(db,"corporation",2,"build_corporation");assert.equal(co.quote.total,16000000);
 assert.equal(enterpriseOverview(db,rules,jobs,1,co.houseId).employeeLimit,3);
 assert.equal(enterpriseOverview(db,rules,jobs,2,co.houseId).canTrain,false);
 sellHouse(db,catalog,1,op.houseId,now+1);
 assert.equal(readTownMap(db,3).tiles[1],"空地");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM enterprise_employees WHERE kind='operation'").get().n,1);
 const rebuilt=build(db,"operation",1,"rebuild_operation");assert.notEqual(rebuilt.houseId,op.houseId);
 assert.equal(enterpriseOverview(db,rules,jobs,1,rebuilt.houseId).employees.length,1);
 }finally{db.close();}
});
test("HS-04 SQLite fee A, owner authorization, receipt replay and fault atomicity",()=>{
 const db=setup();try{
 const h=build(db,"operation",1,"build_operation");
 const args={houseId:h.houseId,action:"train",indices:[0],stat:"kokugo",amount:10,payment:"cash",requestId:"train_once",now,today};
 assert.throws(()=>mutateEnterprise(db,rules,jobs,2,args),/權限/);
 const c=()=>db.prepare("SELECT money,bank,stats_json FROM characters WHERE user_id=1").get();
 const before=c();db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON enterprise_receipts BEGIN SELECT RAISE(ABORT,'fault');END;");
 assert.throws(()=>mutateEnterprise(db,rules,jobs,1,args),/fault/);assert.deepEqual(c(),before);
 db.exec("DROP TRIGGER reject_receipt");
 assert.equal(mutateEnterprise(db,rules,jobs,1,args).cost,20000);assert.equal(c().money,before.money-20000);
 assert.equal(mutateEnterprise(db,rules,jobs,1,args).replayed,true);assert.equal(c().money,before.money-20000);
 assert.equal(JSON.parse(c().stats_json).kokugo,9990);
 assert.throws(()=>mutateEnterprise(db,rules,jobs,1,{...args,requestId:"train_again"}),/間隔/);
 }finally{db.close();}
});
test("HS-04 SQLite income B owner and officers, atomic receipt and no second same-day payment",()=>{
 const db=setup();try{
 build(db,"operation",1,"build_operation");build(db,"corporation",2,"build_corporation");
 const update=db.prepare("UPDATE enterprise_employees SET data_json=? WHERE owner_user_id=1 AND kind=?");
 for(const [kind,job] of [["operation","A"],["corporation","B"]]){const row=JSON.parse(db.prepare("SELECT data_json FROM enterprise_employees WHERE kind=?").get(kind).data_json);update.run(JSON.stringify({...row,job,score:0}),kind);}
 db.prepare("INSERT INTO enterprise_officers VALUES(1,2,?)").run(now);
 const j=[{originalName:"A",salary:4000},{originalName:"B",salary:8000}];
 const balances=()=>db.prepare("SELECT bank FROM characters ORDER BY user_id").all().map(x=>x.bank);
 const before=balances(),run=()=>{db.exec("BEGIN IMMEDIATE");try{const r=settleEnterpriseIncomeInTransaction(db,j,1,today,now);db.exec("COMMIT");return r;}catch(e){db.exec("ROLLBACK");throw e;}};
 db.exec("CREATE TRIGGER reject_income BEFORE INSERT ON enterprise_income_days BEGIN SELECT RAISE(ABORT,'fault');END;");
 assert.throws(run,/fault/);assert.deepEqual(balances(),before);
 db.exec("DROP TRIGGER reject_income");
 assert.equal(run().ownerTotal,30000);assert.deepEqual(balances(),[before[0]+30000,before[1]+20000,before[2]]);
 assert.equal(run().replayed,true);assert.deepEqual(balances(),[before[0]+30000,before[1]+20000,before[2]]);
 }finally{db.close();}
});
