import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {
  INSTANT_LOTO_SYMBOL,INSTANT_LOTO_DIGITS,INSTANT_LOTO_COOLDOWN_MS,
  INSTANT_LOTO_HISTORY_LIMIT,parseOriginalInstantLoto,initInstantLotoTables,
  instantLotoOverview,playInstantLoto
} from "../src/arcade-loto.mjs";

const arcade=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const original=decodeLegacyText(readFileSync(new URL("../../loto.cgi",import.meta.url)));
const source=parseOriginalInstantLoto(arcade,original);
const NOW=Date.parse("2026-11-21T12:00:00Z");
const zeros=[0,0,0,0,0,0];
function setup({building=true,money=5000000}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(1,0,?,77777)").run(money);
  db.exec("INSERT INTO characters(user_id,town_id,money,bank) VALUES(2,0,5000000,66666)");
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]=INSTANT_LOTO_SYMBOL;
  storeTownMap(db,0,{tiles},"web-edited");
  initInstantLotoTables(db);
  return db;
}
function play(db,{userId=1,stake=500,chosenDigits=zeros,
  rolls=[1,1,1,1,1,1],requestId="phase58_first_request",now=NOW}={}){
  let i=0;
  return playInstantLoto(db,userId,source,{
    stake,chosenDigits,requestId,now,
    randomIndex:limit=>{
      assert.equal(limit,10);
      return rolls[i++];
    }
  });
}
const cash=(db,id=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(id).money;
const bank=(db,id=1)=>db.prepare("SELECT bank FROM characters WHERE user_id=?").get(id).bank;
const count=db=>db.prepare("SELECT COUNT(*) n FROM arcade_instant_loto_rounds").get().n;

test("核對原始loto.cgi六位數獨立抽0～9、六種下注、0～6位倍率及最後遊玩者三分鐘規則",()=>{
  assert.equal(INSTANT_LOTO_SYMBOL,"ゲーセン");
  assert.equal(INSTANT_LOTO_DIGITS,6);
  assert.equal(INSTANT_LOTO_COOLDOWN_MS,180000);
  assert.equal(INSTANT_LOTO_HISTORY_LIMIT,20);
  assert.deepEqual(source.rates,[500,1000,5000,10000,50000,100000]);
  assert.deepEqual(source.multipliers,[0,2,5,20,100,500,1000]);
  assert.equal(source.originalLogLimit,50);
  assert.throws(()=>parseOriginalInstantLoto("",original),/入口/);
  assert.throws(()=>parseOriginalInstantLoto(arcade,original.replace("$loto_set2=3","$loto_set2=4")),/已變更/);
  assert.throws(()=>parseOriginalInstantLoto(arcade,original.replace("'500','1000'","'501','1000'")),/已變更/);
  assert.throws(()=>parseOriginalInstantLoto(arcade,original.replace("$bai=1000","$bai=999")),/已變更/);
  assert.throws(()=>parseOriginalInstantLoto(arcade,original.replace("int(rand(10))","int(rand(9))")),/已變更/);
});

test("六個位置分別獨立比較、允許重複：0位到6位各依原版倍率結算淨現金",()=>{
  for(let match=0;match<=6;match++){
    const db=setup();
    try{
      const chosen=[0,0,0,0,0,0],rolls=Array(6).fill(1);
      for(let i=0;i<match;i++)rolls[i]=0;
      const r=play(db,{chosenDigits:chosen,rolls,stake:1000});
      const multiplier=source.multipliers[match];
      assert.equal(r.matches,match);
      assert.equal(r.multiplier,multiplier);
      assert.equal(r.gross,1000*multiplier);
      assert.equal(r.delta,1000*(multiplier-1));
      assert.equal(cash(db),5000000+r.delta);
      assert.equal(bank(db),77777);
      assert.deepEqual(r.chosenDigits,chosen);
      assert.deepEqual(r.drawnDigits,rolls);
      assert.equal(count(db),1);
    }finally{db.close();}
  }
});

test("相同數字若位置不同不算中，六位數前導零及每一位數字完全保留",()=>{
  const db=setup();
  try{
    const chosen=[0,1,2,3,4,5],rolls=[5,4,3,2,1,0];
    const r=play(db,{chosenDigits:chosen,rolls,requestId:"phase58_reordered_digits"});
    assert.equal(r.matches,0);
    assert.equal(r.gross,0);
    assert.equal(r.delta,-500);
    assert.deepEqual(r.chosenDigits,[0,1,2,3,4,5]);
    assert.deepEqual(r.drawnDigits,[5,4,3,2,1,0]);
    const again=instantLotoOverview(db,1,source,NOW).history[0];
    assert.deepEqual(again.chosenDigits,chosen);
    assert.deepEqual(again.drawnDigits,rolls);
  }finally{db.close();}
});

test("原版最後一人限制：同人179999毫秒不准、180000毫秒可玩；他人插入會解除同人等待",()=>{
  const db=setup();
  try{
    play(db);
    assert.equal(instantLotoOverview(db,1,source,NOW).readyAt,NOW+180000);
    assert.equal(instantLotoOverview(db,2,source,NOW).readyAt,null);
    assert.throws(()=>play(db,{requestId:"phase58_too_early",now:NOW+179999}),/等候/);
    const second=play(db,{userId:2,requestId:"phase58_second_user",now:NOW+1000});
    assert.equal(second.playedAt,NOW+1000);
    assert.equal(instantLotoOverview(db,1,source,NOW+1000).readyAt,null);
    const third=play(db,{requestId:"phase58_first_after_second",now:NOW+1000});
    assert.equal(third.playedAt,NOW+1000);
    assert.equal(count(db),3);
    assert.throws(()=>play(db,{requestId:"phase58_first_cooldown",now:NOW+180999}),/等候/);
    const fourth=play(db,{requestId:"phase58_first_ready",now:NOW+181000});
    assert.equal(fourth.playedAt,NOW+181000);
    assert.equal(count(db),4);
    assert.equal(instantLotoOverview(db,1,source,NOW).history.length,3);
    assert.equal(instantLotoOverview(db,2,source,NOW).history.length,1);
  }finally{db.close();}
});

test("同一請求碼重送只回原結果、不可換下注與選號；其他帳號可用相同請求碼",()=>{
  const db=setup();
  try{
    const first=play(db,{stake:1000,requestId:"phase58_share_key",rolls:zeros});
    const money=cash(db);
    const replay=play(db,{stake:1000,requestId:"phase58_share_key",rolls:[9,9,9,9,9,9],now:NOW+1});
    assert.equal(replay.replayed,true);
    assert.deepEqual(replay.drawnDigits,zeros);
    assert.equal(replay.delta,first.delta);
    assert.equal(cash(db),money);
    assert.equal(count(db),1);
    assert.throws(()=>play(db,{stake:500,requestId:"phase58_share_key"}),/不可更換/);
    assert.throws(()=>play(db,{stake:1000,chosenDigits:[0,0,0,0,0,1],
      requestId:"phase58_share_key"}),/不可更換/);
    const second=play(db,{userId:2,requestId:"phase58_share_key"});
    assert.equal(second.replayed,false);
    assert.equal(count(db),2);
  }finally{db.close();}
});

test("無角色、無遊樂中心、無效選號／下注／請求碼皆拒絕，不會扣款或插入資料",()=>{
  const db=setup();
  try{
    const invalids=[
      {chosenDigits:[0,1,2,3,4]},
      {chosenDigits:[0,1,2,3,4,10]},
      {chosenDigits:[0,1,2,3,4,"5"]},
      {chosenDigits:[0,1,2,3,4,1.5]},
      {chosenDigits:"000000"},
      {stake:999},
      {stake:"500"},
      {requestId:"short"},
      {requestId:"phase58/@*bad"}
    ];
    for(const bad of invalids)
      assert.throws(()=>play(db,{...bad}),/格式/);
    assert.throws(()=>play(db,{userId:3}),/建立角色/);
    assert.equal(count(db),0);
    assert.equal(cash(db),5000000);
  }finally{db.close();}
  const noGame=setup({building:false});
  try{
    assert.equal(instantLotoOverview(noGame,1,source,NOW).available,false);
    assert.throws(()=>play(noGame),/沒有原版遊樂中心/);
    assert.equal(count(noGame),0);
  }finally{noGame.close();}
});

test("現金不足、伺服器抽號非法值、安全整數溢出均不修改現金與紀錄",()=>{
  const little=setup({money:499});
  try{
    assert.throws(()=>play(little),/現金不足/);
    assert.equal(cash(little),499);
    assert.equal(count(little),0);
  }finally{little.close();}
  const db=setup();
  try{
    for(const number of [-1,10,0.5,NaN,Infinity])
      assert.throws(()=>play(db,{rolls:Array(6).fill(number)}),/不合法/);
    assert.equal(count(db),0);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>play(db,{rolls:zeros}),/安全範圍/);
    assert.equal(cash(db),Number.MAX_SAFE_INTEGER);
    assert.equal(count(db),0);
  }finally{db.close();}
});

test("紀錄插入中途失敗：預扣、開獎與付款在同一SQLite交易回滾",()=>{
  const db=setup();
  try{
    db.exec("CREATE TRIGGER reject_loto BEFORE INSERT ON arcade_instant_loto_rounds BEGIN SELECT RAISE(ABORT,'loto blocked'); END;");
    assert.throws(()=>play(db,{rolls:zeros}),/loto blocked/);
    assert.equal(cash(db),5000000);
    assert.equal(count(db),0);
    db.exec("DROP TRIGGER reject_loto");
    const success=play(db,{rolls:zeros});
    assert.equal(success.gross,500000);
    assert.equal(cash(db),5499500);
    assert.equal(count(db),1);
  }finally{db.close();}
});

test("本人最多顯示20筆但SQLite保存完整紀錄，最近玩家與帳號刪除外鍵一致",()=>{
  const db=setup();
  try{
    for(let i=0;i<23;i++)
      play(db,{requestId:"phase58_history_"+String(i).padStart(4,"0"),
        now:NOW+i*180000});
    assert.equal(count(db),23);
    const hist=instantLotoOverview(db,1,source,NOW+23*180000);
    assert.equal(hist.totalPlays,23);
    assert.equal(hist.history.length,20);
    assert.equal(hist.history[0].playedAt,NOW+22*180000);
    assert.equal(hist.history.at(-1).playedAt,NOW+3*180000);
    play(db,{userId:2,requestId:"phase58_history_other",now:NOW+23*180000});
    db.exec("DELETE FROM users WHERE id=1");
    assert.equal(count(db),1);
    assert.equal(instantLotoOverview(db,2,source,NOW).history.length,1);
    assert.equal(instantLotoOverview(db,2,source,NOW).totalPlays,1);
  }finally{db.close();}
});
