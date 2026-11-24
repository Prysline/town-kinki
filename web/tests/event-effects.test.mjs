import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { NON_ITEM_EVENT_IDS,resolveNonItemEvent } from "../src/event-effects.mjs";
import { initCharacterEvents,settleDailyIllnessEvent,listCharacterEvents } from "../src/events.mjs";

const BASE_STATS={kokugo:20,suugaku:20,rika:20,syakai:20,bijutu:20,love:20,
  eigo:20,ongaku:20,looks:20,tairyoku:20,kenkou:20,speed:20,power:20,
  wanryoku:20,kyakuryoku:20,unique:20,etti:20};
function row(overrides={}) {
  return {money:100000,weight:60,height:165,bmi:22,
    body_energy:20,brain_energy:20,job_experience:60,recovered_at:1000,
    stats_json:JSON.stringify(BASE_STATS),...overrides};
}
function rng(...values) {
  let i=0;
  return ()=>{if(i>=values.length)throw new Error("多次抽選超出測試預期");return values[i++];};
}
function dbSetup() {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',money INTEGER NOT NULL DEFAULT 100000,weight REAL NOT NULL DEFAULT 60,height INTEGER NOT NULL DEFAULT 165,bmi REAL NOT NULL DEFAULT 22,body_energy INTEGER NOT NULL DEFAULT 20,brain_energy INTEGER NOT NULL DEFAULT 20,job_experience INTEGER NOT NULL DEFAULT 60,recovered_at INTEGER NOT NULL DEFAULT 1000,stats_json TEXT NOT NULL DEFAULT '{}');",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,stats_json) VALUES(1,'"+JSON.stringify(BASE_STATS)+"'),(2,'"+JSON.stringify(BASE_STATS)+"');"
  ].join("\n"));
  initCharacterEvents(db);
  return db;
}
function eventNumber(id) {return (id-0.5)/44;}
function trigger(db,id,randoms=[],day="2026-11-19",user=1) {
  return settleDailyIllnessEvent(db,user,day,100000,
    rng(0,eventNumber(id),...randoms));
}

test("已移植 38 種事件分支（含聖誕老人戰鬥與四次元福袋），其他未移植事件不產生虛構效果",()=>{
  assert.deepEqual(NON_ITEM_EVENT_IDS,[1,2,3,5,6,7,8,9,10,11,12,13,14,16,17,18,19,20,21,22,23,24,25,26,27,29,30,31,32,33,34,35,38,39,41,42,43,44]);
  for(const id of NON_ITEM_EVENT_IDS){
    const values={1:[.1,.9],2:[.1],3:[.1],7:[.1],8:[.1],9:[.1],
      10:[.1],11:[.1],12:[.1],13:[.1],17:[.1],18:[.1],20:[.1],21:[.1],
      16:[.1],22:[.1],23:[.1,.1],24:[.8],26:[0],30:[.1],33:[0],34:[.1],35:[.1],42:[.1]};
    const e=resolveNonItemEvent(id,row({bank:10000,town_id:0}),rng(...values[id]??[]));
    assert.ok(e);
    assert.equal(e.event.originalId,id);
    assert.ok(e.event.description);
  }
  for(const id of [4,15,28,36,37,40])
    assert.equal(resolveNonItemEvent(id,row()),null);
});

test("扒手事件依原版先抽 1 至 100000 元，再以二分之一機率被偷或獲得謝禮",()=>{
  const loss=resolveNonItemEvent(1,row(),rng(0,.1));
  assert.equal(loss.changes.money,99999);
  assert.equal(loss.effects.money,-1);
  assert.match(loss.event.description,/損失現金 1 元/);
  const reward=resolveNonItemEvent(1,row(),rng(.999999,.99));
  assert.equal(reward.changes.money,200000);
  assert.equal(reward.effects.money,100000);
  const empty=resolveNonItemEvent(1,row({money:0}),rng(.8,0));
  assert.equal(empty.changes.money,0);
  assert.equal(empty.effects.money,0);
});

test("錢包、NHK、幸運抽獎與販賣機找零使用原始金額，現金不足時不變負數",()=>{
  assert.equal(resolveNonItemEvent(2,row(),rng(0)).changes.money,100001);
  assert.equal(resolveNonItemEvent(2,row(),rng(.999999)).changes.money,110000);
  assert.equal(resolveNonItemEvent(5,row()).changes.money,99000);
  assert.equal(resolveNonItemEvent(5,row({money:200})).effects.money,-200);
  assert.equal(resolveNonItemEvent(13,row(),rng(0)).changes.money,110000);
  assert.equal(resolveNonItemEvent(13,row(),rng(.999)).changes.money,250000);
  assert.equal(resolveNonItemEvent(41,row()).changes.money,101000);
});

test("五個學科事件依原版以五成機率各加或減 3 點，其他能力不變",()=>{
  const expected={7:"kokugo",8:"suugaku",9:"rika",10:"syakai",12:"bijutu"};
  for(const [idStr,key] of Object.entries(expected)){
    const id=Number(idStr);
    const up=resolveNonItemEvent(id,row(),rng(0));
    const down=resolveNonItemEvent(id,row(),rng(.99));
    assert.equal(JSON.parse(up.changes.stats_json)[key],23);
    assert.equal(up.effects.stats[key],3);
    assert.equal(JSON.parse(down.changes.stats_json)[key],17);
    assert.equal(down.effects.stats[key],-3);
    assert.equal(JSON.parse(down.changes.stats_json).love,20);
  }
  const limited=resolveNonItemEvent(7,row({stats_json:JSON.stringify({
    ...BASE_STATS,kokugo:2
  })}),rng(.8));
  assert.equal(limited.effects.stats.kokugo,-2);
  assert.equal(JSON.parse(limited.changes.stats_json).kokugo,0);
  const kind=resolveNonItemEvent(14,row());
  assert.equal(kind.effects.stats.love,5);
  assert.equal(JSON.parse(kind.changes.stats_json).love,25);
});

test("原版樂透有十分之一機會中 100 至 1000 萬元，否則扣 3000 元",()=>{
  const win=resolveNonItemEvent(24,row(),rng(0,.999));
  assert.equal(win.changes.money,10100000);
  assert.equal(win.effects.money,10000000);
  const loss=resolveNonItemEvent(24,row(),rng(.9));
  assert.equal(loss.changes.money,97000);
  assert.equal(loss.effects.money,-3000);
  const broke=resolveNonItemEvent(24,row({money:100}),rng(.9));
  assert.equal(broke.changes.money,0);
  assert.equal(broke.effects.money,-100);
});

test("失戀暴食增加 5 公斤，大阪說教減 1 公斤，失戀消瘦減 5 公斤並重新計算 BMI",()=>{
  const binge=resolveNonItemEvent(6,row());
  assert.equal(binge.changes.weight,65);
  assert.equal(binge.effects.weight,5);
  const scold=resolveNonItemEvent(25,row());
  assert.equal(scold.changes.weight,59);
  assert.equal(scold.effects.weight,-1);
  const loss=resolveNonItemEvent(43,row());
  assert.equal(loss.changes.weight,55);
  assert.equal(loss.effects.weight,-5);
  assert.equal(loss.changes.bmi,Math.round((55/(1.65**2))*10)/10);
  const minimum=resolveNonItemEvent(43,row({weight:2}));
  assert.equal(minimum.changes.weight,0.01);
  assert.equal(minimum.effects.weight,-1.99);
});

test("原版非道具事件只抽選一次，能力現金變動與動態說明同一筆交易持久保存",()=>{
  const db=dbSetup();
  try{
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    const first=trigger(db,7,[.9]);
    assert.equal(first.event.key,"literature");
    assert.match(first.event.description,/國語-3/);
    const updated=db.prepare("SELECT money,stats_json,last_event_day FROM characters WHERE user_id=1").get();
    assert.equal(updated.money,100000);
    assert.equal(updated.last_event_day,"2026-11-19");
    assert.equal(JSON.parse(updated.stats_json).kokugo,17);
    const again=settleDailyIllnessEvent(db,1,"2026-11-19",2000,
      ()=>{throw Error("不可重抽");});
    assert.equal(again.checked,false);
    assert.equal(JSON.parse(db.prepare("SELECT stats_json FROM characters WHERE user_id=1").get().stats_json).kokugo,17);
    const next=trigger(db,13,[0],"2026-11-20");
    assert.equal(next.event.key,"luckyDraw");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,110000);
    const history=listCharacterEvents(db,1);
    assert.equal(history.length,2);
    assert.deepEqual(history.map(x=>x.originalId),[13,7]);
    assert.equal(history[0].effects.money,10000);
    assert.equal(history[1].effects.stats.kokugo,-3);
    assert.match(history[1].description,/國語-3/);
    assert.equal(listCharacterEvents(db,2).length,0);
    initCharacterEvents(db);
    assert.equal(listCharacterEvents(db,1).length,2);
  }finally{db.close();}
});

test("安全整數溢位整筆回滾，日期不被標記完成而阻止修正後重試",()=>{
  const db=dbSetup();
  try{
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    db.prepare("UPDATE characters SET money=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
    assert.throws(()=>trigger(db,41,[]),/安全整數範圍/);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    assert.equal(listCharacterEvents(db,1).length,0);
    db.prepare("UPDATE characters SET money=100 WHERE user_id=1").run();
    assert.equal(trigger(db,41,[]).event.key,"vendingChange");
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,1100);
    assert.equal(listCharacterEvents(db,1).length,1);
  }finally{db.close();}
});

test("已存在的舊版疾病事件資料表可非破壞升級動態敘述與效果欄位",()=>{
  const db=dbSetup();
  try{
    db.exec("DROP TABLE character_events;");
    db.exec("CREATE TABLE character_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),day TEXT NOT NULL,event_key TEXT NOT NULL,original_id INTEGER NOT NULL,old_health_index INTEGER NOT NULL,new_health_index INTEGER NOT NULL,created_at INTEGER NOT NULL);");
    db.exec("INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at) VALUES(1,'2026-11-17','caughtCold',4,50,-15,1000)");
    initCharacterEvents(db);
    const before=listCharacterEvents(db,1);
    assert.equal(before.length,1);
    assert.equal(before[0].description,"感冒了。");
    assert.deepEqual(before[0].effects,{});
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    trigger(db,2,[0]);
    assert.equal(listCharacterEvents(db,1).length,2);
  }finally{db.close();}
});


test("第 26 號街頭衝突：五種等機率分支，兩種無傷且按整數向下取整扣能量",()=>{
  for(const [rand,body,brain] of [
    [0,14,20],[.2,20,14],[.4,15,15],[.6,20,20],[.99,20,20]
  ]){
    const event=resolveNonItemEvent(26,row(),rng(rand));
    assert.equal(event.event.key,"streetFight");
    assert.equal(event.changes.body_energy??20,body);
    assert.equal(event.changes.brain_energy??20,brain);
    if(rand>=.6)assert.deepEqual(event.effects,{});
  }
  const low=resolveNonItemEvent(26,row({body_energy:2}),rng(0));
  assert.equal(low.changes.body_energy,2);
  assert.equal(low.effects.bodyEnergy,0);
});

test("第 27 號溫泉事件：原版增加兩種能量 1000，Web 版不突破目前能力上限",()=>{
  const event=resolveNonItemEvent(27,row({body_energy:10,brain_energy:20}));
  assert.equal(event.event.key,"hotspring");
  assert.equal(event.changes.body_energy,25);
  assert.equal(event.changes.brain_energy,35);
  assert.deepEqual(event.effects,{bodyEnergy:15,brainEnergy:15});
  const full=resolveNonItemEvent(27,row({body_energy:25,brain_energy:35}));
  assert.equal(full.effects.bodyEnergy,0);
  assert.equal(full.effects.brainEnergy,0);
  assert.match(full.event.description,/0、0/);
  assert.throws(()=>resolveNonItemEvent(27,row({body_energy:-1})),/能量/);
});

test("第 33 號地方偶遇：藝人 +3 有趣度、鹿損失三分之一、溺水損失一半及五萬元",()=>{
  const performer=resolveNonItemEvent(33,row(),rng(0));
  assert.equal(performer.event.key,"localEncounter");
  assert.equal(performer.effects.stats.unique,3);
  assert.equal(JSON.parse(performer.changes.stats_json).unique,23);
  const deer=resolveNonItemEvent(33,row(),rng(.4));
  assert.equal(deer.effects.bodyEnergy,-6);
  assert.equal(deer.changes.body_energy,14);
  assert.equal(deer.changes.money,undefined);
  const drowning=resolveNonItemEvent(33,row(),rng(.99));
  assert.equal(drowning.effects.bodyEnergy,-10);
  assert.equal(drowning.effects.money,-50000);
  assert.equal(drowning.changes.money,50000);
  const poor=resolveNonItemEvent(33,row({money:150}),rng(.9));
  assert.equal(poor.changes.money,0);
  assert.equal(poor.effects.money,-150);
});

test("第 39 號工作專注：身體與頭腦能量皆至少 500 時經驗 +10，否則 -5",()=>{
  const boost=resolveNonItemEvent(39,row({body_energy:500,brain_energy:500,job_experience:12}));
  assert.equal(boost.changes.job_experience,22);
  assert.equal(boost.effects.jobExperience,10);
  const exhausted=resolveNonItemEvent(39,row({body_energy:500,brain_energy:499,job_experience:12}));
  assert.equal(exhausted.changes.job_experience,7);
  assert.equal(exhausted.effects.jobExperience,-5);
  const min=resolveNonItemEvent(39,row({body_energy:0,brain_energy:0,job_experience:2}));
  assert.equal(min.changes.job_experience,0);
  assert.equal(min.effects.jobExperience,-2);
  assert.throws(()=>resolveNonItemEvent(39,row({
    body_energy:500,brain_energy:500,job_experience:Number.MAX_SAFE_INTEGER
  })),/安全範圍/);
});

test("新能量事件與職業經驗變化以同一交易寫入，更新恢復時間與事件紀錄，無法同日重抽",()=>{
  const db=dbSetup();
  try {
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    const first=trigger(db,26,[0],"2026-11-19");
    assert.equal(first.event.key,"streetFight");
    let current=db.prepare("SELECT body_energy,brain_energy,job_experience,recovered_at FROM characters WHERE user_id=1").get();
    assert.deepEqual({...current},{body_energy:14,brain_energy:20,job_experience:60,recovered_at:100000});
    assert.equal(settleDailyIllnessEvent(db,1,"2026-11-19",100001,()=>{throw Error("不可重抽");}).checked,false);
    assert.equal(trigger(db,27,[],"2026-11-20").event.key,"hotspring");
    current=db.prepare("SELECT body_energy,brain_energy,recovered_at FROM characters WHERE user_id=1").get();
    assert.deepEqual({...current},{body_energy:25,brain_energy:35,recovered_at:100000});
    assert.equal(trigger(db,39,[],"2026-11-21").event.key,"workFocus");
    assert.equal(db.prepare("SELECT job_experience FROM characters WHERE user_id=1").get().job_experience,55);
    assert.equal(trigger(db,33,[.99],"2026-11-22").event.key,"localEncounter");
    current=db.prepare("SELECT body_energy,money FROM characters WHERE user_id=1").get();
    assert.deepEqual({...current},{body_energy:13,money:50000});
    const events=listCharacterEvents(db,1);
    assert.deepEqual(events.map(e=>e.originalId),[33,39,27,26]);
    assert.equal(events[0].effects.money,-50000);
    assert.equal(events[1].effects.jobExperience,-5);
    assert.deepEqual(events[2].effects,{bodyEnergy:11,brainEnergy:15});
    assert.equal(events[3].effects.bodyEnergy,-6);
    assert.equal(listCharacterEvents(db,2).length,0);
  }finally{db.close();}
});
