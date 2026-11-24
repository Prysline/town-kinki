// 原版 hanbai.cgi：裝備屋是獨立 6 欄品項、7 欄持有資料，非百貨 33 欄商品。
const TYPES=Object.freeze(["武器","防具","魔法","御守"]);
const KIND=new Set(TYPES);
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const NONNEG=/^(0|[1-9]\d*)$/;
export const EQUIPMENT_SYMBOL="装備屋";
export const FORGE_INCREMENTS=Object.freeze([0,1,3,5,10,15,25,50]);

export function parseLegacyEquipmentCatalog(source){
  if(typeof source!=="string")throw new Error("原版裝備商品資料必須是文字");
  const list=[];
  for(const [i,line] of source.split(/\r?\n/).entries()){
    if(!line.trim())continue;
    const f=line.replace(/\r$/,"").split("<>");
    if(f.length===7&&f[6]==="")f.pop();
    if(f.length!==6)throw new Error("裝備檔第 "+(i+1)+" 行不是六個主要欄位");
    if(i===0&&f[0]==="種類")continue;
    if(!KIND.has(f[0])||!f[1]||f[1].length>100||
       ![2,3,4,5].every(j=>NONNEG.test(f[j])&&Number.isSafeInteger(Number(f[j]))))
      throw new Error("裝備檔第 "+(i+1)+" 行資料格式不正確");
    const power=Number(f[2]),accuracy=Number(f[3]),price=Number(f[4]),uses=Number(f[5]);
    if(accuracy>100||price<=0||price>Number.MAX_SAFE_INTEGER/10||
       power>1000000||uses>1000000)
      throw new Error("裝備檔第 "+(i+1)+" 行屬性超出安全範圍");
    if(list.some(x=>x.name===f[1]))throw new Error("原版裝備出現重複名稱，無法安全辨識");
    list.push(Object.freeze({sku:"equip-"+(i+1),sourceLine:i+1,
      category:f[0],name:f[1],power,accuracy,price,uses}));
  }
  if(!list.length)throw new Error("原版裝備店沒有可交易商品");
  return Object.freeze(list);
}
export function initEquipmentTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS equipment_items(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "sku TEXT NOT NULL,type TEXT NOT NULL,name TEXT NOT NULL,",
    "power INTEGER NOT NULL,accuracy INTEGER NOT NULL,uses INTEGER NOT NULL,",
    "level INTEGER NOT NULL DEFAULT 1,experience INTEGER NOT NULL DEFAULT 0,",
    "status TEXT NOT NULL CHECK(status IN ('stored','equipped','sold')),",
    "created_at INTEGER NOT NULL);",
    "CREATE UNIQUE INDEX IF NOT EXISTS equipment_owned_name_idx",
    "ON equipment_items(user_id,name) WHERE status!='sold';",
    "CREATE UNIQUE INDEX IF NOT EXISTS equipment_equipped_type_idx",
    "ON equipment_items(user_id,type) WHERE status='equipped';",
    "CREATE INDEX IF NOT EXISTS equipment_owned_user_idx ON equipment_items(user_id,status,id);",
    "CREATE TABLE IF NOT EXISTS equipment_transactions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,action TEXT NOT NULL,",
    "sku TEXT NOT NULL,item_id INTEGER NOT NULL,",
    "name TEXT NOT NULL,amount INTEGER NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));"
  ].join(" "));
}
function valid({userId,requestId,now,hasBuilding}){
  if(!Number.isSafeInteger(userId)||userId<=0||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof hasBuilding!=="function")
    throw new Error("裝備操作資料不正確");
}
export function listEquipmentItems(db,userId){
  return db.prepare([
    "SELECT id,sku,type,name,power,accuracy,uses,level,experience,status",
    "FROM equipment_items WHERE user_id=? AND status!='sold' ORDER BY type,status,id"
  ].join(" ")).all(userId).map(row=>({
    id:row.id,sku:row.sku,category:row.type,name:row.name,
    power:row.power,accuracy:row.accuracy,uses:row.uses,level:row.level,
    experience:row.experience,status:row.status
  }));
}
export function listEquipmentTransactions(db,userId,limit=20){
  return db.prepare([
    "SELECT action,sku,name,amount,created_at FROM equipment_transactions",
    "WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,Math.max(1,Math.min(Number.isSafeInteger(limit)?limit:20,50)))
    .map(row=>({action:row.action,sku:row.sku,name:row.name,
      amount:row.amount,createdAt:row.created_at}));
}
function transact(db,userId,requestId,now,hasBuilding,action,sku,work){
  valid({userId,requestId,now,hasBuilding});
  if(typeof sku!=="string"||!sku||sku.length>100)
    throw new Error("裝備操作缺少有效商品");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT action,sku,item_id,name,amount FROM equipment_transactions",
      "WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.action!==action||previous.sku!==sku)
        throw new Error("裝備請求編號已用於其他商品或操作");
      db.exec("COMMIT");
      return {action,sku,name:previous.name,itemId:previous.item_id,
        amount:previous.amount,replayed:true};
    }
    const character=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    const result=work(character);
    db.prepare([
      "INSERT INTO equipment_transactions(user_id,request_id,action,sku,item_id,name,amount,created_at)",
      "VALUES(?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,action,sku,result.itemId,result.name,result.amount,now);
    db.exec("COMMIT");
    return {action,sku,...result,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function buyEquipment(db,userId,catalog,{sku,requestId,now,hasBuilding}={}){
  const item=catalog.find(x=>x.sku===sku);
  if(!item)throw new Error("原版裝備屋沒有這項商品");
  return transact(db,userId,requestId,now,hasBuilding,"buy",sku,character=>{
    if(!hasBuilding(EQUIPMENT_SYMBOL,character.town_id))
      throw new Error("目前所在城鎮沒有裝備屋");
    // 原始 hanbai.cgi::buy 判斷 money <= price 為不足，保留相等時拒購。
    if(character.money<=item.price)throw new Error("裝備屋現金必須大於商品售價");
    const owned=db.prepare([
      "SELECT id FROM equipment_items WHERE user_id=? AND name=? AND status!='sold'"
    ].join(" ")).get(userId,item.name);
    if(owned)throw new Error("已持有或裝備同名商品，不能重複購買");
    if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>?")
      .run(item.price,userId,item.price).changes!==1)throw new Error("現金不足");
    const inserted=db.prepare([
      "INSERT INTO equipment_items(user_id,sku,type,name,power,accuracy,uses,level,experience,status,created_at)",
      "VALUES(?,?,?,?,?,?,?,1,0,'stored',?)"
    ].join(" ")).run(userId,sku,item.category,item.name,item.power,item.accuracy,item.uses,now);
    return {name:item.name,itemId:Number(inserted.lastInsertRowid),amount:-item.price};
  });
}
export function equipEquipment(db,userId,{itemId,requestId,now,hasBuilding}={}){
  if(!Number.isSafeInteger(itemId)||itemId<=0)throw new Error("裝備編號不正確");
  const sku="item-"+itemId;
  return transact(db,userId,requestId,now,hasBuilding,"equip",sku,character=>{
    if(!hasBuilding(EQUIPMENT_SYMBOL,character.town_id))
      throw new Error("目前所在城鎮沒有裝備屋");
    const selected=db.prepare("SELECT * FROM equipment_items WHERE user_id=? AND id=?").get(userId,itemId);
    if(!selected||selected.status!=="stored")throw new Error("找不到本人倉庫內可裝備的道具");
    if(selected.uses<=0)throw new Error("裝備已損壞，請先鍛造恢復使用次數");
    // 原始 soubi_do：同一類別僅有一個正在使用，換裝時舊裝備回倉庫。
    db.prepare([
      "UPDATE equipment_items SET status='stored'",
      "WHERE user_id=? AND type=? AND status='equipped'"
    ].join(" ")).run(userId,selected.type);
    db.prepare("UPDATE equipment_items SET status='equipped' WHERE id=? AND user_id=?")
      .run(itemId,userId);
    return {name:selected.name,itemId,amount:0};
  });
}
export function sellEquipment(db,userId,catalog,{itemId,requestId,now,hasBuilding}={}){
  if(!Number.isSafeInteger(itemId)||itemId<=0)throw new Error("裝備編號不正確");
  const sku="item-"+itemId;
  return transact(db,userId,requestId,now,hasBuilding,"sell",sku,character=>{
    if(!hasBuilding(EQUIPMENT_SYMBOL,character.town_id))
      throw new Error("目前所在城鎮沒有裝備屋");
    const selected=db.prepare("SELECT * FROM equipment_items WHERE user_id=? AND id=?").get(userId,itemId);
    if(!selected||selected.status!=="stored")throw new Error("只能出售本人裝備倉庫內的物品");
    const original=catalog.find(x=>x.sku===selected.sku);
    if(!original||original.name!==selected.name||original.category!==selected.type)
      throw new Error("無法從原版目錄確認裝備售價");
    // 原版售價 = 原價/10 * 裝備等級；Web 現金以整數存放，捨去小數。
    const credit=Math.floor(original.price*selected.level/10);
    if(!Number.isSafeInteger(credit)||credit<0||
       !Number.isSafeInteger(character.money+credit))
      throw new Error("裝備回收金額超出安全範圍");
    db.prepare("UPDATE equipment_items SET status='sold' WHERE id=? AND user_id=?")
      .run(itemId,userId);
    db.prepare("UPDATE characters SET money=money+? WHERE user_id=?").run(credit,userId);
    return {name:selected.name,itemId,amount:credit};
  });
}

export function forgeEquipment(db,userId,{
  itemId,powerUp=0,usesUp=0,requestId,now,hasBuilding
}={}){
  if(!Number.isSafeInteger(itemId)||itemId<=0||
     !FORGE_INCREMENTS.includes(powerUp)||!FORGE_INCREMENTS.includes(usesUp)||
     (powerUp===0&&usesUp===0))
    throw new Error("鍛造只能選原版威力／耐久增量，至少一項須大於 0");
  // 強化數值構成交易簽章，同一請求不能在重試時改造不同的強化內容。
  const sku="item-"+itemId+"-power-"+powerUp+"-uses-"+usesUp;
  return transact(db,userId,requestId,now,hasBuilding,"forge",sku,character=>{
    if(!hasBuilding(EQUIPMENT_SYMBOL,character.town_id))
      throw new Error("目前所在城鎮沒有裝備屋");
    const selected=db.prepare("SELECT * FROM equipment_items WHERE user_id=? AND id=?")
      .get(userId,itemId);
    if(!selected||selected.status==="sold")
      throw new Error("找不到本人持有或已穿戴的可鍛造裝備");
    const cost=powerUp*10000+usesUp*1000;
    if(!Number.isSafeInteger(cost)||character.money<cost)
      throw new Error("鍛造現金不足");
    if(!Number.isSafeInteger(selected.power+powerUp)||
       !Number.isSafeInteger(selected.uses+usesUp)||
       selected.power+powerUp>1000000||selected.uses+usesUp>1000000)
      throw new Error("鍛造後裝備屬性超出安全範圍");
    if(db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(cost,userId,cost).changes!==1)throw new Error("鍛造現金不足");
    if(db.prepare([
      "UPDATE equipment_items SET power=power+?,uses=uses+?",
      "WHERE user_id=? AND id=? AND status!='sold'"
    ].join(" ")).run(powerUp,usesUp,userId,itemId).changes!==1)
      throw new Error("裝備已不存在，鍛造取消");
    return {name:selected.name,itemId,amount:-cost,powerUp,usesUp};
  });
}
