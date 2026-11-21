import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {inventoryLife,heldInventoryRows} from "../src/inventory-life.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {listLegacyInventoryItems} from "../src/legacy-inventory.mjs";

const NOW=1_700_000_000_000;
function raw(category,name,unit,durability,interval,purchased){
  const f=Array(33).fill("0");
  f[0]=category;f[1]=name;f[9]="無";f[21]=String(durability);
  f[22]=unit;f[23]=String(interval);f[30]=String(purchased);
  return f;
}
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY)");
  db.prepare("INSERT INTO users(id) VALUES(1)").run();
  initLegacyItemUseTables(db);
  return db;
}
function add(db,{line,name,unit="回",durability=1,interval=3,
  purchased=Math.floor(NOW/1000),last=0,origin="__web_retail__",
  remaining=null,lastUsedMs=0,category="飲料"}){
  const fields=raw(category,name,unit,durability,interval,purchased);
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(1,origin,line,category,name,"無",durability,unit,purchased,last,JSON.stringify(fields));
  if(remaining!==null)db.prepare([
    "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
    "VALUES(1,?,?,?)"
  ].join(" ")).run(line,remaining,lastUsedMs);
}

test("回制用盡後只暫時留在冷卻中，到期即不顯示，不清除原始或使用紀錄",()=>{
  const db=setup();
  try{
    add(db,{line:1,name:"牛奶",remaining:0,lastUsedMs:NOW-60_000,interval:3});
    const life=inventoryLife(heldInventoryRows(db,1,NOW)[0],NOW);
    assert.equal(life.visible,true);
    assert.equal(life.remaining,0);
    assert.equal(life.removeAt,NOW+120001);
    assert.deepEqual(listLegacyInventoryItems(db,1,50,null,NOW).map(x=>x.name),["牛奶"]);
    assert.equal(listLegacyInventoryItems(db,1,50,null,NOW)[0].remaining,0);
    assert.equal(listLegacyInventoryItems(db,1,50,null,NOW)[0].removeAt,NOW+120001);
    assert.equal(heldInventoryRows(db,1,NOW+120000).length,1);
    assert.equal(heldInventoryRows(db,1,NOW+120001).length,0);
    assert.deepEqual(listLegacyInventoryItems(db,1,50,null,NOW+120001),[]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items").get().n,1);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,0);
  }finally{db.close();}
});
test("日制過期按購入日起算，不等待使用冷卻，原始封存不刪除",()=>{
  const db=setup();
  try{
    add(db,{line:1,name:"有效卡",unit:"日",durability:2,interval:0,
      purchased:Math.floor(NOW/1000)-86400});
    add(db,{line:2,name:"過期卡",unit:"日",durability:2,interval:0,
      purchased:Math.floor(NOW/1000)-3*86400});
    const visible=listLegacyInventoryItems(db,1,50,null,NOW);
    assert.deepEqual(visible.map(x=>x.name),["有效卡"]);
    assert.equal(visible[0].remaining,1);
    assert.equal(visible[0].removeAt,NOW+86400000);
    assert.equal(listLegacyInventoryItems(db,1,50,null,NOW+86400000).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items").get().n,2);
  }finally{db.close();}
});
test("無法核實原版時間與格式的匯入項目採保守保留，不偽造過期時間",()=>{
  const db=setup();
  try{
    add(db,{line:1,name:"未記購入日期",unit:"日",durability:5,purchased:0,origin:"original42"});
    add(db,{line:2,name:"異常冷卻",durability:0,origin:"original42",interval:10});
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json='[]' WHERE source_line=2").run();
    const items=listLegacyInventoryItems(db,1,50,null,NOW);
    assert.equal(items.length,2);
    assert.equal(items[0].readOnly,true);
    assert.equal(items[1].readOnly,true);
    assert.equal("removeAt" in items[0],false);
    assert.equal("removeAt" in items[1],false);
  }finally{db.close();}
});
test("先剔除失效來源再套 50 筆限制，舊筆數不會擠掉真正可用的持有物",()=>{
  const db=setup();
  try{
    for(let i=1;i<=55;i++)
      add(db,{line:i,name:"舊貨"+i,unit:"日",durability:1,interval:0,
        origin:"__web_retail__",purchased:Math.floor(NOW/1000)-2*86400});
    add(db,{line:56,name:"新貨",durability:2,interval:2});
    assert.deepEqual(listLegacyInventoryItems(db,1,50,null,NOW).map(x=>x.name),["新貨"]);
    assert.equal(heldInventoryRows(db,1,NOW).length,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items").get().n,56);
  }finally{db.close();}
});
test("Web 已使用完的來源不再算容量，未用完與未知單位依舊保守保留",()=>{
  const db=setup();
  try{
    add(db,{line:1,name:"釣魚已用完",category:"餌",origin:"__web_fishing__",
      durability:5,interval:0,remaining:0,lastUsedMs:NOW-1000});
    add(db,{line:2,name:"合成有剩",category:"道具",origin:"__web_crafting__",
      durability:5,interval:0,remaining:1});
    assert.equal(heldInventoryRows(db,1,NOW).length,1);
    assert.equal(listLegacyInventoryItems(db,1,50,null,NOW)[0].remaining,1);
  }finally{db.close();}
});
test("前端提供等待移除倒數，時間到重新取得伺服器狀態",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/inventory-item\[data-remove-at\]/);
  assert.match(app,/status\.classList\.add\("inventory-removing"\)/);
  assert.match(app,/card\.hidden=true/);
  assert.match(app,/api\("state"\)\.then\(next=>\{state=next;render\(\);\}\)/);
});
