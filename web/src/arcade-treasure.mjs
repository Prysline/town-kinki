// 第61階段：原版 otakara.cgi 四種寶箱。現金／能力直接入帳，其他獎品保留33欄原始道具。
// 原版 int(rand($#array)) 會排除最後一個候選；不將它錯當完整陣列均等機率。
import {randomInt} from "node:crypto";
import {STAT_KEYS,maxBodyEnergy,maxBrainEnergy,bodyMassIndex,recoverEnergy} from "./engine.mjs";
import {diseaseFromIndex} from "./health.mjs";
import {readTownMap} from "./town-storage.mjs";
import {heldInventoryRows,inventoryLife} from "./inventory-life.mjs";
import {initLegacyItemUseTables} from "./legacy-item-use.mjs";

export const TREASURE_SYMBOL="ゲーセン";
export const TREASURE_ORIGIN="__web_treasure__";
export const TREASURE_COOLDOWN_MS=5*60_000;
export const TREASURE_HISTORY_LIMIT=20;
export const TREASURE_SLOT_LIMIT=25;
export const TREASURE_STACK_LIMIT=5;
export const TREASURE_BOXES=Object.freeze([
  Object.freeze({key:"copper",name:"銅の箱",price:500}),
  Object.freeze({key:"silver",name:"銀の箱",price:1000}),
  Object.freeze({key:"gold",name:"金の箱",price:2500000}),
  Object.freeze({key:"special",name:"スペシャル",price:500000})
]);
const REQUEST_ID=/^[A-Za-z0-9_-]{8,80}$/;
const STAT_POS=Object.freeze([2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20]);
const COUNTS=Object.freeze({"スペシャル":2,"銀の箱":35,"銅の箱":34,"金の箱":39});
const MAX_SAFE=Number.MAX_SAFE_INTEGER;

function safeInt(s,allowNegative=false){
  if(typeof s!=="string"||!(allowNegative?/^-?\d+$/:/^\d+$/).test(s))
    throw new Error("原版寶箱道具包含不合法的整數欄位");
  const n=Number(s);
  if(!Number.isSafeInteger(n))throw new Error("原版寶箱數值超出安全整數");
  return n;
}
function toRaw(line,index){
  const fields=line.replace(/\r$/,"").split("<>");
  if(fields.length===34&&fields[33]==="")fields.pop();
  if(fields.length!==33||fields.some(x=>x.length>4096))
    throw new Error("原版寶箱獎池第"+index+"行不是33欄");
  const [category,name]=fields;
  if(!Object.hasOwn(COUNTS,category)||!name)
    throw new Error("原版寶箱獎池包含未知類別或空白名稱");
  const durability=safeInt(fields[21]),price=safeInt(fields[17]);
  if(durability<1||!["回","日"].includes(fields[22]))
    throw new Error("原版寶箱獎品耐久或使用單位不合法");
  const bonuses=STAT_POS.map(i=>safeInt(fields[i],true));
  const effect=fields[9];
  if(!["無","ステータス","風邪,7","万能,"].includes(effect))
    throw new Error("原版寶箱獎品包含尚未證實的特殊效果");
  const calories=fields[25]===""?0:safeInt(fields[25],true);
  const bodyCost=fields[27]===""?0:safeInt(fields[27],true);
  const brainCost=fields[28]===""?0:safeInt(fields[28],true);
  safeInt(fields[23]);safeInt(fields[24]);
  return Object.freeze({id:"treasure-"+index,sourceLine:index,category,name,
    effect,price,durability,unit:fields[22],bonuses:Object.freeze(bonuses),
    calories,bodyCost,brainCost,rawFields:Object.freeze(fields)});
}
export function parseOriginalTreasure(gamerandSource,treasureSource,datSource,settingsSource){
  if([gamerandSource,treasureSource,datSource,settingsSource].some(s=>typeof s!=="string"))
    throw new Error("原版寶箱 CGI、獎池或設定來源缺失");
  const prices=[
    /\$mane_dou\s*=\s*(\d+)\s*;/,
    /\$mane_gin\s*=\s*(\d+)\s*;/,
    /\$mane_kin\s*=\s*(\d+)\s*;/,
    /\$mane_sp\s*=\s*(\d+)\s*;/
  ].map(re=>Number(re.exec(treasureSource)?.[1]));
  const minute=Number(/\$otakara_game_time\s*=\s*(\d+)\s*;/.exec(treasureSource)?.[1]);
  const basic=Number(/\$koudou_seigen\s*=\s*["'](\d+)["']\s*;/.exec(settingsSource)?.[1]);
  if(!gamerandSource.includes('action="otakara.cgi"')||
     !gamerandSource.includes("<>otakara<>")||
     !treasureSource.includes('if($in{\'mode\'} eq "otakara"){&otakara;}')||
     !treasureSource.includes("$ota_rentou = 'yes'")||
     !treasureSource.includes("$motiganeseigen = 'yes'")||
     !treasureSource.includes('if ($now_time - $ota_time < 60*$otakara_game_time)')||
     !treasureSource.includes('if ($syo_kouka ne "無"')||
     !treasureSource.includes('if ($print_messe eq "")')||
     !treasureSource.includes('$money += $syo_nedan;')||
     !treasureSource.includes('$money -= $otakara_money;'))
     throw new Error("原版寶箱入口、費用或分支已變更");
  // 上述比較涵蓋可執行分支；額外保留四個陣列的原始 off-by-one，避免無意中抽到最後一項。
  if(prices.some((p,i)=>p!==TREASURE_BOXES[i].price)||
     minute!==5||basic!==5||
     (treasureSource.match(/int\(rand\(\$#(?:takaramono|kin_takaramono|gin_takaramono|dou_takaramono)\)\)/g)??[]).length!==4||
     !treasureSource.includes('if ($my_item_suu >= $syoyuu_gendosuu')||
     !treasureSource.includes('&buy_otakara;')||
     !treasureSource.includes('&takara_sutetasu;')||
     !treasureSource.includes('$syo_taikyuu += $katta_taikyuu')||
     !treasureSource.includes('if ($syo_kouka =~ m/ギフト/)')||
     !treasureSource.includes('$syo_cal / 1000'))
    throw new Error("原版寶箱價格、抽樣邊界、狀態效果或物品規則已變更");
  const rows=datSource.split(/\r?\n/).slice(1).filter(x=>x.trim())
    .map((line,i)=>toRaw(line,i+2));
  if(rows.length!==110||Object.entries(COUNTS).some(([key,n])=>
    rows.filter(row=>row.category===key).length!==n)||
     rows[0].name!=="豪華クルージング"||
     rows.at(-1).name!=="究極の純プラチナカー"||
     !rows.some(row=>row.name==="金塊"&&row.effect==="ステータス"&&
       row.price===50000000&&row.bonuses.every(n=>n===0)))
    throw new Error("原版寶箱110筆獎池內容或順序已變更");
  const pools=Object.fromEntries(TREASURE_BOXES.map(box=>{
    const list=box.key==="special"?rows:rows.filter(row=>row.category===box.name);
    return [box.key,Object.freeze(list)];
  }));
  return Object.freeze({boxes:TREASURE_BOXES,pools:Object.freeze(pools),
    cooldownMs:minute*60_000});
}
export function initTreasureTables(db){
  // 寶箱可能在首次開箱後就進行「回」制耐久合併；獨立初始化時亦須有使用紀錄表。
  initLegacyItemUseTables(db);
  db.exec([
    "CREATE TABLE IF NOT EXISTS arcade_treasure_rounds(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "request_id TEXT NOT NULL,",
    "box_key TEXT NOT NULL CHECK(box_key IN('copper','silver','gold','special')),",
    "item_id TEXT NOT NULL,item_name TEXT NOT NULL,",
    "price INTEGER NOT NULL CHECK(price>0),",
    "kind TEXT NOT NULL CHECK(kind IN ('inventory','status')),",
    "reward_cash INTEGER NOT NULL CHECK(reward_cash>=0),",
    "inventory_source_line INTEGER,",
    "effects_json TEXT NOT NULL,",
    "played_at INTEGER NOT NULL,",
    "UNIQUE(user_id,request_id));",
    "CREATE INDEX IF NOT EXISTS arcade_treasure_user_idx",
    "ON arcade_treasure_rounds(user_id,id);"
  ].join(" "));
}
function publicRound(row){
  return {boxKey:row.box_key,itemId:row.item_id,itemName:row.item_name,
    price:row.price,kind:row.kind,rewardCash:row.reward_cash,
    sourceLine:row.inventory_source_line,changes:JSON.parse(row.effects_json),
    playedAt:row.played_at};
}
function currentInventory(db,userId,now){
  return heldInventoryRows(db,userId,now).map(row=>({
    ...row,remainingNow:inventoryLife(row,now).remaining
  })).filter(row=>row.remainingNow>0);
}
function itemCategory(item){
  if(item.effect.includes("ギフト"))return "ギフト";
  if(item.effect.includes("食料品"))return "食料品";
  if(item.effect.includes("ファ"))return "ファーストフード";
  return item.category;
}
function itemIsImmediate(item){
  return item.effect!=="無"&&!item.effect.includes("ギフト")&&
    !item.effect.includes("食料品")&&!item.effect.includes("ファ");
}
function availableHere(db,townId){
  const map=readTownMap(db,townId);
  return map.configured&&map.tiles.includes(TREASURE_SYMBOL);
}
function lastPlayed(db,userId){
  return db.prepare("SELECT played_at FROM arcade_treasure_rounds WHERE user_id=? ORDER BY id DESC LIMIT 1")
    .get(userId)?.played_at;
}
export function treasureOverview(db,userId,source,now){
  const character=db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(userId);
  const last=lastPlayed(db,userId);
  const history=db.prepare([
    "SELECT box_key,item_id,item_name,price,kind,reward_cash,",
    "inventory_source_line,effects_json,played_at",
    "FROM arcade_treasure_rounds WHERE user_id=? ORDER BY id DESC LIMIT ?"
  ].join(" ")).all(userId,TREASURE_HISTORY_LIMIT).map(publicRound);
  const inventory=currentInventory(db,userId,now);
  const normal=inventory.filter(x=>x.category!=="ギフト"&&x.category!=="ギフト商品").length;
  const gifts=inventory.filter(x=>x.category==="ギフト").length;
  const giftGoods=inventory.filter(x=>x.category==="ギフト商品").length;
  return {available:character?availableHere(db,character.town_id):false,
    boxes:source.boxes.map(box=>({...box,poolSize:source.pools[box.key].length,
      selectable:source.pools[box.key].length-1})),
    cooldownMs:source.cooldownMs,readyAt:last===undefined?null:last+source.cooldownMs,
    inventorySlots:normal,giftSlots:gifts,giftGoodsSlots:giftGoods,
    slotLimits:{normal:TREASURE_SLOT_LIMIT,gift:10,giftGoods:11},
    history};
}
function grantStatus(item,character,now){
  const stats=JSON.parse(character.stats_json);
  if(!stats||typeof stats!=="object")throw new Error("角色能力資料毀損");
  const bonuses={},oldStats={...stats};
  let gained=false;
  for(let i=0;i<STAT_KEYS.length;i++){
    const key=STAT_KEYS[i],delta=item.bonuses[i],old=stats[key];
    if(!Number.isSafeInteger(old)||old<0||
       !Number.isSafeInteger(old+delta)||old+delta<0)
      throw new Error("寶箱狀態能力增幅超出安全範圍");
    if(delta!==0){stats[key]=old+delta;bonuses[key]=delta;gained=true;}
  }
  // 原版先做 if($print_messe eq "")；若所有能力值增幅為0，就發還物品標價。
  const rewardCash=gained?0:item.price;
  const nextMoney=character.money-item.boxPrice+rewardCash;
  if(!Number.isSafeInteger(nextMoney)||nextMoney<0)
    throw new Error("寶箱現金獎勵超出安全範圍");
  const bodyCost=item.bodyCost,brainCost=item.brainCost;
  const base={stats:oldStats,bodyEnergy:character.body_energy,
    brainEnergy:character.brain_energy,recoveredAt:character.recovered_at};
  const energy=recoverEnergy(base,now);
  if(energy.bodyEnergy<bodyCost||energy.brainEnergy<brainCost)
    throw new Error("寶箱獎品直接生效所需能量不足");
  const bodyEnergy=Math.max(0,Math.min(maxBodyEnergy(stats),energy.bodyEnergy-bodyCost));
  const brainEnergy=Math.max(0,Math.min(maxBrainEnergy(stats),energy.brainEnergy-brainCost));
  const disease=diseaseFromIndex(character.health_index).key;
  let health=character.health_index;
  if(item.effect==="風邪,7"&&["slightCold","cold"].includes(disease))health+=7;
  if(item.effect.startsWith("万能,")){
    const value=item.effect.split(",")[1];
    if(value)health+=safeInt(value);
  }
  if(!Number.isSafeInteger(health))throw new Error("寶箱疾病指數超出安全範圍");
  const weight=Math.max(.01,Math.round((character.weight+item.calories/1000)*100)/100);
  if(!Number.isFinite(weight))throw new Error("寶箱體重變化超出範圍");
  const bmi=bodyMassIndex(character.height,weight);
  return {nextMoney,health,stats,bodyEnergy,brainEnergy,recoveredAt:now,weight,bmi,
    rewardCash,changes:{bonuses,healthIndex:health-character.health_index,
      weight:Math.round((weight-character.weight)*100)/100,
      bodyEnergy:bodyEnergy-character.body_energy,
      brainEnergy:brainEnergy-character.brain_energy}};
}
function grantInventory(db,userId,item,now){
  const active=currentInventory(db,userId,now);
  const normal=active.filter(row=>row.category!=="ギフト"&&row.category!=="ギフト商品").length;
  const gift=active.filter(row=>row.category==="ギフト").length;
  const giftGoods=active.filter(row=>row.category==="ギフト商品").length;
  if(normal>=TREASURE_SLOT_LIMIT||gift>=10||giftGoods>=11)
    throw new Error("持有物已達原版箱子抽獎容量限制");
  const category=itemCategory(item);
  let existing=active.find(row=>row.original_id===TREASURE_ORIGIN&&
    row.category===category&&row.original_name===item.name&&
    row.effect===item.effect&&row.durability_unit===item.unit);
  const at=Math.floor(now/1000);
  if(existing){
    const before=existing.remainingNow,amount=before+item.durability;
    if(!Number.isSafeInteger(amount)||amount>item.durability*TREASURE_STACK_LIMIT)
      throw new Error("寶箱相同道具已達原版五份耐久上限");
    let fields;
    try{fields=JSON.parse(existing.raw_fields_json);}catch{}
    if(!Array.isArray(fields)||fields.length!==33||
       fields[0]!==category||fields[1]!==item.name||
       fields[21]!==String(existing.durability))
      throw new Error("既有寶箱物品33欄與持有資訊不一致");
    fields[21]=String(amount);
    const purchase=item.unit==="日"?at:existing.purchased_at;
    if(item.unit==="日")fields[30]=String(at);
    const last=Number.isSafeInteger(existing.purchased_at)?existing.purchased_at:0;
    const previousUnit=/^\d+$/.test(fields[31])?BigInt(fields[31]):0n;
    const unitValue=(previousUnit*BigInt(before)+BigInt(item.price))/BigInt(amount);
    if(unitValue>BigInt(MAX_SAFE))throw new Error("寶箱持有物單價超出安全範圍");
    fields[31]=String(unitValue);
    db.prepare([
      "UPDATE legacy_inventory_items SET durability=?,purchased_at=?,raw_fields_json=?",
      "WHERE user_id=? AND source_line=? AND original_id=?"
    ].join(" ")).run(amount,purchase,JSON.stringify(fields),userId,existing.source_line,TREASURE_ORIGIN);
    if(item.unit==="回"){
      db.prepare([
        "UPDATE legacy_item_usage SET remaining=?",
        "WHERE user_id=? AND source_line=?"
      ].join(" ")).run(amount,userId,existing.source_line);
    }
    return {sourceLine:existing.source_line,merged:true,amount};
  }
  const max=db.prepare("SELECT COALESCE(MAX(source_line),0) n FROM legacy_inventory_items WHERE user_id=?")
    .get(userId).n;
  const sourceLine=Math.max(3_000_000,max+1);
  if(!Number.isSafeInteger(sourceLine))throw new Error("寶箱物品行號超出安全範圍");
  const fields=[...item.rawFields];
  fields[0]=category;
  fields[21]=String(item.durability);
  fields[26]="0";
  fields[30]=String(at);
  fields[31]=String(Math.floor(item.price/item.durability));
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,TREASURE_ORIGIN,sourceLine,category,item.name,item.effect,
    item.durability,item.unit,at,0,JSON.stringify(fields));
  return {sourceLine,merged:false,amount:item.durability};
}
export function openTreasure(db,userId,source,{boxKey,requestId,now,randomIndex=randomInt}={}){
  if(!Number.isSafeInteger(userId)||userId<=0||
     !TREASURE_BOXES.some(x=>x.key===boxKey)||
     typeof requestId!=="string"||!REQUEST_ID.test(requestId)||
     !Number.isSafeInteger(now)||now<=0||typeof randomIndex!=="function")
    throw new Error("寶箱類型、請求碼或時間不正確");
  const box=source.boxes.find(x=>x.key===boxKey);
  const pool=source.pools[boxKey];
  db.exec("BEGIN IMMEDIATE");
  try{
    const previous=db.prepare([
      "SELECT box_key,item_id,item_name,price,kind,reward_cash,",
      "inventory_source_line,effects_json,played_at",
      "FROM arcade_treasure_rounds WHERE user_id=? AND request_id=?"
    ].join(" ")).get(userId,requestId);
    if(previous){
      if(previous.box_key!==boxKey)
        throw new Error("相同寶箱請求碼不可變更箱子類型");
      db.exec("COMMIT");return {...publicRound(previous),replayed:true};
    }
    const character=db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId);
    if(!character)throw new Error("請先建立角色");
    if(!availableHere(db,character.town_id))
      throw new Error("所在城鎮沒有原版遊樂中心");
    const previousTime=lastPlayed(db,userId);
    if(previousTime!==undefined&&now<previousTime+source.cooldownMs)
      throw new Error("原版寶箱仍需等候5分鐘");
    if(!Number.isSafeInteger(character.money)||character.money<box.price)
      throw new Error("身上現金不足以開啟原版寶箱");
    const slots=currentInventory(db,userId,now);
    if(slots.filter(x=>x.category!=="ギフト"&&x.category!=="ギフト商品").length>=TREASURE_SLOT_LIMIT||
       slots.filter(x=>x.category==="ギフト").length>=10||
       slots.filter(x=>x.category==="ギフト商品").length>=11)
      throw new Error("持有物已滿，原版寶箱不允許抽獎");
    const index=randomIndex(pool.length-1);
    if(!Number.isInteger(index)||index<0||index>=pool.length-1)
      throw new Error("伺服器寶箱抽獎亂數超出原版索引範圍");
    const item=pool[index];
    const immediate=itemIsImmediate(item);
    let rewardCash=0,sourceLine=null,changes={},nextMoney=character.money-box.price;
    if(immediate){
      const outcome=grantStatus({...item,boxPrice:box.price},character,now);
      ({rewardCash,changes}=outcome);
      nextMoney=outcome.nextMoney;
      db.prepare([
        "UPDATE characters SET money=?,stats_json=?,body_energy=?,brain_energy=?,",
        "recovered_at=?,health_index=?,weight=?,bmi=? WHERE user_id=?"
      ].join(" ")).run(nextMoney,JSON.stringify(outcome.stats),outcome.bodyEnergy,
        outcome.brainEnergy,outcome.recoveredAt,outcome.health,outcome.weight,
        outcome.bmi,userId);
    }else{
      const received=grantInventory(db,userId,item,now);
      sourceLine=received.sourceLine;
      changes={merged:received.merged,addedDurability:item.durability};
      db.prepare("UPDATE characters SET money=money-? WHERE user_id=? AND money>=?")
        .run(box.price,userId,box.price);
    }
    db.prepare([
      "INSERT INTO arcade_treasure_rounds(user_id,request_id,box_key,item_id,item_name,",
      "price,kind,reward_cash,inventory_source_line,effects_json,played_at)",
      "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ].join(" ")).run(userId,requestId,boxKey,item.id,item.name,box.price,
      immediate?"status":"inventory",rewardCash,sourceLine,JSON.stringify(changes),now);
    db.exec("COMMIT");
    return {boxKey,itemId:item.id,itemName:item.name,price:box.price,
      kind:immediate?"status":"inventory",rewardCash,sourceLine,
      changes,playedAt:now,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
