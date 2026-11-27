// 第62階段：原版 town_lib.pl 公路移動、town_ini.cgi 20種載具秒數、town_maker.cgi 事故耐久。
// 第65～66階段核實百貨18種原版載具；IT-02 再核實五款25點原版優惠券獎車。
// 專門店備註在原 CGI 只對「スーパー」進貨有限制，並非百貨上架禁令。
// 原版隨機迷路：未事故時原碼抽號卻未覆寫目的地；事故+迷路才覆寫四城目的地。
// Perl hash 的無序選車仍保留明確選車的Web差異。
// 原版在前端倒數後發出抵達請求；Web 持久化旅程、按遊戲時間到期後才可完成。
import {randomInt} from "node:crypto";
import {STAT_KEYS} from "./engine.mjs";
import {heldInventoryRows,inventoryLife} from "./inventory-life.mjs";
import {TREASURE_ORIGIN} from "./arcade-treasure.mjs";
import {RETAIL_ITEM_ORIGIN} from "./retail.mjs";
import {COUPON_ITEM_ORIGIN} from "./coupon-redemption.mjs";

export const ROAD_HISTORY_LIMIT=20;
export const ROAD_WALKING_NAME="徒歩";
export const ROAD_BUS_NAME="バス";
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const TOWNS=4;
const TRAINING_KEYS=Object.freeze(["tairyoku","kenkou","speed","wanryoku","kyakuryoku"]);
const CHANGEABLE_FIELDS=new Set([21,26,30,31]);
const LOST_ITEM_NAME="ローラースルーゴーゴー";
// 原版 dat_dir/syouhin.cgi 有18種符合 town_ini.cgi 交通名單的商品。
// 核對固定原始行號＋分類及33欄，防止把同名其他來源或舊資料當成已證實來源。
const VERIFIED_COUPON_ROAD_INDICES=Object.freeze(new Map([
  ["ポルシェ",8],["フェラーリ",9],["ジャガー",10],
  ["キャデラック",11],["ロータスヨーロッパ",12]
]));
const VERIFIED_RETAIL_ROAD_LINES=Object.freeze(new Map([
  ["アルファロメオ",328],["ボルボ",329],["ロールスロイス",330],
  ["カローラ",331],["ナナハン",332],["ドゥカティ",333],
  ["自転車",334],["スカイラインGTR",335],["ベンツ",336],
  ["スーパーカブ",337],["ローラースルーゴーゴー",338],
  ["ポルシェ",390],["ジャガー",391],["キャデラック",392],
  ["ミグ25",393],["BMW",394],["フェアレディZ",395],["ベスパ",396]
]));
function digits(value,label){
  if(typeof value!=="string"||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))
    throw new Error("原版公路移動"+label+"設定不正確");
  return Number(value);
}
export function parseOriginalRoadTransport(iniSource,libSource,makerSource,treasureCatalog,retailCatalog,couponCatalog=[]){
  if([iniSource,libSource,makerSource].some(x=>typeof x!=="string")||
     !treasureCatalog?.pools?.special||!Array.isArray(retailCatalog)||
     !Array.isArray(couponCatalog))
    throw new Error("原版道路交通或寶箱來源缺失");
  const walking=Number(/\$matiidou_time\s*=\s*'(\d+)'\s*;/.exec(iniSource)?.[1]);
  const accidentRate=Number(/\$ziko_kakuritu\s*=\s*'(\d+)'\s*;/.exec(iniSource)?.[1]);
  const pairSource=/%idou_syudan\s*=\s*\(([^;]+)\);/s.exec(iniSource)?.[1];
  const matches=pairSource?[...pairSource.matchAll(/'([^']+)'\s*,\s*'(\d+)'/g)]:[];
  const speeds=new Map(matches.map(x=>[x[1],Number(x[2])]));
  // 兩個「迷路」區塊的差異是原版實際行為關鍵：事故內真的覆寫town_no，
  // 單純迷路只抽no_rand卻沒使用它，message又會直接exit。
  const lostMarker="if ($in{'maigo'} eq 'yes')";
  const branches=makerSource.split(lostMarker);
  const safeNonAccident=branches.length===3&&
    branches[1].includes("$in{'town_no'} = $no_rand;")&&
    branches[2].includes("$no_rand=int(rand(4));")&&
    !branches[2].split("&event_happen;")[0].includes("$in{'town_no'} = $no_rand;");
  const messageBody=libSource.split("sub message {")[1]?.split("sub message_only {")[0];
  // 第64階段：巴士必須取消迷路、5秒、現金500元，且事故旗標強制關閉。
  const busBranch=libSource.split("#+++++++++バスで移動++++++++++")[1]
    ?.split("#+++++++++自転車、徒歩で移動++++++++++")[0];
  const busSeconds=Number(/\$matiidou_time2\s*=\s*(\d+);/.exec(busBranch??"")?.[1]);
  const busFare=Number(/\$money\s*-=\s*(\d+);/.exec(busBranch??"")?.[1]);
  const busChecks=[
    busBranch?.includes('if ($in{\'command\'} eq "mati_idou2"){'),
    busBranch?.includes("$maigo = 'no';"),
    busBranch?.includes('$idousyudan = "バスで500円で";'),
    busBranch?.includes('$ziko_idousyudan = "バス";'),
    busBranch?.includes("&temp_routin;"),
    busBranch?.includes("&log_kousin($my_log_file,$k_temp);"),
    libSource.includes("if ($ziko_idousyudan eq 'バス'){$ziko_flag  = \"off\";}")
  ];
  const checks=[
    libSource.includes('if ($in{\'command\'} eq "mati_idou" || $in{\'command\'} eq "mati_idou2")'),
    libSource.includes('&motimono_kensa("$_")'),
    libSource.includes('$matiidou_time2 = $idou_syudan{$_};'),
    libSource.includes('$randed = int (rand($ziko_kakuritu)+1);'),
    libSource.includes('if ($ziko_idousyudan eq \'徒歩\''),
    makerSource.includes('$syo_taikyuu -- ;'),
    makerSource.includes("if ($in{'ziko_flag'} eq \"on\" && $in{'ziko_idousyudan'} ne \"徒歩\")"),
    makerSource.includes("if ($in{'maigo'} eq 'yes')"),
    libSource.includes("if ($in{'maemati'} != 3){"),
    libSource.includes("&motimono_kensa_ev('ローラースルーゴーゴー');"),
    libSource.includes("if (int(rand(5)+1) == 1){"),
    libSource.includes("$maigo = 'yes';"),
    makerSource.includes("$no_rand=int(rand(4));"),
    makerSource.includes("$in{'town_no'} = $no_rand;"),
    makerSource.includes('if ($in{\'maigo\'} eq \'yes\')'),
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
     !safeNonAccident||!messageBody?.includes("exit;")||
     busSeconds!==5||busFare!==500||busChecks.some(x=>!x)||checks.some(x=>!x))
    throw new Error("原版公路移動載具秒數、鍛鍊、事故或迷路分支已變更");
  const items=treasureCatalog.pools.special.filter(item=>speeds.has(item.name));
  if(items.length<15)throw new Error("原版寶箱載具與道路移動來源未能對應");
  const retailVehicles=retailCatalog.filter(item=>VERIFIED_RETAIL_ROAD_LINES.has(item.name));
  if(retailVehicles.length!==VERIFIED_RETAIL_ROAD_LINES.size||
     retailVehicles.some(item=>
       VERIFIED_RETAIL_ROAD_LINES.get(item.name)!==item.originalLine||
       item.sku!=="legacy-"+item.originalLine||
       item.category!==(item.originalLine>=390?"ギフト":"乗り物")||
       item.effect!=="無"||
       item.durabilityUnit!=="回"||!Number.isSafeInteger(item.durability)||
       item.durability<1||item.rawFields?.length!==33||
       !item.rawFields[29]?.includes("※移動手段です。")||
       (item.originalLine>=390?item.rawFields[29].includes("専門店限定商品"):
         (item.originalLine<=331||item.originalLine===335||item.originalLine===336)?
         !item.rawFields[29].includes("専門店限定商品"):
         item.rawFields[29].includes("専門店限定商品"))||
       !speeds.has(item.name)))
    throw new Error("原版百貨公路載具來源、分類或備註已變更");
  // dat_dir/coupon.cgi 的五款25點獎品就是原版 idou_syudan 交通名單中載具。
  // 此商品來源類別為「クーポン交換品:25」，不是百貨的「乗り物／ギフト」；
  // 僅讀原版真實獎品表，不能把同名任意道具當成可上路的交通工具。
  const couponVehicles=couponCatalog.filter(x=>VERIFIED_COUPON_ROAD_INDICES.has(x.originalName));
  if(couponCatalog.length&&(
      couponVehicles.length!==VERIFIED_COUPON_ROAD_INDICES.size||
      couponVehicles.some(item=>{
        const raw=item.rawFields;
        return VERIFIED_COUPON_ROAD_INDICES.get(item.originalName)!==item.sourceIndex||
          item.requiredCoupons!==25||item.rewardCategory!=="クーポン交換品:25"||
          raw?.length!==33||raw[0]!==item.rewardCategory||raw[1]!==item.originalName||
          raw[9]!=="無"||raw[22]!=="回"||
          !Number.isSafeInteger(item.rewardDurability)||item.rewardDurability<1||
          raw[21]!==String(item.rewardDurability)||
          raw[29]!=="※移動手段です。当たり"||!speeds.has(item.originalName);
      })
    ))throw new Error("原版優惠券道路載具來源、分類或獎品欄位已變更");
  return Object.freeze({
    walkingSeconds:walking,accidentDenominator:accidentRate,
    busSeconds,busFare,
    vehicles:Object.freeze(items.map(item=>Object.freeze({
      name:item.name,seconds:speeds.get(item.name),
      category:item.category,rawFields:item.rawFields,
      origin:TREASURE_ORIGIN
    }))),
    retailVehicles:Object.freeze(retailVehicles.map(item=>Object.freeze({
      name:item.name,seconds:speeds.get(item.name),
      category:item.category,rawFields:item.rawFields,
      origin:RETAIL_ITEM_ORIGIN,sku:item.sku
    }))),
    couponVehicles:Object.freeze(couponVehicles.map(item=>Object.freeze({
      name:item.originalName,seconds:speeds.get(item.originalName),
      category:item.rewardCategory,rawFields:item.rawFields,
      origin:COUPON_ITEM_ORIGIN,sourceIndex:item.sourceIndex,
      couponCost:item.requiredCoupons
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
    "by_bus INTEGER NOT NULL DEFAULT 0 CHECK(by_bus IN(0,1)),",
    "fare_paid INTEGER NOT NULL DEFAULT 0 CHECK(fare_paid>=0),",
    "travel_seconds INTEGER NOT NULL CHECK(travel_seconds>=0),",
    "started_at INTEGER NOT NULL,arrival_at INTEGER NOT NULL,",
    "accident INTEGER NOT NULL CHECK(accident IN(0,1)),",
    "requested_to_town INTEGER CHECK(requested_to_town BETWEEN 0 AND 3),",
    "lost INTEGER NOT NULL DEFAULT 0 CHECK(lost IN(0,1)),",
    "rerouted INTEGER NOT NULL DEFAULT 0 CHECK(rerouted IN(0,1)),",
    "durability_after INTEGER,",
    "exercise_json TEXT NOT NULL,completed_at INTEGER,",
    "UNIQUE(user_id,request_id));",
    "CREATE UNIQUE INDEX IF NOT EXISTS arcade_road_open_user",
    "ON arcade_road_trips(user_id) WHERE completed_at IS NULL;",
    "CREATE INDEX IF NOT EXISTS arcade_road_user_history",
    "ON arcade_road_trips(user_id,id);"
  ].join(" "));
  // 由第62階段資料庫升級，既有旅程原本不曾有迷路結果；不重新抽取歷史。
  const columns=new Set(db.prepare("PRAGMA table_info(arcade_road_trips)").all().map(row=>row.name));
  if(!columns.has("by_bus"))
    db.exec("ALTER TABLE arcade_road_trips ADD COLUMN by_bus INTEGER NOT NULL DEFAULT 0");
  if(!columns.has("fare_paid"))
    db.exec("ALTER TABLE arcade_road_trips ADD COLUMN fare_paid INTEGER NOT NULL DEFAULT 0");
  if(!columns.has("requested_to_town"))
    db.exec("ALTER TABLE arcade_road_trips ADD COLUMN requested_to_town INTEGER");
  if(!columns.has("lost"))
    db.exec("ALTER TABLE arcade_road_trips ADD COLUMN lost INTEGER NOT NULL DEFAULT 0");
  if(!columns.has("rerouted"))
    db.exec("ALTER TABLE arcade_road_trips ADD COLUMN rerouted INTEGER NOT NULL DEFAULT 0");
  db.prepare("UPDATE arcade_road_trips SET requested_to_town=to_town WHERE requested_to_town IS NULL").run();
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
     row.original_id!==vehicle.origin||
     row.durability_unit!=="回")return false;
  return vehicle.rawFields.every((v,i)=>CHANGEABLE_FIELDS.has(i)||v===fields[i]);
}
function availableVehicles(db,userId,source,now){
  // 百貨車必須有與來源行、姓名、真正的本人購物流水對應的紀錄。
  // 只有自行寫入同名文字、偽造來源ID或33欄不足以通過這項條件。
  const hasRetailReceipts=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retail_purchases'").get();
  const retailReceipt=hasRetailReceipts?db.prepare([
    "SELECT 1 FROM retail_purchases WHERE user_id=? AND source_line=?",
    "AND sku=? AND name=? AND shop IN ('depart1','depart2') LIMIT 1"
  ].join(" ")):null;
  // 只有真實 Web 事件券兌換流水與本人背包 33 欄同時相符才允許上路。
  // 類別名、origin 或車名可被偽造，不能單獨作為載具身分證據。
  const hasCouponReceipts=db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='coupon_redemptions'"
  ).get();
  const couponReceipt=hasCouponReceipts?db.prepare([
    "SELECT 1 FROM coupon_redemptions WHERE user_id=? AND source_line=?",
    "AND source_index=? AND original_name=? AND coupon_cost=? LIMIT 1"
  ].join(" ")):null;
  return heldInventoryRows(db,userId,now).flatMap(row=>{
    const pool=row.original_id===TREASURE_ORIGIN?source.vehicles:
      row.original_id===RETAIL_ITEM_ORIGIN?source.retailVehicles:
      row.original_id===COUPON_ITEM_ORIGIN?(source.couponVehicles??[]):[];
    const v=pool.find(x=>x.name===row.original_name&&x.category===row.category);
    if(!v||!rawMatch(row,v))return [];
    if(v.origin===RETAIL_ITEM_ORIGIN&&!retailReceipt?.get(userId,row.source_line,v.sku,v.name))
      return [];
    if(v.origin===COUPON_ITEM_ORIGIN&&!couponReceipt?.get(
      userId,row.source_line,v.sourceIndex,v.name,v.couponCost))return [];
    const remaining=inventoryLife(row,now).remaining;
    if(!Number.isSafeInteger(remaining)||remaining<=0)return [];
    return [{sourceLine:row.source_line,name:v.name,seconds:v.seconds,remaining,
      category:v.category,origin:v.origin===RETAIL_ITEM_ORIGIN?"retail":
        v.origin===COUPON_ITEM_ORIGIN?"coupon":"treasure"}];
  });
}
function tripPublic(row){
  const pending=row.completed_at===null;
  // 原版迷路／改道結果只在「抵達」後公布；出發時維持玩家指定目的地。
  return {id:row.id,fromTownId:row.from_town,
    toTownId:pending?row.requested_to_town:row.to_town,
    requestedToTownId:row.requested_to_town,
    vehicleSourceLine:row.vehicle_source_line,vehicleName:row.vehicle_name,
    byBus:Boolean(row.by_bus),farePaid:row.fare_paid,
    seconds:row.travel_seconds,startedAt:row.started_at,
    arrivalAt:row.arrival_at,completedAt:row.completed_at,
    pending:row.completed_at===null,
    exercise:JSON.parse(row.exercise_json),
    ...(pending?{}:{
      accident:Boolean(row.accident),durabilityAfter:row.durability_after,
      lost:Boolean(row.lost),rerouted:Boolean(row.rerouted)
    })};
}
const SELECT_TRIP=[
  "SELECT id,from_town,to_town,vehicle_source_line,vehicle_name,by_bus,fare_paid,travel_seconds,",
  "started_at,arrival_at,accident,durability_after,exercise_json,completed_at,",
  "requested_to_town,lost,rerouted",
  "FROM arcade_road_trips"
].join(" ");
export function roadOverview(db,userId,source,now){
  const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  const open=db.prepare(SELECT_TRIP+" WHERE user_id=? AND completed_at IS NULL LIMIT 1")
    .get(userId);
  const history=db.prepare(SELECT_TRIP+" WHERE user_id=? AND completed_at IS NOT NULL ORDER BY id DESC LIMIT ?")
    .all(userId,ROAD_HISTORY_LIMIT).map(tripPublic);
  return {walkingSeconds:source.walkingSeconds,
    busSeconds:source.busSeconds,busFare:source.busFare,
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
  requestId,now,byBus=false,randomIndex=randomInt,lostRandomIndex=randomInt,
  rerouteRandomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<=0||
     !Number.isInteger(toTownId)||toTownId<0||toTownId>=TOWNS||
     (vehicleSourceLine!==null&&(!Number.isSafeInteger(vehicleSourceLine)||vehicleSourceLine<=0))||
     typeof byBus!=="boolean"||(byBus&&vehicleSourceLine!==null)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof randomIndex!=="function"||
     typeof lostRandomIndex!=="function"||typeof rerouteRandomIndex!=="function")
    throw new Error("原版公路移動目的地、載具或請求格式不正確");
  db.exec("BEGIN IMMEDIATE");
  try{
    const prior=db.prepare(SELECT_TRIP+" WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(prior){
      if(prior.requested_to_town!==toTownId||(prior.vehicle_source_line??null)!==vehicleSourceLine||
         Boolean(prior.by_bus)!==byBus)
        throw new Error("相同公路移動請求碼不可更換目的地或載具");
      db.exec("COMMIT");return {...tripPublic(prior),replayed:true};
    }
    const char=db.prepare("SELECT user_id,town_id,stats_json,money FROM characters WHERE user_id=?")
      .get(userId);
    if(!char)throw new Error("請先建立角色");
    if(char.town_id===toTownId)throw new Error("已在這座城鎮");
    if(!Number.isInteger(char.town_id)||char.town_id<0||char.town_id>=TOWNS)
      throw new Error("原版公路移動出發地不正確");
    const active=db.prepare("SELECT id FROM arcade_road_trips WHERE user_id=? AND completed_at IS NULL")
      .get(userId);
    if(active)throw new Error("上次公路移動尚未抵達，不能重複出發");
    const vehicle=byBus||vehicleSourceLine===null?null:
      availableVehicles(db,userId,source,now).find(x=>x.sourceLine===vehicleSourceLine);
    if(vehicleSourceLine!==null&&!vehicle)
      throw new Error("沒有本人合法持有且剩餘耐久大於0的原版寶箱／百貨／優惠券載具");
    // 巴士按原版出發前付款；Web 拒絕餘額不足（原 CGI 未防負現金）。
    // 扣款與行程寫入共用立即交易，任何失敗都不能留下單獨車資。
    if(byBus){
      if(!Number.isSafeInteger(char.money)||char.money<source.busFare)
        throw new Error("巴士車資500元：現金不足");
      const debit=db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
        .run(source.busFare,userId,source.busFare);
      if(debit.changes!==1)throw new Error("巴士車資扣款失敗");
    }
    // 原版先按出發城市判斷迷路：編號3不迷路；其餘若持有「ローラースルーゴーゴー」必定迷路，
    // 否則獨立1/5機率迷路。檢查「持有」而非只檢查這次選擇的車輛。
    const roller=!byBus&&char.town_id!==3&&availableVehicles(db,userId,source,now)
      .some(entry=>entry.name===LOST_ITEM_NAME);
    const lostRoll=byBus||char.town_id===3||roller?null:lostRandomIndex(5);
    if(lostRoll!==null&&(!Number.isInteger(lostRoll)||lostRoll<0||lostRoll>=5))
      throw new Error("伺服器公路迷路亂數超出原版範圍");
    const lost=!byBus&&char.town_id!==3&&(roller||lostRoll===0);
    const seconds=byBus?source.busSeconds:(vehicle?.seconds??source.walkingSeconds);
    const arrivalAt=now+seconds*1000;
    if(!Number.isSafeInteger(arrivalAt))
      throw new Error("公路移動時間超出安全範圍");
    const exercise=byBus?{}:exerciseWalk(db,char,vehicle,randomIndex);
    const crashRoll=byBus||vehicle===null?null:randomIndex(source.accidentDenominator);
    if(vehicle!==null&&(!Number.isInteger(crashRoll)||crashRoll<0||
       crashRoll>=source.accidentDenominator))
      throw new Error("伺服器公路事故亂數超出原版範圍");
    const accident=!byBus&&vehicle!==null&&crashRoll===0;
    // 原版只有「迷路且事故」才真正把 town_no 改成 int(rand(4))；
    // 單純迷路的 random(4) 存於未使用的 no_rand，最終仍走原目的地。
    const rerouted=lost&&accident;
    const newTown=rerouted?rerouteRandomIndex(TOWNS):toTownId;
    if(!Number.isInteger(newTown)||newTown<0||newTown>=TOWNS)
      throw new Error("伺服器迷路改道的城鎮亂數超出範圍");
    // 舊 CGI 在抵達後扣事故耐久；Web 為防行程中將載具轉手，改在出發時預先原子扣除。
    const durabilityAfter=accident?debitAccident(db,userId,vehicle,now):null;
    const added=db.prepare([
      "INSERT INTO arcade_road_trips(user_id,request_id,from_town,to_town,",
      "vehicle_source_line,vehicle_name,by_bus,fare_paid,travel_seconds,started_at,arrival_at,",
      "accident,durability_after,exercise_json,requested_to_town,lost,rerouted)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,char.town_id,newTown,
      vehicleSourceLine,byBus?ROAD_BUS_NAME:(vehicle?.name??ROAD_WALKING_NAME),
      byBus?1:0,byBus?source.busFare:0,seconds,
      now,arrivalAt,accident?1:0,durabilityAfter,JSON.stringify(exercise),
      toTownId,lost?1:0,rerouted?1:0);
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
