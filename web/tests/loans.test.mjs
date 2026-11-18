import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  initBankTables,quoteBankLoan,LOAN_LIMIT,LOAN_TERMS,
  bankLoanOverview,borrowBankLoan,payoffBankLoan,settleBankInterest,bankLedger
} from "../src/banking.mjs";

const JOB={salary:10000};
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),money INTEGER NOT NULL,bank INTEGER NOT NULL,job_experience INTEGER NOT NULL DEFAULT 0,job_work_count INTEGER NOT NULL DEFAULT 0);",
    "INSERT INTO users(id,username) VALUES(1,'owner'),(2,'other');",
    "INSERT INTO characters(user_id,money,bank,job_experience,job_work_count) VALUES(1,200000,1000000,100,100),(2,200000,1000,0,0);"
  ].join("\n"));
  initBankTables(db);
  return db;
}

test("原版貸款額度依薪資、經驗、勤數與存款計算，計 12 至 120 日及 5 至 14% 利息",()=>{
  assert.equal(LOAN_LIMIT,300000000);
  assert.deepEqual(LOAN_TERMS,[12,24,36,48,60,72,84,96,108,120]);
  const result=quoteBankLoan({salary:10000,experience:100,workCount:100,bank:1000000,termBalance:5000000});
  assert.equal(result.maxPrincipal,14540000);
  assert.equal(result.plans[0].dailyPayment,1272250);
  assert.equal(result.plans[0].totalRepayment,15267000);
  assert.equal(result.plans[9].dailyPayment,138130);
  assert.equal(result.plans[9].totalRepayment,16575600);
  const cap=quoteBankLoan({salary:0,experience:0,workCount:0,bank:300000000,termBalance:0});
  assert.equal(cap.maxPrincipal,300000000);
  const small=quoteBankLoan({salary:10000,experience:0,workCount:0,bank:5000,termBalance:0});
  assert.equal(small.maxPrincipal,10000);
  assert.throws(()=>quoteBankLoan({salary:0,experience:-1,workCount:0,bank:0,termBalance:0}),/評估/);
});

test("貸款撥款使用原版評估最高額度，直接進普通存款，保存固定每日還款額",()=>{
  const db=setup();
  try {
    const plan=borrowBankLoan(db,1,JOB,12,"2026-11-18",1000);
    assert.equal(plan.principal,2040000);
    assert.equal(plan.dailyPayment,178500);
    assert.equal(plan.totalOutstanding,2142000);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,3040000);
    assert.equal(bankLedger(db,1)[0].credit,2040000);
    assert.equal(bankLedger(db,1)[0].action,"住宅貸款撥款");
    const status=bankLoanOverview(db,1,JOB);
    assert.equal(status.active,true);
    assert.equal(status.remainingPayments,12);
    assert.equal(status.lastAttemptDay,"2026-11-18");
    assert.throws(()=>borrowBankLoan(db,1,JOB,12,"2026-11-18",2000),/未清償/);
    assert.equal(bankLedger(db,1).length,1);
  } finally {db.close();}
});

test("每日先計息再扣貸款一期，只會計一次，完成最後一期解除借款限制",()=>{
  const db=setup();
  try {
    const borrowed=borrowBankLoan(db,1,JOB,12,"2026-11-18",1000);
    assert.equal(settleBankInterest(db,1,"2026-11-18",1100).applied,false);
    const next=settleBankInterest(db,1,"2026-11-19",2000);
    assert.equal(next.applied,true);
    assert.equal(next.ordinary,15200);
    assert.deepEqual(next.repayment,{paid:true,amount:178500,remainingPayments:11});
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,2876700);
    assert.equal(bankLoanOverview(db,1,JOB).remainingPayments,11);
    assert.equal(settleBankInterest(db,1,"2026-11-19",2300).applied,false);
    assert.equal(bankLedger(db,1).filter(x=>x.action==="住宅貸款每日還款").length,1);
    // 完整模擬剩餘期數，確保不會產生第 13 次扣款。
    for(let day=20;day<=30;day++) {
      const d="2026-11-"+String(day).padStart(2,"0");
      settleBankInterest(db,1,d,2000+day);
    }
    assert.equal(bankLoanOverview(db,1,JOB).active,false);
    assert.equal(bankLoanOverview(db,1,JOB).remainingPayments,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bank_ledger WHERE action='住宅貸款每日還款'").get().n,12);
    assert.equal(settleBankInterest(db,1,"2026-12-01",4000).repayment,undefined);
  } finally {db.close();}
});

test("日還款餘額不足時記錄未繳，絕不產生負存款且不抹除未付款",()=>{
  const db=setup();
  try {
    borrowBankLoan(db,1,JOB,12,"2026-11-18",1000);
    db.prepare("UPDATE characters SET bank=100 WHERE user_id=1").run();
    const next=settleBankInterest(db,1,"2026-11-19",2000);
    assert.deepEqual(next.repayment,{paid:false,amount:0,missed:true});
    assert.equal(bankLoanOverview(db,1,JOB).remainingPayments,12);
    assert.equal(bankLoanOverview(db,1,JOB).missedAttempts,1);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,100);
    assert.equal(bankLedger(db,1).length,1);
    db.prepare("UPDATE characters SET bank=300000 WHERE user_id=1").run();
    assert.equal(settleBankInterest(db,1,"2026-11-19",2200).applied,false);
    assert.equal(bankLoanOverview(db,1,JOB).remainingPayments,12);
    const later=settleBankInterest(db,1,"2026-11-20",3000);
    assert.equal(later.repayment.paid,true);
    assert.equal(bankLoanOverview(db,1,JOB).remainingPayments,11);
    assert.equal(bankLoanOverview(db,1,JOB).missedAttempts,1);
  } finally {db.close();}
});

test("一次還清按照每日金額乘剩餘期數，使用普通存款並留下帳簿",()=>{
  const db=setup();
  try {
    const original=borrowBankLoan(db,1,JOB,24,"2026-11-18",1000);
    assert.equal(original.principal,2040000);
    assert.equal(original.dailyPayment,90100);
    const due=original.dailyPayment*24;
    assert.equal(due,2162400);
    const result=payoffBankLoan(db,1,"2026-11-18",2000);
    assert.equal(result.paid,due);
    assert.equal(result.bank,3040000-due);
    assert.equal(bankLoanOverview(db,1,JOB).active,false);
    assert.equal(bankLedger(db,1)[0].debit,due);
    assert.throws(()=>payoffBankLoan(db,1,"2026-11-18",3000),/沒有待清償/);
  } finally {db.close();}
});

test("付款不足、錯誤期數及零借款資格時，貸款與資產原子回滾",()=>{
  const db=setup();
  try {
    assert.throws(()=>borrowBankLoan(db,1,JOB,13,"2026-11-18",1000),/期數/);
    assert.equal(bankLoanOverview(db,1,JOB).active,false);
    assert.throws(()=>borrowBankLoan(db,2,{salary:0},12,"2026-11-18",1000),/貸款/);
    const plan=borrowBankLoan(db,1,JOB,12,"2026-11-18",1000);
    db.prepare("UPDATE characters SET bank=99 WHERE user_id=1").run();
    assert.throws(()=>payoffBankLoan(db,1,"2026-11-18",2000),/普通存款不足/);
    assert.equal(db.prepare("SELECT bank FROM characters WHERE user_id=1").get().bank,99);
    assert.equal(bankLoanOverview(db,1,JOB).remainingPayments,12);
    assert.equal(bankLedger(db,1).length,1);
    assert.equal(plan.principal,2040000);
    initBankTables(db);
    assert.equal(bankLoanOverview(db,1,JOB).originalPrincipal,2040000);
  } finally {db.close();}
});
