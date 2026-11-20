// 原版 command.pl::hanbai：自販機獨立 dat_dir/jihanki.cgi，前一行讀作控制資料，
// 從後續來源選最多十種；不套用百貨店價格三倍。Web 以本地中午分界的週期保存共用庫存。
import { randomInt } from "node:crypto";
import { LEGACY_ITEM_FIELDS } from "./legacy-inventory.mjs";

export const VENDING_SHOP="vending";
export const VENDING_SYMBOL="自販機";
export const VENDING_MAX_GOODS=10;
const NONNEG=/^(?:0|[1-9][0-9]*)$/;

export function parseLegacyVendingCatalog(source){
  if(typeof source!=="string")throw new Error("原版自販機商品資料必須是文字");
  const lines=source.split(/\r?\n/);
  const catalog=[];
  // command.pl::hanbai 先讀 $hanbai_icigyo 再逐行加入抽選池，保留原版的首行略過行為。
  for(let i=1;i<lines.length;i++){
    if(!lines[i].trim())continue;
    const fields=lines[i].replace(/\r$/,"").split("<>");
    if(fields.length===34&&fields[33]==="")fields.pop();
    if(fields.length!==LEGACY_ITEM_FIELDS.length||fields.some(x=>x.length>4096))
      throw new Error("原版自販機第 "+(i+1)+" 行不是 33 欄");
    if(fields[0]==="食"||fields[29].includes("秘伝商品"))continue;
    const price=Number(fields[17]),stock=Number(fields[24]),durability=Number(fields[21]);
    if(!fields[0]||!fields[1]||!NONNEG.test(fields[17])||
       !NONNEG.test(fields[24])||!NONNEG.test(fields[21])||
       !Number.isSafeInteger(price)||price<=0||
       price>Number.MAX_SAFE_INTEGER/5||
       !Number.isSafeInteger(stock)||stock<=0||
       !Number.isSafeInteger(durability)||durability<=0||
       !["回","日"].includes(fields[22]))continue;
    catalog.push(Object.freeze({
      sku:"vending-"+(i+1),originalLine:i+1,name:fields[1],category:fields[0],
      effect:fields[9],unitPrice:price,basePrice:price,originalStock:stock,
      durability,durabilityUnit:fields[22],rawFields:Object.freeze(fields)
    }));
  }
  if(!catalog.length)throw new Error("原版自販機沒有可安全販售的商品");
  return Object.freeze(catalog);
}
export function vendingPeriodKey(now,timeZone="Asia/Taipei"){
  if(!Number.isSafeInteger(now)||now<0)throw new Error("自販機時間不正確");
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date(now)).map(part=>[part.type,part.value]));
  const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day);
  const localDay=Date.UTC(year,month-1,day);
  const start=Number(parts.hour)<12?localDay-86400000:localDay;
  return new Date(start).toISOString().slice(0,10)+"T12:00";
}
export function initVendingTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS vending_rotation (",
    "id INTEGER PRIMARY KEY CHECK(id=1),period_key TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS vending_stock (",
    "sku TEXT PRIMARY KEY,position INTEGER NOT NULL UNIQUE,",
    "remaining INTEGER NOT NULL CHECK(remaining>=0));"
  ].join(" "));
}
function shuffle(list,randomIndex){
  const items=[...list];
  for(let i=items.length-1;i>0;i--){
    const j=randomIndex(i+1);
    if(!Number.isSafeInteger(j)||j<0||j>i)throw new Error("自販機抽選亂數不正確");
    [items[i],items[j]]=[items[j],items[i]];
  }
  return items;
}
// 僅在 SQLite 寫入交易內使用；中午 12 點起新一週期，前一日中午的庫存保留到隔日中午。
export function ensureVendingRotation(db,catalog,now,timeZone="Asia/Taipei",randomIndex=randomInt){
  const key=vendingPeriodKey(now,timeZone);
  const prev=db.prepare("SELECT period_key FROM vending_rotation WHERE id=1").get()?.period_key;
  const count=db.prepare("SELECT COUNT(*) AS n FROM vending_stock").get().n;
  const expected=Math.min(VENDING_MAX_GOODS,catalog.length);
  if(prev===key&&count===expected)return false;
  db.prepare("DELETE FROM vending_stock").run();
  const stmt=db.prepare("INSERT INTO vending_stock(sku,position,remaining) VALUES(?,?,?)");
  const selected=shuffle(catalog,randomIndex).slice(0,VENDING_MAX_GOODS)
    .sort((a,b)=>a.category.localeCompare(b.category));
  for(const [position,item] of selected.entries())
    stmt.run(item.sku,position,item.originalStock);
  db.prepare([
    "INSERT INTO vending_rotation(id,period_key) VALUES(1,?)",
    "ON CONFLICT(id) DO UPDATE SET period_key=excluded.period_key"
  ].join(" ")).run(key);
  return true;
}
export function listVendingStock(db,catalog){
  const bySku=new Map(catalog.map(x=>[x.sku,x]));
  return db.prepare("SELECT sku,remaining FROM vending_stock ORDER BY position")
    .all().map(row=>{
      const item=bySku.get(row.sku);
      if(!item)throw new Error("自販機上架商品與原版來源不一致");
      return {shop:VENDING_SHOP,sku:item.sku,name:item.name,category:item.category,
        price:item.unitPrice,stock:row.remaining,
        durability:item.durability,unit:item.durabilityUnit,
        effect:item.effect};
    });
}
