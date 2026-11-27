// 第57階段：原版 donut.cgi 的 donus／donus2／donus3，三張獨立共用牌桌。
// 各模式的抽牌／輸贏／賭注以 CGI 執行分支為準，Web 另外提供原子結算與防重送。
import {randomInt} from "node:crypto";
import {readTownMap} from "./town-storage.mjs";

export const DONUT_ARCADE_SYMBOL="ゲーセン";
export const DONUT_HISTORY_LIMIT=20;
export const DONUT_MODES=Object.freeze(["donus","donus2","donus3"]);
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const MODE_CONFIG=Object.freeze({
  donus:Object.freeze({mode:"donus",label:"不同點數 × 1萬元",unit:10000,faces:5,
    rule:"different",cooldownMs:5000,originalCardCooldownMs:0}),
  donus2:Object.freeze({mode:"donus2",label:"不同點數 × 2萬元",unit:20000,faces:5,
    rule:"different",cooldownMs:600000,originalCardCooldownMs:600000}),
  donus3:Object.freeze({mode:"donus3",label:"相同點數 × 10萬元",unit:100000,faces:3,
    rule:"same",cooldownMs:600000,originalCardCooldownMs:600000})
});

export function parseOriginalArcadeDonuts(gamerandSource,donutSource,settingsSource){
  if([gamerandSource,donutSource,settingsSource].some(s=>typeof s!=="string"))
    throw new Error("原版卡牌遊戲入口、執行程式或設定來源缺失");
  const sections={};
  const names=[...DONUT_MODES,"donus4"];
  for(let i=0;i<names.length;i++){
    const start=donutSource.indexOf("sub "+names[i]+" {");
    const end=i<names.length-1?donutSource.indexOf("sub "+names[i+1]+" {"):donutSource.length;
    if(start<0||end<=start)throw new Error("原版三種卡牌遊戲執行分支缺失");
    sections[names[i]]=donutSource.slice(start,end);
  }
  const prices={
    donus:/\$donuts_kakekin\s*=\s*["'](\d+)["']\s*;/,
    donus2:/\$donuts_kakekin2\s*=\s*["'](\d+)["']\s*;/,
    donus3:/\$donuts_kakekin3\s*=\s*["'](\d+)["']\s*;/
  };
  const cooldown=Number(/\$crad_game_time\s*=\s*["'](\d+)["']\s*;/.exec(settingsSource)?.[1]);
  const actionLimit=Number(/\$koudou_seigen\s*=\s*["'](\d+)["']\s*;/.exec(settingsSource)?.[1]);
  if(cooldown!==10||actionLimit!==5)
    throw new Error("原版卡牌的十分鐘間隔或全域五秒限制已變更");
  for(const mode of DONUT_MODES){
    const source=sections[mode],config=MODE_CONFIG[mode];
    const isDifferent=config.rule==="different";
    if(!gamerandSource.includes("<>"+mode+"<>")||
       Number(prices[mode].exec(donutSource)?.[1])!==config.unit||
       !source.includes('if ($do_narandacard eq ""){$do_narandacard = 1;}')||
       !source.includes("int(rand("+config.faces+"))+1")||
       !source.includes("$randed == $do_hiitakard")||
       !source.includes('$do_narandacard = "$randed"')||
       !source.includes('$do_narandacard = "$do_narandacard" . "$randed"')||
       !source.includes("$money -=")||
       !source.includes("$money +=")||
       !source.includes("if ($name eq $do_name)")||
       !source.includes("if($renzokuhiki eq 'yes')"))
      throw new Error("原版卡牌 "+mode+" 入口、抽牌或連抽規則已變更");
    if(isDifferent){
      if(!source.includes("$kingaku = $card_suu * "+config.unit)||
         !source.includes("$money -= $kingaku")||
         !source.includes("$money += $kingaku")||
         !source.includes("if ($randed == $do_hiitakard)"))
        throw new Error("原版卡牌 "+mode+" 不同點數的勝敗與下注規則已變更");
    }else if(!source.includes('if ($do_hiitakard eq ""){$do_hiitakard = 1;}')||
      !source.includes("$money += $card_suu * 100000")||
      !source.includes("$money -= 100000")){
      throw new Error("原版卡牌 donus3 同點中獎與固定失敗金額已變更");
    }
    const actualCooldown=source.split("\n").some(line=>
      !line.trim().startsWith("#")&&
      line.includes("if ($now_time - $do2_last < 60*$crad_game_time)"));
    if(actualCooldown!==(mode!=="donus"))
      throw new Error("原版卡牌 "+mode+" 的實際有效冷卻分支已變更");
  }
  return Object.freeze({modes:Object.freeze(DONUT_MODES.map(mode=>MODE_CONFIG[mode])),
    actionLimitMs:actionLimit*1000});
}

export function initArcadeDonutTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_donut_tables(",
    "mode TEXT PRIMARY KEY CHECK(mode IN ('donus','donus2','donus3')),",
    "previous_card INTEGER CHECK(previous_card BETWEEN 1 AND 5),",
    "card_chain TEXT NOT NULL,updated_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS arcade_donut_rounds(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "mode TEXT NOT NULL CHECK(mode IN ('donus','donus2','donus3')),",
    "previous_card INTEGER CHECK(previous_card BETWEEN 1 AND 5),",
    "drawn_card INTEGER NOT NULL CHECK(drawn_card BETWEEN 1 AND 5),",
    "cards_before INTEGER NOT NULL CHECK(cards_before>0),",
    "cards_after INTEGER NOT NULL CHECK(cards_after>0),",
    "risk INTEGER NOT NULL CHECK(risk>0),",
    "win_amount INTEGER NOT NULL CHECK(win_amount>0),",
    "won INTEGER NOT NULL CHECK(won IN (0,1)),",
    "delta INTEGER NOT NULL,played_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_donut_rounds_user_mode_idx",
    "ON arcade_donut_rounds(user_id,mode,id);"
  ].join(" "));
  // 此 fork 的三份原版 donutslog 檔案皆為 0 bytes，初始桌面串為「1」。
  for(const mode of DONUT_MODES)
    db.prepare("INSERT OR IGNORE INTO arcade_donut_tables(mode,previous_card,card_chain,updated_at) VALUES(?,NULL,'1',0)").run(mode);
}

function modeConfig(source,mode){
  const found=source?.modes?.find(item=>item.mode===mode);
  if(!found||!Object.hasOwn(MODE_CONFIG,mode)||
     found.unit!==MODE_CONFIG[mode].unit||found.faces!==MODE_CONFIG[mode].faces||
     found.rule!==MODE_CONFIG[mode].rule)
    throw new Error("無效的原版卡牌遊戲模式");
  return found;
}
function tableState(db,config){
  const row=db.prepare("SELECT previous_card,card_chain FROM arcade_donut_tables WHERE mode=?")
    .get(config.mode);
  if(!row||typeof row.card_chain!=="string"||
     !(config.faces===3?/^[1-3]+$/:/^[1-5]+$/).test(row.card_chain)||
     (row.previous_card!==null&&
       (!Number.isSafeInteger(row.previous_card)||row.previous_card<1||
        row.previous_card>config.faces||row.card_chain.at(-1)!==String(row.previous_card))))
    throw new Error("卡牌遊戲 "+config.mode+" 的共用牌桌資料異常");
  return row;
}
function winAndRisk(config,cardsBefore){
  const risk=config.rule==="same"?config.unit:cardsBefore*config.unit;
  const winAmount=cardsBefore*config.unit;
  if(!Number.isSafeInteger(risk)||risk<1||
     !Number.isSafeInteger(winAmount)||winAmount<1)
    throw new Error("原版卡牌桌金額已超出安全範圍");
  return {risk,winAmount};
}
function publicRound(row){
  return {mode:row.mode,previousCard:row.previous_card,drawnCard:row.drawn_card,
    cardsBefore:row.cards_before,cardsAfter:row.cards_after,risk:row.risk,
    winAmount:row.win_amount,won:Boolean(row.won),delta:row.delta,playedAt:row.played_at};
}
function playedAt(db,userId,mode){
  return db.prepare([
    "SELECT played_at FROM arcade_donut_rounds",
    "WHERE user_id=? AND mode=? ORDER BY id DESC LIMIT 1"
  ].join(" ")).get(userId,mode)?.played_at;
}
function availableHere(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(DONUT_ARCADE_SYMBOL);
}
export function arcadeDonutsOverview(db,userId,source,now){
  const character=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
  const available=character?availableHere(db,character.town_id):false;
  return {available,modes:source.modes.map(config=>{
    const table=tableState(db,config);
    const {risk,winAmount}=winAndRisk(config,table.card_chain.length);
    const last=playedAt(db,userId,config.mode);
    const history=db.prepare([
      "SELECT mode,previous_card,drawn_card,cards_before,cards_after,",
      "risk,win_amount,won,delta,played_at FROM arcade_donut_rounds",
      "WHERE user_id=? AND mode=? ORDER BY id DESC LIMIT ?"
    ].join(" ")).all(userId,config.mode,DONUT_HISTORY_LIMIT).map(publicRound);
    return {mode:config.mode,label:config.label,rule:config.rule,faces:config.faces,
      unit:config.unit,cooldownMs:config.cooldownMs,
      originalCardCooldownMs:config.originalCardCooldownMs,
      previousCard:table.previous_card,cardCount:table.card_chain.length,
      recentCards:table.card_chain.slice(-20).split("").map(Number),
      risk,winAmount,readyAt:last===undefined?null:last+config.cooldownMs,history};
  })};
}

export function playArcadeDonut(db,userId,source,{mode,requestId,now,
  randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !DONUT_MODES.includes(mode)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof randomIndex!=="function")
    throw new Error("卡牌遊戲請求格式或模式不正確");
  const config=modeConfig(source,mode);
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT mode,previous_card,drawn_card,cards_before,cards_after,",
      "risk,win_amount,won,delta,played_at FROM arcade_donut_rounds",
      "WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.mode!==mode)throw new Error("相同卡牌遊戲請求碼不可更換模式");
      db.exec("COMMIT");
      return {...publicRound(previous),replayed:true};
    }
    const character=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!availableHere(db,character.town_id))
      throw new Error("目前城鎮沒有原版遊樂中心");
    const last=playedAt(db,userId,mode);
    if(last!==undefined&&now<last+config.cooldownMs)
      throw new Error("此模式尚在冷卻，還差 "+
        Math.ceil((last+config.cooldownMs-now)/1000)+" 秒");
    const table=tableState(db,config);
    const cardsBefore=table.card_chain.length;
    const {risk,winAmount}=winAndRisk(config,cardsBefore);
    // 原版 donus1 未驗持現金；Web 對全部遊戲統一拒絕負現金。
    if(!Number.isSafeInteger(character.money)||character.money<risk)
      throw new Error("原版卡牌下注現金不足");
    const roll=randomIndex(config.faces);
    if(!Number.isSafeInteger(roll)||roll<0||roll>=config.faces)
      throw new Error("伺服器卡牌亂數超出原版範圍");
    const drawnCard=roll+1;
    // 第一/二種：初次上一張為空，Perl 數值比較0，因此一定是「不同」。
    // 第三種：原版明確把初次上一張設為1，因此第一次抽到1會中獎。
    const reference=table.previous_card??(config.rule==="same"?1:0);
    const won=config.rule==="same"?drawnCard===reference:drawnCard!==reference;
    const delta=won?winAmount:-risk;
    if(!Number.isSafeInteger(character.money+delta)||
       character.money+delta<0)
      throw new Error("卡牌遊戲現金結算超出安全整數範圍");
    const after=config.rule==="same"?
      (won?String(drawnCard):table.card_chain+drawnCard):
      (won?table.card_chain+drawnCard:String(drawnCard));
    // 下一局不可因牌串超大而溢出，仍保留實際累計數。
    if(!Number.isSafeInteger(after.length*config.unit))
      throw new Error("卡牌遊戲累積牌桌金額超過安全整數範圍");
    const updated=db.prepare([
      "UPDATE characters SET money=money+? WHERE user_id=?",
      "AND money>=? AND money<=?"
    ].join(" ")).run(delta,userId,risk,Number.MAX_SAFE_INTEGER-Math.max(0,delta));
    if(updated.changes!==1)throw new Error("卡牌遊戲現金扣款或發放失敗");
    db.prepare("UPDATE arcade_donut_tables SET previous_card=?,card_chain=?,updated_at=? WHERE mode=?")
      .run(drawnCard,after,now,mode);
    db.prepare([
      "INSERT INTO arcade_donut_rounds(",
      "user_id,request_id,mode,previous_card,drawn_card,cards_before,cards_after,",
      "risk,win_amount,won,delta,played_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,mode,table.previous_card,drawnCard,
      cardsBefore,after.length,risk,winAmount,won?1:0,delta,now);
    db.exec("COMMIT");
    return {mode,previousCard:table.previous_card,drawnCard,cardsBefore,
      cardsAfter:after.length,risk,winAmount,won,delta,playedAt:now,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
