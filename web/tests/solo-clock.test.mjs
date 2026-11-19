import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SOLO_TIME_STEPS,MAX_SOLO_OFFSET_MS,initSoloClock,
  soloOffset,gameTimestamp,advanceSoloClock
} from "../src/solo-clock.mjs";

function memoryDatabase() {
  const db=new DatabaseSync(":memory:");
  initSoloClock(db);
  return db;
}
test("單機時鐘：工作 5 分鐘、恢復 30 分鐘、用餐 60 分鐘、日限制 24 小時",()=>{
  const db=memoryDatabase();
  try {
    assert.deepEqual(SOLO_TIME_STEPS,{
      "5m":300000,"30m":1800000,"1h":3600000,"1d":86400000
    });
    const now=1780000000000;
    assert.equal(gameTimestamp(db,now),now);
    const r1=advanceSoloClock(db,"5m",now);
    assert.equal(r1.advancedMs,300000);
    assert.equal(gameTimestamp(db,now),now+300000);
    advanceSoloClock(db,"30m",now);
    advanceSoloClock(db,"1h",now);
    const r4=advanceSoloClock(db,"1d",now);
    assert.equal(r4.gameTimeMs,now+92100000);
    assert.equal(r4.offsetMs,92100000);
    assert.equal(soloOffset(db),92100000);
    initSoloClock(db);
    assert.equal(soloOffset(db),92100000,"重複啟動不會把快轉歸零");
  }finally{db.close();}
});
test("單機時鐘：只接受預設值，錯誤輸入不修改持久化時間",()=>{
  const db=memoryDatabase();
  try {
    for(const bad of [null,undefined,5,0,{},"0","5","5min","-1m","999h","5m; DROP TABLE",""]){
      assert.throws(()=>advanceSoloClock(db,bad,1780000000000),/不支援的單機快轉時間/);
      assert.equal(soloOffset(db),0);
    }
    assert.throws(()=>advanceSoloClock(db,"5m",-1),/現實時間/);
    assert.equal(soloOffset(db),0);
  }finally{db.close();}
});
test("單機時鐘：超過十年安全上限會回滾；既有偏移可從資料庫重讀",()=>{
  const db=memoryDatabase();
  try{
    db.prepare("UPDATE solo_clock SET offset_ms=? WHERE id=1").run(MAX_SOLO_OFFSET_MS-1000);
    assert.throws(()=>advanceSoloClock(db,"5m",1780000000000),/快轉上限/);
    assert.equal(soloOffset(db),MAX_SOLO_OFFSET_MS-1000);
    db.close();
  }catch(e){db.close();throw e;}
});
