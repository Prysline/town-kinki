import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {STAT_KEYS} from "../src/engine.mjs";
import {resolveNonItemEvent} from "../src/event-effects.mjs";
import {initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents} from "../src/events.mjs";
import {initLegacyItemUseTables} from "../src/legacy-item-use.mjs";
import {listLegacyInventoryItems} from "../src/legacy-inventory.mjs";
import {getCockroachChallenge,claimCockroach} from "../src/event-cockroach.mjs";
import {SANTA_FIGHT_SOURCE_ROWS,SANTA_FIGHT_ITEMS,SANTA_FIGHT_ITEM_ORIGIN,RIVER_ITEM_SOURCE_ROWS,RIVER_ITEMS,RIVER_ITEM_ORIGIN} from "../src/event-santa-fight.mjs";
const NOW=Date.UTC(2026,10,25,8),DAY="2026-11-25";
const stats=power=>({...Object.fromEntries(STAT_KEYS.map(k=>[k,20])),power});
const row=(power,extra={})=>({money:100000,body_energy:20,brain_energy:20,stats_json:JSON.stringify(stats(power)),...extra});
function rng(...values){return ()=>{if(!values.length)throw Error("額外亂數");return values.shift();};}
function setup(){
  const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,health_index INTEGER DEFAULT 50,last_event_day TEXT DEFAULT '2026-11-24',money INTEGER DEFAULT 100000,kpoint INTEGER DEFAULT 0,body_energy INTEGER DEFAULT 20,brain_energy INTEGER DEFAULT 20,recovered_at INTEGER DEFAULT 1,stats_json TEXT NOT NULL);");
  for(const id of [1,2])db.prepare("INSERT INTO characters(user_id,stats_json) VALUES(?,?)").run(id,JSON.stringify(stats(1000)));
  initCharacterEvents(db);initLegacyItemUseTables(db);return db;
}
const trigger=(db,id=38,draws=[],day=DAY,user=1,now=NOW)=>settleDailyIllnessEvent(db,user,day,now,rng(0,(id-.5)/44,...draws));
const char=(db,id=1)=>db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);
const owned=(db,id=1)=>db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=? ORDER BY source_line").all(id);
function seed(db,id,line,raw){const f=[...raw];f[30]=String(Math.floor(NOW/1000));db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,"test-fixture",line,f[0],f[1],f[9],Number(f[21]),f[22],Number(f[30]),0,JSON.stringify(f));}
test("原版 #38 力量1000、1/5道具、6/7抽選、容量25及33欄來源契約",()=>{
  const source=readFileSync(new URL("../../event.pl",import.meta.url),"utf8"),ini=readFileSync(new URL("../../town_ini.cgi",import.meta.url),"utf8");
  const branch=source.slice(source.indexOf("if ($event_rand == 38)"),source.indexOf("if ($event_rand == 39)"));
  for(const token of ["$power >= 1000","int(rand(5))+1 == 1","int(rand(6))","&get_itm2($my_rand)","$money=$money+10000","$energy = 0"])assert.ok(branch.includes(token),token);
  const get=source.slice(source.indexOf("sub get_itm2{"));
  const rows=[...get.matchAll(/'(ゲットアイテム<>[^']+)'/g)].map(m=>m[1].split("<>").slice(0,33));
  assert.deepEqual(SANTA_FIGHT_SOURCE_ROWS,rows);assert.equal(SANTA_FIGHT_ITEMS.length,6);
  assert.match(get,/@my_kounyuu_list >= \$syoyuu_gendosuu/);assert.ok(ini.includes("$syoyuu_gendosuu = '25'"));
  assert.equal(SANTA_FIGHT_SOURCE_ROWS[6][1],"巨大クリスマスツリー");
});
test("#38 力量999必敗且不額外抽亂數，1000可勝，四個現金分支皆1萬元、六種道具皆可抽",()=>{
  const fail=resolveNonItemEvent(38,row(999),rng());assert.deepEqual(fail.changes,{body_energy:0});assert.equal(fail.effects.battle,"loss");
  for(const n of [.2,.4,.6,.99]){const win=resolveNonItemEvent(38,row(1000),rng(n));assert.equal(win.changes.money,110000);assert.equal(win.effects.battle,"win");}
  for(let i=0;i<6;i++){const win=resolveNonItemEvent(38,row(1000,{body_energy:0}),rng(0,(i+.5)/6));assert.equal(win.santaFightItemIndex,i);assert.deepEqual(win.changes,{});}
});
test("#38 全六種道具實際入背包，原版欄位及購入時間；不重抽、不串帳",()=>{
  for(let i=0;i<6;i++){const db=setup();try{
    const before=char(db,2);trigger(db,38,[0,(i+.5)/6]);const items=owned(db);
    assert.equal(items.length,1);const item=items[0],raw=JSON.parse(item.raw_fields_json),expected=[...SANTA_FIGHT_ITEMS[i]];expected[30]=String(Math.floor(NOW/1000));expected[32]="";
    assert.equal(item.original_id,SANTA_FIGHT_ITEM_ORIGIN);assert.deepEqual(raw,expected);
    const view=listLegacyInventoryItems(db,1,50,null,NOW)[0];assert.equal(view.origin,"event38");assert.equal(view.readOnly,false);assert.equal(view.remaining,Number(raw[21]));
    const event=listCharacterEvents(db,1)[0];assert.equal(event.title,"聖誕老人戰鬥");assert.equal(event.effects.santaFightItem.status,"awarded");assert.equal(char(db).money,100000);
    assert.equal(settleDailyIllnessEvent(db,1,DAY,NOW+1,rng()).checked,false);assert.equal(owned(db).length,1);assert.deepEqual(char(db,2),before);assert.equal(owned(db,2).length,0);
  }finally{db.close();}}
});
test("#38 24格可抽，25格即使同名也拒絕且無替代獎金；同名多筆按原版全部增耐久",()=>{
  const db=setup();try{
    const raw=SANTA_FIGHT_ITEMS[0];seed(db,1,1,raw);seed(db,1,2,raw);
    const before=owned(db);
    trigger(db,38,[0,0]);assert.deepEqual(owned(db),before);
    assert.deepEqual(db.prepare("SELECT remaining FROM legacy_item_usage ORDER BY source_line").all().map(x=>x.remaining),[10,10]);
    for(let i=3;i<=24;i++){const f=[...raw];f[1]="測試持有物"+i;seed(db,1,i,f);}
    trigger(db,38,[0,.3],"2026-11-26",1,NOW+86400000);assert.equal(owned(db).length,25);
    trigger(db,38,[0,0],"2026-11-27",1,NOW+172800000);assert.equal(owned(db).length,25);
    assert.equal(listCharacterEvents(db,1)[0].effects.santaFightItem.status,"full");assert.equal(char(db).money,100000);
    assert.deepEqual(db.prepare("SELECT remaining FROM legacy_item_usage ORDER BY source_line").all().map(x=>x.remaining),[10,10]);
  }finally{db.close();}
});
test("#38 歷史寫入失敗回滾道具及日標記，現金溢位也回滾，敗北僅清身體能量",()=>{
  const db=setup();try{
    const before=char(db);db.exec("CREATE TRIGGER fail_event38 BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'forced history'); END;");
    assert.throws(()=>trigger(db,38,[0,0]),/forced history/);assert.equal(owned(db).length,0);assert.deepEqual(char(db),before);
    db.exec("DROP TRIGGER fail_event38");db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,38,[.9]),/安全整數/);assert.equal(char(db).last_event_day,before.last_event_day);
    db.prepare("UPDATE characters SET money=100000,stats_json=? WHERE user_id=1").run(JSON.stringify(stats(999)));
    trigger(db,38);assert.equal(char(db).body_energy,0);assert.equal(char(db).brain_energy,20);assert.equal(char(db).money,100000);assert.equal(char(db).recovered_at,NOW);
  }finally{db.close();}
});
test("#38 戰勝掉落人偶可於 #34 消耗，再接 #26 與 #34 蟑螂；每日一次及帳號隔離",()=>{
  const db=setup();try{
    trigger(db,38,[0,.55]);const doll=owned(db)[0];assert.equal(doll.original_name,"等身大サンタさん人形");
    trigger(db,34,[0],"2026-11-26",1,NOW+86400000);assert.equal(char(db).money,200000);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=? AND user_id=1").get(doll.source_line).remaining,9);
    trigger(db,26,[.4],"2026-11-27",1,NOW+172800000);assert.equal(char(db).body_energy,15);assert.equal(char(db).brain_energy,15);
    trigger(db,34,[0],DAY,2,NOW);assert.equal(getCockroachChallenge(db,1,NOW),null);assert.equal(getCockroachChallenge(db,2,NOW).status,"active");
    assert.throws(()=>claimCockroach(db,1,NOW,rng(0)),/沒有待處理/);
    const caught=claimCockroach(db,2,NOW+19999,rng(0));assert.equal(caught.reward,1);assert.equal(char(db,2).kpoint,3);
    assert.equal(char(db,1).kpoint,0);assert.equal(listCharacterEvents(db,1).length,3);
  }finally{db.close();}
});

test("#40 原版 get_itm 先於 1/5 提示；三筆來源僅前兩筆可抽，10 個固定亂數分支",()=>{
  const source=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
  const branch=source.slice(source.indexOf("if ($event_rand == 40)"),source.indexOf("if ($event_rand == 41)"));
  assert.ok(branch.indexOf("int(rand(2))")<branch.indexOf("&get_itm($my_rand)"));
  assert.ok(branch.indexOf("&get_itm($my_rand)")<branch.indexOf("int(rand(5))"));
  assert.ok(branch.includes("$money=$money-500"));
  const get=source.slice(source.indexOf("sub get_itm{"),source.indexOf("sub get_itm2{"));
  const rows=[...get.matchAll(/'(ゲットアイテム<>[^']+)'/g)].map(m=>m[1].split("<>").slice(0,33));
  assert.deepEqual(RIVER_ITEM_SOURCE_ROWS,rows);
  assert.equal(RIVER_ITEMS.length,2);
  assert.deepEqual(RIVER_ITEMS.map(x=>[x[1],x[21],x[23]]),[["英文解釈教室","3","30"],["成り上がり","3","30"]]);
  for(let i=0;i<2;i++)for(let j=0;j<5;j++){
    const effect=resolveNonItemEvent(40,row(1000),rng((i+.5)/2,(j+.5)/5));
    assert.equal(effect.riverItemIndex,i);
    assert.equal(effect.changes.money,j===0?undefined:99500);
    assert.equal(effect.effects.money,j===0?undefined:-500);
  }
  const poor=resolveNonItemEvent(40,row(1000,{money:17}),rng(0,.99));
  assert.equal(poor.changes.money,0);assert.equal(poor.effects.money,-17);
});
test("#40 兩種書籍在五個提示分支都實際入庫；完整33欄、翻譯來源、同日防重與帳號隔離",()=>{
  for(let i=0;i<2;i++)for(let j=0;j<5;j++){
    const db=setup();try{
      const other=char(db,2);
      trigger(db,40,[(i+.5)/2,(j+.5)/5]);
      const [item]=owned(db);assert.ok(item);assert.equal(owned(db).length,1);
      const expected=[...RIVER_ITEMS[i]];expected[30]=String(Math.floor(NOW/1000));expected[32]="";
      assert.deepEqual(JSON.parse(item.raw_fields_json),expected);
      assert.equal(item.original_id,RIVER_ITEM_ORIGIN);
      assert.equal(char(db).money,j===0?100000:99500);
      const view=listLegacyInventoryItems(db,1,50,null,NOW)[0];
      assert.equal(view.origin,"event40");assert.equal(view.readOnly,false);assert.equal(view.remaining,3);
      const h=listCharacterEvents(db,1)[0];assert.equal(h.title,"河中物品");assert.equal(h.effects.riverItem.status,"awarded");
      assert.ok(h.description.includes("《"+item.original_name+"》"));
      assert.equal(settleDailyIllnessEvent(db,1,DAY,NOW+1,rng()).checked,false);
      assert.equal(owned(db).length,1);assert.deepEqual(char(db,2),other);assert.equal(owned(db,2).length,0);
      assert.equal(listCharacterEvents(db,2).length,0);
    }finally{db.close();}
  }
});
test("#40 25格先拒絕同名合併但仍可扣500；未滿時全部同名列增耐久，歷史失敗全回滾",()=>{
  const db=setup();try{
    const raw=RIVER_ITEMS[0];seed(db,1,1,raw);seed(db,1,2,raw);
    const before=owned(db),c=char(db);
    db.exec("CREATE TRIGGER fail_event40 BEFORE INSERT ON character_events BEGIN SELECT RAISE(ABORT,'forced river history'); END;");
    assert.throws(()=>trigger(db,40,[0,.99]),/forced river history/);
    assert.deepEqual(owned(db),before);assert.deepEqual(char(db),c);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    db.exec("DROP TRIGGER fail_event40");
    trigger(db,40,[0,.99]);
    assert.deepEqual(owned(db),before);assert.equal(char(db).money,99500);
    assert.deepEqual(db.prepare("SELECT remaining FROM legacy_item_usage ORDER BY source_line").all().map(x=>x.remaining),[6,6]);
    for(let i=3;i<=24;i++){const f=[...raw];f[1]="測試持有物"+i;seed(db,1,i,f);}
    trigger(db,40,[.99,0],"2026-11-26",1,NOW+86400000);assert.equal(owned(db).length,25);
    trigger(db,40,[0,.99],"2026-11-27",1,NOW+172800000);assert.equal(owned(db).length,25);
    assert.equal(listCharacterEvents(db,1)[0].effects.riverItem.status,"full");assert.equal(char(db).money,99000);
    assert.deepEqual(db.prepare("SELECT remaining FROM legacy_item_usage ORDER BY source_line").all().map(x=>x.remaining),[6,6]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db.close();}
});
