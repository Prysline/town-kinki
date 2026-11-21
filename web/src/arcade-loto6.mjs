// 第59階段：原版 gamerand.cgi → loto6.cgi::loto_game。
// 「六號樂透」與第58階段的即時六位數 loto.cgi 是完全不同的遊戲。
// 只有實際存取/購買時才開獎，絕不在背景執行或偽造自動排程。
import {randomInt} from "node:crypto";
import {readTownMap} from "./town-storage.mjs";
import {settleBankInterestInTransaction,recordBankEntry} from "./banking.mjs";

export const LOTO6_SYMBOL="ゲーセン";
export const LOTO6_HISTORY_LIMIT=20;
export const LOTO6_PRICE=2500;
export const LOTO6_DRAW_HOUR=6;
export const LOTO6_PER_USER_LIMIT=20;
export const LOTO6_DRAW_CAP=200;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const PRIZES=Object.freeze([0,2500,5000,100000,1000000,10000000,100000000]);

export function parseOriginalLoto6(gamerandSource,lotoSource){
  if(typeof gamerandSource!=="string"||typeof lotoSource!=="string")
    throw new Error("原版六號樂透入口或執行程式來源缺失");
  const read=(name)=>Number(new RegExp("\\$"+name+"\\s*=\\s*(\\d+)\\s*;").exec(lotoSource)?.[1]);
  const prize=(/@syokin_hairetu\s*=\s*\(([^)]*)\)\s*;/.exec(lotoSource)?.[1]??"")
    .match(/\d+/g)?.map(Number)??[];
  if(!gamerandSource.includes('action="loto6.cgi"')||
     !gamerandSource.includes("<>loto_game<>")||
     !lotoSource.includes('if($in{\'mode\'} eq "loto_game"){&loto_game;}')||
     read("loto_n")!==36||read("koniyukingaku")!==LOTO6_PRICE||
     read("koushinjikan")!==LOTO6_DRAW_HOUR||
     read("saidaisanka")!==LOTO6_DRAW_CAP||
     read("hitri_konu_zyougen")!==LOTO6_PER_USER_LIMIT||
     prize.length!==PRIZES.length||prize.some((v,i)=>v!==PRIZES[i])||
     !lotoSource.includes('($koushin > $hour && $higawri == 1) || $hinichi ne $mday')||
     !lotoSource.includes('$hour >= $koushinjikan && $higawri == 0 || $#loto_konuu_data +1 >= $saidaisanka')||
     !lotoSource.includes('@loto_tusen = &randcheck($loto_n,6)')||
     !lotoSource.includes('$loto_atari = $syokin_hairetu[$atari]')||
     !lotoSource.includes('$aite_bank += $sougou_syokin')||
     !lotoSource.includes('$money -= $koniyukingaku')||
     !lotoSource.includes('if ($hitri_konu_zyougen <= $maisu )')||
     !lotoSource.includes('@loto = &randcheck($loto_n,6)'))
    throw new Error("原版六號樂透開獎、下注、獎金或銀行入帳規則已變更");
  return Object.freeze({numberMax:36,choose:6,price:LOTO6_PRICE,
    drawHour:LOTO6_DRAW_HOUR,perUserLimit:LOTO6_PER_USER_LIMIT,
    drawCap:LOTO6_DRAW_CAP,prizes:PRIZES});
}

export function initLoto6Tables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_loto6_state(",
    "id INTEGER PRIMARY KEY CHECK(id=1),",
    "last_draw_day TEXT NOT NULL,",
    "last_draw_at INTEGER NOT NULL DEFAULT 0);",
    "CREATE TABLE IF NOT EXISTS arcade_loto6_draws(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "day TEXT NOT NULL,drawn_json TEXT NOT NULL,",
    "reason TEXT NOT NULL CHECK(reason IN ('06:00','200 tickets')),",
    "ticket_count INTEGER NOT NULL,drawn_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS arcade_loto6_tickets(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "chosen_json TEXT NOT NULL,",
    "bought_at INTEGER NOT NULL,",
    "draw_id INTEGER REFERENCES arcade_loto6_draws(id),",
    "matches INTEGER CHECK(matches BETWEEN 0 AND 6),",
    "prize INTEGER CHECK(prize>=0),",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_loto6_pending_idx",
    "ON arcade_loto6_tickets(draw_id,id);",
    "CREATE INDEX IF NOT EXISTS arcade_loto6_user_idx",
    "ON arcade_loto6_tickets(user_id,id);"
  ].join(" "));
  db.prepare("INSERT OR IGNORE INTO arcade_loto6_state(id,last_draw_day,last_draw_at) VALUES(1,'',0)").run();
}

const validNumbers=numbers=>Array.isArray(numbers)&&numbers.length===6&&
  numbers.every(x=>Number.isInteger(x)&&x>=1&&x<=36)&&new Set(numbers).size===6;
function clock(now,timeZone){
  if(!Number.isSafeInteger(now)||now<=0||typeof timeZone!=="string")
    throw new Error("六號樂透時間資料不正確");
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",
    hourCycle:"h23"
  }).formatToParts(new Date(now));
  const part=name=>parts.find(x=>x.type===name)?.value;
  const day=[part("year"),part("month"),part("day")].join("-");
  const hour=Number(part("hour"));
  if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isInteger(hour)||hour<0||hour>23)
    throw new Error("無法讀取六號樂透當地日期");
  return {day,hour};
}
function pendingCount(db){
  return db.prepare("SELECT COUNT(*) n FROM arcade_loto6_tickets WHERE draw_id IS NULL").get().n;
}
function drawDue(db,source,now,timeZone){
  const {day,hour}=clock(now,timeZone);
  const state=db.prepare("SELECT last_draw_day FROM arcade_loto6_state WHERE id=1").get();
  if(!state)throw new Error("原版六號樂透抽獎狀態缺失");
  const pending=pendingCount(db);
  const dueHour=hour>=source.drawHour&&state.last_draw_day!==day;
  const capReached=pending>=source.drawCap;
  return {due:dueHour||capReached,reason:dueHour?"06:00":capReached?"200 tickets":null,
    day,hour,pending,lastDrawDay:state.last_draw_day};
}
function pickSix(randomIndex){
  const selected=new Set();
  for(let attempt=0;selected.size<6&&attempt<400;attempt++){
    const n=randomIndex(36);
    if(!Number.isInteger(n)||n<0||n>=36)
      throw new Error("伺服器六號樂透開獎亂數不符合1～36範圍");
    selected.add(n+1);
  }
  if(selected.size!==6)throw new Error("六號樂透開獎亂數無法選出六個不重複數字");
  return [...selected].sort((a,b)=>a-b);
}
const ticketPublic=row=>({
  id:row.id,numbers:JSON.parse(row.chosen_json),boughtAt:row.bought_at,
  pending:row.draw_id===null,matches:row.matches,prize:row.prize,drawId:row.draw_id
});
function drawInside(db,source,now,timeZone,randomIndex){
  const status=drawDue(db,source,now,timeZone);
  if(!status.due)return {drawn:false,reason:null};
  const winning=pickSix(randomIndex),winningSet=new Set(winning);
  const tickets=db.prepare([
    "SELECT id,user_id,chosen_json FROM arcade_loto6_tickets",
    "WHERE draw_id IS NULL ORDER BY user_id,id"
  ].join(" ")).all();
  const sums=new Map();
  const awards=tickets.map(ticket=>{
    const chosen=JSON.parse(ticket.chosen_json);
    if(!validNumbers(chosen))throw new Error("已售六號樂透彩券存檔異常");
    const hits=chosen.filter(n=>winningSet.has(n)).length;
    const prize=source.prizes[hits];
    sums.set(ticket.user_id,(sums.get(ticket.user_id)??0)+prize);
    return {id:ticket.id,matches:hits,prize};
  });
  const draw=db.prepare([
    "INSERT INTO arcade_loto6_draws(day,drawn_json,reason,ticket_count,drawn_at)",
    "VALUES(?,?,?,?,?)"
  ].join(" ")).run(status.day,JSON.stringify(winning),status.reason,tickets.length,now);
  const drawId=Number(draw.lastInsertRowid);
  for(const ticket of awards){
    db.prepare("UPDATE arcade_loto6_tickets SET draw_id=?,matches=?,prize=? WHERE id=?")
      .run(drawId,ticket.matches,ticket.prize,ticket.id);
  }
  for(const [userId,prize] of sums){
    if(!Number.isSafeInteger(prize)||prize<0)
      throw new Error("六號樂透獎金總額超出安全範圍");
    const exists=db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId);
    if(!exists)throw new Error("六號樂透中獎玩家存檔不存在");
    // 在銀行獎金入帳前結算該玩家當日應有利息，避免新獎金當日重複生息。
    settleBankInterestInTransaction(db,userId,status.day,now);
    if(!prize)continue;
    const bank=db.prepare("SELECT bank FROM characters WHERE user_id=?").get(userId).bank;
    if(!Number.isSafeInteger(bank)||bank<0||
       !Number.isSafeInteger(bank+prize))
      throw new Error("六號樂透銀行獎金入帳超出安全範圍");
    const newBalance=bank+prize;
    db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(newBalance,userId);
    recordBankEntry(db,userId,"ordinary","六號樂透中獎金",0,prize,newBalance,now);
  }
  db.prepare("UPDATE arcade_loto6_state SET last_draw_day=?,last_draw_at=? WHERE id=1")
    .run(status.day,now);
  return {drawn:true,drawId,day:status.day,reason:status.reason,
    winningNumbers:winning,ticketCount:tickets.length,
    totalPrize:[...sums.values()].reduce((s,n)=>s+n,0),drawnAt:now};
}

export function settleLoto6Draw(db,source,{now,timeZone="Asia/Taipei",
  randomIndex=randomInt}={}){
  if(typeof randomIndex!=="function")throw new Error("缺少六號樂透抽號來源");
  db.exec("BEGIN IMMEDIATE");
  try{
    const result=drawInside(db,source,now,timeZone,randomIndex);
    db.exec("COMMIT");return result;
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function buyLoto6Ticket(db,userId,source,{numbers,requestId,now,
  timeZone="Asia/Taipei",randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||!validNumbers(numbers)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     typeof randomIndex!=="function")
    throw new Error("六號樂透六個號碼或購買請求格式不正確");
  clock(now,timeZone);
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare([
      "SELECT id,chosen_json,bought_at,draw_id,matches,prize",
      "FROM arcade_loto6_tickets WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(prior){
      if(prior.chosen_json!==JSON.stringify(numbers))
        throw new Error("相同六號樂透購券識別碼不可更換選號");
      db.exec("COMMIT");return {...ticketPublic(prior),replayed:true};
    }
    const char=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!char)throw new Error("請先建立角色");
    const map=readTownMap(db,char.town_id);
    if(!map.configured||!map.tiles.includes(LOTO6_SYMBOL))
      throw new Error("目前城鎮沒有原版遊樂中心");
    // 原版在購票前處理本次進入頁面應發生的開獎，避免買到已封盤的彩券。
    const beforeDraw=drawInside(db,source,now,timeZone,randomIndex);
    const perUser=db.prepare([
      "SELECT COUNT(*) n FROM arcade_loto6_tickets",
      "WHERE user_id=? AND draw_id IS NULL"
    ].join(" ")).get(userId).n;
    if(perUser>=source.perUserLimit)
      throw new Error("六號樂透本輪每人最多20注");
    if(pendingCount(db)>=source.drawCap)
      throw new Error("六號樂透本輪彩券已達200注，請先開獎");
    const updated=db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
      .run(source.price,userId,source.price);
    if(updated.changes!==1)throw new Error("六號樂透身上現金不足以買券");
    const ticket=db.prepare([
      "INSERT INTO arcade_loto6_tickets(user_id,request_id,chosen_json,bought_at)",
      "VALUES(?,?,?,?)"
    ].join(" ")).run(userId,requestId,JSON.stringify(numbers),now);
    db.exec("COMMIT");
    return {id:Number(ticket.lastInsertRowid),numbers:[...numbers],
      boughtAt:now,pending:true,price:source.price,
      drawTriggered:beforeDraw.drawn,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function loto6Overview(db,userId,source,now,timeZone="Asia/Taipei"){
  const status=drawDue(db,source,now,timeZone);
  const char=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  const map=char?readTownMap(db,char.town_id):null;
  const last=db.prepare("SELECT id,day,drawn_json,reason,ticket_count,drawn_at FROM arcade_loto6_draws ORDER BY id DESC LIMIT 1").get();
  const history=db.prepare([
    "SELECT id,chosen_json,bought_at,draw_id,matches,prize",
    "FROM arcade_loto6_tickets WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,LOTO6_HISTORY_LIMIT).map(ticketPublic);
  const ownedPending=db.prepare([
    "SELECT COUNT(*) n FROM arcade_loto6_tickets WHERE user_id=? AND draw_id IS NULL"
  ].join(" ")).get(userId).n;
  return {available:Boolean(map?.configured&&map.tiles.includes(LOTO6_SYMBOL)),
    numberMax:source.numberMax,choose:source.choose,price:source.price,
    drawHour:source.drawHour,perUserLimit:source.perUserLimit,drawCap:source.drawCap,
    prizes:source.prizes,timeZone,day:status.day,hour:status.hour,
    due:status.due,dueReason:status.reason,
    pendingCount:status.pending,myPendingCount:ownedPending,
    lastDraw:last?{id:last.id,day:last.day,numbers:JSON.parse(last.drawn_json),
      reason:last.reason,ticketCount:last.ticket_count,drawnAt:last.drawn_at}:null,
    history};
}
