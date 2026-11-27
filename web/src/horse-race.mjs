// GM-02: SQLite transaction layer. The existing characters.money and bank tax
// snapshot remain authoritative. Caller supplies authenticated user and game clock.
import {drawHorseRaceCard,startHorseRace,advanceHorseRace,HORSE_LOCK_SECONDS} from "./horse-race-source.mjs";
import {readTownMap} from "./town-storage.mjs";
import {assertNoActiveOnsen} from "./onsen.mjs";
import {getCockroachChallenge} from "./event-cockroach.mjs";
import {refreshBankTaxSnapshot,settleBankInterestInTransaction} from "./banking.mjs";

export const HORSE_RACE_SYMBOL="競馬";
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;
function integer(n,min=0){
  if(!Number.isSafeInteger(n)||n<min)throw Error("競馬數值超出安全範圍");
  return n;
}
export function initHorseRaceTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS horse_races(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL CHECK(town_id BETWEEN 0 AND 3),",
    "status TEXT NOT NULL CHECK(status IN ('quoted','running','completed','forfeited')),",
    "quoted_at INTEGER NOT NULL,started_at INTEGER,last_at INTEGER NOT NULL,",
    "card_json TEXT NOT NULL,horses_json TEXT,cost INTEGER NOT NULL DEFAULT 0 CHECK(cost>=0),",
    "turn INTEGER NOT NULL DEFAULT 0 CHECK(turn>=0),winner TEXT,payout INTEGER CHECK(payout>=0),",
    "UNIQUE(id,user_id));",
    "CREATE UNIQUE INDEX IF NOT EXISTS horse_global_running ON horse_races(status) WHERE status='running';",
    "CREATE INDEX IF NOT EXISTS horse_owner_history ON horse_races(user_id,id);",
    "CREATE TABLE IF NOT EXISTS horse_race_receipts(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "race_id INTEGER NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,args_json TEXT NOT NULL,result_json TEXT NOT NULL,",
    "UNIQUE(user_id,request_id),FOREIGN KEY(race_id,user_id) REFERENCES horse_races(id,user_id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS horse_race_rankings(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,",
    "spent INTEGER NOT NULL CHECK(spent>=0),won INTEGER NOT NULL CHECK(won>=0),last_played_at INTEGER NOT NULL);"
  ].join(" "));
}
function character(db,user){
  const row=db.prepare("SELECT town_id,money FROM characters WHERE user_id=?").get(user);
  if(!row)throw Error("請先建立角色");
  integer(row.money);return row;
}
function here(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(HORSE_RACE_SYMBOL);
}
function publicRace(row){
  return {id:row.id,townId:row.town_id,status:row.status,quotedAt:row.quoted_at,
    startedAt:row.started_at,lastAt:row.last_at,card:JSON.parse(row.card_json),
    horses:row.horses_json===null?null:JSON.parse(row.horses_json),
    cost:row.cost,turn:row.turn,winner:row.winner,payout:row.payout};
}
function owned(db,user,id){
  const row=db.prepare("SELECT * FROM horse_races WHERE user_id=? AND id=?").get(user,id);
  if(!row)throw Error("找不到本人的競馬紀錄");
  return row;
}
function running(db){
  return db.prepare("SELECT * FROM horse_races WHERE status='running'").get();
}
export function activeHorseRace(db,user){
  integer(user,1);
  const row=db.prepare("SELECT * FROM horse_races WHERE user_id=? AND status='running'").get(user);
  return row?publicRace(row):null;
}
export function horseRaceById(db,user,id){
  integer(user,1);integer(id,1);return publicRace(owned(db,user,id));
}
export function horseRaceRankings(db){
  return db.prepare("SELECT c.name,r.spent,r.won,r.won-r.spent AS profit,r.last_played_at AS lastPlayedAt "+
    "FROM horse_race_rankings r JOIN characters c ON c.user_id=r.user_id ORDER BY profit DESC,r.id LIMIT 10").all().map(row=>({...row}));
}
export function horseRaceOverview(db,user){
  integer(user,1);
  const c=character(db,user);
  const latest=db.prepare("SELECT * FROM horse_races WHERE user_id=? ORDER BY id DESC LIMIT 1").get(user);
  return {available:here(db,c.town_id),active:activeHorseRace(db,user),
    latest:latest?publicRace(latest):null,busy:Boolean(running(db)),rankings:horseRaceRankings(db)};
}
function transaction(db,user,action,args,requestId,now,work){
  integer(user,1);integer(now,1);
  if(typeof requestId!=="string"||!REQUEST.test(requestId))throw Error("競馬請求識別碼不正確");
  const encoded=JSON.stringify(args);
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare("SELECT * FROM horse_race_receipts WHERE user_id=? AND request_id=?").get(user,requestId);
    if(prior){
      if(prior.action!==action||prior.args_json!==encoded)throw Error("相同競馬請求碼不可變更操作或內容");
      db.exec("COMMIT");return {...JSON.parse(prior.result_json),replayed:true};
    }
    const result=work();
    db.prepare("INSERT INTO horse_race_receipts(user_id,race_id,request_id,action,args_json,result_json) VALUES(?,?,?,?,?,?)")
      .run(user,result.id,requestId,action,encoded,JSON.stringify(result));
    db.exec("COMMIT");return {...result,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function quoteHorseRace(db,user,source,{requestId,now,rand}={}){
  return transaction(db,user,"quote",[],requestId,now,()=>{
    const c=character(db,user);
    if(!here(db,c.town_id))throw Error("所在城鎮沒有競馬場");
    const card=drawHorseRaceCard(source,rand);
    const result=db.prepare("INSERT INTO horse_races(user_id,town_id,status,quoted_at,last_at,card_json) VALUES(?,?,'quoted',?,?,?)")
      .run(user,c.town_id,now,now,JSON.stringify(card));
    return publicRace(owned(db,user,integer(result.lastInsertRowid,1)));
  });
}
function assertEntry(db,user,now){
  assertNoActiveOnsen(db,user);
  if(db.prepare("SELECT 1 FROM arcade_road_trips WHERE user_id=? AND completed_at IS NULL").get(user))
    throw Error("公路旅程尚未抵達");
  if(getCockroachChallenge(db,user,now)?.status==="active")throw Error("限時事件進行中");
}
function moneyChange(db,user,current,delta,today){
  const next=integer(current+delta);
  if(db.prepare("UPDATE characters SET money=? WHERE user_id=? AND money=?").run(next,user,current).changes!==1)
    throw Error("競馬現金更新失敗");
  refreshBankTaxSnapshot(db,user,today);
}
export function enterHorseRace(db,user,source,{raceId,tickets,requestId,now,today,rand}={}){
  integer(raceId,1);
  if(!Array.isArray(tickets)||tickets.length!==6||tickets.some(n=>!Number.isSafeInteger(n)||n<0))
    throw Error("馬券購買數不正確");
  return transaction(db,user,"start",[raceId,tickets],requestId,now,()=>{
    const race=owned(db,user,raceId),c=character(db,user);
    if(race.status!=="quoted")throw Error("這張競馬名單已使用");
    if(now<race.last_at)throw Error("競馬時計尚未到達");
    if(c.town_id!==race.town_id||!here(db,c.town_id))throw Error("所在城鎮沒有此競馬場");
    assertEntry(db,user,now);
    const lock=running(db);
    if(lock){
      // Perl stat()/time() use whole seconds; equality at 180 is NOT stale.
      if(Math.floor(lock.started_at/1000)>=Math.floor(now/1000)-HORSE_LOCK_SECONDS)
        throw Error("目前已有競馬賽事進行中");
      // No refund or ranking entry for an abandoned race. A rejected start rolls
      // this change back with the entire Web transaction (documented difference).
      db.prepare("UPDATE horse_races SET status='forfeited',last_at=? WHERE id=?").run(now,lock.id);
    }
    // Settle the previous tax base before any wager changes today\'s snapshot.
    // Existing bank helper shares this transaction; rejected/replayed starts cannot commit settlement.
    settleBankInterestInTransaction(db,user,today,now);
    const cash=character(db,user).money;
    const result=startHorseRace(source,JSON.parse(race.card_json),tickets,cash,rand);
    moneyChange(db,user,cash,-result.cost,today);
    db.prepare("UPDATE horse_races SET status='running',started_at=?,last_at=?,horses_json=?,cost=? WHERE id=?")
      .run(now,now,JSON.stringify(result.horses),result.cost,raceId);
    return publicRace(owned(db,user,raceId));
  });
}
export function stepHorseRace(db,user,source,{raceId,expectedTurn,requestId,now,today,rand}={}){
  integer(raceId,1);integer(expectedTurn);
  return transaction(db,user,"step",[raceId,expectedTurn],requestId,now,()=>{
    const race=owned(db,user,raceId);
    if(race.status!=="running")throw Error("競馬賽事未開始、已結束或已棄權");
    if(expectedTurn!==race.turn)throw Error("競馬回合已變更，請重新讀取");
    if(now<race.last_at)throw Error("競馬時計尚未到達");
    const c=character(db,user);
    // Once paid, removal of a map tile must not prevent settlement.
    // A running lock does not expire on go, regardless of elapsed time.
    const result=advanceHorseRace(source,JSON.parse(race.horses_json),rand);
    if(result.cost!==race.cost)throw Error("競馬下注保存資料不一致");
    if(result.finished){
      settleBankInterestInTransaction(db,user,today,now);
      moneyChange(db,user,character(db,user).money,result.payout,today);
      const rank=db.prepare("SELECT spent,won FROM horse_race_rankings WHERE user_id=?").get(user);
      const spent=integer((rank?.spent??0)+race.cost),won=integer((rank?.won??0)+result.payout);
      db.prepare("INSERT INTO horse_race_rankings(user_id,spent,won,last_played_at) VALUES(?,?,?,?) "+
        "ON CONFLICT(user_id) DO UPDATE SET spent=excluded.spent,won=excluded.won,last_played_at=excluded.last_played_at")
        .run(user,spent,won,now);
    }
    db.prepare("UPDATE horse_races SET status=?,last_at=?,horses_json=?,turn=?,winner=?,payout=? WHERE id=?")
      .run(result.finished?"completed":"running",now,JSON.stringify(result.horses),integer(race.turn+1),result.winner,result.payout,raceId);
    return {...publicRace(owned(db,user,raceId)),finishers:result.finishers};
  });
}
