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
import {parseLegacyRetailCatalog,initRetailTables,ensureRetailDay,buyRetailItem,RETAIL_ITEM_ORIGIN}
  from "../src/retail.mjs";

function original(path){
  return decodeLegacyText(readFileSync(new URL("../../"+path,import.meta.url)));
}
const ini=original("town_ini.cgi"),lib=original("town_lib.pl"),
  maker=original("town_maker.cgi");
const treasure=parseOriginalTreasure(original("gamerand.cgi"),original("otakara.cgi"),
  original("dat_dir/otakara.cgi"),ini);
const retailCatalog=parseLegacyRetailCatalog(original("dat_dir/syouhin.cgi"));
const rules=parseOriginalRoadTransport(ini,lib,maker,treasure,retailCatalog);
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
function setupRetailRoad(){
  const db=setup();
  db.exec("ALTER TABLE characters ADD COLUMN bank INTEGER NOT NULL DEFAULT 0");
  initRetailTables(db);
  return db;
}
function buyRetailVehicle(db,name,{userId=1,now=NOW,quantity=1}={}){
  const item=retailCatalog.find(row=>row.name===name&&row.category==="乗り物");
  assert.ok(item,"原版百貨存在此交通商品："+name);
  const day="2026-11-22";
  const selected=retailCatalog.filter(row=>rules.retailVehicles.some(v=>v.sku===row.sku));
  ensureRetailDay(db,selected,day,()=>0);
  return buyRetailItem(db,userId,selected,{
    shop:"depart1",sku:item.sku,
    requestId:"phase65_buy_"+item.sku+"_"+userId+"_"+quantity,
    now,day,quantity,hasBuilding:()=>true
  });
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
  requestId="phase62_road_trip",now=NOW,rolls=[14,14,14,14,14,9],
  lostRoll=4,rerouteTown=2}={}){
  let i=0;
  return beginRoadTrip(db,userId,rules,{toTownId,vehicleSourceLine,requestId,now,
    lostRandomIndex:n=>{assert.equal(n,5);return lostRoll;},
    rerouteRandomIndex:n=>{assert.equal(n,4);return rerouteTown;},
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
    lib,maker,treasure,retailCatalog),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini.replace("'ポルシェ','3'","'ポルシェ','4'"),
    lib,maker,treasure,retailCatalog),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini.replace("$ziko_kakuritu = '10';","$ziko_kakuritu = '11';"),
    lib,maker,treasure,retailCatalog),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini,lib,maker.replace("$syo_taikyuu -- ;","$syo_taikyuu -= 2 ;"),
    treasure,retailCatalog),/已變更/);
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


test("第63階段來源：四號城出發不迷路；其他城持有ローラースルーゴーゴー必迷路，否則1/5",()=>{
  assert.throws(()=>parseOriginalRoadTransport(ini,
    lib.replace("if ($in{'maemati'} != 3){","if ($in{'maemati'} != 2){"),
    maker,treasure,retailCatalog),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini,
    lib.replace("if (int(rand(5)+1) == 1){","if (int(rand(3)+1) == 1){"),
    maker,treasure,retailCatalog),/已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini,lib,
    maker.replace("$in{'town_no'} = $no_rand;","$in{'town_no'} = 1;"),
    treasure,retailCatalog),/已變更/);
});

test("第63階段單純迷路無事故：原版只顯示迷路，不會真正使用 rand(4) 改寫目的地",()=>{
  const db=setup();
  try{
    const journey=start(db,{toTownId:1,lostRoll:0,rerouteTown:3,
      requestId:"phase63_lost_walking",rolls:[14,14,14,14,14]});
    assert.equal(journey.toTownId,1);
    assert.equal(journey.requestedToTownId,1);
    assert.equal(journey.lost,undefined,"尚未到站不得先公布迷路");
    assert.equal(journey.rerouted,undefined);
    assert.equal(journey.accident,undefined);
    const row=db.prepare("SELECT lost,rerouted,to_town,requested_to_town FROM arcade_road_trips WHERE id=?")
      .get(journey.id);
    assert.deepEqual({...row},{lost:1,rerouted:0,to_town:1,requested_to_town:1});
    const after=arrive(db,{tripId:journey.id,now:NOW+10000});
    assert.equal(after.lost,true);
    assert.equal(after.rerouted,false);
    assert.equal(after.toTownId,1);
    assert.equal(town(db),1);
  }finally{db.close();}
});

test("第63階段持有輪滑車即使不選它，出發城不是3時迷路必觸發，事故才改道",()=>{
  const db=setup();
  try{
    const car=giveVehicle(db,"フェラーリ",{sourceLine:3000720});
    giveVehicle(db,"ローラースルーゴーゴー",{sourceLine:3000721});
    const journey=start(db,{vehicleSourceLine:car,toTownId:1,
      requestId:"phase63_roll_and_crash",rolls:[0],rerouteTown:2,lostRoll:4});
    assert.equal(journey.toTownId,1,"待抵達時不能洩漏實際轉向位置");
    assert.equal(journey.requestedToTownId,1);
    assert.equal(journey.lost,undefined);
    assert.equal(journey.accident,undefined);
    const stored=db.prepare("SELECT lost,rerouted,to_town,requested_to_town,accident FROM arcade_road_trips WHERE id=?")
      .get(journey.id);
    assert.deepEqual({...stored},{lost:1,rerouted:1,to_town:2,requested_to_town:1,accident:1});
    assert.equal(roadOverview(db,1,rules,NOW).pending.toTownId,1);
    const replay=start(db,{vehicleSourceLine:car,toTownId:1,
      requestId:"phase63_roll_and_crash",now:NOW+1000,rolls:[9],rerouteTown:3});
    assert.equal(replay.replayed,true);
    assert.equal(replay.toTownId,1);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?")
      .get(car).remaining,6,"僅法拉利原始7點耐久因事故扣1");
    const arrived=arrive(db,{tripId:journey.id,now:NOW+2000});
    assert.equal(arrived.toTownId,2);
    assert.equal(arrived.requestedToTownId,1);
    assert.equal(arrived.lost,true);
    assert.equal(arrived.rerouted,true);
    assert.equal(arrived.accident,true);
    assert.equal(town(db),2);
    assert.equal(arrive(db,{tripId:journey.id,now:NOW+2000}).replayed,true);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?")
      .get(car).remaining,6);
  }finally{db.close();}
});

test("第63階段從編號3出發，持有輪滑車且意外事故也不迷路",()=>{
  const db=setup();
  try{
    const car=giveVehicle(db,"ローラースルーゴーゴー");
    db.prepare("UPDATE characters SET town_id=3 WHERE user_id=1").run();
    const trip=start(db,{toTownId:1,vehicleSourceLine:car,requestId:"phase63_from_fourth",
      rolls:[0],lostRoll:0,rerouteTown:2});
    assert.equal(trip.seconds,20);
    const arrived=arrive(db,{tripId:trip.id,now:NOW+20000});
    assert.equal(arrived.lost,false);
    assert.equal(arrived.rerouted,false);
    assert.equal(arrived.accident,true);
    assert.equal(arrived.toTownId,1);
    assert.equal(town(db),1);
    assert.equal(arrived.durabilityAfter,3);
  }finally{db.close();}
});

test("第63階段沒有輪滑車，車禍且1/5迷路才隨機改道；亂數恰好選原目標也須保留事故迷路記錄",()=>{
  const db=setup();
  try{
    const car=giveVehicle(db,"ポルシェ");
    const first=start(db,{vehicleSourceLine:car,requestId:"phase63_tandem",
      lostRoll:0,rolls:[0],rerouteTown:1});
    assert.equal(first.toTownId,1);
    const arrived=arrive(db,{tripId:first.id,now:NOW+3000});
    assert.equal(arrived.lost,true);
    assert.equal(arrived.rerouted,true,"改道抽選可碰巧選中原本目標");
    assert.equal(arrived.toTownId,1);
    const next=start(db,{vehicleSourceLine:car,toTownId:2,
      requestId:"phase63_no_lost",now:NOW+4000,
      lostRoll:4,rolls:[0],rerouteTown:0});
    const nextDone=arrive(db,{tripId:next.id,now:NOW+7000});
    assert.equal(nextDone.lost,false);
    assert.equal(nextDone.rerouted,false);
    assert.equal(nextDone.accident,true);
    assert.equal(nextDone.toTownId,2);
  }finally{db.close();}
});

test("第63階段不合法迷路或改道亂數全部回滾，既不結案也不扣事故耐久",()=>{
  const db=setup();
  try{
    const car=giveVehicle(db,"フェラーリ");
    assert.throws(()=>start(db,{vehicleSourceLine:car,lostRoll:5,rolls:[0]}),/迷路亂數/);
    assert.equal(trips(db),0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    assert.throws(()=>start(db,{vehicleSourceLine:car,lostRoll:0,rerouteTown:4,rolls:[0]}),/改道/);
    assert.equal(trips(db),0);
    assert.equal(town(db),0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
  }finally{db.close();}
});

test("第63階段從第62階段舊SQLite無損升級：既有待抵達行程和完成歷史不重抽迷路",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,stats_json TEXT NOT NULL,money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "CREATE TABLE arcade_road_trips(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,from_town INTEGER NOT NULL,to_town INTEGER NOT NULL,",
    "vehicle_source_line INTEGER,vehicle_name TEXT NOT NULL,",
    "travel_seconds INTEGER NOT NULL,started_at INTEGER NOT NULL,arrival_at INTEGER NOT NULL,",
    "accident INTEGER NOT NULL,durability_after INTEGER,exercise_json TEXT NOT NULL,",
    "completed_at INTEGER,UNIQUE(user_id,request_id));"
  ].join(" "));
  db.prepare("INSERT INTO characters VALUES(1,0,?,100000)").run(JSON.stringify(stats()));
  db.prepare("INSERT INTO characters VALUES(2,1,?,100000)").run(JSON.stringify(stats()));
  const insert=db.prepare([
    "INSERT INTO arcade_road_trips(user_id,request_id,from_town,to_town,",
    "vehicle_name,travel_seconds,started_at,arrival_at,accident,exercise_json,completed_at)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" "));
  insert.run(1,"phase62_old_pending",0,1,"徒歩",10,NOW,NOW+10000,0,"{}",null);
  insert.run(2,"phase62_old_history",0,1,"徒歩",10,NOW-20000,NOW-10000,0,"{}",NOW-10000);
  try{
    initTreasureTables(db);
    initRoadTravelTables(db);
    initRoadTravelTables(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM arcade_road_trips").get().n,2);
    assert.deepEqual({...db.prepare("SELECT requested_to_town,lost,rerouted,by_bus,fare_paid FROM arcade_road_trips WHERE user_id=1").get()},
      {requested_to_town:1,lost:0,rerouted:0,by_bus:0,fare_paid:0});
    const old=roadOverview(db,1,rules,NOW);
    assert.equal(old.pending.id,1);
    assert.equal(old.pending.toTownId,1);
    assert.equal(old.pending.lost,undefined);
    const other=roadOverview(db,2,rules,NOW);
    assert.equal(other.history.length,1);
    assert.equal(other.history[0].lost,false);
    assert.equal(other.history[0].requestedToTownId,1);
    assert.equal(arrive(db,{tripId:1,now:NOW+10000}).lost,false);
    assert.equal(town(db),1);
    assert.equal(start(db,{toTownId:1,requestId:"phase62_old_pending"}).replayed,true);
  }finally{db.close();}
});

test("第64階段來源防改：原版巴士500元、5秒、取消迷路及事故全數核對",()=>{
  assert.equal(rules.busFare,500);
  assert.equal(rules.busSeconds,5);
  for(const change of [
    ["$money -= 500;","$money -= 600;"],
    ["$matiidou_time2 = 5;","$matiidou_time2 = 6;"],
    ["$maigo = 'no';","$maigo = 'yes';"],
    ["if ($ziko_idousyudan eq 'バス'){$ziko_flag  = \"off\";}",
     "if ($ziko_idousyudan eq 'バス'){$ziko_flag  = \"on\";}"]
  ]){
    assert.ok(lib.includes(change[0]),"原始來源確有待防改分支："+change[0]);
    assert.throws(()=>parseOriginalRoadTransport(ini,lib.replace(...change),maker,treasure,retailCatalog),
      /已變更/);
  }
});

test("第64階段巴士：持有輪滑車也不迷路／事故／鍛鍊，出發原子扣500元、5秒後才可到站",()=>{
  const db=setup();
  try{
    const roller=giveVehicle(db,"ローラースルーゴーゴー");
    const before=scores(db);
    const started=beginRoadTrip(db,1,rules,{
      toTownId:2,byBus:true,requestId:"phase64_bus_with_roller",now:NOW,
      randomIndex:()=>{throw new Error("巴士不應抽事故或鍛鍊");},
      lostRandomIndex:()=>{throw new Error("巴士應取消迷路");},
      rerouteRandomIndex:()=>{throw new Error("巴士不應重抽目的地");}
    });
    assert.equal(started.vehicleName,"バス");
    assert.equal(started.byBus,true);
    assert.equal(started.farePaid,500);
    assert.equal(started.seconds,5);
    assert.equal(started.arrivalAt,NOW+5000);
    assert.equal(started.pending,true);
    assert.equal(started.lost,undefined,"未到站仍不提前曝光迷路旗標");
    assert.equal(started.accident,undefined,"未到站仍不提前曝光事故旗標");
    assert.deepEqual(started.exercise,{});
    assert.deepEqual(scores(db),before,"巴士不可當徒步鍛鍊");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,99500);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage WHERE user_id=1").get().n,0,
      "巴士不損耗輪滑車");
    const raw=db.prepare("SELECT by_bus,fare_paid,accident,lost,rerouted,exercise_json FROM arcade_road_trips WHERE id=?").get(started.id);
    assert.deepEqual({...raw},{by_bus:1,fare_paid:500,accident:0,lost:0,rerouted:0,exercise_json:"{}"});
    assert.equal(roadOverview(db,1,rules,NOW).busFare,500);
    assert.equal(roadOverview(db,1,rules,NOW).pending.toTownId,2);
    assert.throws(()=>arrive(db,{tripId:started.id,now:NOW+4999}),/不能提前抵達/);
    const done=arrive(db,{tripId:started.id,now:NOW+5000});
    assert.equal(done.toTownId,2);
    assert.equal(done.lost,false);assert.equal(done.rerouted,false);
    assert.equal(done.accident,false);assert.equal(done.byBus,true);
    assert.equal(done.farePaid,500);
    assert.equal(town(db),2);
    assert.equal(items(db).some(x=>x.source_line===roller),true);
    assert.equal(arrive(db,{tripId:started.id,now:NOW+5000}).replayed,true);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,99500);
  }finally{db.close();}
});

test("第64階段巴士重送只扣一次；不可把同一請求碼改成徒步／換目的地，旅程中互斥",()=>{
  const db=setup();
  try{
    const options={toTownId:1,byBus:true,requestId:"phase64_bus_idempotent",now:NOW};
    const first=beginRoadTrip(db,1,rules,options);
    assert.equal(beginRoadTrip(db,1,rules,options).replayed,true);
    assert.equal(trips(db),1);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,99500);
    assert.throws(()=>beginRoadTrip(db,1,rules,{...options,byBus:false}),/相同公路移動請求碼/);
    assert.throws(()=>beginRoadTrip(db,1,rules,{...options,toTownId:2}),/相同公路移動請求碼/);
    assert.throws(()=>beginRoadTrip(db,1,rules,{...options,requestId:"phase64_bus_overlap"}),/尚未抵達/);
    assert.throws(()=>beginRoadTrip(db,1,rules,{...options,byBus:true,
      vehicleSourceLine:3000001,requestId:"phase64_bus_mixed"}),/格式不正確/);
    assert.throws(()=>beginRoadTrip(db,1,rules,{...options,byBus:1,
      requestId:"phase64_bus_invalid"}),/格式不正確/);
    assert.equal(arrive(db,{tripId:first.id,now:NOW+5000}).farePaid,500);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,99500);
  }finally{db.close();}
});

test("第64階段巴士扣款不足或SQLite寫入失敗應完全回滾，不能留下幽靈票款",()=>{
  const db=setup();
  try{
    db.prepare("UPDATE characters SET money=499 WHERE user_id=1").run();
    assert.throws(()=>beginRoadTrip(db,1,rules,{
      toTownId:1,byBus:true,requestId:"phase64_bus_poor",now:NOW
    }),/現金不足/);
    assert.equal(trips(db),0);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,499);
    db.prepare("UPDATE characters SET money=500 WHERE user_id=1").run();
    db.exec("CREATE TRIGGER reject_phase64_bus BEFORE INSERT ON arcade_road_trips BEGIN SELECT RAISE(ABORT,'forced bus rollback'); END");
    assert.throws(()=>beginRoadTrip(db,1,rules,{
      toTownId:1,byBus:true,requestId:"phase64_bus_rollback",now:NOW
    }),/forced bus rollback/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,500);
    assert.equal(trips(db),0);
    db.exec("DROP TRIGGER reject_phase64_bus");
    const trip=beginRoadTrip(db,1,rules,{
      toTownId:1,byBus:true,requestId:"phase64_bus_exact500",now:NOW
    });
    assert.equal(trip.farePaid,500);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,0);
  }finally{db.close();}
});

test("第64階段多人巴士交易與本人抵達隔離、相同請求碼可分別用於不同玩家",()=>{
  const db=setup();
  try{
    const input={toTownId:1,byBus:true,requestId:"phase64_two_people",now:NOW};
    const a=beginRoadTrip(db,1,rules,input),b=beginRoadTrip(db,2,rules,input);
    assert.notEqual(a.id,b.id);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,99500);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=2").get().money,99500);
    assert.throws(()=>arriveRoadTrip(db,2,{tripId:a.id,now:NOW+5000}),/找不到本人的/);
    assert.equal(town(db,2),0);
    assert.equal(arriveRoadTrip(db,1,{tripId:a.id,now:NOW+5000}).toTownId,1);
    assert.equal(roadOverview(db,2,rules,NOW+5000).pending.id,b.id);
    assert.equal(arriveRoadTrip(db,2,{tripId:b.id,now:NOW+5000}).toTownId,1);
    assert.equal(trips(db),2);
  }finally{db.close();}
});

test("第65階段既有五種普通百貨載具保持原速度，並兼容第66階段新增來源",()=>{
  assert.equal(rules.vehicles.length,19,"原寶箱獎池存在19種20名公路載具");
  const firstFive=rules.retailVehicles.filter(x=>x.category==="乗り物"&&!x.rawFields[29].includes("専門店限定商品"));
  assert.deepEqual(firstFive.map(x=>[x.name,x.seconds,x.sku]).sort((a,b)=>a[2].localeCompare(b[2])),[
    ["ナナハン",7,"legacy-332"],["ドゥカティ",7,"legacy-333"],
    ["自転車",15,"legacy-334"],["スーパーカブ",10,"legacy-337"],
    ["ローラースルーゴーゴー",20,"legacy-338"]
  ]);
  assert.ok(firstFive.every(x=>x.origin===RETAIL_ITEM_ORIGIN&&
    x.category==="乗り物"&&!x.rawFields[29].includes("専門店限定商品")));
  assert.throws(()=>parseOriginalRoadTransport(ini,lib,maker,treasure,
    retailCatalog.filter(x=>x.name!=="自転車")),/來源、分類或備註已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini,lib,maker,treasure,
    retailCatalog.map(x=>x.name==="自転車"?{...x,originalLine:999}:x)),/來源、分類或備註已變更/);
  assert.throws(()=>parseOriginalRoadTransport(ini,lib,maker,treasure,
    retailCatalog.map(x=>x.name==="自転車"?{
      ...x,rawFields:x.rawFields.map((v,i)=>i===29?"専門店限定商品":v)
    }:x)),/來源、分類或備註已變更/);
});

test("第65階段五輛原版百貨車實際交易入庫後可公路出發，腳踏車鍛鍊與事故耐久維持原版",()=>{
  const db=setupRetailRoad();
  try{
    db.prepare("UPDATE characters SET money=100000000 WHERE user_id=1").run();
    const receipts=new Map();
    for(const vehicle of rules.retailVehicles.filter(x=>x.category==="乗り物"&&
      !x.rawFields[29].includes("専門店限定商品"))){
      const bought=buyRetailVehicle(db,vehicle.name);
      assert.equal(bought.replayed,false);
      receipts.set(vehicle.name,bought);
      const original=db.prepare("SELECT original_id,category,original_name,durability FROM legacy_inventory_items WHERE user_id=1 AND source_line=?").get(bought.sourceLine);
      assert.equal(original.original_id,RETAIL_ITEM_ORIGIN);
      assert.equal(original.category,"乗り物");
      assert.equal(original.original_name,vehicle.name);
      assert.ok(original.durability>0);
    }
    const choices=roadOverview(db,1,rules,NOW).choices;
    assert.equal(choices.length,5);
    assert.ok(choices.every(x=>x.origin==="retail"));
    assert.deepEqual(choices.map(x=>x.name).sort(),rules.retailVehicles
      .filter(x=>x.category==="乗り物"&&!x.rawFields[29].includes("専門店限定商品"))
      .map(x=>x.name).sort());
    const bicycle=receipts.get("自転車");
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const trip=start(db,{vehicleSourceLine:bicycle.sourceLine,requestId:"phase65_retail_bike_1",
      rolls:[0,2,4,2,3,0],lostRoll:4,rerouteTown:2});
    assert.equal(trip.seconds,15);
    assert.equal(trip.vehicleName,"自転車");
    assert.equal(trip.pending,true);
    assert.equal(trip.lost,undefined);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before,
      "搭本人已購百貨車不需重付車資");
    assert.deepEqual(trip.exercise,{tairyoku:1,kenkou:3,speed:5,wanryoku:3});
    const remaining=db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?").get(bicycle.sourceLine);
    assert.equal(remaining.remaining,3);
    const done=arrive(db,{tripId:trip.id,now:NOW+15000});
    assert.equal(done.accident,true);
    assert.equal(done.lost,true,"持有百貨輪滑車，即使用百貨腳踏車出發也必迷路");
    assert.equal(done.rerouted,true);
    assert.equal(done.toTownId,2);
    assert.equal(town(db),2);
    assert.equal(arrive(db,{tripId:trip.id,now:NOW+15000}).replayed,true);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1 AND source_line=?").get(bicycle.sourceLine).remaining,3,
      "重播不能再次扣百貨車耐久");
  }finally{db.close();}
});

test("第65～66階段來源保護：無本人購買流水、偽造33欄及跨帳號車輛都不能上路",()=>{
  const db=setupRetailRoad();
  try{
    const bicycle=retailCatalog.find(x=>x.name==="自転車"&&x.category==="乗り物");
    const fake=[...bicycle.rawFields];
    fake[30]=String(Math.floor(NOW/1000));
    fake[31]="15000";
    db.prepare([
      "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,",
      "category,original_name,effect,durability,durability_unit,",
      "purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(1,RETAIL_ITEM_ORIGIN,1888888,"乗り物","自転車","無",
      bicycle.durability,"回",Math.floor(NOW/1000),0,JSON.stringify(fake));
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,0,
      "僅造出同名百貨道具但沒有購物流水不能騎車");
    assert.throws(()=>start(db,{vehicleSourceLine:1888888,
      requestId:"phase65_no_purchase"}),/合法持有/);
    db.prepare("DELETE FROM legacy_inventory_items WHERE source_line=1888888").run();
    const bought=buyRetailVehicle(db,"ローラースルーゴーゴー",{userId:2});
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,0);
    assert.equal(roadOverview(db,2,rules,NOW).choices[0].sourceLine,bought.sourceLine);
    assert.throws(()=>start(db,{vehicleSourceLine:bought.sourceLine,
      requestId:"phase65_cross_user"}),/合法持有/);
    db.prepare("UPDATE characters SET money=100000000 WHERE user_id=1").run();
    const specialist=retailCatalog.find(x=>x.name==="アルファロメオ"&&x.category==="乗り物");
    assert.match(specialist.rawFields[29],/専門店限定商品/);
    db.exec("DELETE FROM retail_stock;DELETE FROM retail_day;");
    ensureRetailDay(db,[specialist],"2026-11-22",()=>0);
    const specialBuy=buyRetailItem(db,1,[specialist],{
      shop:"depart1",sku:specialist.sku,requestId:"phase65_specialist_regression",
      day:"2026-11-22",now:NOW,hasBuilding:()=>true
    });
    assert.ok(specialBuy.sourceLine);
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,1,
      "原版百貨可取得専門店標記商品，真實百貨購買後應能搭車");
    assert.equal(roadOverview(db,1,rules,NOW).choices[0].name,"アルファロメオ");
  }finally{db.close();}
});

test("第65階段百貨車需要相符購物流水與完整33欄，使用次數歸零即從交通選單移除",()=>{
  const db=setupRetailRoad();
  try{
    db.prepare("UPDATE characters SET money=100000000 WHERE user_id=1").run();
    const bought=buyRetailVehicle(db,"自転車",{quantity:2});
    assert.equal(roadOverview(db,1,rules,NOW).choices[0].remaining,8);
    const row=db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=1 AND source_line=?").get(bought.sourceLine);
    assert.equal(row.durability,8);
    assert.equal(JSON.parse(row.raw_fields_json)[21],"8");
    db.prepare("UPDATE retail_purchases SET sku='legacy-999' WHERE source_line=?").run(bought.sourceLine);
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,0,
      "錯誤的原始商品SKU不得用同名來通過驗證");
    db.prepare("UPDATE retail_purchases SET sku='legacy-334' WHERE source_line=?").run(bought.sourceLine);
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,1);
    const raw=JSON.parse(row.raw_fields_json);
    raw[29]="使用其他文字偽造車輛";
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json=? WHERE user_id=1 AND source_line=?")
      .run(JSON.stringify(raw),bought.sourceLine);
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,0,
      "非法修改不可變原始欄位不得通過驗證");
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json=? WHERE user_id=1 AND source_line=?")
      .run(row.raw_fields_json,bought.sourceLine);
    db.prepare("INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms) VALUES(?,?,0,0)")
      .run(1,bought.sourceLine);
    assert.equal(roadOverview(db,1,rules,NOW).choices.length,0,"車輛耐久耗盡不可上路");
  }finally{db.close();}
});
