import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initBankTables} from "../src/banking.mjs";
import {
  parseOriginalLoto6,initLoto6Tables,loto6Overview,buyLoto6Ticket,settleLoto6Draw,
  LOTO6_PRICE,LOTO6_DRAW_HOUR,LOTO6_DRAW_CAP,LOTO6_PER_USER_LIMIT
} from "../src/arcade-loto6.mjs";

const gamerand=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const original=decodeLegacyText(readFileSync(new URL("../../loto6.cgi",import.meta.url)));
const source=parseOriginalLoto6(gamerand,original);
const T0=Date.parse("2026-11-21T21:59:59Z"); // 台北時間 2026-11-22 05:59:59
const T6=T0+1000;
const TOMORROW=T6+86400000;
const nums=[1,2,3,4,5,6];
function setup({users=2,money=200000,bank=10000,building=true}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL);"
  ].join(" "));
  for(let i=1;i<=users;i++){
    db.prepare("INSERT INTO users(id) VALUES(?)").run(i);
    db.prepare("INSERT INTO characters(user_id,town_id,money,bank) VALUES(?,?,?,?)")
      .run(i,0,money,bank);
  }
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]="ゲーセン";
  storeTownMap(db,0,{tiles},"web-edited");
  initBankTables(db);
  initLoto6Tables(db);
  return db;
}
function buy(db,{user=1,numbers=nums,random=false,requestId="phase59_first_ticket",
  now=T0,rolls=[0,1,2,3,4,5]}={}){
  let n=0;
  return buyLoto6Ticket(db,user,source,{
    ...(random===true?{random:true}:{numbers,random}),
    requestId,now,timeZone:"Asia/Taipei",randomIndex:limit=>{
      assert.equal(limit,36);return rolls[n++%rolls.length];
    }
  });
}
function settle(db,{now=T6,rolls=[0,1,2,3,4,5]}={}){
  let n=0;
  return settleLoto6Draw(db,source,{
    now,timeZone:"Asia/Taipei",randomIndex:limit=>{
      assert.equal(limit,36);return rolls[n++%rolls.length];
    }
  });
}
const state=(db,user=1,now=T0)=>loto6Overview(db,user,source,now,"Asia/Taipei");
const cash=(db,user=1)=>db.prepare("SELECT money FROM characters WHERE user_id=?").get(user).money;
const bank=(db,user=1)=>db.prepare("SELECT bank FROM characters WHERE user_id=?").get(user).bank;
const tickets=db=>db.prepare("SELECT COUNT(*) n FROM arcade_loto6_tickets").get().n;
const draws=db=>db.prepare("SELECT COUNT(*) n FROM arcade_loto6_draws").get().n;
test("原版loto6入口與36取6、2500注、06:00或200注、每人20注、7種固定獎金銀行入帳",()=>{
  assert.equal(LOTO6_PRICE,2500);
  assert.equal(LOTO6_DRAW_HOUR,6);
  assert.equal(LOTO6_DRAW_CAP,200);
  assert.equal(LOTO6_PER_USER_LIMIT,20);
  assert.deepEqual(source.prizes,[0,2500,5000,100000,1000000,10000000,100000000]);
  assert.equal(source.numberMax,36);
  assert.equal(source.choose,6);
  assert.throws(()=>parseOriginalLoto6("",original),/已變更/);
  assert.throws(()=>parseOriginalLoto6(gamerand,original.replace("$koniyukingaku = 2500","$koniyukingaku = 5000")),/已變更/);
  assert.throws(()=>parseOriginalLoto6(gamerand,original.replace("$koushinjikan = 6","$koushinjikan = 7")),/已變更/);
  assert.throws(()=>parseOriginalLoto6(gamerand,original.replace("100000000);","99999999);")),/已變更/);
});
test("05:59:59購券不開獎；06:00首次檢查開獎只一次，獎金匯入普通存款且現金不返還",()=>{
  const db=setup();
  try{
    const bought=buy(db);
    assert.equal(bought.price,2500);
    assert.equal(cash(db),197500);
    assert.equal(bank(db),10000);
    assert.equal(state(db).pendingCount,1);
    assert.equal(state(db).due,false);
    assert.equal(draws(db),0);
    const result=settle(db);
    assert.equal(result.drawn,true);
    assert.equal(result.reason,"06:00");
    assert.equal(result.day,"2026-11-22");
    assert.deepEqual(result.winningNumbers,nums);
    assert.equal(result.ticketCount,1);
    assert.equal(result.totalPrize,100000000);
    assert.equal(cash(db),197500);
    assert.equal(bank(db),100010000);
    assert.equal(draws(db),1);
    assert.equal(state(db,1,T6).pendingCount,0);
    assert.equal(state(db,1,T6).history[0].matches,6);
    assert.equal(state(db,1,T6).history[0].prize,100000000);
    assert.equal(settle(db,{now:T6+1}).drawn,false);
    assert.equal(draws(db),1);
    const ledger=db.prepare("SELECT action,credit,balance FROM bank_ledger WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();
    assert.equal(ledger.action,"六號樂透中獎金");
    assert.equal(ledger.credit,100000000);
    assert.equal(ledger.balance,100010000);
  }finally{db.close();}
});
test("猜中0～6個號碼的固定獎金，無順序關聯、相同或重複選號均不接受",()=>{
  const outcomes=[0,2500,5000,100000,1000000,10000000,100000000];
  for(let hits=0;hits<=6;hits++){
    const db=setup();
    try{
      const chosen=[
        ...nums.slice(0,hits),
        ...[7,8,9,10,11,12].slice(0,6-hits)
      ];
      buy(db,{numbers:chosen});
      const result=settle(db);
      assert.equal(result.totalPrize,outcomes[hits]);
      assert.equal(bank(db),10000+outcomes[hits]);
      assert.equal(state(db,1,T6).history[0].matches,hits);
      assert.equal(cash(db),197500);
    }finally{db.close();}
  }
});
test("伺服器隨機選六個不重複號碼、回放同碼不重扣或重抽，模式不能互換",()=>{
  const db=setup();
  try{
    const got=buy(db,{random:true,requestId:"phase59_random_ticket",rolls:[35,3,2,1,0,7]});
    assert.deepEqual(got.numbers,[1,2,3,4,8,36]);
    assert.equal(got.randomSelected,true);
    const replay=buy(db,{random:true,requestId:"phase59_random_ticket",rolls:[9,10,11,12,13,14]});
    assert.equal(replay.replayed,true);
    assert.deepEqual(replay.numbers,got.numbers);
    assert.equal(cash(db),197500);
    assert.equal(tickets(db),1);
    assert.throws(()=>buy(db,{requestId:"phase59_random_ticket"}),/不可更換/);
    const manual=buy(db,{requestId:"phase59_manual_next",numbers:[6,5,4,3,2,1]});
    assert.deepEqual(manual.numbers,[6,5,4,3,2,1]);
    assert.throws(()=>buy(db,{requestId:"phase59_manual_next",numbers:nums}),/不可更換/);
    assert.equal(tickets(db),2);
  }finally{db.close();}
});
test("當日06:00開獎之後購買的是下一輪；跨午夜而未到06:00仍不重複開獎",()=>{
  const db=setup();
  try{
    buy(db);
    settle(db);
    const next=buy(db,{now:T6+2000,requestId:"phase59_after_six"});
    assert.equal(next.drawTriggered,false);
    assert.equal(state(db,1,T6+2000).pendingCount,1);
    assert.equal(state(db,1,T6+2000).due,false);
    assert.equal(settle(db,{now:TOMORROW-1000}).drawn,false);
    assert.equal(settle(db,{now:TOMORROW}).drawn,true);
    assert.equal(draws(db),2);
    assert.equal(state(db,1,TOMORROW).pendingCount,0);
  }finally{db.close();}
});
test("同輪每人20注封頂但不封鎖其他人；開獎後同人可再買新一輪",()=>{
  const db=setup();
  try{
    for(let i=0;i<20;i++)buy(db,{requestId:"phase59_limit_"+i.toString().padStart(4,"0")});
    assert.equal(state(db).myPendingCount,20);
    assert.equal(state(db).pendingCount,20);
    assert.throws(()=>buy(db,{requestId:"phase59_exceeds_limit"}),/最多20注/);
    assert.equal(cash(db),150000);
    assert.equal(tickets(db),20);
    buy(db,{user:2,requestId:"phase59_other_allowed"});
    assert.equal(state(db,2).myPendingCount,1);
    settle(db);
    assert.equal(state(db,1,T6).myPendingCount,0);
    buy(db,{now:T6+1000,requestId:"phase59_next_round"});
    assert.equal(state(db,1,T6+1000).myPendingCount,1);
    assert.equal(tickets(db),22);
  }finally{db.close();}
});
test("200注上限可在06:00前觸發開獎；同一日已開獎後不會再無條件06:00重抽",()=>{
  const db=setup({users:10});
  try{
    for(let user=1;user<=10;user++)
      for(let i=0;i<20;i++)
        buy(db,{user,requestId:"phase59_cap_"+user+"_"+String(i).padStart(3,"0")});
    assert.equal(state(db,1).pendingCount,200);
    assert.equal(state(db,1).dueReason,"200 tickets");
    assert.equal(draws(db),0);
    const settled=settle(db,{now:T0});
    assert.equal(settled.reason,"200 tickets");
    assert.equal(settled.ticketCount,200);
    assert.equal(draws(db),1);
    assert.equal(state(db,1,T6).due,false);
    assert.equal(settle(db,{now:T6}).drawn,false);
    assert.equal(draws(db),1);
    assert.equal(state(db,1,T6).history[0].prize,100000000);
    assert.equal(bank(db),2000010000);
    assert.equal(cash(db),150000);
  }finally{db.close();}
});
test("當日開獎前無待結算注時也保留原版空場開獎；之後購入安排下輪",()=>{
  const db=setup();
  try{
    const empty=settle(db);
    assert.equal(empty.drawn,true);
    assert.equal(empty.ticketCount,0);
    assert.equal(draws(db),1);
    const bought=buy(db,{now:T6+1000});
    assert.equal(bought.drawTriggered,false);
    assert.equal(state(db,1,T6+1000).myPendingCount,1);
  }finally{db.close();}
});
test("普通銀行先計息再發獎，新獎金不會被當日再次生息",()=>{
  const db=setup();
  try{
    db.prepare("INSERT INTO bank_accounts(user_id,term_balance,last_interest_day) VALUES(1,0,'2026-11-21')").run();
    buy(db);
    settle(db);
    assert.equal(bank(db),100010050);
    const ledger=db.prepare("SELECT action,credit,balance FROM bank_ledger WHERE user_id=1 ORDER BY id").all();
    assert.deepEqual(ledger.map(x=>x.action),["普通存款利息","六號樂透中獎金"]);
    assert.equal(ledger[0].credit,50);
    assert.equal(ledger[1].credit,100000000);
    assert.equal(ledger[1].balance,100010050);
  }finally{db.close();}
});
test("失敗回滾：不合法號碼、現金不足、銀行溢位及帳簿寫入失敗不可留下部分開獎",()=>{
  const db=setup({money:2499});
  try{
    for(const numbers of [[1,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5,37],[1,2,3],
      [1,2,3,4,5,"6"]])
      assert.throws(()=>buy(db,{numbers}),/格式/);
    assert.throws(()=>buy(db,{random:"yes"}),/格式/);
    assert.throws(()=>buy(db,{requestId:"short"}),/格式/);
    assert.throws(()=>buy(db),/現金不足/);
    assert.equal(tickets(db),0);
    assert.equal(cash(db),2499);
  }finally{db.close();}
  const noBuilding=setup({building:false});
  try{
    assert.equal(state(noBuilding).available,false);
    assert.throws(()=>buy(noBuilding),/沒有原版遊樂中心/);
  }finally{noBuilding.close();}
  const overflow=setup({bank:Number.MAX_SAFE_INTEGER});
  try{
    buy(overflow);
    assert.throws(()=>settle(overflow),/安全範圍/);
    assert.equal(draws(overflow),0);
    assert.equal(state(overflow).pendingCount,1);
    assert.equal(bank(overflow),Number.MAX_SAFE_INTEGER);
  }finally{overflow.close();}
  const ledgerFail=setup();
  try{
    buy(ledgerFail);
    ledgerFail.exec("CREATE TRIGGER reject_loto6 BEFORE INSERT ON bank_ledger BEGIN SELECT RAISE(ABORT,'ledger blocked'); END;");
    assert.throws(()=>settle(ledgerFail),/ledger blocked/);
    assert.equal(draws(ledgerFail),0);
    assert.equal(state(ledgerFail).pendingCount,1);
    assert.equal(bank(ledgerFail),10000);
    ledgerFail.exec("DROP TRIGGER reject_loto6");
    assert.equal(settle(ledgerFail).drawn,true);
  }finally{ledgerFail.close();}
});
test("購票重送、未到期檢查皆不重複扣款；刪角色不刪全域開獎紀錄",()=>{
  const db=setup();
  try{
    const a=buy(db,{user:1,requestId:"phase59_same_request"});
    const b=buy(db,{user:2,requestId:"phase59_same_request"});
    assert.equal(a.replayed,false);
    assert.equal(b.replayed,false);
    assert.equal(tickets(db),2);
    assert.equal(buy(db,{user:1,requestId:"phase59_same_request"}).replayed,true);
    assert.equal(cash(db),197500);
    assert.equal(settle(db,{now:T0}).drawn,false);
    assert.equal(draws(db),0);
    settle(db);
    assert.equal(draws(db),1);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(tickets(db),1);
    assert.equal(draws(db),1);
    assert.equal(state(db,2,T6).history.length,1);
  }finally{db.close();}
});
