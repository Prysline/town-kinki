// 原版 basic.cgi：普通口座每日 0.5%、スーパー定期每日 1%，
// 定期存入單位為 100 萬元，解約只能一次提領全部；帳簿保留最近 100 筆。
// 本 Web 實作將「每天一次」定義為首次狀態存取時計算一次，
// 不會將未登入的多天自動補成多次利息，詳見 web/README.md。
export const BANK_RATES = Object.freeze({ ordinary: 5, term: 10 }); // 每千分比
export const TERM_UNIT = 1000000;
export const BANK_LEDGER_LIMIT = 100;
const MAX_BALANCE = BigInt(Number.MAX_SAFE_INTEGER);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function ensureSafeAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("金額必須為正整數");
  return amount;
}
function safeSum(a, b) {
  if (![a,b].every(n => Number.isSafeInteger(n) && n >= 0))
    throw new Error("帳戶餘額不正確");
  const sum = BigInt(a) + BigInt(b);
  if (sum > MAX_BALANCE) throw new Error("金額超出安全整數範圍");
  return Number(sum);
}
export function calculateInterest(balance, perThousand) {
  if (!Number.isSafeInteger(balance) || balance < 0 ||
      !Number.isInteger(perThousand) || perThousand < 0)
    throw new Error("無效的計息資料");
  const result = BigInt(balance) * BigInt(perThousand) / 1000n;
  if (result > MAX_BALANCE) throw new Error("利息金額超出安全範圍");
  return Number(result);
}

export function initBankTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_accounts(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "term_balance INTEGER NOT NULL DEFAULT 0 CHECK(term_balance>=0),",
    "last_interest_day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS bank_ledger(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "account_type TEXT NOT NULL CHECK(account_type IN ('ordinary','term')),",
    "action TEXT NOT NULL,",
    "debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0),",
    "credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0),",
    "balance INTEGER NOT NULL CHECK(balance>=0),",
    "created_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS bank_ledger_user_idx ON bank_ledger(user_id,id);"
  ].join("\n"));
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_loans(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "principal INTEGER NOT NULL CHECK(principal>=0),",
    "daily_payment INTEGER NOT NULL CHECK(daily_payment>=0),",
    "remaining_payments INTEGER NOT NULL CHECK(remaining_payments>=0),",
    "original_payments INTEGER NOT NULL CHECK(original_payments>=0),",
    "missed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(missed_attempts>=0),",
    "last_attempt_day TEXT NOT NULL,",
    "borrowed_at INTEGER NOT NULL);"
  ].join("\n"));
  db.exec([
    "CREATE TABLE IF NOT EXISTS bank_transfers(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "amount INTEGER NOT NULL CHECK(amount>0),",
    "transfer_day TEXT NOT NULL,",
    "request_key TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,",
    "UNIQUE(sender_user_id,request_key));",
    "CREATE INDEX IF NOT EXISTS bank_transfers_daily_idx ON bank_transfers(sender_user_id,recipient_user_id,transfer_day);"
  ].join("\n"));
}
function assertDay(today) {
  if (typeof today !== "string" || !DATE.test(today))
    throw new Error("銀行計息日期格式錯誤");
}
function ensureAccount(db, userId, today) {
  assertDay(today);
  const exists = db.prepare("SELECT * FROM bank_accounts WHERE user_id=?").get(userId);
  if (exists) return exists;
  db.prepare("INSERT INTO bank_accounts(user_id,term_balance,last_interest_day) VALUES(?,0,?)")
    .run(userId, today);
  return {user_id:userId,term_balance:0,last_interest_day:today};
}
export function recordBankEntry(db, userId, accountType, action, debit, credit, balance, now = Date.now()) {
  if (!["ordinary","term"].includes(accountType) || typeof action !== "string" ||
      action.length < 1 || action.length > 50 ||
      ![debit,credit,balance].every(n => Number.isSafeInteger(n) && n >= 0) ||
      (debit > 0 && credit > 0))
    throw new Error("帳簿紀錄內容不正確");
  db.prepare(
    "INSERT INTO bank_ledger(user_id,account_type,action,debit,credit,balance,created_at) VALUES(?,?,?,?,?,?,?)"
  ).run(userId,accountType,action,debit,credit,balance,now);
  // 原版 kityou_syori 的帳簿總數上限為 100（普通和定期共用）。
  db.prepare(
    "DELETE FROM bank_ledger WHERE user_id=? AND id NOT IN (SELECT id FROM bank_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?)"
  ).run(userId,userId,BANK_LEDGER_LIMIT);
}
function applyInterest(db, userId, today, now) {
  const character = db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId);
  if (!character) return null;
  const account = ensureAccount(db,userId,today);
  if (account.last_interest_day >= today) return { ordinary:0, term:0, applied:false };
  const ordinaryInterest = calculateInterest(character.bank,BANK_RATES.ordinary);
  const termInterest = calculateInterest(account.term_balance,BANK_RATES.term);
  const ordinaryBalance = safeSum(character.bank,ordinaryInterest);
  const termBalance = safeSum(account.term_balance,termInterest);
  db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(ordinaryBalance,userId);
  db.prepare("UPDATE bank_accounts SET term_balance=?,last_interest_day=? WHERE user_id=?")
    .run(termBalance,today,userId);
  if (ordinaryInterest) recordBankEntry(db,userId,"ordinary","普通存款利息",0,ordinaryInterest,ordinaryBalance,now);
  if (termInterest) recordBankEntry(db,userId,"term","超級定期利息",0,termInterest,termBalance,now);
  const repayment = applyDailyLoanRepayment(db,userId,today,now);
  return { ordinary:ordinaryInterest, term:termInterest, applied:true,
    ...(repayment ? { repayment } : {}) };
}
// 僅供外層已啟動 BEGIN IMMEDIATE 的跨玩家交易使用（例如六號樂透開獎）。
// 不在此開新交易，讓當日利息、開獎、普通存款及銀行帳簿一起回滾。
export function settleBankInterestInTransaction(db,userId,today,now=Date.now()) {
  return applyInterest(db,userId,today,now);
}
export function settleBankInterest(db,userId,today,now=Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyInterest(db,userId,today,now);
    db.exec("COMMIT");
    return result;
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function bankOperation(db,userId,action,amount,today,now=Date.now()) {
  if (!["deposit","withdraw","termDeposit","termCancel"].includes(action))
    throw new Error("無效的銀行操作");
  db.exec("BEGIN IMMEDIATE");
  try {
    const character = db.prepare("SELECT money,bank FROM characters WHERE user_id=?").get(userId);
    if (!character) throw new Error("請先建立角色");
    // 必須先依舊餘額完成當天計息，再處理存／提款，避免存完當日就額外領息。
    const interest = applyInterest(db,userId,today,now);
    const account = db.prepare("SELECT term_balance FROM bank_accounts WHERE user_id=?").get(userId);
    const currentBank = db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId).bank;
    let money = character.money, bank = currentBank, term = account.term_balance;
    if (action === "deposit") {
      ensureSafeAmount(amount);
      if (money < amount) throw new Error("現金餘額不足");
      money -= amount; bank = safeSum(bank,amount);
      recordBankEntry(db,userId,"ordinary","存入",0,amount,bank,now);
    } else if (action === "withdraw") {
      ensureSafeAmount(amount);
      if (bank < amount) throw new Error("銀行存款不足");
      bank -= amount; money = safeSum(money,amount);
      recordBankEntry(db,userId,"ordinary","提款",amount,0,bank,now);
    } else if (action === "termDeposit") {
      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new Error("定期存款必須以正整數個 100 萬元單位存入");
      const amountInYen = BigInt(amount) * BigInt(TERM_UNIT);
      if (amountInYen > MAX_BALANCE) throw new Error("定期存款金額超出支援範圍");
      const yen = Number(amountInYen);
      if (money < yen) throw new Error("現金餘額不足以存入定期存款");
      money -= yen; term = safeSum(term,yen);
      recordBankEntry(db,userId,"term","超級定期存入",0,yen,term,now);
    } else {
      if (amount !== null && amount !== undefined) throw new Error("解約不接受部分金額");
      if (term <= 0) throw new Error("目前沒有超級定期存款可解約");
      const released = term;
      money = safeSum(money,released); term = 0;
      recordBankEntry(db,userId,"term","超級定期解約",released,0,term,now);
    }
    db.prepare("UPDATE characters SET money=?,bank=? WHERE user_id=?").run(money,bank,userId);
    db.prepare("UPDATE bank_accounts SET term_balance=? WHERE user_id=?").run(term,userId);
    db.exec("COMMIT");
    return { action, money, bank, termBalance:term, interest };
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
// basic.cgi 的原版限制：單次、每日每位收款對象的總額 <= 1 兆元。
// 原版超過上限時，預設將超出額視為捐款；Web 版為防止意外損失，直接拒絕超額請求。
export const BANK_TRANSFER_LIMIT = 1000000000000;
export const NEW_MEMBER_TRANSFER_LIMIT = 1000000;
export const NEW_MEMBER_DAYS = 7;
const DAY_MS = 86400000;

export function transferToPlayer(db, senderId, recipientName, amount, today,
  requestId, now = Date.now()) {
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new Error("無效的轉帳玩家");
  if (typeof recipientName !== "string" || !recipientName.trim() ||
      Array.from(recipientName.trim()).length > 18)
    throw new Error("請提供有效的收款角色名稱");
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("轉帳金額必須為正整數");
  if (amount > BANK_TRANSFER_LIMIT)
    throw new Error("轉帳金額超過每次 1 兆元上限");
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId))
    throw new Error("轉帳請求識別碼無效");
  assertDay(today);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("無效的轉帳時間");

  db.exec("BEGIN IMMEDIATE");
  try {
    const sender = db.prepare(
      "SELECT user_id,name FROM characters WHERE user_id=?"
    ).get(senderId);
    if (!sender) throw new Error("請先建立角色");
    const recipient = db.prepare(
      "SELECT user_id,name,created_at FROM characters WHERE name=?"
    ).get(recipientName.trim());
    if (!recipient) throw new Error("找不到指定的收款角色");
    if (recipient.user_id === senderId) throw new Error("不能轉帳給自己的角色");

    // 在帳戶異動之前確認同一請求是否已執行，重送不會再次扣款。
    const previous = db.prepare(
      "SELECT recipient_user_id,amount,id FROM bank_transfers WHERE sender_user_id=? AND request_key=?"
    ).get(senderId,requestId);
    if (previous) {
      if (previous.recipient_user_id !== recipient.user_id || previous.amount !== amount)
        throw new Error("同一轉帳識別碼不可用於不同交易");
      db.exec("COMMIT");
      return { transferId:previous.id,recipientName:recipient.name,amount,duplicate:true };
    }

    // 原版依角色 first_access 判斷註冊七天。舊 Web 存檔沒有原建立日期時預設 0，視為既有角色。
    if (now - recipient.created_at < NEW_MEMBER_DAYS * DAY_MS &&
        amount >= NEW_MEMBER_TRANSFER_LIMIT)
      throw new Error("註冊未滿七天的收款人，單筆不得達 100 萬元");

    const daily = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM bank_transfers WHERE sender_user_id=? AND recipient_user_id=? AND transfer_day=?"
    ).get(senderId,recipient.user_id,today).total;
    if (daily > BANK_TRANSFER_LIMIT - amount)
      throw new Error("今日對這位收款人的轉帳總額將超過 1 兆元");

    // 匯款人與收款人先以原有餘額完成當日利息結算，再進行轉帳。
    // 避免收款後首次讀取狀態時對剛轉入的款項再計算當日利息。
    applyInterest(db,senderId,today,now);
    applyInterest(db,recipient.user_id,today,now);
    const source = db.prepare("SELECT bank FROM characters WHERE user_id=?").get(senderId).bank;
    const target = db.prepare("SELECT bank FROM characters WHERE user_id=?").get(recipient.user_id).bank;
    if (source < amount) throw new Error("普通存款不足以完成轉帳");
    const senderBalance = source - amount;
    const recipientBalance = safeSum(target,amount);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(senderBalance,senderId);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(recipientBalance,recipient.user_id);
    const transfer = db.prepare(
      "INSERT INTO bank_transfers(sender_user_id,recipient_user_id,amount,transfer_day,request_key,created_at) VALUES(?,?,?,?,?,?)"
    ).run(senderId,recipient.user_id,amount,today,requestId,now);
    recordBankEntry(db,senderId,"ordinary","轉帳給："+recipient.name,amount,0,senderBalance,now);
    recordBankEntry(db,recipient.user_id,"ordinary","收到轉帳："+sender.name,0,amount,recipientBalance,now);
    db.exec("COMMIT");
    return {transferId:Number(transfer.lastInsertRowid),recipientName:recipient.name,
      amount,duplicate:false,bank:senderBalance};
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// 取自 basic.cgi loan：薪資 × (職業經驗/50) × (工作次數/50)
// 加上普通存款 × 2、超級定期存款 × 2.5；下取整至萬元並限制三億元。
export const LOAN_LIMIT = 300000000;
export const LOAN_TERMS = Object.freeze([12,24,36,48,60,72,84,96,108,120]);
export function quoteBankLoan({salary,experience,workCount,bank,termBalance}) {
  const nums=[salary,experience,workCount,bank,termBalance];
  if (nums.some(x=>!Number.isSafeInteger(x)||x<0)) throw new Error("貸款評估資料不正確");
  const [sal,exp,count,ordinary,term]=nums.map(BigInt);
  const weighted = (2n*sal*exp*count + 10000n*ordinary + 12500n*term)/5000n;
  const maximum = Number((weighted > BigInt(LOAN_LIMIT) ? BigInt(LOAN_LIMIT) : weighted)/10000n*10000n);
  const plans=LOAN_TERMS.map((payments,index)=>{
    const interestPercent=index+5;
    const dailyPayment=Number(BigInt(maximum)*BigInt(100+interestPercent)/
      (100n*BigInt(payments)));
    return {payments,interestPercent,dailyPayment,
      totalRepayment:dailyPayment*payments};
  });
  return {maxPrincipal:maximum,plans};
}
function currentLoan(db,userId) {
  return db.prepare("SELECT * FROM bank_loans WHERE user_id=?").get(userId) ?? null;
}
export function bankLoanOverview(db,userId,job=null) {
  const char=db.prepare(
    "SELECT bank,job_experience,job_work_count FROM characters WHERE user_id=?"
  ).get(userId);
  if (!char) return null;
  const acc=db.prepare("SELECT term_balance FROM bank_accounts WHERE user_id=?").get(userId);
  const quote=quoteBankLoan({
    salary:job?.salary ?? 0,
    experience:char.job_experience ?? 0,
    workCount:char.job_work_count ?? 0,
    bank:char.bank,
    termBalance:acc?.term_balance ?? 0
  });
  const row=currentLoan(db,userId);
  const hasLoan=Boolean(row?.remaining_payments);
  return { ...quote, active:hasLoan, originalPrincipal:hasLoan?row.principal:0,
    dailyPayment:hasLoan?row.daily_payment:0,
    remainingPayments:hasLoan?row.remaining_payments:0,
    totalOutstanding:hasLoan?row.remaining_payments*row.daily_payment:0,
    missedAttempts:hasLoan?row.missed_attempts:0,
    lastAttemptDay:hasLoan?row.last_attempt_day:null };
}
function applyDailyLoanRepayment(db,userId,today,now) {
  const loan=currentLoan(db,userId);
  if (!loan || !loan.remaining_payments || loan.last_attempt_day>=today) return null;
  const record=db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId);
  if (!record) throw new Error("貸款角色不存在");
  if (record.bank<loan.daily_payment) {
    // 原 CGI 允許扣至負存款；Web 版不允許負數，未足額則保留剩餘期數並登記欠繳。
    db.prepare(
      "UPDATE bank_loans SET last_attempt_day=?,missed_attempts=missed_attempts+1 WHERE user_id=?"
    ).run(today,userId);
    return {paid:false,amount:0,missed:true};
  }
  const remaining=loan.remaining_payments-1;
  const balance=record.bank-loan.daily_payment;
  db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(balance,userId);
  db.prepare("UPDATE bank_loans SET remaining_payments=?,last_attempt_day=? WHERE user_id=?")
    .run(remaining,today,userId);
  recordBankEntry(db,userId,"ordinary","住宅貸款每日還款",
    loan.daily_payment,0,balance,now);
  return {paid:true,amount:loan.daily_payment,remainingPayments:remaining};
}
export function borrowBankLoan(db,userId,job,termCount,today,now=Date.now()) {
  if (!LOAN_TERMS.includes(termCount)) throw new Error("貸款期數不符合可選方案");
  db.exec("BEGIN IMMEDIATE");
  try {
    const character=db.prepare(
      "SELECT bank,job_experience,job_work_count FROM characters WHERE user_id=?"
    ).get(userId);
    if (!character) throw new Error("請先建立角色");
    applyInterest(db,userId,today,now);
    const loan=currentLoan(db,userId);
    if (loan?.remaining_payments>0) throw new Error("尚有未清償貸款，不可再次借款");
    const acc=db.prepare("SELECT term_balance FROM bank_accounts WHERE user_id=?").get(userId);
    const currentBank=db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId).bank;
    const quote=quoteBankLoan({
      salary:job?.salary??0,experience:character.job_experience??0,
      workCount:character.job_work_count??0,bank:currentBank,
      termBalance:acc?.term_balance??0
    });
    if (quote.maxPrincipal<=0) throw new Error("目前沒有可借款額度");
    const plan=quote.plans.find(p=>p.payments===termCount);
    if (plan.dailyPayment<=0) throw new Error("貸款每日還款金額無效");
    const newBank=safeSum(currentBank,quote.maxPrincipal);
    db.prepare(
      "INSERT INTO bank_loans(user_id,principal,daily_payment,remaining_payments,original_payments,missed_attempts,last_attempt_day,borrowed_at) VALUES(?,?,?,?,?,0,?,?) "+
      "ON CONFLICT(user_id) DO UPDATE SET principal=excluded.principal,daily_payment=excluded.daily_payment,remaining_payments=excluded.remaining_payments,original_payments=excluded.original_payments,missed_attempts=0,last_attempt_day=excluded.last_attempt_day,borrowed_at=excluded.borrowed_at"
    ).run(userId,quote.maxPrincipal,plan.dailyPayment,termCount,termCount,today,now);
    db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(newBank,userId);
    recordBankEntry(db,userId,"ordinary","住宅貸款撥款",0,quote.maxPrincipal,newBank,now);
    db.exec("COMMIT");
    return {principal:quote.maxPrincipal,...plan,totalOutstanding:plan.totalRepayment,bank:newBank};
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}
export function payoffBankLoan(db,userId,today,now=Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const character=db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId);
    if (!character) throw new Error("請先建立角色");
    applyInterest(db,userId,today,now);
    const loan=currentLoan(db,userId);
    if (!loan?.remaining_payments) throw new Error("目前沒有待清償的貸款");
    const bank=db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId).bank;
    const due=loan.daily_payment*loan.remaining_payments;
    if (!Number.isSafeInteger(due)||due<0) throw new Error("貸款餘額超出支援範圍");
    if (bank<due) throw new Error("普通存款不足以一次清償貸款");
    const balance=bank-due;
    db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(balance,userId);
    db.prepare("UPDATE bank_loans SET remaining_payments=0,daily_payment=0,last_attempt_day=? WHERE user_id=?")
      .run(today,userId);
    recordBankEntry(db,userId,"ordinary","住宅貸款一次清償",due,0,balance,now);
    db.exec("COMMIT");
    return {paid:due,bank:balance};
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}

export function bankOverview(db,userId) {
  const account = db.prepare("SELECT term_balance,last_interest_day FROM bank_accounts WHERE user_id=?").get(userId);
  return { termBalance:account?.term_balance ?? 0, lastInterestDay:account?.last_interest_day ?? null,
    rates:{ordinaryPerThousand:BANK_RATES.ordinary,termPerThousand:BANK_RATES.term},
    termUnit:TERM_UNIT };
}
export function bankLedger(db,userId,kind=null) {
  if (kind !== null && !["ordinary","term"].includes(kind)) throw new Error("無效的帳戶類型");
  const rows=kind===null ?
    db.prepare("SELECT id,account_type,action,debit,credit,balance,created_at FROM bank_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?")
      .all(userId,BANK_LEDGER_LIMIT) :
    db.prepare("SELECT id,account_type,action,debit,credit,balance,created_at FROM bank_ledger WHERE user_id=? AND account_type=? ORDER BY id DESC LIMIT ?")
      .all(userId,kind,BANK_LEDGER_LIMIT);
  return rows.map(r=>({id:r.id,type:r.account_type,action:r.action,debit:r.debit,
    credit:r.credit,balance:r.balance,occurredAt:r.created_at}));
}
