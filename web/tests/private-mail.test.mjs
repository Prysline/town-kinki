import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyRetailCatalog} from "../src/retail.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {initGiftTables,sendGift,listGiftMail} from "../src/gift-shop.mjs";
import {MAIL_LIMIT,initPrivateMailTables,sendPrivateMail,listMailbox,deletePrivateMailboxEntry}
  from "../src/private-mail.mjs";

const now=Date.parse("2026-11-21T09:00:00Z");
const gift=parseLegacyRetailCatalog(decodeLegacyText(
  readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))))
  .find(x=>x.name==="油取り紙"&&x.durabilityUnit==="回");
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "name TEXT UNIQUE NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2),(3);",
    "INSERT INTO characters(user_id,name,town_id,money) VALUES",
    "(1,'寄件角色',0,500000),(2,'收件角色',0,500000),(3,'第三角色',0,500000);"
  ].join(" "));
  initLegacyItemUseTables(db);
  initGiftTables(db);
  initPrivateMailTables(db);
  return db;
}
function seedGift(db,line=1000001,quantity=2){
  assert.ok(gift,"原版商品表須有測試用油取り紙");
  const raw=[...gift.rawFields];
  raw[0]="ギフト";raw[1]=gift.name;raw[9]=gift.effect;
  raw[21]=String(quantity);raw[22]="回";raw[30]=String(Math.floor(now/1000));
  db.prepare([
    "INSERT INTO legacy_inventory_items(",
    "user_id,original_id,source_line,category,original_name,effect,durability,",
    "durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(1,'__web_gift__',?,'ギフト',?,?,?,'回',?,0,?)"
  ].join(" ")).run(line,gift.name,gift.effect,quantity,Math.floor(now/1000),JSON.stringify(raw));
}
function mail(db,requestId,extra={}){
  return sendPrivateMail(db,1,{recipientName:"收件角色",message:"你好，歡迎來到京阪神！",
    requestId,now,...extra});
}

test("原版獨立站內信由 command.pl::mail_do 進行收寄兩側寫入，雙向合計 50 封",()=>{
  const source=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
  assert.match(source,/sub mail_do \{/);
  assert.match(source,/\$in\{'m_com'\} eq ""/);
  assert.match(source,/\$new_mail = "受信<>/);
  assert.match(source,/\$sousin_mail = "送信<>/);
  const ini=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
  assert.match(ini,/\$mail_hozon_gandosuu = '50'/);
  assert.equal(MAIL_LIMIT,50);
});
test("純文字信真正寫入兩個本人信箱，安全讀取、重送冪等、非法輸入拒絕",()=>{
  const db=fixture();
  try{
    assert.equal(mail(db,"mail_plain_00001").replayed,false);
    const out=listMailbox(db,1),inbox=listMailbox(db,2);
    assert.equal(out.length,1);assert.equal(inbox.length,1);
    assert.equal(out[0].type,"plain");assert.equal(out[0].direction,"sent");
    assert.equal(out[0].otherName,"收件角色");
    assert.equal(inbox[0].direction,"inbox");
    assert.equal(inbox[0].otherName,"寄件角色");
    assert.equal(inbox[0].message,"你好，歡迎來到京阪神！");
    assert.equal(listMailbox(db,3).length,0);
    assert.deepEqual(listGiftMail(db,1),[]);
    assert.equal(mail(db,"mail_plain_00001").replayed,true);
    assert.equal(listMailbox(db,2).length,1);
    assert.throws(()=>mail(db,"mail_plain_00001",{message:"悄悄改信"}),/請求編號/);
    assert.throws(()=>mail(db,"mail_plain_00001",{recipientName:"第三角色"}),/請求編號/);
    assert.throws(()=>mail(db,"mail_plain_self",{recipientName:"寄件角色"}),/自己/);
    assert.throws(()=>mail(db,"mail_plain_none",{recipientName:"不存在"}),/找不到/);
    assert.throws(()=>mail(db,"mail_plain_empty",{message:"  "}),/1～1,000/);
    assert.throws(()=>mail(db,"mail_plain_long",{message:"字".repeat(1001)}),/1～1,000/);
    assert.throws(()=>mail(db,"bad"),/格式/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_mail_events").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_mail_messages").get().n,2);
  }finally{db.close();}
});
test("收件或寄件信任一寫入失敗，請求識別與雙方郵件必須整筆回滾",()=>{
  const db=fixture();
  try{
    db.exec([
      "CREATE TRIGGER reject_plain_mail BEFORE INSERT ON gift_mail_messages",
      "WHEN NEW.private_event_id IS NOT NULL AND NEW.direction='sent' BEGIN",
      "SELECT RAISE(ABORT,'mailwrite blocked'); END;"
    ].join(" "));
    assert.throws(()=>mail(db,"mail_plain_abort"),/mailwrite blocked/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_mail_events").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_mail_messages").get().n,0);
    db.exec("DROP TRIGGER reject_plain_mail");
    assert.equal(mail(db,"mail_plain_abort").replayed,false);
    assert.equal(listMailbox(db,1).length,1);
    assert.equal(listMailbox(db,2).length,1);
  }finally{db.close();}
});
test("真正共用 50 封：寄禮信被純文字擠出，再寄禮信會擠出最舊純文字",()=>{
  const db=fixture();
  try{
    seedGift(db,1000001,2);
    sendGift(db,1,{sourceLine:1000001,quantity:1,recipientName:"收件角色",
      message:"第一封是禮品",requestId:"mail_first_gift_01",now});
    assert.equal(listMailbox(db,2)[0].type,"gift");
    for(let i=0;i<50;i++){
      mail(db,"mail_plain_limit_"+String(i).padStart(3,"0"),{
        message:"第 "+(i+1)+" 封純文字",now:now+(i+1)*1000
      });
    }
    assert.equal(listMailbox(db,1).length,50);
    assert.equal(listMailbox(db,2).length,50);
    assert.equal(listGiftMail(db,1).length,0);
    assert.equal(listMailbox(db,2)[0].message,"第 50 封純文字");
    assert.equal(listMailbox(db,2).at(-1).message,"第 1 封純文字");
    assert.equal(listMailbox(db,2,3).length,3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_mail_events").get().n,50);
    seedGift(db,1000002,2);
    sendGift(db,1,{sourceLine:1000002,quantity:1,recipientName:"收件角色",
      message:"新的禮品訊息",requestId:"mail_next_gift_01",now:now+51000});
    assert.equal(listMailbox(db,1).length,50);
    assert.equal(listMailbox(db,2).length,50);
    assert.equal(listGiftMail(db,1).length,1);
    assert.equal(listMailbox(db,2)[0].type,"gift");
    assert.equal(listMailbox(db,2).at(-1).message,"第 2 封純文字");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM private_mail_events").get().n,50,
      "裁掉舊信不能刪去防重送事件");
  }finally{db.close();}
});
test("本人刪信不影響對方副本，不可刪其他人信件；寄件者刪帳後收件信仍存在",()=>{
  const db=fixture();
  try{
    mail(db,"mail_own_delete_01");
    const one=listMailbox(db,1)[0],two=listMailbox(db,2)[0];
    assert.throws(()=>deletePrivateMailboxEntry(db,3,two.id),/本人/);
    assert.throws(()=>deletePrivateMailboxEntry(db,1,two.id),/本人/);
    assert.equal(deletePrivateMailboxEntry(db,1,one.id).deleted,true);
    assert.equal(listMailbox(db,1).length,0);
    assert.equal(listMailbox(db,2).length,1);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(listMailbox(db,2).length,1);
    assert.equal(listMailbox(db,2)[0].otherName,"寄件角色");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
test("既有第46階段信件外鍵先升級第47階段，再無損轉為共用信箱，可重啟、可寄純文字",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec([
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE users(id INTEGER PRIMARY KEY);",
      "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
      "name TEXT UNIQUE NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL);",
      "INSERT INTO users(id) VALUES(1),(2);",
      "INSERT INTO characters(user_id,name,town_id,money) VALUES",
      "(1,'寄件角色',0,100000),(2,'收件角色',0,100000);",
      "CREATE TABLE gift_events(",
      "id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
      "request_id TEXT NOT NULL,action TEXT NOT NULL,source_line INTEGER NOT NULL,",
      "quantity INTEGER NOT NULL,recipient_user_id INTEGER,",
      "result_source_line INTEGER NOT NULL,fee INTEGER NOT NULL,",
      "name TEXT NOT NULL,created_at INTEGER NOT NULL,",
      "UNIQUE(user_id,request_id));",
      "CREATE TABLE gift_mail_messages(",
      "id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
      "event_id INTEGER NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,",
      "direction TEXT NOT NULL CHECK(direction IN ('inbox','sent')),",
      "other_name TEXT NOT NULL,message TEXT NOT NULL,",
      "gift_name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),",
      "created_at INTEGER NOT NULL,UNIQUE(event_id,direction));",
      "INSERT INTO gift_events(id,user_id,request_id,action,source_line,quantity,",
      "recipient_user_id,result_source_line,fee,name,created_at)",
      "VALUES(13,1,'original_mail_01','send',101,2,2,102,0,'贈物',999);",
      "INSERT INTO gift_mail_messages(id,user_id,event_id,direction,other_name,",
      "message,gift_name,quantity,created_at) VALUES",
      "(27,1,13,'sent','收件角色','舊寄信','贈物',2,999),",
      "(28,2,13,'inbox','寄件角色','舊收信','贈物',2,999);"
    ].join(" "));
    initGiftTables(db); // 第47階段舊 gift_events 級聯遷移
    initPrivateMailTables(db);
    initGiftTables(db);initPrivateMailTables(db); // 重啟不可重複遷移
    const rows=db.prepare([
      "SELECT id,user_id,event_id,private_event_id,direction,other_name,",
      "message,gift_name,quantity,created_at FROM gift_mail_messages ORDER BY id"
    ].join(" ")).all().map(row=>({...row}));
    assert.deepEqual(rows,[
      {id:27,user_id:1,event_id:13,private_event_id:null,direction:"sent",
        other_name:"收件角色",message:"舊寄信",gift_name:"贈物",quantity:2,created_at:999},
      {id:28,user_id:2,event_id:13,private_event_id:null,direction:"inbox",
        other_name:"寄件角色",message:"舊收信",gift_name:"贈物",quantity:2,created_at:999}
    ]);
    assert.equal(listMailbox(db,2)[0].type,"gift");
    assert.equal(mail(db,"mail_migrate_plain",{now}).replayed,false);
    assert.equal(listMailbox(db,1).length,2);
    assert.equal(listMailbox(db,2).length,2);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(listMailbox(db,2).length,2);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
