import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MAP_SYMBOLS } from "../src/town-map.mjs";
import { initTownMapTable, readTownMap, storeTownMap } from "../src/town-storage.mjs";
import { createSoloStarterTown, SOLO_STARTER_LAYOUT } from "../src/solo-starter-town.mjs";

function setup(){
  const db=new DatabaseSync(":memory:");
  initTownMapTable(db);
  // 只需原始住宅表實際被守衛查詢的 town_id，不建立虛構玩家歷史。
  db.exec("CREATE TABLE houses(id INTEGER PRIMARY KEY,town_id INTEGER NOT NULL);");
  return db;
}

test("第50階段單機試玩街區只使用原版已知建築，明確標記 Web 來源而非假原版配置",()=>{
  const db=setup();
  try{
    assert.equal(SOLO_STARTER_LAYOUT.length,17);
    const known=new Set(MAP_SYMBOLS.map(x=>x.key));
    assert.ok(SOLO_STARTER_LAYOUT.every(x=>known.has(x.symbol)));
    assert.equal(readTownMap(db,0).configured,false);
    const initialized=createSoloStarterTown(db,0);
    assert.deepEqual(initialized,{townId:0,placed:17,source:"web-solo-starter"});
    const town=readTownMap(db,0);
    assert.equal(town.configured,true);
    assert.equal(town.source,"web-solo-starter");
    assert.equal(town.tiles.length,192);
    for(const {row,column,symbol} of SOLO_STARTER_LAYOUT)
      assert.equal(town.tiles[row*16+column],symbol);
    assert.equal(town.tiles.filter(Boolean).length,17);
    assert.equal(town.tiles[4],"");
    assert.equal(town.fields,null,"不得捏造原版 259/266 欄街區資料");
    assert.equal(readTownMap(db,1).configured,false,
      "只建立玩家所在的城鎮，不更動其他三座城鎮");
  }finally{db.close();}
});

test("試玩初始化只允許全新空白城鎮：不可覆蓋已用過的編輯配置、原版匯入或已有住宅",()=>{
  const db=setup();
  try{
    createSoloStarterTown(db,0);
    const original=readTownMap(db,0).tiles;
    assert.throws(()=>createSoloStarterTown(db,0),/已有街區配置/);
    assert.deepEqual(readTownMap(db,0).tiles,original);
    const blank=Array(192).fill("");
    storeTownMap(db,1,{tiles:blank},"web-edited");
    assert.throws(()=>createSoloStarterTown(db,1),/已有街區配置/);
    assert.deepEqual(readTownMap(db,1).tiles,blank);
    const imported=[...blank];
    imported[0]="銀行";
    storeTownMap(db,2,{tiles:imported},"legacy-import");
    assert.throws(()=>createSoloStarterTown(db,2),/已有街區配置/);
    db.prepare("INSERT INTO houses(id,town_id) VALUES(?,?)").run(5,3);
    assert.throws(()=>createSoloStarterTown(db,3),/已有住宅/);
    assert.equal(readTownMap(db,3).configured,false);
    assert.throws(()=>createSoloStarterTown(db,4),/不存在的城鎮/);
  }finally{db.close();}
});

test("初始化資料庫寫入失敗時必須完整回滾，修復後可以再建立",()=>{
  const db=setup();
  try{
    db.exec([
      "CREATE TRIGGER stop_starter BEFORE INSERT ON town_maps BEGIN",
      "SELECT RAISE(ABORT,'starter write rejected'); END;"
    ].join(" "));
    assert.throws(()=>createSoloStarterTown(db,0),/starter write rejected/);
    assert.equal(readTownMap(db,0).configured,false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM town_maps").get().n,0);
    db.exec("DROP TRIGGER stop_starter");
    assert.equal(createSoloStarterTown(db,0).placed,17);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM town_maps").get().n,1);
  }finally{db.close();}
});
