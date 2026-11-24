import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {STAT_KEYS} from "../src/engine.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initCLeagueTables,cEnergy,simulateCLeague,chooseCLeagueOpponent,trainCLeague,playCLeague,cLeagueOverview,C_SEASON_MS,C_MATCH_LIMIT} from "../src/c-league.mjs";
const stats=n=>Object.fromEntries(STAT_KEYS.map(k=>[k,n]));
const f=(n,name="角色")=>({name,owner:name,stats:stats(n)});
const today="2026-11-25",now=1000000;
function setup(){const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3); CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),name TEXT,money INTEGER,bank INTEGER,kpoint INTEGER,stats_json TEXT,body_energy INTEGER,brain_energy INTEGER);");initBankTables(db);initCLeagueTables(db);
  const ins=db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,?)");for(let i=1;i<=3;i++)ins.run(i,"居民"+i,1000000,100000,0,JSON.stringify(stats(100)),100,100);return db;}
const create=(db,id,n=10)=>trainCLeague(db,id,{requestId:"train",name:"角色"+id,transfers:stats(n)},now,today);
test("C 聯賽原版能量與17攻擊：健康也可攻擊，單一能量、勝敗平手與最低獎金",()=>{
  assert.deepEqual(cEnergy(stats(10)),{body:8,brain:9,total:17});
  for(let i=0;i<17;i++){const r=simulateCLeague(f(100),f(1),n=>n===17?i:2);assert.equal(r.outcome,"win");assert.equal(r.rounds[0].stat,STAT_KEYS[i]);assert.equal(r.reward,198);}
  const loss=simulateCLeague(f(1),f(100),()=>2);assert.equal(loss.outcome,"loss");assert.equal(loss.reward,100);
  const draw=simulateCLeague(f(10),f(10),()=>2);assert.equal(draw.outcome,"draw");assert.equal(draw.rounds.length,25);assert.equal(draw.rounds[0].attacker,"opponent");assert.equal(draw.reward,100);
});
test("C 聯賽雙方獨立三分之一浮動與模仿對手、最後一列保留原版",()=>{
  const values=[9,0,1];const a=simulateCLeague(f(3),f(3),n=>values.length?values.shift():2);assert.equal(a.rounds[0].damage,2);
  const own=f(10,"本人"),rows=[f(11,"甲"),f(12,"乙"),f(13,"丙")];let calls=[1,2];assert.equal(chooseCLeagueOpponent(rows,own,()=>calls.shift()).opponent.name,"乙");
  assert.equal(chooseCLeagueOpponent([],own,()=>2).mimic,true);calls=[0,0];assert.equal(chooseCLeagueOpponent(rows,own,()=>calls.shift()).mimic,true);
});
test("培育原子扣能力與現金，重送、負值、超額、偽造欄位與回滾",()=>{const db=setup();try{
  const result=create(db,1,1);assert.equal(result.cost,170000);assert.equal(result.character.stats.kenkou,1);
  const before=db.prepare("SELECT * FROM characters WHERE user_id=1").get();assert.equal(before.money,830000);assert.equal(JSON.parse(before.stats_json).kenkou,99);
  assert.equal(create(db,1,1).replayed,true);
  for(const [requestId,transfers] of [["negative",{kenkou:-1}],["all",{kenkou:99}],["unknown",{fake:1}],["fraction",{kenkou:1.5}]])assert.throws(()=>trainCLeague(db,1,{requestId,transfers},now,today));
  db.exec("CREATE TRIGGER fail_c_train BEFORE INSERT ON c_league_requests BEGIN SELECT RAISE(ABORT,'forced'); END;");
  assert.throws(()=>trainCLeague(db,1,{requestId:"new",transfers:{kenkou:1}},now,today),/forced/);
  assert.deepEqual(db.prepare("SELECT * FROM characters WHERE user_id=1").get(),before);assert.equal(cLeagueOverview(db,1,now).character.stats.kenkou,1);
}finally{db.close();}});
test("C 聯賽單機模仿者、本人獎金、對手隔離、冷卻、100場上限與賽季積分",()=>{const db=setup();try{
  create(db,1,1);create(db,2,1);const before=db.prepare("SELECT * FROM characters WHERE user_id=2").get();
  const a=playCLeague(db,1,{requestId:"a"},now,today,()=>2);assert.equal(a.mimic,true);assert.equal(a.outcome,"draw");
  assert.equal(playCLeague(db,1,{requestId:"a"},now,today,()=>{throw Error("redraw")}).replayed,true);
  assert.throws(()=>playCLeague(db,1,{requestId:"b"},now+59999,today),/間隔/);
  const b=playCLeague(db,2,{requestId:"b"},now,today,n=>n===1?0:2);assert.equal(b.mimic,false);assert.equal(b.outcome,"draw");
  assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,before.money+100);
  db.prepare("UPDATE c_league_entries SET wins=100,draws=0 WHERE user_id=1").run();
  assert.throws(()=>playCLeague(db,1,{requestId:"limit"},now+60000,today),/100/);
  const next=cLeagueOverview(db,1,now+C_SEASON_MS);assert.equal(next.season,2);assert.equal(next.record.wins,0);assert.equal(next.record.previousWins,100);assert.equal(next.record.points,10);assert.equal(next.record.champions,1);assert.equal(next.overall[1].points,5);assert.equal(cLeagueOverview(db,1,now+C_SEASON_MS).record.points,10);
}finally{db.close();}});
test("CGI 來源契約 C 聯賽",()=>{const s=readFileSync(new URL("../../game.cgi",import.meta.url),"utf8"),ini=readFileSync(new URL("../../town_ini.cgi",import.meta.url),"utf8");for(const x of ["foreach (1..25)","int(rand(17))+1","int(rand($#taisen_list))","$c_mouke = $dameegitame * 2","int($dameegitame * 1.5)","$ch_yobi2 += 10","$ch_yobi2 += 5"])assert.ok(s.includes(x),x);for(const x of ["$c_nissuu = '14'","$c_siaisuu = \"100\"","$c_siai_kankaku = '1'"])assert.ok(ini.includes(x),x);});
