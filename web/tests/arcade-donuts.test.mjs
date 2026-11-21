import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {
  DONUT_ARCADE_SYMBOL,DONUT_MODES,DONUT_HISTORY_LIMIT,
  parseOriginalArcadeDonuts,initArcadeDonutTables,
  arcadeDonutsOverview,playArcadeDonut
} from "../src/arcade-donuts.mjs";

const arcade=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const donuts=decodeLegacyText(readFileSync(new URL("../../donut.cgi",import.meta.url)));
const settings=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
const source=parseOriginalArcadeDonuts(arcade,donuts,settings);
const NOW=Date.parse("2026-11-21T11:00:00Z");
const sources=()=>Object.fromEntries(source.modes.map(m=>[m.mode,m]));
function setup({building=true,money=5000000}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2)"
  ].join(" "));
  db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(1,0,?,89000)").run(money);
  db.exec("INSERT INTO characters(user_id,town_id,money,bank) VALUES(2,0,5000000,78000)");
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]="ゲーセン";
  storeTownMap(db,0,{tiles},"web-edited");
  initArcadeDonutTables(db);
  return db;
}
function draw(db,{userId=1,mode="donus",requestId="phase57_draw_first",now=NOW,roll=0}={}){
  return playArcadeDonut(db,userId,source,{
    mode,requestId,now,randomIndex:()=>roll
  });
}
const cash=(db,user=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(user).money;
const bank=(db,user=1)=>db.prepare("SELECT bank FROM characters WHERE user_id=?").get(user).bank;
const table=(db,mode)=>db.prepare("SELECT * FROM arcade_donut_tables WHERE mode=?").get(mode);
const count=(db,mode)=>db.prepare("SELECT COUNT(*) n FROM arcade_donut_rounds WHERE mode=?").get(mode).n;
const overview=(db,mode,user=1)=>arcadeDonutsOverview(db,user,source,NOW).modes.find(m=>m.mode===mode);

test("原始三種卡牌均有入口、不同點數×1萬與2萬、同點數×10萬、抽牌機率及實際冷卻",()=>{
  assert.equal(DONUT_ARCADE_SYMBOL,"ゲーセン");
  assert.deepEqual(DONUT_MODES,["donus","donus2","donus3"]);
  assert.equal(source.actionLimitMs,5000);
  assert.equal(DONUT_HISTORY_LIMIT,20);
  const m=sources();
  assert.deepEqual([m.donus.unit,m.donus2.unit,m.donus3.unit],[10000,20000,100000]);
  assert.deepEqual([m.donus.faces,m.donus2.faces,m.donus3.faces],[5,5,3]);
  assert.deepEqual([m.donus.cooldownMs,m.donus2.cooldownMs,m.donus3.cooldownMs],
    [5000,600000,600000]);
  assert.deepEqual([m.donus.originalCardCooldownMs,m.donus2.originalCardCooldownMs,m.donus3.originalCardCooldownMs],
    [0,600000,600000]);
  assert.throws(()=>parseOriginalArcadeDonuts("",donuts,settings),/入口/);
  assert.throws(()=>parseOriginalArcadeDonuts(arcade,donuts.replace("sub donus3 {","sub donusX {"),settings),/執行分支/);
  assert.throws(()=>parseOriginalArcadeDonuts(arcade,donuts.replace("$donuts_kakekin2 = \"20000\"","$donuts_kakekin2 = \"20001\""),settings),/已變更/);
  assert.throws(()=>parseOriginalArcadeDonuts(arcade,donuts,settings.replace("$crad_game_time = '10'","$crad_game_time = '9'")) ,/已變更/);
  assert.throws(()=>parseOriginalArcadeDonuts(arcade,donuts,settings.replace("$koudou_seigen = '5'","$koudou_seigen = '4'")) ,/已變更/);
});

test("三個原版空白日誌各自初始化一張1；前卡空值：模式1/2對比0、模式3對比1",()=>{
  const db=setup();
  try{
    for(const mode of DONUT_MODES){
      assert.equal(table(db,mode).card_chain,"1");
      assert.equal(table(db,mode).previous_card,null);
      assert.equal(overview(db,mode).cardCount,1);
      assert.equal(overview(db,mode).previousCard,null);
      assert.deepEqual(overview(db,mode).recentCards,[1]);
    }
    assert.deepEqual([overview(db,"donus").risk,overview(db,"donus2").risk,
      overview(db,"donus3").risk],[10000,20000,100000]);
    const d1=draw(db,{mode:"donus",requestId:"phase57_seed1",roll:0});
    assert.equal(d1.won,true);
    assert.equal(d1.delta,10000);
    assert.equal(d1.cardsAfter,2);
    const d2=draw(db,{mode:"donus2",requestId:"phase57_seed2",roll:0});
    assert.equal(d2.won,true);
    assert.equal(d2.delta,20000);
    assert.equal(d2.cardsAfter,2);
    const d3=draw(db,{mode:"donus3",requestId:"phase57_seed3",roll:0});
    assert.equal(d3.won,true);
    assert.equal(d3.delta,100000);
    assert.equal(d3.cardsAfter,1);
    assert.equal(table(db,"donus").card_chain,"11");
    assert.equal(table(db,"donus2").card_chain,"11");
    assert.equal(table(db,"donus3").card_chain,"1");
    assert.equal(cash(db),5130000);
    assert.equal(bank(db),89000);
  }finally{db.close();}
});

test("第一種5點：和前張不同增加累積張數×1萬；相同扣同額並重置牌桌",()=>{
  const db=setup();
  try{
    draw(db,{mode:"donus",roll:0});
    const second=draw(db,{mode:"donus",roll:4,now:NOW+5000,requestId:"phase57_mode1_second"});
    assert.deepEqual([second.previousCard,second.drawnCard,second.cardsBefore,
      second.winAmount,second.risk,second.delta,second.cardsAfter],
      [1,5,2,20000,20000,20000,3]);
    const loss=draw(db,{mode:"donus",roll:4,now:NOW+10000,requestId:"phase57_mode1_third"});
    assert.equal(loss.won,false);
    assert.equal(loss.delta,-30000);
    assert.equal(loss.cardsBefore,3);
    assert.equal(loss.cardsAfter,1);
    assert.equal(table(db,"donus").card_chain,"5");
    assert.equal(cash(db),5000000);
    assert.equal(count(db,"donus"),3);
  }finally{db.close();}
});

test("第二種5點：每張2萬且本人需10分鐘；他人可立即接共同桌面",()=>{
  const db=setup();
  try{
    draw(db,{mode:"donus2",roll:1,requestId:"phase57_mode2_first"});
    const second=draw(db,{mode:"donus2",userId:2,roll:2,requestId:"phase57_mode2_other"});
    assert.equal(second.risk,40000);
    assert.equal(second.delta,40000);
    assert.equal(table(db,"donus2").card_chain,"123");
    assert.throws(()=>draw(db,{mode:"donus2",now:NOW+599999,requestId:"phase57_mode2_early"}),/冷卻/);
    const lost=draw(db,{mode:"donus2",now:NOW+600000,roll:2,requestId:"phase57_mode2_third"});
    assert.equal(lost.delta,-60000);
    assert.equal(lost.cardsAfter,1);
    assert.equal(table(db,"donus2").card_chain,"3");
    assert.equal(count(db,"donus2"),3);
    assert.equal(cash(db),4960000);
    assert.equal(cash(db,2),5040000);
  }finally{db.close();}
});

test("第三種3點：不同固定扣10萬且牌桌增長；與前張相同贏累積張數×10萬並重置",()=>{
  const db=setup();
  try{
    const loss=draw(db,{mode:"donus3",roll:1,requestId:"phase57_mode3_first"});
    assert.deepEqual([loss.won,loss.delta,loss.cardsAfter],[false,-100000,2]);
    assert.equal(table(db,"donus3").card_chain,"12");
    const loss2=draw(db,{mode:"donus3",userId:2,roll:2,requestId:"phase57_mode3_second"});
    assert.equal(loss2.won,false);
    assert.equal(loss2.risk,100000);
    assert.equal(loss2.winAmount,200000);
    assert.equal(loss2.cardsAfter,3);
    assert.equal(table(db,"donus3").card_chain,"123");
    const won=draw(db,{mode:"donus3",roll:2,now:NOW+600000,requestId:"phase57_mode3_third"});
    assert.equal(won.previousCard,3);
    assert.equal(won.drawnCard,3);
    assert.equal(won.won,true);
    assert.equal(won.risk,100000);
    assert.equal(won.winAmount,300000);
    assert.equal(won.delta,300000);
    assert.equal(won.cardsAfter,1);
    assert.equal(table(db,"donus3").card_chain,"3");
    assert.equal(cash(db),5200000);
    assert.equal(cash(db,2),4900000);
  }finally{db.close();}
});

test("第一種停用原版卡牌10分鐘限制，Web單機使用5秒行動限制；兩個時點精確界線",()=>{
  const db=setup();
  try{
    draw(db,{mode:"donus"});
    assert.equal(overview(db,"donus").readyAt,NOW+5000);
    const before=cash(db);
    assert.throws(()=>draw(db,{mode:"donus",now:NOW+4999,requestId:"phase57_mode1_too_early"}),/冷卻/);
    assert.equal(cash(db),before);
    const next=draw(db,{mode:"donus",now:NOW+5000,roll:2,requestId:"phase57_mode1_allowed"});
    assert.equal(next.won,true);
    assert.equal(count(db,"donus"),2);
  }finally{db.close();}
});

test("三張牌桌完全獨立；同一請求碼跨模式不能改寫結果，本人與他人紀錄隔離",()=>{
  const db=setup();
  try{
    draw(db,{mode:"donus",requestId:"phase57_shared_req",roll:0});
    const id2=draw(db,{userId:2,mode:"donus",requestId:"phase57_shared_req",roll:4});
    assert.equal(id2.cardsBefore,2);
    assert.equal(id2.delta,20000);
    assert.equal(overview(db,"donus",1).history.length,1);
    assert.equal(overview(db,"donus",2).history.length,1);
    assert.equal(overview(db,"donus2").history.length,0);
    assert.equal(table(db,"donus2").card_chain,"1");
    assert.throws(()=>draw(db,{mode:"donus2",requestId:"phase57_shared_req"}),/不可更換模式/);
    const replay=draw(db,{mode:"donus",requestId:"phase57_shared_req",roll:4,now:NOW+100000});
    assert.equal(replay.replayed,true);
    assert.equal(replay.drawnCard,1);
    assert.equal(count(db,"donus"),2);
    assert.equal(cash(db),5010000);
    assert.equal(cash(db,2),5020000);
  }finally{db.close();}
});

test("無角色／無建築／錯誤模式、短請求碼、非法亂數及現金不足皆不修改牌桌",()=>{
  const db=setup({money:9999});
  try{
    assert.throws(()=>draw(db),/現金不足/);
    assert.throws(()=>draw(db,{userId:3,requestId:"phase57_no_player"}),/請先建立角色/);
    assert.throws(()=>draw(db,{mode:"donus4",requestId:"phase57_bad_mode"}),/格式或模式/);
    assert.throws(()=>draw(db,{requestId:"short"}),/格式或模式/);
    assert.equal(count(db,"donus"),0);
    assert.equal(table(db,"donus").card_chain,"1");
    assert.equal(cash(db),9999);
  }finally{db.close();}
  const checked=setup();
  try{
    for(const roll of [-1,5,0.1,NaN,Infinity])
      assert.throws(()=>draw(checked,{roll,requestId:"phase57_bad_roll"}),/亂數/);
    assert.equal(count(checked,"donus"),0);
    assert.equal(cash(checked),5000000);
  }finally{checked.close();}
  const without=setup({building:false});
  try{
    assert.equal(arcadeDonutsOverview(without,1,source,NOW).available,false);
    assert.throws(()=>draw(without),/沒有原版遊樂中心/);
    assert.equal(count(without,"donus"),0);
  }finally{without.close();}
});

test("勝利金額溢出與失敗寫入交易紀錄，一律回滾現金和共用桌面",()=>{
  const db=setup();
  try{
    db.exec("CREATE TRIGGER reject_donut BEFORE INSERT ON arcade_donut_rounds BEGIN SELECT RAISE(ABORT,'donut record blocked'); END;");
    assert.throws(()=>draw(db),/donut record blocked/);
    assert.equal(cash(db),5000000);
    assert.equal(table(db,"donus").card_chain,"1");
    assert.equal(count(db,"donus"),0);
    db.exec("DROP TRIGGER reject_donut");
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>draw(db),/安全整數/);
    assert.equal(cash(db),Number.MAX_SAFE_INTEGER);
    assert.equal(table(db,"donus").card_chain,"1");
    assert.equal(count(db,"donus"),0);
  }finally{db.close();}
});

test("個人每種模式只顯示20局但帳本保留超過20筆；刪角色只清本人交易，不重置公共牌桌",()=>{
  const db=setup({money:5000000});
  try{
    for(let i=0;i<23;i++)draw(db,{mode:"donus",
      now:NOW+i*5000,roll:(i+1)%5,
      requestId:"phase57_hist_"+String(i).padStart(4,"0")});
    assert.equal(count(db,"donus"),23);
    const before=table(db,"donus").card_chain;
    const list=overview(db,"donus");
    assert.equal(list.history.length,20);
    assert.equal(list.history[0].playedAt,NOW+22*5000);
    assert.equal(list.history.at(-1).playedAt,NOW+3*5000);
    draw(db,{userId:2,mode:"donus2",requestId:"phase57_other_mode"});
    db.exec("DELETE FROM users WHERE id=1");
    assert.equal(count(db,"donus"),0);
    assert.equal(count(db,"donus2"),1);
    assert.equal(table(db,"donus").card_chain,before);
    assert.equal(overview(db,"donus2",2).history.length,1);
  }finally{db.close();}
});
