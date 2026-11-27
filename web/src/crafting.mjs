import { heldInventoryRows,inventoryLife } from "./inventory-life.mjs";
// 第54階段：依 gouseiya.cgi 與 dat_dir/gousei.cgi 移植單機合成屋。
// 配方與成品保留原版 33 欄；操作只使用本人 Web 背包，不能由前端指定成品或價格。
import {LEGACY_ITEM_FIELDS} from "./legacy-inventory.mjs";
import {initLegacyItemUseTables} from "./legacy-item-use.mjs";
import {readTownMap} from "./town-storage.mjs";

export const CRAFTING_SYMBOL="合成";
export const CRAFTING_ITEM_ORIGIN="__web_crafting__";
export const CRAFTING_SLOT_LIMIT=25;
export const CRAFTING_STACK_LIMIT=5;
const CRAFTING_LINE_START=8000000;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const MAX_BATCHES=99;

function positiveInt(text,label){
  if(!/^[1-9][0-9]*$/.test(text??""))throw new Error(label+"必須是正整數");
  const n=Number(text);
  if(!Number.isSafeInteger(n))throw new Error(label+"超出安全整數範圍");
  return n;
}
function originalFields(line,label){
  const fields=line.split("<>");
  if(fields.length===34&&fields[33]==="")fields.pop();
  if(fields.length!==LEGACY_ITEM_FIELDS.length||fields.some(value=>typeof value!=="string"||value.length>4096))
    throw new Error(label+"不是原版 33 欄商品資料");
  return fields;
}
export function parseOriginalCrafting(source){
  if(typeof source!=="string"||!source.trim())throw new Error("原版合成配方來源缺失");
  const recipes=source.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{
    const fields=originalFields(line,"合成配方第"+(index+1)+"行");
    const [name,formula,extra]=fields[1].split("=");
    if(!name||!formula||extra!==undefined)
      throw new Error("原版合成品名稱或材料格式不正確："+(index+1));
    const parts=formula.split("+");
    if(parts.length<2||parts.length>3)throw new Error("原版合成材料數量不正確："+name);
    const ingredients=parts.map((part,i)=>{
      // 原始第6筆「冷蔵庫:1:」尾端有多餘冒號；Perl split(':') 仍取到所需的 1。
      // 僅接受這個已核對的原始異常，不擴大接受其他損壞的配方。
      const normalized=name==="アイスクリーム"&&i===0&&part==="冷蔵庫:1:"?
        "冷蔵庫:1":part;
      const match=/^([^:+<>=]+):([1-9][0-9]*)$/.exec(normalized);
      if(!match)throw new Error("原版合成配方材料格式不正確："+name);
      return Object.freeze({name:match[1],quantity:positiveInt(match[2],"材料數量")});
    });
    if(new Set(ingredients.map(x=>x.name)).size!==ingredients.length)
      throw new Error("原版配方材料名稱重複，尚不能確認扣除規則："+name);
    const durability=positiveInt(fields[21],"合成成品耐久");
    if(fields[22]!=="回")throw new Error("原版合成成品不是按回數持有："+name);
    const template=[...fields];template[1]=name;
    return Object.freeze({key:"craft-"+(index+1),category:fields[0],name,
      durability,unit:"回",ingredients:Object.freeze(ingredients),
      rawFields:Object.freeze(template),
      sourceAnomaly:name==="アイスクリーム"});
  });
  if(recipes.length!==12||new Set(recipes.map(r=>r.name)).size!==recipes.length)
    throw new Error("原版合成配方數量或品名不正確（預期 12 種）");
  return Object.freeze(recipes);
}
export function initCraftingTables(db){
  initLegacyItemUseTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS crafting_transactions(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,recipe_key TEXT NOT NULL,",
    "quantity INTEGER NOT NULL,source_line INTEGER NOT NULL,",
    "result_json TEXT NOT NULL,created_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS crafting_transactions_user_idx",
    "ON crafting_transactions(user_id,id);"
  ].join(" "));
}
function rows(db,userId,now){
  return heldInventoryRows(db,userId,now).map(x=>({...x,
    web_last_used_at:x.last_used_at_ms,
    remaining:inventoryLife(x,now).remaining}));
}
function checkedFields(row){
  let fields;
  try{fields=JSON.parse(row.raw_fields_json);}catch{}
  if(!Array.isArray(fields)||fields.length!==33||
      fields.some(x=>typeof x!=="string")||
      fields[0]!==row.category||fields[1]!==row.original_name||
      fields[21]!==String(row.durability)||fields[22]!==row.durability_unit)
    throw new Error("本人合成材料／成品的原始 33 欄資料不一致");
  return fields;
}
function ingredientRows(all,name){
  return all.filter(row=>row.original_name===name&&
    row.durability_unit==="回"&&row.remaining>0&&
    Number.isSafeInteger(row.remaining)&&row.remaining<=row.durability&&
    row.category!=="ギフト商品");
}
function owned(all,name){
  return ingredientRows(all,name).reduce((total,row)=>Math.min(Number.MAX_SAFE_INTEGER,total+row.remaining),0);
}
function matchingResult(all,recipe){
  const matches=all.filter(row=>row.original_id===CRAFTING_ITEM_ORIGIN&&
    row.category===recipe.category&&row.original_name===recipe.name&&
    row.durability_unit==="回"&&row.remaining>0);
  return matches.length?matches[0]:null;
}
function availableBatches(all,recipe){
  const byIngredients=Math.min(...recipe.ingredients.map(i=>Math.floor(owned(all,i.name)/i.quantity)));
  const result=matchingResult(all,recipe);
  const active=all.filter(row=>row.remaining>0&&row.category!=="ギフト"&&row.category!=="ギフト商品");
  const outputSpace=result?
    Math.floor((CRAFTING_STACK_LIMIT*recipe.durability-result.remaining)/recipe.durability):
    active.length<CRAFTING_SLOT_LIMIT?CRAFTING_STACK_LIMIT:0;
  return Math.max(0,Math.min(MAX_BATCHES,byIngredients,outputSpace));
}
function currentTownHasCrafting(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(CRAFTING_SYMBOL);
}
function nextLine(db,userId){
  const max=db.prepare("SELECT COALESCE(MAX(source_line),0) n FROM legacy_inventory_items WHERE user_id=?").get(userId).n;
  const value=Math.max(CRAFTING_LINE_START,max+1);
  if(!Number.isSafeInteger(value))throw new Error("合成物品流水號超出安全範圍");
  return value;
}
export function craftItem(db,userId,recipes,{recipeKey,quantity,requestId,now}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
    typeof recipeKey!=="string"||
    !Number.isSafeInteger(quantity)||quantity<1||quantity>MAX_BATCHES||
    typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
    !Number.isSafeInteger(now)||now<=0)
    throw new Error("合成請求格式不正確");
  const recipe=recipes.find(x=>x.key===recipeKey);
  if(!recipe)throw new Error("不是原版合成配方");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT recipe_key,quantity,result_json FROM crafting_transactions",
      "WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.recipe_key!==recipeKey||previous.quantity!==quantity)
        throw new Error("相同合成識別碼不可更換配方或製作數量");
      const result=JSON.parse(previous.result_json);
      db.exec("COMMIT");
      return {...result,replayed:true};
    }
    const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!currentTownHasCrafting(db,character.town_id))
      throw new Error("目前所在城鎮沒有原版合成屋");
    const all=rows(db,userId,now);
    if(quantity>availableBatches(all,recipe))
      throw new Error("合成材料不足、同品超過五份或背包已達 25 格上限");
    // 確保每一份材料來自本人可核對的 33 欄 Web 持有物；同名多列可按行號依序扣除。
    for(const ingredient of recipe.ingredients){
      let need=ingredient.quantity*quantity;
      if(!Number.isSafeInteger(need))throw new Error("材料數量超出安全範圍");
      for(const row of ingredientRows(all,ingredient.name)){
        if(need===0)break;
        checkedFields(row);
        const use=Math.min(need,row.remaining);
        const left=row.remaining-use;
        db.prepare([
          "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
          "VALUES(?,?,?,?) ON CONFLICT(user_id,source_line)",
          "DO UPDATE SET remaining=excluded.remaining"
        ].join(" ")).run(userId,row.source_line,left,row.web_last_used_at??0);
        row.remaining=left;
        need-=use;
      }
      if(need!==0)throw new Error("合成材料不足");
    }
    const amount=recipe.durability*quantity;
    if(!Number.isSafeInteger(amount))throw new Error("成品耐久超出安全範圍");
    const existing=matchingResult(all,recipe);
    let sourceLine,merged=false;
    if(existing){
      const fields=checkedFields(existing),newAmount=existing.remaining+amount;
      if(!Number.isSafeInteger(newAmount)||newAmount>CRAFTING_STACK_LIMIT*recipe.durability)
        throw new Error("合成成品超過同品持有上限");
      fields[21]=String(newAmount);
      db.prepare([
        "UPDATE legacy_inventory_items SET durability=?,raw_fields_json=?",
        "WHERE user_id=? AND source_line=? AND original_id=?"
      ].join(" ")).run(newAmount,JSON.stringify(fields),userId,existing.source_line,CRAFTING_ITEM_ORIGIN);
      db.prepare([
        "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
        "VALUES(?,?,?,0) ON CONFLICT(user_id,source_line)",
        "DO UPDATE SET remaining=excluded.remaining"
      ].join(" ")).run(userId,existing.source_line,newAmount);
      sourceLine=existing.source_line;
      merged=true;
    }else{
      sourceLine=nextLine(db,userId);
      const fields=[...recipe.rawFields];
      fields[21]=String(amount);
      fields[30]=String(Math.floor(now/1000));
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,CRAFTING_ITEM_ORIGIN,sourceLine,recipe.category,
        recipe.name,fields[9],amount,"回",Math.floor(now/1000),0,JSON.stringify(fields));
    }
    const result={recipeKey,name:recipe.name,quantity,addedDurability:amount,
      sourceLine,merged,fee:0};
    db.prepare([
      "INSERT INTO crafting_transactions(user_id,request_id,recipe_key,quantity,source_line,result_json,created_at)",
      "VALUES(?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,recipeKey,quantity,sourceLine,
      JSON.stringify(result),now);
    db.exec("COMMIT");
    return {...result,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function craftingOverview(db,userId,recipes,now=Date.now()){
  const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  if(!character)return {available:false,recipes:[],history:[]};
  const available=currentTownHasCrafting(db,character.town_id);
  const all=rows(db,userId,now);
  const options=recipes.map(recipe=>({
    key:recipe.key,name:recipe.name,category:recipe.category,
    durability:recipe.durability,unit:recipe.unit,fee:0,
    sourceAnomaly:recipe.sourceAnomaly,
    ingredients:recipe.ingredients.map(i=>({...i,owned:owned(all,i.name)})),
    maxBatches:available?availableBatches(all,recipe):0
  }));
  const history=db.prepare([
    "SELECT result_json,created_at FROM crafting_transactions",
    "WHERE user_id=? ORDER BY id DESC LIMIT 20"
  ].join(" ")).all(userId).map(row=>({
    ...JSON.parse(row.result_json),createdAt:row.created_at
  }));
  return {available,recipes:options,history};
}
