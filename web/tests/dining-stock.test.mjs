import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DINING_MENU_LIMIT,DINING_RENEW_THRESHOLD,initDiningStockTables,
  ensureDiningRotation,listedDiningMeals,takeDiningStock
} from "../src/dining-stock.mjs";

function fixtures() {
  return ["main","second"].flatMap(menu=>Array.from({length:35},(_,i)=>({
    key:"meal-"+menu+"-"+i,name:menu+i,menu,stock:5+i%4,
    price:300,calories:300,gains:{}
  })));
}
const firstIndex=()=>0;
function memory() {
  const db=new DatabaseSync(":memory:");
  initDiningStockTables(db);
  return db;
}

test("原版兩家食堂各隨機選最多 30 筆且共用 SQLite 庫存；同日查詢不重抽",()=>{
  const db=memory(),source=fixtures();
  try {
    assert.equal(DINING_MENU_LIMIT,30);
    assert.equal(DINING_RENEW_THRESHOLD,25);
    assert.equal(ensureDiningRotation(db,source,"2026-11-20",firstIndex),true);
    const menu=listedDiningMeals(db,source);
    assert.equal(menu.length,60);
    assert.equal(menu.filter(x=>x.menu==="main").length,30);
    assert.equal(menu.filter(x=>x.menu==="second").length,30);
    assert.equal(new Set(menu.map(x=>x.key)).size,60);
    assert.ok(menu.every(x=>x.stock>=5));
    const meal=menu[0];
    assert.equal(takeDiningStock(db,meal),meal.stock-1);
    assert.equal(ensureDiningRotation(db,source,"2026-11-20",firstIndex),false);
    assert.equal(listedDiningMeals(db,source).find(x=>x.key===meal.key).stock,meal.stock-1);
    assert.equal(db.prepare("SELECT day FROM dining_rotation WHERE id=1").get().day,"2026-11-20");
    const notAvailable=source.find(item=>!menu.some(x=>x.key===item.key));
    assert.ok(notAvailable);
    assert.throws(()=>takeDiningStock(db,notAvailable),/售完|菜單/);
  }finally{db.close();}
});

test("原版 <=25 道仍有庫存時下次訪問刷新兩家食堂、跨遊戲日也補貨",()=>{
  const db=memory(),source=fixtures();
  try{
    ensureDiningRotation(db,source,"2026-11-20",firstIndex);
    const all=listedDiningMeals(db,source).filter(x=>x.menu==="main");
    assert.equal(all.length,30);
    // 先令五道已售完，尚有 25 道有庫存。
    for(const meal of all.slice(0,5))db.prepare(
      "UPDATE dining_stock SET remaining=0 WHERE meal_key=?"
    ).run(meal.key);
    assert.equal(ensureDiningRotation(db,source,"2026-11-20",firstIndex),true);
    let restocked=listedDiningMeals(db,source);
    assert.equal(restocked.length,60);
    assert.ok(restocked.every(x=>x.stock>0));
    const spent=restocked[0];
    takeDiningStock(db,spent);
    assert.equal(ensureDiningRotation(db,source,"2026-11-21",firstIndex),true);
    restocked=listedDiningMeals(db,source);
    assert.equal(restocked.find(x=>x.key===spent.key)?.stock,
      source.find(x=>x.key===spent.key)?.stock);
    assert.equal(db.prepare("SELECT day FROM dining_rotation WHERE id=1").get().day,"2026-11-21");
  }finally{db.close();}
});

test("同筆 SQLite 交易可回滾食堂扣庫存，售完與來源數字異常拒絕寫入",()=>{
  const db=memory(),source=fixtures();
  try{
    ensureDiningRotation(db,source,"2026-11-20",firstIndex);
    const meal=listedDiningMeals(db,source)[0],before=meal.stock;
    db.exec("BEGIN IMMEDIATE");
    takeDiningStock(db,meal);
    db.exec("ROLLBACK");
    assert.equal(listedDiningMeals(db,source)[0].stock,before);
    db.prepare("UPDATE dining_stock SET remaining=0 WHERE meal_key=?").run(meal.key);
    assert.throws(()=>takeDiningStock(db,meal),/售完|菜單/);
    assert.throws(()=>ensureDiningRotation(db,source,"20261120",firstIndex),/遊戲日期/);
    const damaged=source.map(x=>({...x,stock:-1}));
    assert.throws(()=>ensureDiningRotation(db,damaged,"2026-11-21",firstIndex),/庫存資料/);
  }finally{db.close();}
});
