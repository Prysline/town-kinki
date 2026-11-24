import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { STAT_KEYS } from "../src/engine.mjs";
import { initCharacterEvents,getCouponBalance } from "../src/events.mjs";
import { initBankTables,calculateWeeklyTax } from "../src/banking.mjs";
import { STREET_ATTACKS,streetOpponentEnergy,simulateStreetFight,chooseStreetOpponent,
  initStreetFightTables,playStreetFight,streetFightOverview } from "../src/street-fight.mjs";
const stats=n=>Object.fromEntries(STAT_KEYS.map(key=>[key,n]));
const fighter=(n,bodyEnergy=100,brainEnergy=100)=>({stats:stats(n),bodyEnergy,brainEnergy});
const seq=(...values)=>n=>{const value=values.shift();assert.ok(value>=0&&value<n);return value;};
test("原版 17 能力、16 攻擊、能量公式及健康跳號",()=>{
  assert.equal(STREET_ATTACKS.length,16);
  assert.equal(STREET_ATTACKS.filter(x=>x.target==="brain").length,9);
  assert.ok(!STREET_ATTACKS.some(x=>x.stat==="kenkou"));
  assert.deepEqual(streetOpponentEnergy(stats(24)),{body:26,brain:28});
  for(const attack of STREET_ATTACKS){
    const a=fighter(200),b=fighter(1);
    const result=simulateStreetFight(a,b,seq(attack.id-1,1,1));
    assert.equal(result.outcome,"win");
    assert.equal(result.reason,attack.target);
    assert.equal(result.rounds[0].damage,199);
    assert.equal(result.delta,1500);
  }
});
test("平速對手先攻、50 擊平手、無效傷害與獨立警察抽選",()=>{
  const a=simulateStreetFight(fighter(20),fighter(20),()=>0);
  assert.equal(a.rounds[0].attacker,"opponent");
  assert.equal(a.rounds.length,50);
  assert.ok(a.rounds.every(r=>r.damage===0));
  assert.equal(a.outcome,"draw");assert.equal(a.delta,0);assert.equal(a.kpointDelta,-3);
});
test("勝利券兩端、敗北負現金原始差額及判定順序",()=>{
  for(const roll of [0,4]){
    const f=simulateStreetFight(fighter(200),fighter(1),seq(8,0,roll,0));
    assert.equal(f.coupons,roll+1);assert.equal(f.kpointDelta,-3);
  }
  const loss=simulateStreetFight(fighter(1,1,1),fighter(200),seq(8,1));
  assert.equal(loss.outcome,"loss");assert.equal(loss.delta,-300);assert.equal(loss.bodyEnergy,0);
  const both=simulateStreetFight(fighter(20,0,0),fighter(0),seq(0,1,1));
  assert.equal(both.outcome,"win");assert.equal(both.reason,"body");
});
test("原版最後一列不參與且抽到自己無對手",()=>{
  const rows=[{user_id:1},{user_id:2},{user_id:3}];
  assert.equal(chooseStreetOpponent(rows,1,()=>0),null);
  assert.equal(chooseStreetOpponent(rows,1,()=>1).user_id,2);
  assert.equal(chooseStreetOpponent(rows.slice(0,1),1),null);
});
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE REFERENCES users(id),name TEXT,money INTEGER,bank INTEGER,kpoint INTEGER,stats_json TEXT,body_energy INTEGER,brain_energy INTEGER,recovered_at INTEGER); INSERT INTO users VALUES(1),(2),(3);");
  initCharacterEvents(db);initBankTables(db);initStreetFightTables(db);
  const insert=db.prepare("INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?,?)");
  insert.run(1,1,"甲",100000,0,0,JSON.stringify(stats(1)),1,1,1000);
  insert.run(2,2,"乙",100000,0,0,JSON.stringify(stats(200)),100,100,1000);
  return db;
}
const options={mode:"multi",requestId:"round-1",now:1000,today:"2026-11-25"};
test("SQLite 原子勝利、重送、隔離、冷卻、單機及無角色拒絕",()=>{
  const db=setup();
  try{
    const other=db.prepare("SELECT * FROM characters WHERE user_id=1").get();
    const r=playStreetFight(db,2,{...options,randomIndex:seq(0,8,0,4,0)});
    assert.equal(r.outcome,"win");assert.equal(r.coupons,5);
    assert.equal(getCouponBalance(db,2),5);
    assert.deepEqual(db.prepare("SELECT money,kpoint FROM characters WHERE user_id=2").get(),Object.assign(Object.create(null),{money:101500,kpoint:-3}));
    assert.deepEqual(db.prepare("SELECT * FROM characters WHERE user_id=1").get(),other);
    assert.equal(playStreetFight(db,2,{...options,randomIndex:()=>{throw Error("重抽");}}).replayed,true);
    assert.throws(()=>playStreetFight(db,2,{...options,requestId:"new"}),/間隔/);
    assert.equal(streetFightOverview(db,1,"multi").history.length,0);
    assert.throws(()=>playStreetFight(db,2,{...options,mode:"solo"}),/單機/);
    assert.throws(()=>playStreetFight(db,3,options),/建立角色/);
    assert.equal(playStreetFight(db,1,{...options,randomIndex:()=>0}).outcome,"noOpponent");
    assert.equal(streetFightOverview(db,1,"multi").history.length,1);
    assert.throws(()=>playStreetFight(db,2,{...options,now:6000,requestId:"bad!"}),/格式/);
    assert.equal(calculateWeeklyTax(6000000,-3).due,60000);
  }finally{db.close();}
});
test("寫入歷史失敗時券、能量、K點、現金一併回滾；低現金拒絕",()=>{
  const db=setup();
  try{
    const before=db.prepare("SELECT * FROM characters").all();
    db.exec("CREATE TRIGGER fail_street BEFORE INSERT ON street_fights BEGIN SELECT RAISE(ABORT,'forced'); END;");
    assert.throws(()=>playStreetFight(db,2,{...options,randomIndex:seq(0,8,0,4,0)}),/forced/);
    assert.deepEqual(db.prepare("SELECT * FROM characters").all(),before);
    assert.equal(getCouponBalance(db,2),0);
    db.prepare("UPDATE characters SET money=14999 WHERE user_id=2").run();
    assert.throws(()=>playStreetFight(db,2,{...options,randomIndex:()=>{throw Error("不應抽選");}}),/15,000/);
  }finally{db.close();}
});

test("優惠券安全整數容量與現金上限：超出時整筆回滾",()=>{
  const db=setup();
  try{
    db.prepare("INSERT INTO character_coupons VALUES(?,?)").run(2,Number.MAX_SAFE_INTEGER);
    const before=db.prepare("SELECT * FROM characters").all();
    assert.throws(()=>playStreetFight(db,2,{...options,randomIndex:seq(0,8,0,4,0)}),/優惠券餘額/);
    assert.deepEqual(db.prepare("SELECT * FROM characters").all(),before);
    assert.equal(getCouponBalance(db,2),Number.MAX_SAFE_INTEGER);
    db.prepare("UPDATE characters SET money=? WHERE user_id=2").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>playStreetFight(db,2,{...options,randomIndex:seq(0,8,1,1)}),/安全整數/);
    assert.equal(streetFightOverview(db,2,"multi").history.length,0);
  }finally{db.close();}
});
test("敗北扣實際攻擊次數，對手不入帳；5秒邊界可重新出發",()=>{
  const db=setup();
  try{
    db.prepare("UPDATE characters SET stats_json=?,body_energy=1,brain_energy=1,money=15000 WHERE user_id=2").run(JSON.stringify(stats(1)));
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=1").run(JSON.stringify(stats(200)));
    const r=playStreetFight(db,2,{...options,randomIndex:seq(0,8,1)});
    assert.equal(r.outcome,"loss");assert.equal(r.delta,-300);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,14700);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,100000);
    assert.throws(()=>playStreetFight(db,2,{...options,requestId:"early",now:5999}),/間隔/);
    db.prepare("UPDATE characters SET money=15000 WHERE user_id=2").run();
    const again=playStreetFight(db,2,{...options,requestId:"boundary",now:6000,randomIndex:seq(0,8,1)});
    assert.equal(again.outcome,"loss");
  }finally{db.close();}
});

test("原版 CGI 來源契約：對手公式、抽選疏漏、回合與只寫本人存檔",()=>{
  const source=readFileSync(new URL("../../game.cgi",import.meta.url),"utf8");
  const battle=source.slice(source.indexOf("sub battle {"),source.indexOf("sub kougeki {"));
  assert.ok(battle.includes('int (rand($#aite_erabi))'));
  assert.ok(battle.includes('foreach (1..50)'));
  assert.ok(battle.includes('$get_money=$sentou_kaisuu*300'));
  assert.equal(battle.split('$get_money *= 5').length-1,2);
  assert.ok(battle.includes('$kpoint -= 3'));
  assert.ok(battle.includes('&log_kousin($my_log_file,$k_temp)'));
  assert.ok(!battle.includes('&log_kousin($aite_log_file'));
  assert.ok(battle.includes('$aite_looks/12'));
  assert.ok(battle.includes('$aite_kenkou/4'));
  assert.ok(battle.includes('$aite_bijutu/6'));
  assert.ok(source.includes('$battle_rand = int(rand(16))+1'));
  assert.ok(source.includes('$battle_rand <= 8 || $battle_rand == 14'));
  assert.ok(source.includes('$iryoku_hanteiti = @_[1] + 5'));
});
