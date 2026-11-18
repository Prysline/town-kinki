import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {
  ITEM_SLOT_LIMIT,SAME_ITEM_LIMIT,DAY_MS,parseLegacyInsurance,initInventoryTables,
  inventoryOverview,hasActiveHealthInsurance,listInsurancePurchases,buyHealthInsurance
} from "../src/inventory.mjs";

const NOW=1700000000000;
function source(price="10000",days="30",unit="日") {
  const row=Array(34).fill("0");
  row[0]="日用品";row[1]="健康保険";row[17]=price;
  row[21]=days;row[22]=unit;
  return "原版商品欄位\n"+row.join("<>")+"\n";
}
const insurance=parseLegacyInsurance(source());
function setup() {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,money) VALUES(1,100000),(2,50000);"
  ].join("\n"));
  initInventoryTables(db);
  return db;
}
function buy(db,quantity=1,requestId="insurance-001",userId=1,now=NOW) {
  return buyHealthInsurance(db,userId,insurance,quantity,requestId,now);
}

test("原版商品資料解析使用正確的日用品、保險名稱、價格及耐久欄位",()=>{
  assert.deepEqual(insurance,{
    key:"health-insurance",category:"日用品",originalName:"健康保険",
    name:"健康保險",price:10000,days:30,unit:"日",maxQuantity:5
  });
  assert.equal(ITEM_SLOT_LIMIT,25);
  assert.equal(SAME_ITEM_LIMIT,5);
  assert.equal(DAY_MS,86400000);
  assert.throws(()=>parseLegacyInsurance(source("0")),/價錢/);
  assert.throws(()=>parseLegacyInsurance(source("-1")),/價錢/);
  assert.throws(()=>parseLegacyInsurance(source("10000","0")),/耐久天數/);
  assert.throws(()=>parseLegacyInsurance(source("10000","30","回")),/耐久格式/);
  assert.throws(()=>parseLegacyInsurance(source()+source().split("\n")[1]),/唯一辨識/);
});

test("健康保險購買以現金扣款、原版三十日為有效期限並儲存稽核紀錄",()=>{
  const db=setup();
  try {
    assert.equal(hasActiveHealthInsurance(db,1,insurance,NOW),false);
    const receipt=buy(db,1,"insurance-001");
    assert.deepEqual(receipt,{
      paid:10000,quantity:1,activeUntil:NOW+30*DAY_MS,replayed:false
    });
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,90000);
    const status=inventoryOverview(db,1,insurance,NOW);
    assert.equal(status.active,true);
    assert.equal(status.remainingDays,30);
    assert.equal(status.price,10000);
    assert.equal(status.maxSlots,25);
    assert.equal(status.activeUntil,NOW+30*DAY_MS);
    assert.equal(hasActiveHealthInsurance(db,1,insurance,NOW+30*DAY_MS-1),true);
    assert.equal(hasActiveHealthInsurance(db,1,insurance,NOW+30*DAY_MS),false);
    assert.deepEqual(listInsurancePurchases(db,1).map(x=>x.quantity),[1]);
    assert.equal(listInsurancePurchases(db,2).length,0);
  } finally {db.close();}
});

test("相同 requestId 只結算一次，即使重新送出也不得再次扣款或延長期限",()=>{
  const db=setup();
  try {
    const first=buy(db,2,"same-request-A",1,NOW);
    const duplicate=buy(db,2,"same-request-A",1,NOW+DAY_MS);
    assert.equal(duplicate.replayed,true);
    assert.equal(duplicate.paid,20000);
    assert.equal(duplicate.activeUntil,first.activeUntil);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,80000);
    assert.equal(listInsurancePurchases(db,1).length,1);
    assert.throws(()=>buy(db,1,"same-request-A"),/不同操作/);
    assert.equal(listInsurancePurchases(db,1).length,1);
  } finally {db.close();}
});

test("保險可續購並累加剩餘有效日數，但有效耐久不得超過原版五份上限",()=>{
  const db=setup();
  try {
    buy(db,2,"ins-two-001",1,NOW);
    const second=buy(db,3,"ins-three-002",1,NOW+DAY_MS);
    assert.equal(second.paid,30000);
    assert.equal(second.activeUntil,NOW+(2+3)*30*DAY_MS);
    assert.equal(inventoryOverview(db,1,insurance,NOW+DAY_MS).remainingDays,149);
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.throws(()=>buy(db,1,"ins-extra-003",1,NOW+DAY_MS),/5 份/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before);
    assert.equal(listInsurancePurchases(db,1).length,2);
    assert.equal(inventoryOverview(db,1,insurance,NOW+(2+3)*30*DAY_MS).active,false);
    const renewed=buy(db,1,"ins-renew-004",1,NOW+(2+3)*30*DAY_MS);
    assert.equal(renewed.activeUntil,NOW+180*DAY_MS);
  } finally {db.close();}
});

test("購買數量與金額資料只能由伺服器原版商品計算，拒絕造假資料或超量",()=>{
  const db=setup();
  try {
    for(const quantity of [0,6,0.1,-1,"1",null]) {
      assert.throws(()=>buy(db,quantity,"bad-quantity-01"),/購買數量/);
    }
    for(const requestId of ["x","bad id","",null]){
      assert.throws(()=>buy(db,1,requestId),/識別碼/);
    }
    assert.throws(()=>buy(db,1,"safe-req-0001",3),/建立角色/);
    assert.throws(()=>buyHealthInsurance(db,1,{...insurance,key:"forged"},1,
      "safe-req-0001",NOW),/不支援/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,100000);
    assert.equal(listInsurancePurchases(db,1).length,0);
  } finally {db.close();}
});

test("費用不足整筆回滾；先修正資金後相同請求識別碼仍可重新購買",()=>{
  const db=setup();
  try {
    db.prepare("UPDATE characters SET money=999 WHERE user_id=1").run();
    assert.throws(()=>buy(db,1,"no-money-001"),/現金不足/);
    assert.equal(listInsurancePurchases(db,1).length,0);
    assert.equal(inventoryOverview(db,1,insurance,NOW).active,false);
    db.prepare("UPDATE characters SET money=12000 WHERE user_id=1").run();
    const receipt=buy(db,1,"no-money-001");
    assert.equal(receipt.paid,10000);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,2000);
  } finally {db.close();}
});

test("多人帳號資料完全隔離，包括相同請求識別碼也不能跨帳號去重",()=>{
  const db=setup();
  try {
    buy(db,1,"shared-key-01",1,NOW);
    buy(db,3,"shared-key-01",2,NOW);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,90000);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,20000);
    assert.equal(inventoryOverview(db,1,insurance,NOW).remainingDays,30);
    assert.equal(inventoryOverview(db,2,insurance,NOW).remainingDays,90);
    assert.equal(listInsurancePurchases(db,1).length,1);
    assert.equal(listInsurancePurchases(db,2).length,1);
    assert.equal(buy(db,3,"shared-key-01",2,NOW).replayed,true);
  } finally {db.close();}
});

test("升級舊 Web 資料庫不重設角色金錢、保險有效期或購買歷史",()=>{
  const db=setup();
  try {
    buy(db,1,"upgrade-key-01",1,NOW);
    initInventoryTables(db);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,90000);
    assert.equal(inventoryOverview(db,1,insurance,NOW).active,true);
    assert.equal(listInsurancePurchases(db,1).length,1);
    assert.equal(listInsurancePurchases(db,1,1).length,1);
  } finally {db.close();}
});
