import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText,STAT_KEYS,bodyMassIndex} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {heldInventoryRows} from "../src/inventory-life.mjs";
import {listLegacyInventoryItems} from "../src/legacy-inventory.mjs";
import {retailItemDetails} from "../src/retail.mjs";
import {
  TREASURE_SYMBOL,TREASURE_ORIGIN,TREASURE_COOLDOWN_MS,
  TREASURE_HISTORY_LIMIT,TREASURE_BOXES,parseOriginalTreasure,initTreasureTables,
  treasureOverview,openTreasure
} from "../src/arcade-treasure.mjs";

const gamerand=decodeLegacyText(readFileSync(new URL("../../gamerand.cgi",import.meta.url)));
const original=decodeLegacyText(readFileSync(new URL("../../otakara.cgi",import.meta.url)));
const dat=decodeLegacyText(readFileSync(new URL("../../dat_dir/otakara.cgi",import.meta.url)));
const ini=decodeLegacyText(readFileSync(new URL("../../town_ini.cgi",import.meta.url)));
const source=parseOriginalTreasure(gamerand,original,dat,ini);
const NOW=Date.parse("2026-11-22T12:00:00Z");
function setup({money=100000000,building=true,health=-12}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(",
    "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,",
    "stats_json TEXT NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,",
    "recovered_at INTEGER NOT NULL,health_index INTEGER NOT NULL,weight REAL NOT NULL,",
    "height INTEGER NOT NULL,bmi REAL NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);"
  ].join(" "));
  const stats=Object.fromEntries(STAT_KEYS.map(k=>[k,20]));
  const p=db.prepare([
    "INSERT INTO characters(user_id,town_id,money,bank,stats_json,body_energy,brain_energy,",
    "recovered_at,health_index,weight,height,bmi) VALUES(?,0,?,?,?,100,100,?,?,60,165,?)"
  ].join(" "));
  p.run(1,money,55555,JSON.stringify(stats),NOW,health,bodyMassIndex(165,60));
  p.run(2,100000000,33333,JSON.stringify(stats),NOW,health,bodyMassIndex(165,60));
  initTownMapTable(db);
  const tiles=Array(192).fill("");
  if(building)tiles[0]=TREASURE_SYMBOL;
  storeTownMap(db,0,{tiles},"web-edited");
  initTreasureTables(db);
  return db;
}
function open(db,{userId=1,boxKey="copper",requestId="phase61_first",
  now=NOW,index=0}={}){
  return openTreasure(db,userId,source,{boxKey,requestId,now,
    randomIndex:limit=>{assert.equal(limit,source.pools[boxKey].length-1);return index;}});
}
const funds=(db,id=1)=>db.prepare("SELECT money,bank,health_index,stats_json FROM characters WHERE user_id=?").get(id);
const rounds=db=>db.prepare("SELECT COUNT(*) n FROM arcade_treasure_rounds").get().n;
const inventory=(db,id=1,now=NOW)=>heldInventoryRows(db,id,now);
const state=(db,id=1,now=NOW)=>treasureOverview(db,id,source,now);

test("來源核對四寶箱價格、110項33欄池、五分鐘與原版最後一筆不可抽",()=>{
  assert.equal(TREASURE_SYMBOL,"ゲーセン");
  assert.equal(TREASURE_COOLDOWN_MS,300000);
  assert.equal(TREASURE_HISTORY_LIMIT,20);
  assert.deepEqual(TREASURE_BOXES.map(x=>[x.key,x.price]),[
    ["copper",500],["silver",1000],["gold",2500000],["special",500000]
  ]);
  assert.deepEqual(state(setup()).boxes.map(x=>[x.poolSize,x.selectable]),
    [[34,33],[35,34],[39,38],[110,109]]);
  assert.equal(source.pools.special.at(-1).name,"究極の純プラチナカー");
  assert.ok(source.pools.gold.at(-1).name==="究極の純プラチナカー");
  assert.throws(()=>parseOriginalTreasure("",original,dat,ini),/已變更/);
  assert.throws(()=>parseOriginalTreasure(gamerand,original.replace("$mane_dou = 500;","$mane_dou = 501;"),dat,ini),/已變更/);
  assert.throws(()=>parseOriginalTreasure(gamerand,original.replace("int(rand($#dou_takaramono))","int(rand($#dou_takaramono+1))"),dat,ini),/已變更/);
  assert.throws(()=>parseOriginalTreasure(gamerand,original,dat.replace("金塊","鉛塊"),ini),/已變更/);
});

test("銅箱抽中原版第一項：扣500元且真正寫入33欄、原始耐久和可辨識來源",()=>{
  const db=setup();
  try{
    const prize=open(db);
    assert.equal(prize.kind,"inventory");
    assert.equal(prize.itemName,"銅のメダル 国");
    assert.equal(prize.price,500);
    assert.equal(prize.rewardCash,0);
    assert.equal(funds(db).money,99999500);
    assert.equal(funds(db).bank,55555);
    assert.equal(inventory(db).length,1);
    const row=inventory(db)[0];
    assert.equal(row.original_id,TREASURE_ORIGIN);
    assert.equal(row.original_name,prize.itemName);
    assert.equal(row.category,"銅の箱");
    assert.equal(row.durability,10);
    const raw=JSON.parse(row.raw_fields_json);
    assert.equal(raw.length,33);
    assert.equal(raw[0],"銅の箱");
    assert.equal(raw[1],prize.itemName);
    assert.equal(raw[21],"10");
    assert.equal(raw[30],String(Math.floor(NOW/1000)));
    const publicItems=listLegacyInventoryItems(db,1,50,retailItemDetails,NOW);
    assert.equal(publicItems[0].origin,"treasure");
    assert.equal(publicItems[0].readOnly,false);
    assert.equal(publicItems[0].sourceLine,prize.sourceLine);
    assert.equal(state(db).history[0].itemId,prize.itemId);
  }finally{db.close();}
});

test("銀箱狀態道具：原版中銀硬幣立刻增加國語15，不會假裝物品入庫",()=>{
  const db=setup();
  try{
    const prize=open(db,{boxKey:"silver",index:1});
    assert.equal(prize.itemName,"銀のコイン 国");
    assert.equal(prize.kind,"status");
    assert.equal(prize.changes.bonuses.kokugo,15);
    assert.equal(prize.rewardCash,0);
    assert.equal(JSON.parse(funds(db).stats_json).kokugo,35);
    assert.equal(funds(db).money,99999000);
    assert.equal(inventory(db).length,0);
    assert.equal(rounds(db),1);
  }finally{db.close();}
});

test("金箱原碼金塊的ステータス零能力分支給5000萬現金，不產出金塊道具",()=>{
  const db=setup();
  try{
    const prize=open(db,{boxKey:"gold",index:0});
    assert.equal(prize.itemName,"金塊");
    assert.equal(prize.kind,"status");
    assert.equal(prize.rewardCash,50000000);
    assert.equal(funds(db).money,147500000);
    assert.equal(funds(db).bank,55555);
    assert.deepEqual(prize.changes.bonuses,{});
    assert.equal(inventory(db).length,0);
  }finally{db.close();}
});

test("銀箱冷敷獎品無能力增幅，原版仍退獎品標價300元並按原病況改善疾病",()=>{
  const db=setup({health:-12});
  try{
    const prize=open(db,{boxKey:"silver",index:0});
    assert.equal(prize.itemName,"冷えピタクール");
    assert.equal(prize.kind,"status");
    assert.equal(prize.rewardCash,300);
    assert.equal(prize.changes.healthIndex,7);
    assert.equal(funds(db).health_index,-5);
    assert.equal(funds(db).money,99999300);
    assert.equal(inventory(db).length,0);
  }finally{db.close();}
  const healthy=setup({health:50});
  try{
    const prize=open(healthy,{boxKey:"silver",index:0});
    assert.equal(prize.changes.healthIndex,0);
    assert.equal(prize.rewardCash,300);
    assert.equal(funds(healthy).health_index,50);
  }finally{healthy.close();}
});

test("特殊箱從全110個原碼候選抽，不只抽專屬兩項；末項 excluded、倒數第二項可抽",()=>{
  const db=setup();
  try{
    const first=open(db,{boxKey:"special",index:0});
    assert.equal(first.itemName,"豪華クルージング");
    assert.equal(first.kind,"inventory");
    assert.equal(first.price,500000);
    assert.equal(inventory(db)[0].category,"スペシャル");
    const last=open(db,{boxKey:"special",requestId:"phase61_penultimate",
      now:NOW+300000,index:108});
    assert.equal(last.itemName,source.pools.special[108].name);
    assert.notEqual(last.itemName,source.pools.special[109].name);
    assert.equal(rounds(db),2);
  }finally{db.close();}
});

test("五分鐘本人冷卻不限制其他玩家：跨寶箱共用冷卻、299999ms拒絕，300000ms允許",()=>{
  const db=setup();
  try{
    open(db);
    assert.equal(state(db).readyAt,NOW+300000);
    assert.throws(()=>open(db,{boxKey:"silver",requestId:"phase61_early",now:NOW+299999}),/5分鐘/);
    const other=open(db,{userId:2,boxKey:"copper",requestId:"phase61_other"});
    assert.equal(other.itemName,"銅のメダル 国");
    const next=open(db,{boxKey:"silver",index:1,now:NOW+300000,requestId:"phase61_ready"});
    assert.equal(next.kind,"status");
    assert.equal(rounds(db),3);
    assert.equal(state(db,1).history.length,2);
    assert.equal(state(db,2).history.length,1);
  }finally{db.close();}
});

test("請求碼重送不重抽、不重扣、不改箱種，甚至冷卻中也可回放原結果",()=>{
  const db=setup();
  try{
    const first=open(db,{boxKey:"silver",index:1,requestId:"phase61_idempotent"});
    const replay=open(db,{boxKey:"silver",index:0,requestId:"phase61_idempotent",now:NOW+1000});
    assert.equal(replay.replayed,true);
    assert.equal(replay.itemName,first.itemName);
    assert.equal(rounds(db),1);
    assert.equal(inventory(db).length,0);
    assert.equal(JSON.parse(funds(db).stats_json).kokugo,35);
    assert.equal(funds(db).money,99999000);
    assert.throws(()=>open(db,{boxKey:"copper",requestId:"phase61_idempotent"}),/不可變更/);
  }finally{db.close();}
});

test("同一原始物品可保留33欄依五份上限堆疊，耐久是原始值不是抽象道具數",()=>{
  const db=setup();
  try{
    for(let i=0;i<5;i++)
      open(db,{now:NOW+i*300000,requestId:"phase61_stack_"+i.toString().padStart(4,"0")});
    assert.equal(inventory(db,1,NOW+5*300000).length,1);
    assert.equal(inventory(db)[0].durability,50);
    assert.equal(JSON.parse(inventory(db)[0].raw_fields_json)[21],"50");
    assert.throws(()=>open(db,{now:NOW+5*300000,requestId:"phase61_stack_6"}),/五份耐久上限/);
    assert.equal(rounds(db),5);
    assert.equal(funds(db).money,100000000-2500);
  }finally{db.close();}
});

test("無角色、無遊樂中心、錢不足、亂數超界及不合法請求均安全拒絕",()=>{
  const db=setup({money:499});
  try{
    assert.throws(()=>open(db),/現金不足/);
    assert.throws(()=>open(db,{userId:3}),/建立角色/);
    assert.throws(()=>open(db,{boxKey:"fake"}),/不正確/);
    assert.throws(()=>open(db,{requestId:"short"}),/不正確/);
    assert.equal(rounds(db),0);
  }finally{db.close();}
  const ample=setup();
  try{
    for(const value of [-1,33,1.5,NaN,Infinity])
      assert.throws(()=>open(ample,{index:value}),/亂數/);
    assert.equal(rounds(ample),0);
    assert.equal(funds(ample).money,100000000);
  }finally{ample.close();}
  const missing=setup({building:false});
  try{
    assert.equal(state(missing).available,false);
    assert.throws(()=>open(missing),/沒有原版遊樂中心/);
  }finally{missing.close();}
});

test("一般背包25格到上限：在原版扣款／抽牌前拒絕，避免獎品遺失",()=>{
  const db=setup();
  try{
    for(let i=0;i<25;i++){
      const row=[...source.pools.copper[i].rawFields];
      row[30]=String(Math.floor(NOW/1000));
      row[31]="10";
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
        "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(1,'__web_treasure__',?,?,?, ?,?, '回',?,0,?)"
      ].join(" ")).run(3100000+i,row[0],row[1],row[9],10,Math.floor(NOW/1000),JSON.stringify(row));
    }
    assert.equal(state(db).inventorySlots,25);
    assert.throws(()=>open(db),/已滿/);
    assert.equal(rounds(db),0);
    assert.equal(funds(db).money,100000000);
  }finally{db.close();}
});

test("外部交易失敗會同時回滾道具、直接能力與現金；安全上限亦拒絕",()=>{
  const db=setup();
  try{
    db.exec("CREATE TRIGGER reject_round BEFORE INSERT ON arcade_treasure_rounds BEGIN SELECT RAISE(ABORT,'treasure blocked'); END;");
    assert.throws(()=>open(db),/treasure blocked/);
    assert.equal(inventory(db).length,0);
    assert.equal(funds(db).money,100000000);
    assert.equal(rounds(db),0);
    assert.throws(()=>open(db,{boxKey:"silver",index:1}),/treasure blocked/);
    assert.equal(JSON.parse(funds(db).stats_json).kokugo,20);
    db.exec("DROP TRIGGER reject_round");
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>open(db,{boxKey:"gold",index:0}),/安全範圍/);
    assert.equal(rounds(db),0);
  }finally{db.close();}
});

test("完整紀錄23筆但本人畫面20筆，外鍵刪帳不污染其他帳戶",()=>{
  const db=setup();
  try{
    for(let i=0;i<23;i++)
      open(db,{boxKey:"silver",index:1,
        now:NOW+i*300000,requestId:"phase61_history_"+String(i).padStart(4,"0")});
    assert.equal(rounds(db),23);
    assert.equal(state(db).history.length,20);
    assert.equal(state(db).history[0].playedAt,NOW+22*300000);
    assert.equal(state(db).history.at(-1).playedAt,NOW+3*300000);
    open(db,{userId:2});
    db.exec("DELETE FROM users WHERE id=1");
    assert.equal(rounds(db),1);
    assert.equal(state(db,2).history.length,1);
  }finally{db.close();}
});
