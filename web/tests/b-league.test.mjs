import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {decodeLegacyText,STAT_KEYS} from "../src/engine.mjs";
import {parseArenaCatalog,simulateArena,rollArena,defaultGear} from "../src/b-league-core.mjs";
import {parseArenaDrops,initArenaTables,playArena,arenaOverview} from "../src/b-league.mjs";

const source=path=>decodeLegacyText(readFileSync(new URL("../../"+path,import.meta.url)));
const catalog=parseArenaCatalog(source("dat_dir/battle.cgi"));
const drops=parseArenaDrops(source("battle.cgi"));
const d=catalog.filter(m=>m.rank==="d");
const p={bodyEnergy:1000,brainEnergy:1000,speed:101,money:49,kpoint:0};
const sequence=(...values)=>n=>{assert.ok(values.length,"unexpected RNG");const v=values.shift();assert.ok(v>=0&&v<n);return v;};
const now=1800000000000;
const gear=(type,extra={})=>({...defaultGear(type),id:1,name:"test",uses:1,...extra});
test("B league: original catalog and prize records",()=>{
 assert.equal(catalog.length,10);
 for(const rank of ["s","a","b","c","d"])assert.equal(catalog.filter(m=>m.rank===rank).length,2);
 assert.deepEqual(d.map(m=>[m.brainEnergy,m.bodyEnergy,m.money]),[[100,100,50],[500,500,250]]);
 assert.deepEqual(drops.map(f=>f[1]),["薬草","上薬草","特薬草","秘伝薬草"]);
 assert.ok(drops.every(f=>f.length===33&&f[22]===""));
});
test("B league: normal win and special win select original drop slots",()=>{
 const a=rollArena(catalog,"d",p,{rng:sequence(0,1,0,99,9,1)});
 assert.equal(a.outcome,"win");assert.equal(a.rounds.length,1);assert.equal(a.moneyDelta,50);assert.equal(a.kpointDelta,1);assert.equal(a.drop,null);
 const b=rollArena(catalog,"d",{...p,bodyEnergy:10000,speed:501},{rng:sequence(1,1,0,999,0,0)});
 assert.equal(b.outcome,"win");assert.equal(b.kpointDelta,3);assert.equal(b.drop,d[1].drops[1]);
});
test("B league: equal speed monster starts, both loss branches and cash floor",()=>{
 const a=simulateArena({player:{...p,bodyEnergy:10,speed:100},monster:d[0],rng:sequence(1,99,9,1)});
 assert.equal(a.rounds[0].actor,"monster");assert.equal(a.outcome,"loss");assert.equal(a.player.money,0);assert.equal(a.player.bodyEnergy,0);
 const b=simulateArena({player:{...p,brainEnergy:10,speed:100},monster:d[0],rng:sequence(0,99,9,0)});
 assert.equal(b.outcome,"loss");assert.equal(b.defeatedEnergy,"brainEnergy");assert.equal(b.player.money,24);
});
test("B league: draw after exactly 50 attacks, special draw money",()=>{
 for(const special of [false,true]){
 const a=simulateArena({player:p,monster:d[0],defaults:{"武器":{accuracy:0},"防具":{accuracy:101}},rng:n=>special&&n===5?0:n-1});
 assert.equal(a.outcome,"draw");assert.equal(a.rounds.length,50);assert.equal(a.moneyDelta,special?50:0);assert.equal(a.kpointDelta,0);
 }
});
test("B league: weapon level-up and break; failed evasion consumes even zero damage",()=>{
 const a=simulateArena({player:p,monster:d[0],equipped:[gear("武器",{power:100,accuracy:100,experience:9})],rng:sequence(1,0,0,0,9,1)});
 assert.equal(a.outcome,"win");assert.equal(a.changedGear[0].uses,0);assert.equal(a.changedGear[0].power,102);assert.equal(a.changedGear[0].accuracy,102);assert.equal(a.changedGear[0].level,2);assert.equal(a.changedGear[0].broken,true);
 const values=[1,99];
 const b=simulateArena({player:{...p,speed:0},monster:d[0],equipped:[gear("防具",{power:100,accuracy:0})],rng:n=>values.length?values.shift():n-1});
 assert.equal(b.rounds[0].damage,0);assert.equal(b.rounds[0].used,true);assert.equal(b.rounds[0].broken,true);
});
function fixture(db){
 db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),town_id INTEGER,money INTEGER,kpoint INTEGER,body_energy INTEGER,brain_energy INTEGER,recovered_at INTEGER,stats_json TEXT);");
 initArenaTables(db);
 for(const id of [1,2]){
 db.prepare("INSERT INTO users VALUES(?)").run(id);
 db.prepare("INSERT INTO characters VALUES(?,0,1000,0,1000,1000,?,?)").run(id,now,JSON.stringify(Object.fromEntries(STAT_KEYS.map(k=>[k,5000]))));
 }
}
const opts=(id="arena-test-001",time=now,extra={})=>({rank:"d",requestId:id,now:time,hasBuilding:()=>true,rng:sequence(0,1,0,99,9,0),...extra});
const play=(db,options=opts(),user=1)=>playArena(db,user,catalog,drops,options);
const cash=(db,id=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(id).money;
test("B league: atomic receipt, account isolation, replay, cooldown, restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"arena-"));let db;
 try{
 db=new DatabaseSync(join(dir,"test.sqlite"));fixture(db);
 const a=play(db);assert.equal(a.outcome,"win");assert.equal(a.reward.granted,true);assert.equal(cash(db),1050);assert.equal(cash(db,2),1000);
 assert.equal(arenaOverview(db,2,now,true).history.length,0);
 assert.throws(()=>play(db,opts("arena-test-002")),/間隔/);
 assert.throws(()=>play(db,opts("arena-test-001",now,{rank:"s"})),/變更難度/);
 assert.throws(()=>play(db,opts("arena-test-003",now,{rank:"x"})),/格式/);
 assert.throws(()=>play(db,opts("arena-test-003",now,{hasBuilding:()=>false}),2),/城鎮/);
 db.close();db=new DatabaseSync(join(dir,"test.sqlite"));initArenaTables(db);
 const b=play(db,opts("arena-test-001",now,{rng:()=>{throw Error("reroll");},hasBuilding:()=>false}));
 assert.deepEqual(b,{...a,replayed:true});assert.equal(cash(db),1050);
 assert.equal(arenaOverview(db,1,now,true).history.length,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items WHERE user_id=1").get().n,1);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
test("B league: capacity checked before same-item stacking",()=>{
 const db=new DatabaseSync(":memory:");try{fixture(db);play(db);
 const add=db.prepare("INSERT INTO equipment_items(user_id,sku,type,name,power,accuracy,uses,status,created_at) VALUES(1,?,'武器',?,0,50,1,'stored',?)");
 for(let i=0;i<24;i++)add.run("test-"+i,"test-"+i,now);
 const b=play(db,opts("arena-test-002",now+5000));
 assert.equal(b.reward.granted,false);assert.equal(b.kpointDelta,3);assert.equal(db.prepare("SELECT durability FROM legacy_inventory_items").get().durability,1);
 }finally{db.close();}
});
test("B league: rollback character, equipment, drop and receipt on write failure",()=>{
 const db=new DatabaseSync(":memory:");try{fixture(db);
 db.prepare("INSERT INTO equipment_items(user_id,sku,type,name,power,accuracy,uses,experience,status,created_at) VALUES(1,'test','武器','test',100,100,1,9,'equipped',?)").run(now);
 db.exec("CREATE TRIGGER fail_battle BEFORE INSERT ON b_league_battles BEGIN SELECT RAISE(ABORT,'forced'); END;");
 assert.throws(()=>play(db,opts("arena-test-004",now,{rng:sequence(0,1,0,0,0,9,0)})),/forced/);
 assert.equal(cash(db),1000);assert.equal(db.prepare("SELECT uses FROM equipment_items").get().uses,1);
 for(const table of ["legacy_inventory_items","b_league_battles","b_league_default_gear"])assert.equal(db.prepare("SELECT COUNT(*) n FROM "+table).get().n,0);
 }finally{db.close();}
});
