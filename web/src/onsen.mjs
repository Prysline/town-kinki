// AP-05 transaction candidate: server-owned visit/receipt, never trust client bath clock/exit multiplier.
// HTTP/state/other-action guards are integrated in a subsequent shared-server change.
import {STAT_KEYS} from "./engine.mjs";
import {publicTownMap} from "./town-storage.mjs";
import {calendarDay} from "./training.mjs";
import {getCockroachChallenge} from "./event-cockroach.mjs";
import {refreshBankTaxSnapshot} from "./banking.mjs";
import {originalOnsenOptions,quoteOriginalOnsen,projectOriginalOnsenEntryEnergy,
  projectOriginalOnsenExitEnergy,projectApprovedOnsenAbilityRolls} from "./onsen-source.mjs";
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
export const ONSEN_SYMBOL="温泉";
export function initOnsenTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS onsen_visits(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,town_id INTEGER NOT NULL CHECK(town_id BETWEEN 0 AND 3),",
    "bath_key TEXT NOT NULL CHECK(bath_key IN ('futuu','koukyuu','koukyuu_ume','koukyuu_take','koukyuu_matu','special_dou','special_gin','special_kin')),",
    "entered_at INTEGER NOT NULL CHECK(entered_at>=0),completed_at INTEGER,",
    "entry_json TEXT NOT NULL,exit_json TEXT,UNIQUE(user_id,request_id),",
    "CHECK((completed_at IS NULL AND exit_json IS NULL) OR (completed_at>=entered_at AND exit_json IS NOT NULL)));",
    "CREATE UNIQUE INDEX IF NOT EXISTS onsen_active_user ON onsen_visits(user_id) WHERE completed_at IS NULL;",
    "CREATE INDEX IF NOT EXISTS onsen_user_history ON onsen_visits(user_id,id);"
  ].join(" "));
}
function safeInt(value,label,min=0){
  if(!Number.isSafeInteger(value)||value<min)throw Error("溫泉"+label+"資料不正確");
  return value;
}
function character(db,userId,now){
  const row=db.prepare("SELECT town_id,money,bank,stats_json,body_energy,brain_energy,recovered_at FROM characters WHERE user_id=?").get(userId);
  if(!row)throw Error("請先建立角色");
  safeInt(row.town_id,"所在地");
  if(row.town_id>3)throw Error("溫泉所在地不正確");
  const stats=JSON.parse(row.stats_json);
  if(!stats||typeof stats!=="object"||Array.isArray(stats))throw Error("溫泉角色能力資料不正確");
  for(const key of STAT_KEYS)safeInt(stats[key],"角色能力："+key);
  const recoveredAt=safeInt(row.recovered_at,"恢復時計");
  if(recoveredAt>now)throw Error("溫泉恢復時計尚未到達");
  return {row,source:{
    stats,bodyEnergy:safeInt(row.body_energy,"身體能量"),brainEnergy:safeInt(row.brain_energy,"頭腦能量"),
    lastBodyAt:Math.floor(recoveredAt/1000),lastBrainAt:Math.floor(recoveredAt/1000)
  }};
}
function building(db,townId){
  const map=publicTownMap(db,townId,false);
  return map.configured&&map.cells.some(cell=>cell.key===ONSEN_SYMBOL);
}
const ACTIVE="SELECT * FROM onsen_visits WHERE user_id=? AND completed_at IS NULL";
function publicVisit(row){
  return {id:row.id,townId:row.town_id,bathKey:row.bath_key,enteredAt:row.entered_at,
    completedAt:row.completed_at,entry:JSON.parse(row.entry_json),
    exit:row.exit_json===null?null:JSON.parse(row.exit_json)};
}
export function activeOnsenVisit(db,userId){
  safeInt(userId,"玩家",1);
  const row=db.prepare(ACTIVE).get(userId);
  return row?publicVisit(row):null;
}
export function assertNoActiveOnsen(db,userId){
  if(activeOnsenVisit(db,userId))throw Error("目前正在泡溫泉，請先離開浴池");
}
function drawBackground(config,random){
  const count=safeInt(config.on_gazou_suu,"背景圖片數",1);
  const value=random();
  if(!Number.isFinite(value)||value<0||value>=1)throw Error("無效的溫泉背景亂數");
  return Math.floor(value*count)+1;
}
function readyAt(now,offset){
  const result=Math.floor(now/1000)*1000+offset*1000;
  if(!Number.isSafeInteger(result))throw Error("溫泉倒數超出安全範圍");
  return result;
}
export function onsenOverview(db,userId,config,now){
  safeInt(userId,"玩家",1);safeInt(now,"時間");
  const {row,source}=character(db,userId,now);
  const active=activeOnsenVisit(db,userId);
  if(active){
    if(row.town_id!==active.townId)throw Error("角色所在地與入浴紀錄不一致");
    const preview=projectOriginalOnsenExitEnergy(source,config,active.entry.exitKey,Math.floor(now/1000));
    return {available:building(db,row.town_id),options:[],active,
      exitPreview:{bodyEnergy:preview.bodyEnergy,brainEnergy:preview.brainEnergy,maxima:preview.maxima},
      bodyRemainingMs:Math.max(0,active.entry.bodyReadyAt-now),
      brainRemainingMs:Math.max(0,active.entry.brainReadyAt-now)};
  }
  const available=building(db,row.town_id);
  return {available,active:null,options:available?quoteOriginalOnsen(source,config,Math.floor(now/1000))
    .map(bath=>({...bath,reason:row.money<bath.fee?"現金不足":null})):[]};
}
export function enterOnsen(db,userId,config,{bathKey,requestId,now,today,random=Math.random}={}){
  safeInt(userId,"玩家",1);safeInt(now,"時間");
  if(typeof requestId!=="string"||!REQUEST_ID.test(requestId)||typeof bathKey!=="string"||typeof random!=="function")
    throw Error("溫泉入浴請求格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare("SELECT * FROM onsen_visits WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(prior){
      if(prior.bath_key!==bathKey)throw Error("相同入浴請求碼不可更換浴池");
      db.exec("COMMIT");return {...publicVisit(prior),replayed:true};
    }
    assertNoActiveOnsen(db,userId);
    const {row,source}=character(db,userId,now);
    if(!building(db,row.town_id))throw Error("所在城鎮沒有溫泉設施");
    if(db.prepare("SELECT 1 FROM arcade_road_trips WHERE user_id=? AND completed_at IS NULL").get(userId))
      throw Error("公路旅程尚未抵達");
    if(getCockroachChallenge(db,userId,now)?.status==="active")
      throw Error("限時事件進行中，請先處理或等待結束");
    const option=originalOnsenOptions(config,source.stats).find(b=>b.key===bathKey);
    if(!option)throw Error("未知的原版浴池");
    if(safeInt(row.money,"現金")<option.fee)throw Error("現金不足以支付入浴費");
    const projected=projectOriginalOnsenEntryEnergy(source,config,bathKey,Math.floor(now/1000));
    const ability=projectApprovedOnsenAbilityRolls(source.stats,bathKey,random);
    if(ability.status!=="source-ok")throw Error("溫泉能力計算失敗");
    // Original background draw follows the ability draws. Keep the same RNG order; validate before commit.
    const backgroundIndex=drawBackground(config,random);
    const entry={fee:option.fee,rate:option.rate,label:option.label,exitKey:option.exitKey,
      bodyEnergy:projected.bodyEnergy,brainEnergy:projected.brainEnergy,maxima:projected.maxima,
      gains:ability.gains,rolls:ability.rolls,backgroundIndex,
      bodyReadyAt:readyAt(now,projected.sourceBodyDisplayOffset),
      brainReadyAt:readyAt(now,projected.sourceBrainDisplayOffset)};
    safeInt(entry.bodyEnergy,"入浴身體能量");safeInt(entry.brainEnergy,"入浴頭腦能量");
    const changed=db.prepare("UPDATE characters SET money=money-?,stats_json=?,body_energy=?,brain_energy=?,recovered_at=? WHERE user_id=? AND money>=?")
      .run(entry.fee,JSON.stringify(ability.stats),entry.bodyEnergy,entry.brainEnergy,now,userId,entry.fee);
    if(changed.changes!==1)throw Error("溫泉扣款或角色更新失敗");
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bank_tax_state'").get())
      refreshBankTaxSnapshot(db,userId,today??calendarDay(now));
    const inserted=db.prepare("INSERT INTO onsen_visits(user_id,request_id,town_id,bath_key,entered_at,entry_json) VALUES(?,?,?,?,?,?)")
      .run(userId,requestId,row.town_id,bathKey,now,JSON.stringify(entry));
    const saved=db.prepare("SELECT * FROM onsen_visits WHERE id=?").get(inserted.lastInsertRowid);
    db.exec("COMMIT");return {...publicVisit(saved),replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function leaveOnsen(db,userId,config,{visitId,now}={}){
  safeInt(userId,"玩家",1);safeInt(visitId,"入浴紀錄",1);safeInt(now,"時間");
  db.exec("BEGIN IMMEDIATE");
  try{
    const visit=db.prepare("SELECT * FROM onsen_visits WHERE id=? AND user_id=?").get(visitId,userId);
    if(!visit)throw Error("找不到本人的入浴紀錄");
    if(visit.completed_at!==null){
      db.exec("COMMIT");return {...publicVisit(visit),replayed:true};
    }
    if(now<visit.entered_at)throw Error("溫泉入浴時間尚未到達");
    const {row,source}=character(db,userId,now);
    if(row.town_id!==visit.town_id)throw Error("角色所在地與入浴紀錄不一致");
    // Even if a map editor removes the building, the owner must be able to leave the paid bath.
    const entry=JSON.parse(visit.entry_json);
    const projected=projectOriginalOnsenExitEnergy(source,config,entry.exitKey,Math.floor(now/1000));
    if(projected.bath.key!==visit.bath_key)throw Error("溫泉浴池紀錄不一致");
    const exit={bodyEnergy:projected.bodyEnergy,brainEnergy:projected.brainEnergy,maxima:projected.maxima,
      rate:projected.bath.rate};
    const changed=db.prepare("UPDATE characters SET body_energy=?,brain_energy=?,recovered_at=? WHERE user_id=?")
      .run(safeInt(exit.bodyEnergy,"出浴身體能量"),safeInt(exit.brainEnergy,"出浴頭腦能量"),now,userId);
    if(changed.changes!==1)throw Error("溫泉角色更新失敗");
    const done=db.prepare("UPDATE onsen_visits SET completed_at=?,exit_json=? WHERE id=? AND user_id=? AND completed_at IS NULL")
      .run(now,JSON.stringify(exit),visitId,userId);
    if(done.changes!==1)throw Error("溫泉離開紀錄更新失敗");
    const saved=db.prepare("SELECT * FROM onsen_visits WHERE id=?").get(visitId);
    db.exec("COMMIT");return {...publicVisit(saved),replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
