import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_CHARACTER_FIELDS } from "../src/legacy-character.mjs";
import { initLegacyInventoryTables } from "../src/legacy-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const delay = ms => new Promise(done => setTimeout(done, ms));
async function freePort() {
  const server = createServer();
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => ok(port));
    });
  });
}
async function start(mode, seed) {
  const port = await freePort();
  const directory = mkdtempSync(join(tmpdir(), "town-web-"));
  if (seed) seed(directory);
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: root, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), GAME_MODE: mode, DATA_DIR: directory }
  });
  let log = "";
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  const url = "http://127.0.0.1:" + port;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(url + "/api/state", { signal: AbortSignal.timeout(400) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  if (!ready) {
    child.kill();
    throw new Error("無法啟動測試伺服器：" + log);
  }
  return {
    url, directory,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise(done => child.once("exit", done));
        child.kill();
        await Promise.race([exited, delay(1500)]);
      }
      rmSync(directory, { force: true, recursive: true });
    }
  };
}
async function api(base, route, body, cookie) {
  const response = await fetch(base + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status, result: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

const defaultStats = () => Object.fromEntries(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","love","unique","etti"].map(key => [key,20]));

test("單機：原版配點限制、建角、選職、工作、存提款與冷卻", async () => {
  const srv = await start("solo");
  try {
    const initial = await api(srv.url, "state");
    assert.equal(initial.result.user.username, "單機玩家");
    const badStats = defaultStats();
    badStats.kokugo = 199;
    assert.equal((await api(srv.url, "character", { name: "測試居民", gender: "other", stats: badStats })).status, 400);
    const created = await api(srv.url, "character", { name: "測試居民", gender: "other", stats: defaultStats() });
    assert.equal(created.status, 200);
    assert.equal(created.result.jobs.find(job => job.key === "legacy-2").name, "日薪打工");
    const clerk=created.result.jobs.find(job=>job.originalName==="コンビニ店員");
    assert.ok(clerk,"原版便利商店店員必須可查閱");
    assert.equal(Object.keys(clerk.requirements).length,17);
    assert.equal(clerk.requirements.suugaku,50);
    assert.equal(clerk.requirements.syakai,50);
    assert.equal(clerk.requirements.tairyoku,60);
    assert.equal(clerk.requirements.kenkou,50);
    assert.equal(clerk.bmiMin,17);
    assert.equal(clerk.payEvery,5);
    assert.equal(clerk.bonusRate,15);
    assert.ok(clerk.reason,"不能因公開需求數值而放寬應徵條件");
    assert.equal((await api(srv.url,"job",{key:clerk.key})).status,400);
    const job = await api(srv.url, "job", { key: "legacy-2" });
    assert.equal(job.status, 200);
    const work = await api(srv.url, "work", {});
    assert.equal(work.status, 200);
    assert.equal(work.result.character.money, 101000);
    assert.equal(work.result.character.jobExperience >= 6, true);
    assert.equal(work.result.result.paid, 1000);
    assert.equal((await api(srv.url, "work", {})).status, 400);
    const deposit = await api(srv.url, "bank", { action: "deposit", amount: 2000 });
    assert.equal(deposit.status, 200);
    assert.equal(deposit.result.character.bank, 2000);
    assert.equal(deposit.result.character.money, 99000);
    const withdraw = await api(srv.url, "bank", { action: "withdraw", amount: 500 });
    assert.equal(withdraw.status, 200);
    assert.equal(withdraw.result.character.bank, 1500);
    assert.equal(withdraw.result.character.money, 99500);
    assert.equal((await api(srv.url, "bank", { action: "withdraw", amount: 2500 })).status, 400);
  } finally { await srv.stop(); }
});

test("單機獨立教室：原版四課、實際雙能量扣除、減重、資料庫冷卻與現金交易",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"教室居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const before=created.result.character;
    const lessons=created.result.trainingLessons.filter(x=>x.type==="classroom");
    assert.equal(lessons.length,4);
    assert.deepEqual(lessons.map(x=>x.price),[10000,20000,5000000,10000000]);
    assert.deepEqual(lessons.map(x=>[x.bodyCost,x.brainCost]),
      [[10,10],[20,0],[50,50],[100,100]]);
    const lesson=lessons[0];
    assert.equal(lesson.reason,null);
    assert.equal((await api(srv.url,"train",{key:lesson.key,payment:"credit"})).status,400,
      "沒有有效的本人信用卡，不可偽裝銀行付款");
    const trained=await api(srv.url,"train",{key:lesson.key,payment:"cash"});
    assert.equal(trained.status,200);
    assert.equal(trained.result.trainingResult.paid,10000);
    assert.equal(trained.result.trainingResult.weightLoss,0.2);
    const after=trained.result.character;
    assert.equal(after.money,before.money-10000);
    assert.equal(after.bodyEnergy,before.bodyEnergy-10);
    assert.equal(after.brainEnergy,before.brainEnergy-10);
    assert.equal(after.stats.looks,before.stats.looks+1);
    assert.equal(after.stats.etti,before.stats.etti+1);
    assert.equal(after.weight,before.weight-0.2);
    assert.ok(trained.result.classroomCooldownMs>0);
    assert.equal(trained.result.gymCooldownMs,0);
    assert.equal((await api(srv.url,"train",{key:lesson.key})).status,400,
      "重複請求不可重複扣款或增加能力");
    const persisted=await api(srv.url,"state");
    assert.equal(persisted.result.character.money,after.money);
    assert.equal(persisted.result.character.weight,after.weight);
    assert.ok(persisted.result.classroomCooldownMs>0);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      assert.ok(db.prepare("PRAGMA table_info(characters)").all()
        .some(col=>col.name==="classroom_ready_at"));
      assert.ok(db.prepare("SELECT classroom_ready_at FROM characters").get().classroom_ready_at>0);
    }finally{db.close();}
  }finally{await srv.stop();}
});


test("教室信用付款：匯入有效原版卡，真正扣銀行、保留現金與帳簿，冷卻拒絕重複扣款",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"信用教室居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const now=created.result.gameTimeMs;
    const purchased=Math.floor(now/1000)-60;
    const raw=Array(33).fill("");
    raw[0]="日用品";raw[1]="クレジットカード";
    raw[9]="クレジット";raw[21]="3";raw[22]="日";raw[30]=String(purchased);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const owner=db.prepare("SELECT user_id FROM characters").get().user_id;
      db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(owner,"000001",1,"日用品","クレジットカード","クレジット",
          3,"日",purchased,0,JSON.stringify(raw));
    }finally{db.close();}
    const deposit=await api(srv.url,"bank",{action:"deposit",amount:99000});
    assert.equal(deposit.status,200);
    const state=await api(srv.url,"state");
    assert.equal(state.result.character.money,1000);
    assert.equal(state.result.character.bank,99000);
    assert.equal(state.result.classroomCreditCards.length,1);
    assert.equal(state.result.classroomCreditCards[0].sourceLine,1);
    const lesson=state.result.trainingLessons.find(x=>x.key==="classroom-2");
    assert.match(lesson.cashReason,/現金不足/);
    assert.equal(lesson.creditReason,null);
    assert.equal(lesson.reason,null,"可用本人有效卡付款時，課程不得被整體停用");
    assert.equal((await api(srv.url,"train",{
      key:"classroom-2",payment:"credit",sourceLine:2
    })).status,400);
    const before=await api(srv.url,"state");
    assert.equal(before.result.character.bank,99000,"不存在卡片不能改變銀行");
    const paid=await api(srv.url,"train",{
      key:"classroom-2",payment:"credit",sourceLine:1
    });
    assert.equal(paid.status,200);
    assert.equal(paid.result.trainingResult.payment,"credit");
    assert.equal(paid.result.trainingResult.paid,10000);
    assert.equal(paid.result.character.money,1000);
    assert.equal(paid.result.character.bank,89000);
    assert.equal(paid.result.character.stats.looks,created.result.character.stats.looks+1);
    assert.equal(paid.result.trainingResult.weightLoss,0.2);
    const bankEntry=paid.result.bankLedger.find(x=>x.action==="教室信用付款（受講料）");
    assert.ok(bankEntry);
    assert.equal(bankEntry.type,"ordinary");
    assert.equal(bankEntry.debit,10000);
    assert.equal(bankEntry.balance,89000);
    assert.equal((await api(srv.url,"train",{
      key:"classroom-2",payment:"credit",sourceLine:1
    })).status,400);
    assert.equal((await api(srv.url,"state")).result.bankLedger
      .filter(x=>x.action==="教室信用付款（受講料）").length,1);
    const update=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const expired=Math.floor(now/1000)-4*86400;
      const out=[...raw];out[30]=String(expired);
      update.prepare("UPDATE legacy_inventory_items SET purchased_at=?,raw_fields_json=? WHERE source_line=1")
        .run(expired,JSON.stringify(out));
    }finally{update.close();}
    const afterExpiry=await api(srv.url,"state");
    assert.equal(afterExpiry.result.classroomCreditCards.length,0);
  }finally{await srv.stop();}
});

test("多人教室信用卡持有人隔離：不能用其他人的原版卡片支付",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{
      username:"credit_holder",password:"credit-holder-password-123"
    });
    const b=await api(srv.url,"register",{
      username:"credit_other",password:"credit-other-password-123"
    });
    const first=await api(srv.url,"character",{
      name:"持卡居民",gender:"male",stats:defaultStats()
    },a.cookie);
    const second=await api(srv.url,"character",{
      name:"無卡居民",gender:"female",stats:defaultStats()
    },b.cookie);
    assert.equal(first.status,200);
    assert.equal(second.status,200);
    const purchased=Math.floor(first.result.gameTimeMs/1000)-60;
    const raw=Array(33).fill("");
    raw[0]="日用品";raw[1]="クレジットカード";raw[9]="クレジット";
    raw[21]="3";raw[22]="日";raw[30]=String(purchased);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const owner=db.prepare("SELECT user_id FROM characters WHERE name='持卡居民'").get().user_id;
      db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(owner,"000002",1,"日用品","クレジットカード","クレジット",
          3,"日",purchased,0,JSON.stringify(raw));
    }finally{db.close();}
    const others=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(others.result.classroomCreditCards.length,0);
    assert.equal((await api(srv.url,"train",{
      key:"classroom-2",payment:"credit",sourceLine:1
    },b.cookie)).status,400);
    const verify=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(verify.result.classroomCreditCards.length,1);
    assert.equal(verify.result.character.money,100000);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.character.money,100000);
  }finally{await srv.stop();}
});

test("薪資去向：偏好存檔、實際銀行入帳與帳簿、重送冷卻及回切現金",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"領薪測試居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.character.salaryPayment,"cash");
    assert.equal((await api(srv.url,"job/payment",{payment:"credit"})).status,400);
    const pref=await api(srv.url,"job/payment",{payment:"bank"});
    assert.equal(pref.status,200);
    assert.equal(pref.result.character.salaryPayment,"bank");
    const before=pref.result.character;
    const paid=await api(srv.url,"work",{});
    assert.equal(paid.status,200);
    assert.equal(paid.result.result.payment,"bank");
    assert.equal(paid.result.result.paid,1000);
    assert.equal(paid.result.character.bank,before.bank+1000);
    assert.equal(paid.result.character.money,before.money);
    const entry=paid.result.bankLedger.find(x=>x.action==="工作薪資");
    assert.ok(entry);
    assert.equal(entry.type,"ordinary");
    assert.equal(entry.credit,1000);
    assert.equal(entry.balance,before.bank+1000);
    assert.equal((await api(srv.url,"work",{})).status,400,"工作冷卻阻止重複入帳");
    assert.equal((await api(srv.url,"state")).result.bankLedger
      .filter(x=>x.action==="工作薪資").length,1);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      assert.equal(db.prepare("SELECT salary_payment FROM characters").get().salary_payment,"bank");
    }finally{db.close();}
    const reset=await api(srv.url,"job/payment",{payment:"cash"});
    assert.equal(reset.status,200);
    assert.equal(reset.result.character.salaryPayment,"cash");
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    const second=await api(srv.url,"work",{});
    assert.equal(second.status,200);
    assert.equal(second.result.result.payment,"cash");
    assert.equal(second.result.character.money,before.money+1000);
    assert.equal(second.result.character.bank,before.bank+1000);
    assert.equal(second.result.bankLedger.filter(x=>x.action==="工作薪資").length,1);
  }finally{await srv.stop();}
});

test("便利商店五次結薪：前四次兩種帳戶皆不增加，第五次銀行正確入帳，再五次現金正確入帳",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"五次發薪測試",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const stats={...defaultStats(),
        suugaku:100,syakai:100,tairyoku:100,kenkou:100};
      db.prepare("UPDATE characters SET job_id='legacy-3', job_work_count=0, work_progress=0, "+
        "stats_json=?,body_energy=120,brain_energy=120").run(JSON.stringify(stats));
    }finally{db.close();}
    let state=await api(srv.url,"job/payment",{payment:"bank"});
    assert.equal(state.status,200);
    assert.equal(state.result.currentJob.payEvery,5);
    assert.equal(state.result.currentJob.workProgress,0);
    assert.equal(state.result.currentJob.worksUntilPayday,5);
    const initial=state.result.character;
    for(let i=1;i<=5;i++){
      if(i>1)assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
      const worked=await api(srv.url,"work",{});
      assert.equal(worked.status,200,"便利商店第 "+i+" 次出勤");
      const result=worked.result.result;
      assert.equal(result.payEvery,5);
      assert.equal(result.pending,i%5);
      assert.equal(result.worksUntilPayday,5-(i%5));
      assert.equal(worked.result.currentJob.workProgress,i%5);
      assert.equal(worked.result.currentJob.worksUntilPayday,5-(i%5));
      assert.equal(result.paid,i===5?15000:0);
      assert.equal(result.bonus,0,"五次工作內不應突然晉升");
      assert.equal(worked.result.character.money,initial.money);
      assert.equal(worked.result.character.bank,initial.bank+(i===5?15000:0));
      assert.equal(worked.result.bankLedger.filter(x=>x.action==="工作薪資").length,i===5?1:0);
    }
    const switched=await api(srv.url,"job/payment",{payment:"cash"});
    assert.equal(switched.status,200);
    assert.equal(switched.result.character.salaryPayment,"cash");
    const before=switched.result.character;
    for(let i=1;i<=5;i++){
      assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
      const worked=await api(srv.url,"work",{});
      assert.equal(worked.status,200,"切現金後第 "+i+" 次出勤");
      const result=worked.result.result;
      assert.equal(result.payment,"cash");
      assert.equal(result.paid>0,i===5);
      assert.equal(worked.result.character.money,
        before.money+(i===5?result.paid+result.bonus:0));
      assert.equal(worked.result.character.bank,before.bank);
      assert.equal(worked.result.bankLedger.filter(x=>x.action==="工作薪資").length,1);
    }
    const persisted=await api(srv.url,"state");
    assert.equal(persisted.result.currentJob.workProgress,0);
    assert.equal(persisted.result.currentJob.worksUntilPayday,5);
    assert.equal(persisted.result.character.jobWorkCount,10);
  }finally{await srv.stop();}
});

test("原版車站：四城六組票價、12 向扣款、無效／同城／餘額不足不更動資料",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"電車旅客",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const routes=[[0,1,950],[0,2,780],[0,3,1210],
      [1,2,950],[1,3,2210],[2,3,1530]];
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      for(const [a,b,fare] of routes){
        for(const [from,to] of [[a,b],[b,a]]){
          db.prepare("UPDATE characters SET town_id=?,money=100000").run(from);
          const before=await api(srv.url,"state");
          const choices=before.result.trainDestinations;
          assert.equal(choices.length,4);
          assert.equal(choices.find(x=>x.townId===to).fare,fare);
          // 客戶端偽造出發站與費用都不可改變伺服器使用的來源。
          const moved=await api(srv.url,"move",{
            townId:to,fromTownId:3,maemati:3,fare:0
          });
          assert.equal(moved.status,200,`route ${from} -> ${to}`);
          assert.deepEqual(moved.result.travelResult,{
            fromTownId:from,toTownId:to,fare
          });
          assert.equal(moved.result.character.townId,to);
          assert.equal(moved.result.character.money,100000-fare);
          assert.equal(db.prepare("SELECT money,town_id FROM characters").get().money,100000-fare);
          const repeated=await api(srv.url,"move",{townId:to});
          assert.equal(repeated.status,400,"同城移動必須拒絕");
          assert.equal((await api(srv.url,"state")).result.character.money,100000-fare);
        }
      }
      db.prepare("UPDATE characters SET town_id=1,money=2209").run();
      const poor=await api(srv.url,"move",{townId:3});
      assert.equal(poor.status,400);
      assert.match(poor.result.error,/現金不足/);
      assert.deepEqual({...db.prepare("SELECT money,town_id FROM characters").get()},
        {money:2209,town_id:1});
      for(const invalid of [-1,4,1.5,"3",null]){
        assert.equal((await api(srv.url,"move",{townId:invalid})).status,400);
        assert.deepEqual({...db.prepare("SELECT money,town_id FROM characters").get()},
          {money:2209,town_id:1});
      }
    }finally{db.close();}
  }finally{await srv.stop();}
});

test("多人電車扣款只作用於登入玩家，不可藉請求指定其他人的出發城鎮",async()=>{
  const srv=await start("multi");
  try{
    const first=await api(srv.url,"register",{
      username:"train_first",password:"pass-for-train-first-123"
    });
    const second=await api(srv.url,"register",{
      username:"train_second",password:"pass-for-train-second-123"
    });
    assert.equal((await api(srv.url,"character",{
      name:"第一旅客",gender:"male",stats:defaultStats()
    },first.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"第二旅客",gender:"female",stats:defaultStats()
    },second.cookie)).status,200);
    const moved=await api(srv.url,"move",{townId:3,fromTownId:3},first.cookie);
    assert.equal(moved.status,200);
    assert.equal(moved.result.travelResult.fare,1210);
    assert.equal(moved.result.character.money,98790);
    const untouched=await api(srv.url,"state",undefined,second.cookie);
    assert.equal(untouched.result.character.townId,0);
    assert.equal(untouched.result.character.money,100000);
    assert.equal((await api(srv.url,"move",{townId:3})).status,401,
      "未登入不得代替任何玩家搭車");
  }finally{await srv.stop();}
});

test("多人：兩位玩家可獨立登入並看見同城居民", async () => {
  const srv = await start("multi");
  try {
    assert.equal((await api(srv.url, "state")).result.user, null);
    const a = await api(srv.url, "register", { username: "player_one", password: "pass-for-first-123" });
    assert.equal(a.status, 200);
    assert.ok(a.cookie);
    assert.equal((await api(srv.url, "character", { name: "第一位居民", gender: "male", stats: defaultStats() }, a.cookie)).status, 200);
    const b = await api(srv.url, "register", { username: "player_two", password: "pass-for-second-123" });
    assert.equal(b.status, 200);
    assert.equal((await api(srv.url, "character", { name: "第二位居民", gender: "female", stats: defaultStats() }, b.cookie)).status, 200);
    const view = await api(srv.url, "state", undefined, a.cookie);
    assert.equal(view.result.character.name, "第一位居民");
    assert.deepEqual(view.result.residents, ["第二位居民"]);
    await api(srv.url, "logout", {}, a.cookie);
    assert.equal((await api(srv.url, "state", undefined, a.cookie)).result.user, null);
  } finally { await srv.stop(); }
});


test("既有第一階段 SQLite 角色可無破壞升級資料欄位", async () => {
  const seed = directory => {
    const database = new DatabaseSync(join(directory, "solo.sqlite"));
    database.exec([
      "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);",
      "CREATE TABLE characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL UNIQUE, gender TEXT NOT NULL, town_id INTEGER NOT NULL, money INTEGER NOT NULL, bank INTEGER NOT NULL, body_energy INTEGER NOT NULL, brain_energy INTEGER NOT NULL, recovered_at INTEGER NOT NULL, job_id TEXT, work_progress INTEGER NOT NULL, last_work_at INTEGER NOT NULL, work_count INTEGER NOT NULL, height INTEGER NOT NULL, bmi REAL NOT NULL, stats_json TEXT NOT NULL);"
    ].join("\n"));
    database.prepare("INSERT INTO users(id,username,password_salt,password_hash,created_at) VALUES(1,?,?,?,?)")
      .run("__local_player__", "salt", "hash", Date.now());
    database.prepare("INSERT INTO characters(user_id,name,gender,town_id,money,bank,body_energy,brain_energy,recovered_at,job_id,work_progress,last_work_at,work_count,height,bmi,stats_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(1, "舊版居民", "other", 0, 50000, 1000, 10, 20, Date.now(), null, 0, 0, 2, 165, 22, JSON.stringify(defaultStats()));
    database.close();
  };
  const srv = await start("solo", seed);
  try {
    const state = await api(srv.url, "state");
    assert.equal(state.status, 200);
    assert.equal(state.result.character.name, "舊版居民");
    assert.equal(state.result.character.money, 50000);
    assert.equal(state.result.character.workCount, 2);
    assert.equal(state.result.character.jobExperience, 0);
    const deposited = await api(srv.url, "bank", { action: "deposit", amount: 1000 });
    assert.equal(deposited.status, 200);
    assert.equal(deposited.result.character.money, 49000);
    assert.equal(deposited.result.character.bank, 2000);
    const trained = await api(srv.url, "train", { key: "school-3" });
    assert.equal(trained.status, 200);
    assert.equal(trained.result.character.money, 35000);
    assert.equal(trained.result.character.stats.kokugo, 30);
    assert.equal(trained.result.schoolRemainingToday, true);
  } finally { await srv.stop(); }
});


test("單機：學校與健身房使用原始資料並防止重複取得能力值", async () => {
  const srv = await start("solo");
  try {
    const created = await api(srv.url, "character", {
      name: "訓練居民", gender: "other", stats: defaultStats()
    });
    assert.equal(created.status, 200);
    assert.equal(created.result.trainingLessons.filter(x => x.type === "school").length, 6);
    assert.equal(created.result.trainingLessons.filter(x => x.type === "gym").length, 9);

    const result = await api(srv.url, "train", {
      key: "school-2", price: 0, gained: { eigo: 99999 }
    });
    assert.equal(result.status, 200);
    assert.equal(result.result.character.stats.eigo, 30);
    assert.equal(result.result.character.money, 84000);
    assert.equal(result.result.trainingResult.paid, 16000);

    const duplicate = await api(srv.url, "train", { key: "school-3" });
    assert.equal(duplicate.status, 400);
    assert.equal((await api(srv.url, "state")).result.character.stats.kokugo, 21);

    const gym = await api(srv.url, "train", { key: "gym-3" });
    assert.equal(gym.status, 200);
    assert.equal(gym.result.character.money, 83200);
    assert.equal(gym.result.character.stats.kenkou, 23);
    const gymAgain = await api(srv.url, "train", { key: "gym-2" });
    assert.equal(gymAgain.status, 400);
    assert.equal((await api(srv.url, "state")).result.character.money, 83200);
    assert.equal((await api(srv.url, "train", { key: "gym-999" })).status, 404);
  } finally { await srv.stop(); }
});

test("多人：課程限制分別記錄在每位玩家資料中", async () => {
  const srv = await start("multi");
  try {
    const a = await api(srv.url, "register", { username: "trainuserone", password: "correct-horse-battery" });
    const b = await api(srv.url, "register", { username: "trainusertwo", password: "some-other-password" });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    await api(srv.url, "character", { name: "學員甲", gender: "female", stats: defaultStats() }, a.cookie);
    await api(srv.url, "character", { name: "學員乙", gender: "male", stats: defaultStats() }, b.cookie);
    const trained = await api(srv.url, "train", { key: "school-2" }, a.cookie);
    assert.equal(trained.status, 200);
    assert.equal(trained.result.schoolRemainingToday, true);
    assert.equal((await api(srv.url, "train", { key: "school-3" }, a.cookie)).status, 400);
    const other = await api(srv.url, "state", undefined, b.cookie);
    assert.equal(other.result.schoolRemainingToday, false);
    assert.equal(other.result.character.stats.eigo, 20);
    const trainedB = await api(srv.url, "train", { key: "school-2" }, b.cookie);
    assert.equal(trainedB.status, 200);
    assert.equal(trainedB.result.character.stats.eigo, 30);
    assert.equal((await api(srv.url, "train", { key: "gym-3" })).status, 401);
  } finally { await srv.stop(); }
});


test("單機：可配置原版街區圖示，切換城鎮後地圖保留", async () => {
  const srv = await start("solo");
  try {
    await api(srv.url, "character", { name: "地圖編輯者", gender: "other", stats: defaultStats() });
    const initial = await api(srv.url, "state");
    assert.equal(initial.result.map.configured, false);
    assert.equal(initial.result.map.editable, true);
    assert.equal(initial.result.map.cells.length, 192);
    const updated = await api(srv.url, "map/tile", { row: 0, column: 0, symbol: "銀行" });
    assert.equal(updated.status, 200);
    assert.equal(updated.result.map.configured, true);
    assert.equal(updated.result.map.cells[0].image, "bank.gif");
    assert.equal(updated.result.map.cells[0].raw, "銀行");
    assert.equal((await api(srv.url, "map/tile", { row: 1, column: 1, symbol: "../../secret" })).status, 400);
    assert.equal((await api(srv.url, "map/tile", { row: 12, column: 0, symbol: "銀行" })).status, 400);
    const next = await api(srv.url, "move", { townId: 1 });
    assert.equal(next.status, 200);
    assert.equal(next.result.map.configured, false);
    const back = await api(srv.url, "move", { townId: 0 });
    assert.equal(back.status, 200);
    assert.equal(back.result.map.cells[0].raw, "銀行");
    const removed = await api(srv.url, "map/tile", { row: 0, column: 0, symbol: "" });
    assert.equal(removed.status, 200);
    assert.equal(removed.result.map.cells[0].raw, "");
  } finally { await srv.stop(); }
});

test("多人：載入同一座街區地圖，但普通玩家無法修改伺服器地圖", async () => {
  const seed = directory => {
    const db = new DatabaseSync(join(directory, "multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, tiles_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const grid = Array(192).fill("");
    grid[0] = "駅";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(0, "京阪神ストリート", "legacy-import", JSON.stringify(grid), Date.now());
    db.close();
  };
  const srv = await start("multi", seed);
  try {
    const first = await api(srv.url, "register", { username: "mapresidentone", password: "password-for-map-one" });
    const second = await api(srv.url, "register", { username: "mapresidenttwo", password: "password-for-map-two" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    await api(srv.url, "character", { name: "地圖玩家甲", gender: "male", stats: defaultStats() }, first.cookie);
    await api(srv.url, "character", { name: "地圖玩家乙", gender: "female", stats: defaultStats() }, second.cookie);
    const viewA = await api(srv.url, "state", undefined, first.cookie);
    const viewB = await api(srv.url, "state", undefined, second.cookie);
    assert.equal(viewA.result.map.cells[0].raw, "駅");
    assert.equal(viewB.result.map.cells[0].raw, "駅");
    assert.equal(viewA.result.map.editable, false);
    assert.equal(viewB.result.map.editable, false);
    const forbidden = await api(srv.url, "map/tile", { row: 0, column: 0, symbol: "銀行" }, first.cookie);
    assert.equal(forbidden.status, 403);
    assert.equal((await api(srv.url, "state", undefined, second.cookie)).result.map.cells[0].raw, "駅");
  } finally { await srv.stop(); }
});


test("單機：從街區空地建屋、以原版費率支付、儲存後不允許覆蓋或再次建屋", async () => {
  const srv = await start("solo");
  try {
    const created = await api(srv.url, "character",
      { name: "購屋測試", gender: "other", stats: defaultStats() });
    assert.equal(created.status, 200);
    await api(srv.url, "move", { townId:3 });
    assert.equal((await api(srv.url, "map/tile", { row:0,column:0,symbol:"空地" })).status, 200);
    assert.equal((await api(srv.url, "map/tile", { row:0,column:1,symbol:"空地2" })).status, 200);
    const db = new DatabaseSync(join(srv.directory, "solo.sqlite"));
    try { db.prepare("UPDATE characters SET money=10000000 WHERE name='購屋測試'").run(); }
    finally { db.close(); }
    const built = await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash",price:1
    });
    assert.equal(built.status,200);
    assert.equal(built.result.houseResult.quote.total,6500000);
    assert.equal(built.result.character.money,3500000);
    assert.equal(built.result.houses.length,1);
    assert.equal(built.result.houses[0].name,"購屋測試的家");
    assert.equal(built.result.map.cells[0].category,"house");
    assert.equal(built.result.map.cells[0].image,"house/kamakura.gif");
    assert.equal((await api(srv.url, "map/tile", {row:0,column:0,symbol:""})).status,400);
    assert.equal((await api(srv.url, "house/build", {
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    })).status,400);
    assert.equal((await api(srv.url, "house/build", {
      row:0,column:1,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    })).status,400);
    const renamed = await api(srv.url,"house/rename",{
      houseId:built.result.houses[0].id,name:"湖畔住宅"
    });
    assert.equal(renamed.status,200);
    assert.equal(renamed.result.map.cells[0].label.includes("湖畔住宅"),true);
    assert.equal((await api(srv.url, "state")).result.character.money,3500000);
  } finally { await srv.stop(); }
});

test("多人：爭購同一塊地時只有一人成功，且房屋資料可以共享、不可竄改", async () => {
  const seed = directory => {
    const db = new DatabaseSync(join(directory, "multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, tiles_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const tiles = Array(192).fill("");
    tiles[0] = "空地";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?, ?,?)")
      .run(0,"京阪神ストリート","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv = await start("multi",seed);
  try {
    const a = await api(srv.url,"register",{username:"housingone",password:"housing-password-one"});
    const b = await api(srv.url,"register",{username:"housingtwo",password:"housing-password-two"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"建屋甲",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"建屋乙",gender:"female",stats:defaultStats()},b.cookie);
    const db = new DatabaseSync(join(srv.directory, "multi.sqlite"));
    try { db.prepare("UPDATE characters SET bank=100000000").run(); } finally { db.close(); }
    const options={row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"};
    const outcomes=await Promise.all([
      api(srv.url,"house/build",options,a.cookie),
      api(srv.url,"house/build",options,b.cookie)
    ]);
    assert.deepEqual(outcomes.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const resultA=await api(srv.url,"state",undefined,a.cookie);
    const resultB=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(resultA.result.townHouses.length,1);
    assert.equal(resultB.result.townHouses.length,1);
    assert.equal(resultA.result.map.cells[0].category,"house");
    assert.equal(resultB.result.map.cells[0].category,"house");
    const owner=resultA.result.townHouses[0];
    const enemyCookie=owner.ownerName==="建屋甲"?b.cookie:a.cookie;
    assert.equal((await api(srv.url,"house/rename",{houseId:owner.id,name:"竄改別人房屋"},enemyCookie)).status,400);
    assert.equal((await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"},enemyCookie)).status,403);
    const dbAfter=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      assert.equal(dbAfter.prepare("SELECT COUNT(*) n FROM houses").get().n,1);
      assert.equal(dbAfter.prepare("SELECT COUNT(*) n FROM characters WHERE bank=100000000-51500000").get().n,1);
      assert.equal(dbAfter.prepare("SELECT COUNT(*) n FROM characters WHERE bank=100000000").get().n,1);
    } finally { dbAfter.close(); }
  } finally { await srv.stop(); }
});


test("單機：出售住宅僅退地價、保留交易紀錄並可重新建屋", async () => {
  const srv = await start("solo");
  try {
    const created = await api(srv.url, "character",
      { name: "搬家居民", gender: "other", stats: defaultStats() });
    assert.equal(created.status, 200);
    await api(srv.url, "move", { townId:3 });
    await api(srv.url, "map/tile", { row:0,column:0,symbol:"空地2" });
    await api(srv.url, "map/tile", { row:0,column:1,symbol:"空地3" });
    const db = new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try { db.prepare("UPDATE characters SET money=20000000 WHERE name='搬家居民'").run(); }
    finally { db.close(); }
    const first = await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(first.status,200);
    assert.equal(first.result.character.money,13500000);
    assert.equal(first.result.houses[0].saleRefund,5000000);
    assert.equal(first.result.houseEvents.length,1);
    assert.equal(first.result.houseEvents[0].action,"built");
    const id=first.result.houses[0].id;
    const sold=await api(srv.url,"house/sell",{houseId:id,refund:999999999});
    assert.equal(sold.status,200);
    assert.equal(sold.result.houseSaleResult.refund,5000000);
    assert.equal(sold.result.character.money,18500000);
    assert.equal(sold.result.map.cells[0].raw,"空地2");
    assert.equal(sold.result.houses.length,0);
    assert.equal(sold.result.houseCatalog.canBuild,true);
    assert.deepEqual(sold.result.houseEvents.map(x=>x.action),["sold","built"]);
    assert.equal((await api(srv.url,"house/sell",{houseId:id})).status,400);
    assert.equal((await api(srv.url,"state")).result.character.money,18500000);
    const second=await api(srv.url,"house/build",{
      row:0,column:1,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(second.status,200);
    assert.equal(second.result.houses.length,1);
    assert.equal(second.result.houses[0].location,"A2");
    assert.notEqual(second.result.houses[0].id,id);
    assert.equal((await api(srv.url,"house/sell",{houseId:id})).status,400);
    assert.equal(second.result.houseEvents.length,3);
    assert.equal(second.result.character.money,12000000);
  } finally { await srv.stop(); }
});

test("多人：非屋主不得出售，兩個同時出售請求只退一次錢並釋放土地", async () => {
  const seed = directory => {
    const db = new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, tiles_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const tiles = Array(192).fill("");
    tiles[0]="空地3";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(3,"和歌山アイランド","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try {
    const a=await api(srv.url,"register",{username:"houseSellerOne",password:"house-seller-password-one"});
    const b=await api(srv.url,"register",{username:"houseBuyerTwo",password:"house-buyer-password-two"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"屋主甲",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"買家乙",gender:"female",stats:defaultStats()},b.cookie);
    await api(srv.url,"move",{townId:3},a.cookie);
    await api(srv.url,"move",{townId:3},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db.prepare("UPDATE characters SET bank=20000000").run();} finally {db.close();}
    const first=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },a.cookie);
    assert.equal(first.status,200);
    const id=first.result.houses[0].id;
    assert.equal((await api(srv.url,"house/sell",{houseId:id},b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/sell",{houseId:id})).status,401);
    const sales=await Promise.all([
      api(srv.url,"house/sell",{houseId:id},a.cookie),
      api(srv.url,"house/sell",{houseId:id},a.cookie)
    ]);
    assert.deepEqual(sales.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const after=await api(srv.url,"state",undefined,a.cookie);
    // 原版車站現在會扣 0→3 的 1,210 元；售屋退款不再假設免費換城。
    assert.equal(after.result.character.money,5100000-1210);
    assert.equal(after.result.character.bank,13500000);
    assert.equal(after.result.map.cells[0].raw,"空地3");
    assert.equal(after.result.townHouses.length,0);
    assert.equal(after.result.houseEvents.filter(x=>x.action==="sold").length,1);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.character.money,100000-1210);
    const repurchased=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },b.cookie);
    assert.equal(repurchased.status,200);
    assert.equal(repurchased.result.townHouses[0].ownerName,"買家乙");
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.houseEvents.length,2);
  } finally { await srv.stop(); }
});


test("單機：房屋室內欄位、留言板與搬家後個人資料保留", async () => {
  const srv = await start("solo");
  try {
    assert.equal((await api(srv.url, "character", {
      name:"室內測試",gender:"other",stats:defaultStats()
    })).status,200);
    await api(srv.url,"move",{townId:3});
    await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"});
    await api(srv.url,"map/tile",{row:0,column:1,symbol:"空地2"});
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {db.prepare("UPDATE characters SET money=20000000 WHERE name='室內測試'").run();}
    finally {db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:1,payment:"cash"
    });
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    const visitRoute="house/visit?houseId="+houseId;
    const initially=await api(srv.url,visitRoute);
    assert.equal(initially.status,200);
    assert.equal(initially.result.capacity,3);
    assert.equal(initially.result.available.length,0);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"第一區"},{type:"3",title:"屋主公告"}]
    })).status,400);
    const setting=await api(srv.url,"house/room/config",{
      houseId,slots:[
        {type:"0",title:"一般留言區"},
        {type:"3",title:"公告區"},
        {type:"2",title:"參考網站",url:"https://example.com/town"}
      ]
    });
    assert.equal(setting.status,200);
    const room=await api(srv.url,visitRoute);
    assert.equal(room.result.available.length,3);
    assert.equal(room.result.selected.type,"0");
    assert.equal(room.result.owner,true);
    const posted=await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"我的第一篇室內留言"
    });
    assert.equal(posted.status,200);
    const announcement=await api(srv.url,"house/room/post",{
      houseId,slotIndex:1,body:"屋主新公告"
    });
    assert.equal(announcement.status,200);
    assert.equal((await api(srv.url,visitRoute)).result.posts[0].body,"我的第一篇室內留言");
    assert.equal((await api(srv.url,visitRoute+"&slot=1")).result.posts[0].body,"屋主新公告");
    assert.equal((await api(srv.url,visitRoute+"&slot=2")).result.selected.url,"https://example.com/town");
    const sold=await api(srv.url,"house/sell",{houseId});
    assert.equal(sold.status,200);
    assert.equal((await api(srv.url,visitRoute)).status,400);
    const second=await api(srv.url,"house/build",{
      row:0,column:1,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(second.status,200);
    const newId=second.result.houses[0].id;
    const moved=await api(srv.url,"house/visit?houseId="+newId);
    assert.equal(moved.status,200);
    assert.equal(moved.result.capacity,1);
    assert.deepEqual(moved.result.available.map(s=>s.title),["一般留言區"]);
    assert.equal(moved.result.posts[0].body,"我的第一篇室內留言");
  } finally {await srv.stop();}
});

test("多人：訪客可留言但不可改設定，屋主公告與自訂網址受權限限制", async () => {
  const seed=directory => {
    const db=new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,original_name TEXT NOT NULL DEFAULT '',original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    const tiles=Array(192).fill("");
    tiles[0]="空地";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(3,"和歌山アイランド","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try {
    const a=await api(srv.url,"register",{username:"roomOwner",password:"good-long-room-password1"});
    const b=await api(srv.url,"register",{username:"roomVisitor",password:"good-long-room-password2"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"房主玩家",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"參觀玩家",gender:"female",stats:defaultStats()},b.cookie);
    await api(srv.url,"move",{townId:3},a.cookie);
    await api(srv.url,"move",{townId:3},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try { db.prepare("UPDATE characters SET bank=20000000").run(); }
    finally {db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },a.cookie);
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    const visit="house/visit?houseId="+houseId;
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"偽造"}]
    },b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"大家留言"}]
    },a.cookie)).status,200);
    const guest=await api(srv.url,visit,undefined,b.cookie);
    assert.equal(guest.status,200);
    assert.equal(guest.result.owner,false);
    assert.equal(guest.result.editableSlots,null);
    assert.equal(guest.result.canPost,true);
    const post=await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"訪客的留言"
    },b.cookie);
    assert.equal(post.status,200);
    assert.equal((await api(srv.url,visit,undefined,a.cookie)).result.posts[0].body,"訪客的留言");
    const visitorPostId=(await api(srv.url,visit,undefined,b.cookie)).result.posts[0].id;
    assert.equal((await api(srv.url,"house/room/delete",{
      houseId,postId:visitorPostId
    },b.cookie)).status,200);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"3",title:"屋主公告"}]
    },a.cookie)).status,200);
    const readOnly=await api(srv.url,visit,undefined,b.cookie);
    assert.equal(readOnly.result.canPost,false);
    assert.equal(readOnly.result.posts.length,0);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"訪客越權公告"
    },b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"正式公告"
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).result.posts[0].body,"正式公告");
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"1",title:"商店"}]
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"2",title:"偽連結",url:"javascript:alert(1)"}]
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"2",title:"外部網站",url:"https://example.org/"}]
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).result.selected.url,"https://example.org/");
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"不允許留言"
    },b.cookie)).status,400);
    await api(srv.url,"move",{townId:0},b.cookie);
    assert.equal((await api(srv.url,visit,undefined,b.cookie)).status,400);
    assert.equal((await api(srv.url,visit)).status,401);
  } finally { await srv.stop(); }
});


test("單機：改裝保留住宅位置與留言，室內降級隱藏額外欄位，升級後恢復", async () => {
  const srv=await start("solo");
  try {
    await api(srv.url,"character",{name:"改裝玩家",gender:"other",stats:defaultStats()});
    await api(srv.url,"move",{townId:3});
    await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"});
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {db.prepare("UPDATE characters SET money=90000000 WHERE name='改裝玩家'").run();}
    finally {db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"常用留言"}]
    })).status,200);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"改裝前留言"
    })).status,200);
    const improved=await api(srv.url,"house/remodel",{
      houseId,image:"house/house_1.gif",interiorRank:0,total:1,payment:"bank"
    });
    assert.equal(improved.status,200);
    assert.equal(improved.result.houseRemodelResult.quote.total,13600000);
    assert.equal(improved.result.houses[0].image,"house/house_1.gif");
    assert.equal(improved.result.houses[0].interiorRank,0);
    assert.equal(improved.result.character.money,90000000-6500000-13600000);
    assert.equal(improved.result.map.cells[0].image,"house/house_1.gif");
    assert.equal(improved.result.map.cells[0].raw,"webhouse_"+houseId+"=空地");
    assert.equal(improved.result.houseRemodelEvents[0].amount,13600000);
    assert.equal(improved.result.houses[0].purchasePrice,6500000);
    const first=await api(srv.url,"house/visit?houseId="+houseId);
    assert.equal(first.result.capacity,4);
    assert.equal(first.result.posts[0].body,"改裝前留言");
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[
        {type:"0",title:"常用留言"},
        {type:"3",title:"公告區"},
        {type:"2",title:"房屋網站",url:"https://example.com/"},
        {type:"0",title:"第四區"}
      ]
    })).status,200);
    const reduced=await api(srv.url,"house/remodel",{
      houseId,image:null,interiorRank:3
    });
    assert.equal(reduced.status,200);
    assert.equal(reduced.result.houseRemodelResult.quote.total,1000000);
    assert.equal(reduced.result.houses[0].interiorRank,3);
    const one=await api(srv.url,"house/visit?houseId="+houseId);
    assert.equal(one.result.capacity,1);
    assert.equal(one.result.available.length,1);
    assert.equal((await api(srv.url,"house/visit?houseId="+houseId+"&slot=2")).status,400);
    const again=await api(srv.url,"house/remodel",{
      houseId,image:null,interiorRank:0
    });
    assert.equal(again.status,200);
    const restored=await api(srv.url,"house/visit?houseId="+houseId+"&slot=2");
    assert.equal(restored.status,200);
    assert.equal(restored.result.selected.title,"房屋網站");
    assert.equal(restored.result.selected.url,"https://example.com/");
    const firstAgain=await api(srv.url,"house/visit?houseId="+houseId+"&slot=0");
    assert.equal(firstAgain.result.posts[0].body,"改裝前留言");
    assert.equal(again.result.houseRemodelEvents.length,3);
  } finally {await srv.stop();}
});

test("多人：非屋主無法改裝，同時改裝依伺服器餘額只扣一次", async () => {
  const seed=directory => {
    const db=new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY, original_name TEXT NOT NULL DEFAULT '', original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    const tiles=Array(192).fill("");
    tiles[0]="空地";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
      .run(3,"和歌山アイランド","legacy-import",JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try {
    const a=await api(srv.url,"register",{username:"remodelOwner",password:"secure-remodel-owner"});
    const b=await api(srv.url,"register",{username:"remodelGuest",password:"secure-remodel-guest"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"房主",gender:"other",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"其他居民",gender:"other",stats:defaultStats()},b.cookie);
    await api(srv.url,"move",{townId:3},a.cookie);
    await api(srv.url,"move",{townId:3},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db.prepare("UPDATE characters SET bank=10000000").run();}
    finally {db.close();}
    const house=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },a.cookie);
    assert.equal(house.status,200);
    const houseId=house.result.houses[0].id;
    const db2=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db2.prepare("UPDATE characters SET money=2000000 WHERE name='房主'").run();}
    finally {db2.close();}
    const options={houseId,image:"house/house_1.gif",interiorRank:null,price:1};
    assert.equal((await api(srv.url,"house/remodel",options,b.cookie)).status,400);
    assert.equal((await api(srv.url,"house/remodel",{...options,interiorRank:99},a.cookie)).status,400);
    const result=await Promise.all([
      api(srv.url,"house/remodel",options,a.cookie),
      api(srv.url,"house/remodel",options,a.cookie)
    ]);
    assert.deepEqual(result.map(r=>r.status).sort((x,y)=>x-y),[200,400]);
    const stateA=await api(srv.url,"state",undefined,a.cookie);
    const stateB=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(stateA.result.character.money,400000);
    assert.equal(stateA.result.character.bank,3500000);
    assert.equal(stateA.result.houseRemodelEvents.length,1);
    assert.equal(stateB.result.houseRemodelEvents.length,0);
    assert.equal(stateA.result.townHouses[0].image,"house/house_1.gif");
    assert.equal(stateB.result.map.cells[0].image,"house/house_1.gif");
    assert.equal((await api(srv.url,"house/remodel",{houseId,image:null,interiorRank:null},a.cookie)).status,400);
    assert.equal((await api(srv.url,"house/remodel",options)).status,401);
    assert.equal((await api(srv.url,"house/remodel",{...options,houseId:999},a.cookie)).status,400);
  } finally {await srv.stop();}
});


test("單機：普通與定期存款每日計息一次，帳簿記錄與全額解約均能持久化", async () => {
  const srv=await start("solo");
  try {
    const created=await api(srv.url,"character",{
      name:"銀行測試居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.bankAccount.termBalance,0);
    assert.equal(created.result.bankLedger.length,0);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      db.prepare("UPDATE characters SET money=5000000,bank=2000000 WHERE name='銀行測試居民'").run();
      db.prepare("UPDATE bank_accounts SET term_balance=3000000,last_interest_day='2025-01-01'").run();
    } finally {db.close();}
    const first=await api(srv.url,"state");
    assert.equal(first.status,200);
    assert.equal(first.result.character.bank,2010000);
    assert.equal(first.result.bankAccount.termBalance,3030000);
    assert.deepEqual(first.result.bankLedger.map(x=>[x.action,x.credit]),[
      ["超級定期利息",30000],["普通存款利息",10000]
    ]);
    const second=await api(srv.url,"state");
    assert.equal(second.result.character.bank,2010000);
    assert.equal(second.result.bankAccount.termBalance,3030000);
    assert.equal(second.result.bankLedger.length,2);
    assert.equal((await api(srv.url,"bank/term",{action:"deposit",units:0.5})).status,400);
    assert.equal((await api(srv.url,"bank/term",{action:"deposit",units:10})).status,400);
    const deposit=await api(srv.url,"bank/term",{action:"deposit",units:2});
    assert.equal(deposit.status,200);
    assert.equal(deposit.result.character.money,3000000);
    assert.equal(deposit.result.bankAccount.termBalance,5030000);
    assert.equal(deposit.result.bankLedger[0].credit,2000000);
    assert.equal((await api(srv.url,"bank/term",{action:"cancel",amount:1})).status,400);
    const canceled=await api(srv.url,"bank/term",{action:"cancel"});
    assert.equal(canceled.status,200);
    assert.equal(canceled.result.character.money,8030000);
    assert.equal(canceled.result.bankAccount.termBalance,0);
    assert.equal(canceled.result.bankLedger[0].debit,5030000);
    assert.equal((await api(srv.url,"bank/term",{action:"cancel"})).status,400);
    const ordinary=await api(srv.url,"bank",{action:"deposit",amount:1000000});
    assert.equal(ordinary.status,200);
    assert.equal(ordinary.result.character.money,7030000);
    assert.equal(ordinary.result.character.bank,3010000);
    assert.equal(ordinary.result.bankLedger[0].type,"ordinary");
    assert.equal(ordinary.result.bankLedger[0].balance,3010000);
    const latest=await api(srv.url,"state");
    assert.equal(latest.result.bankLedger.length,5);
    assert.equal(latest.result.bankAccount.termBalance,0);
    assert.equal(latest.result.character.money,7030000);
  } finally {await srv.stop();}
});

test("多人：普通帳戶與定期獨立保存，同一帳號並行請求不能超額扣款或重複解約",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{
      username:"bankAccountOwner",password:"bank-account-owner-pass"
    });
    const b=await api(srv.url,"register",{
      username:"bankAccountGuest",password:"bank-account-guest-pass"
    });
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"帳戶甲",gender:"male",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"帳戶乙",gender:"female",stats:defaultStats()
    },b.cookie)).status,200);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      db.prepare("UPDATE characters SET money=5000000,bank=1000000 WHERE name='帳戶甲'").run();
    } finally {db.close();}
    const option={action:"deposit",units:4};
    const two=await Promise.all([
      api(srv.url,"bank/term",option,a.cookie),
      api(srv.url,"bank/term",option,a.cookie)
    ]);
    assert.deepEqual(two.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const owner=await api(srv.url,"state",undefined,a.cookie);
    const guest=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(owner.result.character.money,1000000);
    assert.equal(owner.result.bankAccount.termBalance,4000000);
    assert.equal(owner.result.bankLedger.length,1);
    assert.equal(guest.result.bankAccount.termBalance,0);
    assert.equal(guest.result.bankLedger.length,0);
    const canceled=await Promise.all([
      api(srv.url,"bank/term",{action:"cancel"},a.cookie),
      api(srv.url,"bank/term",{action:"cancel"},a.cookie)
    ]);
    assert.deepEqual(canceled.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const after=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(after.result.character.money,5000000);
    assert.equal(after.result.bankAccount.termBalance,0);
    assert.equal(after.result.bankLedger.length,2);
    const withdrawals=await Promise.all([
      api(srv.url,"bank",{action:"withdraw",amount:750000},a.cookie),
      api(srv.url,"bank",{action:"withdraw",amount:750000},a.cookie)
    ]);
    assert.deepEqual(withdrawals.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const end=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(end.result.character.bank,250000);
    assert.equal(end.result.character.money,5750000);
    assert.equal(end.result.bankLedger.length,3);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.bankLedger.length,0);
    assert.equal((await api(srv.url,"bank/term",{action:"deposit",units:1})).status,401);
  } finally {await srv.stop();}
});


test("單機：玩家間銀行轉帳不可用，原有單機銀行功能不受影響", async () => {
  const srv=await start("solo");
  try {
    await api(srv.url,"character",{name:"單機銀行玩家",gender:"other",stats:defaultStats()});
    const result=await api(srv.url,"bank/transfer",{
      recipientName:"其他角色",amount:100,requestId:"transfer-solo-attempt-0001"
    });
    assert.equal(result.status,403);
    assert.equal((await api(srv.url,"state")).result.bankTransferRules,null);
    assert.equal((await api(srv.url,"bank",{action:"deposit",amount:1000})).status,200);
    assert.equal((await api(srv.url,"state")).result.character.bank,1000);
  } finally {await srv.stop();}
});

test("多人：收款角色名稱轉帳、匯款雙方帳簿與重複請求的安全性", async () => {
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{
      username:"senderPlayerAccount",password:"sender-password-safe-123"
    });
    const b=await api(srv.url,"register",{
      username:"receiverPlayerAccount",password:"receiver-password-safe-123"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"匯款居民甲",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"收款居民乙",gender:"female",stats:defaultStats()},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      db.prepare("UPDATE characters SET bank=5000000 WHERE name='匯款居民甲'").run();
      db.prepare("UPDATE characters SET created_at=? WHERE name='收款居民乙'")
        .run(Date.now()-8*86400000);
    } finally {db.close();}
    const request={
      recipientName:"收款居民乙",amount:1250000,requestId:"transfer-http-001-2026"
    };
    assert.equal((await api(srv.url,"bank/transfer",request)).status,401);
    assert.equal((await api(srv.url,"bank/transfer",{
      ...request,recipientName:"匯款居民甲"
    },a.cookie)).status,400);
    const done=await api(srv.url,"bank/transfer",request,a.cookie);
    assert.equal(done.status,200);
    assert.equal(done.result.transferResult.amount,1250000);
    assert.equal(done.result.transferResult.duplicate,false);
    assert.equal(done.result.character.bank,3750000);
    assert.equal(done.result.bankLedger[0].debit,1250000);
    assert.equal(done.result.bankLedger[0].action,"轉帳給：收款居民乙");
    const receiver=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(receiver.result.character.bank,1250000);
    assert.equal(receiver.result.bankLedger[0].credit,1250000);
    assert.equal(receiver.result.bankLedger[0].action,"收到轉帳：匯款居民甲");
    const replay=await api(srv.url,"bank/transfer",request,a.cookie);
    assert.equal(replay.status,200);
    assert.equal(replay.result.transferResult.duplicate,true);
    assert.equal(replay.result.character.bank,3750000);
    assert.equal(replay.result.bankLedger.length,1);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.bankLedger.length,1);
    assert.equal((await api(srv.url,"bank/transfer",{
      ...request,amount:100
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"bank/transfer",{
      ...request,recipientName:"不存在的人",requestId:"transfer-http-002-2026"
    },a.cookie)).status,400);
    const finalDb=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      assert.equal(finalDb.prepare("SELECT COUNT(*) AS n FROM bank_transfers").get().n,1);
      assert.equal(finalDb.prepare("SELECT SUM(amount) AS total FROM bank_transfers").get().total,1250000);
    } finally {finalDb.close();}
  } finally {await srv.stop();}
});

test("多人：新註冊收款人與並行轉帳的金額安全限制",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{username:"transferSender",password:"strong-sender-pass-123"});
    const b=await api(srv.url,"register",{username:"transferNewRecipient",password:"strong-receiver-pass-123"});
    await api(srv.url,"character",{name:"付款玩家",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"新加入玩家",gender:"female",stats:defaultStats()},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {db.prepare("UPDATE characters SET bank=1000000 WHERE name='付款玩家'").run();}
    finally {db.close();}
    assert.equal((await api(srv.url,"bank/transfer",{
      recipientName:"新加入玩家",amount:1000000,requestId:"transfer-new-user-0001"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.character.bank,1000000);
    const outcome=await Promise.all([
      api(srv.url,"bank/transfer",{
        recipientName:"新加入玩家",amount:800000,requestId:"transfer-concurrent-0001"
      },a.cookie),
      api(srv.url,"bank/transfer",{
        recipientName:"新加入玩家",amount:800000,requestId:"transfer-concurrent-0002"
      },a.cookie)
    ]);
    assert.deepEqual(outcome.map(x=>x.status).sort((x,y)=>x-y),[200,400]);
    const sender=await api(srv.url,"state",undefined,a.cookie);
    const receiver=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(sender.result.character.bank,200000);
    assert.equal(receiver.result.character.bank,800000);
    assert.equal(sender.result.bankLedger.length,1);
    assert.equal(receiver.result.bankLedger.length,1);
    assert.equal(sender.result.bankTransferRules.maxAmount,1000000000000);
    assert.equal(sender.result.bankTransferRules.newMemberDays,7);
    assert.equal(sender.result.bankTransferRules.newMemberMaxExclusive,1000000);
    const saved=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {assert.equal(saved.prepare("SELECT COUNT(*) AS n FROM bank_transfers").get().n,1);}
    finally {saved.close();}
  } finally {await srv.stop();}
});


test("原版角色匯入後可用全新多人帳號密碼登入，資產與能力維持，原版密碼不被沿用",async()=>{
  const srv=await start("multi");
  try{
    const original=Array(LEGACY_CHARACTER_FIELDS.length).fill("");
    const properties={
      k_id:"00880",name:"舊版居民",pass:"UNSAFE_OLD_CGI_PASSWORD",
      money:"350000",bank:"1200000",job:"日払いバイト",
      first_access:"1710000000",sex:"m",super_teiki:"2000000",
      sintyou:"180",taijuu:"75",energy:"30",nou_energy:"30",
      job_keiken:"200",job_kaisuu:"3"
    };
    for(const key of [
      "kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu",
      "looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku",
      "love","unique","etti"
    ])properties[key]="20";
    for(const [key,value]of Object.entries(properties))
      original[LEGACY_CHARACTER_FIELDS.indexOf(key)]=value;
    const path=join(srv.directory,"legacy-sample.cgi");
    writeFileSync(path,original.join("<>")+"<>\n");
    const imported=spawnSync(process.execPath,[
      "scripts/legacy-character.mjs","--file",path,"--mode","multi",
      "--username","restoredplayer","--apply","--accept-partial"
    ],{
      cwd:root,encoding:"utf8",
      env:{...process.env,DATA_DIR:srv.directory,TOWN_IMPORT_PASSWORD:"separate-modern-password"}
    });
    assert.equal(imported.status,0,imported.stderr);
    assert.doesNotMatch(imported.stdout,/UNSAFE_OLD_CGI_PASSWORD/);
    const old=await api(srv.url,"login",{username:"restoredplayer",password:"UNSAFE_OLD_CGI_PASSWORD"});
    assert.equal(old.status,401);
    const login=await api(srv.url,"login",{username:"restoredplayer",password:"separate-modern-password"});
    assert.equal(login.status,200);
    const profile=await api(srv.url,"state",undefined,login.cookie);
    assert.equal(profile.status,200);
    assert.equal(profile.result.character.name,"舊版居民");
    assert.equal(profile.result.character.money,350000);
    assert.equal(profile.result.character.bank,1200000);
    assert.equal(profile.result.character.stats.kokugo,20);
    assert.equal(profile.result.character.jobExperience,200);
    assert.equal(profile.result.bankAccount.termBalance,2000000);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const row=db.prepare("SELECT * FROM legacy_character_imports WHERE original_id='00880'").get();
      assert.ok(row);
      assert.equal(row.original_name,"舊版居民");
      assert.equal(row.unmapped_json.includes("UNSAFE_OLD_CGI_PASSWORD"),false);
    }finally{db.close();}
    const again=spawnSync(process.execPath,[
      "scripts/legacy-character.mjs","--file",path,"--mode","multi",
      "--username","anotherrestored","--apply","--accept-partial"
    ],{cwd:root,encoding:"utf8",
      env:{...process.env,DATA_DIR:srv.directory,TOWN_IMPORT_PASSWORD:"another-modern-password"}});
    assert.notEqual(again.status,0);
    assert.match(again.stderr,/已匯入/);
  }finally{await srv.stop();}
});


test("多人銀行貸款：試算、撥款、每日扣款、禁止重複借款及一次清償",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{username:"loanBorrowerA",password:"loan-borrower-pass-123"});
    const b=await api(srv.url,"register",{username:"loanObserverB",password:"loan-observer-pass-123"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"貸款玩家",gender:"male",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"旁觀居民",gender:"female",stats:defaultStats()
    },b.cookie)).status,200);
    const database=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {database.prepare("UPDATE characters SET bank=2000000 WHERE name='貸款玩家'").run();}
    finally {database.close();}
    const before=await api(srv.url,"state",undefined,a.cookie);
    const credit=before.result.bankLoan.maxPrincipal;
    assert.equal(credit,4000000);
    assert.equal(before.result.bankLoan.active,false);
    assert.equal(before.result.bankLoan.plans.length,10);
    assert.equal((await api(srv.url,"bank/loan/borrow",{payments:13},a.cookie)).status,400);
    assert.equal((await api(srv.url,"bank/loan/borrow",{payments:12})).status,401);
    const loan=await api(srv.url,"bank/loan/borrow",{payments:12},a.cookie);
    assert.equal(loan.status,200);
    assert.equal(loan.result.loanResult.principal,credit);
    assert.equal(loan.result.loanResult.dailyPayment,350000);
    assert.equal(loan.result.character.bank,6000000);
    assert.equal(loan.result.bankLoan.remainingPayments,12);
    assert.equal(loan.result.bankLedger[0].action,"住宅貸款撥款");
    assert.equal((await api(srv.url,"bank/loan/borrow",{payments:24},a.cookie)).status,400);
    const other=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(other.result.bankLoan.active,false);
    assert.equal(other.result.bankLedger.length,0);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      db.prepare("UPDATE bank_accounts SET last_interest_day='2026-11-17' WHERE user_id=(SELECT user_id FROM characters WHERE name='貸款玩家')").run();
      db.prepare("UPDATE bank_loans SET last_attempt_day='2026-11-17' WHERE user_id=(SELECT user_id FROM characters WHERE name='貸款玩家')").run();
    } finally {db.close();}
    const next=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(next.status,200);
    assert.equal(next.result.character.bank,5680000);
    assert.equal(next.result.bankLoan.remainingPayments,11);
    assert.equal(next.result.bankLedger[0].action,"住宅貸款每日還款");
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.character.bank,5680000);
    const payoff=await api(srv.url,"bank/loan/payoff",{},a.cookie);
    assert.equal(payoff.status,200);
    assert.equal(payoff.result.loanResult.paid,3850000);
    assert.equal(payoff.result.character.bank,1830000);
    assert.equal(payoff.result.bankLoan.active,false);
    assert.equal(payoff.result.bankLedger[0].action,"住宅貸款一次清償");
    assert.equal((await api(srv.url,"bank/loan/payoff",{},a.cookie)).status,400);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.character.bank,0);
  }finally{await srv.stop();}
});


test("單機：原版食堂資料、用餐費用、飽足狀態與 60 分鐘限制完整串接",async()=>{
  const srv=await start("solo");
  try {
    const created=await api(srv.url,"character",{
      name:"用餐玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.hunger.key,"untracked");
    assert.equal(created.result.condition.key,"normal");
    assert.equal(created.result.condition.provisional,true);
    assert.equal(created.result.mealCooldownMs,0);
    const main=created.result.meals.filter(x=>x.menu==="main");
    const other=created.result.meals.filter(x=>x.menu==="second");
    assert.ok(main.length>0);
    assert.ok(other.length>0);
    const chosen=main.find(x=>x.price>0&&x.price<100000);
    assert.ok(chosen);
    const before=created.result.character;
    const response=await api(srv.url,"meal/eat",{key:chosen.key});
    assert.equal(response.status,200);
    assert.equal(response.result.mealResult.paid,chosen.price);
    assert.equal(response.result.mealResult.weightGain,chosen.calories/1000);
    assert.equal(response.result.character.money,before.money-chosen.price);
    assert.equal(response.result.character.stats.kenkou,
      before.stats.kenkou+(chosen.gains.kenkou??0));
    assert.ok(response.result.character.lastMealAt>0);
    assert.equal(response.result.hunger.key,"full");
    assert.ok(response.result.mealCooldownMs>0);
    assert.equal(response.result.condition.provisional,false);
    assert.equal((await api(srv.url,"meal/eat",{key:chosen.key})).status,400);
    assert.equal((await api(srv.url,"meal/eat",{key:"meal-invalid-999"})).status,404);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      db.prepare("UPDATE characters SET last_meal_at=? WHERE name='用餐玩家'")
        .run(Date.now()-13*3600000);
    } finally {db.close();}
    const hungry=await api(srv.url,"state");
    assert.equal(hungry.status,200);
    assert.equal(hungry.result.hunger.key,"hungry");
    assert.equal(hungry.result.mealCooldownMs,0);
    const second=await api(srv.url,"meal/eat",{key:other[0].key});
    assert.equal(second.status,200);
    assert.equal(second.result.hunger.key,"full");
    assert.equal(second.result.character.money,
      before.money-chosen.price-other[0].price);
    const preserved=await api(srv.url,"state");
    assert.equal(preserved.result.character.lastMealAt,second.result.character.lastMealAt);
    assert.equal(preserved.result.hunger.key,"full");
  } finally {await srv.stop();}
});

test("多人：各玩家用餐冷卻與費用分開保存，不能改動其他玩家狀態",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{username:"mealPersonOne",password:"meal-owner-password-123"});
    const b=await api(srv.url,"register",{username:"mealPersonTwo",password:"meal-other-password-123"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{name:"第一位食客",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"第二位食客",gender:"female",stats:defaultStats()},b.cookie);
    const aState=await api(srv.url,"state",undefined,a.cookie);
    const bState=await api(srv.url,"state",undefined,b.cookie);
    const meal=aState.result.meals.find(x=>x.menu==="main"&&x.price<100000);
    assert.ok(meal);
    const eaten=await api(srv.url,"meal/eat",{key:meal.key},a.cookie);
    assert.equal(eaten.status,200);
    assert.equal((await api(srv.url,"meal/eat",{key:meal.key},a.cookie)).status,400);
    const untouched=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(untouched.result.character.money,bState.result.character.money);
    assert.equal(untouched.result.hunger.key,"untracked");
    const other=await api(srv.url,"meal/eat",{key:meal.key},b.cookie);
    assert.equal(other.status,200);
    assert.equal(other.result.hunger.key,"full");
    assert.equal((await api(srv.url,"meal/eat",{key:meal.key})).status,401);
    const savedDb=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      const saved=savedDb.prepare(
        "SELECT name,last_meal_at,money FROM characters ORDER BY name"
      ).all();
      assert.equal(saved.length,2);
      assert.ok(saved.every(r=>r.last_meal_at>0));
      assert.ok(saved.every(r=>r.money===100000-meal.price));
    } finally {savedDb.close();}
  } finally {await srv.stop();}
});


test("單機：食堂每日兩家各 30 道、共用庫存扣減／不可買下架品、快轉隔日重抽",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"每日菜單居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const first=created.result;
    const main=first.meals.filter(x=>x.menu==="main");
    const second=first.meals.filter(x=>x.menu==="second");
    assert.equal(main.length,30);
    assert.equal(second.length,30);
    assert.ok(first.mealMenuDay);
    assert.ok(first.meals.every(x=>Number.isSafeInteger(x.stock)&&x.stock>0));
    const chosen=main[0];
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      assert.equal(db.prepare("SELECT COUNT(*) AS total FROM dining_stock").get().total,60);
      db.prepare("UPDATE dining_stock SET remaining=1 WHERE meal_key=?").run(chosen.key);
    }finally{db.close();}
    const before=await api(srv.url,"state");
    assert.equal(before.result.meals.find(x=>x.key===chosen.key).stock,1);
    const meal=await api(srv.url,"meal/eat",{key:chosen.key});
    assert.equal(meal.status,200);
    assert.equal(meal.result.mealResult.remaining,0);
    assert.equal(meal.result.character.money,first.character.money-chosen.price);
    assert.equal(meal.result.meals.find(x=>x.key===chosen.key).stock,0);
    assert.match(meal.result.meals.find(x=>x.key===chosen.key).reason,/售完/);
    const stockDb=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const row=stockDb.prepare("SELECT remaining FROM dining_stock WHERE meal_key=?").get(chosen.key);
      assert.equal(row.remaining,0);
      // 25 道以下原版重新進貨：5 道缺貨、留下 25 道時刷新兩間。
      stockDb.prepare("UPDATE dining_stock SET remaining=0 WHERE menu='main' AND position<5").run();
    }finally{stockDb.close();}
    const refreshed=await api(srv.url,"state");
    assert.equal(refreshed.status,200);
    assert.equal(refreshed.result.meals.length,60);
    assert.ok(refreshed.result.meals.every(x=>x.stock>0));
    const oldDay=refreshed.result.mealMenuDay;
    const advanced=await api(srv.url,"solo/time/advance",{preset:"1d"});
    assert.equal(advanced.status,200);
    assert.notEqual(advanced.result.mealMenuDay,oldDay);
    assert.equal(advanced.result.meals.length,60);
    assert.ok(advanced.result.meals.every(x=>x.stock>0));
  }finally{await srv.stop();}
});

test("多人：兩間食堂與商品份數全玩家共用，售完不能超賣、現金不會被錯扣",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{username:"stock_owner_a",password:"long-sample-password-abc"});
    const b=await api(srv.url,"register",{username:"stock_owner_b",password:"long-sample-password-xyz"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    const first=await api(srv.url,"character",{
      name:"庫存玩家甲",gender:"male",stats:defaultStats()
    },a.cookie);
    const second=await api(srv.url,"character",{
      name:"庫存玩家乙",gender:"female",stats:defaultStats()
    },b.cookie);
    assert.equal(first.status,200);assert.equal(second.status,200);
    assert.deepEqual(first.result.meals.map(x=>x.key),second.result.meals.map(x=>x.key));
    const chosen=first.result.meals.find(x=>x.menu==="main");
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      db.prepare("UPDATE dining_stock SET remaining=1 WHERE meal_key=?").run(chosen.key);
    }finally{db.close();}
    const buyer=await api(srv.url,"meal/eat",{key:chosen.key},a.cookie);
    assert.equal(buyer.status,200);
    assert.equal(buyer.result.mealResult.remaining,0);
    const guest=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(guest.result.meals.find(x=>x.key===chosen.key).stock,0);
    assert.equal(guest.result.meals.find(x=>x.key===chosen.key).reason,"今日已售完");
    const attempted=await api(srv.url,"meal/eat",{key:chosen.key},b.cookie);
    assert.equal(attempted.status,400);
    assert.match(attempted.result.error,/售完|菜單/);
    const after=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(after.result.character.money,second.result.character.money);
    assert.equal(after.result.character.lastMealAt,0);
    const verify=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      assert.equal(verify.prepare("SELECT remaining FROM dining_stock WHERE meal_key=?").get(chosen.key).remaining,0);
      assert.equal(verify.prepare("SELECT COUNT(*) AS n FROM dining_stock").get().n,60);
    }finally{verify.close();}
  }finally{await srv.stop();}
});

test("單機：疾病指數顯示、腦瘤收費、病中不可工作及治療保存",async()=>{
  const srv=await start("solo");
  try {
    const made=await api(srv.url,"character",{
      name:"住院測試居民",gender:"other",stats:defaultStats()
    });
    assert.equal(made.status,200);
    assert.equal(made.result.health.index,50);
    assert.equal(made.result.hospital.price,10000);
    assert.ok(made.result.health.lastSettledDay);
    const day=made.result.health.lastSettledDay;
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      db.prepare("UPDATE characters SET health_index=-71,last_health_day=? WHERE name='住院測試居民'")
        .run(day);
    } finally {db.close();}
    const sick=await api(srv.url,"state");
    assert.equal(sick.result.health.key,"brainTumor");
    assert.equal(sick.result.condition.label,"腦瘤");
    assert.equal(sick.result.condition.baseExperience,null);
    assert.equal(sick.result.hospital.price,64000);
    assert.equal((await api(srv.url,"work",{})).status,400);
    const cured=await api(srv.url,"hospital/treat",{});
    assert.equal(cured.status,200);
    assert.equal(cured.result.hospitalResult.paid,64000);
    assert.equal(cured.result.hospitalResult.previousDisease,"腦瘤");
    assert.equal(cured.result.character.money,36000);
    assert.equal(cured.result.character.healthIndex,50);
    assert.equal(cured.result.health.key,"healthy");
    assert.equal(cured.result.hospital.price,10000);
    const reload=await api(srv.url,"state");
    assert.equal(reload.result.health.index,50);
    assert.equal(reload.result.character.money,36000);
    const precaution=await api(srv.url,"hospital/treat",{insured:true,discount:1});
    assert.equal(precaution.status,200);
    assert.equal(precaution.result.hospitalResult.paid,10000);
    assert.equal(precaution.result.character.money,26000);
    const db2=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      db2.prepare("UPDATE characters SET health_index=-101,money=100 WHERE name='住院測試居民'").run();
    } finally {db2.close();}
    assert.equal((await api(srv.url,"hospital/treat",{})).status,400);
    const unchanged=await api(srv.url,"state");
    assert.equal(unchanged.result.health.key,"cancer");
    assert.equal(unchanged.result.character.money,100);
  } finally {await srv.stop();}
});

test("多人：醫療費由當前帳號自行負擔，生病玩家與健康玩家資料互不干擾",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{username:"hospitalPlayerA",password:"secure-hospital-player-A"});
    const b=await api(srv.url,"register",{username:"hospitalPlayerB",password:"secure-hospital-player-B"});
    assert.equal(a.status,200); assert.equal(b.status,200);
    await api(srv.url,"character",{name:"病患甲",gender:"male",stats:defaultStats()},a.cookie);
    await api(srv.url,"character",{name:"病患乙",gender:"female",stats:defaultStats()},b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      db.prepare("UPDATE characters SET health_index=-41 WHERE name='病患甲'").run();
    } finally {db.close();}
    const sick=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(sick.result.hospital.disease.key,"tuberculosis");
    assert.equal(sick.result.hospital.price,48000);
    const healthy=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(healthy.result.hospital.price,10000);
    assert.equal((await api(srv.url,"hospital/treat",{})).status,401);
    const second=await api(srv.url,"hospital/treat",{},b.cookie);
    assert.equal(second.status,200);
    assert.equal(second.result.character.money,90000);
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.health.key,"tuberculosis");
    const first=await api(srv.url,"hospital/treat",{},a.cookie);
    assert.equal(first.status,200);
    assert.equal(first.result.character.money,52000);
    assert.equal(first.result.health.key,"healthy");
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.character.money,90000);
  } finally {await srv.stop();}
});


test("疾病跨日結算：首次建基準、每日僅一次且完整保存於原有角色表",async()=>{
  const srv=await start("solo");
  try {
    const created=await api(srv.url,"character",{
      name:"跨日健康居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.health.index,50);
    assert.ok(created.result.health.lastSettledDay);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      db.prepare(
        "UPDATE characters SET health_index=-1,last_health_day='2025-01-01',last_meal_at=? WHERE name='跨日健康居民'"
      ).run(Date.now()-2*3600000);
    } finally {db.close();}
    const settled=await api(srv.url,"state");
    assert.equal(settled.status,200);
    assert.equal(settled.result.health.index,1);
    assert.equal(settled.result.health.key,"healthy");
    assert.equal(settled.result.health.lastSettledDay,created.result.health.lastSettledDay);
    assert.equal((await api(srv.url,"state")).result.health.index,1);
    assert.equal((await api(srv.url,"state")).result.health.index,1);
    const saved=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      const row=saved.prepare("SELECT health_index,last_health_day,last_meal_at FROM characters WHERE name='跨日健康居民'").get();
      assert.equal(row.health_index,1);
      assert.equal(row.last_health_day,created.result.health.lastSettledDay);
      assert.ok(row.last_meal_at>0);
    } finally {saved.close();}
  } finally {await srv.stop();}
});


test("單機：原版疾病事件每日最多抽選一次，舊角色首日不追補，重整不會重複抽",async()=>{
  const srv=await start("solo");
  try {
    const created=await api(srv.url,"character",{
      name:"隨機事件測試",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.character.lastEventDay,created.result.health.lastSettledDay);
    assert.deepEqual(created.result.healthEvents,[]);
    const day=created.result.character.lastEventDay;
    const database=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      database.prepare("UPDATE characters SET last_event_day='2025-01-01',last_health_day=? WHERE name='隨機事件測試'")
        .run(day);
    }finally{database.close();}
    const after=await api(srv.url,"state");
    assert.equal(after.status,200);
    assert.equal(after.result.character.lastEventDay,day);
    assert.ok(after.result.healthEvents.length<=1);
    const count=after.result.healthEvents.length;
    const index=after.result.health.index;
    if(count){
      // 原始共有 44 號，實作會隨階段擴增；不綁死早期只完成的事件清單。
      assert.ok(Number.isInteger(after.result.healthEvents[0].originalId));
      assert.ok(after.result.healthEvents[0].originalId>=1);
      assert.ok(after.result.healthEvents[0].originalId<=44);
      assert.equal(index,after.result.healthEvents[0].newHealthIndex);
    }
    for(let i=0;i<4;i++){
      const repeat=await api(srv.url,"state");
      assert.equal(repeat.result.character.lastEventDay,day);
      assert.equal(repeat.result.health.index,index);
      assert.equal(repeat.result.healthEvents.length,count);
    }
  }finally{await srv.stop();}
});

test("多人：疾病事件紀錄限本人查閱，角色事件檢查日期獨立保存",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{
      username:"eventTesterA",password:"event-tester-password-A"
    });
    const b=await api(srv.url,"register",{
      username:"eventTesterB",password:"event-tester-password-B"
    });
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    await api(srv.url,"character",{
      name:"疾病事件甲",gender:"male",stats:defaultStats()
    },a.cookie);
    await api(srv.url,"character",{
      name:"疾病事件乙",gender:"female",stats:defaultStats()
    },b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      const id=db.prepare("SELECT user_id FROM characters WHERE name='疾病事件甲'").get().user_id;
      db.prepare(
        "INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at) VALUES(?,?,?,?,?,?,?)"
      ).run(id,"2026-01-01","caughtCold",4,50,-15,1000);
    }finally{db.close();}
    const own=await api(srv.url,"state",undefined,a.cookie);
    const other=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(own.status,200);
    assert.equal(own.result.healthEvents.length,1);
    assert.equal(own.result.healthEvents[0].originalId,4);
    assert.equal(other.result.healthEvents.length,0);
    assert.equal(own.result.character.lastEventDay,other.result.character.lastEventDay);
    assert.equal((await api(srv.url,"state")).result.user,null);
    assert.equal((await api(srv.url,"hospital/treat",{})).status,401);
  }finally{await srv.stop();}
});


test("單機：原版健康保險購買、同請求防重、醫院三分之一折扣及到期後恢復原價",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"單機保險居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.hospital.price,10000);
    assert.equal(created.result.insurance.active,false);
    assert.equal(created.result.insurance.price,10000);
    assert.equal(created.result.insurance.durationDays,30);
    assert.deepEqual(created.result.insurancePurchases,[]);
    const first=await api(srv.url,"inventory/insurance/buy",{
      quantity:1,requestId:"single-insurance-001"
    });
    assert.equal(first.status,200);
    assert.equal(first.result.insuranceResult.paid,10000);
    assert.equal(first.result.insuranceResult.replayed,false);
    assert.equal(first.result.character.money,90000);
    assert.equal(first.result.insurance.active,true);
    assert.equal(first.result.hospital.hasInsurance,true);
    assert.equal(first.result.hospital.price,3333);
    const duplicate=await api(srv.url,"inventory/insurance/buy",{
      quantity:1,requestId:"single-insurance-001"
    });
    assert.equal(duplicate.status,200);
    assert.equal(duplicate.result.insuranceResult.replayed,true);
    assert.equal(duplicate.result.character.money,90000);
    assert.equal(duplicate.result.insurancePurchases.length,1);
    assert.equal((await api(srv.url,"inventory/insurance/buy",{
      quantity:2,requestId:"single-insurance-001"
    })).status,400);
    const treated=await api(srv.url,"hospital/treat",{insured:false,discount:0});
    assert.equal(treated.status,200);
    assert.equal(treated.result.hospitalResult.paid,3333);
    assert.equal(treated.result.character.money,86667);
    assert.equal(treated.result.insurance.active,true);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      db.prepare("UPDATE inventory_items SET active_until=1 WHERE item_key='health-insurance'").run();
    }finally{db.close();}
    const expired=await api(srv.url,"state");
    assert.equal(expired.status,200);
    assert.equal(expired.result.insurance.active,false);
    assert.equal(expired.result.hospital.hasInsurance,false);
    assert.equal(expired.result.hospital.price,10000);
    assert.equal(expired.result.insurancePurchases.length,1);
    const afterExpiry=await api(srv.url,"hospital/treat",{insured:true,insurance:true});
    assert.equal(afterExpiry.status,200);
    assert.equal(afterExpiry.result.hospitalResult.paid,10000);
    assert.equal(afterExpiry.result.character.money,76667);
  }finally{await srv.stop();}
});

test("多人：健康保險只能由本人購買使用，對方不可藉請求參數冒用折扣",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{
      username:"insurancePlayerA",password:"insurance-player-A-secret"
    });
    const b=await api(srv.url,"register",{
      username:"insurancePlayerB",password:"insurance-player-B-secret"
    });
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    await api(srv.url,"character",{
      name:"保險居民甲",gender:"male",stats:defaultStats()
    },a.cookie);
    await api(srv.url,"character",{
      name:"保險居民乙",gender:"female",stats:defaultStats()
    },b.cookie);
    assert.equal((await api(srv.url,"inventory/insurance/buy",{
      quantity:1,requestId:"unauth-insurance-001"
    })).status,401);
    const bought=await api(srv.url,"inventory/insurance/buy",{
      quantity:2,requestId:"multi-insurance-001"
    },a.cookie);
    assert.equal(bought.status,200);
    assert.equal(bought.result.character.money,80000);
    assert.equal(bought.result.insurance.active,true);
    assert.equal(bought.result.insurance.remainingDays,60);
    assert.equal(bought.result.hospital.price,3333);
    const other=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(other.result.character.money,100000);
    assert.equal(other.result.hospital.price,10000);
    assert.equal(other.result.insurance.active,false);
    assert.equal(other.result.insurancePurchases.length,0);
    const spoofed=await api(srv.url,"hospital/treat",{
      insured:true,hasInsurance:true,userId:1,discount:99
    },b.cookie);
    assert.equal(spoofed.status,200);
    assert.equal(spoofed.result.hospitalResult.paid,10000);
    assert.equal(spoofed.result.character.money,90000);
    const first=await api(srv.url,"hospital/treat",{},a.cookie);
    assert.equal(first.status,200);
    assert.equal(first.result.hospitalResult.paid,3333);
    assert.equal(first.result.character.money,76667);
    assert.equal(first.result.insurancePurchases.length,1);
    const otherAgain=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(otherAgain.result.character.money,90000);
    assert.equal(otherAgain.result.insurancePurchases.length,0);
  }finally{await srv.stop();}
});


test("單機：原版物品封存透過狀態快照唯讀顯示，不提供未實作的道具使用 API",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"原版物品展示",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.deepEqual(created.result.legacyInventory,[]);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      initLegacyInventoryTables(db);
      const userId=db.prepare("SELECT user_id FROM characters WHERE name='原版物品展示'").get().user_id;
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,"00042",1,"薬","原版秘藥","万能,20",2,"回",null,0,"[]");
    }finally{db.close();}
    const state=await api(srv.url,"state");
    assert.equal(state.status,200);
    assert.deepEqual(state.result.legacyInventory,[{
      sourceLine:1,category:"薬",name:"原版秘藥",
      durability:2,unit:"回",purchasedAt:null,readOnly:true
    }]);
    assert.equal((await api(srv.url,"legacy/inventory/use",{id:1})).status,404);
    assert.equal((await api(srv.url,"legacy/inventory/sell",{id:1})).status,404);
    assert.equal((await api(srv.url,"state")).result.character.money,
      created.result.character.money);
  }finally{await srv.stop();}
});

test("多人：封存物品只出現在自己的帳號，無角色者不會取得其他玩家持有物",async()=>{
  const srv=await start("multi");
  try {
    const a=await api(srv.url,"register",{
      username:"legacyItemAlpha",password:"legacy-item-alpha-password"
    });
    const b=await api(srv.url,"register",{
      username:"legacyItemBeta",password:"legacy-item-beta-password"
    });
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    await api(srv.url,"character",{
      name:"封存物品甲",gender:"male",stats:defaultStats()
    },a.cookie);
    await api(srv.url,"character",{
      name:"封存物品乙",gender:"female",stats:defaultStats()
    },b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try {
      initLegacyInventoryTables(db);
      const userId=db.prepare("SELECT user_id FROM characters WHERE name='封存物品甲'").get().user_id;
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,"00042",5,"日用品","原版持有物","無",7,"日",0,0,"[]");
    }finally{db.close();}
    const owned=await api(srv.url,"state",undefined,a.cookie);
    const other=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(owned.status,200);
    assert.equal(owned.result.legacyInventory.length,1);
    assert.equal(owned.result.legacyInventory[0].name,"原版持有物");
    assert.deepEqual(other.result.legacyInventory,[]);
    const anonymous=await api(srv.url,"state");
    assert.equal(anonymous.status,200);
    assert.deepEqual(anonymous.result.legacyInventory,[]);
  }finally{await srv.stop();}
});


function originalConsumableFields({name="風邪薬",category="薬",effect="風邪,10",
    durability=2,interval=30,calories=0,lastUsedAt=0,bonus=0}={}){
  const f=Array(33).fill("");
  f[0]=category;f[1]=name;f[9]=effect;f[12]=String(bonus);
  for(const i of [2,3,4,5,6,7,8,10,11,13,14,15,16,18,19,20])f[i]="0";
  f[17]="1500";f[21]=String(durability);f[22]="回";f[23]=String(interval);
  f[25]=String(calories);f[26]=String(lastUsedAt);f[27]="0";f[28]="0";
  f[30]="1700000000";
  return f;
}
function injectOriginalConsumable(db,userId,line,fields) {
  db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" ")).run(userId,"00042",line,fields[0],fields[1],fields[9],
    Number(fields[21]),fields[22],Number(fields[30]),Number(fields[26]),
    JSON.stringify(fields));
}

test("單機：原版藥品使用、原始耐久保存、二次請求防重、食品與食堂冷卻共用",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"消耗品整合測試",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name='消耗品整合測試'").get().user_id;
      db.prepare("UPDATE characters SET health_index=-13 WHERE user_id=?").run(userId);
      injectOriginalConsumable(db,userId,1,originalConsumableFields());
      injectOriginalConsumable(db,userId,2,originalConsumableFields({
        name:"牛丼弁当",category:"食料品",effect:"無",
        durability:1,interval:0,calories:720,bonus:1
      }));
      injectOriginalConsumable(db,userId,3,originalConsumableFields({
        name:"萬能藥",effect:"万能,15",durability:2
      }));
    }finally{db.close();}
    const before=await api(srv.url,"state");
    assert.equal(before.status,200);
    assert.equal(before.result.legacyInventory.length,3);
    assert.deepEqual(before.result.legacyItemActions.map(x=>x.sourceLine),[1,2,3]);
    assert.equal(before.result.legacyItemHistory.length,0);
    const first=await api(srv.url,"inventory/legacy/use",{
      sourceLine:1,requestId:"test-consume-cold-001"
    });
    assert.equal(first.status,200);
    assert.equal(first.result.itemUseResult.replayed,false);
    assert.equal(first.result.itemUseResult.changes.healthIndex,10);
    assert.equal(first.result.character.healthIndex,-3);
    assert.equal(first.result.legacyItemActions[0].remaining,1);
    assert.equal(first.result.legacyInventory[0].durability,2);
    assert.equal(first.result.legacyItemHistory.length,1);
    const repeat=await api(srv.url,"inventory/legacy/use",{
      sourceLine:1,requestId:"test-consume-cold-001"
    });
    assert.equal(repeat.status,200);
    assert.equal(repeat.result.itemUseResult.replayed,true);
    assert.equal(repeat.result.character.healthIndex,-3);
    assert.equal(repeat.result.legacyItemActions[0].remaining,1);
    assert.equal((await api(srv.url,"inventory/legacy/use",{
      sourceLine:1,requestId:"test-consume-cold-002"
    })).status,400);
    const meal=await api(srv.url,"inventory/legacy/use",{
      sourceLine:2,requestId:"test-consume-food-001"
    });
    assert.equal(meal.status,200);
    assert.equal(meal.result.itemUseResult.changes.food,true);
    assert.equal(meal.result.character.lastMealAt>0,true);
    assert.equal(meal.result.legacyItemActions[1].remaining,0);
    assert.equal((await api(srv.url,"meal/eat",{
      key:before.result.meals[0].key
    })).status,400);
    const universal=await api(srv.url,"inventory/legacy/use",{
      sourceLine:3,requestId:"test-consume-universal-001"
    });
    assert.equal(universal.status,200);
    assert.equal(universal.result.itemUseResult.changes.healthIndex,15);
    assert.equal(universal.result.character.healthIndex,12);
    assert.equal(universal.result.legacyItemActions[2].remaining,1);
    const replay=await api(srv.url,"inventory/legacy/use",{
      sourceLine:3,requestId:"test-consume-universal-001"
    });
    assert.equal(replay.status,200);
    assert.equal(replay.result.itemUseResult.replayed,true);
    assert.equal(replay.result.character.healthIndex,12);
    const persisted=await api(srv.url,"state");
    assert.equal(persisted.result.legacyItemHistory.length,3);
    assert.equal(persisted.result.legacyInventory[0].durability,2);
    const savedDb=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const saved=savedDb.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=(SELECT user_id FROM characters WHERE name='消耗品整合測試') AND source_line=1").get();
      assert.equal(saved.remaining,1);
      const raw=savedDb.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE source_line=1").get();
      assert.equal(JSON.parse(raw.raw_fields_json)[21],"2");
    }finally{savedDb.close();}
  }finally{await srv.stop();}
});

test("多人：道具使用限定本人，不能用其他玩家持有物行號或重送識別碼",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{
      username:"usableLegacyA",password:"usable-legacy-user-a"
    });
    const b=await api(srv.url,"register",{
      username:"usableLegacyB",password:"usable-legacy-user-b"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);
    await api(srv.url,"character",{
      name:"消耗品居民甲",gender:"male",stats:defaultStats()
    },a.cookie);
    await api(srv.url,"character",{
      name:"消耗品居民乙",gender:"female",stats:defaultStats()
    },b.cookie);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const row=db.prepare("SELECT user_id FROM characters WHERE name='消耗品居民甲'").get();
      injectOriginalConsumable(db,row.user_id,8,originalConsumableFields({
        name:"頭腦訓練片",effect:"無",interval:0,bonus:2
      }));
    }finally{db.close();}
    const first=await api(srv.url,"state",undefined,a.cookie);
    const second=await api(srv.url,"state",undefined,b.cookie);
    assert.deepEqual(first.result.legacyItemActions.map(x=>x.sourceLine),[8]);
    assert.deepEqual(second.result.legacyItemActions,[]);
    assert.equal((await api(srv.url,"inventory/legacy/use",{
      sourceLine:8,requestId:"consumable-other-01"
    })).status,401);
    assert.equal((await api(srv.url,"inventory/legacy/use",{
      sourceLine:8,requestId:"consumable-other-01"
    },b.cookie)).status,400);
    const used=await api(srv.url,"inventory/legacy/use",{
      sourceLine:8,requestId:"consumable-owner-01"
    },a.cookie);
    assert.equal(used.status,200);
    assert.equal(used.result.character.stats.kenkou,22);
    assert.equal(used.result.legacyItemActions[0].remaining,1);
    const other=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(other.result.character.stats.kenkou,20);
    assert.equal(other.result.legacyItemHistory.length,0);
    assert.equal(other.result.legacyInventory.length,0);
  }finally{await srv.stop();}
});


test("單機 HTTP 狀態只顯示本人 Web 事件獲得的優惠券餘額", async()=>{
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"state")).result.couponBalance,0);
    const created=await api(srv.url,"character",{
      name:"優惠券驗證者",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.couponBalance,0);
    const data=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const userId=data.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("優惠券驗證者").user_id;
      data.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)")
        .run(userId,4);
    }finally{data.close();}
    assert.equal((await api(srv.url,"state")).result.couponBalance,4);
  }finally{await srv.stop();}
});


test("單機 HTTP：蟑螂 20 秒挑戰由伺服器驗證，K 點數與事件獎勵只發一次",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"蟑螂挑戰測試者",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("蟑螂挑戰測試者").user_id;
      const now=Date.now();
      const history=db.prepare([
        "INSERT INTO character_events",
        "(user_id,day,event_key,original_id,old_health_index,new_health_index,",
        "created_at,description,effects_json) VALUES(?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,"2099-12-30","cockroach",44,50,50,
        now,"蟑螂出現！","{\"cockroach\":\"pending\"}");
      db.prepare([
        "INSERT INTO character_cockroach_challenges",
        "(event_id,user_id,started_at,expires_at,status)",
        "VALUES(?,?,?,?,'pending')"
      ].join(" ")).run(Number(history.lastInsertRowid),userId,now-1000,now+19000);
    }finally{db.close();}
    const before=await api(srv.url,"state");
    assert.equal(before.result.cockroachChallenge.status,"active");
    assert.equal(before.result.character.kpoint,0);
    const claimed=await api(srv.url,"events/cockroach/claim",{userId:999,now:0});
    assert.equal(claimed.status,200);
    assert.equal(claimed.result.cockroachResult.status,"caught");
    const reward=claimed.result.cockroachResult.reward;
    assert.ok(reward>=1&&reward<=20000);
    assert.equal(claimed.result.character.money,100000+reward);
    assert.equal(claimed.result.character.kpoint,3);
    assert.equal(claimed.result.character.stats.looks,17);
    assert.equal(claimed.result.cockroachChallenge,null);
    assert.equal(claimed.result.healthEvents[0].effects.cockroach,"caught");
    const repeated=await api(srv.url,"events/cockroach/claim",{});
    assert.equal(repeated.status,400);
    assert.equal((await api(srv.url,"state")).result.character.kpoint,3);
  }finally{await srv.stop();}
});

test("多人 HTTP：其他登入者不能搶領 #44，逾期操作亦不會發獎",async()=>{
  const srv=await start("multi");
  try{
    const first=await api(srv.url,"register",{username:"hunter_a",password:"pass12345"});
    const second=await api(srv.url,"register",{username:"hunter_b",password:"pass12345"});
    assert.equal(first.status,200);
    assert.equal(second.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"挑戰者甲",gender:"other",stats:defaultStats()
    },first.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"挑戰者乙",gender:"other",stats:defaultStats()
    },second.cookie)).status,200);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name='挑戰者甲'").get().user_id;
      const now=Date.now();
      const history=db.prepare([
        "INSERT INTO character_events",
        "(user_id,day,event_key,original_id,old_health_index,new_health_index,",
        "created_at,description,effects_json) VALUES(?,?,?,?,?,?,?,?,?)"
      ].join(" ")).run(userId,"2099-12-30","cockroach",44,50,50,
        now-30000,"蟑螂出現！","{\"cockroach\":\"pending\"}");
      db.prepare([
        "INSERT INTO character_cockroach_challenges",
        "(event_id,user_id,started_at,expires_at,status)",
        "VALUES(?,?,?,?,'pending')"
      ].join(" ")).run(Number(history.lastInsertRowid),userId,now-30000,now-10000);
    }finally{db.close();}
    const blocked=await api(srv.url,"events/cockroach/claim",{userId:1},second.cookie);
    assert.equal(blocked.status,400);
    const expired=await api(srv.url,"events/cockroach/claim",{now:1},first.cookie);
    assert.equal(expired.status,200);
    assert.equal(expired.result.cockroachResult.status,"escaped");
    assert.equal(expired.result.character.kpoint,0);
    assert.equal(expired.result.character.money,100000);
    assert.equal(expired.result.healthEvents[0].effects.cockroach,"escaped");
    assert.equal((await api(srv.url,"state",undefined,second.cookie)).result.character.kpoint,0);
  }finally{await srv.stop();}
});


test("未登入首頁：四座原版城鎮唯讀預覽，空地圖保留空白、不可編輯且不洩漏玩家資訊",async()=>{
  const srv=await start("multi");
  try{
    const initial=await api(srv.url,"state");
    assert.equal(initial.result.user,null);
    const preview=await api(srv.url,"town/preview");
    assert.equal(preview.status,200);
    assert.equal(preview.result.towns.length,4);
    assert.equal(preview.result.map.townId,0);
    assert.equal(preview.result.map.configured,false);
    assert.equal(preview.result.map.background,"keihansin.gif");
    assert.equal(preview.result.map.cells.length,192);
    assert.ok(preview.result.map.cells.every(cell=>cell.category==="empty"&&cell.image===null));
    assert.equal(Object.hasOwn(preview.result.map,"palette"),false);
    assert.equal(Object.hasOwn(preview.result.map,"editable"),false);
    assert.equal(Object.hasOwn(preview.result,"user"),false);
    for(const cell of preview.result.map.cells){
      assert.equal(Object.hasOwn(cell,"raw"),false);
      assert.equal(Object.hasOwn(cell,"key"),false);
      assert.equal(Object.hasOwn(cell,"houseId"),false);
    }
    for(const id of [0,1,2,3]){
      const result=await api(srv.url,"town/preview?townId="+id);
      assert.equal(result.status,200);
      assert.equal(result.result.map.townId,id);
      assert.equal(result.result.map.cells.length,192);
    }
    for(const bad of ["-1","4","01","1.1","foo","%3Cscript%3E",""]){
      assert.equal((await api(srv.url,"town/preview?townId="+bad)).status,400);
    }
  }finally{await srv.stop();}
});

test("未登入預覽可顯示實際儲存的建築，但不暴露原始代碼或未知舊玩家 ID",async()=>{
  const srv=await start("multi");
  try{
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const tiles=Array(192).fill("");
      tiles[0]="銀行";
      tiles[1]="993_4=空地"; // 原版個人住宅代碼：不應暴露身分或原始欄位
      tiles[2]="legacy-secret-code"; // 未知符號：不應逐字對外回傳
      db.prepare([
        "INSERT INTO town_maps(town_id,original_name,original_record,source,tiles_json,updated_at)",
        "VALUES(?,?,?,?,?,?)"
      ].join(" ")).run(0,"測試城鎮","","web",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
    const response=await api(srv.url,"town/preview?townId=0");
    assert.equal(response.status,200);
    assert.equal(response.result.map.configured,true);
    assert.equal(response.result.map.cells[0].label,"銀行");
    assert.equal(response.result.map.cells[0].image,"bank.gif");
    assert.equal(response.result.map.cells[1].label,"原版居民建築（待匯入房屋資料）");
    assert.equal(response.result.map.cells[2].label,"未識別的街區符號");
    const body=JSON.stringify(response.result);
    assert.doesNotMatch(body,/993_4|legacy-secret-code|tiles_json|original_record/);
    assert.equal(response.result.map.cells.length,192);
  }finally{await srv.stop();}
});

test("單機快轉：5 分鐘解鎖工作、半小時累加、1 小時用餐，並將日期推進一天",async()=>{
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,409);
    const created=await api(srv.url,"character",{name:"時光居民",gender:"other",stats:defaultStats()});
    assert.equal(created.status,200);
    assert.equal(created.result.mode,"solo");
    assert.equal(created.result.gameTimeOffsetMs,0);
    assert.equal((await api(srv.url,"job",{key:"legacy-2"})).status,200);
    const work=await api(srv.url,"work",{});
    assert.equal(work.status,200);
    assert.ok(work.result.workCooldownMs>0);
    assert.equal((await api(srv.url,"work",{})).status,400);

    const jumped=await api(srv.url,"solo/time/advance",{preset:"5m"});
    assert.equal(jumped.status,200);
    assert.equal(jumped.result.timeAdvance.advancedMs,300000);
    assert.equal(jumped.result.gameTimeOffsetMs,300000);
    assert.equal(jumped.result.workCooldownMs,0);
    assert.equal((await api(srv.url,"work",{})).status,200);

    const mealKey=jumped.result.meals.find(meal=>meal.price<=jumped.result.character.money)?.key;
    assert.ok(mealKey,"應有可負擔的食堂餐點");
    assert.equal((await api(srv.url,"meal/eat",{key:mealKey})).status,200);
    const eaten=await api(srv.url,"state");
    assert.ok(eaten.result.mealCooldownMs>0);
    const half=await api(srv.url,"solo/time/advance",{preset:"30m"});
    assert.equal(half.status,200);
    assert.equal(half.result.gameTimeOffsetMs,2100000);
    assert.ok(half.result.mealCooldownMs>0);
    assert.equal((await api(srv.url,"meal/eat",{key:mealKey})).status,400);
    const hour=await api(srv.url,"solo/time/advance",{preset:"30m"});
    assert.equal(hour.status,200);
    assert.equal(hour.result.mealCooldownMs,0);
    assert.equal((await api(srv.url,"meal/eat",{key:mealKey})).status,200);
    const oneHour=await api(srv.url,"solo/time/advance",{preset:"1h"});
    assert.equal(oneHour.status,200);
    assert.equal(oneHour.result.timeAdvance.advancedMs,3600000);
    assert.equal(oneHour.result.gameTimeOffsetMs,7500000);
    const next=await api(srv.url,"solo/time/advance",{preset:"1d"});
    assert.equal(next.status,200);
    assert.equal(next.result.timeAdvance.advancedMs,86400000);
    assert.equal(next.result.gameTimeOffsetMs,93900000);
    assert.equal(next.result.gameTimeMs>=created.result.gameTimeMs+93900000,true);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      assert.equal(db.prepare("SELECT offset_ms FROM solo_clock WHERE id=1").get().offset_ms,93900000);
    }finally{db.close();}
  }finally{await srv.stop();}
});

test("快轉只限單人：多人帳號不能修改世界時間，原本登出依然失效工作階段",async()=>{
  const srv=await start("multi");
  try{
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,401);
    const registered=await api(srv.url,"register",{
      username:"clock_denied",password:"secure-clock-test-123"
    });
    assert.equal(registered.status,200);
    const cookie=registered.cookie;
    assert.ok(cookie);
    const denied=await api(srv.url,"solo/time/advance",{preset:"5m"},cookie);
    assert.equal(denied.status,403);
    const state=await api(srv.url,"state",undefined,cookie);
    assert.equal(state.result.mode,"multi");
    assert.equal(state.result.gameTimeOffsetMs,0);
    assert.equal((await api(srv.url,"logout",{},cookie)).status,200);
    assert.equal((await api(srv.url,"state",undefined,cookie)).result.user,null);
  }finally{await srv.stop();}
});

test("正在進行的 20 秒蟑螂事件禁止快轉，避免錯過限時操作",async()=>{
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"character",{name:"限時居民",gender:"other",stats:defaultStats()})).status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const now=Date.now(),uid=db.prepare("SELECT id FROM users WHERE username='__local_player__'").get().id;
      const entry=db.prepare(
        "INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at,description,effects_json) VALUES(?,?,?,?,?,?,?,?,?)"
      ).run(uid,"2026-11-19","cockroach",44,50,50,now,"蟑螂事件","{}");
      db.prepare(
        "INSERT INTO character_cockroach_challenges(event_id,user_id,started_at,expires_at,status) VALUES(?,?,?,?,'pending')"
      ).run(Number(entry.lastInsertRowid),uid,now,now+20000);
    }finally{db.close();}
    const denied=await api(srv.url,"solo/time/advance",{preset:"5m"});
    assert.equal(denied.status,409);
    assert.match(denied.result.error,/限時事件/);
    const state=await api(srv.url,"state");
    assert.equal(state.result.gameTimeOffsetMs,0);
  }finally{await srv.stop();}
});

test("單機跨日快轉會重置學校每日限制並依既有規則計算銀行每日利息",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"隔日居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const deposited=await api(srv.url,"bank",{action:"deposit",amount:10000});
    assert.equal(deposited.status,200);
    assert.equal(deposited.result.character.bank,10000);
    const day=deposited.result.bankAccount.lastInterestDay;
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      db.prepare("UPDATE characters SET last_school_day=? WHERE name='隔日居民'").run(day);
    }finally{db.close();}
    const before=await api(srv.url,"state");
    assert.equal(before.result.schoolRemainingToday,true);
    const advanced=await api(srv.url,"solo/time/advance",{preset:"1d"});
    assert.equal(advanced.status,200);
    assert.equal(advanced.result.schoolRemainingToday,false);
    assert.notEqual(advanced.result.bankAccount.lastInterestDay,day);
    assert.equal(advanced.result.gameTimeOffsetMs,86400000);
    const interest=advanced.result.bankLedger.find(item=>item.action==="普通存款利息");
    assert.ok(interest,"跨日快照應寫入銀行普通存款利息");
    assert.equal(interest.credit,50);
    const repeat=await api(srv.url,"state");
    assert.equal(repeat.result.bankAccount.lastInterestDay,advanced.result.bankAccount.lastInterestDay);
    assert.equal(repeat.result.bankLedger.filter(item=>item.action==="普通存款利息").length,1);
  }finally{await srv.stop();}
});

test("單機刪除角色：輸入名稱與確認皆必要，住宅還原空地，清除私人物品和紀錄但保留地圖與快轉時間",async()=>{
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"solo/character/delete",{characterName:"尚無角色",confirm:true})).status,400);
    const created=await api(srv.url,"character",{name:"重建居民甲",gender:"other",stats:defaultStats()});
    assert.equal(created.status,200);
    assert.equal((await api(srv.url,"move",{townId:3})).status,200);
    assert.equal((await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"})).status,200);
    assert.equal((await api(srv.url,"map/tile",{row:0,column:1,symbol:"銀行"})).status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{ db.prepare("UPDATE characters SET money=20000000 WHERE name='重建居民甲'").run(); }
    finally{db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"0",title:"我的留言板"}]
    })).status,200);
    assert.equal((await api(srv.url,"house/room/post",{
      houseId,slotIndex:0,body:"刪除後不應存在"
    })).status,200);
    assert.equal((await api(srv.url,"bank",{action:"deposit",amount:2000})).status,200);
    const before=await api(srv.url,"solo/time/advance",{preset:"5m"});
    assert.equal(before.status,200);
    assert.equal(before.result.gameTimeOffsetMs,300000);
    const originalUserId=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try {
      const uid=originalUserId.prepare("SELECT id FROM users WHERE username='__local_player__'").get().id;
      originalUserId.prepare(
        "INSERT INTO inventory_items(user_id,item_key,active_until,last_purchased_at) VALUES(?,?,?,?)"
      ).run(uid,"health-insurance",before.result.gameTimeMs+86400000,before.result.gameTimeMs);
      originalUserId.prepare(
        "INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)"
      ).run(uid,3);
      originalUserId.prepare(
        "INSERT INTO character_events(user_id,day,event_key,original_id,old_health_index,new_health_index,created_at,description,effects_json) VALUES(?,?,?,?,?,?,?,?,?)"
      ).run(uid,"2026-11-19","testevent",4,50,50,before.result.gameTimeMs,"個人事件","{}");
      assert.equal(originalUserId.prepare("SELECT COUNT(*) n FROM room_posts").get().n,1);
      assert.equal(originalUserId.prepare("SELECT COUNT(*) n FROM bank_ledger").get().n>=1,true);
    }finally{originalUserId.close();}
    const noConfirm=await api(srv.url,"solo/character/delete",{characterName:"重建居民甲",confirm:false});
    assert.equal(noConfirm.status,400);
    const wrong=await api(srv.url,"solo/character/delete",{characterName:"別人的角色",confirm:true});
    assert.equal(wrong.status,400);
    assert.match(wrong.result.error,/名稱不符/);
    const unchanged=await api(srv.url,"state");
    assert.equal(unchanged.result.character.name,"重建居民甲");
    assert.equal(unchanged.result.houses.length,1);
    assert.equal(unchanged.result.gameTimeOffsetMs,300000);

    const deleted=await api(srv.url,"solo/character/delete",{characterName:"重建居民甲",confirm:true});
    assert.equal(deleted.status,200);
    assert.equal(deleted.result.character,null);
    assert.equal(deleted.result.deletion.deletedCharacter,"重建居民甲");
    assert.equal(deleted.result.deletion.restoredHouses,1);
    assert.equal(deleted.result.gameTimeOffsetMs,300000);
    const after=await api(srv.url,"state");
    assert.equal(after.result.character,null);
    assert.equal(after.result.mode,"solo");
    const check=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const tables=["characters","houses","house_events","room_settings","room_posts",
        "bank_accounts","bank_ledger","inventory_items","character_coupons",
        "character_events","legacy_item_use_history","legacy_inventory_items"];
      for(const name of tables)
        assert.equal(check.prepare("SELECT COUNT(*) AS n FROM "+name).get().n,0,
          name+" 應在刪除後沒有殘留的玩家資料");
      const maps=check.prepare("SELECT tiles_json FROM town_maps WHERE town_id=3").get();
      assert.ok(maps);
      const tiles=JSON.parse(maps.tiles_json);
      assert.equal(tiles[0],"空地","個人房屋還原為原始建地");
      assert.equal(tiles[1],"銀行","其它原先編輯的地圖內容應保留");
      assert.equal(check.prepare("SELECT offset_ms FROM solo_clock WHERE id=1").get().offset_ms,300000);
      assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(),[]);
    }finally{check.close();}
    const again=await api(srv.url,"character",{
      name:"重建居民甲",gender:"female",stats:defaultStats()
    });
    assert.equal(again.status,200,"刪除後可使用原本的角色名稱重新建立");
    assert.equal(again.result.houses.length,0);
    assert.equal(again.result.bankLedger.length,0);
    assert.equal(again.result.gameTimeOffsetMs,300000);
    const sameTown=await api(srv.url,"move",{townId:3});
    assert.equal(sameTown.status,200);
    assert.equal(sameTown.result.map.cells[0].category,"lot");
    assert.equal(sameTown.result.map.cells[1].label,"銀行");
  }finally{await srv.stop();}
});

test("單機刪除角色：地圖住宅占用資料不一致時回滾，不刪角色也不覆蓋其它地圖",async()=>{
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"character",{
      name:"防誤刪居民",gender:"other",stats:defaultStats()
    })).status,200);
    assert.equal((await api(srv.url,"move",{townId:3})).status,200);
    assert.equal((await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地2"})).status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{ db.prepare("UPDATE characters SET money=20000000 WHERE name='防誤刪居民'").run(); }
    finally{db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(built.status,200);
    const broken=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const record=broken.prepare("SELECT tiles_json FROM town_maps WHERE town_id=3").get();
      const cells=JSON.parse(record.tiles_json);
      cells[0]="銀行";
      broken.prepare("UPDATE town_maps SET tiles_json=? WHERE town_id=3").run(JSON.stringify(cells));
    }finally{broken.close();}
    const refused=await api(srv.url,"solo/character/delete",{characterName:"防誤刪居民",confirm:true});
    assert.equal(refused.status,400);
    assert.match(refused.result.error,/街區地圖不一致/);
    const still=await api(srv.url,"state");
    assert.equal(still.result.character.name,"防誤刪居民");
    assert.equal(still.result.houses.length,1);
    assert.equal(still.result.map.cells[0].key,"銀行");
  }finally{await srv.stop();}
});

test("多人模式無法呼叫刪除單人角色 API，包含已登入的使用者",async()=>{
  const srv=await start("multi");
  try{
    assert.equal((await api(srv.url,"solo/character/delete",{characterName:"任何人",confirm:true})).status,401);
    const registered=await api(srv.url,"register",{username:"nodelete",password:"password_for_delete_test"});
    assert.equal(registered.status,200);
    const cookie=registered.cookie;
    assert.equal((await api(srv.url,"character",{
      name:"多人不刪",gender:"other",stats:defaultStats()
    },cookie)).status,200);
    const denied=await api(srv.url,"solo/character/delete",{
      characterName:"多人不刪",confirm:true
    },cookie);
    assert.equal(denied.status,403);
    const after=await api(srv.url,"state",undefined,cookie);
    assert.equal(after.result.character.name,"多人不刪");
  }finally{await srv.stop();}
});
