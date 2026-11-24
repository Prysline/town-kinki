// B league server-side atomic settlement, using the existing character, equipment and 33-field inventory tables.
import {randomInt} from "node:crypto";
import {recoverEnergy} from "./engine.mjs";
import {settleBankInterestInTransaction,refreshBankTaxSnapshot} from "./banking.mjs";
import {heldInventoryRows} from "./inventory-life.mjs";
import {initLegacyItemUseTables} from "./legacy-item-use.mjs";
import {initEquipmentTables} from "./equipment.mjs";
import {ARENA_SYMBOL,ARENA_RANKS,DEFAULT_NAMES,DROP_NAMES,defaultGear,rollArena} from "./b-league-core.mjs";
export {ARENA_SYMBOL};
export const ARENA_ORIGIN="__web_b_league__";
export const ARENA_COOLDOWN_MS=5000;
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;

// Preserve source records including the intentionally empty durability unit.
// battle.cgi::otosi_item overrides purchase date, leaves unit price blank.
export function parseArenaDrops(source){
  const block=source.slice(source.indexOf("sub otosi_item {"));
  const records=[...block.matchAll(/'(MB<>[^']+)'/g)].map(m=>{
    const fields=m[1].replace(/\\n$/,"").split("<>");
    if(fields.length===34&&fields[33]==="")fields.pop();
    if(fields.length!==33||fields[0]!=="MB"||fields[21]!=="1"||fields[22]!=="")
      throw new Error("原版鬥技場獎品資料格式錯誤");
    return Object.freeze(fields);
  });
  if(records.length!==5||DROP_NAMES.some((name,i)=>records[i][1]!==name)||records[4][1]!=="ドラゴンの角")
    throw new Error("原版鬥技場獎品來源不符");
  return Object.freeze(records.slice(0,4));
}
export function initArenaTables(db){
  initLegacyItemUseTables(db);
  initEquipmentTables(db);
  db.exec(`CREATE TABLE IF NOT EXISTS b_league_battles(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, rank TEXT NOT NULL, created_at INTEGER NOT NULL,
    result_json TEXT NOT NULL, UNIQUE(user_id,request_id));
    CREATE INDEX IF NOT EXISTS b_league_user_idx ON b_league_battles(user_id,id);
    CREATE TABLE IF NOT EXISTS b_league_default_gear(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, power INTEGER NOT NULL, accuracy INTEGER NOT NULL,
    level INTEGER NOT NULL, experience INTEGER NOT NULL, PRIMARY KEY(user_id,type));`);
}
function readDefaults(db,userId){
  return Object.fromEntries(db.prepare("SELECT type,power,accuracy,level,experience FROM b_league_default_gear WHERE user_id=?").all(userId)
    .map(row=>[row.type,{...defaultGear(row.type),...row}]));
}
export function arenaOverview(db,userId,now,available){
  const rows=db.prepare("SELECT id,created_at,result_json FROM b_league_battles WHERE user_id=? ORDER BY id DESC LIMIT 10").all(userId);
  return {available:Boolean(available),ranks:ARENA_RANKS,
    readyAt:rows.length?rows[0].created_at+ARENA_COOLDOWN_MS:0,
    latest:rows.length?JSON.parse(rows[0].result_json):null,
    history:rows.map(row=>{const x=JSON.parse(row.result_json);return {id:row.id,createdAt:row.created_at,rank:x.monster.rank,name:x.monster.name,outcome:x.outcome,moneyDelta:x.moneyDelta,kpointDelta:x.kpointDelta};}),
    defaults:Object.keys(DEFAULT_NAMES).map(type=>readDefaults(db,userId)[type]??defaultGear(type))};
}
function grantDrop(db,userId,fields,now){
  const rows=heldInventoryRows(db,userId,now);
  // CGI counts raw mono.cgi entries before merging, including unequipped gear.
  // Web excludes already expired/removed rows; no private CGI file is accessed.
  const stored=db.prepare("SELECT COUNT(*) n FROM equipment_items WHERE user_id=? AND status='stored'").get(userId).n;
  if(rows.length+stored>=25)return {name:fields[1],granted:false,reason:"inventory-full"};
  const existing=rows.find(row=>row.category==="MB"&&row.original_name===fields[1]&&row.original_id===ARENA_ORIGIN);
  if(existing){
    const raw=JSON.parse(existing.raw_fields_json);
    if(raw.length!==33||raw[0]!==fields[0]||raw[1]!==fields[1]||raw[22]!==""||raw[21]!==String(existing.durability)||
      fields.some((v,i)=>![21,26,30,31,32].includes(i)&&raw[i]!==v))
      throw new Error("既有鬥技場獎品來源不符");
    const amount=(existing.web_remaining??existing.durability)+1;
    if(!Number.isSafeInteger(amount)||amount>1000000)throw new Error("獎品耐久超出安全範圍");
    raw[21]=String(amount);
    db.prepare("UPDATE legacy_inventory_items SET durability=?,raw_fields_json=? WHERE user_id=? AND source_line=? AND original_id=?")
      .run(amount,JSON.stringify(raw),userId,existing.source_line,ARENA_ORIGIN);
    db.prepare("UPDATE legacy_item_usage SET remaining=? WHERE user_id=? AND source_line=?").run(amount,userId,existing.source_line);
    return {name:fields[1],granted:true,merged:true,sourceLine:existing.source_line};
  }
  // Do not modify or merge a historical imported record.
  const line=Math.max(9_000_000,db.prepare("SELECT COALESCE(MAX(source_line),0) n FROM legacy_inventory_items WHERE user_id=?").get(userId).n+1);
  if(!Number.isSafeInteger(line))throw new Error("獎品行號超出範圍");
  const raw=[...fields];raw[30]=String(Math.floor(now/1000));
  db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId,ARENA_ORIGIN,line,raw[0],raw[1],raw[9],1,raw[22],Number(raw[30]),0,JSON.stringify(raw));
  return {name:fields[1],granted:true,merged:false,sourceLine:line};
}
export function playArena(db,userId,catalog,drops,{rank,requestId,now,today,hasBuilding,rng=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||!ARENA_RANKS.includes(rank)||typeof requestId!=="string"||!REQUEST.test(requestId)||
    !Number.isSafeInteger(now)||now<=0||typeof hasBuilding!=="function")throw new Error("鬥技場請求格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prev=db.prepare("SELECT rank,result_json FROM b_league_battles WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(prev){
      if(prev.rank!==rank)throw new Error("相同戰鬥請求不可變更難度");
      const result=JSON.parse(prev.result_json);
      db.exec("COMMIT");return {...result,replayed:true};
    }
    // 正式 HTTP 提供遊戲日期；銀行計息與資產檢查和戰鬥同一交易。獨立核心測試可不帶日期。
    if(today!==undefined)settleBankInterestInTransaction(db,userId,today,now);
    const row=db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId);
    if(!row)throw new Error("請先建立角色");
    if(!hasBuilding(ARENA_SYMBOL,row.town_id))throw new Error("目前城鎮沒有 B 聯賽鬥技場");
    const last=db.prepare("SELECT MAX(created_at) last FROM b_league_battles WHERE user_id=?").get(userId).last;
    if(last!=null&&now-last<ARENA_COOLDOWN_MS)throw new Error("鬥技場行動間隔未結束");
    const stats=JSON.parse(row.stats_json);
    const recovered=recoverEnergy({stats,bodyEnergy:row.body_energy,brainEnergy:row.brain_energy,recoveredAt:row.recovered_at},now);
    const equipped=db.prepare("SELECT id,type,name,power,accuracy,uses,level,experience FROM equipment_items WHERE user_id=? AND status='equipped'").all(userId);
    // A default set is replaced when real gear is equipped, as in hanbai.cgi.
    const defaults=readDefaults(db,userId);
    for(const g of equipped)defaults[g.type]=defaultGear(g.type);
    const result=rollArena(catalog,rank,{bodyEnergy:recovered.bodyEnergy,brainEnergy:recovered.brainEnergy,
      speed:stats.speed,money:row.money,kpoint:row.kpoint},{equipped,defaults,rng});
    for(const g of result.changedGear){
      const changed=db.prepare("UPDATE equipment_items SET power=?,accuracy=?,uses=?,level=?,experience=?,status=? WHERE id=? AND user_id=? AND status='equipped'")
        .run(g.power,g.accuracy,g.uses,g.level,g.experience,g.broken?"stored":"equipped",g.id,userId);
      if(changed.changes!==1)throw new Error("戰鬥裝備已變更");
    }
    for(const g of Object.values(result.defaults)){
      db.prepare("INSERT INTO b_league_default_gear(user_id,type,power,accuracy,level,experience) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,type) DO UPDATE SET power=excluded.power,accuracy=excluded.accuracy,level=excluded.level,experience=excluded.experience")
        .run(userId,g.type,g.power,g.accuracy,g.level,g.experience);
    }
    const reward=result.drop==null?null:grantDrop(db,userId,drops[result.drop],now);
    const p=result.player;
    db.prepare("UPDATE characters SET body_energy=?,brain_energy=?,money=?,kpoint=?,recovered_at=? WHERE user_id=?")
      .run(p.bodyEnergy,p.brainEnergy,p.money,p.kpoint,now,userId);
    if(today!==undefined)refreshBankTaxSnapshot(db,userId,today);
    const receipt={...result,reward,createdAt:now};
    db.prepare("INSERT INTO b_league_battles(user_id,request_id,rank,created_at,result_json) VALUES(?,?,?,?,?)")
      .run(userId,requestId,rank,now,JSON.stringify(receipt));
    db.exec("COMMIT");return {...receipt,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
