import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ORIGINAL_EVENT_COUNT,ORIGINAL_EVENT_CHANCE,ILLNESS_EVENTS,
  rollOriginalIllnessEvent,initCharacterEvents,settleDailyIllnessEvent,
  listCharacterEvents
} from "../src/events.mjs";

function createDb() {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),health_index INTEGER NOT NULL DEFAULT 50,last_event_day TEXT NOT NULL DEFAULT '',money INTEGER NOT NULL DEFAULT 100000,weight REAL NOT NULL DEFAULT 60,height INTEGER NOT NULL DEFAULT 165,bmi REAL NOT NULL DEFAULT 22,body_energy INTEGER NOT NULL DEFAULT 20,brain_energy INTEGER NOT NULL DEFAULT 20,job_experience INTEGER NOT NULL DEFAULT 0,recovered_at INTEGER NOT NULL DEFAULT 1000,stats_json TEXT NOT NULL DEFAULT '{}');",
    "INSERT INTO users(id,username) VALUES(1,'owner'),(2,'other');",
    "INSERT INTO characters(user_id,health_index) VALUES(1,50),(2,-25);"
  ].join("\n"));
  initCharacterEvents(db);
  return db;
}
function numbers(...values) {
  let index=0;
  return ()=>{if(index>=values.length)throw new Error("亂數呼叫次數不正確");return values[index++];};
}

test("原版事件有三分之一機會抽取 1 到 44，只有編號 4 與 15 影響疾病",()=>{
  assert.equal(ORIGINAL_EVENT_CHANCE,3);
  assert.equal(ORIGINAL_EVENT_COUNT,44);
  assert.equal(ILLNESS_EVENTS[4].healthIndex,-15);
  assert.equal(ILLNESS_EVENTS[15].healthIndex,-8);
  assert.equal(rollOriginalIllnessEvent(numbers(0.8)).drawn,false);
  assert.equal(rollOriginalIllnessEvent(numbers(0.5)).event,null);
  assert.equal(rollOriginalIllnessEvent(numbers(0,0.069)).originalId,4);
  const first=rollOriginalIllnessEvent(numbers(0,0.069));
  assert.equal(first.event.key,"caughtCold");
  assert.equal(first.event.healthIndex,-15);
  const second=rollOriginalIllnessEvent(numbers(0,0.32));
  assert.equal(second.originalId,15);
  assert.equal(second.event.key,"sleptUncovered");
  assert.equal(second.event.healthIndex,-8);
  assert.equal(rollOriginalIllnessEvent(numbers(0,0.999)).originalId,44);
  assert.equal(rollOriginalIllnessEvent(numbers(0,0.999)).event,null);
  assert.throws(()=>rollOriginalIllnessEvent(numbers(1)),/亂數/);
  assert.throws(()=>rollOriginalIllnessEvent(numbers(-0.01)),/亂數/);
  assert.throws(()=>rollOriginalIllnessEvent(numbers(NaN)),/亂數/);
});

test("舊角色首次接入只設定當日抽選基準，不追溯或憑空引發疾病事件",()=>{
  const db=createDb();
  try {
    const initialized=settleDailyIllnessEvent(db,1,"2026-11-18",1000,
      ()=>{throw new Error("初始化不應抽取亂數");});
    assert.deepEqual(initialized,{checked:false,initial:true,event:null});
    assert.equal(db.prepare("SELECT health_index,last_event_day FROM characters WHERE user_id=1")
      .get().health_index,50);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1")
      .get().last_event_day,"2026-11-18");
    assert.equal(listCharacterEvents(db,1).length,0);
    const repeated=settleDailyIllnessEvent(db,1,"2026-11-18",2000,
      ()=>{throw new Error("當天不可重抽");});
    assert.equal(repeated.checked,false);
    assert.equal(repeated.initial,false);
  }finally{db.close();}
});

test("事件 4 設成 -15，事件 15 設成 -8，覆蓋當下疾病指數並寫入持久紀錄",()=>{
  const db=createDb();
  try{
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    const cold=settleDailyIllnessEvent(db,1,"2026-11-19",2000,numbers(0,0.069));
    assert.equal(cold.checked,true);
    assert.equal(cold.event.key,"caughtCold");
    assert.equal(db.prepare("SELECT health_index FROM characters WHERE user_id=1").get().health_index,-15);
    assert.equal(settleDailyIllnessEvent(db,1,"2026-11-19",2200,
      ()=>{throw new Error("重複抽取");}).checked,false);
    const uncovered=settleDailyIllnessEvent(db,1,"2026-11-20",3000,numbers(0,0.32));
    assert.equal(uncovered.event.key,"sleptUncovered");
    assert.equal(db.prepare("SELECT health_index FROM characters WHERE user_id=1").get().health_index,-8);
    const history=listCharacterEvents(db,1);
    assert.equal(history.length,2);
    assert.deepEqual(history.map(x=>x.originalId),[15,4]);
    assert.deepEqual(history.map(x=>[x.oldHealthIndex,x.newHealthIndex]),[[-15,-8],[50,-15]]);
    assert.deepEqual(history.map(x=>x.day),["2026-11-20","2026-11-19"]);
    assert.equal(history[0].occurredAt,3000);
    initCharacterEvents(db);
    assert.equal(listCharacterEvents(db,1).length,2);
    assert.equal(listCharacterEvents(db,2).length,0);
    assert.equal(db.prepare("SELECT health_index FROM characters WHERE user_id=2").get().health_index,-25);
  }finally{db.close();}
});

test("抽到未移植的其他事件時不變更疾病，不創造無來源的事件紀錄",()=>{
  const db=createDb();
  try{
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    const first=settleDailyIllnessEvent(db,1,"2026-11-19",2000,numbers(0,0.9));
    assert.equal(first.checked,true);
    assert.equal(first.event,null);
    const noEvent=settleDailyIllnessEvent(db,1,"2026-11-20",3000,numbers(0.8));
    assert.equal(noEvent.checked,true);
    assert.equal(noEvent.event,null);
    assert.equal(db.prepare("SELECT health_index,last_event_day FROM characters WHERE user_id=1").get().health_index,50);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-20");
    assert.equal(listCharacterEvents(db,1).length,0);
  }finally{db.close();}
});

test("錯誤亂數與交易失敗時整筆回滾，當天之後仍能重新抽取",()=>{
  const db=createDb();
  try{
    settleDailyIllnessEvent(db,1,"2026-11-18",1000);
    assert.throws(()=>settleDailyIllnessEvent(db,1,"2026-11-19",2000,numbers(0,1)),/亂數/);
    assert.equal(db.prepare("SELECT last_event_day FROM characters WHERE user_id=1").get().last_event_day,"2026-11-18");
    assert.equal(listCharacterEvents(db,1).length,0);
    const later=settleDailyIllnessEvent(db,1,"2026-11-19",3000,numbers(0,0.069));
    assert.equal(later.event.healthIndex,-15);
    assert.equal(settleDailyIllnessEvent(db,1,"2026-11-17",4000).checked,false);
    assert.equal(listCharacterEvents(db,1).length,1);
    assert.throws(()=>settleDailyIllnessEvent(db,1,"18/11/2026",1000),/日期/);
    assert.throws(()=>settleDailyIllnessEvent(db,999,"2026-11-20",1000),/建立角色/);
  }finally{db.close();}
});
