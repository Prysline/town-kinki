// recycle.cgi：全玩家共用二手貨架與真實資產交易，僅修改 Web 來源的 33 欄。
export const RECYCLE_SYMBOL="リサイ";
export const RECYCLE_MAX_LISTINGS=50;
export const RECYCLE_LIFETIME_MS=7*86400000;
export const RECYCLE_SELL_MAX=200000;
export const RECYCLE_WAIT_MS=30*60000;
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;
const OWNED=new Set(["__web_retail__","__web_gift__","__web_recycle__"]);
function check(userId,requestId,now,hasBuilding){
  if(!Number.isSafeInteger(userId)||userId<1||typeof requestId!=="string"||
     !REQUEST.test(requestId)||!Number.isSafeInteger(now)||now<=0||
     typeof hasBuilding!=="function")throw new Error("回收商店請求格式不正確");
}
export function initRecycleTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS recycle_listings(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "seller_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "source_line INTEGER NOT NULL,category TEXT NOT NULL,name TEXT NOT NULL,",
    "quantity INTEGER NOT NULL,unit TEXT NOT NULL,unit_price INTEGER NOT NULL,",
    "sale_price INTEGER NOT NULL,raw_fields_json TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,status TEXT NOT NULL",
    "CHECK(status IN ('active','sold','expired')));",
    "CREATE INDEX IF NOT EXISTS recycle_active_idx ON recycle_listings(status,id);",
    "CREATE TABLE IF NOT EXISTS recycle_transactions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,action TEXT NOT NULL,listing_id INTEGER NOT NULL,",
    "source_line INTEGER NOT NULL,name TEXT NOT NULL,amount INTEGER NOT NULL,",
    "created_at INTEGER NOT NULL,UNIQUE(user_id,request_id));"
  ].join(" "));
}
function validateRaw(row){
  if(!row||!OWNED.has(row.original_id))
    throw new Error("只能出售本人 Web 取得的物品；原版匯入持有物維持唯讀");
  let f;try{f=JSON.parse(row.raw_fields_json);}catch{}
  if(!Array.isArray(f)||f.length!==33||f[0]!==row.category||
     f[1]!==row.original_name||f[9]!==row.effect||
     f[21]!==String(row.durability)||f[22]!==row.durability_unit)
    throw new Error("物品 33 欄來源不一致，不能出售");
  return f;
}
function remaining(row,now){
  if(row.durability_unit==="日"){
    if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)return 0;
    const elapsed=Math.max(0,Math.floor((Math.floor(now/1000)-row.purchased_at)/86400));
    return Math.max(0,row.durability-elapsed);
  }
  return row.durability_unit==="回"?Math.max(0,row.used_remaining??row.durability):0;
}
function requireShop(db,userId,hasBuilding){
  const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
  if(!char)throw new Error("請先建立角色");
  if(!hasBuilding(RECYCLE_SYMBOL,char.town_id))
    throw new Error("角色目前所在城鎮沒有回收商店");
  return char;
}
function prune(db,now){
  db.prepare("UPDATE recycle_listings SET status='expired' WHERE status='active' AND created_at<=?")
    .run(now-RECYCLE_LIFETIME_MS);
  const old=db.prepare([
    "SELECT id FROM recycle_listings WHERE status='active'",
    "ORDER BY id DESC LIMIT -1 OFFSET ?"
  ].join(" ")).all(RECYCLE_MAX_LISTINGS);
  const update=db.prepare("UPDATE recycle_listings SET status='expired' WHERE id=?");
  for(const row of old)update.run(row.id);
}
function nextLine(db,userId){
  const row=db.prepare("SELECT COALESCE(MAX(source_line),0) AS n FROM legacy_inventory_items WHERE user_id=?").get(userId);
  const n=Math.max(4000000,row.n+1);
  if(!Number.isSafeInteger(n))throw new Error("回收物品流水超出上限");
  return n;
}
function transact(db,userId,requestId,now,hasBuilding,action,listingId,work){
  check(userId,requestId,now,hasBuilding);
  if(!Number.isSafeInteger(listingId)||listingId<1)
    throw new Error("回收商品編號不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const past=db.prepare([
      "SELECT action,listing_id,source_line,name,amount",
      "FROM recycle_transactions WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(past){
      if(past.action!==action||past.listing_id!==listingId)
        throw new Error("回收請求編號已用於其他商品或交易");
      db.exec("COMMIT");
      return {action,listingId,name:past.name,sourceLine:past.source_line,
        amount:past.amount,replayed:true};
    }
    const char=requireShop(db,userId,hasBuilding);
    prune(db,now);
    const result=work(char);
    db.prepare([
      "INSERT INTO recycle_transactions(user_id,request_id,action,listing_id,",
      "source_line,name,amount,created_at) VALUES(?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,action,listingId,result.sourceLine,result.name,result.amount,now);
    db.exec("COMMIT");
    return {action,listingId,...result,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function sellToRecycle(db,userId,{sourceLine,requestId,now,hasBuilding}={}){
  return transact(db,userId,requestId,now,hasBuilding,"sell",sourceLine,()=>{
    const row=db.prepare([
      "SELECT i.*,u.remaining AS used_remaining FROM legacy_inventory_items i",
      "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
      "WHERE i.user_id=? AND i.source_line=?"
    ].join(" ")).get(userId,sourceLine);
    const f=validateRaw(row);
    const seconds=Math.floor(now/1000);
    if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0||
       now-row.purchased_at*1000<RECYCLE_WAIT_MS)
      throw new Error("購入後未滿 30 分鐘，不能出售");
    const qty=remaining(row,now);
    if(qty<=0)throw new Error("物品耐久已耗盡或過期");
    if(row.durability_unit==="日"&&
       Math.floor((seconds-row.purchased_at)/86400)<1)
      throw new Error("按日耐久物品須至少經過完整 1 天才能出售");
    const tanka=Number(f[31]);
    if(!/^(0|[1-9][0-9]*)$/.test(f[31])||!Number.isSafeInteger(tanka))
      throw new Error("原始回收物品單價格式不正確");
    const gross=tanka*qty;
    if(!Number.isSafeInteger(gross))throw new Error("回收價格超出安全上限");
    const payout=Math.min(gross,RECYCLE_SELL_MAX);
    const unitPrice=gross>RECYCLE_SELL_MAX?
      Math.floor((payout/qty)*0.8):tanka;
    const salePrice=unitPrice*qty;
    if(!Number.isSafeInteger(salePrice))throw new Error("二手商品價格超出安全上限");
    const prepared=[...f];
    // 轉賣的日耐久重新從出售當天起算，使用次數以未消耗餘額計。
    prepared[21]=String(qty);prepared[30]=String(seconds);
    prepared[31]=String(unitPrice);
    if(row.category==="ギフト商品"&&row.effect.includes("食料品"))
      prepared[0]="食料品";
    else if(row.category==="ギフト商品"&&row.effect.includes("ファ"))
      prepared[0]="ファーストフード";
    if(db.prepare("DELETE FROM legacy_inventory_items WHERE user_id=? AND source_line=?")
      .run(userId,sourceLine).changes!==1)
      throw new Error("物品已不存在，無法回收");
    if(!Number.isSafeInteger(payout))throw new Error("回收金額不正確");
    if(db.prepare("UPDATE characters SET money=money+? WHERE user_id=? AND money<=?")
      .run(payout,userId,Number.MAX_SAFE_INTEGER-payout).changes!==1)
      throw new Error("出售收入會讓現金超出安全範圍");
    const l=db.prepare([
      "INSERT INTO recycle_listings(seller_user_id,source_line,category,name,",
      "quantity,unit,unit_price,sale_price,raw_fields_json,created_at,status)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,'active')"
    ].join(" ")).run(userId,sourceLine,prepared[0],prepared[1],
      qty,prepared[22],unitPrice,salePrice,JSON.stringify(prepared),now);
    prune(db,now);
    return {name:row.original_name,sourceLine,amount:payout,
      newListingId:Number(l.lastInsertRowid)};
  });
}
export function buyFromRecycle(db,userId,{listingId,requestId,now,hasBuilding}={}){
  return transact(db,userId,requestId,now,hasBuilding,"buy",listingId,char=>{
    const item=db.prepare("SELECT * FROM recycle_listings WHERE id=? AND status='active'")
      .get(listingId);
    if(!item)throw new Error("回收商品已售出或超過保存期");
    if(item.sale_price>char.money)throw new Error("回收商品購買現金不足");
    // 原版非禮品統一以リサイクル分類重新入庫；食料品、ファーストフード維持原類別。
    const rows=db.prepare([
      "SELECT category,durability FROM legacy_inventory_items WHERE user_id=?"
    ].join(" ")).all(userId);
    if(rows.filter(x=>x.durability>0&&!["ギフト","ギフト商品"].includes(x.category)).length>=25)
      throw new Error("一般持有物已達 25 格限制");
    let f;try{f=JSON.parse(item.raw_fields_json);}catch{}
    if(!Array.isArray(f)||f.length!==33)throw new Error("二手商品資料已損壞");
    f[0]=["食料品","ファーストフード"].includes(item.category)?item.category:"リサイクル";
    f[30]=String(Math.floor(now/1000));
    if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(item.sale_price,userId,item.sale_price).changes!==1)
      throw new Error("現金不足，回收交易取消");
    if(db.prepare("UPDATE recycle_listings SET status='sold' WHERE id=? AND status='active'")
      .run(listingId).changes!==1)
      throw new Error("回收商品已被其他玩家購入");
    const line=nextLine(db,userId);
    db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
      "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(?,'__web_recycle__',?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,line,f[0],f[1],f[9],Number(f[21]),f[22],Math.floor(now/1000),0,JSON.stringify(f));
    return {name:item.name,sourceLine:line,amount:-item.sale_price};
  });
}
export function listRecycleListings(db,now){
  return db.prepare([
    "SELECT id,name,category,quantity,unit,unit_price,sale_price,created_at",
    "FROM recycle_listings WHERE status='active' AND created_at>? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(now-RECYCLE_LIFETIME_MS,RECYCLE_MAX_LISTINGS)
    .map(r=>({id:r.id,name:r.name,category:r.category,quantity:r.quantity,
      unit:r.unit,price:r.sale_price,createdAt:r.created_at}));
}
export function listRecycleSellable(db,userId,now){
  return db.prepare([
    "SELECT i.*,u.remaining AS used_remaining FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? ORDER BY i.source_line"
  ].join(" ")).all(userId).flatMap(row=>{
    if(!OWNED.has(row.original_id))return [];
    let fields;try{fields=validateRaw(row);}catch{return [];}
    const qty=remaining(row,now);
    if(qty<=0)return [];
    const readyAt=row.purchased_at*1000+Math.max(RECYCLE_WAIT_MS,
      row.durability_unit==="日"?86400000:0);
    const tanka=Number(fields[31]);
    if(!Number.isSafeInteger(tanka)||tanka<0)return [];
    return [{sourceLine:row.source_line,name:row.original_name,category:row.category,
      quantity:qty,unit:row.durability_unit,
      payout:Math.min(RECYCLE_SELL_MAX,tanka*qty),
      readyAt,canSell:now>=readyAt}];
  });
}
export function listRecycleHistory(db,userId,limit=20){
  return db.prepare([
    "SELECT action,listing_id,source_line,name,amount,created_at",
    "FROM recycle_transactions WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:20,50)))
    .map(x=>({...x,createdAt:x.created_at}));
}
