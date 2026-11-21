// gifutoya.cgi::gifutoya_do 與 command.pl::gift_souhu_syori 的本人道具及跨玩家移交。
// 原版 33 欄 item；舊存檔僅唯讀，Web 新購／收禮的完整交易才可修改。
export const GIFT_SHOP_SYMBOL="ギフト屋";
export const GIFT_CONVERSION_FEE=50000;
export const GIFT_PURCHASED_LIMIT=10;
export const GIFT_RECEIVED_LIMIT=10;
// town_ini.cgi::$mail_hozon_gandosuu=50：收信與寄件備份共用單人保留上限。
export const GIFT_MAIL_LIMIT=50;
const DEFAULT_GIFT_MESSAGE="送給你的禮物";
const VALID_REQUEST=/^[A-Za-z0-9_-]{8,80}$/;
const EDITABLE=new Set(["__web_retail__","__web_gift__","__web_recycle__","__web_store__"]);
const DAY_MS=86400000;
function requireArgs(userId,requestId,now){
  if(!Number.isSafeInteger(userId)||userId<1||
     typeof requestId!=="string"||!VALID_REQUEST.test(requestId)||
     !Number.isSafeInteger(now)||now<=0)throw new Error("禮品操作格式不正確");
}
export function initGiftTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS gift_events(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,action TEXT NOT NULL,source_line INTEGER NOT NULL,",
    "quantity INTEGER NOT NULL,recipient_user_id INTEGER,",
    "result_source_line INTEGER NOT NULL,fee INTEGER NOT NULL,",
    "name TEXT NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS gift_events_user_idx ON gift_events(user_id,id);",
    "CREATE TABLE IF NOT EXISTS gift_mail_messages(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "event_id INTEGER NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,",
    "direction TEXT NOT NULL CHECK(direction IN ('inbox','sent')),",
    "other_name TEXT NOT NULL,message TEXT NOT NULL,",
    "gift_name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),",
    "created_at INTEGER NOT NULL,",
    "UNIQUE(event_id,direction));",
    "CREATE INDEX IF NOT EXISTS gift_mail_user_idx",
    "ON gift_mail_messages(user_id,created_at DESC,id DESC);"
  ].join(" "));
  // 既有第37階段交易表保留舊資料，新增請求文字比對避免同一 ID 偷換信件。
  if(!db.prepare("PRAGMA table_info(gift_events)").all().some(c=>c.name==="message"))
    db.exec("ALTER TABLE gift_events ADD COLUMN message TEXT NOT NULL DEFAULT ''");
}
function giftMessage(message){
  if(message===undefined)return DEFAULT_GIFT_MESSAGE; // 相容已存在、不含訊息欄的舊版 Web API
  if(typeof message!=="string"||!message.trim()||message.length>1000)
    throw new Error("寄禮訊息必須為 1～1,000 字元的非空文字");
  return message.trim();
}
function recordGiftMail(db,eventId,sender,recipient,itemName,quantity,message,now){
  const insert=db.prepare([
    "INSERT INTO gift_mail_messages(user_id,event_id,direction,other_name,",
    "message,gift_name,quantity,created_at) VALUES(?,?,?,?,?,?,?,?)"
  ].join(" "));
  insert.run(recipient.user_id,eventId,"inbox",sender.name,message,itemName,quantity,now);
  insert.run(sender.user_id,eventId,"sent",recipient.name,message,itemName,quantity,now);
  // 原版按每位角色單一 mail.cgi 檔保存收件＋寄件（合計 50 筆）。
  const prune=db.prepare([
    "DELETE FROM gift_mail_messages WHERE user_id=? AND id NOT IN (",
    "SELECT id FROM gift_mail_messages WHERE user_id=?",
    "ORDER BY created_at DESC,id DESC LIMIT ?)"
  ].join(" "));
  for(const userId of [sender.user_id,recipient.user_id])
    prune.run(userId,userId,GIFT_MAIL_LIMIT);
}
function sourceRow(db,userId,sourceLine){
  return db.prepare([
    "SELECT i.*,u.remaining AS used_remaining FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? AND i.source_line=?"
  ].join(" ")).get(userId,sourceLine);
}
function rawFields(row){
  if(!row||!EDITABLE.has(row.original_id))throw new Error("只能操作本人由 Web 購買或收到的物品，原版匯入檔保持唯讀");
  let f;try{f=JSON.parse(row.raw_fields_json);}catch{}
  if(!Array.isArray(f)||f.length!==33||f[0]!==row.category||
     f[1]!==row.original_name||f[9]!==row.effect||
     f[21]!==String(row.durability)||f[22]!==row.durability_unit)
    throw new Error("持有物原版 33 欄資料不一致，拒絕改寫");
  return f;
}
function rest(row,now){
  if(row.durability_unit==="日"){
    if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)return 0;
    const spent=Math.max(0,Math.floor((Math.floor(now/1000)-row.purchased_at)/86400));
    return Math.max(0,row.durability-spent);
  }
  if(row.durability_unit==="回")return Math.max(0,row.used_remaining??row.durability);
  return 0;
}
function nextLine(db,userId){
  const max=db.prepare("SELECT COALESCE(MAX(source_line),0) AS n FROM legacy_inventory_items WHERE user_id=?").get(userId).n;
  const next=Math.max(3000000,max+1);
  if(!Number.isSafeInteger(next))throw new Error("禮品物品流水號超出範圍");
  return next;
}
function countCategory(db,userId,category){
  return db.prepare([
    "SELECT COUNT(*) AS n FROM legacy_inventory_items",
    "WHERE user_id=? AND category=? AND durability>0"
  ].join(" ")).get(userId,category).n;
}
function addItem(db,userId,line,origin,fields,now){
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,origin,line,fields[0],fields[1],fields[9],
    Number(fields[21]),fields[22],Number(fields[30]),0,JSON.stringify(fields));
}
function updateItem(db,row,fields,purchasedAt=row.purchased_at){
  db.prepare([
    "UPDATE legacy_inventory_items SET category=?,effect=?,durability=?,",
    "purchased_at=?,raw_fields_json=? WHERE user_id=? AND source_line=?"
  ].join(" ")).run(fields[0],fields[9],Number(fields[21]),purchasedAt,
    JSON.stringify(fields),row.user_id,row.source_line);
  // 道具已使用多少次由 Web 表保存；拆分／轉贈之後更新剩餘數。
  if(row.durability_unit==="回"){
    db.prepare("UPDATE legacy_item_usage SET remaining=? WHERE user_id=? AND source_line=?")
      .run(Number(fields[21]),row.user_id,row.source_line);
  }
}
function transact(db,userId,requestId,now,action,sourceLine,quantity,toUserId,work,message=""){
  requireArgs(userId,requestId,now);
  if(!Number.isSafeInteger(sourceLine)||sourceLine<=0||
     !Number.isSafeInteger(quantity)||quantity<0||quantity>1000000)
    throw new Error("禮品來源及數量必須為安全整數");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT action,source_line,quantity,recipient_user_id,result_source_line,fee,name,message",
      "FROM gift_events WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.action!==action||previous.source_line!==sourceLine||
         previous.quantity!==quantity||
         (previous.recipient_user_id??null)!==(toUserId??null)||
         previous.message!==message)
        throw new Error("禮品請求編號已用於其他商品、數量、收件人或訊息");
      db.exec("COMMIT");
      return {action,sourceLine,quantity,name:previous.name,
        recipientUserId:previous.recipient_user_id??null,
        giftSourceLine:previous.result_source_line,fee:previous.fee,replayed:true};
    }
    const result=work();
    db.prepare([
      "INSERT INTO gift_events(user_id,request_id,action,source_line,quantity,",
      "recipient_user_id,result_source_line,fee,name,created_at,message)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,action,sourceLine,quantity,toUserId??null,
      result.giftSourceLine,result.fee,result.name,now,message);
    if(action==="send"){
      const event=db.prepare("SELECT last_insert_rowid() AS id").get().id;
      // 建立寄件及收件資料與道具移轉共用同一個 BEGIN IMMEDIATE。
      recordGiftMail(db,Number(event),
        db.prepare("SELECT user_id,name FROM characters WHERE user_id=?").get(userId),
        db.prepare("SELECT user_id,name FROM characters WHERE user_id=?").get(toUserId),
        result.name,quantity,message,now);
    }
    db.exec("COMMIT");
    return {action,sourceLine,quantity,...result,recipientUserId:toUserId??null,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
function effectForGift(effect,category){
  let e=effect;
  if(category==="食料品"&&!e.includes("食料品"))e+=",食料品";
  if(category==="ファーストフード"&&!e.includes("ファ"))e+=",ファ";
  return e.replace(/,ギフト/g,"").replace(/ギフト/g,"").replace(/無,/g,"")||"無";
}
export function convertToGift(db,userId,{
  sourceLine,quantity=0,requestId,now,hasBuilding
}={}){
  if(typeof hasBuilding!=="function")throw new Error("缺少禮品店建築驗證");
  return transact(db,userId,requestId,now,"convert",sourceLine,quantity,null,()=>{
    const character=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!hasBuilding(GIFT_SHOP_SYMBOL,character.town_id))
      throw new Error("角色目前城鎮沒有禮品店");
    if(character.money<GIFT_CONVERSION_FEE)
      throw new Error("禮品轉換手續費 50,000 元，現金不足");
    if(countCategory(db,userId,"ギフト")>=GIFT_PURCHASED_LIMIT)
      throw new Error("本人禮品已達 10 格上限");
    const row=sourceRow(db,userId,sourceLine);
    const original=rawFields(row);
    if(["ギフト","ギフト商品"].includes(row.category)&&row.category==="ギフト")
      throw new Error("物品已是未寄送禮品，不可重複轉換");
    if(row.original_name==="クーポン")
      throw new Error("優惠券移轉需另外核對原版券帳簿，目前不支援轉換");
    const remaining=rest(row,now);
    if(remaining<=0)throw new Error("物品已過期或耐久不足");
    const moved=quantity===0?remaining:quantity;
    if(moved>remaining||moved<=0)throw new Error("轉換數量超過物品目前剩餘耐久");
    const nowSeconds=Math.floor(now/1000);
    const cleanEffect=effectForGift(row.effect,row.category);
    let giftSourceLine;
    if(moved===remaining){
      original[0]="ギフト";original[9]=cleanEffect;
      original[21]=String(moved);
      if(row.durability_unit==="日")original[30]=String(nowSeconds);
      updateItem(db,row,original,row.durability_unit==="日"?nowSeconds:row.purchased_at);
      giftSourceLine=sourceLine;
    }else{
      const left=[...original];left[21]=String(remaining-moved);
      if(row.durability_unit==="日")left[30]=String(nowSeconds);
      updateItem(db,row,left,row.durability_unit==="日"?nowSeconds:row.purchased_at);
      giftSourceLine=nextLine(db,userId);
      const gifted=[...original];
      gifted[0]="ギフト";gifted[9]=cleanEffect;gifted[21]=String(moved);
      if(row.durability_unit==="日")gifted[30]=String(nowSeconds);
      addItem(db,userId,giftSourceLine,"__web_gift__",gifted,now);
    }
    if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(GIFT_CONVERSION_FEE,userId,GIFT_CONVERSION_FEE).changes!==1)
      throw new Error("現金不足，禮品轉換未完成");
    return {giftSourceLine,name:row.original_name,moved,fee:GIFT_CONVERSION_FEE};
  });
}
export function sendGift(db,userId,{
  sourceLine,quantity,recipientName,message,requestId,now
}={}){
  const mailBody=giftMessage(message);
  if(typeof recipientName!=="string"||!recipientName.trim()||
     recipientName.length>40)
    throw new Error("請提供有效收件人角色名稱");
  const recipient=db.prepare("SELECT user_id,name FROM characters WHERE name=?").get(recipientName);
  if(!recipient)throw new Error("找不到指定的收件角色");
  if(recipient.user_id===userId)throw new Error("不能將禮品寄給自己");
  if(!Number.isSafeInteger(quantity)||quantity<=0)throw new Error("寄送份數必須大於 0");
  return transact(db,userId,requestId,now,"send",sourceLine,quantity,recipient.user_id,()=>{
    const sender=db.prepare("SELECT name FROM characters WHERE user_id=?").get(userId);
    if(!sender)throw new Error("請先建立角色");
    const row=sourceRow(db,userId,sourceLine);
    const original=rawFields(row);
    if(row.category!=="ギフト")throw new Error("只有已轉換或購入的「ギフト」可以寄送");
    if(row.original_name==="クーポン")
      throw new Error("優惠券原版特例尚未移植，不能透過一般禮品寄送");
    const remaining=rest(row,now);
    if(quantity>remaining)throw new Error("送出數量超過禮品剩餘耐久");
    if(countCategory(db,recipient.user_id,"ギフト商品")>=GIFT_RECEIVED_LIMIT)
      throw new Error("收件人的已收禮品達到 10 格上限");
    const nowSeconds=Math.floor(now/1000);
    const received=[...original];
    received[0]="ギフト商品";
    received[9]=effectForGift(row.effect,row.category);
    received[21]=String(quantity);
    received[30]=String(nowSeconds);
    received[31]="0";
    const oldComment=String(received[29]??"").split("\t")[0];
    received[29]=oldComment+"\t"+sender.name+"さんからの贈り物です。";
    const giftSourceLine=nextLine(db,recipient.user_id);
    if(quantity===remaining){
      db.prepare("DELETE FROM legacy_inventory_items WHERE user_id=? AND source_line=?")
        .run(userId,sourceLine);
    }else{
      const retained=[...original];
      retained[21]=String(remaining-quantity);
      if(row.durability_unit==="日")retained[30]=String(nowSeconds);
      updateItem(db,row,retained,row.durability_unit==="日"?nowSeconds:row.purchased_at);
    }
    addItem(db,recipient.user_id,giftSourceLine,"__web_gift__",received,now);
    return {giftSourceLine,name:row.original_name,fee:0,recipientName:recipient.name};
  },mailBody);
}
export function listGiftMail(db,userId,limit=GIFT_MAIL_LIMIT){
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的收件角色帳號");
  const count=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,GIFT_MAIL_LIMIT)):GIFT_MAIL_LIMIT;
  return db.prepare([
    "SELECT direction,other_name,message,gift_name,quantity,created_at",
    "FROM gift_mail_messages WHERE user_id=?",
    "ORDER BY created_at DESC,id DESC LIMIT ?"
  ].join(" ")).all(userId,count).map(row=>({
    direction:row.direction,otherName:row.other_name,
    message:row.message,giftName:row.gift_name,
    quantity:row.quantity,createdAt:row.created_at
  }));
}
export function listGiftSources(db,userId,now){
  const rows=db.prepare([
    "SELECT i.*,u.remaining AS used_remaining FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? ORDER BY i.source_line LIMIT 2100"
  ].join(" ")).all(userId);
  return rows.filter(x=>EDITABLE.has(x.original_id)&&rest(x,now)>0)
    .flatMap(row=>{
      try{rawFields(row);}catch{return [];}
      return [{sourceLine:row.source_line,name:row.original_name,
        category:row.category,quantity:rest(row,now),unit:row.durability_unit,
        canConvert:row.category!=="ギフト"&&row.original_name!=="クーポン",
        canSend:row.category==="ギフト"&&row.original_name!=="クーポン"}];
    });
}
export function listGiftEvents(db,userId,limit=30){
  return db.prepare([
    "SELECT e.action,e.name,e.source_line,e.quantity,e.fee,e.result_source_line,",
    "e.created_at,c.name AS recipient_name FROM gift_events e",
    "LEFT JOIN characters c ON c.user_id=e.recipient_user_id",
    "WHERE e.user_id=? ORDER BY e.id DESC LIMIT ?"
  ].join(" ")).all(userId,Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:30,50)))
    .map(r=>({action:r.action,name:r.name,sourceLine:r.source_line,
      quantity:r.quantity,fee:r.fee,giftSourceLine:r.result_source_line,
      recipientName:r.recipient_name??null,createdAt:r.created_at}));
}
