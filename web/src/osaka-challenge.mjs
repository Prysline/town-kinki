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
function grantPrize(db,userId,rules,prize,now){
  const rows=heldInventoryRows(db,userId,now);
  // CGI checks all held mono.cgi entries before matching category/name; equipped gear is excluded.
  const stored=db.prepare("SELECT COUNT(*) n FROM equipment_items WHERE user_id=? AND status='stored'").get(userId).n;
  if(rows.length+stored>=25)return {name:prize.name,granted:false,reason:"inventory-full"};
  const blocked=!prize.usableShape;
  const origin=blocked?QUARANTINE:ORIGIN;
  const fields=[...prize.rawFields];
  const existing=rows.find(row=>row.category==="ゲットアイテム"&&row.original_name===prize.name&&row.original_id===origin);
  if(existing){
    const raw=JSON.parse(existing.raw_fields_json);
    if(!Array.isArray(raw)||raw.length!==33||raw[0]!==existing.category||raw[1]!==existing.original_name)
      throw new Error("大阪獎品原始欄位異常");
    let remaining;
    if(blocked){
      // Quarantine counts awards, not inferred use counts; every exact raw record stays in its receipt.
      if(existing.durability_unit!=="未核對"||!OSAKA_MODES.some(m=>rules[m].prizes.some(p=>!p.usableShape&&p.rawFields.every((v,i)=>raw[i]===v))))
        throw new Error("大阪待核對獎品來源異常");
      remaining=existing.durability+1;
    }else{
      if(!findTemplate(rules,existing,raw)||raw[21]!==String(existing.durability)||existing.durability_unit!=="回"||
         raw[30]!==String(existing.purchased_at)||existing.effect!==raw[9])
        throw new Error("大阪獎品來源異常");
      remaining=(existing.web_remaining??existing.durability)+Number(fields[21]);
      // CGI same-name merging retains the first item's stats, effect and cooldown.
      raw[21]=String(remaining);
    }
    if(!Number.isSafeInteger(remaining)||remaining<1||remaining>1000000)throw new Error("大阪獎品數量超出安全範圍");
    db.prepare("UPDATE legacy_inventory_items SET durability=?,raw_fields_json=? WHERE user_id=? AND source_line=?")
      .run(remaining,JSON.stringify(raw),userId,existing.source_line);
    if(!blocked)db.prepare("UPDATE legacy_item_usage SET remaining=? WHERE user_id=? AND source_line=?")
      .run(remaining,userId,existing.source_line);
    return {name:prize.name,granted:true,blocked,merged:true,sourceLine:existing.source_line};
  }
  const sourceLine=Math.max(10_000_000,db.prepare("SELECT COALESCE(MAX(source_line),0) n FROM legacy_inventory_items WHERE user_id=?").get(userId).n+1);
  if(!Number.isSafeInteger(sourceLine))throw new Error("大阪獎品行號超出範圍");
  // Malformed prizes remain byte-position-faithful; only the Web index marks an award count.
  if(!blocked)fields[30]=String(Math.floor(now/1000));
  db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId,origin,sourceLine,fields[0],fields[1],fields[9],blocked?1:Number(fields[21]),blocked?"未核對":fields[22],Math.floor(now/1000),0,JSON.stringify(fields));
  return {name:prize.name,granted:true,blocked,merged:false,sourceLine};
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
    const receipt={...battle,reward,playedAt:now};
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
    locations,modes:OSAKA_MODES,readyAt:rows.length?rows[0].played_at+OSAKA_COOLDOWN_MS:0,
    latest:rows.length?JSON.parse(rows[0].result_json):null,
    history:rows.map(row=>{const b=JSON.parse(row.result_json);return {id:row.id,mode:row.mode,playedAt:row.played_at,name:b.npc.name,outcome:b.outcome,moneyDelta:b.moneyDelta,reward:b.reward};})};
}
