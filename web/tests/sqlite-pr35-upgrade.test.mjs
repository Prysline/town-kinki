import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { backUpSolo, restoreSolo, verifySoloDatabase } from "../scripts/solo-save.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";
import { decodeLegacyText } from "../src/engine.mjs";
import { emptyTownMap } from "../src/town-map.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const stats=()=>Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","love","unique","etti"].map(x=>[x,20]));
function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dir){
  const port=await new Promise((ok,fail)=>{
    const socket=createServer();
    socket.once("error",fail);
    socket.listen(0,"127.0.0.1",()=>{const port=socket.address().port;socket.close(()=>ok(port));});
  });
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",PORT:String(port),DATA_DIR:dir}
  });
  let log="";
  child.stdout.on("data",x=>log+=x);
  child.stderr.on("data",x=>log+=x);
  const url="http://127.0.0.1:"+port;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    try{
      const response=await fetch(url+"/api/state",{signal:AbortSignal.timeout(350)});
      if(response.ok){
        return {url,async stop(){
          if(child.exitCode!==null)return;
          const ended=new Promise(ok=>child.once("exit",ok));
          child.kill();await Promise.race([ended,delay(1500)]);
        }};
      }
    }catch{}
    await delay(100);
  }
  child.kill();throw new Error("升級後 Web 伺服器未啟動："+log);
}
async function api(url,route,body){
  const res=await fetch(url+"/api/"+route,{
    method:body===undefined?"GET":"POST",
    headers:body===undefined?{}:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:res.status,result:await res.json()};
}
// 重建 PR #35 (934c29f6) 已存在的角色／銀行／地圖住宅／百貨／道具 schema 子集。
// 不引入原版 CGI 玩家檔；所有資料都在作業系統暫存目錄建立。
function seedPR35(dir){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  const now=Date.now();
  try{
    db.exec([
      "PRAGMA journal_mode=WAL;",
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL COLLATE NOCASE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);",
      "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL UNIQUE,gender TEXT NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,recovered_at INTEGER NOT NULL,job_id TEXT,work_progress INTEGER NOT NULL,last_work_at INTEGER NOT NULL,work_count INTEGER NOT NULL,height INTEGER NOT NULL,bmi REAL NOT NULL,stats_json TEXT NOT NULL);",
      "CREATE TABLE solo_clock(id INTEGER PRIMARY KEY CHECK(id=1),offset_ms INTEGER NOT NULL CHECK(offset_ms>=0));",
      "CREATE TABLE bank_accounts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,term_balance INTEGER NOT NULL DEFAULT 0 CHECK(term_balance>=0),last_interest_day TEXT NOT NULL);",
      "CREATE TABLE bank_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,account_type TEXT NOT NULL CHECK(account_type IN ('ordinary','term')),action TEXT NOT NULL,debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0),credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0),balance INTEGER NOT NULL CHECK(balance>=0),created_at INTEGER NOT NULL);",
      "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,original_name TEXT NOT NULL DEFAULT '',original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL);",
      "CREATE TABLE houses(id INTEGER PRIMARY KEY,owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,town_id INTEGER NOT NULL,row_num INTEGER NOT NULL CHECK(row_num BETWEEN 0 AND 11),column_num INTEGER NOT NULL CHECK(column_num BETWEEN 0 AND 15),name TEXT NOT NULL,image TEXT NOT NULL,interior_rank INTEGER NOT NULL CHECK(interior_rank BETWEEN 0 AND 3),purchase_price INTEGER NOT NULL,original_plot TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(town_id,row_num,column_num));",
      "CREATE TABLE legacy_inventory_items(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,original_id TEXT NOT NULL,source_line INTEGER NOT NULL,category TEXT NOT NULL,original_name TEXT NOT NULL,effect TEXT NOT NULL,durability INTEGER NOT NULL,durability_unit TEXT NOT NULL,purchased_at INTEGER,last_used_at INTEGER,raw_fields_json TEXT NOT NULL,UNIQUE(user_id,source_line));",
      "CREATE TABLE retail_purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,shop TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,paid INTEGER NOT NULL,source_line INTEGER,request_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,request_id));"
    ].join("\n"));
    for(const [name,definition] of [
      ["weight","REAL NOT NULL DEFAULT 60"],["job_experience","INTEGER NOT NULL DEFAULT 0"],
      ["job_work_count","INTEGER NOT NULL DEFAULT 0"],["mastered_job","TEXT"],
      ["last_school_day","TEXT NOT NULL DEFAULT ''"],["last_gym_at","INTEGER NOT NULL DEFAULT 0"],
      ["classroom_ready_at","INTEGER NOT NULL DEFAULT 0"],["salary_payment","TEXT NOT NULL DEFAULT 'cash'"],
      ["gym_ready_at","INTEGER NOT NULL DEFAULT 0"],["created_at","INTEGER NOT NULL DEFAULT 0"],
      ["last_meal_at","INTEGER NOT NULL DEFAULT 0"],["health_index","INTEGER NOT NULL DEFAULT 50"],
      ["last_health_day","TEXT NOT NULL DEFAULT ''"],["last_event_day","TEXT NOT NULL DEFAULT ''"],
      ["kpoint","INTEGER NOT NULL DEFAULT 0"]
    ])db.exec("ALTER TABLE characters ADD COLUMN "+name+" "+definition);
    insert(db,"users",{id:1,username:"__local_player__",password_salt:"old-salt",password_hash:"old-hash",created_at:now});
    insert(db,"characters",{user_id:1,name:"PR35舊版居民",gender:"other",town_id:0,
      money:80000,bank:12000,body_energy:90,brain_energy:90,recovered_at:now,
      job_id:"legacy-2",work_progress:2,last_work_at:now+5400000,work_count:3,height:165,
      bmi:22,stats_json:JSON.stringify(stats()),weight:61.5,job_experience:29,
      job_work_count:3,salary_payment:"bank",created_at:now,last_meal_at:now+5400000,
      last_health_day:"9999-12-31",last_event_day:"9999-12-31",kpoint:7});
    insert(db,"solo_clock",{id:1,offset_ms:5400000});
    insert(db,"bank_accounts",{user_id:1,term_balance:1000000,last_interest_day:"9999-12-31"});
    insert(db,"bank_ledger",{user_id:1,account_type:"ordinary",action:"存款",debit:0,credit:12000,balance:12000,created_at:now});
    const tiles=emptyTownMap();tiles[0]="webhouse_7=空地";tiles[1]="デパ";
    insert(db,"town_maps",{town_id:0,original_name:"PR35試玩城",original_record:"",
      source:"web-edited",tiles_json:JSON.stringify(tiles),updated_at:now});
    insert(db,"houses",{id:7,owner_user_id:1,town_id:0,row_num:0,column_num:0,
      name:"PR35舊版居民的家",image:"house/kamakura.gif",interior_rank:3,
      purchase_price:6500000,original_plot:"空地",created_at:now});
    const catalog=parseLegacyRetailCatalog(
      decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
    );
    const book=catalog.find(x=>x.category==="書籍"&&x.name==="無駄知識を覚える本");
    assert.ok(book,"必須用真實原版33欄商品");
    const purchasedAt=Math.floor(now/1000);
    const fields=[...book.rawFields];
    fields[21]=String(book.durability);
    fields[30]=String(purchasedAt);
    fields[31]=String(Math.trunc(book.unitPrice/book.durability));
    insert(db,"legacy_inventory_items",{user_id:1,original_id:"__web_retail__",
      source_line:1000001,category:book.category,original_name:book.name,
      effect:book.effect,durability:book.durability,durability_unit:book.durabilityUnit,
      purchased_at:purchasedAt,last_used_at:0,raw_fields_json:JSON.stringify(fields)});
    insert(db,"retail_purchases",{user_id:1,shop:"depart1",sku:book.sku,name:book.name,
      paid:book.unitPrice,source_line:1000001,request_id:"pr35_purchase_once",created_at:now});
    return {name:book.name,price:book.unitPrice,now,purchasedAt};
  }finally{db.close();}
}
test("PR #35 Web SQLite：備份→跨版本升級→銀行交易→重啟，舊角色及收據／住宅／背包不毀損",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-pr35-upgrade-"));
  const oldDir=join(work,"old");
  const newDir=join(work,"new");
  const snapshot=join(work,"snapshot.sqlite");
  let server=null;
  try{
    const seed=seedPR35(oldDir);
    const backup=await backUpSolo({dataDir:oldDir,file:snapshot});
    assert.equal(backup.characters,1);
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
    restoreSolo({dataDir:newDir,file:snapshot});
    server=await serve(newDir);
    const response=await api(server.url,"state");
    assert.equal(response.status,200);
    const state=response.result;
    assert.equal(state.character.name,"PR35舊版居民");
    assert.equal(state.character.money,80000);
    assert.equal(state.character.bank,12000);
    assert.equal(state.character.salaryPayment,"bank");
    assert.equal(state.character.jobWorkCount,3);
    assert.equal(state.bankAccount.termBalance,1000000);
    assert.equal(state.bankLedger[0].balance,12000);
    assert.equal(state.houses[0].name,"PR35舊版居民的家");
    assert.equal(state.map.cells[0].category,"house");
    assert.equal(state.map.cells[0].image,"house/kamakura.gif");
    assert.equal(state.map.cells[1].key,"デパ");
    assert.ok(state.workCooldownMs>0);
    assert.ok(state.mealCooldownMs>0);
    assert.ok(state.retailPurchases.some(x=>x.name===seed.name));
    assert.ok(state.legacyItemActions.some(x=>x.sourceLine===1000001));
    const db=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      const cols=new Set(db.prepare("PRAGMA table_info(retail_purchases)").all().map(x=>x.name));
      for(const column of ["quantity","payment","card_source_line","merged"])
        assert.ok(cols.has(column),"PR35 舊收據必須無損升級："+column);
      const purchase=db.prepare("SELECT * FROM retail_purchases WHERE request_id='pr35_purchase_once'").get();
      assert.equal(purchase.quantity,1);
      assert.equal(purchase.payment,"cash");
      assert.equal(purchase.card_source_line,null);
      assert.equal(purchase.merged,0);
      assert.equal(purchase.paid,seed.price);
      const item=db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=1 AND source_line=1000001").get();
      assert.equal(item.original_name,seed.name);
      assert.equal(item.purchased_at,seed.purchasedAt);
      assert.equal(JSON.parse(item.raw_fields_json).length,33);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    }finally{db.close();}
    const deposited=await api(server.url,"bank",{action:"deposit",amount:500});
    assert.equal(deposited.status,200);
    assert.equal(deposited.result.character.money,79500);
    assert.equal(deposited.result.character.bank,12500);
    await server.stop();server=null;
    server=await serve(newDir);
    const resumed=(await api(server.url,"state")).result;
    assert.equal(resumed.character.money,79500);
    assert.equal(resumed.character.bank,12500);
    assert.equal(resumed.bankAccount.termBalance,1000000);
    assert.equal(resumed.houses[0].name,"PR35舊版居民的家");
    assert.equal(resumed.retailPurchases.length,1);
    assert.ok(resumed.legacyItemActions.some(x=>x.sourceLine===1000001));
    const original=new DatabaseSync(join(oldDir,"solo.sqlite"),{readOnly:true});
    try{
      assert.equal(original.prepare("SELECT money FROM characters WHERE id=1").get().money,80000);
      const cols=new Set(original.prepare("PRAGMA table_info(retail_purchases)").all().map(x=>x.name));
      assert.equal(cols.has("quantity"),false,"原始舊 Web 資料庫不得被升級過程覆寫");
    }finally{original.close();}
  }finally{
    await server?.stop();
    rmSync(work,{recursive:true,force:true});
  }
});
