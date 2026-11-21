import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {
  ARCADE_SYMBOL,DICE_COOLDOWN_MS,DICE_HISTORY_LIMIT,
  parseOriginalArcadeDice,initArcadeDiceTables,playArcadeDice,arcadeDiceOverview
} from "../src/arcade-dice.mjs";

const arcade=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const dice=decodeLegacyText(readFileSync(new URL("../../saikoro.cgi",import.meta.url)));
const source=parseOriginalArcadeDice(arcade,dice);
const now=Date.parse("2026-11-21T10:00:00Z");
function setup({building=true,money=2000000}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(1,0,?,123456)").run(money);
  db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(2,0,2000000,654321)").run();
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]=ARCADE_SYMBOL;
  storeTownMap(db,0,{tiles},"web-edited");
  initArcadeDiceTables(db);
  return db;
}
function play(db,{userId=1,guess="even",stake=10000,
  requestId="phase55_dice_0001",at=now,roll=0}={}){
  return playArcadeDice(db,userId,source,{
    guess,stake,requestId,now:at,randomIndex:()=>roll
  });
}
const cash=(db,user=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(user).money;
const bank=(db,user=1)=>db.prepare("SELECT bank FROM characters WHERE user_id=?").get(user).bank;
const count=db=>db.prepare("SELECT COUNT(*) n FROM arcade_dice_rounds").get().n;

test("原版原始碼證實遊樂中心入口、五種原價、36等可能骰面、奇偶獎懲、5分鐘與20筆歷史",()=>{
  assert.equal(ARCADE_SYMBOL,"ゲーセン");
  assert.deepEqual(source.rates,[10000,50000,100000,500000,1000000]);
  assert.equal(source.cooldownMs,DICE_COOLDOWN_MS);
  assert.equal(DICE_COOLDOWN_MS,300000);
  assert.equal(source.historyLimit,DICE_HISTORY_LIMIT);
  assert.equal(source.historyLimit,20);
  assert.throws(()=>parseOriginalArcadeDice("",dice),/入口/);
  assert.throws(()=>parseOriginalArcadeDice(arcade,dice.replace("int(rand(36))","int(rand(100))")) ,/已變更/);
  assert.throws(()=>parseOriginalArcadeDice(arcade,dice.replace("$saikoro_game_time = 5","$saikoro_game_time = 1")) ,/已變更/);
});

test("原始亂數0～35平均對應36種兩骰組合，奇偶勝敗都各18種",()=>{
  const combinations=[];
  for(let i=0;i<36;i++){
    const dieOne=Math.floor(i/6)+1,dieTwo=i%6+1;
    combinations.push(dieOne+":"+dieTwo);
  }
  assert.equal(new Set(combinations).size,36);
  assert.equal(combinations.filter(x=>x.split(":").map(Number).reduce((a,b)=>a+b,0)%2===0).length,18);
  const db=setup();
  try{
    const first=play(db,{roll:0,guess:"even"});
    assert.deepEqual([first.dieOne,first.dieTwo,first.total,first.won,first.delta],
      [1,1,2,true,10000]);
    assert.equal(cash(db),2010000);
    assert.equal(bank(db),123456);
    const second=play(db,{roll:1,guess:"even",at:now+300000,requestId:"phase55_dice_second"});
    assert.deepEqual([second.dieOne,second.dieTwo,second.total,second.won,second.delta],
      [1,2,3,false,-10000]);
    assert.equal(cash(db),2000000);
    assert.equal(count(db),2);
  }finally{db.close();}
});

test("原版5分鐘從本人上局開始計算；第299秒拒絕，剛好滿300秒可繼續",()=>{
  const db=setup();
  try{
    play(db);
    const before=cash(db);
    const overview=arcadeDiceOverview(db,1,source,now);
    assert.equal(overview.readyAt,now+DICE_COOLDOWN_MS);
    assert.equal(overview.available,true);
    assert.throws(()=>play(db,{at:now+299999,requestId:"phase55_early_001"}),/5分鐘/);
    assert.equal(cash(db),before);
    assert.equal(count(db),1);
    const second=play(db,{at:now+300000,requestId:"phase55_legal_002",roll:35});
    assert.equal(second.total,12);
    assert.equal(second.won,true);
    assert.equal(count(db),2);
  }finally{db.close();}
});

test("相同請求重送不重複抽獎或改錢；變更下注與猜測必須拒絕",()=>{
  const db=setup();
  try{
    const first=play(db);
    const cashAfter=cash(db);
    const replay=play(db,{roll:35,at:now+100});
    assert.equal(replay.replayed,true);
    assert.deepEqual([replay.dieOne,replay.dieTwo],[first.dieOne,first.dieTwo]);
    assert.equal(cash(db),cashAfter);
    assert.equal(count(db),1);
    assert.throws(()=>play(db,{stake:50000}),/相同骰子遊戲請求碼/);
    assert.throws(()=>play(db,{guess:"odd"}),/相同骰子遊戲請求碼/);
    assert.equal(cash(db),cashAfter);
  }finally{db.close();}
});

test("沒有原版遊樂中心或角色、他人遊戲與他人現金皆不得被借用",()=>{
  const db=setup({building:false});
  try{
    assert.equal(arcadeDiceOverview(db,1,source,now).available,false);
    assert.throws(()=>play(db),/沒有原版遊樂中心/);
    assert.equal(count(db),0);
  }finally{db.close();}
  const other=setup();
  try{
    const player=play(other,{userId:1});
    assert.equal(player.won,true);
    const rival=play(other,{userId:2,requestId:"phase55_rival_001",guess:"odd",roll:1});
    assert.equal(rival.won,true);
    assert.equal(arcadeDiceOverview(other,1,source,now).history.length,1);
    assert.equal(arcadeDiceOverview(other,2,source,now).history.length,1);
    assert.equal(cash(other,1),2010000);
    assert.equal(cash(other,2),2010000);
    assert.equal(bank(other,2),654321);
    assert.throws(()=>play(other,{userId:3,requestId:"phase55_missing_003"}),/請先建立角色/);
  }finally{other.close();}
});

test("Web不允許現金不足下注，非法賭注、亂數、類型、超出安全整數都不扣款",()=>{
  const db=setup({money:9999});
  try{
    assert.throws(()=>play(db),/現金不足/);
    assert.equal(cash(db),9999);
    assert.throws(()=>play(db,{stake:1}),/格式/);
    assert.throws(()=>play(db,{stake:10001}),/格式/);
    assert.throws(()=>play(db,{guess:"both"}),/格式/);
    assert.throws(()=>play(db,{requestId:"short"}),/格式/);
    assert.equal(count(db),0);
  }finally{db.close();}
  const invalid=setup();
  try{
    for(const roll of [-1,36,0.1,Infinity,NaN])
      assert.throws(()=>play(invalid,{roll}),/骰子亂數/);
    assert.equal(count(invalid),0);
    assert.equal(cash(invalid),2000000);
    invalid.prepare("UPDATE characters SET money=? WHERE user_id=1")
      .run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>play(invalid,{roll:0}),/安全整數/);
    assert.equal(cash(invalid),Number.MAX_SAFE_INTEGER);
    assert.equal(count(invalid),0);
  }finally{invalid.close();}
});

test("下注紀錄寫入失敗，整筆現金勝敗必須回滾，可修復後同請求再玩",()=>{
  const db=setup();
  try{
    db.exec("CREATE TRIGGER reject_dice BEFORE INSERT ON arcade_dice_rounds BEGIN SELECT RAISE(ABORT,'dice log rejected'); END;");
    assert.throws(()=>play(db),/dice log rejected/);
    assert.equal(cash(db),2000000);
    assert.equal(count(db),0);
    db.exec("DROP TRIGGER reject_dice");
    assert.equal(play(db).won,true);
    assert.equal(cash(db),2010000);
  }finally{db.close();}
});

test("原版20筆歷史上限在Web僅列本人，不截斷不可重送的持久化流水帳",()=>{
  const db=setup();
  try{
    for(let i=0;i<23;i++)play(db,{
      at:now+i*DICE_COOLDOWN_MS,roll:i%36,
      requestId:"phase55_history_"+String(i).padStart(4,"0")
    });
    assert.equal(count(db),23);
    const overview=arcadeDiceOverview(db,1,source,now+23*DICE_COOLDOWN_MS);
    assert.equal(overview.history.length,20);
    assert.equal(overview.history[0].playedAt,now+22*DICE_COOLDOWN_MS);
    assert.equal(overview.history.at(-1).playedAt,now+3*DICE_COOLDOWN_MS);
  }finally{db.close();}
});

test("刪除玩家時只有本人的骰子交易刪除，其他玩家戰績完整保留",()=>{
  const db=setup();
  try{
    play(db);
    play(db,{userId:2,requestId:"phase55_other_user"});
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(count(db),1);
    assert.equal(db.prepare("SELECT user_id FROM arcade_dice_rounds").get().user_id,2);
    assert.equal(arcadeDiceOverview(db,2,source,now).history.length,1);
  }finally{db.close();}
});
