// 原版商品資料（dat_dir/syouhin.cgi）的健康保険欄位及 mono.cgi 的日數耐久結構。
// 原版玩家商店／百貨每日抽選尚未移植，Web 僅提供健康保險的臨時直購入口。
export const ITEM_SLOT_LIMIT=25;
export const SAME_ITEM_LIMIT=5;
export const DAY_MS=86400000;
const INSURANCE_CATEGORY="日用品";
const INSURANCE_ORIGINAL_NAME="健康保険";
const VALID_REQUEST_ID=/^[a-zA-Z0-9_-]{8,80}$/;

function positiveInt(value,label) {
  if(typeof value!=="string"||!/^\d+$/.test(value))
    throw new Error("原版健康保險"+label+"資料不是有效整數");
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0)
    throw new Error("原版健康保險"+label+"數值超出範圍");
  return n;
}
export function parseLegacyInsurance(source) {
  if(typeof source!=="string")throw new Error("無效的原版商品資料");
  const matches=source.split(/\r?\n/).slice(1).filter(line=>{
    const f=line.replace(/\r$/,"").split("<>");
    return f[0]===INSURANCE_CATEGORY&&f[1]===INSURANCE_ORIGINAL_NAME;
  });
  if(matches.length!==1)throw new Error("無法唯一辨識原版健康保險商品");
  const f=matches[0].replace(/\r$/,"").split("<>");
  if(f.length<33||f[22]!=="日")throw new Error("原版健康保險的耐久格式不正確");
  const price=positiveInt(f[17],"價錢");
  const days=positiveInt(f[21],"耐久天數");
  return Object.freeze({key:"health-insurance",category:INSURANCE_CATEGORY,
    originalName:INSURANCE_ORIGINAL_NAME,name:"健康保險",
    price,days,unit:"日",maxQuantity:SAME_ITEM_LIMIT});
}
export function initInventoryTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS inventory_items(",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "item_key TEXT NOT NULL,",
    "active_until INTEGER NOT NULL,",
    "last_purchased_at INTEGER NOT NULL,",
    "PRIMARY KEY(user_id,item_key));",
    "CREATE TABLE IF NOT EXISTS inventory_purchases(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "item_key TEXT NOT NULL,",
    "quantity INTEGER NOT NULL,",
    "paid INTEGER NOT NULL,",
    "active_until INTEGER NOT NULL,",
    "request_id TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS inventory_purchase_user_idx ON inventory_purchases(user_id,id);"
  ].join("\n"));
}
function userIdValid(userId) {
  if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("無效的玩家帳號");
}
function nowValid(now) {
  if(!Number.isSafeInteger(now)||now<0)throw new Error("無效的購買時間");
}
export function inventoryOverview(db,userId,insurance,now=Date.now()) {
  userIdValid(userId);nowValid(now);
  const record=db.prepare("SELECT active_until,last_purchased_at FROM inventory_items WHERE user_id=? AND item_key=?")
    .get(userId,insurance.key);
  const remainingMs=record?Math.max(0,record.active_until-now):0;
  return {
    itemKey:insurance.key,name:insurance.name,category:insurance.category,
    originalName:insurance.originalName,price:insurance.price,
    durationDays:insurance.days,
    maxQuantity:SAME_ITEM_LIMIT,maxSlots:ITEM_SLOT_LIMIT,
    active:remainingMs>0,
    activeUntil:remainingMs>0?record.active_until:null,
    remainingMs,remainingDays:remainingMs>0?Math.ceil(remainingMs/DAY_MS):0,
    canBuy:remainingMs+insurance.days*DAY_MS<=SAME_ITEM_LIMIT*insurance.days*DAY_MS,
    lastPurchasedAt:record?.last_purchased_at??null
  };
}
export function hasActiveHealthInsurance(db,userId,insurance,now=Date.now()) {
  return inventoryOverview(db,userId,insurance,now).active;
}
export function listInsurancePurchases(db,userId,limit=20) {
  userIdValid(userId);
  const cap=Number.isSafeInteger(limit)?Math.max(1,Math.min(50,limit)):20;
  return db.prepare(
    "SELECT id,quantity,paid,active_until,created_at FROM inventory_purchases WHERE user_id=? AND item_key='health-insurance' ORDER BY id DESC LIMIT ?"
  ).all(userId,cap).map(x=>({...x}));
}
export function buyHealthInsurance(db,userId,insurance,quantity,requestId,now=Date.now()) {
  userIdValid(userId);nowValid(now);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>SAME_ITEM_LIMIT)
    throw new Error("單次健康保險購買數量必須為 1 至 5");
  if(typeof requestId!=="string"||!VALID_REQUEST_ID.test(requestId))
    throw new Error("購買請求識別碼格式不正確");
  if(insurance?.key!=="health-insurance"||
      !Number.isSafeInteger(insurance.price)||insurance.price<=0||
      !Number.isSafeInteger(insurance.days)||insurance.days<=0)
    throw new Error("不支援的健康保險商品");
  const total=insurance.price*quantity;
  const duration=insurance.days*DAY_MS*quantity;
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(duration))
    throw new Error("購買金額或期限超出安全範圍");
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous=db.prepare("SELECT item_key,quantity,paid,active_until FROM inventory_purchases WHERE user_id=? AND request_id=?")
      .get(userId,requestId);
    if(previous) {
      if(previous.item_key!==insurance.key||previous.quantity!==quantity)
        throw new Error("購買識別碼已用於不同操作");
      db.exec("COMMIT");
      return {paid:previous.paid,quantity,activeUntil:previous.active_until,replayed:true};
    }
    const character=db.prepare("SELECT money FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!Number.isSafeInteger(character.money)||character.money<total)
      throw new Error("現金不足以購買健康保險");
    const record=db.prepare("SELECT active_until FROM inventory_items WHERE user_id=? AND item_key=?")
      .get(userId,insurance.key);
    const existing=Math.max(0,(record?.active_until??0)-now);
    if(existing+duration>SAME_ITEM_LIMIT*insurance.days*DAY_MS)
      throw new Error("同種物品的有效耐久不得超過 5 份");
    const activeUntil=now+existing+duration;
    if(!Number.isSafeInteger(activeUntil))
      throw new Error("健康保險有效期限超出安全範圍");
    const changed=db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(total,userId,total);
    if(changed.changes!==1)throw new Error("購買扣款失敗");
    db.prepare(
      "INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at) VALUES(?,?,?,?) ON CONFLICT(user_id,item_key) DO UPDATE SET active_until=excluded.active_until,last_purchased_at=excluded.last_purchased_at"
    ).run(userId,insurance.key,activeUntil,now);
    db.prepare(
      "INSERT INTO inventory_purchases(user_id,item_key,quantity,paid,active_until,request_id,created_at) VALUES(?,?,?,?,?,?,?)"
    ).run(userId,insurance.key,quantity,total,activeUntil,requestId,now);
    db.exec("COMMIT");
    return {paid:total,quantity,activeUntil,replayed:false};
  }catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
