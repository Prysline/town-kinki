import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveNonItemEvent } from "../src/event-effects.mjs";
import {
  initCharacterEvents, settleDailyIllnessEvent, listCharacterEvents, getCouponBalance
} from "../src/events.mjs";

function numbers(...values) {
  let index=0;
  return ()=> {
    if(index>=values.length)throw new Error("額外抽選超出預期");
    return values[index++];
  };
}
const event30=(30-0.5)/44;
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '');",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id) VALUES(1),(2);"
  ].join("\n"));
  initCharacterEvents(db);
  return db;
}
function initial(db,id){
  return settleDailyIllnessEvent(db,id,"2026-11-18",1000,
    ()=>{throw new Error("首次啟用不應抽選");});
}
function earn(db,id,day,choice){
  return settleDailyIllnessEvent(db,id,day,2000,numbers(0,event30,choice));
}

test("第 30 號來源：原版抽 1 至 5 張，coupon_get 對原有優惠券耐久累加",()=>{
  const perl=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
  assert.match(perl,/if \(\$event_rand == 30\)\s*\{\s*\$my_rand = int\(rand\(5\)\)\+1;\s*&coupon_get\(\$my_rand\);/);
  assert.match(perl,/sub coupon_get\{[\s\S]*?\$syo_taikyuu \+= \$coupointo;/);
});

test("第 30 號五個等機率亂數結果皆為正整數，且不憑空改變角色資產",()=>{
  for(let i=0;i<5;i++){
    const result=resolveNonItemEvent(30,{},numbers((i+0.25)/5));
    assert.equal(result.couponAward,i+1);
    assert.deepEqual(result.effects,{coupons:i+1});
    assert.deepEqual(result.changes,{});
    assert.equal(result.event.originalId,30);
    assert.match(result.event.description,new RegExp((i+1)+" 張"));
  }
  assert.throws(()=>resolveNonItemEvent(30,{},numbers(1)),/亂數/);
  assert.equal(resolveNonItemEvent(45,{},numbers(0)),null);
});

test("發券數量保留跨日累加，事件歷史、同日防重與不同玩家隔離",()=>{
  const db=setup();
  try{
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(getCouponBalance(db,2),0);
    assert.equal(initial(db,1).initial,true);
    assert.equal(initial(db,2).initial,true);
    const first=earn(db,1,"2026-11-19",.2);
    assert.equal(first.event.key,"couponGift");
    assert.equal(getCouponBalance(db,1),2);
    assert.equal(getCouponBalance(db,2),0);
    assert.equal(settleDailyIllnessEvent(db,1,"2026-11-19",3000,
      ()=>{throw new Error("重送不應重新抽券");}).checked,false);
    assert.equal(getCouponBalance(db,1),2);
    earn(db,1,"2026-11-20",.999);
    earn(db,2,"2026-11-19",0);
    assert.equal(getCouponBalance(db,1),7);
    assert.equal(getCouponBalance(db,2),1);
    assert.deepEqual(listCharacterEvents(db,1).map(e=>e.effects.coupons),[5,2]);
    assert.deepEqual(listCharacterEvents(db,2).map(e=>e.effects.coupons),[1]);
    assert.equal(listCharacterEvents(db,1)[0].title,"獲得優惠券");
    assert.equal(db.prepare("SELECT health_index FROM characters WHERE user_id=1").get().health_index,50);
    initCharacterEvents(db);
    assert.equal(getCouponBalance(db,1),7);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM character_coupons").get().n,2);
  }finally{db.close();}
});

test("未抽中事件或抽到單機捐款本人時，不會產生優惠券",()=>{
  const db=setup();
  try{
    initial(db,1);
    const none=settleDailyIllnessEvent(db,1,"2026-11-19",2000,numbers(.8));
    const other=settleDailyIllnessEvent(db,1,"2026-11-20",3000,numbers(0,(28-.5)/44,0));
    assert.equal(none.event,null);
    assert.equal(other.event.key,"donation");
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(listCharacterEvents(db,1).length,1);
    assert.equal(listCharacterEvents(db,1)[0].effects.transfer.status,"self");
  }finally{db.close();}
});

test("事件歷史儲存失敗會一併回滾券數與當日抽選標記",()=>{
  const db=setup();
  try{
    initial(db,1);
    db.exec("CREATE TRIGGER reject_coupon_event BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'history blocked'); END;");
    assert.throws(()=>earn(db,1,"2026-11-19",.8),/history blocked/);
    assert.equal(getCouponBalance(db,1),0);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    db.exec("DROP TRIGGER reject_coupon_event");
    assert.equal(earn(db,1,"2026-11-19",.8).event.key,"couponGift");
    assert.equal(getCouponBalance(db,1),5);
  }finally{db.close();}
});

test("優惠券總數溢位、損壞資料與非法帳號會拒絕處理且不標記已抽",()=>{
  const db=setup();
  try{
    initial(db,1);
    db.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)")
      .run(1,Number.MAX_SAFE_INTEGER);
    assert.throws(()=>earn(db,1,"2026-11-19",0),/安全整數/);
    assert.equal(getCouponBalance(db,1),Number.MAX_SAFE_INTEGER);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    assert.equal(listCharacterEvents(db,1).length,0);
    assert.throws(()=>getCouponBalance(db,0),/帳號/);
    db.prepare("UPDATE character_coupons SET quantity=? WHERE user_id=1")
      .run(Number.MAX_SAFE_INTEGER+2);
    assert.throws(()=>getCouponBalance(db,1),/餘額資料不正確/);
  }finally{db.close();}
});
