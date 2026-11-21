// 第56階段：依原版 gamerand.cgi → donut.cgi::donus4 移植 High／Low。
// 原版是所有人共用一個牌桌、每人十分鐘限制；Web 單機允許同人隔十分鐘接續。
// 來源空檔的首次參考牌為 Perl 數值 0（原版邏輯），不是私自抽一張起始牌。
import {randomInt} from "node:crypto";
import {readTownMap} from "./town-storage.mjs";

export const HIGHLOW_SYMBOL="ゲーセン";
export const HIGHLOW_BASE_STAKE=10000;
export const HIGHLOW_COOLDOWN_MS=600000;
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;

export function parseOriginalArcadeHighLow(gamerandSource,donutSource,settingsSource){
  if([gamerandSource,donutSource,settingsSource].some(s=>typeof s!=="string"))
    throw new Error("原版 High／Low 的入口、執行檔或設定檔來源缺失");
  const from=donutSource.indexOf("sub donus4 {");
  if(from<0||!gamerandSource.includes("<>donus4<>"))
    throw new Error("原版遊樂中心沒有可執行的 High／Low 入口");
  const highLow=donutSource.slice(from);
  const stake=Number(/\$donuts_kakekin4\s*=\s*["'](\d+)["'];/.exec(donutSource)?.[1]);
  const cooldownMinutes=Number(/\$crad_game_time\s*=\s*["'](\d+)["'];/.exec(settingsSource)?.[1]);
  const multiplier=Number(/\$doroubai\s*=\s*(\d+)\s*;/.exec(donutSource)?.[1]);
  if(stake!==10000||cooldownMinutes!==10||multiplier!==2||
     !/\$dorou\s*=\s*'セーフ'\s*;/.test(donutSource)||
     !highLow.includes("int(rand(5))+1")||
     !highLow.includes('if ($do_narandacard eq ""){$do_narandacard = 1;}')||
     !highLow.includes("$kingaku = $card_suu * 10000")||
     !highLow.includes("$randed == $do_hiitakard")||
     !highLow.includes("$kingaku *= $doroubai")||
     !highLow.includes("$randed < $do_hiitakard && $in{'kake'} eq 'hi'")||
     !highLow.includes("$randed > $do_hiitakard && $in{'kake'} eq 'low'")||
     !highLow.includes("$money -= $kingaku")||
     !highLow.includes("$money += $kingaku")||
     !highLow.includes("$do_narandacard = \"$do_narandacard\" . \"$randed\"")||
     !highLow.includes("$do_narandacard = \"$randed\"")||
     !highLow.includes("if ($now_time - $do2_last < 60*$crad_game_time)"))
    throw new Error("原版 High／Low 牌面、勝負、同點倍率、下注或10分鐘規則已變更");
  return Object.freeze({baseStake:stake,cooldownMs:cooldownMinutes*60000,
    tieMultiplier:multiplier,cardFaces:Object.freeze([1,2,3,4,5])});
}

export function initArcadeHighLowTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_highlow_state(",
    "id INTEGER PRIMARY KEY CHECK(id=1),",
    "previous_card INTEGER CHECK(previous_card BETWEEN 1 AND 5),",
    "card_chain TEXT NOT NULL,updated_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS arcade_highlow_rounds(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "guess TEXT NOT NULL CHECK(guess IN ('hi','low')),",
    "previous_card INTEGER CHECK(previous_card BETWEEN 1 AND 5),",
    "drawn_card INTEGER NOT NULL CHECK(drawn_card BETWEEN 1 AND 5),",
    "cards_before INTEGER NOT NULL CHECK(cards_before>0),",
    "cards_after INTEGER NOT NULL CHECK(cards_after>0),",
    "stake INTEGER NOT NULL CHECK(stake>0),",
    "tie INTEGER NOT NULL CHECK(tie IN (0,1)),",
    "won INTEGER NOT NULL CHECK(won IN (0,1)),",
    "delta INTEGER NOT NULL,played_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_highlow_rounds_user_id_idx",
    "ON arcade_highlow_rounds(user_id,id);"
  ].join(" "));
  // 原版空白 donutslog4.cgi 初始化成一張「1」牌，上一位抽的牌未設定。
  db.prepare("INSERT OR IGNORE INTO arcade_highlow_state(id,previous_card,card_chain,updated_at) VALUES(1,NULL,'1',0)").run();
}

function tableState(db){
  const data=db.prepare("SELECT previous_card,card_chain FROM arcade_highlow_state WHERE id=1").get();
  if(!data||typeof data.card_chain!=="string"||
      !/^[1-5]+$/.test(data.card_chain)||
      (data.previous_card!==null&&
        (!Number.isSafeInteger(data.previous_card)||data.previous_card<1||
        data.previous_card>5||data.card_chain.at(-1)!==String(data.previous_card))))
    throw new Error("High／Low 牌桌資料不正確");
  return data;
}
const toPublicRound=row=>({
  guess:row.guess,previousCard:row.previous_card,drawnCard:row.drawn_card,
  cardsBefore:row.cards_before,cardsAfter:row.cards_after,
  stake:row.stake,tie:Boolean(row.tie),won:Boolean(row.won),
  delta:row.delta,playedAt:row.played_at
});
function lastPlayedAt(db,userId){
  return db.prepare("SELECT played_at FROM arcade_highlow_rounds WHERE user_id=? ORDER BY id DESC LIMIT 1")
    .get(userId)?.played_at;
}
function availableHere(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(HIGHLOW_SYMBOL);
}

export function arcadeHighLowOverview(db,userId,source,now){
  const character=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
  const table=tableState(db);
  const stake=table.card_chain.length*source.baseStake;
  if(!Number.isSafeInteger(stake))throw new Error("High／Low 累計牌數超出安全下注範圍");
  const history=db.prepare([
    "SELECT guess,previous_card,drawn_card,cards_before,cards_after,",
    "stake,tie,won,delta,played_at FROM arcade_highlow_rounds",
    "WHERE user_id=? ORDER BY id DESC LIMIT 20"
  ].join(" ")).all(userId).map(toPublicRound);
  const last=lastPlayedAt(db,userId);
  return {available:character?availableHere(db,character.town_id):false,
    previousCard:table.previous_card,cardCount:table.card_chain.length,
    recentCards:table.card_chain.slice(-20).split("").map(Number),stake,
    cooldownMs:source.cooldownMs,tieMultiplier:source.tieMultiplier,
    readyAt:last===undefined?null:last+source.cooldownMs,history};
}

export function playArcadeHighLow(db,userId,source,{guess,requestId,now,
  randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<1||
     !["hi","low"].includes(guess)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof randomIndex!=="function")
    throw new Error("High／Low 請求格式或猜測不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare([
      "SELECT guess,previous_card,drawn_card,cards_before,cards_after,",
      "stake,tie,won,delta,played_at FROM arcade_highlow_rounds",
      "WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(prior){
      if(prior.guess!==guess)throw new Error("相同 High／Low 請求碼不可更改猜測");
      db.exec("COMMIT");
      return {...toPublicRound(prior),replayed:true};
    }
    const character=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!availableHere(db,character.town_id))
      throw new Error("目前城鎮沒有原版遊樂中心");
    const last=lastPlayedAt(db,userId);
    if(last!==undefined&&now<last+source.cooldownMs)
      throw new Error("High／Low 每局須間隔10分鐘，還差 "+
        Math.ceil((last+source.cooldownMs-now)/1000)+" 秒");
    const table=tableState(db);
    const cardsBefore=table.card_chain.length,stake=cardsBefore*source.baseStake;
    if(!Number.isSafeInteger(stake)||stake<=0)
      throw new Error("High／Low 牌桌累積金額超過安全範圍");
    // 原版 donus4 按這個數額檢查持有現金，Web 在伺服器重驗以防負現金。
    if(!Number.isSafeInteger(character.money)||character.money<stake)
      throw new Error("High／Low 下注現金不足");
    const roll=randomIndex(5);
    if(!Number.isSafeInteger(roll)||roll<0||roll>=5)
      throw new Error("High／Low 伺服器抽牌超出1～5範圍");
    const drawnCard=roll+1;
    // 原版空資料時 $do_hiitakard 為空；Perl 數字比較視為0。
    const compare=table.previous_card??0;
    const tie=drawnCard===compare;
    const won=tie||(guess==="hi"?drawnCard>compare:drawnCard<compare);
    const delta=won?stake*(tie?source.tieMultiplier:1):-stake;
    if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(character.money+delta)||
       character.money+delta<0)
      throw new Error("High／Low 結算金額超出安全範圍");
    const after=won?table.card_chain+drawnCard:String(drawnCard);
    if(after.length*source.baseStake>Number.MAX_SAFE_INTEGER)
      throw new Error("High／Low 累計牌桌無法安全繼續下注");
    const settled=db.prepare([
      "UPDATE characters SET money=money+? WHERE user_id=?",
      "AND money>=? AND money<=?"
    ].join(" ")).run(delta,userId,stake,Number.MAX_SAFE_INTEGER-Math.max(delta,0));
    if(settled.changes!==1)throw new Error("High／Low 無法完成現金結算");
    db.prepare("UPDATE arcade_highlow_state SET previous_card=?,card_chain=?,updated_at=? WHERE id=1")
      .run(drawnCard,after,now);
    db.prepare([
      "INSERT INTO arcade_highlow_rounds(",
      "user_id,request_id,guess,previous_card,drawn_card,cards_before,cards_after,",
      "stake,tie,won,delta,played_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,guess,table.previous_card,drawnCard,
      cardsBefore,after.length,stake,tie?1:0,won?1:0,delta,now);
    db.exec("COMMIT");
    return {guess,previousCard:table.previous_card,drawnCard,cardsBefore,
      cardsAfter:after.length,stake,tie,won,delta,playedAt:now,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
