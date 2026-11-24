// Osaka NPC challenge: server-owned combat and atomic SQLite settlement.
import {randomInt} from "node:crypto";
import {recoverEnergy} from "./engine.mjs";
import {readTownMap} from "./town-storage.mjs";
import {describeTile} from "./town-map.mjs";
import {heldInventoryRows} from "./inventory-life.mjs";
import {initLegacyItemUseTables} from "./legacy-item-use.mjs";
import {OSAKA_MODES,rollOsaka} from "./osaka-challenge-core.mjs";

export const OSAKA_COOLDOWN_MS=5000;
export const OSAKA_SYMBOLS=Object.freeze({week:"おばちゃん",strong:"おばちゃん強"});
const ORIGIN="__web_osaka__";
const QUARANTINE="__web_osaka_quarantine__";
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;
export function initOsakaTables(db){
  initLegacyItemUseTables(db);
  db.exec(`CREATE TABLE IF NOT EXISTS osaka_battles(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('week','strong')),
    played_at INTEGER NOT NULL, result_json TEXT NOT NULL,
    UNIQUE(user_id,request_id));
    CREATE INDEX IF NOT EXISTS osaka_battles_user_idx ON osaka_battles(user_id,id);`);
}
function entrances(db,townId){
  const map=readTownMap(db,townId);
  const keys=map.configured?map.tiles.map(x=>describeTile(x).key):[];
  const arcade=keys.includes("ゲーセン");
  return Object.fromEntries(OSAKA_MODES.map(mode=>[mode,arcade||keys.includes(OSAKA_SYMBOLS[mode])]));
}
function findTemplate(rules,row,raw){
  return OSAKA_MODES.flatMap(mode=>rules[mode].prizes).find(p=>p.usableShape&&
    p.name===row.original_name&&p.rawFields.every((v,i)=>[21,26,30].includes(i)||raw[i]===v));
}
// Upgrade old draft-only quarantined awards using immutable per-battle receipts.
 // Never infer the weak/strong mix from the count alone or rewrite old receipts.
export function migrateOsakaPowerPrizes(db,rules){
  const rows=db.prepare("SELECT * FROM legacy_inventory_items WHERE original_id=? ORDER BY user_id,source_line").all(QUARANTINE);
  const result={migrated:0,skipped:0};
  if(!rows.length)return result;
  db.exec("BEGIN IMMEDIATE");
  try{
    for(const row of rows){
      let raw;
      try{raw=JSON.parse(row.raw_fields_json);}catch{result.skipped++;continue;}
      if(row.category!=="ゲットアイテム"||row.original_name!=="おばちゃんの力"||row.durability_unit!=="未核對"||
        db.prepare("SELECT 1 FROM legacy_item_usage WHERE user_id=? AND source_line=?").get(row.user_id,row.source_line)||
        db.prepare("SELECT 1 FROM legacy_inventory_items WHERE user_id=? AND original_id=? AND category=? AND original_name=?").get(row.user_id,ORIGIN,row.category,row.original_name)){
        result.skipped++;continue;
      }
      const awards=db.prepare("SELECT mode,result_json FROM osaka_battles WHERE user_id=? ORDER BY id").all(row.user_id).flatMap(record=>{
        const b=JSON.parse(record.result_json);
        return b.reward?.granted&&b.reward.blocked&&b.reward.sourceLine===row.source_line?[{mode:record.mode,b}]:[];
      });
      if(!awards.length||awards.length!==row.durability||!awards.every(({mode,b})=>{
        const p=rules[mode]?.prizes[0];
        return p?.correction&&b.prizeIndex===0&&b.prize?.name===row.original_name&&
          JSON.stringify(b.prize.rawFields)===JSON.stringify(p.originalRawFields);
      })||JSON.stringify(raw)!==JSON.stringify(rules[awards[0].mode].prizes[0].originalRawFields)){
        result.skipped++;continue;
      }
      const fields=[...rules[awards[0].mode].prizes[0].rawFields];
      const count=awards.reduce((n,{mode})=>n+Number(rules[mode].prizes[0].rawFields[21]),0);
      if(!Number.isSafeInteger(count)||count<1||count>1000000){result.skipped++;continue;}
      fields[21]=String(count);fields[30]=String(row.purchased_at);
      db.prepare("UPDATE legacy_inventory_items SET original_id=?,effect=?,durability=?,durability_unit=?,raw_fields_json=? WHERE user_id=? AND source_line=?")
        .run(ORIGIN,fields[9],count,fields[22],JSON.stringify(fields),row.user_id,row.source_line);
      result.migrated++;
    }
    db.exec("COMMIT");return result;
  }catch(error){db.exec("ROLLBACK");throw error;}
}
function grantPrize(db,userId,rules,prize,now){
  if(!prize.usableShape)throw new Error("大阪獎品資料無法安全使用");
  const rows=heldInventoryRows(db,userId,now);
  const stored=db.prepare("SELECT COUNT(*) n FROM equipment_items WHERE user_id=? AND status='stored'").get(userId).n;
  if(rows.length+stored>=25)return {name:prize.name,granted:false,reason:"inventory-full"};
  const fields=[...prize.rawFields];
  const existing=rows.find(row=>row.category==="ゲットアイテム"&&row.original_name===prize.name&&row.original_id===ORIGIN);
  if(existing){
    const raw=JSON.parse(existing.raw_fields_json);
    if(!Array.isArray(raw)||raw.length!==33||raw[0]!==existing.category||raw[1]!==existing.original_name||
       !findTemplate(rules,existing,raw)||raw[21]!==String(existing.durability)||existing.durability_unit!=="回"||
       raw[30]!==String(existing.purchased_at)||existing.effect!==raw[9])
      throw new Error("大阪獎品來源異常");
    const remaining=(existing.web_remaining??existing.durability)+Number(fields[21]);
    if(!Number.isSafeInteger(remaining)||remaining<1||remaining>1000000)throw new Error("大阪獎品數量超出安全範圍");
    raw[21]=String(remaining);
    db.prepare("UPDATE legacy_inventory_items SET durability=?,raw_fields_json=? WHERE user_id=? AND source_line=?")
      .run(remaining,JSON.stringify(raw),userId,existing.source_line);
    db.prepare("UPDATE legacy_item_usage SET remaining=? WHERE user_id=? AND source_line=?").run(remaining,userId,existing.source_line);
    return {name:prize.name,granted:true,blocked:false,merged:true,sourceLine:existing.source_line};
  }
  const sourceLine=Math.max(10_000_000,db.prepare("SELECT COALESCE(MAX(source_line),0) n FROM legacy_inventory_items WHERE user_id=?").get(userId).n+1);
  if(!Number.isSafeInteger(sourceLine))throw new Error("大阪獎品行號超出範圍");
  fields[30]=String(Math.floor(now/1000));
  db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId,ORIGIN,sourceLine,fields[0],fields[1],fields[9],Number(fields[21]),fields[22],Math.floor(now/1000),0,JSON.stringify(fields));
  return {name:prize.name,granted:true,blocked:false,merged:false,sourceLine};
}
export function playOsaka(db,userId,rules,catalog,{mode,requestId,now,rng=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||!OSAKA_MODES.includes(mode)||typeof requestId!=="string"||!REQUEST.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof rng!=="function")throw new Error("大阪挑戰請求格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare("SELECT mode,result_json FROM osaka_battles WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(prior){
      if(prior.mode!==mode)throw new Error("相同大阪挑戰請求不可變更難度");
      db.exec("COMMIT");
      return {...JSON.parse(prior.result_json),replayed:true};
    }
    const char=db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId);
    if(!char)throw new Error("請先建立角色");
    if(!catalog.available)throw new Error("大阪原版 NPC 資料尚未完整");
    if(!entrances(db,char.town_id)[mode])throw new Error("目前城鎮沒有對應大阪挑戰入口或遊樂中心");
    const last=db.prepare("SELECT MAX(played_at) last FROM osaka_battles WHERE user_id=?").get(userId).last;
    if(last!==null&&now-last<OSAKA_COOLDOWN_MS)throw new Error("大阪挑戰行動間隔未結束");
    const stats=JSON.parse(char.stats_json);
    const recovered=recoverEnergy({stats,bodyEnergy:char.body_energy,brainEnergy:char.brain_energy,recoveredAt:char.recovered_at},now);
    const battle=rollOsaka({rules,mode,catalog,player:{stats,bodyEnergy:recovered.bodyEnergy,brainEnergy:recovered.brainEnergy,money:char.money},rng});
    const reward=battle.prize?grantPrize(db,userId,rules,battle.prize,now):null;
    db.prepare("UPDATE characters SET body_energy=?,brain_energy=?,money=?,recovered_at=? WHERE user_id=?")
      .run(battle.player.bodyEnergy,battle.player.brainEnergy,battle.player.money,now,userId);
    const receipt={...battle,reward,playedAt:now,npcSource:battle.npc.source??"unknown",npcSourceVersion:battle.npc.sourceVersion??null};
    db.prepare("INSERT INTO osaka_battles(user_id,request_id,mode,played_at,result_json) VALUES(?,?,?,?,?)")
      .run(userId,requestId,mode,now,JSON.stringify(receipt));
    db.exec("COMMIT");
    return {...receipt,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function osakaOverview(db,userId,catalog){
  const char=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  const locations=char?entrances(db,char.town_id):{week:false,strong:false};
  const rows=db.prepare("SELECT id,mode,played_at,result_json FROM osaka_battles WHERE user_id=? ORDER BY id DESC LIMIT 20").all(userId);
  return {catalogReady:catalog.available,missingCount:catalog.missing.length,sourceInvalid:Boolean(catalog.sourceInvalid),
    npcSource:catalog.source??"unknown",npcSourceVersion:catalog.sourceVersion??null,npcPolicy:catalog.policy??"original-only",
    locations,modes:OSAKA_MODES,readyAt:rows.length?rows[0].played_at+OSAKA_COOLDOWN_MS:0,
    latest:rows.length?JSON.parse(rows[0].result_json):null,
    history:rows.map(row=>{const b=JSON.parse(row.result_json);return {id:row.id,mode:row.mode,playedAt:row.played_at,name:b.npc.name,outcome:b.outcome,moneyDelta:b.moneyDelta,reward:b.reward,npcSource:b.npcSource??"unknown",npcSourceVersion:b.npcSourceVersion??null};})};
}
