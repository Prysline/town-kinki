import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  BANK_RATES,TERM_UNIT,BANK_LEDGER_LIMIT,
  initBankTables,calculateInterest,settleBankInterest,bankOperation,
  bankOverview,bankLedger,recordBankEntry
} from "../src/banking.mjs";

function createDb() {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),money INTEGER NOT NULL,bank INTEGER NOT NULL);",
    "INSERT INTO users(id,username) VALUES(1,'alice'),(2,'bob');",
    "INSERT INTO characters(user_id,money,bank) VALUES(1,5000000,1000000),(2,100000,50000);"
  ].join("\n"));
  initBankTables(db);
  return db;
}

test("原版普通存款 0.5%、超級定期 1%，以安全整數計算並捨去小數", () => {
  assert.deepEqual(BANK_RATES,{ordinary:5,term:10});
  assert.equal(TERM_UNIT,1000000);
  assert.equal(BANK_LEDGER_LIMIT,100);
  assert.equal(calculateInterest(1000000,5),5000);
  assert.equal(calculateInterest(1000000,10),10000);
  assert.equal(calculateInterest(199,5),0);
  assert.equal(calculateInterest(999,10),9);
  assert.equal(calculateInterest(Number.MAX_SAFE_INTEGER,0),0);
  assert.throws(() => calculateInterest(-1,5),/無效/);
  assert.throws(() => calculateInterest(1,1.5),/無效/);
});

test("第一次讀取帳戶僅建立當日計息基準，不對既有 Web 存款追溯補息", () => {
  const db=createDb();
  try {
    assert.equal(settleBankInterest(db,1,"2026-11-18",1000).applied,false);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-18");
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1000000);
    assert.equal(bankLedger(db,1).length,0);
    assert.equal(settleBankInterest(db,1,"2026-11-18",2000).applied,false);
  } finally {db.close();}
});

test("跨日普通與定期存款獨立領息，每天至多一次、不補發缺席的多日", () => {
  const db=createDb();
  try {
    settleBankInterest(db,1,"2026-11-15",1000);
    const deposited=bankOperation(db,1,"termDeposit",2,"2026-11-15",2000);
    assert.equal(deposited.money,3000000);
    assert.equal(deposited.termBalance,2000000);
    assert.equal(bankLedger(db,1)[0].credit,2000000);
    const after=settleBankInterest(db,1,"2026-11-18",3000);
    assert.deepEqual(after,{ordinary:5000,term:20000,applied:true});
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1005000);
    assert.equal(bankOverview(db,1).termBalance,2020000);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-18");
    assert.equal(settleBankInterest(db,1,"2026-11-18",4000).applied,false);
    const actions=bankLedger(db,1).map(x=>x.action);
    assert.deepEqual(actions,["超級定期利息","普通存款利息","超級定期存入"]);
    assert.equal(bankLedger(db,1,"ordinary").length,1);
    assert.equal(bankLedger(db,1,"term").length,2);
    assert.equal(settleBankInterest(db,1,"2026-11-17",5000).applied,false);
  } finally {db.close();}
});

test("普通存提款保留既有 API 的語義，並以相同交易寫入明細", () => {
  const db=createDb();
  try {
    const deposit=bankOperation(db,1,"deposit",100000,"2026-11-18",1000);
    assert.equal(deposit.money,4900000);
    assert.equal(deposit.bank,1100000);
    const withdrawal=bankOperation(db,1,"withdraw",50000,"2026-11-18",2000);
    assert.equal(withdrawal.money,4950000);
    assert.equal(withdrawal.bank,1050000);
    assert.deepEqual(bankLedger(db,1).map(x=>x.action),["提款","存入"]);
    assert.deepEqual(bankLedger(db,1).map(x=>[x.debit,x.credit,x.balance]),
      [[50000,0,1050000],[0,100000,1100000]]);
    assert.equal(bankOverview(db,2).termBalance,0);
  } finally {db.close();}
});

test("超級定期存款以百萬元整數單位存入，解約必須全額領回現金", () => {
  const db=createDb();
  try {
    const a=bankOperation(db,1,"termDeposit",1,"2026-11-18",1000);
    const b=bankOperation(db,1,"termDeposit",2,"2026-11-18",2000);
    assert.equal(a.termBalance,1000000);
    assert.equal(b.termBalance,3000000);
    assert.equal(b.money,2000000);
    assert.throws(() => bankOperation(db,1,"termCancel",1000000,"2026-11-18",3000),/不接受部分金額/);
    assert.equal(bankOverview(db,1).termBalance,3000000);
    const c=bankOperation(db,1,"termCancel",null,"2026-11-18",4000);
    assert.equal(c.termBalance,0);
    assert.equal(c.money,5000000);
    assert.equal(bankLedger(db,1)[0].debit,3000000);
    assert.throws(() => bankOperation(db,1,"termCancel",null,"2026-11-18",5000),/沒有/);
  } finally {db.close();}
});

test("不可超提款、偽造單位或溢位；任何出錯的利息和帳簿寫入均一起回滾", () => {
  const db=createDb();
  try {
    settleBankInterest(db,1,"2026-11-17",1000);
    assert.throws(() => bankOperation(db,1,"withdraw",1100000,"2026-11-18",2000),/餘額不足/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1000000);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-17");
    assert.equal(bankLedger(db,1).length,0);
    assert.throws(() => bankOperation(db,1,"termDeposit",0.5,"2026-11-18"),/正整數/);
    assert.throws(() => bankOperation(db,1,"termDeposit",Number.MAX_SAFE_INTEGER,"2026-11-18"),/範圍/);
    assert.throws(() => bankOperation(db,1,"deposit",0,"2026-11-18"),/正整數/);
    assert.throws(() => bankOperation(db,1,"deposit",-1,"2026-11-18"),/正整數/);
    assert.throws(() => bankOperation(db,1,"withdraw","10","2026-11-18"),/正整數/);
    assert.equal(bankLedger(db,1).length,0);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-17");
    const successful=bankOperation(db,1,"deposit",1,"2026-11-18",3000);
    assert.equal(successful.interest.ordinary,5000);
    assert.equal(successful.bank,1005001);
    assert.equal(bankLedger(db,1).length,2);
  } finally {db.close();}
});

test("原版通帳普通與定期共用 100 筆上限，保留最後寫入順序", () => {
  const db=createDb();
  try {
    for(let i=1;i<=105;i++)
      recordBankEntry(db,1,i%2?"ordinary":"term","測試記錄",0,i,i,1000+i);
    const ledger=bankLedger(db,1);
    assert.equal(ledger.length,100);
    assert.equal(ledger[0].credit,105);
    assert.equal(ledger[99].credit,6);
    assert.equal(bankLedger(db,1,"ordinary").length,50);
    assert.equal(bankLedger(db,1,"term").length,50);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger WHERE user_id=1").get().n,100);
  } finally {db.close();}
});

test("新銀行資料表重複初始化不會重置定期存款、計息日與交易明細", () => {
  const db=createDb();
  try {
    bankOperation(db,1,"termDeposit",2,"2026-11-18",1000);
    initBankTables(db);
    assert.equal(bankOverview(db,1).termBalance,2000000);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-18");
    assert.equal(bankLedger(db,1).length,1);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,3000000);
  } finally {db.close();}
});
