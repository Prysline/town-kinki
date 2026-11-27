import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {
  CARDW_SYMBOL,CARDW_HISTORY_LIMIT,CARDW_SOLO_REPEAT_MS,
  parseOriginalMultiCard,initMultiCardTables,multiCardOverview,playMultiCard
} from "../src/arcade-cardw.mjs";

const gamerand=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const sourceText=decodeLegacyText(readFileSync(new URL("../../cardw2.cgi",import.meta.url)));
const settings=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
const source=parseOriginalMultiCard(gamerand,sourceText,settings);
const NOW=Date.parse("2026-11-22T11:00:00Z");
function setup({money=500000000,building=true}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(1,0,?,90000)").run(money);
  db.exec("INSERT INTO characters(user_id,town_id,money,bank) VALUES(2,0,500000000,70000)");
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]=CARDW_SYMBOL;
  storeTownMap(db,0,{tiles},"web-edited");
  initMultiCardTables(db);
  return db;
}
function play(db,{userId=1,course=0,requestId="phase60_first_card",
  now=NOW,roll=0,solo=true}={}){
  return playMultiCard(db,userId,source,{
    course,requestId,now,solo,randomIndex:limit=>{
      assert.equal(limit,100);return roll;
    }
  });
}
const money=(db,id=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(id).money;
const bank=(db,id=1)=>db.prepare("SELECT bank FROM characters WHERE user_id=?").get(id).bank;
const table=db=>db.prepare("SELECT * FROM arcade_cardw_state WHERE id=1").get();
const count=db=>db.prepare("SELECT COUNT(*) n FROM arcade_cardw_rounds").get().n;
const overview=(db,id=1,solo=true,now=NOW)=>multiCardOverview(db,id,source,now,{solo});

test("原始卡牌有五課程、百分比顯示及實際<門檻判定：真實成功率各少一個百分點",()=>{
  assert.equal(CARDW_SYMBOL,"ゲーセン");
  assert.equal(CARDW_SOLO_REPEAT_MS,5000);
  assert.equal(CARDW_HISTORY_LIMIT,20);
  assert.deepEqual(source.courses.map(x=>x.unit),
    [10000,100000,1000000,10000000,100000000]);
  assert.deepEqual(source.courses.map(x=>x.displayPercent),[80,65,50,35,20]);
  assert.deepEqual(source.courses.map(x=>x.actualPercent),[79,64,49,34,19]);
  assert.deepEqual(source.courses.map(x=>x.originalCooldownMinutes),[0,0,0,0,0]);
  assert.equal(source.originalAdjacentRepeatAllowed,false);
  assert.throws(()=>parseOriginalMultiCard("",sourceText,settings),/已變更/);
  assert.throws(()=>parseOriginalMultiCard(gamerand,sourceText.replace('"80","65"','"81","65"'),settings),/已變更/);
  assert.throws(()=>parseOriginalMultiCard(gamerand,sourceText.replace('int(rand(100))+1','int(rand(99))+1'),settings),/已變更/);
  assert.throws(()=>parseOriginalMultiCard(gamerand,sourceText,settings.replace("$koudou_seigen = '5'","$koudou_seigen = '4'")),/已變更/);
});
test("原版空牌桌從倍率1開始，五個課程的本局風險是基本金額乘同一倍率",()=>{
  const db=setup();
  try{
    const v=overview(db);
    assert.equal(v.available,true);
    assert.equal(v.cardCount,1);
    assert.equal(v.lastPlayerIsMe,false);
    assert.equal(v.readyAt,null);
    assert.deepEqual(v.courses.map(x=>x.stake),
      [10000,100000,1000000,10000000,100000000]);
    assert.equal(v.history.length,0);
    assert.equal(table(db).card_count,1);
    assert.equal(table(db).last_user_id,null);
  }finally{db.close();}
});
test("成功從1倍率累進到3，猜錯扣當局基本金額×倍率並重設1，玩家現金實際變動",()=>{
  const db=setup();
  try{
    const first=play(db,{roll:0});
    assert.equal(first.roll,1);
    assert.equal(first.won,true);
    assert.equal(first.delta,10000);
    assert.equal(first.cardsAfter,2);
    const second=play(db,{course:1,roll:0,now:NOW+5000,requestId:"phase60_second"});
    assert.equal(second.stake,200000);
    assert.equal(second.delta,200000);
    assert.equal(second.cardsAfter,3);
    const loss=play(db,{course:1,roll:99,now:NOW+10000,requestId:"phase60_third"});
    assert.equal(loss.roll,100);
    assert.equal(loss.won,false);
    assert.equal(loss.stake,300000);
    assert.equal(loss.delta,-300000);
    assert.equal(loss.cardsAfter,1);
    assert.equal(money(db),499910000);
    assert.equal(bank(db),90000);
    assert.equal(table(db).card_count,1);
    assert.equal(count(db),3);
  }finally{db.close();}
});
test("五門課程勝負實際臨界值：抽到門檻−1成功、抽到門檻失敗",()=>{
  for(const course of source.courses){
    const db=setup();
    try{
      const first=play(db,{course:course.course,roll:course.displayPercent-2});
      assert.equal(first.roll,course.displayPercent-1);
      assert.equal(first.won,true);
      assert.equal(first.delta,course.unit);
      const second=play(db,{course:course.course,roll:course.displayPercent-1,
        now:NOW+5000,requestId:"phase60_threshold_second"});
      assert.equal(second.roll,course.displayPercent);
      assert.equal(second.won,false);
      assert.equal(second.stake,2*course.unit);
      assert.equal(second.delta,-2*course.unit);
    }finally{db.close();}
  }
});
test("多人禁止同人連抽；其他玩家可承接倍率，原版各課程時間檢查都為0分鐘",()=>{
  const db=setup();
  try{
    const a=play(db,{solo:false});
    assert.equal(a.cardsAfter,2);
    assert.equal(overview(db,1,false).multiplayerAdjacentRepeatBlocked,true);
    assert.throws(()=>play(db,{solo:false,now:NOW+1000000,requestId:"phase60_blocked"}),/禁止同一位玩家/);
    const b=play(db,{userId:2,solo:false,course:1,roll:0,requestId:"phase60_other"});
    assert.equal(b.cardsBefore,2);
    assert.equal(b.stake,200000);
    assert.equal(overview(db,1,false).multiplayerAdjacentRepeatBlocked,false);
    const resumed=play(db,{solo:false,now:NOW+1,course:0,requestId:"phase60_again"});
    assert.equal(resumed.cardsBefore,3);
    assert.equal(count(db),3);
    assert.equal(overview(db,1,false).history.length,2);
    assert.equal(overview(db,2,false).history.length,1);
  }finally{db.close();}
});
test("單機5秒適配只對連續同人，4999毫秒禁止、5000毫秒允許；重送不受冷卻影響",()=>{
  const db=setup();
  try{
    const first=play(db);
    assert.equal(overview(db).readyAt,NOW+5000);
    assert.throws(()=>play(db,{now:NOW+4999,requestId:"phase60_too_early"}),/五秒/);
    assert.equal(play(db,{now:NOW+4999}).replayed,true);
    const second=play(db,{now:NOW+5000,requestId:"phase60_ready",roll:79});
    assert.equal(second.won,false);
    assert.equal(second.cardsAfter,1);
    assert.equal(money(db),499990000);
    assert.equal(count(db),2);
  }finally{db.close();}
});
test("重送請求碼只回傳已結算的原牌；不可改課程，同碼跨玩家可分開使用",()=>{
  const db=setup();
  try{
    const first=play(db,{requestId:"phase60_shared_id",roll:0});
    const old=money(db);
    const repeated=play(db,{requestId:"phase60_shared_id",roll:99,now:NOW+100000});
    assert.equal(repeated.replayed,true);
    assert.equal(repeated.roll,first.roll);
    assert.equal(money(db),old);
    assert.throws(()=>play(db,{requestId:"phase60_shared_id",course:1}),/不可改變/);
    const other=play(db,{userId:2,requestId:"phase60_shared_id"});
    assert.equal(other.cardsBefore,2);
    assert.equal(count(db),2);
  }finally{db.close();}
});
test("無建築、無角色、無效課程、亂數錯誤、現金不足均拒絕且不修改牌桌",()=>{
  const db=setup({money:9999});
  try{
    assert.throws(()=>play(db),/現金不足/);
    assert.throws(()=>play(db,{userId:3}),/建立角色/);
    assert.throws(()=>play(db,{course:-1}),/不正確/);
    assert.throws(()=>play(db,{course:5}),/不正確/);
    assert.throws(()=>play(db,{requestId:"bad"}),/不正確/);
    assert.equal(table(db).card_count,1);
    assert.equal(money(db),9999);
    assert.equal(count(db),0);
  }finally{db.close();}
  const plenty=setup();
  try{
    for(const roll of [-1,100,0.5,NaN,Infinity])
      assert.throws(()=>play(plenty,{roll}),/亂數/);
    assert.equal(count(plenty),0);
    assert.equal(money(plenty),500000000);
  }finally{plenty.close();}
  const noGame=setup({building:false});
  try{
    assert.equal(overview(noGame).available,false);
    assert.throws(()=>play(noGame),/沒有原版遊樂中心/);
  }finally{noGame.close();}
});
test("發獎溢出及寫入失敗：現金、公共倍率與局數必須同時回滾",()=>{
  const db=setup();
  try{
    db.exec("CREATE TRIGGER reject_cardw BEFORE INSERT ON arcade_cardw_rounds BEGIN SELECT RAISE(ABORT,'cardw transaction blocked'); END;");
    assert.throws(()=>play(db),/cardw transaction blocked/);
    assert.equal(count(db),0);
    assert.equal(money(db),500000000);
    assert.equal(table(db).card_count,1);
    db.exec("DROP TRIGGER reject_cardw");
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>play(db),/安全整數/);
    assert.equal(money(db),Number.MAX_SAFE_INTEGER);
    assert.equal(table(db).card_count,1);
  }finally{db.close();}
});
test("本人只顯示最近20局、底層帳本保留23局；刪本人後共用倍率不被重置",()=>{
  const db=setup();
  try{
    for(let i=0;i<23;i++)
      play(db,{now:NOW+i*5000,requestId:"phase60_history_"+String(i).padStart(4,"0"),
        roll:i%2?99:0});
    assert.equal(count(db),23);
    const v=overview(db);
    assert.equal(v.history.length,20);
    assert.equal(v.history[0].playedAt,NOW+22*5000);
    assert.equal(v.history.at(-1).playedAt,NOW+3*5000);
    const prior=table(db).card_count;
    db.exec("DELETE FROM users WHERE id=1");
    assert.equal(table(db).card_count,prior);
    assert.equal(table(db).last_user_id,null);
    assert.equal(count(db),0);
  }finally{db.close();}
});
