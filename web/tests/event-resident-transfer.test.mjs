import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents} from "../src/events.mjs";
import {resolveNonItemEvent} from "../src/event-effects.mjs";
import {initBankTables,bankTaxOverview,bankLedger,refreshBankTaxSnapshot,settleBankInterest} from "../src/banking.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {SANTA_FIGHT_ITEMS} from "../src/event-santa-fight.mjs";
const DAY="2026-11-26",NOW=Date.UTC(2026,10,26,8),PREV="2026-11-25";
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2),(3);CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE REFERENCES users(id),name TEXT,money INTEGER DEFAULT 100000,bank INTEGER DEFAULT 100000,kpoint INTEGER DEFAULT 0,health_index INTEGER DEFAULT 50,last_event_day TEXT DEFAULT '2026-11-25',stats_json TEXT DEFAULT '{}');INSERT INTO characters(id,user_id,name) VALUES(1,1,'甲'),(2,2,'乙'),(3,3,'丙');");
  initBankTables(db);initCharacterEvents(db);initLegacyItemUseTables(db);
  for(const id of [1,2,3])settleBankInterest(db,id,DAY,NOW);
  return db;
}
function rng(...values){return ()=>{assert.ok(values.length,"額外亂數");return values.shift();};}
const trigger=(db,id,values,mode="multi")=>settleDailyIllnessEvent(db,1,DAY,NOW,rng(0,(id-.5)/44,...values),mode);
const char=(db,id=1)=>db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);
const hist=(db,id=1)=>listCharacterEvents(db,id);
const remaining=(db,line=1)=>db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?").get(line)?.remaining;
function seed(db,index,line=1,unit="回",category="ゲットアイテム",durability=5){
  const raw=[...SANTA_FIGHT_ITEMS[index]];raw[0]=category;raw[21]=String(durability);raw[22]=unit;raw[30]=String(Math.floor(NOW/1000));
  db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(1,?,?,?,?,?,?,?,?,?,?)").run("fixture",line,category,raw[1],raw[9],durability,unit,Number(raw[30]),Math.floor(NOW/1000),JSON.stringify(raw));
}
test("#28/#36/#37 原版金額、分支及K點來源：不持笛、兩種持笛結果與上下界",()=>{
  const src=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
  for(const token of ["$okane = 10000","$money_aku=int(rand(50000))+1","$money_ten=int(rand(10000))+1","$kpoint += 3","$kpoint -= 3"])assert.ok(src.includes(token),token);
  assert.equal(resolveNonItemEvent(28,{},rng()).residentTransfer.amount,10000);
  for(const [id,n,name,sign] of [[36,50000,"悪魔の笛",-1],[37,10000,"天使の笛",1]]){
    for(const [r,x] of [[0,1],[.999999,n]]){
      assert.equal(resolveNonItemEvent(id,{money:100000},rng(r)).effects.money,sign*x);
      const direct=resolveNonItemEvent(id,{money:100000},rng(r,.99),name);
      assert.equal(direct.effects.money,sign*2*x);assert.equal(direct.usedItemName,name);
      const transfer=resolveNonItemEvent(id,{money:100000},rng(r,0),name);
      assert.equal(transfer.residentTransfer.amount,2*x);assert.equal(transfer.usedItemName,name);
    }
  }
});
test("三種事件足額成功：末列可抽、雙方資產守恆、K點、帳簿方向、稅基、雙方歷史及日標記",()=>{
  for(const [id,values,delta,k,flute] of [[28,[.99],-10000,3,null],[36,[.999999,0,.99],100000,-3,0],[37,[.999999,0,.99],-20000,3,1]]){
    const db=setup();try{
      if(flute!==null)seed(db,flute);
      const other=char(db,2),target=char(db,3);
      trigger(db,id,values);
      assert.equal(char(db).money,100000+delta);assert.equal(char(db).kpoint,k);
      assert.equal(char(db,3).bank,100000-delta);assert.equal(char(db,3).last_event_day,target.last_event_day);
      assert.equal(char(db,3).kpoint,0);assert.deepEqual(char(db,2),other);
      assert.equal(bankTaxOverview(db,1).assessmentBase,200000+delta);
      assert.equal(bankTaxOverview(db,3).assessmentBase,200000-delta);
      const [entry]=bankLedger(db,3);assert.equal(entry.debit,Math.max(delta,0));assert.equal(entry.credit,Math.max(-delta,0));
      assert.equal(hist(db)[0].effects.transfer.status,"transferred");assert.equal(hist(db,3)[0].effects.bank,-delta);assert.equal(hist(db,2).length,0);
      if(flute!==null)assert.equal(remaining(db),4);
      assert.equal(settleDailyIllnessEvent(db,1,DAY,NOW+1,rng(),"multi").checked,false);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    }finally{db.close();}
  }
});
test("核准不足額：不扣耐久、不改金錢或K點、不重抽；暫時銀行結算也撤回",()=>{
  for(const [id,values,flute] of [[28,[.99],null],[36,[.999999,0,.99],0],[37,[.999999,0,.99],1]]){
    const db=setup();try{
      if(flute!==null)seed(db,flute);
      if(id===36)db.prepare("UPDATE characters SET bank=1 WHERE user_id=3").run();
      else db.prepare("UPDATE characters SET money=1 WHERE user_id=1").run();
      db.prepare("UPDATE bank_accounts SET last_interest_day=? WHERE user_id=3").run(PREV);
      const a=char(db),c=char(db,3),tax=bankTaxOverview(db,3),account=db.prepare("SELECT * FROM bank_accounts WHERE user_id=3").get(),ledger=bankLedger(db,3);
      trigger(db,id,values);
      assert.deepEqual({...char(db)},{...a,last_event_day:DAY});assert.deepEqual(char(db,3),c);
      assert.equal(remaining(db),undefined);assert.equal(hist(db)[0].effects.transfer.status,"insufficient");assert.equal(hist(db,3).length,0);
      assert.deepEqual(bankTaxOverview(db,3),tax);assert.deepEqual(bankLedger(db,3),ledger);assert.deepEqual(db.prepare("SELECT * FROM bank_accounts WHERE user_id=3").get(),account);
      assert.equal(settleDailyIllnessEvent(db,1,DAY,NOW+1,rng(),"multi").checked,false);
    }finally{db.close();}
  }
});
test("單機及多人抽本人皆不重抽，笛子正常扣耐久；單機不誤選其他居民",()=>{
  for(const mode of ["solo","multi"])for(const [id,flute,values] of [[28,null,[mode==="solo"?.99:0]],[36,0,[0,0,mode==="solo"?.99:0]],[37,1,[0,0,mode==="solo"?.99:0]]]){
    const db=setup();try{
      if(flute!==null)seed(db,flute);
      const before=char(db),other=char(db,3);trigger(db,id,values,mode);
      assert.deepEqual({...char(db)},{...before,last_event_day:DAY});assert.deepEqual(char(db,3),other);
      assert.equal(hist(db)[0].effects.transfer.status,"self");
      assert.equal(remaining(db),flute===null?undefined:4);
    }finally{db.close();}
  }
});
test("笛子反噬、直接金錢、無笛與禮品/耗盡排除；事件忽略手動冷卻且不改最後使用時間",()=>{
  for(const [id,index,delta] of [[36,0,-2],[37,1,2]]){
    const db=setup();try{
      seed(db,index,1,"回","ギフト");seed(db,index,2,"回","ゲットアイテム",0);seed(db,index,3);
      trigger(db,id,[0,.99]);assert.equal(char(db).money,100000+delta);assert.equal(remaining(db,1),undefined);assert.equal(remaining(db,2),undefined);assert.equal(remaining(db,3),4);
      assert.equal(db.prepare("SELECT last_used_at_ms FROM legacy_item_usage WHERE user_id=1 AND source_line=3").get().last_used_at_ms,Math.floor(NOW/1000)*1000);
    }finally{db.close();}
  }
  for(const [id,delta] of [[36,-1],[37,1]]){
    const db=setup();try{trigger(db,id,[0]);assert.equal(char(db).money,100000+delta);assert.equal(hist(db)[0].effects.item,undefined);}finally{db.close();}
  }
});
test("跨玩家事件銀行、稅基、歷史、耐久故障：整筆回滾並可重試",()=>{
  for(const [op,table] of [["INSERT","bank_ledger"],["UPDATE","bank_tax_state"],["INSERT","character_events"],["INSERT","legacy_item_usage"]]){
    const db=setup();try{
      seed(db,1);const a=char(db),c=char(db,3),t1=bankTaxOverview(db,1),t3=bankTaxOverview(db,3);
      db.exec("CREATE TRIGGER fail_event BEFORE "+op+" ON "+table+" BEGIN SELECT RAISE(ABORT,'event blocked'); END;");
      assert.throws(()=>trigger(db,37,[0,0,.99]),/event blocked/);
      assert.deepEqual(char(db),a);assert.deepEqual(char(db,3),c);assert.deepEqual(bankTaxOverview(db,1),t1);assert.deepEqual(bankTaxOverview(db,3),t3);
      assert.equal(remaining(db),undefined);assert.equal(hist(db).length,0);assert.equal(hist(db,3).length,0);assert.equal(bankLedger(db,3).length,0);
      db.exec("DROP TRIGGER fail_event");trigger(db,37,[0,0,.99]);assert.equal(remaining(db),4);assert.equal(char(db).money,99998);
    }finally{db.close();}
  }
});
