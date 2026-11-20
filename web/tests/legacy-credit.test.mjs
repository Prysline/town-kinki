import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DAY_MS } from "../src/inventory.mjs";
import { listValidClassroomCreditCards,requireClassroomCreditCard } from "../src/legacy-credit.mjs";
import { LEGACY_ITEM_FIELDS } from "../src/legacy-inventory.mjs";

const NOW=Date.UTC(2026,10,20,5);
const SECS=Math.floor(NOW/1000)-120;
function creditFields({name="クレジットカード",effect="クレジット",days="3",
  unit="日",purchasedAt=String(SECS),category="日用品"}={}){
  const data={category,name,effect,durability:days,
    durability_unit:unit,purchased_at:purchasedAt};
  return LEGACY_ITEM_FIELDS.map(key=>data[key]??"");
}
function insert(db,{userId=1,sourceLine=1,fields=creditFields(),
  effect=fields[9],days=Number(fields[21]),purchasedAt=Number(fields[30])}={}){
  db.prepare(
    "INSERT INTO legacy_inventory_items(user_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?)"
  ).run(userId,sourceLine,fields[0],fields[1],effect,days,fields[22],purchasedAt,JSON.stringify(fields));
}
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE legacy_inventory_items(",
    "user_id INTEGER NOT NULL,source_line INTEGER NOT NULL,",
    "category TEXT NOT NULL,original_name TEXT NOT NULL,effect TEXT NOT NULL,",
    "durability INTEGER NOT NULL,durability_unit TEXT NOT NULL,",
    "purchased_at INTEGER,raw_fields_json TEXT NOT NULL);"
  ].join(" "));
  return db;
}

test("原版信用卡 33 欄日用品：本人持有且在有效天數內才可選",()=>{
  const db=fixture();
  try{
    insert(db);
    insert(db,{userId:2,sourceLine:1,fields:creditFields({name:"ゴールドクレジットカード",days:"7"})});
    const mine=listValidClassroomCreditCards(db,1,NOW);
    assert.deepEqual(mine.map(x=>[x.sourceLine,x.name]),[[1,"クレジットカード"]]);
    assert.equal(requireClassroomCreditCard(db,1,1,NOW).sourceLine,1);
    assert.throws(()=>requireClassroomCreditCard(db,1,2,NOW),/本人/);
    assert.equal(listValidClassroomCreditCards(db,2,NOW).length,1);
  }finally{db.close();}
});
test("過期、未購入、未來購入、單位不符、假冒效果及原始欄位破損均不得銀行付款",()=>{
  const db=fixture();
  try{
    const credit=creditFields();
    insert(db,{sourceLine:1,fields:credit});
    insert(db,{sourceLine:2,fields:creditFields({name:"到期",purchasedAt:String(SECS-3*86400)})});
    insert(db,{sourceLine:3,fields:creditFields({name:"未來",purchasedAt:String(SECS+86400)})});
    insert(db,{sourceLine:4,fields:creditFields({name:"非天",unit:"回"})});
    insert(db,{sourceLine:5,fields:creditFields({name:"假效果",effect:"無"})});
    insert(db,{sourceLine:6,fields:creditFields({name:"破損"}),effect:"クレジット",days:9});
    insert(db,{sourceLine:7,fields:creditFields({name:"無購入",purchasedAt:"0"})});
    assert.deepEqual(listValidClassroomCreditCards(db,1,NOW).map(x=>x.sourceLine),[1]);
    for(const line of [2,3,4,5,6,7])
      assert.throws(()=>requireClassroomCreditCard(db,1,line,NOW),/有效/);
    const expires=SECS*1000+3*DAY_MS;
    assert.equal(listValidClassroomCreditCards(db,1,expires-1).length,1);
    assert.equal(listValidClassroomCreditCards(db,1,expires).length,0);
    assert.throws(()=>requireClassroomCreditCard(db,1,"1",NOW),/有效/);
  }finally{db.close();}
});
