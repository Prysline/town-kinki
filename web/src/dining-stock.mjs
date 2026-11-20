// command.pl::syokudou / syokudou2：原版從兩份食品目錄各選最多 30 道，
// 用來源第 25 欄庫存 ÷ town_ini.cgi::zaiko_tyousetuti（此 fork 為 1）補貨。
// 原版兩家菜單是共用 log_dir/syokudoulog*.cgi；Web 改用全玩家共用 SQLite。
// 低庫存刷新依「尚有庫存品項」判定，不採原版以個人現金判定可購買的漏洞。
import { randomInt } from "node:crypto";

export const DINING_MENU_LIMIT=30;
export const DINING_RENEW_THRESHOLD=25;
export const DINING_STOCK_DIVISOR=1;

const MENUS=Object.freeze(["main","second"]);

export function initDiningStockTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS dining_rotation (",
    "id INTEGER PRIMARY KEY CHECK(id=1),day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS dining_stock (",
    "menu TEXT NOT NULL CHECK(menu IN ('main','second')),",
    "meal_key TEXT NOT NULL,position INTEGER NOT NULL CHECK(position>=0),",
    "remaining INTEGER NOT NULL CHECK(remaining>=0),",
    "PRIMARY KEY(menu,meal_key),UNIQUE(menu,position));"
  ].join(" "));
}

function chooseDailyMeals(source,randomIndex) {
  const foods=[...source];
  // 原版逐筆隨機插入等價於均勻洗牌後取前 N 個；只存原始餐點 key。
  for(let i=foods.length-1;i>0;i--){
    const j=randomIndex(i+1);
    if(!Number.isInteger(j)||j<0||j>i)throw new Error("食堂抽選亂數無效");
    [foods[i],foods[j]]=[foods[j],foods[i]];
  }
  return foods.slice(0,DINING_MENU_LIMIT);
}

// 應在呼叫者的 SQLite 交易中使用：跨日或原版剩餘品項不足時兩間一起刷新。
// 主程式持久化時只存菜單／庫存，不改動原始資料表，舊玩家資料也不覆寫。
export function ensureDiningRotation(db,allMeals,day,randomIndex=randomInt) {
  if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("無效的食堂遊戲日期");
  const existing=db.prepare("SELECT day FROM dining_rotation WHERE id=1").get();
  const stockRows=db.prepare(
    "SELECT menu,COUNT(*) AS entries,SUM(CASE WHEN remaining>0 THEN 1 ELSE 0 END) AS available FROM dining_stock GROUP BY menu"
  ).all();
  const catalogs=Object.fromEntries(MENUS.map(menu=>[
    menu,allMeals.filter(meal=>meal.menu===menu)
  ]));
  const mustRefresh=!existing||existing.day!==day||MENUS.some(menu=>{
    const row=stockRows.find(record=>record.menu===menu);
    const expected=Math.min(DINING_MENU_LIMIT,catalogs[menu].length);
    return !row||row.entries!==expected||
      (expected>DINING_RENEW_THRESHOLD&&row.available<=DINING_RENEW_THRESHOLD);
  });
  if(!mustRefresh)return false;
  db.prepare("DELETE FROM dining_stock").run();
  const insert=db.prepare(
    "INSERT INTO dining_stock(menu,meal_key,position,remaining) VALUES(?,?,?,?)"
  );
  for(const menu of MENUS){
    for(const [index,meal] of chooseDailyMeals(catalogs[menu],randomIndex).entries()){
      if(!Number.isSafeInteger(meal.stock)||meal.stock<0)
        throw new Error("原版食堂庫存資料不正確");
      const quantity=Math.max(1,Math.trunc(meal.stock/DINING_STOCK_DIVISOR));
      insert.run(menu,meal.key,index,quantity);
    }
  }
  db.prepare("INSERT INTO dining_rotation(id,day) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day").run(day);
  return true;
}

export function listedDiningMeals(db,allMeals) {
  const byKey=new Map(allMeals.map(meal=>[meal.key,meal]));
  return db.prepare(
    "SELECT menu,meal_key,remaining FROM dining_stock ORDER BY menu,position"
  ).all().map(row=>{
    const source=byKey.get(row.meal_key);
    if(!source||source.menu!==row.menu)throw new Error("食堂庫存對應的原始商品資料遺失");
    return {...source,stock:row.remaining};
  });
}

export function takeDiningStock(db,meal) {
  const changed=db.prepare(
    "UPDATE dining_stock SET remaining=remaining-1 WHERE menu=? AND meal_key=? AND remaining>0"
  ).run(meal.menu,meal.key);
  if(changed.changes!==1)throw new Error("該餐點今日已售完或不在菜單中");
  return db.prepare(
    "SELECT remaining FROM dining_stock WHERE menu=? AND meal_key=?"
  ).get(meal.menu,meal.key).remaining;
}
