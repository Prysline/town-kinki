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
  create(db,1,2);create(db,2,2);const before=db.prepare("SELECT * FROM characters WHERE user_id=2").get();
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

test("C 聯賽原版零能量判定、非零敗北與平手獎金",()=>{
  assert.equal(simulateCLeague(f(0),f(0),()=>2).outcome,"win");
  const a=f(10),b=f(10);a.stats.speed=11;
  const first=[0,1,0];const draw=simulateCLeague(a,b,()=>first.length?first.shift():2);
  assert.equal(draw.outcome,"draw");assert.equal(draw.damageDealt,6);assert.equal(draw.reward,9);
  b.stats.kenkou=100;const rolls=[0,1,0,9,2,2];
  const loss=simulateCLeague(a,b,()=>rolls.shift());
  assert.equal(loss.outcome,"loss");assert.equal(loss.damageDealt,6);assert.equal(loss.reward,6);
});
test("C 聯賽信用付款須有效本人卡、餘額足夠，銀行帳簿同交易",()=>{
  const db=setup();try{
    db.exec("CREATE TABLE legacy_inventory_items(user_id INTEGER,source_line INTEGER,category TEXT,original_name TEXT,effect TEXT,durability INTEGER,durability_unit TEXT,purchased_at INTEGER,raw_fields_json TEXT)");
    const fields=Array(33).fill("");fields[0]="日用品";fields[1]="信用卡";fields[9]="クレジット";fields[21]="3";fields[22]="日";fields[30]="900";
    db.prepare("INSERT INTO legacy_inventory_items VALUES(?,?,?,?,?,?,?,?,?)").run(2,1,fields[0],fields[1],fields[9],3,"日",900,JSON.stringify(fields));
    const request={requestId:"credit",name:"信用培育",transfers:{kenkou:1},payment:"credit",cardSourceLine:1};
    assert.throws(()=>trainCLeague(db,1,request,now,today),/本人/);
    assert.equal(cLeagueOverview(db,1,now).character,null);
    assert.throws(()=>trainCLeague(db,2,{...request,transfers:{kenkou:11}},now,today),/餘額/);
    assert.equal(cLeagueOverview(db,2,now).character,null);
    const paid=trainCLeague(db,2,request,now,today);assert.equal(paid.cost,10000);
    const row=db.prepare("SELECT money,bank FROM characters WHERE user_id=2").get();assert.equal(row.money,1000000);assert.equal(row.bank,90000);
    const ledger=db.prepare("SELECT action,debit,balance FROM bank_ledger WHERE user_id=2").get();assert.equal(ledger.action,"C 聯賽信用付款");assert.equal(ledger.debit,10000);assert.equal(ledger.balance,90000);
    assert.equal(trainCLeague(db,2,request,now,today).replayed,true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger WHERE user_id=2").get().n,1);
  }finally{db.close();}
});
test("C 聯賽戰鬥寫入失敗及現金溢位整筆回滾",()=>{
  const db=setup();try{
    create(db,1,2);
    const before=db.prepare("SELECT * FROM characters WHERE user_id=1").get();
    db.exec("CREATE TRIGGER fail_c_play BEFORE INSERT ON c_league_requests BEGIN SELECT RAISE(ABORT,'forced'); END;");
    assert.throws(()=>playCLeague(db,1,{requestId:"play"},now,today,()=>2),/forced/);
    assert.deepEqual(db.prepare("SELECT * FROM characters WHERE user_id=1").get(),before);
    assert.equal(cLeagueOverview(db,1,now).record,null);
    db.exec("DROP TRIGGER fail_c_play");
    db.prepare("UPDATE characters SET money=?,bank=0 WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>playCLeague(db,1,{requestId:"play"},now,today,()=>2),/安全範圍/);
    assert.equal(cLeagueOverview(db,1,now).history.length,0);
    assert.equal(cLeagueOverview(db,1,now).record,null);
  }finally{db.close();}
});

test("C 聯賽被動查詢不啟動賽季、明確進入才結算，前五積分與同勝場順序",()=>{
  const db=setup();try{
    assert.equal(cLeagueOverview(db,1,now,{activate:false}).started,false);
    create(db,1,2);assert.equal(cLeagueOverview(db,1,now,{activate:false}).started,false);
    const start=cLeagueOverview(db,1,now);assert.equal(start.endsAt,now+C_SEASON_MS);
    for(let id=2;id<=6;id++){
      if(id>3){db.prepare("INSERT INTO users VALUES(?)").run(id);db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,?)").run(id,"居民"+id,1000000,100000,0,JSON.stringify(stats(100)),100,100);}
      create(db,id,2);
    }
    for(let id=1;id<=6;id++)db.prepare("INSERT INTO c_league_entries(user_id,wins,sort_order) VALUES(?,?,?)").run(id,id<=2?10:10-id,7-id);
    const before=cLeagueOverview(db,1,now+C_SEASON_MS,{activate:false});assert.equal(before.season,1);assert.equal(before.record.wins,10);
    const after=cLeagueOverview(db,1,now+C_SEASON_MS);
    assert.equal(after.season,2);assert.deepEqual(after.overall.map(x=>[x.name,x.points]),[["角色2",10],["角色1",5],["角色3",3],["角色4",2],["角色5",1]]);
    assert.equal(after.previous.length,5);assert.equal(after.rankings.length,6);assert.equal(after.record.previousWins,10);
    assert.equal(cLeagueOverview(db,1,now+C_SEASON_MS*4).season,3); // 原版多季未進入，只結算一次
  }finally{db.close();}
});
