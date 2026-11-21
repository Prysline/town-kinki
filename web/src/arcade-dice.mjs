// 第55階段：gamerand.cgi 遊樂中心實際連到 saikoro.cgi 的雙骰猜奇偶。
// 原版下注／骰子／五分鐘規則由來源驗證；安全扣款、單人帳本和防重送屬 Web 擴充。
import {randomInt} from "node:crypto";
import {readTownMap} from "./town-storage.mjs";

export const ARCADE_SYMBOL="ゲーセン";
export const DICE_COOLDOWN_MS=300000;
export const DICE_HISTORY_LIMIT=20;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const ORIGINAL_RATES=Object.freeze([10000,50000,100000,500000,1000000]);

export function parseOriginalArcadeDice(arcadeSource,diceSource){
  if(typeof arcadeSource!=="string"||typeof diceSource!=="string")
    throw new Error("原版遊樂中心或骰子程式來源缺失");
  if(!arcadeSource.includes('action="saikoro.cgi"')||
     !arcadeSource.includes("<>saikoro<>"))
    throw new Error("原版遊樂中心沒有證實骰子遊戲入口");
  const interval=Number(/\$saikoro_game_time\s*=\s*(\d+)\s*;/.exec(diceSource)?.[1]);
  const rates=[...diceSource.matchAll(/<option value=(\d+)>/g)].map(x=>Number(x[1]));
  if(interval!==5||rates.length!==ORIGINAL_RATES.length||
    !rates.every((v,i)=>v===ORIGINAL_RATES[i])||
    !diceSource.includes("int(rand(36))")||
    !diceSource.includes("int($randed / 6) + 1")||
    !diceSource.includes("$randed % 6 +1")||
    !diceSource.includes("$goukei % 2 == 0")||
    !diceSource.includes("$money -= $rate")||
    !diceSource.includes("$money += $rate")||
    !diceSource.includes("$#saicoro_dat =19"))
    throw new Error("原版骰子賭注、勝敗、骰面、五分鐘或20筆紀錄規則已變更");
  return Object.freeze({rates:Object.freeze(rates),
    cooldownMs:interval*60000,historyLimit:DICE_HISTORY_LIMIT});
}

export function initArcadeDiceTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_dice_rounds(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,guess TEXT NOT NULL CHECK(guess IN ('even','odd')),",
    "stake INTEGER NOT NULL CHECK(stake>0),",
    "die_one INTEGER NOT NULL CHECK(die_one BETWEEN 1 AND 6),",
    "die_two INTEGER NOT NULL CHECK(die_two BETWEEN 1 AND 6),",
    "won INTEGER NOT NULL CHECK(won IN (0,1)),",
    "delta INTEGER NOT NULL,played_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_dice_rounds_user_time_idx",
    "ON arcade_dice_rounds(user_id,id);"
  ].join(" "));
}
function gameHere(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(ARCADE_SYMBOL);
}
function previousRound(db,userId,requestId){
  return db.prepare([
    "SELECT guess,stake,die_one,die_two,won,delta,played_at",
    "FROM arcade_dice_rounds WHERE user_id=? AND request_id=?"
  ].join(" ")).get(userId,requestId);
}
function publicRound(row){
  return {
    guess:row.guess,stake:row.stake,dieOne:row.die_one,dieTwo:row.die_two,
    total:row.die_one+row.die_two,won:Boolean(row.won),
    delta:row.delta,playedAt:row.played_at
  };
}
export function playArcadeDice(db,userId,source,{guess,stake,requestId,now,
  randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !["even","odd"].includes(guess)||
     !Number.isSafeInteger(stake)||!source?.rates?.includes(stake)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||
     typeof randomIndex!=="function")
    throw new Error("骰子遊戲請求格式、選項或原版下注額不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=previousRound(db,userId,requestId);
    if(previous){
      if(previous.guess!==guess||previous.stake!==stake)
        throw new Error("相同骰子遊戲請求碼不可更換猜測或下注金額");
      db.exec("COMMIT");
      return {...publicRound(previous),replayed:true};
    }
    const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!char)throw new Error("請先建立角色");
    if(!gameHere(db,char.town_id))
      throw new Error("目前所在城鎮沒有原版遊樂中心");
    const last=db.prepare([
      "SELECT played_at FROM arcade_dice_rounds WHERE user_id=?",
      "ORDER BY id DESC LIMIT 1"
    ].join(" ")).get(userId)?.played_at;
    if(last!==undefined&&now<last+source.cooldownMs)
      throw new Error("骰子遊戲每次相隔5分鐘，尚需 "+Math.ceil((last+source.cooldownMs-now)/1000)+" 秒");
    // 原版 motiganeseigen='no' 可借未持有的錢下注；Web 拒絕餘額不足以防止負現金。
    if(!Number.isSafeInteger(char.money)||char.money<stake)
      throw new Error("下注現金不足，Web 不允許負數現金下注");
    const roll=randomIndex(36);
    if(!Number.isSafeInteger(roll)||roll<0||roll>=36)
      throw new Error("骰子亂數超出原版0～35範圍");
    const dieOne=Math.floor(roll/6)+1,dieTwo=roll%6+1;
    const won=((dieOne+dieTwo)%2===0)===(guess==="even");
    const delta=won?stake:-stake;
    if(won&&char.money>Number.MAX_SAFE_INTEGER-stake)
      throw new Error("骰子中獎會使現金超出安全整數範圍");
    const updated=db.prepare([
      "UPDATE characters SET money=money+? WHERE user_id=?",
      "AND money>=? AND money<=?"
    ].join(" ")).run(delta,userId,stake,Number.MAX_SAFE_INTEGER-Math.max(0,delta));
    if(updated.changes!==1)throw new Error("骰子下注現金不足或超出範圍");
    db.prepare([
      "INSERT INTO arcade_dice_rounds(",
      "user_id,request_id,guess,stake,die_one,die_two,won,delta,played_at)",
      "VALUES(?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,guess,stake,dieOne,dieTwo,won?1:0,delta,now);
    db.exec("COMMIT");
    return {guess,stake,dieOne,dieTwo,total:dieOne+dieTwo,won,delta,playedAt:now,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function arcadeDiceOverview(db,userId,source,now){
  const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
  if(!char)return {available:false,rates:source.rates,cooldownMs:source.cooldownMs,
    readyAt:null,history:[]};
  const available=gameHere(db,char.town_id);
  const history=db.prepare([
    "SELECT guess,stake,die_one,die_two,won,delta,played_at",
    "FROM arcade_dice_rounds WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,source.historyLimit).map(publicRound);
  return {available,rates:source.rates,cooldownMs:source.cooldownMs,
    readyAt:history.length?history[0].playedAt+source.cooldownMs:null,history};
}
