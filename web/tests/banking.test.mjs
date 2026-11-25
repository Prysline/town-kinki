import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  BANK_RATES,TERM_UNIT,BANK_LEDGER_LIMIT,
  initBankTables,calculateInterest,settleBankInterest,bankOperation,
  transferToPlayer,BANK_TRANSFER_LIMIT,NEW_MEMBER_DAYS,NEW_MEMBER_TRANSFER_LIMIT,
  bankOverview,bankLedger,recordBankEntry,calculateWeeklyTax,bankTaxOverview,refreshBankTaxSnapshot
} from "../src/banking.mjs";

function createDb() {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT 0);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),name TEXT UNIQUE NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,kpoint INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL DEFAULT 0);",
    "INSERT INTO users(id,username) VALUES(1,'alice'),(2,'bob');",
    "INSERT INTO characters(user_id,name,money,bank) VALUES(1,'甲',5000000,1000000),(2,'乙',100000,50000);"
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
    assert.throws(() => bankOperation(db,1,"withdraw",1100000,"2026-11-18",2000),/存款不足/);
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


const transferKey = n => "transfer-test-request-" + String(n).padStart(12,"0");

test("原版轉帳金額、收款新人限制、每日限額皆可核對", () => {
  assert.equal(BANK_TRANSFER_LIMIT,1000000000000);
  assert.equal(NEW_MEMBER_TRANSFER_LIMIT,1000000);
  assert.equal(NEW_MEMBER_DAYS,7);
});

test("多人轉帳應同時更新雙方銀行餘額及各自帳簿，現金和定期不變", () => {
  const db=createDb();
  try {
    const before=db.prepare("SELECT user_id,money,bank FROM characters ORDER BY user_id").all();
    const result=transferToPlayer(db,1,"乙",750000,"2026-11-18",transferKey(1),1770000000000);
    assert.equal(result.duplicate,false);
    assert.equal(result.recipientName,"乙");
    assert.equal(result.amount,750000);
    const after=db.prepare("SELECT user_id,money,bank FROM characters ORDER BY user_id").all();
    assert.deepEqual(after.map(r=>r.bank),[250000,800000]);
    assert.deepEqual(after.map(r=>r.money),before.map(r=>r.money));
    assert.deepEqual(bankLedger(db,1).map(e=>[e.action,e.debit,e.credit,e.balance]),
      [["轉帳給：乙",750000,0,250000]]);
    assert.deepEqual(bankLedger(db,2).map(e=>[e.action,e.debit,e.credit,e.balance]),
      [["收到轉帳：甲",0,750000,800000]]);
    assert.equal(bankOverview(db,1).termBalance,0);
    assert.equal(bankOverview(db,2).termBalance,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_transfers").get().n,1);
  } finally {db.close();}
});

test("重試同一請求識別碼不會重複扣款，重用識別碼篡改金額或收款人會拒絕", () => {
  const db=createDb();
  try {
    const now=1770000000000;
    const first=transferToPlayer(db,1,"乙",200000,"2026-11-18",transferKey(2),now);
    const duplicate=transferToPlayer(db,1,"乙",200000,"2026-11-18",transferKey(2),now+1000);
    assert.equal(duplicate.duplicate,true);
    assert.equal(first.transferId,duplicate.transferId);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,800000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=2").get().bank,250000);
    assert.equal(bankLedger(db,1).length,1);
    assert.equal(bankLedger(db,2).length,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_transfers").get().n,1);
    assert.throws(() => transferToPlayer(db,1,"乙",200001,"2026-11-18",transferKey(2),now+2000),/不可用於不同交易/);
    assert.throws(() => transferToPlayer(db,1,"甲",200000,"2026-11-18",transferKey(2),now+2000),/自己的角色/);
  } finally {db.close();}
});

test("原版新註冊未滿七天不能收到單筆達百萬的轉帳，滿七天可以", () => {
  const db=createDb();
  try {
    const now=1770000000000;
    db.prepare("UPDATE characters SET created_at=? WHERE user_id=2").run(now-6*86400000);
    db.prepare("UPDATE characters SET bank=3000000 WHERE user_id=1").run();
    assert.throws(() => transferToPlayer(db,1,"乙",1000000,"2026-11-18",transferKey(3),now),/未滿七天/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,3000000);
    const small=transferToPlayer(db,1,"乙",999999,"2026-11-18",transferKey(4),now);
    assert.equal(small.amount,999999);
    db.prepare("UPDATE characters SET created_at=? WHERE user_id=2").run(now-7*86400000);
    const big=transferToPlayer(db,1,"乙",1000000,"2026-11-18",transferKey(5),now);
    assert.equal(big.amount,1000000);
  } finally {db.close();}
});

test("同日向同一人轉帳累計最多一兆元，超額拒絕不會扣款或產生捐款", () => {
  const db=createDb();
  try {
    const now=1770000000000,day="2026-11-18";
    db.prepare("UPDATE characters SET bank=? WHERE user_id=1").run(1000000000500);
    const first=transferToPlayer(db,1,"乙",800000000000,day,transferKey(6),now);
    assert.equal(first.amount,800000000000);
    transferToPlayer(db,1,"乙",200000000000,day,transferKey(7),now+1000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,500);
    assert.throws(()=>transferToPlayer(db,1,"乙",1,day,transferKey(8),now+2000),/今日.*上限|今日.*超過/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,500);
    assert.equal(db.prepare("SELECT SUM(amount) AS total FROM bank_transfers WHERE sender_user_id=1").get().total,1000000000000);
    assert.equal(bankLedger(db,1).length,2);
    assert.throws(()=>transferToPlayer(db,1,"乙",BANK_TRANSFER_LIMIT+1,day,transferKey(9),now+2000),/每次/);
  } finally {db.close();}
});

test("匯款失敗時雙方計息、銀行餘額與帳簿全部回滾", () => {
  const db=createDb();
  try {
    const now=1770000000000;
    settleBankInterest(db,1,"2026-11-17",now);
    settleBankInterest(db,2,"2026-11-17",now);
    assert.throws(()=>transferToPlayer(db,1,"乙",999999999,"2026-11-18",transferKey(10),now),/存款不足/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1000000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=2").get().bank,50000);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-17");
    assert.equal(bankOverview(db,2).lastInterestDay,"2026-11-17");
    assert.equal(bankLedger(db,1).length,0);
    assert.equal(bankLedger(db,2).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_transfers").get().n,0);
  } finally {db.close();}
});

test("跨日轉帳會在雙方收到新款項前依原餘額計息", () => {
  const db=createDb();
  try {
    const now=1770000000000;
    settleBankInterest(db,1,"2026-11-17",now);
    settleBankInterest(db,2,"2026-11-17",now);
    const result=transferToPlayer(db,1,"乙",500000,"2026-11-18",transferKey(11),now);
    assert.equal(result.bank,505000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=2").get().bank,550250);
    assert.deepEqual(bankLedger(db,1).map(x=>x.action),["轉帳給：乙","普通存款利息"]);
    assert.deepEqual(bankLedger(db,2).map(x=>x.action),["收到轉帳：甲","普通存款利息"]);
    assert.equal(settleBankInterest(db,2,"2026-11-18",now+1000).applied,false);
  } finally {db.close();}
});

test("收款人餘額溢位、自己轉帳、無效名稱或請求識別碼都不得改變帳戶", () => {
  const db=createDb();
  try {
    const now=1770000000000;
    assert.throws(()=>transferToPlayer(db,1,"甲",1,"2026-11-18",transferKey(12),now),/自己的角色/);
    assert.throws(()=>transferToPlayer(db,1,"不存在",1,"2026-11-18",transferKey(13),now),/找不到/);
    assert.throws(()=>transferToPlayer(db,1,"乙",-1,"2026-11-18",transferKey(14),now),/正整數/);
    assert.throws(()=>transferToPlayer(db,1,"乙",1,"2026-11-18","bad",now),/識別碼/);
    settleBankInterest(db,1,"2026-11-18",now);
    settleBankInterest(db,2,"2026-11-18",now);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=2").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>transferToPlayer(db,1,"乙",1,"2026-11-18",transferKey(15),now),/安全整數/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1000000);
    assert.equal(bankLedger(db,1).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_transfers").get().n,0);
  } finally {db.close();}
});

// BK-04：原版 town_maker.cgi 稅率級距與非單調 K 點折扣。
test("星期一稅基門檻與 K 點六段折扣按原版整數規則",()=>{
  assert.equal(calculateWeeklyTax(1000000,0).due,0);
  assert.equal(calculateWeeklyTax(1000001,0).due,10000);
  assert.equal(calculateWeeklyTax(10000000,0).due,100000);
  assert.equal(calculateWeeklyTax(10000001,0).due,300000);
  assert.equal(calculateWeeklyTax(100000000,0).due,3000000);
  assert.equal(calculateWeeklyTax(100000001,0).due,5000000);
  assert.equal(calculateWeeklyTax(1000000000,0).due,50000000);
  assert.equal(calculateWeeklyTax(1000000001,0).due,70000000);
  const expected=[[0,60000],[24,60000],[25,45000],[49,45000],[50,40000],
    [99,40000],[100,30000],[249,30000],[250,20000],[499,20000],
    [500,15000],[999,15000],[1000,0]];
  for(const [points,due] of expected)
    assert.equal(calculateWeeklyTax(6000000,points).due,due,"K 點 "+points);
  assert.throws(()=>calculateWeeklyTax(Number.MAX_SAFE_INTEGER+1,0),/稅基/);
  assert.equal(calculateWeeklyTax(6000000,-1).due,60000); // 原版負 K 點與 0 點同為無折扣
});

test("跨入星期一先計息與還款，再依上次快照徵稅，重讀不雙扣",()=>{
  const db=createDb();
  try{
    settleBankInterest(db,1,"2026-11-22",1000);
    assert.equal(bankTaxOverview(db,1).assessmentBase,6000000);
    const monday=settleBankInterest(db,1,"2026-11-23",2000);
    assert.equal(monday.ordinary,5000);
    assert.equal(monday.tax.due,60000);
    assert.equal(monday.tax.paid,60000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,945000);
    assert.deepEqual(bankLedger(db,1).map(x=>x.action),["每週納稅","普通存款利息"]);
    assert.equal(settleBankInterest(db,1,"2026-11-23",3000).applied,false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_tax_assessments").get().n,1);
    assert.equal(bankTaxOverview(db,1).lastAssessment.assessmentBase,6000000);
  } finally{db.close();}
});

test("星期一依前次存檔稅基，不使用臨時修改的資產，也不追溯新初始化資料",()=>{
  const db=createDb();
  try{
    settleBankInterest(db,1,"2026-11-22",1000);
    db.prepare("UPDATE characters SET money=0,kpoint=100 WHERE user_id=1").run();
    const monday=settleBankInterest(db,1,"2026-11-23",2000);
    assert.equal(monday.tax.due,30000);
    assert.equal(monday.tax.ratePercent,1);
    assert.equal(bankTaxOverview(db,1).lastAssessment.assessmentBase,6000000);
    const first=settleBankInterest(db,2,"2026-11-23",2000);
    assert.equal(first.applied,false,"既有資料當週一首次讀取只初始化");
    assert.equal(bankTaxOverview(db,2).lastAssessment,null);
  }finally{db.close();}
});

test("存款不足整筆暫不扣，保留欠稅而不動現金或定存",()=>{
  const db=createDb();
  try{
    settleBankInterest(db,1,"2026-11-22",1000);
    db.prepare("UPDATE characters SET bank=1000 WHERE user_id=1").run();
    const result=settleBankInterest(db,1,"2026-11-23",2000);
    assert.equal(result.tax.due,60000);
    assert.equal(result.tax.paid,0);
    assert.equal(result.tax.unpaid,60000);
    assert.equal(db.prepare("SELECT money,bank FROM characters WHERE user_id=1").get().money,5000000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1005);
    assert.deepEqual(bankLedger(db,1).map(x=>x.action),["普通存款利息"]);
    assert.equal(bankTaxOverview(db,1).lastAssessment.unpaid,60000);
  } finally{db.close();}
});

test("日期錯誤、稅務寫入失敗時連同利息、帳簿、稅基一同回滾",()=>{
  const db=createDb();
  try{
    settleBankInterest(db,1,"2026-11-22",1000);
    assert.throws(()=>refreshBankTaxSnapshot(db,1,"not-a-day"),/日期/);
    db.exec("CREATE TRIGGER block_weekly_tax BEFORE INSERT ON bank_tax_assessments BEGIN SELECT RAISE(ABORT,'tax blocked'); END;");
    assert.throws(()=>settleBankInterest(db,1,"2026-11-23",2000),/tax blocked/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,1000000);
    assert.equal(bankOverview(db,1).lastInterestDay,"2026-11-22");
    assert.equal(bankTaxOverview(db,1).snapshotDay,"2026-11-22");
    assert.equal(bankLedger(db,1).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_tax_assessments").get().n,0);
  }finally{db.close();}
});

test("BK-04 跨週欠稅：後週繳清仍顯示先前未繳期數與總額",()=>{
  const db=createDb();
  try{
    settleBankInterest(db,1,"2026-11-22",1000);
    db.prepare("UPDATE characters SET bank=1000 WHERE user_id=1").run();
    const first=settleBankInterest(db,1,"2026-11-23",2000);
    assert.equal(first.tax.unpaid,60000);
    assert.equal(bankTaxOverview(db,1).unpaidTotal,"60000");
    assert.equal(bankTaxOverview(db,1).unpaidPeriods,1);
    // 下週之前重新累積普通存款；舊欠稅不會被追繳。
    db.prepare("UPDATE characters SET bank=1000000 WHERE user_id=1").run();
    settleBankInterest(db,1,"2026-11-29",3000);
    const next=settleBankInterest(db,1,"2026-11-30",4000);
    assert.ok(next.tax.paid>0);
    assert.equal(next.tax.unpaid,0);
    const overview=bankTaxOverview(db,1);
    assert.equal(overview.lastAssessment.day,"2026-11-30");
    assert.equal(overview.lastAssessment.unpaid,0);
    assert.equal(overview.unpaidTotal,"60000","較早星期一欠稅不可被最新繳款遮蔽");
    assert.equal(overview.unpaidPeriods,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_tax_assessments WHERE unpaid>0").get().n,1);
    initBankTables(db);
    assert.equal(bankTaxOverview(db,1).unpaidTotal,"60000","重複初始化不可清除欠稅");
    assert.equal(settleBankInterest(db,1,"2026-11-30",5000).applied,false);
    assert.equal(bankTaxOverview(db,1).unpaidTotal,"60000");
  }finally{db.close();}
});

test("BK-04 房貸先還再依保存淨資產納稅，入帳順序與失敗回滾一致",()=>{
  const db=createDb();
  try{
    db.prepare("INSERT INTO bank_loans(user_id,principal,daily_payment,remaining_payments,original_payments,missed_attempts,last_attempt_day,borrowed_at) VALUES(1,100000,50000,2,2,0,'2026-11-22',100)").run();
    settleBankInterest(db,1,"2026-11-22",200);
    assert.equal(bankTaxOverview(db,1).assessmentBase,5900000);
    const monday=settleBankInterest(db,1,"2026-11-23",300);
    assert.deepEqual(monday.repayment,{paid:true,amount:50000,remainingPayments:1});
    assert.equal(monday.tax.due,59000);
    assert.equal(monday.tax.paid,59000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,896000);
    assert.deepEqual(bankLedger(db,1).map(x=>x.action),
      ["每週納稅","住宅貸款每日還款","普通存款利息"]);
    assert.equal(db.prepare("SELECT remaining_payments FROM bank_loans WHERE user_id=1").get().remaining_payments,1);
  }finally{db.close();}
});

test("舊版非負 K 點稅務表升級保留歷史，負 K 點可在下週正確結算",()=>{
  const db=createDb();
  try{
    settleBankInterest(db,1,"2026-11-22",1000);
    settleBankInterest(db,1,"2026-11-23",2000);
    const original=db.prepare("SELECT * FROM bank_tax_assessments").all();
    const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name='bank_tax_assessments'").get().sql;
    db.exec("ALTER TABLE bank_tax_assessments RENAME TO previous_tax");
    db.exec(schema.replace("kpoint INTEGER NOT NULL,","kpoint INTEGER NOT NULL CHECK(kpoint>=0),"));
    db.exec("INSERT INTO bank_tax_assessments SELECT * FROM previous_tax; DROP TABLE previous_tax;");
    initBankTables(db);
    assert.deepEqual(db.prepare("SELECT * FROM bank_tax_assessments").all(),original);
    db.prepare("UPDATE characters SET kpoint=-3 WHERE user_id=1").run();
    settleBankInterest(db,1,"2026-11-29",3000);
    const next=settleBankInterest(db,1,"2026-11-30",4000);
    assert.equal(next.tax.discount,0);
    assert.equal(bankTaxOverview(db,1).lastAssessment.kpoint,-3);
    initBankTables(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_tax_assessments").get().n,2);
  }finally{db.close();}
});
