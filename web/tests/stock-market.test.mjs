import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {parseStockSource} from "../src/stock-source.mjs";
import {initStockTables,readStockMarket,stockOverview,accessStockMarket,tickStockMarket,stockTownReturn,STOCK_GUEST_TIMEOUT_SECONDS} from "../src/stock-market.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initBankTables} from "../src/banking.mjs";
import {initOnsenTables} from "../src/onsen.mjs";
import {initRoadTravelTables} from "../src/road-travel.mjs";
import {initCockroachChallenges} from "../src/event-cockroach.mjs";
const source=parseStockSource(readFileSync(new URL("../../event.pl",import.meta.url),"utf8"),readFileSync(new URL("../../kabu.cgi",import.meta.url),"utf8"));
const NOW=Date.parse("2026-11-28T04:00:00Z"),today="2026-11-28";
function setup(file=":memory:"){
  const d=new DatabaseSync(file);d.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,name TEXT,town_id INTEGER,money INTEGER,bank INTEGER);INSERT INTO characters VALUES(1,'甲',0,1000000,1000000),(2,'乙',0,1000000,1000000);CREATE TABLE character_events(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);");
  initTownMapTable(d);initBankTables(d);initOnsenTables(d);initRoadTravelTables(d);initCockroachChallenges(d);initStockTables(d,source);
  const tiles=Array(192).fill("");tiles[0]="株";storeTownMap(d,0,{tiles},"web-edited");return d;
}
const cash=(d,u=1)=>d.prepare("SELECT money FROM characters WHERE user_id=?").get(u).money;
const bank=(d,u=1)=>d.prepare("SELECT bank FROM characters WHERE user_id=?").get(u).bank;
const go=(d,action,requestId,more={})=>accessStockMarket(d,more.user??1,{action,requestId,now:NOW,today,key:"D",quantity:1,...more});
test("BK-05 approved initial market; shared sliding window, strict boundary, no debit on expired order",()=>{
  const d=setup();try{
    assert.deepEqual(readStockMarket(d),{prices:[25000,25000,25000,25000,25000],tradeCount:0,tradeUntil:0});
    assert.equal(go(d,"buy","stock_001").expired,true);assert.equal(cash(d),1000000);
    const b=go(d,"buy","stock_002",{now:NOW+180999});
    assert.equal(b.expired,false);assert.equal(b.record.amount,25000);assert.equal(cash(d),975000);assert.equal(bank(d),1000000);
    assert.equal(stockOverview(d,1).holdings[3].shares,1);assert.equal(stockOverview(d,2).holdings[3].shares,0);
    const expired=go(d,"buy","stock_003",{user:2,now:NOW+361000});assert.equal(expired.expired,true);
    assert.equal(cash(d,2),1000000);assert.equal(readStockMarket(d).tradeCount,3);
    assert.equal(go(d,"buy","stock_002",{now:NOW+999000}).replayed,true);
    assert.equal(readStockMarket(d).tradeCount,3);assert.equal(cash(d),975000);
    assert.throws(()=>go(d,"buy","stock_002",{quantity:2}),/不可變更/);
  }finally{d.close();}
});
test("BK-05 D/E approved independent funds; original rejected access refresh, receipts and atomic faults",()=>{
  const d=setup();try{
    go(d,"open","stock_open");
    d.exec("UPDATE characters SET money=24999 WHERE user_id=1");
    assert.throws(()=>go(d,"buy","stock_bad1"),/現金不足/);
    assert.equal(readStockMarket(d).tradeCount,2);assert.equal(cash(d),24999);
    assert.equal(stockOverview(d,1).history.length,0);
    d.exec("UPDATE characters SET money=1000000,bank=24999 WHERE user_id=1");
    assert.throws(()=>go(d,"buy","stock_bad2",{key:"E"}),/存款不足/);
    assert.equal(readStockMarket(d).tradeCount,3);assert.equal(cash(d),1000000);
    assert.throws(()=>go(d,"buy","stock_bad1",{now:NOW+500000}),/現金不足/);
    assert.equal(readStockMarket(d).tradeCount,3);
    d.exec("UPDATE characters SET bank=1000000 WHERE user_id=1;CREATE TRIGGER fail_stock BEFORE INSERT ON stock_trade_history BEGIN SELECT RAISE(ABORT,'stock fault'); END;");
    assert.throws(()=>go(d,"buy","stock_good"),/stock fault/);
    assert.equal(readStockMarket(d).tradeCount,3);assert.equal(cash(d),1000000);assert.equal(stockOverview(d,1).holdings[3].shares,0);
    d.exec("DROP TRIGGER fail_stock");
    go(d,"buy","stock_good");assert.equal(cash(d),975000);assert.equal(stockOverview(d,1).holdings[3].shares,1);
    assert.equal(d.prepare("SELECT assessment_base FROM bank_tax_state WHERE user_id=1").get().assessment_base,1975000);
  }finally{d.close();}
});
test("BK-05 market ticks explicitly, 30/10 history limits, clear even expired, reopen without reseed, cascade",()=>{
  const dir=mkdtempSync(join(tmpdir(),"town-stock-db-")),file=join(dir,"save.sqlite");let d=setup(file);
  try{
    const draws=[.15,.99];let count=0;
    for(let i=0;i<35;i++)tickStockMarket(d,1,{now:NOW+i,guestCount:1,rand:n=>n*draws[count++%2]});
    assert.equal(stockOverview(d,1).marketHistory.length,30);
    const price=readStockMarket(d).prices[3];assert.ok(price>25000);
    go(d,"open","stock_open");
    const old=readStockMarket(d);
    assert.equal(tickStockMarket(d,1,{now:NOW+1000,guestCount:1,rand:()=>{throw Error("不得抽");}}).event,null);
    for(let i=0;i<6;i++){go(d,"buy","buy_"+String(i).padStart(5,"0"));go(d,"sell","sell_"+String(i).padStart(5,"0"));}
    assert.equal(stockOverview(d,1).history.length,10);assert.equal(cash(d),1000000);
    go(d,"buy","buy_final");assert.equal(cash(d),1000000-price);
    d.close();d=new DatabaseSync(file);d.exec("PRAGMA foreign_keys=ON");initStockTables(d,source);
    assert.deepEqual(readStockMarket(d).prices,old.prices);
    const clear=go(d,"clear","clear_001",{now:NOW+181000});
    assert.equal(clear.expired,true);assert.equal(clear.record.amount,price);assert.equal(cash(d),1000000);
    assert.equal(stockOverview(d,1).history.length,1);assert.equal(stockOverview(d,1).cumulativeNet,0);
    assert.equal(go(d,"clear","clear_001",{now:NOW+182000}).replayed,true);assert.equal(cash(d),1000000);
    d.exec("DELETE FROM users WHERE id=1");
    for(const t of ["stock_portfolios","stock_trade_history","stock_receipts"])assert.equal(d.prepare("SELECT COUNT(*) n FROM "+t+" WHERE user_id=1").get().n,0);
    assert.equal(stockOverview(d,2).marketHistory.length,30);assert.deepEqual(d.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{d?.close();rmSync(dir,{recursive:true,force:true});}
});

test("BK-05 source guest row count before refresh; strict 1200s, empty first return and replay",()=>{
  const d=setup();try{
    const ini=readFileSync(new URL("../../town_ini.cgi",import.meta.url),"utf8");
    const maker=readFileSync(new URL("../../town_maker.cgi",import.meta.url),"utf8");
    const top=readFileSync(new URL("../../top.pl",import.meta.url),"utf8");
    assert.equal(Number(ini.match(/\$logout_time\s*=\s*'(\d+)'/)[1]),STOCK_GUEST_TIMEOUT_SECONDS);
    assert.match(maker,/&event_happen;[\s\S]*?&main_view/);
    assert.ok(top.indexOf("$sanka_timer = $genzai_zikoku;")<top.indexOf("$genzai_zikoku - $logout_time > $sanka_timer"));
    const r=(u,requestId,now=NOW,rand=n=>n*.99)=>stockTownReturn(d,u,{now,requestId,rand});
    const first=r(1,"return_001");assert.equal(first.guestCount,0);assert.equal(first.market.event,null);
    const second=r(2,"return_002",NOW+1200000);assert.equal(second.guestCount,1);
    assert.equal(d.prepare("SELECT COUNT(*) n FROM stock_guests").get().n,2);
    const third=r(2,"return_003",NOW+1201000);assert.equal(third.guestCount,2);
    assert.equal(d.prepare("SELECT COUNT(*) n FROM stock_guests").get().n,1);
    const replay=r(2,"return_003",NOW+5000000,()=>{throw Error("不得重抽");});
    assert.deepEqual(replay,{...third,replayed:true});assert.equal(d.prepare("SELECT COUNT(*) n FROM stock_guests").get().n,1);
    const later=r(1,"return_004",NOW+5000000);
    assert.equal(later.guestCount,1);assert.equal(d.prepare("SELECT COUNT(*) n FROM stock_guests").get().n,1);
  }finally{d.close();}
});
test("BK-05 guest and price mutation roll back together on failed receipt",()=>{
  const d=setup();try{
    stockTownReturn(d,1,{now:NOW,requestId:"return_001",rand:n=>n*.99});
    const before=readStockMarket(d);
    d.exec("CREATE TRIGGER fail_return BEFORE INSERT ON stock_receipts BEGIN SELECT RAISE(ABORT,'return fault'); END;");
    let i=0;assert.throws(()=>stockTownReturn(d,2,{now:NOW+1000,requestId:"return_002",rand:n=>n*[.15,.99][i++]}),/return fault/);
    assert.deepEqual(readStockMarket(d),before);assert.equal(stockOverview(d,1).marketHistory.length,0);
    assert.equal(d.prepare("SELECT COUNT(*) n FROM stock_guests").get().n,1);
  }finally{d.close();}
});
