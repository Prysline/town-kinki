// 原始 member/<ID>/mono.cgi 33 欄物品清單的保護性匯入。
// 原版其他道具只封存原欄位，不執行不完整的物品效果。
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { DAY_MS, initInventoryTables, insuranceCoverage } from "./inventory.mjs";

export const LEGACY_ITEM_FIELDS=Object.freeze([
  "category","name","kokugo","suugaku","rika","syakai","eigo","ongaku",
  "bijutu","effect","looks","tairyoku","kenkou","speed","power",
  "wanryoku","kyakuryoku","price","love","unique","etti","durability",
  "durability_unit","interval_minutes","stock","calories","last_used_at",
  "body_cost","brain_cost","comment","purchased_at","unit_price","sale"
]);

function nonnegative(value,label,{allowBlank=false}={}) {
  if(allowBlank&&value==="")return null;
  if(typeof value!=="string"||!/^\d+$/.test(value))
    throw new Error(label+"必須是非負整數");
  const n=Number(value);
  if(!Number.isSafeInteger(n))throw new Error(label+"超出安全整數範圍");
  return n;
}
function validId(id){
  if(typeof id!=="string"||!/^[A-Za-z0-9_-]{1,40}$/.test(id))
    throw new Error("原始角色 ID 格式不正確");
  return id;
}
function asOriginalFields(line,number){
  const fields=line.split("<>");
  if(fields.length===34&&fields[33]==="")fields.pop();
  if(fields.length!==LEGACY_ITEM_FIELDS.length)
    throw new Error("原始物品第 "+number+" 行欄位數不正確，預期 33 欄，實際 "+fields.length+" 欄");
  if(!fields[0]||!fields[1])
    throw new Error("原始物品第 "+number+" 行缺少種類或名稱");
  if(fields.some(x=>x.length>4096))
    throw new Error("原始物品第 "+number+" 行包含超長欄位");
  return fields;
}
export function parseLegacyInventory(text,{now=Date.now(),sourceHash}={}){
  if(typeof text!=="string")throw new Error("原始物品資料必須是文字");
  if(!Number.isSafeInteger(now)||now<0)throw new Error("匯入時間不正確");
  const hash=sourceHash??createHash("sha256").update(text,"utf8").digest("hex");
  if(!/^[a-f0-9]{64}$/.test(hash))throw new Error("來源摘要不正確");
  const lines=text.split(/\r?\n/);
  const rows=[];
  const warnings=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i].replace(/\r$/,"");
    if(!line.trim())continue;
    if(rows.length>=2000)throw new Error("原始物品超過 2000 筆安全上限");
    const fields=asOriginalFields(line,i+1);
    const row=Object.fromEntries(LEGACY_ITEM_FIELDS.map((name,j)=>[name,fields[j]]));
    const durability=nonnegative(row.durability,"第 "+(i+1)+" 行耐久");
    const purchasedAt=nonnegative(row.purchased_at,"第 "+(i+1)+" 行購買時間",{allowBlank:true});
    const lastUsedAt=nonnegative(row.last_used_at,"第 "+(i+1)+" 行最後使用時間",{allowBlank:true});
    const item={sourceLine:i+1,rawFields:fields,
      category:row.category,name:row.name,effect:row.effect,
      durability,durabilityUnit:row.durability_unit,
      purchasedAt,lastUsedAt};
    if(row.category==="日用品"&&row.name==="健康保険"){
      if(row.durability_unit!=="日"||purchasedAt===null||purchasedAt<=0||
          !Number.isSafeInteger(purchasedAt*1000))
        throw new Error("第 "+(i+1)+" 行健康保險缺少有效的「日」耐久與購入時間");
      if(purchasedAt*1000>now)
        throw new Error("第 "+(i+1)+" 行健康保險購入日期晚於匯入時間");
      const expires=purchasedAt*1000+durability*DAY_MS;
      if(!Number.isSafeInteger(expires))
        throw new Error("第 "+(i+1)+" 行健康保險有效期限超出安全範圍");
      item.isInsurance=true;
      item.expiresAt=expires;
      item.active=durability>0&&expires>now;
    }else{
      item.isInsurance=false;
      item.active=null; // 道具尚未移植使用規則，不能標稱已有效。
      if(row.durability_unit!=="日"&&row.durability_unit!=="回")
        warnings.push("第 "+(i+1)+" 行的耐久單位未納入目前使用系統");
    }
    rows.push(item);
  }
  const insurance=rows.filter(x=>x.isInsurance);
  if(insurance.length>1)
    throw new Error("原始存檔包含多筆健康保險，無法在不改變原始堆疊規則下自動合併");
  if(insurance.length&&insurance[0].active)
    warnings.push("有效健康保險將按照原始購入時間與剩餘耐久還原到期時間");
  if(rows.some(x=>!x.isInsurance))
    warnings.push("其他物品只保存原始 33 欄資料，尚未提供使用、出售或特殊效果");
  return {sourceHash:hash,records:rows,insurance:insurance[0]??null,warnings};
}
export function initLegacyInventoryTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS legacy_inventory_imports(",
    "original_id TEXT PRIMARY KEY,",
    "target_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,",
    "source_hash TEXT NOT NULL,",
    "source_file TEXT NOT NULL,",
    "item_count INTEGER NOT NULL,",
    "imported_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS legacy_inventory_items(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "original_id TEXT NOT NULL,",
    "source_line INTEGER NOT NULL,",
    "category TEXT NOT NULL,",
    "original_name TEXT NOT NULL,",
    "effect TEXT NOT NULL,",
    "durability INTEGER NOT NULL,",
    "durability_unit TEXT NOT NULL,",
    "purchased_at INTEGER,",
    "last_used_at INTEGER,",
    "raw_fields_json TEXT NOT NULL,",
    "UNIQUE(user_id,source_line));",
    "CREATE INDEX IF NOT EXISTS legacy_inventory_items_user_idx ON legacy_inventory_items(user_id,id);"
  ].join("\n"));
}
export function importLegacyInventory(db,parsed,{originalId,sourceFile,now=Date.now()}={}){
  validId(originalId);
  if(!Number.isSafeInteger(now)||now<0)throw new Error("匯入時間不正確");
  if(!parsed||!Array.isArray(parsed.records)||
    parsed.records.some(x=>!Array.isArray(x.rawFields)||x.rawFields.length!==33))
    throw new Error("原始物品解析結果不正確");
  if(typeof sourceFile!=="string"||!sourceFile.trim())
    throw new Error("來源檔案名稱不正確");
  // 必須先存在角色匯入對照，不允許將原始物品交給任意 Web 帳號。
  const mapping=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_character_imports'").get();
  if(!mapping)throw new Error("請先使用原版角色轉檔工具匯入對應角色");
  db.exec("BEGIN IMMEDIATE");
  try {
    // DDL 與資料改動一起處於交易內，若匯入失敗，首次新建的表也會回滾。
    initInventoryTables(db);
    initLegacyInventoryTables(db);
    const mapped=db.prepare(
      "SELECT target_user_id FROM legacy_character_imports WHERE original_id=?"
    ).get(originalId);
    if(!mapped)throw new Error("找不到相同原版 ID 的已匯入角色");
    const userId=mapped.target_user_id;
    if(!db.prepare("SELECT 1 FROM characters WHERE user_id=?").get(userId))
      throw new Error("對應的 Web 角色不存在");
    if(db.prepare(
      "SELECT 1 FROM legacy_inventory_imports WHERE original_id=? OR target_user_id=?"
    ).get(originalId,userId))
      throw new Error("此原始角色的物品資料已匯入，拒絕重複匯入");
    const insurance=parsed.insurance?.active?parsed.insurance:null;
    if(insurance&&insuranceCoverage(db,userId,now).activeUntil!==null)
      throw new Error("角色已持有有效健康保險，拒絕覆蓋或重複匯入");
    if(insurance&&db.prepare(
      "SELECT 1 FROM inventory_items WHERE user_id=? AND item_key='health-insurance'"
    ).get(userId))
      throw new Error("Web 角色已持有健康保險，拒絕覆蓋目前的購買與有效期");
    const stmt=db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
      "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" "));
    for(const item of parsed.records){
      stmt.run(userId,originalId,item.sourceLine,item.category,item.name,item.effect,
        item.durability,item.durabilityUnit,item.purchasedAt,item.lastUsedAt,
        JSON.stringify(item.rawFields));
    }
    if(insurance) {
      db.prepare([
        "INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at)",
        "VALUES(?,?,?,?)"
      ].join(" ")).run(userId,"health-insurance",insurance.expiresAt,
        insurance.purchasedAt*1000);
    }
    db.prepare([
      "INSERT INTO legacy_inventory_imports(original_id,target_user_id,source_hash,",
      "source_file,item_count,imported_at) VALUES(?,?,?,?,?,?)"
    ].join(" ")).run(originalId,userId,parsed.sourceHash,
      basename(sourceFile),parsed.records.length,now);
    db.exec("COMMIT");
    return {originalId,userId,items:parsed.records.length,
      insuranceRestored:Boolean(insurance),insuranceExpiresAt:insurance?.expiresAt??null};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
export function listLegacyInventoryItems(db,userId,limit=50,toDetails=null){
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的帳號");
  const exists=db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_inventory_items'"
  ).get();
  if(!exists)return [];
  const cap=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,100)):50;
  return db.prepare([
    "SELECT source_line,original_id,category,original_name,durability,durability_unit,purchased_at,raw_fields_json",
    "FROM legacy_inventory_items WHERE user_id=? ORDER BY",
    "CASE WHEN original_id IN ('__web_retail__','__web_gift__','__web_recycle__','__web_store__','__web_coupon__') THEN 0 ELSE 1 END,source_line LIMIT ?"
  ].join(" ")).all(userId,cap).map(x=>{
    let details=null;
    if(typeof toDetails==="function"){
      try{
        const rawFields=JSON.parse(x.raw_fields_json);
        if(Array.isArray(rawFields)&&rawFields.length===33&&
           rawFields[0]===x.category&&rawFields[1]===x.original_name)
          details=toDetails({rawFields,effect:rawFields[9],
            category:x.category,name:x.original_name,durabilityUnit:x.durability_unit});
      }catch{ /* 歷史來源欄位無法辨識時，仍顯示名稱與耐久；不虛構效果。 */ }
    }
    return {
    sourceLine:x.source_line,category:x.category,name:x.original_name,
    durability:x.durability,unit:x.durability_unit,purchasedAt:x.purchased_at,
    ...(details?{details}:{}),readOnly:!["__web_retail__","__web_gift__","__web_recycle__","__web_store__","__web_coupon__"].includes(x.original_id),
    ...(x.original_id==="__web_retail__"?{origin:"retail"}:
      x.original_id==="__web_gift__"?{origin:"gift"}:
      x.original_id==="__web_recycle__"?{origin:"recycle"}:
      x.original_id==="__web_store__"?{origin:"store"}:
      x.original_id==="__web_coupon__"?{origin:"coupon"}:{})
    };
  });
}
