import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText,STAT_KEYS} from "../src/engine.mjs";
import {parseOriginalTreasure,initTreasureTables,TREASURE_ORIGIN} from "../src/arcade-treasure.mjs";
import {
  parseOriginalRoadTransport,initRoadTravelTables,roadOverview,
  beginRoadTrip,arriveRoadTrip,ROAD_WALKING_NAME,ROAD_HISTORY_LIMIT
} from "../src/road-travel.mjs";
import {heldInventoryRows,inventoryLife} from "../src/inventory-life.mjs";

function original(path){
  return decodeLegacyText(readFileSync(new URL("../../"+path,import.meta.url)));
}
const ini=original("town_ini.cgi"),lib=original("town_lib.pl"),
  maker=original("town_maker.cgi");
const treasure=parseOriginalTreasure(original("gamerand.cgi"),original("otakara.cgi"),
  original("dat_dir/otakara.cgi"),ini);
const rules=parseOriginalRoadTransport(ini,lib,maker,treasure);
const NOW=Date.parse("2026-11-22T12:00:00Z");
const stats=()=>Object.fromEntries(STAT_KEYS.map(k=>[k,20]));
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,stats_json TEXT NOT NULL,money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  for(const id of [1,2])
    db.prepare("INSERT INTO characters(user_id,town_id,stats_json,money) VALUES(?,?,?,?)")
      .run(id,0,JSON.stringify(stats()),100000);
  initTreasureTables(db);
  initRoadTravelTables(db);
  return db;
}
function giveVehicle(db,name,{userId=1,sourceLine=3000001,remaining=null,origin=TREASURE_ORIGIN,
  mutateFields}={}){
  const item=treasure.pools.special.find(x=>x.name===name);
  assert.ok(item,"原版實際獎池有此物品："+name);
  const raw=[...item.rawFields];
  raw[26]="0";raw[30]=String(Math.floor(NOW/1000));
  raw[31]=String(Math.floor(item.price/item.durability));
  if(mutateFields)mutateFields(raw);
  db.prepare([
    "INSERT INTO legacy_inventory_items(",
    "user_id,original_id,source_line,category,original_name,effect,durability,",
    "durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,origin,sourceLine,raw[0],raw[1],raw[9],
    item.durability,raw[22],Math.floor(NOW/1000),0,JSON.stringify(raw));
  if(remaining!==null)
    db.prepare("INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms) VALUES(?,?,?,0)")
      .run(userId,sourceLine,remaining);
  return sourceLine;
}
function start(db,{userId=1,toTownId=1,vehicleSourceLine=null,
  requestId="phase62_road_trip",now=NOW,rolls=[14,14,14,14,14,9]}={}){
  let i=0;
  return beginRoadTrip(db,userId,rules,{toTownId,vehicleSourceLine,requestId,now,
    randomIndex:n=>{
      const roll=rolls[i++]??9;
      assert.ok([10,15].includes(n),"原版只有15點能力與10分之1事故");
      return roll;
    }});
}
function arrive(db,{userId=1,tripId=1,now=NOW+10000}={}){
  return arriveRoadTrip(db,userId,{tripId,now});
}
const town=(db,id=1)=>db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(id).town_id;
const scores=(db,id=1)=>JSON.parse(db.prepare("SELECT stats_json FROM characters WHERE user_id=?").get(id).stats_json);
const trips=db=>db.prepare("SELECT COUNT(*) n FROM arcade_road_trips").get().n;
const items=(db,id=1,now=NOW)=>heldInventoryRows(db,id,now);

test("原版町移動：徒步10秒、20個Hash載具、1/10事故與寶箱可對照車種",()=>{
  assert.equal(ROAD_WALKING_NAME,"徒歩");
  assert.equal(ROAD_HISTORY_LIMIT,20);
  assert.equal(rules.walkingSeconds,10);
  assert.equal(rules.accidentDenominator,10);
  assert.ok(rules.vehicles.length>=15);
  assert.equal(rules.vehicles.find(x=>x.name==="自転車").seconds,15);
  assert.equal(rules.vehicles.find(x=>x.name==="ポルシェ").seconds,3);
  assert.equal(rules.vehicles.find(x=>x.name==="フェラーリ").seconds,2);
  assert.equal(rules.vehicles.find(x=>x.name==="ミグ25").seconds,0);
  assert.equal(rules.vehicles.find(x=>x.name==="ローラースルーゴーゴー").seconds,20);
  assert.throws(()=>parseOriginalRoadTransport(ini.replace("$matiidou_time = '10';","$matiidou_time = '11';"),
    lib,maker,treasure),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini.replace("'ポルシェ','3'","'ポルシェ','4'"),
    lib,maker,treasure),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini.replace("$ziko_kakuritu = '10';","$ziko_kakuritu = '11';"),
    lib,maker,treasure),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini,lib,maker.replace("$syo_taikyuu -- ;","$syo_taikyuu -= 2 ;"),
    treasure),/已變更/);
});

test("徒步公路移動是持久的兩階段：步行可鍛鍊5項、未到10秒不能抵達",()=>{
  const db=setup();
  try{
    const result=start(db,{rolls:[0,1,2,3,4]});
    assert.equal(result.vehicleName,"徒歩");
    assert.equal(result.seconds,10);
    assert.equal(result.arrivalAt,NOW+10000);
    assert.equal(result.pending,true);
    assert.equal(result.accident,undefined);
    assert.equal(town(db),0,"出發尚未移動到目的地");
    assert.deepEqual(result.exercise,{
      tairyoku:1,kenkou:2,speed:3,wanryoku:4,kyakuryoku:5
    });
    assert.equal(scores(db).tairyoku,21);
    assert.equal(scores(db).kyakuryoku,25);
    assert.throws(()=>arrive(db,{now:NOW+9999}),/不能提前抵達/);
    assert.equal(town(db),0);
    const done=arrive(db);
    assert.equal(done.pending,false);
    assert.equal(done.accident,false);
    assert.equal(done.toTownId,1);
    assert.equal(town(db),1);
    assert.equal(roadOverview(db,1,rules,NOW+10000).pending,null);
    assert.equal(roadOverview(db,1,rules,NOW+10000).history.length,1);
    assert.equal(arrive(db).replayed,true);
    assert.equal(trips(db),1);
    assert.equal(scores(db).tairyoku,21,"抵達重送不會再提升能力");
  }finally{db.close();}
});

test("原版自行車15秒，五項身體能力門檻3/3/5/3/3；一次事故損耐久1",()=>{
  const db=setup();
  try{
    const sourceLine=giveVehicle(db,"自転車");
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,1);
    const t=start(db,{vehicleSourceLine:sourceLine,
      rolls:[0,2,4,2,3,0]});
    assert.equal(t.seconds,15);
    assert.equal(t.vehicleName,"自転車");
    assert.deepEqual(t.exercise,{tairyoku:1,kenkou:3,speed:5,wanryoku:3});
    const row=db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?")
      .get(sourceLine);
    assert.equal(row.remaining,3,"原版腳踏車初始耐久4，事故立即扣1");
    assert.equal(roadOverview(db,1,rules,NOW).choices[0].remaining,3);
    assert.equal(town(db),0);
    assert.throws(()=>arrive(db,{tripId:t.id,now:NOW+14999}),/倒數/);
    const arrived=arrive(db,{tripId:t.id,now:NOW+15000});
    assert.equal(arrived.accident,true);
    assert.equal(arrived.durabilityAfter,3);
    assert.equal(town(db),1);
    assert.equal(arrive(db,{tripId:t.id,now:NOW+15000}).replayed,true);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?")
      .get(sourceLine).remaining,3,"到站重放不應重複損耐久");
  }finally{db.close();}
});
test("法拉利2秒與米格25零秒：只接受真正從本人寶箱取得且33欄匹配的道具",()=>{
  const db=setup();
  try{
    const ferrari=giveVehicle(db,"フェラーリ",{sourceLine:3000010});
    const mig=giveVehicle(db,"ミグ25",{sourceLine:3000011});
    const first=start(db,{vehicleSourceLine:ferrari,rolls:[9]});
    assert.equal(first.seconds,2);
    assert.deepEqual(first.exercise,{});
    assert.equal(roadOverview(db,1,rules,NOW).pending.id,first.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0,
      "無事故不應新增道具使用／損耗紀錄");
    assert.equal(arrive(db,{tripId:first.id,now:NOW+2000}).accident,false);
    const fast=start(db,{vehicleSourceLine:mig,toTownId:2,
      requestId:"phase62_mig_second",now:NOW+2000,rolls:[9]});
    assert.equal(fast.seconds,0);
    assert.equal(fast.arrivalAt,NOW+2000);
    assert.equal(arrive(db,{tripId:fast.id,now:NOW+2000}).toTownId,2);
    assert.equal(town(db),2);
  }finally{db.close();}
});
test("不接受偽造載具、他人載具、原版來源不匹配或已耗盡耐久",()=>{
  const db=setup();
  try{
    const fake=giveVehicle(db,"ポルシェ",{
      sourceLine:3000020,origin:"__web_retail__"
    });
    const invalid=giveVehicle(db,"BMW",{sourceLine:3000021,
      mutateFields:f=>{f[14]="999";}});
    const spent=giveVehicle(db,"自転車",{sourceLine:3000022,remaining:0});
    const other=giveVehicle(db,"フェラーリ",{sourceLine:3000023,userId:2});
    const mine=roadOverview(db,1,rules,NOW);
    assert.equal(mine.choices.length,0);
    for(const sourceLine of [fake,invalid,spent,other,999999]){
      assert.throws(()=>start(db,{vehicleSourceLine:sourceLine}),/合法持有/);
    }
    assert.equal(trips(db),0);
    assert.equal(town(db),0);
  }finally{db.close();}
});
test("每人同時只有一段未抵達行程，不同帳戶可獨立出發、相同請求碼可回放",()=>{
  const db=setup();
  try{
    const p=start(db);
    const repeat=start(db,{requestId:"phase62_road_trip",now:NOW+5000,rolls:[0,0,0,0,0]});
    assert.equal(repeat.replayed,true);
    assert.equal(repeat.id,p.id);
    assert.deepEqual(repeat.exercise,p.exercise);
    assert.throws(()=>start(db,{toTownId:2,requestId:"phase62_road_trip"}),/不可更換/);
    assert.throws(()=>start(db,{requestId:"phase62_second_pending"}),/尚未抵達/);
    const other=start(db,{userId:2,requestId:"phase62_road_trip"});
    assert.equal(other.id>p.id,true);
    assert.equal(roadOverview(db,2,rules,NOW).pending.id,other.id);
    assert.throws(()=>arrive(db,{userId:2,tripId:p.id}),/找不到本人/);
    arrive(db,{tripId:p.id});
    assert.equal(town(db,2),0);
    assert.equal(town(db,1),1);
    assert.equal(trips(db),2);
  }finally{db.close();}
});
test("事故若為最後一點耐久則降至0且不再能選載具；依既有原版使用時間決定持有物移除",()=>{
  const db=setup();
  try{
    const id=giveVehicle(db,"ポルシェ",{remaining:1});
    const p=start(db,{vehicleSourceLine:id,rolls:[0]});
    assert.equal(p.seconds,3);
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,0);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1").get().remaining,0);
    assert.equal(items(db).length,0,"原版使用日期0，零耐久道具可清離持有欄");
    const done=arrive(db,{tripId:p.id,now:NOW+3000});
    assert.equal(done.durabilityAfter,0);
    assert.equal(done.accident,true);
  }finally{db.close();}
});
test("故障回滾：旅程紀錄寫入失敗不能留下鍛鍊或事故耐久損失",()=>{
  const db=setup();
  try{
    const id=giveVehicle(db,"自転車");
    db.exec("CREATE TRIGGER reject_road BEFORE INSERT ON arcade_road_trips BEGIN SELECT RAISE(ABORT,'road blocked'); END;");
    assert.throws(()=>start(db,{vehicleSourceLine:id,rolls:[0,0,0,0,0,0]}),/road blocked/);
    assert.equal(trips(db),0);
    assert.deepEqual(scores(db),stats());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    db.exec("DROP TRIGGER reject_road");
    assert.throws(()=>start(db,{vehicleSourceLine:id,rolls:[-1]}),/亂數/);
    assert.equal(trips(db),0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    const p=start(db,{vehicleSourceLine:id,rolls:[0,0,0,0,0,0]});
    assert.equal(trips(db),1);
    const altered=db.prepare("UPDATE characters SET town_id=3 WHERE user_id=1").run();
    assert.equal(altered.changes,1);
    assert.throws(()=>arrive(db,{tripId:p.id,now:NOW+15000}),/所在地已被其他操作改變/);
    assert.equal(roadOverview(db,1,rules,NOW).pending.id,p.id);
  }finally{db.close();}
});
test("20筆畫面紀錄上限與全量存檔，刪除角色後交易與物品外鍵清理",()=>{
  const db=setup();
  try{
    for(let i=0;i<23;i++){
      const from=town(db),to=(from+1)%4,now=NOW+i*20000;
      const p=start(db,{toTownId:to,now,
        requestId:"phase62_history_"+String(i).padStart(4,"0")});
      arrive(db,{tripId:p.id,now:now+10000});
    }
    assert.equal(trips(db),23);
    assert.equal(roadOverview(db,1,rules,NOW+23*20000).history.length,20);
    db.exec("DELETE FROM users WHERE id=1");
    assert.equal(trips(db),0);
    assert.equal(roadOverview(db,2,rules,NOW).history.length,0);
  }finally{db.close();}
});
