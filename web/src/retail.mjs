// 原版 command.pl::depart_gamen/buy_syouhin：兩間百貨店每日最多 110 種非「食」商品。
// 共用本人商品結帳交易；自販機獨立販售價格、上架週期與共用庫存。
import { randomInt } from "node:crypto";
import { LEGACY_ITEM_FIELDS,initLegacyInventoryTables } from "./legacy-inventory.mjs";
import { requireClassroomCreditCard } from "./legacy-credit.mjs";
import { recordBankEntry } from "./banking.mjs";
import { initInventoryTables,insuranceCoverage,DAY_MS } from "./inventory.mjs";
import { VENDING_SHOP,VENDING_SYMBOL,ensureVendingRotation } from "./vending.mjs";

export const RETAIL_SHOPS=Object.freeze({depart1:"デパ",depart2:"デパ2"});
export const RETAIL_DAILY_LIMIT=110;
export const RETAIL_SLOT_LIMIT=25;
export const RETAIL_GIFT_LIMIT=10;
export const RETAIL_MAX_QUANTITY=5;
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
  initInventoryTables(db);
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
  // PR #35 的現有購物紀錄無數量和付款方式：舊單筆交易不動，套用原先的現金一件預設值。
  const columns=new Set(db.prepare("PRAGMA table_info(retail_purchases)").all().map(x=>x.name));
  for(const [name,definition] of [
    ["quantity","INTEGER NOT NULL DEFAULT 1"],
    ["payment","TEXT NOT NULL DEFAULT 'cash'"],
    ["card_source_line","INTEGER"],
    ["merged","INTEGER NOT NULL DEFAULT 0"]
  ])if(!columns.has(name))db.exec("ALTER TABLE retail_purchases ADD COLUMN "+name+" "+definition);
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
    "p.quantity,p.payment,p.merged,",
    "COALESCE(u.remaining,i.durability) AS remaining,i.durability_unit AS unit",
    "FROM retail_purchases p",
    "LEFT JOIN legacy_inventory_items i ON i.user_id=p.user_id AND i.source_line=p.source_line",
    "LEFT JOIN legacy_item_usage u ON u.user_id=p.user_id AND u.source_line=p.source_line",
    "WHERE p.user_id=? ORDER BY p.id DESC LIMIT ?"
  ].join(" ")).all(userId,limit).map(row=>({
    shop:row.shop,sku:row.sku,name:row.name,paid:row.paid,
    quantity:row.quantity,payment:row.payment,merged:Boolean(row.merged),
    sourceLine:row.source_line,createdAt:row.created_at,
    remaining:row.remaining,unit:row.unit
  }));
}
// 原版「日」耐久按購入日起算；「回」耐久以 Web 已消耗的剩餘次數為準。
// 舊檔不改寫：只合併有明確 Web 購物來源、相同商品資訊的物品。
function remainingNow(row,now){
  if(row.durability_unit==="日"){
    if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)return 0;
    const elapsed=Math.max(0,Math.floor((Math.floor(now/1000)-row.purchased_at)/86400));
    return Math.max(0,row.durability-elapsed);
  }
  return Math.max(0,row.web_remaining??row.durability);
}
function currentInventory(db,userId,now){
  const rows=db.prepare([
    "SELECT i.*,u.remaining AS web_remaining",
    "FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u",
    "ON u.user_id=i.user_id AND u.source_line=i.source_line WHERE i.user_id=?"
  ].join(" ")).all(userId);
  return rows.map(row=>({...row,remainingNow:remainingNow(row,now)}));
}
function ownedCategory(item){
  if(item.effect.includes("ギフト"))return "ギフト";
  if(item.effect.includes("食料品"))return "食料品";
  if(item.effect.includes("ファ"))return "ファーストフード";
  return item.category;
}
export function buyRetailItem(db,userId,catalog,{
  shop,sku,requestId,now,day,hasBuilding,quantity=1,payment="cash",cardSourceLine,
  timeZone="Asia/Taipei"
}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !(Object.hasOwn(RETAIL_SHOPS,shop)||shop===VENDING_SHOP)||typeof sku!=="string"||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof hasBuilding!=="function"||
     !Number.isSafeInteger(quantity)||quantity<1||quantity>RETAIL_MAX_QUANTITY||
     !["cash","bank"].includes(payment)||
     (payment==="bank"&&(!Number.isSafeInteger(cardSourceLine)||cardSourceLine<=0))||
     (payment==="cash"&&cardSourceLine!==undefined))
    throw new Error("百貨店購物請求格式不正確（單次可選 1～5 件）");
  const item=catalog.find(x=>x.sku===sku);
  if(!item)throw new Error("找不到原版百貨店商品");
  const total=item.unitPrice*quantity;
  const addedDurability=item.durability*quantity;
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(addedDurability))
    throw new Error("購買總額或耐久超出安全範圍");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT shop,sku,name,paid,source_line,quantity,payment,card_source_line,merged",
      "FROM retail_purchases WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.shop!==shop||previous.sku!==sku||
         previous.quantity!==quantity||previous.payment!==payment||
         (previous.card_source_line??null)!==(cardSourceLine??null))
        throw new Error("購買識別碼已被用於不同商品、數量或付款方式");
      db.exec("COMMIT");
      return {shop,sku,name:previous.name,paid:previous.paid,
        sourceLine:previous.source_line,quantity,payment,
        merged:Boolean(previous.merged),replayed:true};
    }
    const character=db.prepare("SELECT user_id,money,bank,town_id FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    const vending=shop===VENDING_SHOP;
    if(!hasBuilding(vending?VENDING_SYMBOL:RETAIL_SHOPS[shop],character.town_id))
      throw new Error(vending?"目前所在城鎮沒有自動販賣機":"目前所在城鎮沒有這間百貨店");
    if(vending)ensureVendingRotation(db,catalog,now,timeZone);
    else ensureRetailDay(db,catalog,day);
    const available=vending
      ?db.prepare("SELECT remaining FROM vending_stock WHERE sku=?").get(sku)
      :db.prepare("SELECT remaining FROM retail_stock WHERE shop=? AND sku=?").get(shop,sku);
    if(!available||available.remaining<quantity)
      throw new Error("商品本期未上架或庫存不足");
    if(payment==="cash"){
      if(character.money<total)throw new Error("現金不足");
    }else{
      // 不接受前端自報卡片有效性；須是本人原版 33 欄、尚在有效期內的信用卡。
      requireClassroomCreditCard(db,userId,cardSourceLine,now);
      if(character.bank<total)throw new Error("普通銀行存款不足");
    }
    const category=ownedCategory(item);
    const gift=category==="ギフト";
    const healthInsurance=category==="日用品"&&item.name==="健康保険"&&
      item.effect==="無"&&item.durabilityUnit==="日";
    let insuranceUntil=null;
    if(healthInsurance){
      // 將百貨購入的原版健康保険及既有暫時直購保險統一為醫院使用的期限。
      // 先計算所有已知保險來源的剩餘時間，再延長，避免兩種購買途徑重複折扣。
      const remaining=insuranceCoverage(db,userId,now).remainingMs;
      const extension=addedDurability*DAY_MS;
      const cap=item.durability*RETAIL_MAX_QUANTITY*DAY_MS;
      insuranceUntil=now+remaining+extension;
      if(![remaining,extension,cap,insuranceUntil].every(Number.isSafeInteger))
        throw new Error("保險期限超出安全範圍");
      if(remaining+extension>cap)
        throw new Error("健康保險有效耐久不得超過 5 份");
    }
    const inventory=currentInventory(db,userId,now);
    const active=inventory.filter(x=>x.remainingNow>0);
    let existing=null;
    if(!gift){
      const matches=active.filter(x=>
        x.original_id===RETAIL_ITEM_ORIGIN&&x.original_name===item.name&&
        x.category===category&&x.effect===item.effect&&
        x.durability_unit===item.durabilityUnit);
      if(matches.length){
        // 兼容舊版 Web 同品多列：挑選尚可容納的一筆，不動歷史的其他列。
        existing=matches.find(x=>Number.isSafeInteger(x.remainingNow+addedDurability)&&
          x.remainingNow+addedDurability<=item.durability*RETAIL_MAX_QUANTITY)??null;
        if(!existing)throw new Error("相同商品已達 5 件持有上限");
      }
    }
    if(gift){
      if(active.filter(x=>x.category==="ギフト").length>=RETAIL_GIFT_LIMIT)
        throw new Error("購入禮品已達 10 格限制");
    }else if(!existing&&active.filter(x=>x.category!=="ギフト"&&x.category!=="ギフト商品").length>=RETAIL_SLOT_LIMIT){
      throw new Error("一般持有物已達 25 格限制");
    }
    const stockChanged=vending
      ?db.prepare("UPDATE vending_stock SET remaining=remaining-? WHERE sku=? AND remaining>=?")
        .run(quantity,sku,quantity).changes
      :db.prepare("UPDATE retail_stock SET remaining=remaining-? WHERE shop=? AND sku=? AND remaining>=?")
        .run(quantity,shop,sku,quantity).changes;
    if(stockChanged!==1)throw new Error("商品庫存不足");
    if(payment==="cash"){
      if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
        .run(total,userId,total).changes!==1)throw new Error("現金不足");
    }else{
      if(db.prepare("UPDATE characters SET bank=bank-? WHERE user_id=? AND bank>=?")
        .run(total,userId,total).changes!==1)throw new Error("普通銀行存款不足");
      recordBankEntry(db,userId,"ordinary",((vending?"自販機":"百貨")+"信用付款："+item.name).slice(0,50),
        total,0,character.bank-total,now);
    }
    const purchasedAt=Math.floor(now/1000);
    const insert=db.prepare([
      "INSERT INTO retail_purchases(user_id,shop,sku,name,paid,request_id,created_at,",
      "quantity,payment,card_source_line,merged)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,shop,sku,item.name,total,requestId,now,
      quantity,payment,payment==="bank"?cardSourceLine:null,existing?1:0);
    const purchaseId=Number(insert.lastInsertRowid);
    const sourceLine=existing?.source_line??RETAIL_SOURCE_LINE+purchaseId;
    if(!Number.isSafeInteger(sourceLine))throw new Error("購物流水號超出範圍");
    if(existing){
      let fields;
      try{fields=JSON.parse(existing.raw_fields_json);}catch{}
      if(!Array.isArray(fields)||fields.length!==33||
         fields[0]!==existing.category||fields[1]!==existing.original_name||
         fields[21]!==String(existing.durability))
        throw new Error("既有購買物品 33 欄資料不一致");
      const nextDurability=existing.remainingNow+addedDurability;
      fields[21]=String(nextDurability);
      // 原版「日」續購重算起始日；「回」保留已使用時點與冷卻紀錄。
      const newPurchasedAt=item.durabilityUnit==="日"?purchasedAt:existing.purchased_at;
      if(item.durabilityUnit==="日")fields[30]=String(purchasedAt);
      const oldUnit=NONNEG.test(fields[31])?BigInt(fields[31]):0n;
      const weighted=(oldUnit*BigInt(existing.remainingNow)+BigInt(total))/BigInt(nextDurability);
      if(weighted>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("耐久單價超出安全整數");
      fields[31]=String(weighted);
      db.prepare([
        "UPDATE legacy_inventory_items SET durability=?,purchased_at=?,raw_fields_json=?",
        "WHERE user_id=? AND source_line=? AND original_id=?"
      ].join(" ")).run(nextDurability,newPurchasedAt,JSON.stringify(fields),
        userId,sourceLine,RETAIL_ITEM_ORIGIN);
      if(item.durabilityUnit==="回"){
        db.prepare("UPDATE legacy_item_usage SET remaining=? WHERE user_id=? AND source_line=?")
          .run(nextDurability,userId,sourceLine);
      }
    }else{
      const fields=[...item.rawFields];
      fields[0]=category;
      fields[21]=String(addedDurability);
      fields[30]=String(purchasedAt);
      fields[31]=String(Math.trunc(total/addedDurability));
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,RETAIL_ITEM_ORIGIN,sourceLine,category,fields[1],
        fields[9],addedDurability,item.durabilityUnit,purchasedAt,
        NONNEG.test(fields[26])?Number(fields[26]):0,JSON.stringify(fields));
    }
    if(healthInsurance){
      db.prepare([
        "INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at)",
        "VALUES(?,'health-insurance',?,?)",
        "ON CONFLICT(user_id,item_key) DO UPDATE SET",
        "active_until=excluded.active_until,last_purchased_at=excluded.last_purchased_at"
      ].join(" ")).run(userId,insuranceUntil,now);
    }
    db.prepare("UPDATE retail_purchases SET source_line=? WHERE id=?").run(sourceLine,purchaseId);
    db.exec("COMMIT");
    return {shop,sku,name:item.name,paid:total,sourceLine,quantity,payment,
      merged:Boolean(existing),replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
