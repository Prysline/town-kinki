// sea.cgi::turu/seri 與 hanbai1.cgi::hanbai1/buy_syouhin_1。
// 只以原版執行程式、dat_dir/syouhin.cgi 商品表產生「新 Web 玩家」資產。
// 不需要、也不接受任何舊 CGI 玩家的 log.cgi/mono.cgi 匯入。
import {randomInt} from "node:crypto";
import {LEGACY_ITEM_FIELDS,initLegacyInventoryTables} from "./legacy-inventory.mjs";
import {initLegacyItemUseTables} from "./legacy-item-use.mjs";
import {readTownMap} from "./town-storage.mjs";

export const FISHING_SYMBOL="釣り";
export const BAIT_SHOP_SYMBOL="販売1";
export const FISHING_ITEM_ORIGIN="__web_fishing__";
export const FISHING_SLOT_LIMIT=25;
export const FISHING_STACK_LIMIT=5;
const ID_RE=/^[A-Za-z0-9_-]{8,80}$/;
const FISH_LINE_START=7000000;
const BAIT_RULES=Object.freeze({
  "小エビ":{tier:0,chance:7},
  "魚ルアー（小）":{tier:0,chance:5},
  "魚ルアー（中）":{tier:1,chance:5},
  "魚ルアー（大）":{tier:2,chance:5},
  "小魚":{tier:1,chance:3},
  "ミニたこ":{tier:1,chance:5},
  "ホタルイカ":{tier:1,chance:7},
  "中くらいの魚":{tier:2,chance:3},
  "スルメイカ":{tier:2,chance:5},
  "クラゲ":{tier:2,chance:7},
  "でかい魚":{tier:3,chance:2},
  "ウツボ":{tier:3,chance:3},
  "ミズダコ":{tier:3,chance:5}
});
const SALE_RULES=Object.freeze({
  "小魚":{max:100,base:50},"ミニたこ":{max:100,base:50},
  "ホタルイカ":{max:100,base:50},
  "中くらいの魚":{max:500,base:200},
  "スルメイカ":{max:500,base:200},"クラゲ":{max:500,base:200},
  "でかい魚":{max:1000,base:2500},
  "ウツボ":{max:5000,base:2500},"ミズダコ":{max:3000,base:2500},
  "サメ":{max:50000,base:50000},
  "海がめ":{max:100000,base:50000},
  "マグロ":{max:200000,base:50000}
});
function parseFields(raw,label){
  const fields=raw.trim().replace(/\\n$/,"").split("<>");
  if(fields.length===34&&fields[33]==="")fields.pop();
  if(fields.length!==LEGACY_ITEM_FIELDS.length||
     fields.some(s=>s.length>4096))
    throw new Error(label+"不是原版 33 欄商品");
  return fields;
}
function positiveInteger(text,label){
  if(!/^[1-9][0-9]*$/.test(text??""))throw new Error(label+"必須是正整數");
  const n=Number(text);
  if(!Number.isSafeInteger(n))throw new Error(label+"超出安全整數範圍");
  return n;
}
export function parseOriginalFishing(baitSource,seaSource,shopSource){
  if(!baitSource||!seaSource||!shopSource)throw new Error("原版釣魚來源缺失");
  if(!shopSource.includes("$hanbai_hinmoku = '餌'"))
    throw new Error("原版販售1未證實為餌料商店");
  const interval=/\$turi_kankaku\s*=\s*(\d+);/.exec(seaSource)?.[1];
  if(interval!=="100")throw new Error("原版釣魚冷卻來源不一致");
  if(!seaSource.includes("$my_rand = int(rand(3))"))
    throw new Error("原版釣獲抽選範圍不是三項，不能猜測");
  const bait=Object.freeze(baitSource.split(/\r?\n/).flatMap((line,i)=>{
    if(!line.startsWith("餌<>"))return [];
    const f=parseFields(line,"餌料第"+(i+1)+"行");
    const name=f[1],price=positiveInteger(f[17],"餌料售價"),
      stock=positiveInteger(f[24],"餌料庫存"),
      durability=positiveInteger(f[21],"餌料耐久");
    if(!Object.hasOwn(BAIT_RULES,name)||f[22]!=="回")
      throw new Error("原版餌料資料與 sea.cgi 的用法不一致");
    // sea.cgi / hanbai1.cgi 的單件原價，非百貨店的原價×3。
    return [Object.freeze({sku:"bait-"+(i+1),name,price,stock,durability,
      unit:"回",rawFields:Object.freeze(f)})];
  }));
  if(bait.length!==4||new Set(bait.map(x=>x.name)).size!==4)
    throw new Error("原版餌料商品數量不正確");
  // sea.cgi 每組列四個候選，但實際 int(rand(3)) 只會抽到前三個；
  // 不虛構第四項「ポン・デ・リング／たこ焼き／載具／船艦」獎勵。
  const blocks=[...seaSource.matchAll(/\@plazentitm\s*=\s*\(([\s\S]*?)\);/g)];
  if(blocks.length!==4)throw new Error("原版釣魚四組獎品來源缺失");
  const catches=Object.freeze(blocks.map(([_,block],tier)=>{
    const found=[...block.matchAll(/'([^'\n]+)'/g)].map(m=>parseFields(m[1],"釣獲資料"));
    if(found.length!==4)throw new Error("原版釣魚獎品四欄序不符");
    const firstThree=found.slice(0,3);
    if(firstThree.some(x=>x[0]!==(tier===3?"幻の魚":"魚")||
      x[22]!=="回"||positiveInteger(x[21],"釣獲耐久")!==1||
      !Object.hasOwn(SALE_RULES,x[1])))
      throw new Error("原版魚獲不能核對價格／類別");
    return Object.freeze(firstThree.map(x=>Object.freeze(x)));
  }));
  // 拒絕把來源已變動的 bait 對應、銷售價域悄悄當成不變規則。
  for(const [name,{tier,chance}] of Object.entries(BAIT_RULES)){
    const raw=seaSource.split("\n").find(x=>x.includes("eq \""+name+"\"")&&x.includes("$rand"));
    if(!raw||!raw.includes("$rand"+(tier+1)+"=\""+chance+"\""))
      throw new Error("原版餌料中獎機率與來源不一致："+name);
  }
  for(const [name,{max}] of Object.entries(SALE_RULES)){
    const raw=seaSource.split("\n").find(x=>x.includes("eq \""+name+"\"")&&x.includes("$kati"));
    if(!raw||!raw.includes('="'+max+'"'))
      throw new Error("原版魚類售價區間與來源不一致："+name);
  }
  return Object.freeze({bait,catches,intervalSeconds:100});
}
export function initFishingTables(db){
  initLegacyInventoryTables(db);
  initLegacyItemUseTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS fishing_stock_day(id INTEGER PRIMARY KEY CHECK(id=1),day TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS fishing_bait_stock(sku TEXT PRIMARY KEY,remaining INTEGER NOT NULL CHECK(remaining>=0));",
    "CREATE TABLE IF NOT EXISTS fishing_cooldown(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "last_cast_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS fishing_transactions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('buy','cast','sell')),",
    "source_line INTEGER,sku TEXT,",
    "result_json TEXT NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS fishing_transactions_user_idx",
    "ON fishing_transactions(user_id,id);"
  ].join(" "));
}
export function ensureFishingStock(db,baitCatalog,day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day??""))throw new Error("餌料販售日期格式不正確");
  if(db.prepare("SELECT day FROM fishing_stock_day WHERE id=1").get()?.day===day&&
     db.prepare("SELECT COUNT(*) AS n FROM fishing_bait_stock").get().n===baitCatalog.length)
    return false;
  db.prepare("DELETE FROM fishing_bait_stock").run();
  const insert=db.prepare("INSERT INTO fishing_bait_stock(sku,remaining) VALUES(?,?)");
  for(const item of baitCatalog)insert.run(item.sku,item.stock);
  db.prepare([
    "INSERT INTO fishing_stock_day(id,day) VALUES(1,?)",
    "ON CONFLICT(id) DO UPDATE SET day=excluded.day"
  ].join(" ")).run(day);
  return true;
}
function rows(db,userId){
  return db.prepare([
    "SELECT i.*,u.remaining AS web_remaining FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? ORDER BY i.source_line"
  ].join(" ")).all(userId).map(row=>({
    ...row,remaining:Math.max(0,row.web_remaining??row.durability)
  }));
}
function active(row,now){
  if(row.durability<=0)return false;
  if(row.durability_unit==="回")return row.remaining>0;
  if(row.durability_unit==="日"){
    if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)return true;
    return row.durability-Math.max(0,Math.floor(
      (Math.floor(now/1000)-row.purchased_at)/86400))>0;
  }
  return true;
}
function readFields(row){
  let f;try{f=JSON.parse(row.raw_fields_json);}catch{}
  if(!Array.isArray(f)||f.length!==33||
     f[0]!==row.category||f[1]!==row.original_name||
     f[21]!==String(row.durability)||f[22]!==row.durability_unit)
    throw new Error("本人魚餌或漁獲持有物 33 欄資料不一致");
  return f;
}
function sourceLine(db,userId){
  const n=db.prepare("SELECT COALESCE(MAX(source_line),0) AS n FROM legacy_inventory_items WHERE user_id=?")
    .get(userId).n;
  const next=Math.max(FISH_LINE_START,n+1);
  if(!Number.isSafeInteger(next))throw new Error("漁獲流水號超出安全整數範圍");
  return next;
}
function addOrMerge(db,userId,item,now,all){
  const category=item[0],name=item[1],
    count=positiveInteger(item[21],"原版商品耐久");
  const candidates=all.filter(x=>x.original_id===FISHING_ITEM_ORIGIN&&
    x.category===category&&x.original_name===name&&
    x.durability_unit==="回"&&x.remaining>0);
  let match=candidates.find(x=>x.remaining+count<=FISHING_STACK_LIMIT*count)??null;
  // 每一種新商品以單一類別和最多五份作堆疊；若持有同名五份，不額外開第六個堆疊。
  if(!match&&candidates.length)throw new Error("相同魚餌或漁獲已達五份持有上限");
  if(!match&&all.filter(x=>active(x,now)&&x.category!=="ギフト"&&x.category!=="ギフト商品").length>=FISHING_SLOT_LIMIT)
    throw new Error("一般持有物已達 25 格上限");
  if(match){
    const f=readFields(match);
    const amount=match.remaining+count;
    f[21]=String(amount);
    db.prepare([
      "UPDATE legacy_inventory_items SET durability=?,raw_fields_json=?",
      "WHERE user_id=? AND source_line=? AND original_id=?"
    ].join(" ")).run(amount,JSON.stringify(f),userId,match.source_line,FISHING_ITEM_ORIGIN);
    db.prepare([
      "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
      "VALUES(?,?,?,0) ON CONFLICT(user_id,source_line) DO UPDATE SET remaining=excluded.remaining"
    ].join(" ")).run(userId,match.source_line,amount);
    return {sourceLine:match.source_line,merged:true};
  }
  const f=[...item],seconds=Math.floor(now/1000);
  f[30]=String(seconds);
  // 原版釣獲記錄中的購入單價空白代表「不是商店購買」，保持不虛構。
  const line=sourceLine(db,userId);
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,FISHING_ITEM_ORIGIN,line,f[0],f[1],
    f[9],count,"回",seconds,0,JSON.stringify(f));
  return {sourceLine:line,merged:false};
}
function consumeOne(db,userId,row,now){
  if(!row||!["餌","魚","幻の魚"].includes(row.category)||
     row.durability_unit!=="回"||row.remaining<=0)
    throw new Error("找不到本人可用的魚餌／漁獲");
  readFields(row);
  db.prepare([
    "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
    "VALUES(?,?,?,?) ON CONFLICT(user_id,source_line) DO UPDATE SET",
    "remaining=excluded.remaining,last_used_at_ms=excluded.last_used_at_ms"
  ].join(" ")).run(userId,row.source_line,row.remaining-1,now);
}
function hasBuilding(db,townId,symbol){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(symbol);
}
function randomRoll(index,count){
  const n=index(count);
  if(!Number.isSafeInteger(n)||n<0||n>=count)
    throw new Error("釣魚亂數超出原版允許範圍");
  return n;
}
function requireArgs(userId,requestId,now){
  if(!Number.isSafeInteger(userId)||userId<=0||
     typeof requestId!=="string"||!ID_RE.test(requestId)||
     !Number.isSafeInteger(now)||now<=0)
    throw new Error("釣魚交易請求格式不正確");
}
function run(db,userId,action,requestId,now,sourceLine,sku,fn){
  requireArgs(userId,requestId,now);
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT action,source_line,sku,result_json",
      "FROM fishing_transactions WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.action!==action||(previous.source_line??null)!==(sourceLine??null)||
         (previous.sku??null)!==(sku??null))
        throw new Error("相同操作識別碼不可換魚餌、漁獲或動作");
      const result=JSON.parse(previous.result_json);
      db.exec("COMMIT");
      return {...result,replayed:true};
    }
    const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!char)throw new Error("請先建立角色");
    const result=fn(char);
    db.prepare([
      "INSERT INTO fishing_transactions(user_id,request_id,action,source_line,sku,result_json,created_at)",
      "VALUES(?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,action,sourceLine??null,sku??null,
      JSON.stringify(result),now);
    db.exec("COMMIT");
    return {...result,replayed:false};
  }catch(e){db.exec("ROLLBACK");throw e;}
}
export function buyFishingBait(db,userId,source,{sku,requestId,now,day}={}){
  if(typeof sku!=="string")throw new Error("餌料商品識別碼不正確");
  const item=source.bait.find(x=>x.sku===sku);
  if(!item)throw new Error("不是原版釣魚餌料商品");
  return run(db,userId,"buy",requestId,now,null,sku,char=>{
    if(!hasBuilding(db,char.town_id,BAIT_SHOP_SYMBOL))
      throw new Error("目前所在城鎮沒有販售魚餌的商店");
    ensureFishingStock(db,source.bait,day);
    if(char.money<item.price)throw new Error("購買魚餌的現金不足");
    if(db.prepare("UPDATE fishing_bait_stock SET remaining=remaining-1 WHERE sku=? AND remaining>=1")
      .run(sku).changes!==1)throw new Error("魚餌已售完");
    const raw=[...item.rawFields];
    raw[31]=String(Math.floor(item.price/item.durability));
    const owned=addOrMerge(db,userId,raw,now,rows(db,userId));
    if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(item.price,userId,item.price).changes!==1)throw new Error("購買魚餌的現金不足");
    return {action:"buy",name:item.name,price:item.price,quantity:1,
      sourceLine:owned.sourceLine,merged:owned.merged};
  });
}
export function castFishing(db,userId,source,{sourceLine,requestId,now,randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(sourceLine)||sourceLine<1)throw new Error("魚餌行號不正確");
  if(typeof randomIndex!=="function")throw new Error("釣魚亂數來源不正確");
  return run(db,userId,"cast",requestId,now,sourceLine,null,char=>{
    if(!hasBuilding(db,char.town_id,FISHING_SYMBOL))
      throw new Error("目前所在城鎮沒有釣魚場");
    const last=db.prepare("SELECT last_cast_at FROM fishing_cooldown WHERE user_id=?").get(userId)?.last_cast_at??0;
    const readyAt=last+source.intervalSeconds*1000;
    if(now<readyAt)throw new Error("釣魚冷卻尚未結束，請再等 "+Math.ceil((readyAt-now)/1000)+" 秒");
    const all=rows(db,userId),bait=all.find(x=>x.source_line===sourceLine);
    const rule=BAIT_RULES[bait?.original_name];
    if(!rule||!(bait.category==="餌"||bait.category==="魚")||
       (bait.category==="餌"&&!source.bait.some(x=>x.name===bait.original_name))||
       (bait.category==="魚"&&!Object.hasOwn(SALE_RULES,bait.original_name)))
      throw new Error("這件本人持有物不是原版可釣魚的魚餌");
    consumeOne(db,userId,bait,now);
    // 依 sea.cgi：先抽 int(rand(3)) 的三種魚，再依餌料所屬級別判中魚機率。
    const species=randomRoll(randomIndex,3);
    const won=randomRoll(randomIndex,rule.chance)===0;
    let catchItem=null,awardLine=null,merged=false;
    if(won){
      const prize=source.catches[rule.tier][species];
      // 即使剛才魚餌已扣掉一回，也要用同筆交易重新讀取剩餘容量；
      // 漁獲加到個人背包失敗時連魚餌及冷卻都一起回滾。
      const granted=addOrMerge(db,userId,prize,now,rows(db,userId));
      catchItem=prize[1];awardLine=granted.sourceLine;merged=granted.merged;
    }
    db.prepare([
      "INSERT INTO fishing_cooldown(user_id,last_cast_at) VALUES(?,?)",
      "ON CONFLICT(user_id) DO UPDATE SET last_cast_at=excluded.last_cast_at"
    ].join(" ")).run(userId,now);
    return {action:"cast",baitName:bait.original_name,baitSourceLine:sourceLine,
      caught:won,catchName:catchItem,catchSourceLine:awardLine,merged,
      readyAt:now+source.intervalSeconds*1000};
  });
}
export function sellFishingCatch(db,userId,{sourceLine,requestId,now,randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(sourceLine)||sourceLine<1)throw new Error("漁獲行號不正確");
  if(typeof randomIndex!=="function")throw new Error("漁獲競價亂數來源不正確");
  return run(db,userId,"sell",requestId,now,sourceLine,null,char=>{
    if(!hasBuilding(db,char.town_id,FISHING_SYMBOL))
      throw new Error("目前所在城鎮沒有釣魚競價場");
    const owned=rows(db,userId).find(x=>x.source_line===sourceLine);
    const price=SALE_RULES[owned?.original_name];
    if(!owned||!(owned.category==="魚"||owned.category==="幻の魚")||
       owned.original_id!==FISHING_ITEM_ORIGIN||!price)
      throw new Error("這件物品不是本人從釣魚獲得的可出售漁獲");
    consumeOne(db,userId,owned,now);
    const paid=price.base+randomRoll(randomIndex,price.max)+1;
    if(db.prepare([
      "UPDATE characters SET money=money+? WHERE user_id=?",
      "AND money<=?"
    ].join(" ")).run(paid,userId,Number.MAX_SAFE_INTEGER-paid).changes!==1)
      throw new Error("釣魚賣出所得會使現金超過安全整數範圍");
    return {action:"sell",name:owned.original_name,sourceLine,paid};
  });
}
export function fishingOverview(db,userId,source,now,day){
  const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  if(!character)return {fishingAvailable:false,baitShopAvailable:false,
    baitGoods:[],baitOptions:[],sellOptions:[],readyAt:null,history:[]};
  const fishingAvailable=hasBuilding(db,character.town_id,FISHING_SYMBOL),
    baitShopAvailable=hasBuilding(db,character.town_id,BAIT_SHOP_SYMBOL);
  const baitGoods=baitShopAvailable?source.bait.map(item=>({
    sku:item.sku,name:item.name,price:item.price,
    durability:item.durability,unit:item.unit,
    stock:db.prepare("SELECT remaining FROM fishing_bait_stock WHERE sku=?").get(item.sku)?.remaining??0
  })):[];
  const all=rows(db,userId);
  const baitOptions=fishingAvailable?all.filter(x=>x.remaining>0&&
    (x.category==="餌"||x.category==="魚")&&
    Object.hasOwn(BAIT_RULES,x.original_name)).map(x=>({
    sourceLine:x.source_line,name:x.original_name,remaining:x.remaining
  })):[];
  const sellOptions=fishingAvailable?all.filter(x=>x.remaining>0&&
    (x.category==="魚"||x.category==="幻の魚")&&
    x.original_id===FISHING_ITEM_ORIGIN&&
    Object.hasOwn(SALE_RULES,x.original_name)).map(x=>({
    sourceLine:x.source_line,name:x.original_name,remaining:x.remaining
  })):[];
  const last=db.prepare("SELECT last_cast_at FROM fishing_cooldown WHERE user_id=?").get(userId)?.last_cast_at??0;
  const recent=db.prepare([
    "SELECT action,result_json,created_at FROM fishing_transactions",
    "WHERE user_id=? ORDER BY id DESC LIMIT 15"
  ].join(" ")).all(userId).map(x=>({action:x.action,
    ...JSON.parse(x.result_json),createdAt:x.created_at}));
  return {fishingAvailable,baitShopAvailable,baitGoods,baitOptions,sellOptions,
    readyAt:last?last+source.intervalSeconds*1000:null,history:recent};
}
