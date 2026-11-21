import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyRetailCatalog} from "../src/retail.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {
  initGiftTables,GIFT_CONVERSION_FEE,GIFT_SHOP_SYMBOL,
  convertToGift,sendGift,listGiftSources,listGiftEvents,listGiftMail,GIFT_MAIL_LIMIT
} from "../src/gift-shop.mjs";

const original=decodeLegacyText(readFileSync(new URL("../../gifutoya.cgi",import.meta.url)));
const mail=decodeLegacyText(readFileSync(new URL("../../command.pl",import.meta.url)));
const catalog=parseLegacyRetailCatalog(decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))));
const sample=catalog.find(x=>x.name==="油取り紙"&&x.durabilityUnit==="回");
const now=Date.parse("2026-11-20T12:00:00Z");
const opt=(requestId,extra={})=>({requestId,now,hasBuilding:()=>true,...extra});
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "name TEXT NOT NULL UNIQUE,town_id INTEGER NOT NULL,money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2),(3);",
    "INSERT INTO characters(user_id,name,town_id,money) VALUES",
    "(1,'寄件人',0,250000),(2,'收件人',0,250000),(3,'第三人',0,250000);"
  ].join(" "));
  initLegacyItemUseTables(db);
  initGiftTables(db);
  return db;
}
function seed(db,{userId=1,sourceLine=1000001,name=sample.name,
  origin="__web_retail__",category=sample.category,effect=sample.effect,
  durability=sample.durability,unit="回",purchasedAt=Math.floor(now/1000)}={}){
  const fields=[...sample.rawFields];
  fields[0]=category;fields[1]=name;fields[9]=effect;
  fields[21]=String(durability);fields[22]=unit;
  fields[30]=String(purchasedAt);
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,origin,sourceLine,category,name,effect,durability,
    unit,purchasedAt,0,JSON.stringify(fields));
  return sourceLine;
}
function owned(db,userId=1,sourceLine=1000001){
  return db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=? AND source_line=?")
    .get(userId,sourceLine);
}
test("原版禮品店收 50,000 元轉換費、部分耐久分割、收件 10 格與站內轉贈的程式來源",()=>{
  assert.equal(sample.name,"油取り紙");
  assert.equal(GIFT_SHOP_SYMBOL,"ギフト屋");
  assert.equal(GIFT_CONVERSION_FEE,50000);
  assert.match(original,/\$koukan_money = 50000/);
  assert.match(original,/sub gifutoya_do \{/);
  assert.match(original,/\$syo_syubetu = "ギフト"/);
  assert.match(mail,/sub gift_souhu_syori \{/);
  assert.match(mail,/\$syo_syubetu = "ギフト商品"/);
});
test("禮品店全數轉換一次扣現金，保存 Web 原版 33 欄，重送不重複收費",()=>{
  const db=fixture();try{
    seed(db);
    const first=convertToGift(db,1,{sourceLine:1000001,quantity:0,...opt("gift_full_convert")});
    assert.equal(first.fee,50000);
    assert.equal(first.moved,5);
    assert.equal(first.giftSourceLine,1000001);
    assert.equal(owned(db).category,"ギフト");
    assert.equal(JSON.parse(owned(db).raw_fields_json)[0],"ギフト");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,200000);
    assert.equal(listGiftSources(db,1,now)[0].canSend,true);
    const again=convertToGift(db,1,{sourceLine:1000001,quantity:0,...opt("gift_full_convert")});
    assert.equal(again.replayed,true);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,200000);
    assert.throws(()=>convertToGift(db,1,{
      sourceLine:1000001,...opt("gift_double_convert")
    }),/已是/);
    assert.equal(listGiftEvents(db,1).length,1);
  }finally{db.close();}
});
test("部分剩餘耐久轉成禮品，使用歷史留在原始物品，收到禮品不會帶走已消耗耐久",()=>{
  const db=fixture();try{
    seed(db,{durability:5});
    db.prepare([
      "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
      "VALUES(1,1000001,4,?)"
    ].join(" ")).run(now-100000);
    const gift=convertToGift(db,1,{sourceLine:1000001,quantity:2,...opt("gift_partial_convert")});
    assert.ok(gift.giftSourceLine>=3000000);
    assert.equal(owned(db).durability,2);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1").get().remaining,2);
    assert.equal(owned(db,1,gift.giftSourceLine).durability,2);
    assert.equal(owned(db,1,gift.giftSourceLine).category,"ギフト");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=1").get().n,2);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,200000);
  }finally{db.close();}
});
test("已轉換禮品能跨玩家送出，收件人的原版「ギフト商品」與附註及單價為零",()=>{
  const db=fixture();try{
    seed(db);
    const gift=convertToGift(db,1,{
      sourceLine:1000001,quantity:3,...opt("gift_split_for_transfer")
    });
    const sent=sendGift(db,1,{
      sourceLine:gift.giftSourceLine,quantity:2,recipientName:"收件人",
      requestId:"gift_send_some",now
    });
    assert.equal(sent.fee,0);
    assert.equal(sent.recipientUserId,2);
    assert.equal(owned(db,1,gift.giftSourceLine).durability,1);
    const receiver=owned(db,2,sent.giftSourceLine);
    assert.equal(receiver.category,"ギフト商品");
    assert.equal(receiver.durability,2);
    assert.equal(receiver.original_id,"__web_gift__");
    const fields=JSON.parse(receiver.raw_fields_json);
    assert.equal(fields[31],"0");
    assert.equal(fields[0],"ギフト商品");
    assert.match(fields[29],/寄件人さんからの贈り物/);
    assert.equal(listGiftSources(db,2,now)[0].canConvert,true);
    assert.equal(sendGift(db,1,{
      sourceLine:gift.giftSourceLine,quantity:2,recipientName:"收件人",
      requestId:"gift_send_some",now
    }).replayed,true);
    assert.throws(()=>sendGift(db,1,{
      sourceLine:gift.giftSourceLine,quantity:1,recipientName:"收件人",
      requestId:"gift_send_some",now
    }),/請求編號/);
    const second=sendGift(db,1,{
      sourceLine:gift.giftSourceLine,quantity:1,recipientName:"收件人",
      requestId:"gift_send_last",now
    });
    assert.ok(second.giftSourceLine!==sent.giftSourceLine);
    assert.equal(owned(db,1,gift.giftSourceLine),undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=2").get().n,2);
  }finally{db.close();}
});
test("收件人已滿 10 個「ギフト商品」時寄送失敗，寄件人耐久完全保留",()=>{
  const db=fixture();try{
    seed(db);
    convertToGift(db,1,{sourceLine:1000001,quantity:0,...opt("gift_10_convert")});
    for(let i=0;i<10;i++)
      seed(db,{userId:2,sourceLine:200+i,origin:"__web_gift__",
        category:"ギフト商品",name:"已收禮品-"+i,durability:1});
    assert.throws(()=>sendGift(db,1,{
      sourceLine:1000001,quantity:1,recipientName:"收件人",
      requestId:"gift_receiver_is_full",now
    }),/10 格/);
    assert.equal(owned(db).durability,5);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=2").get().n,10);
    assert.equal(listGiftEvents(db,1).length,1);
  }finally{db.close();}
});
test("禮品轉換限 10 格、不足費用與非本人原版匯入檔均拒絕且不得變更持有物",()=>{
  const db=fixture();try{
    seed(db,{sourceLine:80,origin:"old_player"});
    assert.throws(()=>convertToGift(db,1,{sourceLine:80,...opt("gift_legacy_forbidden")}),/唯讀/);
    seed(db,{sourceLine:1000001});
    assert.throws(()=>convertToGift(db,2,{sourceLine:1000001,...opt("gift_other_user")}),/唯讀/);
    assert.throws(()=>convertToGift(db,1,{sourceLine:1000001,...opt("gift_missing_shop",{hasBuilding:()=>false})}),/沒有禮品店/);
    db.prepare("UPDATE characters SET money=49999 WHERE user_id=1").run();
    assert.throws(()=>convertToGift(db,1,{sourceLine:1000001,...opt("gift_insufficient_fee")}),/現金不足/);
    db.prepare("UPDATE characters SET money=250000 WHERE user_id=1").run();
    for(let i=0;i<10;i++)seed(db,{sourceLine:500+i,origin:"__web_gift__",name:"禮品-"+i,
      category:"ギフト",durability:1});
    assert.throws(()=>convertToGift(db,1,{
      sourceLine:1000001,...opt("gift_own_gift_limit")
    }),/10 格/);
    assert.equal(owned(db).category,sample.category);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,250000);
  }finally{db.close();}
});
test("禁止送給自己、傳不存在的玩家、負份數、優惠券及不存在的禮品",()=>{
  const db=fixture();try{
    seed(db);
    const a=opt("gift_other",{});void a;
    for(const [recipientName,quantity,pattern] of [
      ["寄件人",1,/自己/],["不存在的角色",1,/找不到/],
      ["收件人",0,/大於 0/],["收件人",-1,/大於 0/]
    ])assert.throws(()=>sendGift(db,1,{
      sourceLine:1000001,quantity,recipientName,requestId:"gift_bad_"+String(quantity)+recipientName,now
    }),pattern);
    assert.equal(owned(db).category,sample.category);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_events").get().n,0);
    seed(db,{sourceLine:3000001,name:"クーポン",category:"ギフト",
      origin:"__web_gift__",durability:3});
    assert.throws(()=>sendGift(db,1,{
      sourceLine:3000001,quantity:1,recipientName:"收件人",
      requestId:"gift_coupon_forbidden",now
    }),/優惠券/);
  }finally{db.close();}
});
test("日制道具過期不得轉換，剩餘日數轉禮品時重算起始日",()=>{
  const db=fixture();try{
    seed(db,{unit:"日",durability:30,purchasedAt:Math.floor((now-10*86400000)/1000)});
    const changed=convertToGift(db,1,{
      sourceLine:1000001,quantity:4,...opt("gift_expiry_partial")
    });
    assert.equal(owned(db).durability,16);
    assert.equal(owned(db).purchased_at,Math.floor(now/1000));
    assert.equal(owned(db,1,changed.giftSourceLine).durability,4);
    assert.equal(owned(db,1,changed.giftSourceLine).purchased_at,Math.floor(now/1000));
    seed(db,{sourceLine:3000100,unit:"日",durability:1,
      purchasedAt:Math.floor((now-3*86400000)/1000)});
    assert.throws(()=>convertToGift(db,1,{
      sourceLine:3000100,...opt("gift_expired_item")
    }),/過期/);
  }finally{db.close();}
});


test("原版 mail_do 的禮品寄件同時產生受信與送信，Web 全部在原子交易內保存",()=>{
  assert.match(mail,/sub mail_do \{/);
  assert.match(mail,/\$in\{'m_com'\} eq ""/);
  assert.match(mail,/\$in\{'gift_souhu'\}/);
  assert.match(mail,/\$new_mail = "受信<>/);
  assert.match(mail,/\$sousin_mail = "送信<>/);
  const town=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
  assert.match(town,/\$mail_hozon_gandosuu = '50'/);
  assert.equal(GIFT_MAIL_LIMIT,50);
  const db=fixture();
  try{
    seed(db,{category:"ギフト",durability:3});
    const sent=sendGift(db,1,{
      sourceLine:1000001,quantity:2,recipientName:"收件人",
      message:"這份禮物請收下！",requestId:"mail_confirm_001",now
    });
    assert.equal(sent.replayed,false);
    const out=listGiftMail(db,1);
    const inbox=listGiftMail(db,2);
    assert.equal(out.length,1);
    assert.equal(inbox.length,1);
    assert.deepEqual(out[0],{
      direction:"sent",otherName:"收件人",message:"這份禮物請收下！",
      giftName:sample.name,quantity:2,createdAt:now
    });
    assert.deepEqual(inbox[0],{
      direction:"inbox",otherName:"寄件人",message:"這份禮物請收下！",
      giftName:sample.name,quantity:2,createdAt:now
    });
    assert.equal(listGiftMail(db,3).length,0,"第三名玩家不能讀其他人信件");
    assert.equal(owned(db).durability,1);
    assert.equal(owned(db,2,sent.giftSourceLine).durability,2);
    const again=sendGift(db,1,{
      sourceLine:1000001,quantity:2,recipientName:"收件人",
      message:"這份禮物請收下！",requestId:"mail_confirm_001",now:now+1000
    });
    assert.equal(again.replayed,true);
    assert.equal(listGiftMail(db,1).length,1);
    assert.equal(listGiftMail(db,2).length,1);
    assert.throws(()=>sendGift(db,1,{
      sourceLine:1000001,quantity:2,recipientName:"收件人",
      message:"企圖改寫舊信件",requestId:"mail_confirm_001",now
    }),/請求編號/);
    assert.equal(listGiftMail(db,2)[0].message,"這份禮物請收下！");
    assert.equal(owned(db).durability,1);
  }finally{db.close();}
});
test("舊版沒有信件欄的寄禮 API 可以原有預設訊息寄送；明確空白與超長訊息拒絕",()=>{
  const db=fixture();
  try{
    seed(db,{category:"ギフト",durability:5});
    const result=sendGift(db,1,{
      sourceLine:1000001,quantity:1,recipientName:"收件人",
      requestId:"old_gift_mail_01",now
    });
    assert.equal(result.replayed,false);
    assert.equal(listGiftMail(db,2)[0].message,"送給你的禮物");
    assert.equal(sendGift(db,1,{
      sourceLine:1000001,quantity:1,recipientName:"收件人",
      requestId:"old_gift_mail_01",now:now+100
    }).replayed,true);
    for(const [message,id] of [["","mail_blank_message"],["   ","mail_spaces_message"],["X".repeat(1001),"mail_oversized"]]){
      assert.throws(()=>sendGift(db,1,{
        sourceLine:1000001,quantity:1,recipientName:"收件人",message,
        requestId:id,now
      }),/訊息/);
    }
    assert.equal(listGiftMail(db,2).length,1);
    assert.equal(owned(db).durability,4);
  }finally{db.close();}
});
test("若收或寄任一信箱寫入失敗，禮品耐久、跨玩家收件、事件及兩封信一律回滾",()=>{
  const db=fixture();
  try{
    seed(db,{category:"ギフト",durability:4});
    db.exec([
      "CREATE TRIGGER reject_gift_sent_mail BEFORE INSERT ON gift_mail_messages",
      "WHEN NEW.direction='sent' BEGIN",
      "SELECT RAISE(ABORT,'mailwrite blocked'); END;"
    ].join(" "));
    assert.throws(()=>sendGift(db,1,{
      sourceLine:1000001,quantity:2,recipientName:"收件人",
      message:"測試整筆交易回滾",requestId:"giftmail_abort_01",now
    }),/mailwrite blocked/);
    assert.equal(owned(db).durability,4);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=2").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_events").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_mail_messages").get().n,0);
    db.exec("DROP TRIGGER reject_gift_sent_mail");
    const success=sendGift(db,1,{
      sourceLine:1000001,quantity:2,recipientName:"收件人",
      message:"測試整筆交易回滾",requestId:"giftmail_abort_01",now
    });
    assert.equal(success.replayed,false);
    assert.equal(owned(db).durability,2);
    assert.equal(owned(db,2,success.giftSourceLine).durability,2);
    assert.equal(listGiftMail(db,1).length,1);
    assert.equal(listGiftMail(db,2).length,1);
  }finally{db.close();}
});
test("原版收發信合計最多 50 封，每位角色獨立裁切而不影響持有物及交易事件",()=>{
  const db=fixture();
  try{
    for(let i=0;i<51;i++){
      seed(db,{sourceLine:1000200+i,category:"ギフト",durability:1});
      const result=sendGift(db,1,{
        sourceLine:1000200+i,quantity:1,recipientName:"收件人",
        message:"第 "+(i+1)+" 封文字訊息",
        requestId:"mail_limit_"+String(i).padStart(3,"0"),
        now:now+i*1000
      });
      db.prepare("DELETE FROM legacy_inventory_items WHERE user_id=2 AND source_line=?")
        .run(result.giftSourceLine);
    }
    const recipient=listGiftMail(db,2);
    const sender=listGiftMail(db,1);
    assert.equal(recipient.length,50);
    assert.equal(sender.length,50);
    assert.equal(recipient[0].message,"第 51 封文字訊息");
    assert.equal(sender[0].message,"第 51 封文字訊息");
    assert.equal(recipient.at(-1).message,"第 2 封文字訊息");
    assert.equal(sender.at(-1).message,"第 2 封文字訊息");
    assert.equal(listGiftMail(db,2,3).length,3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_events WHERE action='send'").get().n,51);
    assert.equal(listGiftMail(db,3).length,0);
  }finally{db.close();}
});
test("既有 gift_events 無 message 欄的資料庫啟動時可安全升級，不破壞舊寄送識別碼",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec([
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE users(id INTEGER PRIMARY KEY);",
      "CREATE TABLE gift_events(",
      "id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "user_id INTEGER NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,",
      "source_line INTEGER NOT NULL,quantity INTEGER NOT NULL,recipient_user_id INTEGER,",
      "result_source_line INTEGER NOT NULL,fee INTEGER NOT NULL,name TEXT NOT NULL,",
      "created_at INTEGER NOT NULL,UNIQUE(user_id,request_id));",
      "INSERT INTO users(id) VALUES(1);",
      "INSERT INTO gift_events(user_id,request_id,action,source_line,quantity,",
      "result_source_line,fee,name,created_at) VALUES",
      "(1,'old_mail_request', 'send',1,1,2,0,'商品',123);"
    ].join(" "));
    initGiftTables(db);
    initGiftTables(db);
    assert.equal(db.prepare("SELECT message FROM gift_events WHERE user_id=1").get().message,"");
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='gift_mail_messages'").get());
  }finally{db.close();}
});


test("P0：刪除寄件人帳號時，已交付的收件信與對方物品不跟著消失",()=>{
  const db=fixture();
  try{
    seed(db,{category:"ギフト",durability:2});
    const result=sendGift(db,1,{
      sourceLine:1000001,quantity:1,recipientName:"收件人",
      message:"寄件者離開後也必須保存",requestId:"mail_lifetime_sender_01",now
    });
    assert.equal(listGiftMail(db,1).length,1);
    assert.equal(listGiftMail(db,2).length,1);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_events").get().n,0);
    assert.equal(listGiftMail(db,1).length,0,"刪除帳號者的私有寄件備份應被刪除");
    assert.equal(listGiftMail(db,2).length,1,"收件人持有自己的收件紀錄");
    assert.deepEqual(listGiftMail(db,2)[0],{
      direction:"inbox",otherName:"寄件人",message:"寄件者離開後也必須保存",
      giftName:sample.name,quantity:1,createdAt:now
    });
    assert.equal(owned(db,2,result.giftSourceLine).durability,1,
      "對方已收的物品不隨寄件人刪帳失去");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
test("P0：刪除收件人帳號時，寄件人已送出的備份仍歸寄件人所有",()=>{
  const db=fixture();
  try{
    seed(db,{category:"ギフト",durability:2});
    sendGift(db,1,{
      sourceLine:1000001,quantity:1,recipientName:"收件人",
      message:"這是寄件人的私有寄件備份",requestId:"mail_lifetime_reader_01",now
    });
    db.prepare("DELETE FROM users WHERE id=2").run();
    assert.equal(listGiftMail(db,2).length,0);
    assert.equal(listGiftMail(db,1).length,1);
    assert.equal(listGiftMail(db,1)[0].direction,"sent");
    assert.equal(listGiftMail(db,1)[0].otherName,"收件人");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
test("P0：第46階段既有信箱表完整帶資料遷移，保存 ID／時間／雙方文字，重啟冪等",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec([
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE users(id INTEGER PRIMARY KEY);",
      "INSERT INTO users(id) VALUES(1),(2),(3);",
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
      "VALUES(11,1,'old_phase46_id','send',100,2,2,101,0,'舊禮品',999);",
      "INSERT INTO gift_mail_messages(id,user_id,event_id,direction,other_name,",
      "message,gift_name,quantity,created_at) VALUES",
      "(70,1,11,'sent','收件人','原版已寫入的寄件副本','舊禮品',2,999),",
      "(71,2,11,'inbox','寄件人','原版已寫入的收件文字','舊禮品',2,999);"
    ].join(" "));
    assert.equal(db.prepare("PRAGMA foreign_key_list(gift_mail_messages)").all()
      .some(key=>key.table==="gift_events"),true,"重現第46階段有問題的舊資料關聯");
    initGiftTables(db);
    initGiftTables(db);
    const links=db.prepare("PRAGMA foreign_key_list(gift_mail_messages)").all();
    assert.equal(links.some(key=>key.table==="gift_events"),false);
    assert.equal(links.some(key=>key.table==="users"),true);
    assert.deepEqual(db.prepare([
      "SELECT id,user_id,event_id,direction,other_name,message,gift_name,quantity,created_at",
      "FROM gift_mail_messages ORDER BY id"
    ].join(" ")).all(),[
      {id:70,user_id:1,event_id:11,direction:"sent",other_name:"收件人",
        message:"原版已寫入的寄件副本",gift_name:"舊禮品",quantity:2,created_at:999},
      {id:71,user_id:2,event_id:11,direction:"inbox",other_name:"寄件人",
        message:"原版已寫入的收件文字",gift_name:"舊禮品",quantity:2,created_at:999}
    ]);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gift_events").get().n,0);
    assert.equal(listGiftMail(db,2).length,1);
    assert.equal(listGiftMail(db,2)[0].message,"原版已寫入的收件文字");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
