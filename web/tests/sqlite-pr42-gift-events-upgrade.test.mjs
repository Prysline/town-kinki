import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {backUpSolo,restoreSolo,verifySoloDatabase} from "../scripts/solo-save.mjs";
import {parseLegacyRetailCatalog} from "../src/retail.mjs";
import {decodeLegacyText} from "../src/engine.mjs";
import {emptyTownMap} from "../src/town-map.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const stats=()=>Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo",
  "ongaku","bijutu","looks","tairyoku","kenkou","speed","power",
  "wanryoku","kyakuryoku","love","unique","etti"].map(k=>[k,20]));
function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+
    keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dir){
  const port=await new Promise((ok,fail)=>{
    const socket=createServer();
    socket.once("error",fail);
    socket.listen(0,"127.0.0.1",()=>{
      const port=socket.address().port;
      socket.close(()=>ok(port));
    });
  });
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",
      PORT:String(port),DATA_DIR:dir}
  });
  let logs="";
  child.stdout.on("data",chunk=>logs+=chunk);
  child.stderr.on("data",chunk=>logs+=chunk);
  const url="http://127.0.0.1:"+port;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    try{
      const response=await fetch(url+"/api/state",{signal:AbortSignal.timeout(350)});
      if(response.ok){
        return {url,async stop(){
          if(child.exitCode!==null)return;
          const exited=new Promise(ok=>child.once("exit",ok));
          child.kill();
          await Promise.race([exited,delay(1500)]);
        }};
      }
    }catch{}
    await delay(100);
  }
  child.kill();
  throw new Error("PR #42 舊 Web 禮品存檔升級後啟動失敗："+logs);
}
async function api(url,route,body){
  const response=await fetch(url+"/api/"+route,{
    method:body===undefined?"GET":"POST",
    headers:body===undefined?{}:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:response.status,result:await response.json()};
}

// PR #42 第37階段合併 SHA db585bc8b7d4044b8c590ca4fda33b424b126793：
// gift_events 當時沒有 message 欄位，也沒有 gift_mail_messages。
// 本測試在 OS 暫存資料夾重建這個真實 Web 交易表及代表性 Web 玩家／道具 schema，
// 絕不匯入舊 CGI 玩家、個人信箱或帳號。
function seedPR42(dir){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"solo.sqlite"));
  const now=Date.now(),seconds=Math.floor(now/1000);
  try{
    db.exec([
      "PRAGMA journal_mode=WAL;",
      "PRAGMA foreign_keys=ON;",
      "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL COLLATE NOCASE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);",
      "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL UNIQUE,gender TEXT NOT NULL,town_id INTEGER NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,recovered_at INTEGER NOT NULL,job_id TEXT,work_progress INTEGER NOT NULL,last_work_at INTEGER NOT NULL,work_count INTEGER NOT NULL,height INTEGER NOT NULL,bmi REAL NOT NULL,stats_json TEXT NOT NULL);",
      "CREATE TABLE solo_clock(id INTEGER PRIMARY KEY CHECK(id=1),offset_ms INTEGER NOT NULL CHECK(offset_ms>=0));",
      "CREATE TABLE bank_accounts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,term_balance INTEGER NOT NULL DEFAULT 0 CHECK(term_balance>=0),last_interest_day TEXT NOT NULL);",
      "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,original_name TEXT NOT NULL DEFAULT '',original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL);",
      "CREATE TABLE legacy_inventory_items(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,original_id TEXT NOT NULL,source_line INTEGER NOT NULL,category TEXT NOT NULL,original_name TEXT NOT NULL,effect TEXT NOT NULL,durability INTEGER NOT NULL,durability_unit TEXT NOT NULL,purchased_at INTEGER,last_used_at INTEGER,raw_fields_json TEXT NOT NULL,UNIQUE(user_id,source_line));",
      "CREATE TABLE gift_events(",
      "id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
      "request_id TEXT NOT NULL,action TEXT NOT NULL,source_line INTEGER NOT NULL,",
      "quantity INTEGER NOT NULL,recipient_user_id INTEGER,",
      "result_source_line INTEGER NOT NULL,fee INTEGER NOT NULL,",
      "name TEXT NOT NULL,created_at INTEGER NOT NULL,",
      "UNIQUE(user_id,request_id));",
      "CREATE INDEX gift_events_user_idx ON gift_events(user_id,id);"
    ].join(" "));
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
    insert(db,"users",{id:1,username:"__local_player__",password_salt:"old-salt",
      password_hash:"old-hash",created_at:now});
    insert(db,"characters",{id:1,user_id:1,name:"第37階段禮品玩家",
      gender:"other",town_id:0,money:150000,bank:12000,
      body_energy:90,brain_energy:90,recovered_at:now,
      job_id:null,work_progress:0,last_work_at:0,work_count:0,
      height:165,bmi:22,stats_json:JSON.stringify(stats()),
      created_at:now,last_health_day:"9999-12-31",last_event_day:"9999-12-31"});
    insert(db,"solo_clock",{id:1,offset_ms:0});
    insert(db,"bank_accounts",{user_id:1,term_balance:20000,
      last_interest_day:"9999-12-31"});
    const tiles=emptyTownMap();tiles[0]="ギフト屋";
    insert(db,"town_maps",{town_id:0,original_name:"第37階段試玩城",
      original_record:"",source:"web-edited",tiles_json:JSON.stringify(tiles),
      updated_at:now});
    const catalog=parseLegacyRetailCatalog(decodeLegacyText(
      readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))));
    const item=catalog.find(row=>row.name==="油取り紙"&&row.durabilityUnit==="回");
    assert.ok(item,"必須使用真實原版 33 欄禮品來源");
    for(const [sourceLine,isGift] of [[1000001,true],[1000002,false]]){
      const raw=[...item.rawFields];
      raw[0]=isGift?"ギフト":item.category;
      raw[9]=isGift?item.effect.replace(/,ギフト/g,"").replace(/ギフト/g,"")
        .replace(/無,/g,"")||"無":item.effect;
      raw[21]=String(item.durability);
      raw[22]="回";raw[30]=String(seconds);
      insert(db,"legacy_inventory_items",{
        user_id:1,original_id:"__web_retail__",source_line:sourceLine,
        category:raw[0],original_name:item.name,effect:raw[9],
        durability:item.durability,durability_unit:"回",purchased_at:seconds,
        last_used_at:0,raw_fields_json:JSON.stringify(raw)
      });
    }
    insert(db,"gift_events",{id:31,user_id:1,
      request_id:"phase37_old_convert",action:"convert",source_line:1000001,
      quantity:0,recipient_user_id:null,result_source_line:1000001,
      fee:50000,name:item.name,created_at:now});
    assert.equal(db.prepare("PRAGMA table_info(gift_events)").all()
      .some(row=>row.name==="message"),false);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='gift_mail_messages'").get(),undefined);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    return {name:item.name,seconds,now,rawFirst:item.rawFields.length};
  }finally{db.close();}
}

test("DB-04：PR #42 無 message 的舊禮品帳簿經 WAL 備份升級，重送不重扣 50,000 元",async()=>{
  const work=mkdtempSync(join(tmpdir(),"town-pr42-gift-upgrade-"));
  const oldDir=join(work,"old"),newDir=join(work,"new");
  const backupFile=join(work,"snapshot.sqlite");
  let server=null;
  try{
    const seed=seedPR42(oldDir);
    const snapshot=await backUpSolo({dataDir:oldDir,file:backupFile});
    assert.equal(snapshot.characters,1);
    assert.equal(verifySoloDatabase(backupFile).sha256,snapshot.sha256);
    restoreSolo({dataDir:newDir,file:backupFile});
    server=await serve(newDir);
    const response=await api(server.url,"state");
    assert.equal(response.status,200);
    const state=response.result;
    assert.equal(state.character.name,"第37階段禮品玩家");
    assert.equal(state.character.money,150000);
    assert.equal(state.character.bank,12000);
    assert.equal(state.bankAccount.termBalance,20000);
    assert.equal(state.giftEvents.length,1);
    assert.equal(state.giftEvents[0].fee,50000);
    assert.equal(state.giftSources.length,2);
    assert.equal(state.giftSources.find(x=>x.sourceLine===1000001).category,"ギフト");
    assert.equal(state.giftSources.find(x=>x.sourceLine===1000002).canConvert,true);

    const db=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      const columns=new Set(db.prepare("PRAGMA table_info(gift_events)").all()
        .map(row=>row.name));
      assert.ok(columns.has("message"),"現行啟動應補上第46階段訊息欄位");
      const old=db.prepare("SELECT * FROM gift_events WHERE id=31").get();
      assert.equal(old.message,"","既有事件不得冒充新訊息");
      assert.equal(old.request_id,"phase37_old_convert");
      assert.equal(old.fee,50000);
      assert.equal(old.result_source_line,1000001);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM gift_mail_messages").get().n,0,
        "第37階段舊轉換事件不得憑空生成寄禮信件");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    }finally{db.close();}

    const oldPayload={sourceLine:1000001,quantity:0,requestId:"phase37_old_convert"};
    const replay=await api(server.url,"gift/convert",oldPayload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.giftResult.replayed,true);
    assert.equal(replay.result.character.money,150000);
    assert.equal(replay.result.giftEvents.length,1);
    const altered=await api(server.url,"gift/convert",{
      sourceLine:1000002,quantity:0,requestId:"phase37_old_convert"
    });
    assert.equal(altered.status,400,"舊版 requestId 不可換另一件商品再次轉換");
    assert.equal((await api(server.url,"state")).result.character.money,150000);

    const freshPayload={sourceLine:1000002,quantity:0,requestId:"phase37_new_convert"};
    const converted=await api(server.url,"gift/convert",freshPayload);
    assert.equal(converted.status,200);
    assert.equal(converted.result.giftResult.replayed,false);
    assert.equal(converted.result.giftResult.fee,50000);
    assert.equal(converted.result.character.money,100000);
    assert.equal(converted.result.giftEvents.length,2);
    assert.equal(converted.result.giftSources.find(x=>x.sourceLine===1000002).category,"ギフト");
    const again=await api(server.url,"gift/convert",freshPayload);
    assert.equal(again.status,200);
    assert.equal(again.result.giftResult.replayed,true);
    assert.equal(again.result.character.money,100000);

    await server.stop();server=null;
    server=await serve(newDir);
    const resumed=(await api(server.url,"state")).result;
    assert.equal(resumed.character.money,100000);
    assert.equal(resumed.character.bank,12000);
    assert.equal(resumed.bankAccount.termBalance,20000);
    assert.equal(resumed.giftEvents.length,2);
    assert.equal(resumed.giftSources.filter(x=>x.category==="ギフト").length,2);
    assert.equal((await api(server.url,"gift/convert",oldPayload)).result.giftResult.replayed,true);
    const migrated=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      assert.deepEqual(migrated.prepare("SELECT request_id,message,fee,result_source_line FROM gift_events ORDER BY id")
        .all().map(x=>({...x})),[
          {request_id:"phase37_old_convert",message:"",fee:50000,result_source_line:1000001},
          {request_id:"phase37_new_convert",message:"",fee:50000,result_source_line:1000002}
        ]);
      for(const row of migrated.prepare("SELECT * FROM legacy_inventory_items ORDER BY source_line").all()){
        assert.equal(row.category,"ギフト");
        assert.equal(row.original_name,seed.name);
        assert.equal(JSON.parse(row.raw_fields_json).length,33);
      }
      assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    }finally{migrated.close();}

    const old=new DatabaseSync(join(oldDir,"solo.sqlite"),{readOnly:true});
    try{
      assert.equal(old.prepare("SELECT money FROM characters WHERE id=1").get().money,150000);
      assert.equal(old.prepare("SELECT COUNT(*) n FROM gift_events").get().n,1);
      assert.equal(old.prepare("PRAGMA table_info(gift_events)").all()
        .some(row=>row.name==="message"),false);
      assert.equal(old.prepare("SELECT category FROM legacy_inventory_items WHERE source_line=1000002")
        .get().category!=="ギフト",true);
    }finally{old.close();}
    assert.equal(verifySoloDatabase(backupFile).sha256,snapshot.sha256);
  }finally{
    await server?.stop();
    rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
