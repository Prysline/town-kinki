// 第60階段：原版 gamerand.cgi → cardw2.cgi::cardw 多卡遊戲。
// 原版 CGI 顯示「80/65/50/35/20%」，但實際比較 <= 導致成功為 79/64/49/34/19%。
// fork 的 log_dir/cardw_log2.cgi 是空檔；共用牌桌從 rate 1 開始，不匯入舊玩家。
import {randomInt} from "node:crypto";
import {readTownMap} from "./town-storage.mjs";

export const CARDW_SYMBOL="ゲーセン";
export const CARDW_HISTORY_LIMIT=20;
export const CARDW_SOLO_REPEAT_MS=5000;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const UNITS=Object.freeze([10000,100000,1000000,10000000,100000000]);
const DISPLAY_THRESHOLDS=Object.freeze([80,65,50,35,20]);
const EFFECTIVE_PERCENT=Object.freeze(DISPLAY_THRESHOLDS.map(n=>n-1));

function originalArray(source,name){
  const found=new RegExp("@"+name+"\\s*=\\s*\\(([^)]*)\\)\\s*;").exec(source);
  return found?.[1]?.match(/\d+/g)?.map(Number)??[];
}
export function parseOriginalMultiCard(gamerandSource,cardwSource,settingsSource){
  if([gamerandSource,cardwSource,settingsSource].some(s=>typeof s!=="string"))
    throw new Error("原版多卡入口或執行來源缺失");
  const rates=originalArray(cardwSource,"cardw_r");
  const thresholds=originalArray(cardwSource,"cardw_atari");
  const minutes=originalArray(cardwSource,"cardw_k_time");
  const basicLimit=Number(/\$koudou_seigen\s*=\s*['"](\d+)['"]\s*;/.exec(settingsSource)?.[1]);
  if(!gamerandSource.includes('action="cardw2.cgi"')||
     !gamerandSource.includes("<>cardw<>")||
     !cardwSource.includes("sub cardw")||
     !cardwSource.includes('$cardw_chk=0;')||
     !cardwSource.includes("$randed = int(rand(100))+1;")||
     !cardwSource.includes("if($cardw_atari[$in{'chk'}] <= $randed)")||
     !cardwSource.includes("if ($name eq $do_name)")||
     !cardwSource.includes("if ($now_time - $do2_last < 60*$cardw_k_time[$in{'chk'}])")||
     !cardwSource.includes("$money -= $cardw_r[$in{'chk'}]*$card_suu")||
     !cardwSource.includes("$money += $cardw_r[$in{'chk'}]*$card_suu")||
     !cardwSource.includes("$card_suu++")||
     !cardwSource.includes("$card_suu =1")||
     !cardwSource.includes('if($card_suu eq ""){$card_suu=1;}')||
     rates.length!==5||rates.some((v,i)=>v!==UNITS[i])||
     thresholds.length!==5||thresholds.some((v,i)=>v!==DISPLAY_THRESHOLDS[i])||
     minutes.length!==5||minutes.some(v=>v!==0)||
     basicLimit!==5)
    throw new Error("原版多卡遊戲來源、判定、金額或連抽設定已變更");
  return Object.freeze({
    courses:Object.freeze(UNITS.map((unit,course)=>Object.freeze({
      course,unit,displayPercent:DISPLAY_THRESHOLDS[course],
      actualPercent:EFFECTIVE_PERCENT[course],originalCooldownMinutes:0
    }))),
    soloRepeatMs:basicLimit*1000,originalAdjacentRepeatAllowed:false
  });
}
export function initMultiCardTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_cardw_state(",
    "id INTEGER PRIMARY KEY CHECK(id=1),",
    "card_count INTEGER NOT NULL CHECK(card_count>0),",
    "last_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,",
    "updated_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS arcade_cardw_rounds(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "course INTEGER NOT NULL CHECK(course BETWEEN 0 AND 4),",
    "card_count_before INTEGER NOT NULL CHECK(card_count_before>0),",
    "card_count_after INTEGER NOT NULL CHECK(card_count_after>0),",
    "stake INTEGER NOT NULL CHECK(stake>0),",
    "display_percent INTEGER NOT NULL,",
    "actual_percent INTEGER NOT NULL,",
    "roll INTEGER NOT NULL CHECK(roll BETWEEN 1 AND 100),",
    "won INTEGER NOT NULL CHECK(won IN(0,1)),",
    "delta INTEGER NOT NULL,played_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_cardw_user_idx",
    "ON arcade_cardw_rounds(user_id,id);"
  ].join(" "));
  db.prepare("INSERT OR IGNORE INTO arcade_cardw_state(id,card_count,last_user_id,updated_at) VALUES(1,1,NULL,0)").run();
}
function state(db){
  const row=db.prepare("SELECT card_count,last_user_id,updated_at FROM arcade_cardw_state WHERE id=1").get();
  if(!row||!Number.isSafeInteger(row.card_count)||row.card_count<=0)
    throw new Error("多卡遊戲共用倍率存檔異常");
  return row;
}
function quote(source,cardCount){
  return source.courses.map(course=>{
    const stake=cardCount*course.unit;
    return {...course,stake,safe:Number.isSafeInteger(stake)&&stake>0};
  });
}
const roundPublic=row=>({
  course:row.course,cardsBefore:row.card_count_before,cardsAfter:row.card_count_after,
  stake:row.stake,displayPercent:row.display_percent,
  actualPercent:row.actual_percent,roll:row.roll,won:Boolean(row.won),
  delta:row.delta,playedAt:row.played_at
});
function availableHere(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(CARDW_SYMBOL);
}
function lastOwnRound(db,userId){
  return db.prepare("SELECT played_at FROM arcade_cardw_rounds WHERE user_id=? ORDER BY id DESC LIMIT 1")
    .get(userId)?.played_at;
}
export function multiCardOverview(db,userId,source,now,{solo=false}={}){
  const char=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  const current=state(db);
  const last=lastOwnRound(db,userId);
  const history=db.prepare([
    "SELECT course,card_count_before,card_count_after,stake,",
    "display_percent,actual_percent,roll,won,delta,played_at",
    "FROM arcade_cardw_rounds WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,CARDW_HISTORY_LIMIT).map(roundPublic);
  const samePlayer=current.last_user_id===userId;
  return {available:char?availableHere(db,char.town_id):false,
    cardCount:current.card_count,lastPlayerIsMe:samePlayer,
    soloRepeatMs:source.soloRepeatMs,
    readyAt:solo&&samePlayer&&last!==undefined?last+source.soloRepeatMs:null,
    multiplayerAdjacentRepeatBlocked:!solo&&samePlayer,
    courses:quote(source,current.card_count),history};
}
export function playMultiCard(db,userId,source,{course,requestId,now,
  solo=false,randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !Number.isInteger(course)||course<0||course>=source?.courses?.length||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||
     typeof solo!=="boolean"||typeof randomIndex!=="function")
    throw new Error("多卡遊戲下注模式或請求碼不正確");
  const original=source.courses[course];
  if(original.unit!==UNITS[course]||original.displayPercent!==DISPLAY_THRESHOLDS[course]||
     original.actualPercent!==EFFECTIVE_PERCENT[course])
    throw new Error("多卡遊戲原版機率設定驗證失敗");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare([
      "SELECT course,card_count_before,card_count_after,stake,",
      "display_percent,actual_percent,roll,won,delta,played_at",
      "FROM arcade_cardw_rounds WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(prior){
      if(prior.course!==course)throw new Error("同一多卡請求碼不可改變下注課程");
      db.exec("COMMIT");
      return {...roundPublic(prior),replayed:true};
    }
    const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!char)throw new Error("請先建立角色");
    if(!availableHere(db,char.town_id))
      throw new Error("目前城鎮沒有原版遊樂中心");
    const table=state(db);
    if(table.last_user_id===userId){
      if(!solo)throw new Error("原版多卡禁止同一位玩家連續抽卡，請等待其他玩家");
      const last=lastOwnRound(db,userId);
      if(last!==undefined&&now<last+source.soloRepeatMs)
        throw new Error("單機多卡尚在五秒操作間隔內");
    }
    const stake=table.card_count*original.unit;
    if(!Number.isSafeInteger(stake)||stake<=0)
      throw new Error("多卡遊戲賭注超出安全整數範圍");
    if(!Number.isSafeInteger(char.money)||char.money<stake)
      throw new Error("原版多卡下注現金不足");
    const index=randomIndex(100);
    if(!Number.isInteger(index)||index<0||index>=100)
      throw new Error("伺服器多卡抽卡亂數超出1～100範圍");
    const roll=index+1;
    // 原版 if (顯示機率 <= rand(1..100)) -> lose；故抽出 rand < 門檻才贏。
    const won=roll<original.displayPercent;
    const delta=won?stake:-stake;
    const newBalance=char.money+delta;
    if(!Number.isSafeInteger(newBalance)||newBalance<0)
      throw new Error("多卡遊戲現金結算超出安全整數範圍");
    const after=won?table.card_count+1:1;
    if(!Number.isSafeInteger(after)||!Number.isSafeInteger(after*UNITS.at(-1)))
      throw new Error("多卡遊戲共用倍率超出安全整數範圍");
    const changed=db.prepare("UPDATE characters SET money=money+? WHERE user_id=? AND money>=? AND money<=?")
      .run(delta,userId,stake,Number.MAX_SAFE_INTEGER-Math.max(delta,0));
    if(changed.changes!==1)throw new Error("多卡遊戲現金結算失敗");
    db.prepare("UPDATE arcade_cardw_state SET card_count=?,last_user_id=?,updated_at=? WHERE id=1")
      .run(after,userId,now);
    db.prepare([
      "INSERT INTO arcade_cardw_rounds(user_id,request_id,course,card_count_before,",
      "card_count_after,stake,display_percent,actual_percent,roll,won,delta,played_at)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,course,table.card_count,after,stake,
      original.displayPercent,original.actualPercent,roll,won?1:0,delta,now);
    db.exec("COMMIT");
    return {course,cardsBefore:table.card_count,cardsAfter:after,stake,
      displayPercent:original.displayPercent,actualPercent:original.actualPercent,
      roll,won,delta,playedAt:now,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
