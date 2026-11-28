// BK-05: independent SQLite market, holdings, history, receipts. No scheduler.
// Caller supplies server clock and original guest count; does not read HTTP input for those.
import {projectStockAccess,projectStockMarketTick} from "./stock-source.mjs";
import {emptyStockPortfolio,projectStockTrade,stockPortfolioOverview,StockTradeError} from "./stock-trade-source.mjs";
import {readTownMap} from "./town-storage.mjs";
import {settleBankInterestInTransaction,refreshBankTaxSnapshot} from "./banking.mjs";
import {assertNoActiveOnsen} from "./onsen.mjs";
import {getCockroachChallenge} from "./event-cockroach.mjs";
const REQUEST=/^[A-Za-z0-9_-]{8,80}$/;
function int(n,min=0){if(!Number.isSafeInteger(n)||n<min)throw Error("股票數值不正確");return n;}
function transaction(db,fn){
  db.exec("BEGIN IMMEDIATE");
  try{const r=fn();db.exec("COMMIT");return r;}
  catch(e){db.exec("ROLLBACK");throw e;}
}
export function initStockTables(db,source){
  db.exec([
    "CREATE TABLE IF NOT EXISTS stock_market (id INTEGER PRIMARY KEY CHECK(id=1),prices_json TEXT NOT NULL,trade_count INTEGER NOT NULL CHECK(trade_count>=0),trade_until INTEGER NOT NULL CHECK(trade_until>=0));",
    "CREATE TABLE IF NOT EXISTS stock_portfolios (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,rows_json TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS stock_market_history (id INTEGER PRIMARY KEY AUTOINCREMENT,actor_name TEXT NOT NULL,event_json TEXT NOT NULL,created_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS stock_trade_history (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,record_json TEXT NOT NULL,created_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS stock_trade_history_owner ON stock_trade_history(user_id,id);",
    "CREATE TABLE IF NOT EXISTS stock_receipts (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id TEXT NOT NULL,args_json TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(user_id,request_id));",
    "CREATE TABLE IF NOT EXISTS stock_guests (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_at_sec INTEGER NOT NULL CHECK(last_at_sec>=0));"
  ].join("\n"));
  if(!source||!Array.isArray(source.bootstrapPrices)||source.bootstrapPrices.length!==5)
    throw Error("股票來源初始化缺失");
  // User decision A: original no-backup seed, only for a new Web world.
  db.prepare("INSERT OR IGNORE INTO stock_market VALUES(1,?,0,0)").run(JSON.stringify(source.bootstrapPrices.map(p=>int(p))));
}
export function readStockMarket(db){
  const r=db.prepare("SELECT * FROM stock_market WHERE id=1").get();
  if(!r)throw Error("股票行情尚未初始化");
  return {prices:JSON.parse(r.prices_json),tradeCount:r.trade_count,tradeUntil:r.trade_until};
}
function writeMarket(db,m){
  db.prepare("UPDATE stock_market SET prices_json=?,trade_count=?,trade_until=? WHERE id=1")
    .run(JSON.stringify(m.prices),m.tradeCount,m.tradeUntil);
}
function character(db,user){
  const r=db.prepare("SELECT name,town_id,money,bank FROM characters WHERE user_id=?").get(int(user,1));
  if(!r)throw Error("請先建立角色");return r;
}
function available(db,c){const m=readTownMap(db,c.town_id);return m.configured&&m.tiles.includes("株");}
function rows(db,user){
  const r=db.prepare("SELECT rows_json FROM stock_portfolios WHERE user_id=?").get(user);
  return r?JSON.parse(r.rows_json):emptyStockPortfolio();
}
function history(db,user){
  return db.prepare("SELECT record_json,created_at FROM stock_trade_history WHERE user_id=? ORDER BY id DESC LIMIT 10").all(user)
    .map(r=>({...JSON.parse(r.record_json),createdAt:r.created_at}));
}
export function stockOverview(db,user){
  const c=character(db,user),market=readStockMarket(db);
  return {available:available(db,c),market,...stockPortfolioOverview(rows(db,user),market.prices),
    history:history(db,user),marketHistory:db.prepare("SELECT actor_name,event_json,created_at FROM stock_market_history ORDER BY id DESC LIMIT 30").all()
      .map(r=>({actorName:r.actor_name,...JSON.parse(r.event_json),createdAt:r.created_at}))};
}
// Explicit seam for the original town return event. No random draw from GET/overview.
function tickInTransaction(db,user,{now,guestCount,rand}){
    const c=character(db,user),next=projectStockMarketTick(readStockMarket(db),guestCount,Math.floor(now/1000),rand);
    if(next.event){
      writeMarket(db,next);
      db.prepare("INSERT INTO stock_market_history(actor_name,event_json,created_at) VALUES(?,?,?)")
        .run(c.name,JSON.stringify(next.event),now);
      db.exec("DELETE FROM stock_market_history WHERE id NOT IN (SELECT id FROM stock_market_history ORDER BY id DESC LIMIT 30)");
    }
    return next;
}
export function tickStockMarket(db,user,{now,guestCount,rand}={}){
  int(now,1);int(guestCount);
  return transaction(db,()=>tickInTransaction(db,user,{now,guestCount,rand}));
}
// Original town_maker login_view calls event_happen BEFORE top.pl refreshes guestlog.
// Count every persisted guest row, including rows about to expire; no user-supplied count.
// Current actor is refreshed before pruning; strict >1200 seconds (not >=).
export const STOCK_GUEST_TIMEOUT_SECONDS=1200;
export function stockTownReturn(db,user,{now,requestId,rand}={}){
  int(user,1);int(now,1);
  if(typeof requestId!=="string"||!REQUEST.test(requestId))throw Error("股票請求識別碼不正確");
  const args=JSON.stringify(["town-return"]);
  return transaction(db,()=>{
    const prior=db.prepare("SELECT * FROM stock_receipts WHERE user_id=? AND request_id=?").get(user,requestId);
    if(prior){
      if(prior.args_json!==args)throw Error("相同股票請求碼不可變更操作或內容");
      return {...JSON.parse(prior.result_json),replayed:true};
    }
    character(db,user);assertNoActiveOnsen(db,user);
    if(db.prepare("SELECT 1 FROM arcade_road_trips WHERE user_id=? AND completed_at IS NULL").get(user))
      throw Error("公路旅程尚未抵達");
    const guestCount=db.prepare("SELECT COUNT(*) n FROM stock_guests").get().n;
    const next=tickInTransaction(db,user,{now,guestCount,rand});
    const seconds=Math.floor(now/1000);
    db.prepare("INSERT INTO stock_guests VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_at_sec=excluded.last_at_sec").run(user,seconds);
    db.prepare("DELETE FROM stock_guests WHERE last_at_sec<?").run(seconds-STOCK_GUEST_TIMEOUT_SECONDS);
    const result={guestCount,market:next};
    db.prepare("INSERT INTO stock_receipts VALUES(?,?,?,?)").run(user,requestId,args,JSON.stringify(result));
    return {...result,replayed:false};
  });
}
function guard(db,user,c,now){
  if(!available(db,c))throw Error("所在城鎮沒有股票交易所");
  assertNoActiveOnsen(db,user);
  if(db.prepare("SELECT 1 FROM arcade_road_trips WHERE user_id=? AND completed_at IS NULL").get(user))
    throw Error("公路旅程尚未抵達");
  if(getCockroachChallenge(db,user,now)?.status==="active")throw Error("限時事件進行中");
}
export function accessStockMarket(db,user,{action="open",key=null,quantity=0,requestId,now,today}={}){
  int(user,1);int(now,1);
  if(!REQUEST.test(requestId??"")||typeof requestId!=="string")throw Error("股票請求識別碼不正確");
  if(!["open","buy","sell","clear"].includes(action))throw Error("股票操作不正確");
  // Original malformed quantity rejected before access count/deadline write.
  if(!Number.isSafeInteger(quantity)||quantity<0)throw Error("股票數量須為非負整數");
  const args=JSON.stringify([action,key,quantity]);
  const result=transaction(db,()=>{
    const prior=db.prepare("SELECT * FROM stock_receipts WHERE user_id=? AND request_id=?").get(user,requestId);
    if(prior){
      if(prior.args_json!==args)throw Error("相同股票請求碼不可變更操作或內容");
      return {...JSON.parse(prior.result_json),replayed:true};
    }
    const c=character(db,user);guard(db,user,c,now);
    const market=projectStockAccess(readStockMarket(db),Math.floor(now/1000));
    writeMarket(db,market);
    let response={action,expired:market.expired,tradeUntil:market.tradeUntil,record:null};
    if(action!=="open"){
      db.exec("SAVEPOINT stock_trade");
      try{
        // No new tax base before settling the previous day, and stock value is excluded.
        if(action==="clear"||!market.expired)settleBankInterestInTransaction(db,user,today,now);
        const current=character(db,user);
        const trade=projectStockTrade({rows:rows(db,user),prices:market.prices,cash:current.money,bank:current.bank,action,key,quantity,expired:market.expired});
        if(action==="clear"||!market.expired){
          db.prepare("INSERT INTO stock_portfolios VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET rows_json=excluded.rows_json")
            .run(user,JSON.stringify(trade.rows));
          if(trade.cash!==current.money){
            if(db.prepare("UPDATE characters SET money=? WHERE user_id=? AND money=?").run(trade.cash,user,current.money).changes!==1)
              throw Error("股票現金更新失敗");
            refreshBankTaxSnapshot(db,user,today);
          }
          if(action==="clear")db.prepare("DELETE FROM stock_trade_history WHERE user_id=?").run(user);
          if(trade.record){
            db.prepare("INSERT INTO stock_trade_history(user_id,record_json,created_at) VALUES(?,?,?)").run(user,JSON.stringify(trade.record),now);
            db.prepare("DELETE FROM stock_trade_history WHERE user_id=? AND id NOT IN (SELECT id FROM stock_trade_history WHERE user_id=? ORDER BY id DESC LIMIT 10)").run(user,user);
          }
        }
        response.record=trade.record;db.exec("RELEASE stock_trade");
      }catch(e){
        db.exec("ROLLBACK TO stock_trade");db.exec("RELEASE stock_trade");
        // Original global access write occurs before business validation. Preserve
        // only that effect; no partial holdings, cash, history or tax.
        if(e instanceof StockTradeError)response.rejected=e.message;else throw e;
      }
    }
    db.prepare("INSERT INTO stock_receipts VALUES(?,?,?,?)").run(user,requestId,args,JSON.stringify(response));
    return {...response,replayed:false};
  });
  if(result.rejected)throw new StockTradeError(result.rejected);
  return result;
}
