// command.pl::orosi/buy_orosi、tonyahenpin.cgi::henpin_do 與
// original_house.cgi 的商店前置條件：問屋貨架 -> 住宅內店鋪庫存，而非玩家 mono.cgi。
import {randomInt} from "node:crypto";
import {LEGACY_ITEM_FIELDS} from "./legacy-inventory.mjs";
import {recordBankEntry} from "./banking.mjs";
import {getRoomSlots,roomCapacity} from "./rooms.mjs";

export const WHOLESALE_SYMBOL="問屋";
export const WHOLESALE_MAX_GOODS=120;
export const WHOLESALE_STOCK_MULTIPLIER=2;
export const SHOP_KIND_LIMIT=100;
export const SHOP_ITEM_LIMIT=100;
export const WHOLESALE_RETURN_RATE=0.75;
export const SHOP_CATEGORIES=Object.freeze([
  "スーパー","書籍","食料品","薬","スポーツ用品","電化製品","美容","アダルト",
  "DVD","ファーストフード","日用品","お花","デザート","ギフト","アルコール",
  "ゲーム","ドリンク","秘密の商品","関西名産店","東北名産店","ペット","合成"
]);
const TYPES=new Set(SHOP_CATEGORIES);
const NUM=/^(0|[1-9][0-9]*)$/;
const ID=/^[A-Za-z0-9_-]{8,80}$/;
const MAX=Number.MAX_SAFE_INTEGER;

export function parseWholesaleCatalog(source){
  if(typeof source!=="string")throw new Error("問屋原始商品來源必須是文字");
  const rows=source.split(/\r?\n/).slice(1);
  const products=[];
  for(const [index,line] of rows.entries()){
    if(!line.trim())continue;
    const f=line.replace(/\r$/,"").split("<>");
    if(f.length===34&&f[33]==="")f.pop();
    if(f.length!==LEGACY_ITEM_FIELDS.length||f.some(x=>x.length>4096))
      throw new Error("問屋原始商品第 "+(index+2)+" 行不是 33 欄");
    if(["食","デパート"].includes(f[0]))continue;
    if(!f[0]||!f[1]||![17,21,24].every(i=>NUM.test(f[i]))||
       !["回","日"].includes(f[22]))continue;
    const price=Number(f[17]),stock=Number(f[24]),durability=Number(f[21]);
    if(![price,stock,durability].every(Number.isSafeInteger)||
       price<=0||stock<=0||durability<=0||
       price>Math.floor(MAX/200)||stock>Math.floor(MAX/2))continue;
    products.push(Object.freeze({
      sku:"wholesale-"+(index+2),sourceLine:index+2,
      category:f[0],name:f[1],basePrice:price,stock:stock*2,
      durability,unit:f[22],note:f[29],
      fields:Object.freeze(f)
    }));
  }
  if(!products.length)throw new Error("問屋沒有可安全交易的原版商品");
  return Object.freeze(products);
}
export function initWholesaleTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS wholesale_day(",
    "id INTEGER PRIMARY KEY CHECK(id=1),day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS wholesale_stock(",
    "sku TEXT PRIMARY KEY,position INTEGER NOT NULL UNIQUE,",
    "remaining INTEGER NOT NULL CHECK(remaining>=0));",
    "CREATE TABLE IF NOT EXISTS player_shops(",
    "house_id INTEGER PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,",
    "owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "category TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS player_shop_stock(",
    "house_id INTEGER NOT NULL REFERENCES player_shops(house_id) ON DELETE CASCADE,",
    "sku TEXT NOT NULL,category TEXT NOT NULL,name TEXT NOT NULL,",
    "unit_price INTEGER NOT NULL CHECK(unit_price>0),",
    "quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=100),",
    "raw_fields_json TEXT NOT NULL,updated_at INTEGER NOT NULL,",
    "PRIMARY KEY(house_id,sku));",
    "CREATE TABLE IF NOT EXISTS wholesale_transactions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,action TEXT NOT NULL,",
    "house_id INTEGER NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,",
    "quantity INTEGER NOT NULL,amount INTEGER NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));"
  ].join(" "));
}
function shuffle(catalog,randomIndex){
  const items=[...catalog];
  for(let i=items.length-1;i>0;i--){
    const j=randomIndex(i+1);
    if(!Number.isSafeInteger(j)||j<0||j>i)
      throw new Error("問屋亂數超出範圍");
    [items[i],items[j]]=[items[j],items[i]];
  }
  return items;
}
export function ensureWholesaleDay(db,catalog,day,randomIndex=randomInt){
  if(typeof day!=="string"||! /^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("問屋日期格式不正確");
  const key=db.prepare("SELECT day FROM wholesale_day WHERE id=1").get()?.day;
  const count=db.prepare("SELECT COUNT(*) AS n FROM wholesale_stock").get().n;
  if(key===day&&count===Math.min(WHOLESALE_MAX_GOODS,catalog.length))return false;
  db.prepare("DELETE FROM wholesale_stock").run();
  const goods=shuffle(catalog,randomIndex).slice(0,WHOLESALE_MAX_GOODS)
    .sort((a,b)=>a.category.localeCompare(b.category));
  const put=db.prepare("INSERT INTO wholesale_stock(sku,position,remaining) VALUES(?,?,?)");
  for(const [i,item] of goods.entries())put.run(item.sku,i,item.stock);
  db.prepare([
    "INSERT INTO wholesale_day(id,day) VALUES(1,?)",
    "ON CONFLICT(id) DO UPDATE SET day=excluded.day"
  ].join(" ")).run(day);
  return true;
}
export function listWholesaleGoods(db,catalog){
  const bySku=new Map(catalog.map(p=>[p.sku,p]));
  return db.prepare("SELECT sku,remaining FROM wholesale_stock ORDER BY position").all()
    .map(row=>{
      const item=bySku.get(row.sku);
      if(!item)throw new Error("問屋貨架與原版目錄不一致");
      return {sku:item.sku,name:item.name,category:item.category,
        price:item.basePrice,stock:row.remaining,note:item.note};
    });
}
function requireShop(db,userId,houseId,{sameTown=true}={}){
  if(!Number.isSafeInteger(houseId)||houseId<1)throw new Error("請選擇本人住宅商店");
  const row=db.prepare([
    "SELECT h.*,s.category,s.title,c.town_id AS current_town,c.bank",
    "FROM houses h JOIN player_shops s ON s.house_id=h.id",
    "JOIN characters c ON c.user_id=h.owner_user_id",
    "WHERE h.id=? AND h.owner_user_id=?"
  ].join(" ")).get(houseId,userId);
  if(!row)throw new Error("必須先擁有並設定住宅商店，才可進貨或退貨");
  if(sameTown&&row.town_id!==row.current_town)
    throw new Error("必須先抵達本人住宅商店所在城鎮");
  if(!getRoomSlots(db,userId).slice(0,roomCapacity(row.interior_rank))
    .some(slot=>slot.type==="1"))
    throw new Error("住宅室內未啟用「お店」內容，無法經營商店");
  return row;
}
export function listMyShops(db,userId){
  const rows=db.prepare([
    "SELECT s.house_id,s.category,s.title,h.name AS house_name,h.town_id",
    "FROM player_shops s JOIN houses h ON h.id=s.house_id",
    "WHERE s.owner_user_id=? ORDER BY s.house_id"
  ].join(" ")).all(userId);
  return rows.map(x=>({houseId:x.house_id,category:x.category,title:x.title,
    houseName:x.house_name,townId:x.town_id}));
}
export function listShopInventory(db,userId,houseId){
  if(!Number.isSafeInteger(houseId)||houseId<1)return [];
  if(!db.prepare([
    "SELECT 1 FROM houses h JOIN player_shops s ON s.house_id=h.id",
    "WHERE h.id=? AND h.owner_user_id=?"
  ].join(" ")).get(houseId,userId))return [];
  return db.prepare([
    "SELECT sku,category,name,unit_price,quantity FROM player_shop_stock",
    "WHERE house_id=? ORDER BY category,name LIMIT 110"
  ].join(" ")).all(houseId).map(x=>({
    sku:x.sku,category:x.category,name:x.name,unitPrice:x.unit_price,quantity:x.quantity
  }));
}
export function configurePlayerShop(db,userId,houseId,{category,title,confirmClear=false}={},now=Date.now()){
  if(!TYPES.has(category))throw new Error("請選擇原版允許的商店分類");
  if(typeof title!=="string"||!title.trim()||Array.from(title).length>40||
     /[\u0000-\u001F\u007F<>]/u.test(title))
    throw new Error("店名必須為 1～40 字且不能包含標籤");
  db.exec("BEGIN IMMEDIATE");
  try{
    const h=db.prepare([
      "SELECT h.*,c.town_id AS current_town FROM houses h",
      "JOIN characters c ON c.user_id=h.owner_user_id",
      "WHERE h.id=? AND h.owner_user_id=?"
    ].join(" ")).get(houseId,userId);
    if(!h)throw new Error("找不到本人住宅，不能假造商店");
    if(h.town_id!==h.current_town)throw new Error("請先到住宅所在城鎮設定商店");
    if(!getRoomSlots(db,userId).slice(0,roomCapacity(h.interior_rank))
      .some(slot=>slot.type==="1"))
      throw new Error("請先在住宅室內設定「お店」欄位");
    const before=db.prepare("SELECT category FROM player_shops WHERE house_id=?").get(houseId);
    const changed=before&&before.category!==category;
    const stock=changed?db.prepare("SELECT COUNT(*) AS n FROM player_shop_stock WHERE house_id=?")
      .get(houseId).n:0;
    if(stock&&!confirmClear)throw new Error("變更商店類別會清空全部進貨，請明確確認");
    if(changed)db.prepare("DELETE FROM player_shop_stock WHERE house_id=?").run(houseId);
    db.prepare([
      "INSERT INTO player_shops(house_id,owner_user_id,category,title,created_at)",
      "VALUES(?,?,?,?,?) ON CONFLICT(house_id) DO UPDATE SET",
      "category=excluded.category,title=excluded.title"
    ].join(" ")).run(houseId,userId,category,title.trim(),now);
    db.exec("COMMIT");
    return {houseId,category,title:title.trim(),stockCleared:stock>0};
  }catch(e){db.exec("ROLLBACK");throw e;}
}
function validateAction(userId,requestId,now,hasBuilding,quantity){
  if(!Number.isSafeInteger(userId)||userId<1||typeof requestId!=="string"||
     !ID.test(requestId)||!Number.isSafeInteger(now)||now<=0||
     typeof hasBuilding!=="function"||!Number.isSafeInteger(quantity)||
     quantity<0||quantity>SHOP_ITEM_LIMIT)
    throw new Error("問屋交易請求格式不正確");
}
function tx(db,userId,requestId,now,action,houseId,sku,quantity,work){
  db.exec("BEGIN IMMEDIATE");
  try{
    const past=db.prepare([
      "SELECT action,house_id,sku,quantity,amount,name FROM wholesale_transactions",
      "WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(past){
      if(past.action!==action||past.house_id!==houseId||
         past.sku!==sku||past.quantity!==quantity)
        throw new Error("問屋請求編號不可改成另一筆交易");
      db.exec("COMMIT");
      return {action,houseId,sku,quantity,amount:past.amount,name:past.name,replayed:true};
    }
    const result=work();
    db.prepare([
      "INSERT INTO wholesale_transactions(user_id,request_id,action,house_id,sku,",
      "name,quantity,amount,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,action,houseId,sku,result.name,quantity,result.amount,now);
    db.exec("COMMIT");
    return {action,houseId,sku,quantity,...result,replayed:false};
  }catch(e){db.exec("ROLLBACK");throw e;}
}
// 原始 float 乘 1.5 可能有半元；Web 整數帳本用「向上取整」避免少扣。
export function wholesaleCost(basePrice,quantity,supermarket){
  if(!Number.isSafeInteger(basePrice)||basePrice<=0||
     !Number.isSafeInteger(quantity)||quantity<=0)return null;
  const numerator=BigInt(basePrice)*BigInt(quantity)*(supermarket?3n:2n);
  const result=(numerator+1n)/2n;
  return result>BigInt(MAX)?null:Number(result);
}
export function buyWholesale(db,userId,catalog,{
  houseId,sku,quantity,requestId,now,day,hasBuilding
}={}){
  validateAction(userId,requestId,now,hasBuilding,quantity);
  if(quantity<=0)throw new Error("問屋購入數量至少 1 件");
  const item=catalog.find(x=>x.sku===sku);
  if(!item)throw new Error("問屋不存在這項商品");
  return tx(db,userId,requestId,now,"buy",houseId,sku,quantity,()=>{
    const shop=requireShop(db,userId,houseId);
    if(!hasBuilding(WHOLESALE_SYMBOL,shop.current_town))
      throw new Error("目前城鎮沒有原版問屋建築");
    ensureWholesaleDay(db,catalog,day);
    const onShelf=db.prepare("SELECT remaining FROM wholesale_stock WHERE sku=?").get(sku);
    if(!onShelf||onShelf.remaining<quantity)
      throw new Error("問屋本期商品沒有上架或共用庫存不足");
    if(shop.category!=="スーパー"&&shop.category!==item.category)
      throw new Error("店鋪種類不允許進貨這項商品");
    if(shop.category==="スーパー"&&
       (item.note.includes("専門店限定商品")||item.note.includes("秘伝商品")))
      throw new Error("原版專賣店限定或秘傳商品不能由超市進貨");
    const cost=wholesaleCost(item.basePrice,quantity,shop.category==="スーパー");
    if(cost===null)throw new Error("批發金額超出安全整數範圍");
    if(shop.bank<cost)throw new Error("普通銀行存款不足");
    const old=db.prepare("SELECT * FROM player_shop_stock WHERE house_id=? AND sku=?")
      .get(houseId,sku);
    if(old){
      if(old.quantity+quantity>SHOP_ITEM_LIMIT)throw new Error("同品店鋪庫存不可超過 100 件");
    }else{
      const types=db.prepare("SELECT COUNT(*) AS n FROM player_shop_stock WHERE house_id=?")
        .get(houseId).n;
      if(types>=SHOP_KIND_LIMIT)throw new Error("店鋪已達 100 種商品上限");
    }
    if(db.prepare("UPDATE wholesale_stock SET remaining=remaining-? WHERE sku=? AND remaining>=?")
      .run(quantity,sku,quantity).changes!==1)throw new Error("問屋共用庫存不足");
    if(db.prepare("UPDATE characters SET bank=bank-? WHERE user_id=? AND bank>=?")
      .run(cost,userId,cost).changes!==1)throw new Error("普通銀行存款不足");
    const raw=old?JSON.parse(old.raw_fields_json):[...item.fields];
    if(!Array.isArray(raw)||raw.length!==33)throw new Error("商店原始商品檔不完整");
    const count=(old?.quantity??0)+quantity;
    raw[24]=String(count);
    if(!old)raw[30]=String(Math.floor(now/1000));
    if(old){
      db.prepare([
        "UPDATE player_shop_stock SET quantity=?,raw_fields_json=?,updated_at=?",
        "WHERE house_id=? AND sku=?"
      ].join(" ")).run(count,JSON.stringify(raw),now,houseId,sku);
    }else{
      db.prepare([
        "INSERT INTO player_shop_stock(house_id,sku,category,name,unit_price,quantity,",
        "raw_fields_json,updated_at) VALUES(?,?,?,?,?,?,?,?)"
      ].join(" ")).run(houseId,sku,item.category,item.name,item.basePrice,count,
        JSON.stringify(raw),now);
    }
    recordBankEntry(db,userId,"ordinary",("問屋進貨："+item.name).slice(0,50),
      cost,0,shop.bank-cost,now);
    return {name:item.name,amount:-cost,stockAfter:count};
  });
}
// 原始「問屋返品」以普通銀行帳戶收退款，不回補問屋共用貨架。
export function returnWholesale(db,userId,{
  houseId,sku,quantity=0,requestId,now,hasBuilding
}={}){
  validateAction(userId,requestId,now,hasBuilding,quantity);
  if(typeof sku!=="string"||!sku)throw new Error("請選擇退貨商品");
  return tx(db,userId,requestId,now,"return",houseId,sku,quantity,()=>{
    const shop=requireShop(db,userId,houseId);
    // 退貨入口在 original_house.cgi 的商店設定內，不要求再次進入問屋。
    const row=db.prepare("SELECT * FROM player_shop_stock WHERE house_id=? AND sku=?")
      .get(houseId,sku);
    if(!row)throw new Error("商店倉庫沒有這項可退商品");
    const moved=quantity===0?row.quantity:quantity;
    if(moved<1||moved>row.quantity)throw new Error("退貨數量不能超過店鋪庫存");
    const numerator=BigInt(row.unit_price)*BigInt(moved)*
      (shop.category==="スーパー"?9n:3n);
    // 超市：x1.5 x0.75 => 9/8；一般商店：x0.75 => 3/4。
    const denominator=shop.category==="スーパー"?8n:4n;
    const refundBig=numerator/denominator;
    if(refundBig>BigInt(MAX)||BigInt(shop.bank)+refundBig>BigInt(MAX))
      throw new Error("退貨金額超出安全範圍");
    const refund=Number(refundBig);
    if(moved===row.quantity){
      db.prepare("DELETE FROM player_shop_stock WHERE house_id=? AND sku=?")
        .run(houseId,sku);
    }else{
      const raw=JSON.parse(row.raw_fields_json);
      if(!Array.isArray(raw)||raw.length!==33)throw new Error("店鋪原始商品資料損壞");
      raw[24]=String(row.quantity-moved);
      db.prepare([
        "UPDATE player_shop_stock SET quantity=?,raw_fields_json=?,updated_at=?",
        "WHERE house_id=? AND sku=?"
      ].join(" ")).run(row.quantity-moved,JSON.stringify(raw),now,houseId,sku);
    }
    db.prepare("UPDATE characters SET bank=bank+? WHERE user_id=?")
      .run(refund,userId);
    recordBankEntry(db,userId,"ordinary",("問屋退貨："+row.name).slice(0,50),
      0,refund,shop.bank+refund,now);
    return {name:row.name,amount:refund,returned:moved,
      stockAfter:row.quantity-moved};
  });
}
export function listWholesaleHistory(db,userId,limit=20){
  return db.prepare([
    "SELECT action,house_id,sku,name,quantity,amount,created_at",
    "FROM wholesale_transactions WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:20,50)))
    .map(x=>({action:x.action,houseId:x.house_id,sku:x.sku,
      name:x.name,quantity:x.quantity,amount:x.amount,createdAt:x.created_at}));
}
