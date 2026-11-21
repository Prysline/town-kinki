// 原版 basic.cgi::item_do 的安全子集。
// 原始 mono.cgi 封存保持唯讀，使用次數與時間另存在 Web 獨立資料表。
import { randomInt } from "node:crypto";
import { STAT_KEYS, maxBodyEnergy, maxBrainEnergy, recoverEnergy, bodyMassIndex } from "./engine.mjs";
import { diseaseFromIndex } from "./health.mjs";
import { MEAL_COOLDOWN_MS } from "./dining.mjs";
import { DAY_MS } from "./inventory.mjs";
import { initLegacyInventoryTables } from "./legacy-inventory.mjs";

export const CONSUMABLE_REJECTED_EFFECTS=Object.freeze(["ランダム品"]);
const STATS_INDEX=Object.freeze([
  2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20
]);
const NON_CONSUMABLE=new Set(["ギフト","武器","防具","魔法","御守"]);
const FOOD_TYPES=new Set(["食料品","ファーストフード"]);
const SPECIAL_TYPES=new Set(["無","万能","風邪","下痢","肺炎","結核",
  "ウエイトアップ","ダイエット","身長","縮み"]);
// basic.cgi::item_do 的「ステータス」沒有額外特殊分支，會照一般能力與耗能欄位生效。
// 僅對原版商品表確有證據的三款放行，避免憑名稱偽造其他不明特效。
const STATUS_ITEMS=new Set([
  "ゲーム\tバイオハザード（wiiバージョン",
  "ゲーム\tキングダムハーツ2ファイナルミックス＋",
  "関西名産店\t阪神タイガースの公式チケット"
]);
// 原版「日」制一般道具不限於一次，期限內按冷卻可再使用。
// 健康保險、卡片、寵物、防犯攝影機等另有用途，不當作可反覆使用的消耗品。
const DAY_USE_TYPES=new Set(["書籍","ゲーム","アダルト"]);
const ENERGY_RECOVERY_ITEMS=new Map([
  ["ドリンク\t元気ミルク","-500,0"],
  ["ドリンク\t爽快ミルク","0,-500"],
  ["デザート\t元気パフェ","-500,0"],
  ["デザート\t爽快パフェ","0,-500"]
]);
const COMPOUND_SUFFIXES=new Set(["食料品","ファ"]);
// 原始商品表的三款例外：兩款「万能,」不含治病數值，另有普通能力／熱量效果；
// 「ぼったくり」的 -300 kcal 依 basic.cgi::item_do 原始公式減少 0.3 kg。
// 僅比對不可變來源欄位；耐久、最後使用、購入時間及單價可隨合法交易變更。
const VERIFIED_EDGE_ITEMS=new Map([
  ["関西名産店\t琵琶湖の水",{
    effect:"万能,",bonuses:[0,0,0,0,0,0,0,10,10,10,0,0,0,0,0,0,0],
    price:"10000",unit:"回",interval:"1",stock:"5",calories:"-100",
    body:"0",brain:"0",comment:"冷たくておいしいです。",sale:""
  }],
  ["書籍\t無駄知識を覚える本",{
    effect:"万能,",bonuses:[3,3,3,3,3,3,3,1,1,1,1,1,1,1,5,5,5],
    price:"1050",unit:"日",interval:"30",stock:"5",calories:"",
    body:"1",brain:"10",comment:"この本で無駄知識を覚えよう",sale:""
  }],
  ["アルコール\tぼったくり",{
    effect:"無",bonuses:Array(17).fill(1),
    price:"15000",unit:"回",interval:"3",stock:"15",calories:"-300",
    body:"10",brain:"10",comment:"※専門店限定商品。",sale:"0"
  }]
]);
function isVerifiedEdgeItem(row,raw){
  const item=VERIFIED_EDGE_ITEMS.get(row.category+"\t"+row.original_name);
  return Boolean(item&&
    raw[9]===item.effect&&raw[17]===item.price&&raw[22]===item.unit&&
    raw[23]===item.interval&&raw[24]===item.stock&&
    raw[25]===item.calories&&raw[27]===item.body&&
    raw[28]===item.brain&&raw[29]===item.comment&&
    raw[32]===item.sale&&
    STATS_INDEX.every((index,i)=>raw[index]===String(item.bonuses[i])));
}
const ID_RE=/^[a-zA-Z0-9_-]{8,80}$/;
// basic.cgi::item_do 對「ランダム品」的 17 項原版能力上限各自抽 0～10（含端點）。
// 只接受 syouhin.cgi 真實「薬」商品的固定效果欄；已購物品的耐久、購買日及單價可改動。
function isVerifiedRandomItem(row,raw){
  return row.category==="薬"&&row.original_name==="ランダム品"&&
    raw[9]==="無"&&raw[17]==="2000000"&&raw[22]==="回"&&
    raw[23]==="3"&&raw[25]==="0"&&
    raw[27]==="0"&&raw[28]==="0"&&raw[29]==="ランダム品"&&
    STATS_INDEX.every(index=>raw[index]==="10");
}

function signedNumber(input,label,min=-1000000,max=1000000){
  if(!/^-?\d+$/.test(input))throw new Error(label+"不是整數");
  const n=Number(input);
  if(!Number.isSafeInteger(n)||n<min||n>max)
    throw new Error(label+"超出可安全處理的範圍");
  return n;
}
function nonnegative(input,label,max=1000000){
  return signedNumber(input,label,0,max);
}
function parseArchivedItem(row){
  let raw;
  try{raw=JSON.parse(row.raw_fields_json);}catch{}
  if(!Array.isArray(raw)||raw.length!==33||
    raw.some(x=>typeof x!=="string")||
    raw[0]!==row.category||raw[1]!==row.original_name)
    throw new Error("封存物品資料不完整或與索引不一致");
  const unit=row.durability_unit;
  const verifiedRandom=isVerifiedRandomItem(row,raw);
  if(!["回","日"].includes(unit)||raw[22]!==unit||
     NON_CONSUMABLE.has(row.category)||
     (row.original_name==="ランダム品"&&!verifiedRandom))
    return null;
  if(unit==="日"&&!DAY_USE_TYPES.has(row.category))return null;
  const parts=raw[9].split(",");
  const compound=parts.length===3&&COMPOUND_SUFFIXES.has(parts[2]);
  if(parts.length>2&&!compound)return null;
  const effect=parts[0];
  // basic.cgi::item_do 對「効果」與「ステータス」沒有獨立特殊分支：
  // 前者只有原版 4 款明確記載 -500 能量恢復的飲食品可安全放行。
  const itemKey=row.category+"\t"+row.original_name;
  const originalEdge=isVerifiedEdgeItem(row,raw);
  const emptyMagnitude=originalEdge&&raw[9]==="万能,";
  const recovered=ENERGY_RECOVERY_ITEMS.get(itemKey);
  const originalEnergyRecovery=effect==="効果"&&parts.length===1&&
    recovered===raw[27]+","+raw[28];
  const originalStatus=effect==="ステータス"&&parts.length===1&&
    STATUS_ITEMS.has(itemKey);
  if(!SPECIAL_TYPES.has(effect)&&!originalEnergyRecovery&&!originalStatus)
    return null;
  if(effect!=="無"&&!originalEnergyRecovery&&!originalStatus&&!emptyMagnitude&&
     (parts.length!==2&&!compound||!/^\d+$/.test(parts[1])))return null;
  if(["無","効果","ステータス"].includes(effect)&&parts.length!==1)
    return null;
  const magnitude=effect==="無"||originalEnergyRecovery||originalStatus||emptyMagnitude?0:
    nonnegative(parts[1],"特殊效果",100000);
  let purchasedAt=null,expiresAt=null;
  if(unit==="日"){
    // 日期與 33 欄必須相符；拒絕無購買時間、溢位或捏造的歷史存檔。
    const seconds=row.purchased_at;
    if(!Number.isSafeInteger(seconds)||seconds<=0||
       seconds>Math.floor(Number.MAX_SAFE_INTEGER/1000)||
       raw[30]!==String(seconds))return null;
    purchasedAt=seconds*1000;
    const span=nonnegative(String(row.durability),"原始有效天數",1000000)*DAY_MS;
    expiresAt=purchasedAt+span;
    if(!Number.isSafeInteger(expiresAt))return null;
  }
  const bonuses=Object.fromEntries(STAT_KEYS.map((key,index)=>[
    key,signedNumber(raw[STATS_INDEX[index]],key+"能力增減")
  ]));
  const intervalMinutes=nonnegative(raw[23],"使用間隔",1000000);
  const bodyCost= signedNumber(raw[27]||"0","身體能量消耗");
  const brainCost=signedNumber(raw[28]||"0","頭腦能量消耗");
  // 原版負熱量會使體重減少；對未核實的負熱量資料維持拒絕。
  const calories=signedNumber(raw[25]||"0","熱量");
  if(calories<0&&!originalEdge)return null;
  const lastUsedSec=nonnegative(raw[26]||"0","最後使用時間",Number.MAX_SAFE_INTEGER);
  const originalRemaining=nonnegative(String(row.durability),"原始耐久",1000000);
  const food=FOOD_TYPES.has(row.category);
  const next=lastUsedSec*1000+intervalMinutes*60000;
  if(!Number.isSafeInteger(next))throw new Error("原始物品冷卻日期超出安全範圍");
  return {sourceLine:row.source_line,name:row.original_name,category:row.category,
    effect,magnitude,bonuses,intervalMinutes,bodyCost,brainCost,calories,
    originalRemaining,originalLastUsedAt:lastUsedSec*1000,
    durabilityUnit:unit,purchasedAt,expiresAt,food,randomBonuses:verifiedRandom};
}
// 供商店在「購入前」顯示目前 Web 是否支援直接使用；使用與否仍由正式交易驗證。
export function supportsLegacyItemUse(rawFields){
  if(!Array.isArray(rawFields)||rawFields.length!==33)return false;
  try {
    // 原版商品目錄尚未買入，購入時間為 0；這裡只預檢「買入後能否操作」。
    // 真正持有物必須符合本人購買時間與到期日，無法用預覽值繞過。
    const preview=[...rawFields];
    // 原版 syouhin.cgi 的這格可能是「きょろちゃ」「ソラ」等製作者文字，
    // 並非購入時間。預覽只檢查可否支援，購入時會由買賣邏輯覆寫為真實時間。
    if(preview[22]==="日")preview[30]="1";
    return Boolean(parseArchivedItem({
      category:preview[0],original_name:preview[1],
      durability:Number(preview[21]),durability_unit:preview[22],
      purchased_at:Number(preview[30]),
      raw_fields_json:JSON.stringify(preview)
    }));
  }catch{return false;}
}
function readRows(db,userId){
  const present=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_inventory_items'").get();
  if(!present)return [];
  return db.prepare([
    "SELECT i.*,u.remaining AS web_remaining,u.last_used_at_ms",
    "FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u",
    "ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? ORDER BY i.source_line LIMIT 2100"
  ].join(" ")).all(userId);
}
function itemRemaining(item,row,now){
  if(item.durabilityUnit!=="日")return row.web_remaining??item.originalRemaining;
  if(now<item.purchasedAt)return 0;
  const elapsed=Math.floor((Math.floor(now/1000)-Math.floor(item.purchasedAt/1000))/86400);
  return Math.max(0,item.originalRemaining-elapsed);
}
function status(item,character,remaining,lastUsedAt,now){
  if(item.durabilityUnit==="日"&&now<item.purchasedAt)
    return {canUse:false,reason:"尚未到原版商品購入時間",readyAt:item.purchasedAt};
  if(remaining<=0)return {canUse:false,reason:item.durabilityUnit==="日"?
    "原版商品有效天數已過期":"原始物品耐久已用盡",readyAt:null};
  const readyAt=lastUsedAt+item.intervalMinutes*60000;
  if(now<readyAt)return {canUse:false,reason:"物品使用間隔尚未結束",readyAt};
  if(item.food&&character.lastMealAt>0&&
      now-character.lastMealAt<MEAL_COOLDOWN_MS)
    return {canUse:false,reason:"距離上次用餐未滿 60 分鐘",
      readyAt:character.lastMealAt+MEAL_COOLDOWN_MS};
  if(character.bodyEnergy<item.bodyCost||character.brainEnergy<item.brainCost)
    return {canUse:false,reason:"角色目前能量不足",readyAt:null};
  return {canUse:true,reason:null,readyAt:null};
}
export function initLegacyItemUseTables(db){
  initLegacyInventoryTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS legacy_item_usage(",
    "user_id INTEGER NOT NULL,source_line INTEGER NOT NULL,",
    "remaining INTEGER NOT NULL CHECK(remaining>=0),",
    "last_used_at_ms INTEGER NOT NULL,",
    "PRIMARY KEY(user_id,source_line),",
    "FOREIGN KEY(user_id,source_line) REFERENCES legacy_inventory_items(user_id,source_line) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS legacy_item_use_history(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "source_line INTEGER NOT NULL,request_id TEXT NOT NULL,",
    "original_name TEXT NOT NULL,changes_json TEXT NOT NULL,",
    "used_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS legacy_item_use_history_user_idx",
    "ON legacy_item_use_history(user_id,id);"
  ].join("\n"));
}
export function listLegacyItemActions(db,userId,character,now=Date.now()){
  if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("無效的玩家帳號");
  return readRows(db,userId).flatMap(row=>{
    let item;
    try{item=parseArchivedItem(row);}
    catch{return [];} // 損壞或未辨識的原始檔仍可唯讀封存，不中斷角色狀態。
    if(!item)return [];
    const remaining=itemRemaining(item,row,now);
    const lastUsedAt=row.last_used_at_ms??item.originalLastUsedAt;
    return [{
      sourceLine:item.sourceLine,name:item.name,category:item.category,
      remaining,originalRemaining:item.originalRemaining,
      durabilityUnit:item.durabilityUnit,expiresAt:item.expiresAt,
      intervalMinutes:item.intervalMinutes,food:item.food,
      ...status(item,character,remaining,lastUsedAt,now)
    }];
  });
}
export function listLegacyItemUseHistory(db,userId,limit=20){
  if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("無效的玩家帳號");
  const count=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,50)):20;
  return db.prepare(
    "SELECT source_line,original_name,changes_json,used_at FROM legacy_item_use_history WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ).all(userId,count).map(row=>({
    sourceLine:row.source_line,name:row.original_name,
    changes:JSON.parse(row.changes_json),usedAt:row.used_at
  }));
}
function applyEffects(character,item,now,randomIndex=randomInt){
  const current=recoverEnergy(character,now);
  const next={...current,stats:{...current.stats}};
  const gained={};
  for(let i=0;i<STAT_KEYS.length;i++){
    const key=STAT_KEYS[i];
    // 原版 int(rand(上限+1))：每項能力各自重抽，使用歷史只保存實際抽中值。
    const delta=item.randomBonuses?randomIndex(item.bonuses[key]+1):item.bonuses[key];
    if(item.randomBonuses&&(!Number.isSafeInteger(delta)||delta<0||delta>item.bonuses[key]))
      throw new Error("原版隨機道具的能力增幅超出範圍");
    const previous=next.stats[key];
    if(!Number.isSafeInteger(previous)||previous<0)
      throw new Error("角色能力資料不正確");
    const target=Math.max(0,previous+delta);
    if(!Number.isSafeInteger(target))throw new Error("角色能力數值超出安全範圍");
    next.stats[key]=target;
    if(target!==previous)gained[key]=target-previous;
  }
  const healthBefore=next.healthIndex??50;
  let healthAfter=healthBefore,weightDelta=0,heightDelta=0;
  const diseaseKey=diseaseFromIndex(healthBefore).key;
  // 原版 basic.cgi 將 eq "万能\") 誤寫成跳脫引號，依商品描述及相鄰
  // 風邪／下痢等分支修正為萬能藥不限制病名，直接增加疾病指數。
  const matchesIllness=item.effect==="万能"||
    (item.effect==="風邪"&&["slightCold","cold"].includes(diseaseKey))||
    (item.effect==="下痢"&&diseaseKey==="diarrhea")||
    (item.effect==="肺炎"&&diseaseKey==="pneumonia")||
    (item.effect==="結核"&&diseaseKey==="tuberculosis");
  if(matchesIllness)healthAfter+=item.magnitude;
  if(item.effect==="ウエイトアップ")weightDelta+=item.magnitude;
  if(item.effect==="ダイエット")weightDelta-=item.magnitude;
  if(item.effect==="身長")heightDelta+=item.magnitude;
  if(item.effect==="縮み")heightDelta-=item.magnitude;
  weightDelta+=item.calories/1000;
  next.healthIndex=healthAfter;
  if(!Number.isSafeInteger(healthAfter))throw new Error("疾病指數超出安全範圍");
  next.weight=Math.max(.01,Math.round((current.weight+weightDelta)*100)/100);
  next.height=Math.max(1,current.height+heightDelta);
  if(!Number.isFinite(next.weight)||!Number.isSafeInteger(next.height))
    throw new Error("角色身高體重超出安全範圍");
  next.bmi=bodyMassIndex(next.height,next.weight);
  next.bodyEnergy=Math.max(0,Math.min(maxBodyEnergy(next.stats),
    current.bodyEnergy-item.bodyCost));
  next.brainEnergy=Math.max(0,Math.min(maxBrainEnergy(next.stats),
    current.brainEnergy-item.brainCost));
  next.recoveredAt=now;
  if(item.food)next.lastMealAt=now;
  return {
    character:next,
    changes:{
      stats:gained,healthIndex:healthAfter-healthBefore,
      weight:Math.round((next.weight-current.weight)*100)/100,
      height:next.height-current.height,
      bodyEnergy:next.bodyEnergy-current.bodyEnergy,
      brainEnergy:next.brainEnergy-current.brainEnergy,
      food:item.food
    }
  };
}
export function useLegacyItem(db,userId,sourceLine,requestId,now=Date.now(),randomIndex=randomInt){
  if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("無效的玩家帳號");
  if(!Number.isSafeInteger(sourceLine)||sourceLine<=0)throw new Error("物品行號不正確");
  if(typeof requestId!=="string"||!ID_RE.test(requestId))
    throw new Error("道具使用識別碼格式不正確");
  if(!Number.isSafeInteger(now)||now<=0)throw new Error("使用時間不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare(
      "SELECT source_line,original_name,changes_json,used_at FROM legacy_item_use_history WHERE user_id=? AND request_id=?"
    ).get(userId,requestId);
    if(previous){
      if(previous.source_line!==sourceLine)throw new Error("相同請求編號不可用於其他道具");
      db.exec("COMMIT");
      return {sourceLine,name:previous.original_name,
        changes:JSON.parse(previous.changes_json),usedAt:previous.used_at,replayed:true};
    }
    const row=db.prepare([
      "SELECT i.*,u.remaining AS web_remaining,u.last_used_at_ms",
      "FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u",
      "ON u.user_id=i.user_id AND u.source_line=i.source_line",
      "WHERE i.user_id=? AND i.source_line=?"
    ].join(" ")).get(userId,sourceLine);
    if(!row)throw new Error("找不到本人可使用的原版物品");
    const item=parseArchivedItem(row);
    if(!item)throw new Error("這項原版物品的使用效果尚未支援");
    const character=db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    const current={
      stats:JSON.parse(character.stats_json),
      bodyEnergy:character.body_energy,brainEnergy:character.brain_energy,
      recoveredAt:character.recovered_at,
      healthIndex:character.health_index,weight:character.weight,
      height:character.height,lastMealAt:character.last_meal_at
    };
    const updated=recoverEnergy(current,now);
    const remaining=itemRemaining(item,row,now);
    const lastUsedAt=row.last_used_at_ms??item.originalLastUsedAt;
    const availability=status(item,updated,remaining,lastUsedAt,now);
    if(!availability.canUse)throw new Error(availability.reason);
    const applied=applyEffects(updated,item,now,randomIndex);
    const next=applied.character;
    db.prepare([
      "UPDATE characters SET stats_json=?,body_energy=?,brain_energy=?,recovered_at=?,",
      "health_index=?,weight=?,height=?,bmi=?,last_meal_at=? WHERE user_id=?"
    ].join(" ")).run(JSON.stringify(next.stats),next.bodyEnergy,next.brainEnergy,
      next.recoveredAt,next.healthIndex,next.weight,next.height,next.bmi,
      next.lastMealAt,userId);
    db.prepare([
      "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
      "VALUES(?,?,?,?) ON CONFLICT(user_id,source_line) DO UPDATE",
      "SET remaining=excluded.remaining,last_used_at_ms=excluded.last_used_at_ms"
    ].join(" ")).run(userId,sourceLine,
      item.durabilityUnit==="回"?remaining-1:remaining,now);
    db.prepare([
      "INSERT INTO legacy_item_use_history(user_id,source_line,request_id,original_name,changes_json,used_at)",
      "VALUES(?,?,?,?,?,?)"
    ].join(" ")).run(userId,sourceLine,requestId,item.name,
      JSON.stringify(applied.changes),now);
    db.exec("COMMIT");
    return {sourceLine,name:item.name,changes:applied.changes,usedAt:now,replayed:false};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
