// command.pl::mail_do：獨立純文字站內信，與寄禮信件共用每個角色 50 封的信箱。
// 原版收寄件各寫本人 mail.cgi；Web 在同一交易內插入兩筆，避免遺漏任一方。
// 第47階段 gift_mail_messages 原本只允許寄禮；以無損 v3 換表支援無禮文字。
export const MAIL_LIMIT=50;
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;

export function initPrivateMailTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS private_mail_events(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,recipient_user_id INTEGER NOT NULL,",
    "recipient_name TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS private_mail_events_user_idx",
    "ON private_mail_events(user_id,id);"
  ].join(" "));
  const columns=db.prepare("PRAGMA table_info(gift_mail_messages)").all();
  if(columns.some(c=>c.name==="private_event_id"))return;
  if(!columns.some(c=>c.name==="event_id"))
    throw new Error("缺少第46階段郵件資料表，不能安全升級");
  db.exec("BEGIN IMMEDIATE");
  try{
    db.exec([
      "CREATE TABLE gift_mail_messages_v3(",
      "id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
      "event_id INTEGER,private_event_id INTEGER,",
      "direction TEXT NOT NULL CHECK(direction IN ('inbox','sent')),",
      "other_name TEXT NOT NULL,message TEXT NOT NULL,",
      "gift_name TEXT,quantity INTEGER CHECK(quantity IS NULL OR quantity>0),",
      "created_at INTEGER NOT NULL,",
      "UNIQUE(event_id,direction),UNIQUE(private_event_id,direction),",
      "CHECK((event_id IS NOT NULL AND private_event_id IS NULL AND",
      "gift_name IS NOT NULL AND quantity IS NOT NULL) OR",
      "(event_id IS NULL AND private_event_id IS NOT NULL AND",
      "gift_name IS NULL AND quantity IS NULL)));",
      "INSERT INTO gift_mail_messages_v3(",
      "id,user_id,event_id,direction,other_name,message,gift_name,quantity,created_at)",
      "SELECT id,user_id,event_id,direction,other_name,message,gift_name,quantity,created_at",
      "FROM gift_mail_messages;",
      "DROP TABLE gift_mail_messages;",
      "ALTER TABLE gift_mail_messages_v3 RENAME TO gift_mail_messages;",
      "CREATE INDEX gift_mail_user_idx",
      "ON gift_mail_messages(user_id,created_at DESC,id DESC);"
    ].join(" "));
    db.exec("COMMIT");
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}

export function sendPrivateMail(db,userId,{recipientName,message,requestId,now}={}){
  if(!Number.isSafeInteger(userId)||userId<=0||
     typeof requestId!=="string"||!REQUEST.test(requestId)||
     !Number.isSafeInteger(now)||now<=0)
    throw new Error("郵件操作格式不正確");
  if(typeof recipientName!=="string"||!recipientName.trim()||
     recipientName.length>40)
    throw new Error("請提供有效收件人角色名稱");
  if(typeof message!=="string"||!message.trim()||message.length>1000)
    throw new Error("站內信必須填寫 1～1,000 字的文字");
  const name=recipientName.trim(),body=message.trim();
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT recipient_user_id,recipient_name,message",
      "FROM private_mail_events WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.recipient_name!==name||previous.message!==body)
        throw new Error("郵件請求編號已用於其他收件人或訊息");
      db.exec("COMMIT");
      return {recipientName:name,replayed:true};
    }
    const sender=db.prepare("SELECT user_id,name FROM characters WHERE user_id=?")
      .get(userId);
    if(!sender)throw new Error("請先建立角色");
    const recipient=db.prepare("SELECT user_id,name FROM characters WHERE name=?")
      .get(name);
    if(!recipient)throw new Error("找不到指定的收件角色");
    if(recipient.user_id===userId)throw new Error("不能寄站內信給自己");
    const created=db.prepare([
      "INSERT INTO private_mail_events(user_id,request_id,recipient_user_id,",
      "recipient_name,message,created_at) VALUES(?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,recipient.user_id,recipient.name,body,now);
    const insert=db.prepare([
      "INSERT INTO gift_mail_messages(user_id,event_id,private_event_id,",
      "direction,other_name,message,gift_name,quantity,created_at)",
      "VALUES(?,NULL,?,?,?,?,NULL,NULL,?)"
    ].join(" "));
    const eventId=Number(created.lastInsertRowid);
    insert.run(recipient.user_id,eventId,"inbox",sender.name,body,now);
    insert.run(sender.user_id,eventId,"sent",recipient.name,body,now);
    // 同一 gift_mail_messages 的主鍵跨寄禮與純文字訊息排序，總量 50 而非各 50。
    const prune=db.prepare([
      "DELETE FROM gift_mail_messages WHERE user_id=? AND id NOT IN (",
      "SELECT id FROM gift_mail_messages WHERE user_id=?",
      "ORDER BY created_at DESC,id DESC LIMIT ?)"
    ].join(" "));
    for(const id of [sender.user_id,recipient.user_id])
      prune.run(id,id,MAIL_LIMIT);
    db.exec("COMMIT");
    return {recipientName:recipient.name,replayed:false};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listMailbox(db,userId,limit=MAIL_LIMIT){
  if(!Number.isSafeInteger(userId)||userId<=0)
    throw new Error("無效的收件角色帳號");
  const count=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,MAIL_LIMIT)):MAIL_LIMIT;
  return db.prepare([
    "SELECT id,event_id,direction,other_name,message,gift_name,quantity,created_at",
    "FROM gift_mail_messages WHERE user_id=?",
    "ORDER BY created_at DESC,id DESC LIMIT ?"
  ].join(" ")).all(userId,count).map(row=>({
    id:row.id,type:row.event_id===null?"plain":"gift",
    direction:row.direction,otherName:row.other_name,message:row.message,
    giftName:row.gift_name,quantity:row.quantity,createdAt:row.created_at
  }));
}

export function deletePrivateMailboxEntry(db,userId,mailId){
  if(!Number.isSafeInteger(userId)||userId<=0||
     !Number.isSafeInteger(mailId)||mailId<=0)
    throw new Error("信件識別碼不正確");
  const result=db.prepare("DELETE FROM gift_mail_messages WHERE id=? AND user_id=?")
    .run(mailId,userId);
  if(result.changes!==1)throw new Error("找不到本人的指定信件");
  return {deleted:true,id:mailId};
}
