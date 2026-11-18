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
  return { ordinary:ordinaryInterest, term:termInterest, applied:true };
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
