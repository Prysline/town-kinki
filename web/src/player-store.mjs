// original_house.cgi::omise/my_syouhin 與 command.pl::buy_syouhin 的住宅商店零售。
// 本人問屋倉庫 -> 顧客原版 33 欄持有物；現金/有效信用卡、店主銀行、同城回饋。
import {recordBankEntry} from "./banking.mjs";
import {requireClassroomCreditCard} from "./legacy-credit.mjs";
import {insuranceCoverage,DAY_MS} from "./inventory.mjs";
import {getRoomSlots,roomCapacity} from "./rooms.mjs";
import {defaultStorePrice,storePriceRange} from "./wholesale.mjs";

export const PLAYER_STORE_ORIGIN="__web_store__";
export const PLAYER_STORE_MAX_QUANTITY=5;
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;
const MAX=Number.MAX_SAFE_INTEGER;
function priceFor(row,category){
  const minMax=storePriceRange(row.unit_price,category);
  const price=row.sale_price??defaultStorePrice(row.unit_price,category);
  if(!Number.isSafeInteger(price)||price<minMax.min||price>minMax.max)
    throw new Error("玩家商店販售價格超出原版上下限");
  return {price,...minMax};
}
function requireStore(db,buyerId,houseId){
  if(!Number.isSafeInteger(houseId)||houseId<1)throw new Error("無效的住宅商店編號");
  const visitor=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(buyerId);
  if(!visitor)throw new Error("請先建立角色");
  const store=db.prepare([
    "SELECT h.id AS house_id,h.town_id,h.interior_rank,h.owner_user_id,",
    "s.category,s.title,owner.name AS owner_name",
    "FROM houses h JOIN player_shops s ON s.house_id=h.id",
    "JOIN characters owner ON owner.user_id=h.owner_user_id WHERE h.id=?"
  ].join(" ")).get(houseId);
  if(!store)throw new Error("這間住宅尚未開設玩家商店");
  if(visitor.town_id!==store.town_id)
    throw new Error("需要先前往玩家商店所在的城鎮");
  const open=getRoomSlots(db,store.owner_user_id)
    .slice(0,roomCapacity(store.interior_rank)).some(x=>x.type==="1");
  if(!open)throw new Error("住宅未公開玩家商店內容");
  return store;
}
function remaining(row,now){
  if(row.durability_unit==="日"){
    if(!Number.isSafeInteger(row.purchased_at)||row.purchased_at<=0)return 0;
    return Math.max(0,row.durability-Math.max(0,
      Math.floor((Math.floor(now/1000)-row.purchased_at)/86400)));
  }
  return Math.max(0,row.web_remaining??row.durability);
}
function categoryOf(fields){
  if(fields[9].includes("ギフト"))return "ギフト";
  if(fields[9].includes("食料品"))return "食料品";
  if(fields[9].includes("ファ"))return "ファーストフード";
  return fields[0];
}
function activeRows(db,userId,now){
  return db.prepare([
    "SELECT i.*,u.remaining AS web_remaining",
    "FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u",
    "ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=?"
  ].join(" ")).all(userId).map(x=>({...x,remaining:remaining(x,now)}))
    .filter(x=>x.remaining>0);
}
function nextSourceLine(db,userId){
  const existing=db.prepare([
    "SELECT COALESCE(MAX(source_line),0) AS n FROM legacy_inventory_items",
    "WHERE user_id=?"
  ].join(" ")).get(userId).n;
  const n=Math.max(5000000,existing+1);
  if(!Number.isSafeInteger(n))throw new Error("個人持有物來源行號超出範圍");
  return n;
}
function assertRaw(item){
  let fields;try{fields=JSON.parse(item.raw_fields_json);}catch{}
  if(!Array.isArray(fields)||fields.length!==33||fields.some(x=>typeof x!=="string")||
     fields[0]!==item.category||fields[1]!==item.name||
     !/^(0|[1-9][0-9]*)$/.test(fields[21])||
     fields[22]!=="回"&&fields[22]!=="日"||
     Number(fields[24])!==item.quantity)
    throw new Error("玩家店鋪庫存的原版商品欄位不一致");
  return fields;
}
export function initPlayerStoreTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS player_shop_sales(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "seller_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "house_id INTEGER NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,",
    "quantity INTEGER NOT NULL,paid INTEGER NOT NULL,payment TEXT NOT NULL,",
    "card_source_line INTEGER,source_line INTEGER NOT NULL,cashback INTEGER NOT NULL,",
    "request_id TEXT NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(buyer_user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS player_shop_sales_owner_idx",
    "ON player_shop_sales(seller_user_id,id);"
  ].join(" "));
}
export function viewPlayerStore(db,buyerId,houseId){
  // 屋主先啟用住宅 type 1 並設定分類；此函式不暴露完整店鋪 raw_fields_json。
  const store=requireStore(db,buyerId,houseId);
  const rows=db.prepare([
    "SELECT sku,category,name,unit_price,quantity,sale_price",
    "FROM player_shop_stock WHERE house_id=? ORDER BY category,name LIMIT 100"
  ].join(" ")).all(houseId);
  return {
    houseId,owner:buyerId===store.owner_user_id,ownerName:store.owner_name,
    title:store.title,category:store.category,
    items:rows.map(item=>({
      sku:item.sku,name:item.name,category:item.category,stock:item.quantity,
      basePrice:item.unit_price,...priceFor(item,store.category),
      customPrice:item.sale_price!==null
    }))
  };
}
export function setPlayerStorePrice(db,userId,{
  houseId,sku,price
}={}){
  if(typeof sku!=="string"||!sku||sku.length>100||
    !Number.isSafeInteger(price)||price<=0)
    throw new Error("請輸入有效的原版商品售價");
  db.exec("BEGIN IMMEDIATE");
  try{
    const store=requireStore(db,userId,houseId);
    if(store.owner_user_id!==userId)throw new Error("只有店主可設定商品售價");
    const item=db.prepare([
      "SELECT unit_price,quantity FROM player_shop_stock",
      "WHERE house_id=? AND sku=?"
    ].join(" ")).get(houseId,sku);
    if(!item)throw new Error("商店倉庫沒有這件可定價的商品");
    const {min,max}=storePriceRange(item.unit_price,store.category);
    if(price<min||price>max)
      throw new Error("原版售價需在進貨原價的十分之一至三倍之間");
    db.prepare("UPDATE player_shop_stock SET sale_price=? WHERE house_id=? AND sku=?")
      .run(price,houseId,sku);
    db.exec("COMMIT");
    return {houseId,sku,price,min,max};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function listPlayerShopSales(db,userId,limit=25){
  if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("玩家編號不正確");
  return db.prepare([
    "SELECT buyer_user_id,seller_user_id,house_id,sku,name,quantity,paid,payment,",
    "source_line,cashback,created_at FROM player_shop_sales",
    "WHERE buyer_user_id=? OR seller_user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,userId,Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:25,50)))
    .map(x=>({
      houseId:x.house_id,sku:x.sku,name:x.name,quantity:x.quantity,paid:x.paid,
      payment:x.payment,sourceLine:x.source_line,cashback:x.cashback,
      role:x.buyer_user_id===userId?"buyer":"seller",createdAt:x.created_at
    }));
}
export function buyPlayerStore(db,userId,{
  houseId,sku,quantity=1,payment="cash",cardSourceLine,requestId,now
}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !Number.isSafeInteger(houseId)||houseId<1||
     typeof sku!=="string"||!sku||sku.length>100||
     !Number.isSafeInteger(quantity)||quantity<1||quantity>PLAYER_STORE_MAX_QUANTITY||
     !["cash","bank"].includes(payment)||
     (payment==="bank"&&(!Number.isSafeInteger(cardSourceLine)||cardSourceLine<1))||
     (payment==="cash"&&cardSourceLine!==undefined)||
     typeof requestId!=="string"||!REQUEST.test(requestId)||
     !Number.isSafeInteger(now)||now<=0)
    throw new Error("玩家商店購物格式不正確（每次 1～5 件）");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prev=db.prepare([
      "SELECT * FROM player_shop_sales WHERE buyer_user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(prev){
      if(prev.house_id!==houseId||prev.sku!==sku||prev.quantity!==quantity||
         prev.payment!==payment||
         (prev.card_source_line??null)!==(cardSourceLine??null))
        throw new Error("購物識別碼已被用於不同商店、商品或付款方式");
      db.exec("COMMIT");
      return {houseId,sku,name:prev.name,quantity,paid:prev.paid,
        payment,cashback:prev.cashback,sourceLine:prev.source_line,replayed:true};
    }
    const store=requireStore(db,userId,houseId);
    const stock=db.prepare("SELECT * FROM player_shop_stock WHERE house_id=? AND sku=?")
      .get(houseId,sku);
    if(!stock||stock.quantity<quantity)
      throw new Error("店鋪沒有上架這項商品或庫存不足");
    const fields=assertRaw(stock);
    const unitPrice=priceFor(stock,store.category).price;
    const total=BigInt(unitPrice)*BigInt(quantity);
    const perUnit=Number(fields[21]);
    const added=BigInt(perUnit)*BigInt(quantity);
    if(total>BigInt(MAX)||added>BigInt(1000000)||perUnit<=0)
      throw new Error("購買總額或耐久超出安全範圍");
    const cost=Number(total),durability=Number(added);
    const category=categoryOf(fields),gift=category==="ギフト";
    const buyer=db.prepare("SELECT money,bank,town_id FROM characters WHERE user_id=?")
      .get(userId);
    if(payment==="cash"){
      if(buyer.money<cost)throw new Error("現金不足");
    }else{
      requireClassroomCreditCard(db,userId,cardSourceLine,now);
      if(buyer.bank<cost)throw new Error("普通銀行存款不足");
    }
    const ownerPurchase=userId===store.owner_user_id;
    const homeTown=!ownerPurchase&&Boolean(db.prepare([
      "SELECT 1 FROM houses WHERE owner_user_id=? AND town_id=? LIMIT 1"
    ].join(" ")).get(userId,store.town_id));
    const cashback=homeTown?Math.floor(cost/10):0;
    const netCost=cost-cashback;
    if(!Number.isSafeInteger(buyer.money+(payment==="bank"?cashback:-cost+cashback)))
      throw new Error("同城回饋會讓現金超出安全範圍");
    // 原版可合併同名非禮品；Web 只會修改自身新增的購物行，舊 CGI 匯入始終唯讀。
    const owned=activeRows(db,userId,now);
    let existing=null;
    if(!gift){
      const matches=owned.filter(x=>x.original_id===PLAYER_STORE_ORIGIN&&
        x.original_name===fields[1]&&x.category===category&&
        x.effect===fields[9]&&x.durability_unit===fields[22]);
      if(matches.length){
        existing=matches.find(x=>
          Number.isSafeInteger(x.remaining+durability)&&
          x.remaining+durability<=perUnit*PLAYER_STORE_MAX_QUANTITY)??null;
        if(!existing)throw new Error("相同商品已達五份持有上限");
      }
    }
    if(gift){
      if(owned.filter(x=>x.category==="ギフト").length>=10)
        throw new Error("未寄送禮品已達 10 格持有上限");
    }else if(!existing&&
      owned.filter(x=>!["ギフト","ギフト商品"].includes(x.category)).length>=25)
      throw new Error("一般持有物已達 25 格上限");
    const insurance=category==="日用品"&&fields[1]==="健康保険"&&
      fields[9]==="無"&&fields[22]==="日";
    let insuranceUntil=null;
    if(insurance){
      const remainingMs=insuranceCoverage(db,userId,now).remainingMs;
      const extension=durability*DAY_MS;
      insuranceUntil=now+remainingMs+extension;
      if(![remainingMs,extension,insuranceUntil].every(Number.isSafeInteger)||
        remainingMs+extension>perUnit*PLAYER_STORE_MAX_QUANTITY*DAY_MS)
        throw new Error("健康保險有效耐久不得超過 5 份");
    }
    // 原表 quantity CHECK > 0；售罄要直接刪除，而非先更新成 0。
    const changed=quantity===stock.quantity?
      db.prepare("DELETE FROM player_shop_stock WHERE house_id=? AND sku=? AND quantity=?")
        .run(houseId,sku,quantity).changes:
      db.prepare([
        "UPDATE player_shop_stock SET quantity=quantity-?,raw_fields_json=?",
        "WHERE house_id=? AND sku=? AND quantity>=?"
      ].join(" ")).run(quantity,JSON.stringify(
        fields.map((value,index)=>index===24?String(stock.quantity-quantity):value)
      ),houseId,sku,quantity).changes;
    if(changed!==1)throw new Error("店鋪商品已售完");
    if(payment==="cash"){
      if(db.prepare([
        "UPDATE characters SET money=money-?+? WHERE user_id=? AND money>=?"
      ].join(" ")).run(cost,cashback,userId,cost).changes!==1)
        throw new Error("現金不足");
    }else{
      if(db.prepare("UPDATE characters SET bank=bank-? WHERE user_id=? AND bank>=?")
        .run(cost,userId,cost).changes!==1)throw new Error("普通銀行存款不足");
      if(cashback)db.prepare("UPDATE characters SET money=money+? WHERE user_id=?")
        .run(cashback,userId);
      recordBankEntry(db,userId,"ordinary",("玩家商店信用付款："+fields[1]).slice(0,50),
        cost,0,buyer.bank-cost,now);
    }
    if(!ownerPurchase){
      const owner=db.prepare("SELECT bank FROM characters WHERE user_id=?")
        .get(store.owner_user_id);
      if(!owner||!Number.isSafeInteger(owner.bank+cost))
        throw new Error("店主普通銀行存款金額超出安全範圍");
      db.prepare("UPDATE characters SET bank=bank+? WHERE user_id=?")
        .run(cost,store.owner_user_id);
      recordBankEntry(db,store.owner_user_id,"ordinary",
        ("店鋪出售："+fields[1]).slice(0,50),0,cost,owner.bank+cost,now);
    }
    const secs=Math.floor(now/1000);
    let sourceLine;
    if(existing){
      let old;try{old=JSON.parse(existing.raw_fields_json);}catch{}
      if(!Array.isArray(old)||old.length!==33||old[0]!==existing.category||
         old[1]!==existing.original_name||old[21]!==String(existing.durability))
        throw new Error("已持有商品的原版欄位不一致，無法累加");
      const next=existing.remaining+durability;
      const oldTanka=/^(0|[1-9][0-9]*)$/.test(old[31])?BigInt(old[31]):0n;
      const weighted=(oldTanka*BigInt(existing.remaining)+BigInt(netCost))/BigInt(next);
      if(weighted>BigInt(MAX))throw new Error("商品耐久單價超出整數上限");
      old[21]=String(next);old[31]=String(weighted);
      const newAt=fields[22]==="日"?secs:existing.purchased_at;
      if(fields[22]==="日")old[30]=String(secs);
      db.prepare([
        "UPDATE legacy_inventory_items SET durability=?,purchased_at=?,raw_fields_json=?",
        "WHERE user_id=? AND source_line=? AND original_id=?"
      ].join(" ")).run(next,newAt,JSON.stringify(old),userId,existing.source_line,PLAYER_STORE_ORIGIN);
      if(fields[22]==="回")db.prepare([
        "UPDATE legacy_item_usage SET remaining=? WHERE user_id=? AND source_line=?"
      ].join(" ")).run(next,userId,existing.source_line);
      sourceLine=existing.source_line;
    }else{
      sourceLine=nextSourceLine(db,userId);
      const ownedFields=[...fields];
      ownedFields[0]=category;ownedFields[21]=String(durability);
      ownedFields[24]="0";ownedFields[30]=String(secs);
      ownedFields[31]=String(Math.floor(netCost/durability));
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
        "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,PLAYER_STORE_ORIGIN,sourceLine,category,
        ownedFields[1],ownedFields[9],durability,ownedFields[22],
        secs,0,JSON.stringify(ownedFields));
    }
    if(insurance)db.prepare([
      "INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at)",
      "VALUES(?,'health-insurance',?,?) ON CONFLICT(user_id,item_key) DO UPDATE SET",
      "active_until=excluded.active_until,last_purchased_at=excluded.last_purchased_at"
    ].join(" ")).run(userId,insuranceUntil,now);
    db.prepare([
      "INSERT INTO player_shop_sales(buyer_user_id,seller_user_id,house_id,sku,name,",
      "quantity,paid,payment,card_source_line,source_line,cashback,request_id,created_at)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,store.owner_user_id,houseId,sku,fields[1],
      quantity,cost,payment,payment==="bank"?cardSourceLine:null,sourceLine,
      cashback,requestId,now);
    db.exec("COMMIT");
    return {houseId,sku,name:fields[1],quantity,paid:cost,payment,
      cashback,sourceLine,merged:Boolean(existing),replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
