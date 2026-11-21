// 第58階段：原版 gamerand.cgi → loto.cgi::loto_game 即時六位數樂透。
// 六個位置各獨立抽0～9，只有相同位置相符才計分；原版獎金是先扣注再乘倍率返還。
// 冷卻只看「最後一位遊玩者」是不是本人，非每人固定三分鐘。
import {randomInt} from "node:crypto";
import {readTownMap} from "./town-storage.mjs";

export const INSTANT_LOTO_SYMBOL="ゲーセン";
export const INSTANT_LOTO_DIGITS=6;
export const INSTANT_LOTO_COOLDOWN_MS=180000;
export const INSTANT_LOTO_HISTORY_LIMIT=20;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const RATES=Object.freeze([500,1000,5000,10000,50000,100000]);
const MULTIPLIERS=Object.freeze([0,2,5,20,100,500,1000]);

export function parseOriginalInstantLoto(gamerandSource,lotoSource){
  if(typeof gamerandSource!=="string"||typeof lotoSource!=="string")
    throw new Error("原版遊樂中心或六位數樂透程式來源缺失");
  const rates=(
    /@loto_set3\s*=\s*\(([^)]*)\)\s*;/.exec(lotoSource)?.[1]??""
  ).match(/\d+/g)?.map(Number)??[];
  const multipliers=[...lotoSource.matchAll(/\$bai\s*=\s*(\d+)\s*;/g)]
    .map(x=>Number(x[1]));
  const threeMinutes=Number(/\$loto_set2\s*=\s*(\d+)\s*;/.exec(lotoSource)?.[1]);
  const allowSame=Number(/\$loto_set1\s*=\s*(\d+)\s*;/.exec(lotoSource)?.[1]);
  const allowDebt=Number(/\$loto_set4\s*=\s*(\d+)\s*;/.exec(lotoSource)?.[1]);
  const oldRecordLimit=Number(/\$kirokuketa\s*=\s*(\d+)\s*;/.exec(lotoSource)?.[1]);
  if(!gamerandSource.includes('action="loto.cgi"')||
     !gamerandSource.includes("<>loto_game<>")||
     !lotoSource.includes('if($in{\'mode\'} eq "loto_game"){&loto_game;}')||
     rates.length!==RATES.length||rates.some((x,i)=>x!==RATES[i])||
     multipliers.length!==MULTIPLIERS.length||
     multipliers.some((x,i)=>x!==MULTIPLIERS[i])||
     threeMinutes!==3||allowSame!==1||allowDebt!==0||oldRecordLimit!==0||
     !Array.from({length:6},(_,i)=>new RegExp("\\$loto"+(i+1)+"\\s*=\\s*int\\(rand\\(10\\)\\)").test(lotoSource)).every(Boolean)||
     !lotoSource.includes('$loto_time + $loto_set2*60 > $now_time')||
     !lotoSource.includes('if($loto_name eq "$name")')||
     !lotoSource.includes('$money = $money - $in{\'rate\'} + $in{\'rate\'} * $bai')||
     !lotoSource.includes('if($loto1 == $in{\'loto1\'})')||
     !lotoSource.includes('if($loto6 == $in{\'loto6\'})'))
    throw new Error("原版六位數樂透入口、六組數字、金額、倍率或最後玩家冷卻已變更");
  return Object.freeze({rates:Object.freeze(rates),multipliers:Object.freeze(multipliers),
    digits:INSTANT_LOTO_DIGITS,cooldownMs:threeMinutes*60000,
    originalLogLimit:50});
}

export function initInstantLotoTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_instant_loto_rounds(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "stake INTEGER NOT NULL CHECK(stake>0),",
    "chosen_digits_json TEXT NOT NULL,drawn_digits_json TEXT NOT NULL,",
    "matches INTEGER NOT NULL CHECK(matches BETWEEN 0 AND 6),",
    "multiplier INTEGER NOT NULL CHECK(multiplier>=0),",
    "gross INTEGER NOT NULL CHECK(gross>=0),",
    "delta INTEGER NOT NULL,played_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_instant_loto_user_rounds_idx",
    "ON arcade_instant_loto_rounds(user_id,id);"
  ].join(" "));
}

function availableHere(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(INSTANT_LOTO_SYMBOL);
}
function digitsValid(digits){
  return Array.isArray(digits)&&digits.length===INSTANT_LOTO_DIGITS&&
    digits.every(x=>Number.isInteger(x)&&x>=0&&x<=9);
}
function publicRound(row){
  return {stake:row.stake,chosenDigits:JSON.parse(row.chosen_digits_json),
    drawnDigits:JSON.parse(row.drawn_digits_json),matches:row.matches,
    multiplier:row.multiplier,gross:row.gross,delta:row.delta,playedAt:row.played_at};
}
function latestRound(db){
  return db.prepare("SELECT user_id,played_at FROM arcade_instant_loto_rounds ORDER BY id DESC LIMIT 1").get();
}

export function instantLotoOverview(db,userId,source,now){
  const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
  const latest=latestRound(db);
  const history=db.prepare([
    "SELECT stake,chosen_digits_json,drawn_digits_json,matches,multiplier,gross,delta,played_at",
    "FROM arcade_instant_loto_rounds WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,INSTANT_LOTO_HISTORY_LIMIT).map(publicRound);
  const totalPlays=db.prepare("SELECT COUNT(*) AS n FROM arcade_instant_loto_rounds").get().n;
  return {available:char?availableHere(db,char.town_id):false,
    rates:source.rates,multipliers:source.multipliers,
    digits:source.digits,cooldownMs:source.cooldownMs,
    readyAt:latest?.user_id===userId?latest.played_at+source.cooldownMs:null,
    totalPlays,history};
}

export function playInstantLoto(db,userId,source,{
  stake,chosenDigits,requestId,now,randomIndex=randomInt
}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !Number.isSafeInteger(stake)||!source?.rates?.includes(stake)||
     !digitsValid(chosenDigits)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof randomIndex!=="function")
    throw new Error("六位數樂透選號、下注或請求碼格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const old=db.prepare([
      "SELECT stake,chosen_digits_json,drawn_digits_json,matches,multiplier,gross,delta,played_at",
      "FROM arcade_instant_loto_rounds WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(old){
      if(old.stake!==stake||old.chosen_digits_json!==JSON.stringify(chosenDigits))
        throw new Error("相同樂透請求碼不能更換下注額或六位數選號");
      db.exec("COMMIT");
      return {...publicRound(old),replayed:true};
    }
    const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!char)throw new Error("請先建立角色");
    if(!availableHere(db,char.town_id))
      throw new Error("目前城鎮沒有原版遊樂中心");
    const last=latestRound(db);
    if(last?.user_id===userId&&now<last.played_at+source.cooldownMs)
      throw new Error("原版樂透上一位玩家仍是本人，需等候 "+
        Math.ceil((last.played_at+source.cooldownMs-now)/1000)+" 秒才能續玩");
    if(!Number.isSafeInteger(char.money)||char.money<stake)
      throw new Error("六位數樂透下注現金不足");
    const drawnDigits=[];
    for(let i=0;i<INSTANT_LOTO_DIGITS;i++){
      const n=randomIndex(10);
      if(!Number.isInteger(n)||n<0||n>9)
        throw new Error("伺服器樂透抽出不合法的0～9數字");
      drawnDigits.push(n);
    }
    const matches=drawnDigits.filter((n,i)=>n===chosenDigits[i]).length;
    const multiplier=source.multipliers[matches];
    const gross=stake*multiplier;
    const delta=gross-stake;
    if(!Number.isSafeInteger(gross)||!Number.isSafeInteger(delta)||
       !Number.isSafeInteger(char.money+delta)||char.money+delta<0)
      throw new Error("六位數樂透結算會超出現金安全範圍");
    const updated=db.prepare([
      "UPDATE characters SET money=money+? WHERE user_id=?",
      "AND money>=? AND money<=?"
    ].join(" ")).run(delta,userId,stake,Number.MAX_SAFE_INTEGER-Math.max(0,delta));
    if(updated.changes!==1)throw new Error("六位數樂透無法完成現金結算");
    db.prepare([
      "INSERT INTO arcade_instant_loto_rounds(",
      "user_id,request_id,stake,chosen_digits_json,drawn_digits_json,",
      "matches,multiplier,gross,delta,played_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,stake,JSON.stringify(chosenDigits),
      JSON.stringify(drawnDigits),matches,multiplier,gross,delta,now);
    db.exec("COMMIT");
    return {stake,chosenDigits:[...chosenDigits],drawnDigits,matches,multiplier,
      gross,delta,playedAt:now,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
