// 原版 command.pl::depart_gamen/buy_syouhin：兩間百貨店每日最多 110 種非「食」商品。
// 首個 Web 購物切片只允許每次購買一件、現金付款；原版贈品與折扣等另行追來源。
import { randomInt } from "node:crypto";
import { LEGACY_ITEM_FIELDS,initLegacyInventoryTables } from "./legacy-inventory.mjs";

export const RETAIL_SHOPS=Object.freeze({depart1:"デパ",depart2:"デパ2"});
export const RETAIL_DAILY_LIMIT=110;
export const RETAIL_SLOT_LIMIT=25;
export const RETAIL_ITEM_ORIGIN="__web_retail__";
const RETAIL_SOURCE_LINE=1000000;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const NONNEG=/^(?:0|[1-9][0-9]*)$/;

export function parseLegacyRetailCatalog(source) {
  if(typeof source!=="string")throw new Error("原版商品目錄不是文字");
  const rows=source.split(/\r?\n/).slice(1);
  const catalog=[];
  for(const [index,line] of rows.entries()){
    if(!line.trim())continue;
    const raw=line.replace(/\r$/,"").split("<>");
    if(raw.length===34&&raw[33]==="")raw.pop();
    if(raw.length!==LEGACY_ITEM_FIELDS.length||raw.some(x=>x.length>4096))
      throw new Error("原始商品第 "+(index+2)+" 行不是 33 欄");
    if(raw[0]==="食" || raw[29].includes("秘伝商品"))continue;
    const price=Number(raw[17]),stock=Number(raw[24]),durability=Number(raw[21]);
    if(!raw[0]||!raw[1]||!NONNEG.test(raw[17])||
      !NONNEG.test(raw[24])||!NONNEG.test(raw[21])||
      !Number.isSafeInteger(price)||price<1||price>Number.MAX_SAFE_INTEGER/3||
      !Number.isSafeInteger(stock)||!Number.isSafeInteger(durability)||
      durability<1||!["回","日"].includes(raw[22]))
      continue; // 無法安全交易的原版商品仍保留在原檔，不猜測其屬性。
    catalog.push(Object.freeze({
      sku:"legacy-"+(index+2),originalLine:index+2,name:raw[1],
      category:raw[0],effect:raw[9],unitPrice:price*3,
      basePrice:price,originalStock:Math.max(1,stock),durability,
      durabilityUnit:raw[22],rawFields:Object.freeze(raw)
    }));
  }
  if(!catalog.length)throw new Error("原版商品目錄沒有可安全購買的商品");
  return Object.freeze(catalog);
}
export function initRetailTables(db){
  initLegacyInventoryTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS retail_day (id INTEGER PRIMARY KEY CHECK(id=1),day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS retail_stock (",
    "shop TEXT NOT NULL CHECK(shop IN ('depart1','depart2')),",
    "sku TEXT NOT NULL,position INTEGER NOT NULL,",
    "remaining INTEGER NOT NULL CHECK(remaining>=0),",
    "PRIMARY KEY(shop,sku),UNIQUE(shop,position));",
    "CREATE TABLE IF NOT EXISTS retail_purchases (",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "shop TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,",
    "paid INTEGER NOT NULL,source_line INTEGER,",
    "request_id TEXT NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));"
  ].join(" "));
}
function shuffle(source,randomIndex){
  const a=[...source];
  for(let i=a.length-1;i>0;i--){
    const j=randomIndex(i+1);
    if(!Number.isSafeInteger(j)||j<0||j>i)
      throw new Error("百貨店抽選亂數不正確");
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
// 呼叫端必須已在寫入交易中；原版兩店同日刷新，所有玩家共用貨架。
export function ensureRetailDay(db,catalog,day,randomIndex=randomInt){
  if(typeof day!=="string"||! /^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("百貨店日期不正確");
  const previous=db.prepare("SELECT day FROM retail_day WHERE id=1").get();
  const count=db.prepare("SELECT COUNT(*) AS n FROM retail_stock").get().n;
  const expected=Math.min(RETAIL_DAILY_LIMIT,catalog.length)*2;
  if(previous?.day===day&&count===expected)return false;
  db.prepare("DELETE FROM retail_stock").run();
  const put=db.prepare("INSERT INTO retail_stock(shop,sku,position,remaining) VALUES(?,?,?,?)");
  for(const shop of Object.keys(RETAIL_SHOPS)){
    const chosen=shuffle(catalog,randomIndex).slice(0,RETAIL_DAILY_LIMIT)
      .sort((a,b)=>a.category.localeCompare(b.category));
    for(const [index,item] of chosen.entries())
      put.run(shop,item.sku,index,item.originalStock);
  }
  db.prepare("INSERT INTO retail_day(id,day) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day").run(day);
  return true;
}
export function listRetailStock(db,catalog,allowedShops=[]){
  const byKey=new Map(catalog.map(x=>[x.sku,x]));
  return db.prepare("SELECT shop,sku,remaining FROM retail_stock ORDER BY shop,position")
    .all().filter(row=>allowedShops.includes(row.shop)).map(row=>{
      const item=byKey.get(row.sku);
      if(!item)throw new Error("百貨店在售商品與原版目錄不一致");
      return {shop:row.shop,sku:item.sku,name:item.name,category:item.category,
        price:item.unitPrice,stock:row.remaining,
        durability:item.durability,unit:item.durabilityUnit};
    });
}
export function listRetailPurchases(db,userId,limit=25){
  return db.prepare([
    "SELECT p.shop,p.sku,p.name,p.paid,p.source_line,p.created_at,",
    "COALESCE(u.remaining,i.durability) AS remaining,i.durability_unit AS unit",
    "FROM retail_purchases p",
    "LEFT JOIN legacy_inventory_items i ON i.user_id=p.user_id AND i.source_line=p.source_line",
    "LEFT JOIN legacy_item_usage u ON u.user_id=p.user_id AND u.source_line=p.source_line",
    "WHERE p.user_id=? ORDER BY p.id DESC LIMIT ?"
  ].join(" ")).all(userId,limit).map(row=>({
    shop:row.shop,sku:row.sku,name:row.name,paid:row.paid,
    sourceLine:row.source_line,createdAt:row.created_at,
    remaining:row.remaining,unit:row.unit
  }));
}
export function buyRetailItem(db,userId,catalog,{shop,sku,requestId,now,day,hasBuilding}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !Object.hasOwn(RETAIL_SHOPS,shop)||typeof sku!=="string"||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof hasBuilding!=="function")
    throw new Error("百貨店購物請求格式不正確");
  const item=catalog.find(x=>x.sku===sku);
  if(!item)throw new Error("找不到原版百貨店商品");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare("SELECT shop,sku,name,paid,source_line FROM retail_purchases WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(previous){
      if(previous.shop!==shop||previous.sku!==sku)
        throw new Error("購買識別碼已被用於不同商品");
      db.exec("COMMIT");
      return {shop,sku,name:previous.name,paid:previous.paid,
        sourceLine:previous.source_line,replayed:true};
    }
    const character=db.prepare("SELECT user_id,money,town_id FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!hasBuilding(RETAIL_SHOPS[shop],character.town_id))
      throw new Error("目前所在城鎮沒有這間百貨店");
    ensureRetailDay(db,catalog,day);
    const available=db.prepare("SELECT remaining FROM retail_stock WHERE shop=? AND sku=?").get(shop,sku);
    if(!available||available.remaining<=0)
      throw new Error("商品今日未上架或已售完");
    if(character.money<item.unitPrice)throw new Error("現金不足");
    const slots=db.prepare([
      "SELECT COUNT(*) AS n FROM legacy_inventory_items i",
      "LEFT JOIN legacy_item_usage u ON i.user_id=u.user_id AND i.source_line=u.source_line",
      "WHERE i.user_id=? AND COALESCE(u.remaining,i.durability)>0"
    ].join(" ")).get(userId).n;
    if(slots>=RETAIL_SLOT_LIMIT)throw new Error("持有物已達 25 格限制");
    if(db.prepare("UPDATE retail_stock SET remaining=remaining-1 WHERE shop=? AND sku=? AND remaining>0")
      .run(shop,sku).changes!==1)throw new Error("商品庫存不足");
    if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(item.unitPrice,userId,item.unitPrice).changes!==1)
      throw new Error("現金不足");
    const purchasedAt=Math.floor(now/1000);
    const fields=[...item.rawFields];
    // 原版 command.pl 會依效果把贈品或食品轉為使用時對應的分類。
    if(item.effect.includes("ギフト"))fields[0]="ギフト";
    else if(item.effect.includes("食料品"))fields[0]="食料品";
    else if(item.effect.includes("ファ"))fields[0]="ファーストフード";
    fields[30]=String(purchasedAt);
    fields[31]=String(Math.trunc(item.unitPrice/item.durability));
    const insert=db.prepare([
      "INSERT INTO retail_purchases(user_id,shop,sku,name,paid,request_id,created_at)",
      "VALUES(?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,shop,sku,item.name,item.unitPrice,requestId,now);
    const id=Number(insert.lastInsertRowid);
    const sourceLine=RETAIL_SOURCE_LINE+id;
    if(!Number.isSafeInteger(sourceLine))throw new Error("購物流水號超出範圍");
    db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
      "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,RETAIL_ITEM_ORIGIN,sourceLine,fields[0],fields[1],
      fields[9],item.durability,item.durabilityUnit,purchasedAt,
      NONNEG.test(fields[26])?Number(fields[26]):0,JSON.stringify(fields));
    db.prepare("UPDATE retail_purchases SET source_line=? WHERE id=?").run(sourceLine,id);
    db.exec("COMMIT");
    return {shop,sku,name:item.name,paid:item.unitPrice,sourceLine,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
