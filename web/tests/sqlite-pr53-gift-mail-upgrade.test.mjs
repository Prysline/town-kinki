import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { backUpSolo, restoreSolo, verifySoloDatabase } from "../scripts/solo-save.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const stats=()=>Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","love","unique","etti"].map(x=>[x,20]));
function insert(db,table,values){
  const keys=Object.keys(values);
  db.prepare("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")").run(...Object.values(values));
}
async function serve(dir){
  const child=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,env:{...process.env,GAME_MODE:"solo",HOST:"127.0.0.1",PORT:"0",DATA_DIR:dir}
  });
  let log="",stdout="";
  child.stdout.on("data",x=>{stdout+=x;log+=x;});
  child.stderr.on("data",x=>log+=x);
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)break;
    const url=stdout.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)\r?\n/m)?.[1];
    if(!url){await delay(100);continue;}
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
// PR #53 merged SHA 9a29e04ef03a1c6930094c8a5c3c42ce4e384b4c:
// gift_mail_messages.event_id 曾直接 REFERENCES gift_events(id) ON DELETE CASCADE。
// 目前 initGiftTables 先改為不引用交易表的 v2，再由 initPrivateMailTables
// 升級至可同時保存私人文字信的 v3。此案專測兩階段升級＋對方刪帳保護。
const PR53_SHA="9a29e04ef03a1c6930094c8a5c3c42ce4e384b4c";
const SOURCE="gift_mail_messages";
function seedPR53GiftMail(dir){
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
      "CREATE TABLE gift_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id TEXT NOT NULL,action TEXT NOT NULL,source_line INTEGER NOT NULL,quantity INTEGER NOT NULL,recipient_user_id INTEGER,result_source_line INTEGER NOT NULL,fee INTEGER NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,request_id));",
      "CREATE TABLE gift_mail_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_id INTEGER NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,direction TEXT NOT NULL CHECK(direction IN ('inbox','sent')),other_name TEXT NOT NULL,message TEXT NOT NULL,gift_name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),created_at INTEGER NOT NULL,UNIQUE(event_id,direction));",
      "CREATE INDEX gift_mail_user_idx ON gift_mail_messages(user_id,created_at DESC,id DESC);",
      "CREATE TABLE legacy_inventory_items(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,original_id TEXT NOT NULL,source_line INTEGER NOT NULL,category TEXT NOT NULL,original_name TEXT NOT NULL,effect TEXT NOT NULL,durability INTEGER NOT NULL,durability_unit TEXT NOT NULL,purchased_at INTEGER,last_used_at INTEGER,raw_fields_json TEXT NOT NULL,UNIQUE(user_id,source_line));"
    ].join("\n"));
    // 舊 PR #53 角色擴充欄位完全依當時 server.mjs，非套用當前新 schema。
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
    insert(db,"users",{id:2,username:"pr53_old_sender",password_salt:"old-salt",password_hash:"old-hash",created_at:now});
    for(const [userId,name,money,bank] of [[1,"舊信收件者",85000,14000],[2,"舊信寄件者",37000,9000]]){
      insert(db,"characters",{user_id:userId,name,gender:"other",town_id:0,money,bank,
        body_energy:90,brain_energy:90,recovered_at:now,job_id:"legacy-2",
        work_progress:0,last_work_at:0,work_count:0,height:165,bmi:22,
        stats_json:JSON.stringify(stats()),created_at:now,
        last_health_day:"9999-12-31",last_event_day:"9999-12-31"});
    }
    insert(db,"solo_clock",{id:1,offset_ms:0});
    insert(db,"gift_events",{id:21,user_id:2,request_id:"pr53_gift_once",
      action:"send",source_line:3000001,quantity:1,recipient_user_id:1,
      result_source_line:3000002,fee:0,name:"油取り紙",created_at:now});
    db.exec("ALTER TABLE gift_events ADD COLUMN message TEXT NOT NULL DEFAULT ''");
    db.prepare("UPDATE gift_events SET message=? WHERE id=21").run("原版附禮信件內容");
    insert(db,SOURCE,{id:101,user_id:1,event_id:21,direction:"inbox",
      other_name:"舊信寄件者",message:"原版附禮信件內容",gift_name:"油取り紙",
      quantity:1,created_at:now});
    insert(db,SOURCE,{id:102,user_id:2,event_id:21,direction:"sent",
      other_name:"舊信收件者",message:"原版附禮信件內容",gift_name:"油取り紙",
      quantity:1,created_at:now});
    // 依 PR #53 gift-shop.mjs::sendGift 寫入收禮品時使用的 33 欄規格。
    const raw=Array(33).fill("0");
    raw[0]="ギフト商品";raw[1]="油取り紙";raw[9]="無";raw[21]="1";
    raw[22]="回";raw[30]=String(seconds);raw[31]="0";
    raw[29]="\t舊信寄件者さんからの贈り物です。";
    insert(db,"legacy_inventory_items",{user_id:1,original_id:"__web_gift__",
      source_line:3000002,category:"ギフト商品",original_name:"油取り紙",
      effect:"無",durability:1,durability_unit:"回",purchased_at:seconds,
      last_used_at:0,raw_fields_json:JSON.stringify(raw)});
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.ok(db.prepare("PRAGMA foreign_key_list(gift_mail_messages)").all()
      .some(k=>k.table==="gift_events"));
    return {now,seconds};
  }finally{db.close();}
}

test("PR #53 舊 Web 寄禮外鍵→現行雙重信箱：備份升級、寄件者刪帳、重啟保留收件者資產",async()=>{
  const workspace=mkdtempSync(join(tmpdir(),"town-pr53-gift-mail-"));
  const oldDir=join(workspace,"old"),newDir=join(workspace,"new");
  const snapshot=join(workspace,"backup.sqlite");
  let server=null;
  try{
    const seed=seedPR53GiftMail(oldDir);
    const backup=await backUpSolo({dataDir:oldDir,file:snapshot});
    assert.equal(backup.characters,2);
    assert.equal(verifySoloDatabase(snapshot).sha256,backup.sha256);
    restoreSolo({dataDir:newDir,file:snapshot});
    server=await serve(newDir);
    const first=await api(server.url,"state");
    assert.equal(first.status,200);
    assert.equal(first.result.character.name,"舊信收件者");
    assert.equal(first.result.character.money,85000);
    assert.equal(first.result.character.bank,14000);
    assert.equal(first.result.mailbox.length,1);
    assert.deepEqual(first.result.mailbox[0],{
      id:101,type:"gift",direction:"inbox",otherName:"舊信寄件者",
      message:"原版附禮信件內容",giftName:"油取り紙",
      quantity:1,createdAt:seed.now
    });
    assert.equal(first.result.giftMail.length,1);
    assert.equal(first.result.legacyInventory.some(x=>x.name==="油取り紙"),true);
    const migrated=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      migrated.exec("PRAGMA foreign_keys=ON");
      const columns=new Set(migrated.prepare("PRAGMA table_info(gift_mail_messages)").all().map(x=>x.name));
      assert.ok(columns.has("private_event_id"),"PR #53 舊寄禮信件須無損升級至 v3");
      assert.ok(migrated.prepare("PRAGMA foreign_key_list(gift_mail_messages)").all()
        .every(x=>x.table!=="gift_events"),"收件者信件不得外鍵依賴寄件交易");
      assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM gift_mail_messages").get().n,2);
      assert.equal(migrated.prepare("SELECT private_event_id FROM gift_mail_messages WHERE id=101").get().private_event_id,null);
      assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(),[]);
      assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    }finally{migrated.close();}
    // 現行 Web 可在升級後向舊寄件者發純文字信，與原信共存且防重送。
    const payload={recipientName:"舊信寄件者",
      message:"跨版本升級後的新信",requestId:"pr53_new_plain_01"};
    const sent=await api(server.url,"mail/send",payload);
    assert.equal(sent.status,200);
    assert.equal(sent.result.mailResult.replayed,false);
    assert.equal(sent.result.mailbox.length,2);
    assert.equal(sent.result.mailbox.filter(x=>x.type==="plain").length,1);
    const replay=await api(server.url,"mail/send",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.mailResult.replayed,true);
    assert.equal(replay.result.mailbox.length,2);
    // 這項是舊版本遷移獨有的風險：歷史外鍵若未解除，刪 sender 會毀掉收件者的信。
    const deletion=new DatabaseSync(join(newDir,"solo.sqlite"));
    try{
      deletion.exec("PRAGMA foreign_keys=ON");
      assert.equal(deletion.prepare("DELETE FROM users WHERE id=2").run().changes,1);
      assert.equal(deletion.prepare("SELECT COUNT(*) AS n FROM gift_events").get().n,0);
      assert.equal(deletion.prepare("SELECT COUNT(*) AS n FROM gift_mail_messages WHERE user_id=1").get().n,2);
      assert.equal(deletion.prepare("SELECT COUNT(*) AS n FROM legacy_inventory_items WHERE user_id=1").get().n,1);
      assert.deepEqual(deletion.prepare("PRAGMA foreign_key_check").all(),[]);
    }finally{deletion.close();}
    const afterDeletion=(await api(server.url,"state")).result;
    assert.deepEqual(afterDeletion.mailbox.map(x=>x.type),["plain","gift"]);
    assert.equal(afterDeletion.giftMail.length,1);
    assert.equal(afterDeletion.legacyInventory.some(x=>x.name==="油取り紙"),true);
    await server.stop();server=null;
    server=await serve(newDir);
    const resumed=(await api(server.url,"state")).result;
    assert.equal(resumed.mailbox.length,2);
    assert.deepEqual(resumed.mailbox.map(x=>x.message),
      afterDeletion.mailbox.map(x=>x.message));
    assert.equal(resumed.giftMail.length,1);
    assert.equal(resumed.character.money,85000);
    assert.equal(resumed.character.bank,14000);
    assert.equal(resumed.legacyInventory.some(x=>x.name==="油取り紙"),true);
    const oldDb=new DatabaseSync(join(oldDir,"solo.sqlite"),{readOnly:true});
    try{
      assert.ok(oldDb.prepare("PRAGMA foreign_key_list(gift_mail_messages)").all()
        .some(x=>x.table==="gift_events"),"來源舊 Web 備份不許直接修改");
      const c=new Set(oldDb.prepare("PRAGMA table_info(gift_mail_messages)").all().map(x=>x.name));
      assert.equal(c.has("private_event_id"),false);
      assert.equal(oldDb.prepare("SELECT COUNT(*) AS n FROM gift_mail_messages").get().n,2);
      assert.equal(oldDb.prepare("SELECT COUNT(*) AS n FROM users").get().n,2);
    }finally{oldDb.close();}
  }finally{
    await server?.stop();
    rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
