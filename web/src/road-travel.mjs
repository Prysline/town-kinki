// 第62階段：原版 town_lib.pl 公路移動、town_ini.cgi 20種載具秒數、town_maker.cgi 事故耐久。
// 僅驗證來自原版寶箱的33欄載具；步行不需要任何道具。
// 原版迷路的 CGI 欄位與 Perl hash 的無序選車尚未移植，Web 明確讓玩家選載具。
// 原版在前端倒數後發出抵達請求；Web 持久化旅程、按遊戲時間到期後才可完成。
import {randomInt} from "node:crypto";
import {STAT_KEYS} from "./engine.mjs";
import {heldInventoryRows,inventoryLife} from "./inventory-life.mjs";
import {TREASURE_ORIGIN} from "./arcade-treasure.mjs";

export const ROAD_HISTORY_LIMIT=20;
export const ROAD_WALKING_NAME="徒歩";
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const TOWNS=4;
const TRAINING_KEYS=Object.freeze(["tairyoku","kenkou","speed","wanryoku","kyakuryoku"]);
const CHANGEABLE_FIELDS=new Set([21,26,30,31]);
function digits(value,label){
  if(typeof value!=="string"||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))
    throw new Error("原版公路移動"+label+"設定不正確");
  return Number(value);
}
export function parseOriginalRoadTransport(iniSource,libSource,makerSource,treasureCatalog){
  if([iniSource,libSource,makerSource].some(x=>typeof x!=="string")||
     !treasureCatalog?.pools?.special)
    throw new Error("原版道路交通或寶箱來源缺失");
  const walking=Number(/\$matiidou_time\s*=\s*'(\d+)'\s*;/.exec(iniSource)?.[1]);
  const accidentRate=Number(/\$ziko_kakuritu\s*=\s*'(\d+)'\s*;/.exec(iniSource)?.[1]);
  const pairSource=/%idou_syudan\s*=\s*\(([^;]+)\);/s.exec(iniSource)?.[1];
  const matches=pairSource?[...pairSource.matchAll(/'([^']+)'\s*,\s*'(\d+)'/g)]:[];
  const speeds=new Map(matches.map(x=>[x[1],Number(x[2])]));
  const checks=[
    libSource.includes('if ($in{\'command\'} eq "mati_idou" || $in{\'command\'} eq "mati_idou2")'),
    libSource.includes('&motimono_kensa("$_")'),
    libSource.includes('$matiidou_time2 = $idou_syudan{$_};'),
    libSource.includes('$randed = int (rand($ziko_kakuritu)+1);'),
    libSource.includes('if ($ziko_idousyudan eq \'徒歩\''),
    makerSource.includes('$syo_taikyuu -- ;'),
    makerSource.includes("if ($in{'ziko_flag'} eq \"on\" && $in{'ziko_idousyudan'} ne \"徒歩\")"),
    makerSource.includes("if ($in{'maigo'} eq 'yes')"),
    libSource.includes('$tairyku_up = int(rand(15)+1);'),
    libSource.includes('$kenkou_up = int(rand(15)+1);'),
    libSource.includes('$speed_up = int(rand(15)+1);'),
    libSource.includes('$wanryoku_up = int(rand(15)+1);'),
    libSource.includes('$kyakuryoku_up = int(rand(15)+1);')
  ];
  if(walking!==10||accidentRate!==10||matches.length!==20||speeds.size!==20||
     speeds.get("自転車")!==15||speeds.get("ポルシェ")!==3||
     speeds.get("フェラーリ")!==2||speeds.get("ミグ25")!==0||
     speeds.get("ローラースルーゴーゴー")!==20||
     [...speeds.values()].some(v=>!Number.isSafeInteger(v)||v<0||v>3600)||
     checks.some(x=>!x))
    throw new Error("原版公路移動載具秒數、鍛鍊、事故或迷路分支已變更");
  const items=treasureCatalog.pools.special.filter(item=>speeds.has(item.name));
  if(items.length<15)throw new Error("原版寶箱載具與道路移動來源未能對應");
  return Object.freeze({
    walkingSeconds:walking,accidentDenominator:accidentRate,
    vehicles:Object.freeze(items.map(item=>Object.freeze({
      name:item.name,seconds:speeds.get(item.name),
      category:item.category,rawFields:item.rawFields
    })))
  });
}
export function initRoadTravelTables(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_road_trips(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,from_town INTEGER NOT NULL CHECK(from_town BETWEEN 0 AND 3),",
    "to_town INTEGER NOT NULL CHECK(to_town BETWEEN 0 AND 3),",
    "vehicle_source_line INTEGER,vehicle_name TEXT NOT NULL,",
    "travel_seconds INTEGER NOT NULL CHECK(travel_seconds>=0),",
    "started_at INTEGER NOT NULL,arrival_at INTEGER NOT NULL,",
    "accident INTEGER NOT NULL CHECK(accident IN(0,1)),",
    "durability_after INTEGER,",
    "exercise_json TEXT NOT NULL,completed_at INTEGER,",
    "UNIQUE(user_id,request_id));",
    "CREATE UNIQUE INDEX IF NOT EXISTS arcade_road_open_user",
    "ON arcade_road_trips(user_id) WHERE completed_at IS NULL;",
    "CREATE INDEX IF NOT EXISTS arcade_road_user_history",
    "ON arcade_road_trips(user_id,id);"
  ].join(" "));
}
function rawMatch(row,vehicle){
  let fields;
  try{fields=JSON.parse(row.raw_fields_json);}catch{return false;}
  if(!Array.isArray(fields)||fields.length!==33||
     fields.some(x=>typeof x!=="string")||
     fields[0]!==row.category||fields[1]!==row.original_name||
     fields[21]!==String(row.durability)||
     fields[22]!==row.durability_unit||
     row.category!==vehicle.category||
     row.original_name!==vehicle.name||
     row.original_id!==TREASURE_ORIGIN||
     row.durability_unit!=="回")return false;
  return vehicle.rawFields.every((v,i)=>CHANGEABLE_FIELDS.has(i)||v===fields[i]);
}
function availableVehicles(db,userId,source,now){
  return heldInventoryRows(db,userId,now).flatMap(row=>{
    const v=source.vehicles.find(x=>x.name===row.original_name&&x.category===row.category);
    if(!v||!rawMatch(row,v))return [];
    const remaining=inventoryLife(row,now).remaining;
    if(!Number.isSafeInteger(remaining)||remaining<=0)return [];
    return [{sourceLine:row.source_line,name:v.name,seconds:v.seconds,remaining}];
  });
}
function tripPublic(row){
  return {id:row.id,fromTownId:row.from_town,toTownId:row.to_town,
    vehicleSourceLine:row.vehicle_source_line,vehicleName:row.vehicle_name,
    seconds:row.travel_seconds,startedAt:row.started_at,
    arrivalAt:row.arrival_at,completedAt:row.completed_at,
    pending:row.completed_at===null,
    exercise:JSON.parse(row.exercise_json),
    ...(row.completed_at===null?{}:{
      accident:Boolean(row.accident),durabilityAfter:row.durability_after
    })};
}
const SELECT_TRIP=[
  "SELECT id,from_town,to_town,vehicle_source_line,vehicle_name,travel_seconds,",
  "started_at,arrival_at,accident,durability_after,exercise_json,completed_at",
  "FROM arcade_road_trips"
].join(" ");
export function roadOverview(db,userId,source,now){
  const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  const open=db.prepare(SELECT_TRIP+" WHERE user_id=? AND completed_at IS NULL LIMIT 1")
    .get(userId);
  const history=db.prepare(SELECT_TRIP+" WHERE user_id=? AND completed_at IS NOT NULL ORDER BY id DESC LIMIT ?")
    .all(userId,ROAD_HISTORY_LIMIT).map(tripPublic);
  return {walkingSeconds:source.walkingSeconds,
    accidentDenominator:source.accidentDenominator,
    choices:character?availableVehicles(db,userId,source,now):[],
    pending:open?tripPublic(open):null,history};
}
function exerciseWalk(db,char,vehicle,randomIndex){
  if(vehicle!==null&&vehicle.name!=="自転車")return {};
  let stats;
  try{stats=JSON.parse(char.stats_json);}catch{throw new Error("原版公路移動角色能力存檔毀損");}
  if(!stats||typeof stats!=="object")throw new Error("原版公路移動角色能力存檔毀損");
  const bounds=vehicle===null?[5,5,5,5,5]:[3,3,5,3,3];
  const exercise={};
  for(let i=0;i<5;i++){
    const idx=randomIndex(15);
    if(!Number.isInteger(idx)||idx<0||idx>=15)
      throw new Error("原版徒步／自行車能力訓練亂數不正確");
    const score=idx+1;
    const key=TRAINING_KEYS[i],before=stats[key];
    if(!Number.isSafeInteger(before)||before<0)
      throw new Error("原版公路移動角色能力存檔毀損");
    if(score<=bounds[i]){
      if(!Number.isSafeInteger(before+score))
        throw new Error("原版公路鍛鍊能力超出安全範圍");
      stats[key]=before+score;
      exercise[key]=score;
    }
  }
  if(Object.keys(exercise).length)
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=?")
      .run(JSON.stringify(stats),char.user_id);
  return exercise;
}
function debitAccident(db,userId,vehicle,now){
  if(!vehicle)return null;
  const row=db.prepare([
    "SELECT i.*,u.remaining AS web_remaining,u.last_used_at_ms",
    "FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u",
    "ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? AND i.source_line=?"
  ].join(" ")).get(userId,vehicle.sourceLine);
  if(!row)throw new Error("發生事故時已找不到本人載具");
  const remaining=inventoryLife(row,now).remaining;
  if(!Number.isSafeInteger(remaining)||remaining<1)
    throw new Error("事故載具耐久不足");
  const after=remaining-1,lastUsed=row.last_used_at_ms??
    (/^\d+$/.test(JSON.parse(row.raw_fields_json)[26])?
      Number(JSON.parse(row.raw_fields_json)[26])*1000:0);
  if(!Number.isSafeInteger(lastUsed)||lastUsed<0)
    throw new Error("事故載具原始使用時間不正確");
  db.prepare([
    "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
    "VALUES(?,?,?,?) ON CONFLICT(user_id,source_line) DO UPDATE",
    "SET remaining=excluded.remaining"
  ].join(" ")).run(userId,vehicle.sourceLine,after,lastUsed);
  return after;
}
export function beginRoadTrip(db,userId,source,{toTownId,vehicleSourceLine=null,
  requestId,now,randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<=0||
     !Number.isInteger(toTownId)||toTownId<0||toTownId>=TOWNS||
     (vehicleSourceLine!==null&&(!Number.isSafeInteger(vehicleSourceLine)||vehicleSourceLine<=0))||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof randomIndex!=="function")
    throw new Error("原版公路移動目的地、載具或請求格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare(SELECT_TRIP+" WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(prior){
      if(prior.to_town!==toTownId||(prior.vehicle_source_line??null)!==vehicleSourceLine)
        throw new Error("相同公路移動請求碼不可更換目的地或載具");
      db.exec("COMMIT");return {...tripPublic(prior),replayed:true};
    }
    const char=db.prepare("SELECT user_id,town_id,stats_json FROM characters WHERE user_id=?")
      .get(userId);
    if(!char)throw new Error("請先建立角色");
    if(char.town_id===toTownId)throw new Error("已在這座城鎮");
    if(!Number.isInteger(char.town_id)||char.town_id<0||char.town_id>=TOWNS)
      throw new Error("原版公路移動出發地不正確");
    const active=db.prepare("SELECT id FROM arcade_road_trips WHERE user_id=? AND completed_at IS NULL")
      .get(userId);
    if(active)throw new Error("上次公路移動尚未抵達，不能重複出發");
    const vehicle=vehicleSourceLine===null?null:
      availableVehicles(db,userId,source,now).find(x=>x.sourceLine===vehicleSourceLine);
    if(vehicleSourceLine!==null&&!vehicle)
      throw new Error("沒有本人合法持有且剩餘耐久大於0的原版寶箱載具");
    const seconds=vehicle?.seconds??source.walkingSeconds;
    const arrivalAt=now+seconds*1000;
    if(!Number.isSafeInteger(arrivalAt))
      throw new Error("公路移動時間超出安全範圍");
    const exercise=exerciseWalk(db,char,vehicle,randomIndex);
    const crashRoll=vehicle===null?null:randomIndex(source.accidentDenominator);
    if(vehicle!==null&&(!Number.isInteger(crashRoll)||crashRoll<0||
       crashRoll>=source.accidentDenominator))
      throw new Error("伺服器公路事故亂數超出原版範圍");
    const accident=vehicle!==null&&crashRoll===0;
    // 舊 CGI 在抵達後扣事故耐久；Web 為防行程中將載具轉手，改在出發時預先原子扣除。
    const durabilityAfter=accident?debitAccident(db,userId,vehicle,now):null;
    const added=db.prepare([
      "INSERT INTO arcade_road_trips(user_id,request_id,from_town,to_town,",
      "vehicle_source_line,vehicle_name,travel_seconds,started_at,arrival_at,",
      "accident,durability_after,exercise_json)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,char.town_id,toTownId,
      vehicleSourceLine,vehicle?.name??ROAD_WALKING_NAME,seconds,
      now,arrivalAt,accident?1:0,durabilityAfter,JSON.stringify(exercise));
    const created=db.prepare(SELECT_TRIP+" WHERE id=?").get(Number(added.lastInsertRowid));
    db.exec("COMMIT");return {...tripPublic(created),replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
export function arriveRoadTrip(db,userId,{tripId,now}={}){
  if(!Number.isSafeInteger(userId)||userId<=0||
     !Number.isSafeInteger(tripId)||tripId<=0||
     !Number.isSafeInteger(now)||now<=0)
    throw new Error("公路抵達請求格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const trip=db.prepare(SELECT_TRIP+" WHERE id=? AND user_id=?").get(tripId,userId);
    if(!trip)throw new Error("找不到本人的原版公路行程");
    if(trip.completed_at!==null){
      db.exec("COMMIT");return {...tripPublic(trip),replayed:true};
    }
    if(now<trip.arrival_at)throw new Error("公路移動仍在倒數中，不能提前抵達");
    const changed=db.prepare("UPDATE characters SET town_id=? WHERE user_id=? AND town_id=?")
      .run(trip.to_town,userId,trip.from_town);
    if(changed.changes!==1)
      throw new Error("角色所在地已被其他操作改變，公路抵達被拒絕");
    db.prepare("UPDATE arcade_road_trips SET completed_at=? WHERE id=?")
      .run(now,trip.id);
    const done=db.prepare(SELECT_TRIP+" WHERE id=?").get(trip.id);
    db.exec("COMMIT");return {...tripPublic(done),replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
