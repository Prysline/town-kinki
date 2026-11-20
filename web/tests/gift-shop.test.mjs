import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {parseLegacyRetailCatalog} from "../src/retail.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {
  initGiftTables,GIFT_CONVERSION_FEE,GIFT_SHOP_SYMBOL,
  convertToGift,sendGift,listGiftSources,listGiftEvents
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
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
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
