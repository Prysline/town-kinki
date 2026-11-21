import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {
  HIGHLOW_SYMBOL,HIGHLOW_BASE_STAKE,HIGHLOW_COOLDOWN_MS,
  parseOriginalArcadeHighLow,initArcadeHighLowTables,
  arcadeHighLowOverview,playArcadeHighLow
} from "../src/arcade-highlow.mjs";

const arcade=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const donut=decodeLegacyText(readFileSync(new URL("../../donut.cgi",import.meta.url)));
const settings=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
const source=parseOriginalArcadeHighLow(arcade,donut,settings);
const now=Date.parse("2026-11-21T10:00:00Z");
function setup({building=true,money=3000000}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(1,0,?,70000)").run(money);
  db.exec("INSERT INTO characters(user_id,town_id,money,bank) VALUES(2,0,3000000,90000)");
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]=HIGHLOW_SYMBOL;
  storeTownMap(db,0,{tiles},"web-edited");
  initArcadeHighLowTables(db);
  return db;
}
function play(db,{userId=1,guess="hi",requestId="phase56_request_0001",
  at=now,roll=0}={}){
  return playArcadeHighLow(db,userId,source,{
    guess,requestId,now:at,randomIndex:()=>roll
  });
}
const cash=(db,id=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(id).money;
const rounds=db=>db.prepare("SELECT COUNT(*) AS n FROM arcade_highlow_rounds").get().n;
const table=db=>db.prepare("SELECT * FROM arcade_highlow_state WHERE id=1").get();

test("來源驗證：遊樂中心donus4、1～5五點、萬元乘累積牌數、同點勝利雙倍、10分鐘",()=>{
  assert.equal(HIGHLOW_SYMBOL,"ゲーセン");
  assert.equal(HIGHLOW_BASE_STAKE,10000);
  assert.equal(HIGHLOW_COOLDOWN_MS,600000);
  assert.deepEqual(source.cardFaces,[1,2,3,4,5]);
  assert.equal(source.baseStake,10000);
  assert.equal(source.cooldownMs,600000);
  assert.equal(source.tieMultiplier,2);
  assert.throws(()=>parseOriginalArcadeHighLow("",donut,settings),/入口/);
  const mode4Start=donut.indexOf("sub donus4 {");
  const alteredMode4=donut.slice(0,mode4Start)+
    donut.slice(mode4Start).replace("int(rand(5))+1","int(rand(8))+1");
  assert.throws(()=>parseOriginalArcadeHighLow(arcade,alteredMode4,settings),/已變更/);
  assert.throws(()=>parseOriginalArcadeHighLow(arcade,donut.replace("$doroubai = 2","$doroubai = 3"),settings),/已變更/);
  assert.throws(()=>parseOriginalArcadeHighLow(arcade,donut,settings.replace("$crad_game_time = '10'","$crad_game_time = '1'")) ,/已變更/);
});

test("原版空記錄首次牌桌種子1，前卡未設定時Perl數值比較0，猜高贏低輸",()=>{
  const high=setup(),low=setup();
  try{
    const before=arcadeHighLowOverview(high,1,source,now);
    assert.equal(before.previousCard,null);
    assert.equal(before.cardCount,1);
    assert.deepEqual(before.recentCards,[1]);
    assert.equal(before.stake,10000);
    const first=play(high,{roll:0,guess:"hi"});
    assert.deepEqual([first.previousCard,first.drawnCard,first.cardsBefore,first.cardsAfter,first.delta,first.won],
      [null,1,1,2,10000,true]);
    assert.equal(cash(high),3010000);
    assert.equal(table(high).previous_card,1);
    assert.equal(table(high).card_chain,"11");
    const firstLow=play(low,{roll:0,guess:"low"});
    assert.equal(firstLow.won,false);
    assert.equal(firstLow.delta,-10000);
    assert.equal(firstLow.cardsAfter,1);
    assert.equal(table(low).card_chain,"1");
    assert.equal(cash(low),2990000);
  }finally{high.close();low.close();}
});

test("依原版五張點數：押高/低的勝敗與累積張數×萬元，輸掉重置牌桌",()=>{
  const db=setup();
  try{
    play(db,{roll:0});
    const higher=play(db,{roll:4,userId:2,guess:"hi",requestId:"phase56_higher_second"});
    assert.equal(higher.stake,20000);
    assert.equal(higher.won,true);
    assert.equal(higher.delta,20000);
    assert.equal(higher.cardsAfter,3);
    assert.equal(table(db).card_chain,"115");
    const lower=play(db,{roll:0,at:now+600000,guess:"low",requestId:"phase56_lower_third"});
    assert.equal(lower.stake,30000);
    assert.equal(lower.won,true);
    assert.equal(lower.delta,30000);
    assert.equal(lower.cardsAfter,4);
    const lost=play(db,{roll:4,userId:2,at:now+600000,guess:"low",requestId:"phase56_lost_fourth"});
    assert.equal(lost.stake,40000);
    assert.equal(lost.won,false);
    assert.equal(lost.delta,-40000);
    assert.equal(lost.cardsAfter,1);
    assert.equal(table(db).card_chain,"5");
    assert.equal(cash(db),3040000);
    assert.equal(cash(db,2),2980000);
    assert.equal(rounds(db),4);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,70000);
  }finally{db.close();}
});

test("同點數原版設定：不論猜高低都判安全，依下注額雙倍獲勝，牌桌延長",()=>{
  const db=setup();
  try{
    play(db,{roll:2,guess:"hi"});
    const tie=play(db,{userId:2,roll:2,guess:"low",requestId:"phase56_tie_second"});
    assert.equal(tie.previousCard,3);
    assert.equal(tie.drawnCard,3);
    assert.equal(tie.tie,true);
    assert.equal(tie.won,true);
    assert.equal(tie.stake,20000);
    assert.equal(tie.delta,40000);
    assert.equal(tie.cardsAfter,3);
    assert.equal(table(db).card_chain,"133");
  }finally{db.close();}
});

test("玩家十分鐘冷卻在599999毫秒拒絕、600000毫秒通過；他人抽牌不重設本人冷卻",()=>{
  const db=setup();
  try{
    play(db);
    play(db,{userId:2,roll:4,requestId:"phase56_other_after"});
    const balance=cash(db);
    const overview=arcadeHighLowOverview(db,1,source,now);
    assert.equal(overview.readyAt,now+600000);
    assert.equal(overview.history.length,1);
    assert.throws(()=>play(db,{at:now+599999,requestId:"phase56_too_early"}),/10分鐘/);
    assert.equal(cash(db),balance);
    const next=play(db,{at:now+600000,roll:0,requestId:"phase56_ready_next"});
    assert.equal(next.won,false);
    assert.equal(next.delta,-30000);
    assert.equal(rounds(db),3);
  }finally{db.close();}
});

test("全玩家共享同一張牌桌，但餘額、冷卻與本人歷史分隔",()=>{
  const db=setup();
  try{
    const first=play(db,{userId:1,guess:"hi",roll:1,requestId:"phase56_shared_id"});
    const second=play(db,{userId:2,guess:"low",roll:0,requestId:"phase56_shared_id"});
    assert.equal(first.previousCard,null);
    assert.equal(second.previousCard,2);
    assert.equal(second.stake,20000);
    assert.equal(second.won,true);
    assert.equal(table(db).card_chain,"121");
    assert.equal(arcadeHighLowOverview(db,1,source,now).history.length,1);
    assert.equal(arcadeHighLowOverview(db,2,source,now).history.length,1);
    assert.equal(cash(db),3010000);
    assert.equal(cash(db,2),3020000);
    const replay=play(db,{userId:1,guess:"hi",roll:4,requestId:"phase56_shared_id"});
    assert.equal(replay.replayed,true);
    assert.equal(table(db).card_chain,"121");
    assert.equal(rounds(db),2);
  }finally{db.close();}
});

test("原子交易防重送，改猜測、非法請求、來源或地圖不符合時不扣款",()=>{
  const db=setup();
  try{
    const first=play(db);
    const before=cash(db),chain=table(db).card_chain;
    const replay=play(db,{roll:4,at:now+20000});
    assert.equal(replay.replayed,true);
    assert.equal(replay.drawnCard,first.drawnCard);
    assert.equal(cash(db),before);
    assert.equal(table(db).card_chain,chain);
    assert.throws(()=>play(db,{guess:"low"}),/不可更改/);
    assert.throws(()=>play(db,{guess:"equal",requestId:"phase56_bad_guess"}),/格式/);
    assert.throws(()=>play(db,{requestId:"a"}),/格式/);
    assert.throws(()=>play(db,{userId:3,requestId:"phase56_missing_char"}),/建立角色/);
    assert.equal(rounds(db),1);
  }finally{db.close();}
  const none=setup({building:false});
  try{
    assert.equal(arcadeHighLowOverview(none,1,source,now).available,false);
    assert.throws(()=>play(none),/沒有原版遊樂中心/);
    assert.equal(rounds(none),0);
  }finally{none.close();}
});

test("餘額不足、非法亂數、溢出，不可改動全域牌桌或角色現金",()=>{
  const db=setup({money:9999});
  try{
    assert.throws(()=>play(db),/現金不足/);
    assert.equal(table(db).card_chain,"1");
    assert.equal(cash(db),9999);
    assert.equal(rounds(db),0);
  }finally{db.close();}
  const safe=setup();
  try{
    for(const roll of [-1,5,0.5,NaN,Infinity]){
      assert.throws(()=>play(safe,{roll}),/抽牌/);
      assert.equal(rounds(safe),0);
    }
    safe.prepare("UPDATE characters SET money=? WHERE user_id=1")
      .run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>play(safe),/安全範圍/);
    assert.equal(cash(safe),Number.MAX_SAFE_INTEGER);
    assert.equal(table(safe).card_chain,"1");
  }finally{safe.close();}
});

test("寫入遊戲紀錄失敗，全域牌桌和金錢同一筆SQLite交易回滾",()=>{
  const db=setup();
  try{
    db.exec("CREATE TRIGGER fail_highlow BEFORE INSERT ON arcade_highlow_rounds BEGIN SELECT RAISE(ABORT,'record blocked'); END;");
    assert.throws(()=>play(db),/record blocked/);
    assert.equal(cash(db),3000000);
    assert.equal(table(db).card_chain,"1");
    assert.equal(rounds(db),0);
    db.exec("DROP TRIGGER fail_highlow");
    assert.equal(play(db).won,true);
    assert.equal(cash(db),3010000);
  }finally{db.close();}
});

test("本人歷史最多展示20筆但交易帳本保留超過20筆；刪除角色紀錄不清空共用牌桌",()=>{
  const db=setup();
  try{
    for(let i=0;i<22;i++)play(db,{
      at:now+i*600000,roll:i%5,
      requestId:"phase56_history_"+String(i).padStart(4,"0")
    });
    assert.equal(rounds(db),22);
    const before=table(db).card_chain;
    const overview=arcadeHighLowOverview(db,1,source,now+22*600000);
    assert.equal(overview.history.length,20);
    assert.equal(overview.history[0].playedAt,now+21*600000);
    assert.equal(overview.history.at(-1).playedAt,now+2*600000);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(rounds(db),0);
    assert.equal(table(db).card_chain,before);
    assert.equal(arcadeHighLowOverview(db,2,source,now).cardCount,before.length);
  }finally{db.close();}
});
