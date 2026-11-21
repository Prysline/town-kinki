import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync,readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_CHARACTER_FIELDS } from "../src/legacy-character.mjs";
import { initLegacyInventoryTables } from "../src/legacy-inventory.mjs";
import { decodeLegacyText } from "../src/engine.mjs";
import { parseLegacyRetailCatalog } from "../src/retail.mjs";

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
async function start(mode, seed, existingDirectory = null) {
  const port = await freePort();
  const directory = existingDirectory ?? mkdtempSync(join(tmpdir(), "town-web-"));
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
    async stop({preserveData=false}={}) {
      if (child.exitCode === null) {
        const exited = new Promise(done => child.once("exit", done));
        child.kill();
        await Promise.race([exited, delay(1500)]);
      }
      if(!preserveData) rmSync(directory, { force: true, recursive: true });
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
function anchorSoloTestAtNoon(srv){
  // 薪資測試會快轉 25～50 分鐘；若當下接近台北午夜，事件與銀行日利息會
  // 同時結算，不能把這些每日資產變動誤判為發薪邏輯回歸。
  const dateParts=new Intl.DateTimeFormat("en-US",{
    timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",
    second:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date());
  const get=type=>Number(dateParts.find(x=>x.type===type)?.value??0);
  const elapsed=((get("hour")*60+get("minute"))*60+get("second"))*1000;
  const day=86400000,midday=12*3600000;
  const offset=(midday-elapsed+day)%day;
  const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
  try{db.prepare("UPDATE solo_clock SET offset_ms=? WHERE id=1").run(offset);}
  finally{db.close();}
}


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
  anchorSoloTestAtNoon(srv);
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
  anchorSoloTestAtNoon(srv);
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
  // 車資測試不應跨午夜混入原版每日隨機收入／支出事件。
  anchorSoloTestAtNoon(srv);
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
    },a.cookie)).status,200);
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
    // 來源 syouhin.cgi L10–43 有 34 道食物；未被今日選出的 4 道
    // 即使客戶端直接提供真實目錄 key，也不可跳過菜單採購。
    const notOnMenu=Array.from({length:34},(_,i)=>"meal-main-"+(10+i))
      .find(key=>!main.some(meal=>meal.key===key));
    assert.ok(notOnMenu);
    const rejected=await api(srv.url,"meal/eat",{key:notOnMenu});
    assert.equal(rejected.status,400);
    assert.match(rejected.result.error,/售完|菜單/);
    assert.equal((await api(srv.url,"state")).result.character.money,first.character.money);
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

    // 這個測試要連續吃兩份相同餐點；避免抽到單份可買、第二份卻付不起的隨機餐點。
    const mealKey=jumped.result.meals.find(meal=>meal.stock>=2&&
      meal.price*2<=jumped.result.character.money)?.key;
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
    // 遊戲可能於午夜跨日，原版食堂會換菜單；第二次應買「新時點真正上架」的餐點。
    const nextMealKey=hour.result.meals.find(meal=>
      meal.stock>0&&meal.price<=hour.result.character.money)?.key;
    assert.ok(nextMealKey,"快轉後本日菜單應有可支付餐點");
    assert.equal((await api(srv.url,"meal/eat",{key:nextMealKey})).status,200);
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


test("單機有真實百貨建築才能購買：地圖入店、現金/庫存/物品、防重及另一店封鎖",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{name:"百貨驗收玩家",gender:"other",stats:defaultStats()});
    assert.equal(created.status,200);
    assert.deepEqual(created.result.retailAvailable,[]);
    const failed=await api(srv.url,"retail/buy",{
      shop:"depart1",sku:"legacy-2",quantity:1,requestId:"retail_no_building"});
    assert.equal(failed.status,400);
    const placed=await api(srv.url,"map/tile",{row:0,column:0,symbol:"デパ"});
    assert.equal(placed.status,200);
    assert.ok(placed.result.retailAvailable.includes("depart1"));
    assert.ok(!placed.result.retailAvailable.includes("depart2"));
    assert.equal(placed.result.retailGoods.length,110);
    const affordable=placed.result.retailGoods.find(item=>item.stock>0&&item.price<=placed.result.character.money);
    assert.ok(affordable,"當日貨架應存在初始現金能購買的原始商品");
    const before=placed.result.character.money;
    const payload={shop:"depart1",sku:affordable.sku,quantity:1,requestId:"retail_http_00001"};
    const bought=await api(srv.url,"retail/buy",payload);
    assert.equal(bought.status,200);
    assert.equal(bought.result.retailResult.paid,affordable.price);
    assert.equal(bought.result.character.money,before-affordable.price);
    assert.equal(bought.result.retailPurchases.length,1);
    assert.ok(bought.result.legacyInventory.some(x=>x.origin==="retail"&&x.name===affordable.name));
    assert.equal(bought.result.retailGoods.find(x=>x.sku===affordable.sku).stock,affordable.stock-1);
    const again=await api(srv.url,"retail/buy",payload);
    assert.equal(again.status,200);
    assert.equal(again.result.retailResult.replayed,true);
    assert.equal(again.result.character.money,before-affordable.price);
    assert.equal((await api(srv.url,"retail/buy",{...payload,shop:"depart2",requestId:"retail_shop2_fail"})).status,400);
    assert.equal((await api(srv.url,"retail/buy",{...payload,quantity:6,requestId:"retail_qty_fail"})).status,400);
  }finally{await srv.stop();}
});


test("百貨 HTTP 多件現金購物：庫存扣量、同品合併、請求防重與銀行付款拒絕",async()=>{
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"character",{
      name:"多件購物角色",gender:"other",stats:defaultStats()
    })).status,200);
    const placed=await api(srv.url,"map/tile",{row:0,column:0,symbol:"デパ"});
    assert.equal(placed.status,200);
    const item=placed.result.retailGoods.find(g=>g.stock>=3&&g.price*3<=placed.result.character.money&&
      g.category!=="ギフト");
    assert.ok(item,"貨架至少一項普通商品可購買三件");
    const initial=placed.result.character.money;
    const payload={shop:"depart1",sku:item.sku,quantity:2,requestId:"retail_http_multi_a"};
    const first=await api(srv.url,"retail/buy",payload);
    assert.equal(first.status,200);
    assert.equal(first.result.retailResult.quantity,2);
    assert.equal(first.result.retailResult.paid,item.price*2);
    const second=await api(srv.url,"retail/buy",{
      shop:"depart1",sku:item.sku,quantity:1,requestId:"retail_http_multi_b"
    });
    assert.equal(second.status,200);
    assert.equal(second.result.retailResult.merged,true);
    assert.equal(second.result.retailResult.sourceLine,first.result.retailResult.sourceLine);
    assert.equal(second.result.legacyInventory.filter(x=>x.origin==="retail"&&x.name===item.name).length,1);
    assert.equal(second.result.character.money,initial-item.price*3);
    assert.equal(second.result.retailGoods.find(g=>g.sku===item.sku).stock,item.stock-3);
    const replay=await api(srv.url,"retail/buy",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.retailResult.replayed,true);
    assert.equal(replay.result.character.money,initial-item.price*3);
    const noCard=await api(srv.url,"retail/buy",{
      ...payload,requestId:"retail_http_credit_fail",payment:"bank",cardSourceLine:111111
    });
    assert.equal(noCard.status,400);
    assert.equal(noCard.result.error.includes("信用卡"),true);
  }finally{await srv.stop();}
});


test("實體百貨健康保険透過 HTTP 購入後生效於醫院折扣與原版保險狀態",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"百貨保險患者",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const placed=await api(srv.url,"map/tile",{row:0,column:0,symbol:"デパ"});
    assert.equal(placed.status,200);
    assert.equal(placed.result.hospital.hasInsurance,false);
    // 測試實際目錄第 356 行健康保険：只改隔離測試 DB 的當日貨架，
    // 不開啟任何無建築直購捷徑，也不修改原始商品資料。
    const healthSku="legacy-356";
    if(!placed.result.retailGoods.some(x=>x.sku===healthSku)){
      const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
      try{
        const replacement=db.prepare("SELECT position FROM retail_stock WHERE shop='depart1' ORDER BY position LIMIT 1").get();
        db.prepare("UPDATE retail_stock SET sku=?,remaining=15 WHERE shop='depart1' AND position=?")
          .run(healthSku,replacement.position);
      }finally{db.close();}
    }
    const ready=await api(srv.url,"state");
    const health=ready.result.retailGoods.find(x=>x.sku===healthSku);
    assert.ok(health);
    assert.equal(health.name,"健康保険");
    assert.equal(health.price,30000);
    const bought=await api(srv.url,"retail/buy",{
      shop:"depart1",sku:health.sku,quantity:2,requestId:"retail_health_hospital"
    });
    assert.equal(bought.status,200);
    assert.equal(bought.result.retailResult.paid,60000);
    assert.equal(bought.result.hospital.hasInsurance,true);
    assert.equal(bought.result.insurance.active,true);
    assert.equal(bought.result.insurance.remainingDays,60);
    assert.equal(bought.result.hospital.price,Math.floor(placed.result.hospital.basePrice/3));
    const again=await api(srv.url,"retail/buy",{
      shop:"depart1",sku:health.sku,quantity:2,requestId:"retail_health_hospital"
    });
    assert.equal(again.status,200);
    assert.equal(again.result.retailResult.replayed,true);
    assert.equal(again.result.insurance.remainingDays,60);
  }finally{await srv.stop();}
});


test("原版自販機 HTTP：必須有地圖建築、使用原價、跨玩家共用貨架且重送不扣兩次",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"自販機驗收玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.vendingAvailable,false);
    assert.deepEqual(created.result.vendingGoods,[]);
    const noBuilding=await api(srv.url,"retail/buy",{
      shop:"vending",sku:"vending-2",quantity:1,requestId:"vending_http_no_building"
    });
    assert.equal(noBuilding.status,400);
    assert.match(noBuilding.result.error,/自動販賣機/);
    const placed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"自販機"
    });
    assert.equal(placed.status,200);
    assert.equal(placed.result.vendingAvailable,true);
    assert.equal(placed.result.retailAvailable.length,0);
    assert.equal(placed.result.vendingGoods.length,10);
    assert.ok(placed.result.vendingGoods.every(x=>x.shop==="vending"));
    const product=placed.result.vendingGoods.find(x=>
      x.price<=1000&&x.stock>=3);
    assert.ok(product,"原版自販機飲料應能由初始現金購買");
    const initial=placed.result.character.money;
    const payload={shop:"vending",sku:product.sku,quantity:2,requestId:"vending_http_order_1"};
    const bought=await api(srv.url,"retail/buy",payload);
    assert.equal(bought.status,200);
    assert.equal(bought.result.retailResult.paid,product.price*2);
    assert.equal(bought.result.character.money,initial-product.price*2);
    assert.equal(bought.result.vendingGoods.find(x=>x.sku===product.sku).stock,
      product.stock-2);
    const owned=bought.result.legacyInventory.find(x=>x.origin==="retail"&&x.name===product.name);
    assert.ok(owned);
    assert.equal(owned.durability,product.durability*2);
    assert.equal(bought.result.retailPurchases[0].shop,"vending");
    assert.equal(bought.result.retailGoods.length,0);
    const replay=await api(srv.url,"retail/buy",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.retailResult.replayed,true);
    assert.equal(replay.result.character.money,initial-product.price*2);
    assert.equal(replay.result.vendingGoods.find(x=>x.sku===product.sku).stock,
      product.stock-2);
    assert.equal((await api(srv.url,"retail/buy",{
      ...payload,requestId:"vending_http_no_card",
      payment:"bank",cardSourceLine:99999
    })).status,400);
    const changed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"空地"
    });
    assert.equal(changed.status,200);
    assert.equal(changed.result.vendingAvailable,false);
    assert.equal((await api(srv.url,"retail/buy",{
      ...payload,requestId:"vending_http_building_removed"
    })).status,400);
  }finally{await srv.stop();}
});


test("自販機爽快牛奶從原始商品實際買入、回復頭腦能量並扣除耐久",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"原版牛奶效果驗收",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const placed=await api(srv.url,"map/tile",{row:0,column:0,symbol:"自販機"});
    assert.equal(placed.status,200);
    const sku="vending-2"; // dat_dir/jihanki.cgi 第二行「爽快ミルク」，效果「効果」/腦力消耗 -500
    if(!placed.result.vendingGoods.some(x=>x.sku===sku)){
      const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
      try{
        const first=db.prepare("SELECT position FROM vending_stock ORDER BY position LIMIT 1").get();
        db.prepare("UPDATE vending_stock SET sku=?,remaining=30 WHERE position=?")
          .run(sku,first.position);
      }finally{db.close();}
    }
    const current=await api(srv.url,"state");
    const item=current.result.vendingGoods.find(x=>x.sku===sku);
    assert.ok(item);
    assert.equal(item.price,800);
    assert.equal(item.name,"爽快ミルク");
    const buy=await api(srv.url,"retail/buy",{
      shop:"vending",sku,quantity:1,requestId:"vending_milk_http_buy"
    });
    assert.equal(buy.status,200);
    const line=buy.result.retailResult.sourceLine;
    assert.ok(buy.result.legacyItemActions.some(x=>x.sourceLine===line&&x.canUse));
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      db.prepare("UPDATE characters SET brain_energy=0,recovered_at=? WHERE name='原版牛奶效果驗收'")
        .run(buy.result.gameTimeMs);
    }finally{db.close();}
    const used=await api(srv.url,"inventory/legacy/use",{
      sourceLine:line,requestId:"vending_milk_http_use"
    });
    assert.equal(used.status,200);
    assert.ok(used.result.itemUseResult.changes.brainEnergy>0);
    assert.equal(used.result.itemUseResult.replayed,false);
    assert.equal(used.result.legacyItemActions.find(x=>x.sourceLine===line).remaining,0);
    const again=await api(srv.url,"inventory/legacy/use",{
      sourceLine:line,requestId:"vending_milk_http_use"
    });
    assert.equal(again.status,200);
    assert.equal(again.result.itemUseResult.replayed,true);
    assert.equal(again.result.legacyItemHistory.length,1);
  }finally{await srv.stop();}
});


test("原版裝備屋 HTTP：真實地圖、原價購入、同名拒買、換裝與回倉出售、重送防重",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"裝備商店驗收玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.equipmentAvailable,false);
    assert.deepEqual(created.result.equipmentGoods,[]);
    assert.equal((await api(srv.url,"equipment/buy",{
      sku:"equip-2",requestId:"equip_http_no_shop"
    })).status,400);
    const placed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"装備屋"
    });
    assert.equal(placed.status,200);
    assert.equal(placed.result.equipmentAvailable,true);
    assert.equal(placed.result.equipmentGoods.length,27);
    assert.equal(placed.result.retailAvailable.length,0);
    assert.equal(placed.result.vendingAvailable,false);
    const pencil=placed.result.equipmentGoods.find(x=>x.name==="HBの鉛筆");
    assert.ok(pencil);
    assert.equal(pencil.price,50);
    const initial=placed.result.character.money;
    const payload={sku:pencil.sku,requestId:"equip_http_buy_pencil"};
    const buy=await api(srv.url,"equipment/buy",payload);
    assert.equal(buy.status,200);
    assert.equal(buy.result.equipmentResult.amount,-50);
    assert.equal(buy.result.character.money,initial-50);
    assert.equal(buy.result.equipmentItems.length,1);
    assert.equal(buy.result.equipmentItems[0].status,"stored");
    const id=buy.result.equipmentResult.itemId;
    const replay=await api(srv.url,"equipment/buy",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.equipmentResult.replayed,true);
    assert.equal(replay.result.character.money,initial-50);
    assert.equal((await api(srv.url,"equipment/buy",{
      ...payload,requestId:"equip_http_duplicate"
    })).status,400);
    const worn=await api(srv.url,"equipment/equip",{
      itemId:id,requestId:"equip_http_wear"
    });
    assert.equal(worn.status,200);
    assert.equal(worn.result.equipmentItems.find(x=>x.id===id).status,"equipped");
    assert.equal((await api(srv.url,"equipment/sell",{
      itemId:id,requestId:"equip_http_sell_worn"
    })).status,400);
    const rubber=placed.result.equipmentGoods.find(x=>x.name==="輪ゴム鉄砲");
    const second=await api(srv.url,"equipment/buy",{
      sku:rubber.sku,requestId:"equip_http_second_buy"
    });
    assert.equal(second.status,200);
    const id2=second.result.equipmentResult.itemId;
    const swapped=await api(srv.url,"equipment/equip",{
      itemId:id2,requestId:"equip_http_swap"
    });
    assert.equal(swapped.status,200);
    assert.equal(swapped.result.equipmentItems.find(x=>x.id===id).status,"stored");
    assert.equal(swapped.result.equipmentItems.find(x=>x.id===id2).status,"equipped");
    const sale=await api(srv.url,"equipment/sell",{
      itemId:id,requestId:"equip_http_sale"
    });
    assert.equal(sale.status,200);
    assert.equal(sale.result.equipmentResult.amount,5);
    assert.equal(sale.result.character.money,initial-50-rubber.price+5);
    assert.equal(sale.result.equipmentItems.length,1);
    assert.equal(sale.result.equipmentTransactions.length,5);
    const again=await api(srv.url,"equipment/sell",{
      itemId:id,requestId:"equip_http_sale"
    });
    assert.equal(again.status,200);
    assert.equal(again.result.equipmentResult.replayed,true);
    assert.equal(again.result.character.money,sale.result.character.money);
    const removed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"空地"
    });
    assert.equal(removed.status,200);
    assert.equal(removed.result.equipmentAvailable,false);
    assert.equal((await api(srv.url,"equipment/buy",{
      sku:pencil.sku,requestId:"equip_http_after_removed"
    })).status,400);
    assert.equal((await api(srv.url,"equipment/equip",{
      itemId:id2,requestId:"equip_http_wear_without_shop"
    })).status,400);
  }finally{await srv.stop();}
});


test("原版鍛造 HTTP：從裝備屋購入後強化、已穿戴裝備可鍛造，重送與缺建築拒絕",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"裝備鍛造測試玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const placed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"装備屋"
    });
    assert.equal(placed.status,200);
    const item=placed.result.equipmentGoods.find(x=>x.name==="HBの鉛筆");
    assert.ok(item);
    const bought=await api(srv.url,"equipment/buy",{
      sku:item.sku,requestId:"forge_http_buy_pencil"
    });
    assert.equal(bought.status,200);
    const id=bought.result.equipmentResult.itemId;
    const initial=bought.result.character.money;
    const selected=bought.result.equipmentItems.find(x=>x.id===id);
    const invalid=await api(srv.url,"equipment/forge",{
      itemId:id,powerUp:2,usesUp:0,requestId:"forge_http_invalid_increment"
    });
    assert.equal(invalid.status,400);
    const forgeRequest={
      itemId:id,powerUp:1,usesUp:3,requestId:"forge_http_first_1_3"
    };
    const forged=await api(srv.url,"equipment/forge",forgeRequest);
    assert.equal(forged.status,200);
    assert.equal(forged.result.equipmentResult.amount,-13000);
    assert.equal(forged.result.character.money,initial-13000);
    assert.equal(forged.result.equipmentItems.find(x=>x.id===id).power,selected.power+1);
    assert.equal(forged.result.equipmentItems.find(x=>x.id===id).uses,selected.uses+3);
    const replay=await api(srv.url,"equipment/forge",forgeRequest);
    assert.equal(replay.status,200);
    assert.equal(replay.result.equipmentResult.replayed,true);
    assert.equal(replay.result.character.money,initial-13000);
    const collision=await api(srv.url,"equipment/forge",{
      ...forgeRequest,powerUp:3,usesUp:1
    });
    assert.equal(collision.status,400);
    const worn=await api(srv.url,"equipment/equip",{
      itemId:id,requestId:"forge_http_wear"
    });
    assert.equal(worn.status,200);
    const forgeWorn=await api(srv.url,"equipment/forge",{
      itemId:id,powerUp:0,usesUp:1,requestId:"forge_http_worn_uses"
    });
    assert.equal(forgeWorn.status,200);
    assert.equal(forgeWorn.result.equipmentItems.find(x=>x.id===id).status,"equipped");
    assert.equal(forgeWorn.result.equipmentItems.find(x=>x.id===id).uses,selected.uses+4);
    const noBuilding=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"空地"
    });
    assert.equal(noBuilding.status,200);
    const rejected=await api(srv.url,"equipment/forge",{
      itemId:id,powerUp:1,usesUp:0,requestId:"forge_http_without_building"
    });
    assert.equal(rejected.status,400);
    assert.equal(rejected.result.error.includes("裝備屋"),true);
  }finally{await srv.stop();}
});


test("禮品店 HTTP：必須設置原版建築，轉換真實本人 Web 33 欄物品並只收一次 50,000 元",async()=>{
  const srv=await start("solo");
  try{
    const a=await api(srv.url,"character",{name:"轉換禮品角色",gender:"other",stats:defaultStats()});
    assert.equal(a.status,200);
    assert.equal(a.result.giftShopAvailable,false);
    const tile=await api(srv.url,"map/tile",{row:0,column:0,symbol:"ギフト屋"});
    assert.equal(tile.status,200);
    assert.equal(tile.result.giftShopAvailable,true);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    const fields=Array(33).fill("0");
    fields[0]="美容";fields[1]="油取り紙";fields[9]="無";
    fields[21]="5";fields[22]="回";fields[30]=String(Math.floor(tile.result.gameTimeMs/1000));
    try{
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(1,'__web_retail__',1000001,'美容','油取り紙','無',5,'回',?,0,?)"
      ].join(" ")).run(Number(fields[30]),JSON.stringify(fields));
    }finally{db.close();}
    const state=await api(srv.url,"state");
    assert.equal(state.result.giftSources.find(x=>x.sourceLine===1000001).canConvert,true);
    const cash=state.result.character.money;
    const payload={sourceLine:1000001,quantity:2,requestId:"gift_http_convert_2"};
    const converted=await api(srv.url,"gift/convert",payload);
    assert.equal(converted.status,200);
    assert.equal(converted.result.giftResult.fee,50000);
    const giftLine=converted.result.giftResult.giftSourceLine;
    assert.ok(giftLine>=3000000);
    assert.equal(converted.result.character.money,cash-50000);
    assert.equal(converted.result.giftSources.find(x=>x.sourceLine===giftLine).category,"ギフト");
    assert.equal(converted.result.giftSources.find(x=>x.sourceLine===1000001).quantity,3);
    const again=await api(srv.url,"gift/convert",payload);
    assert.equal(again.status,200);
    assert.equal(again.result.giftResult.replayed,true);
    assert.equal(again.result.character.money,cash-50000);
    const removed=await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"});
    assert.equal(removed.status,200);
    assert.equal(removed.result.giftShopAvailable,false);
    const denied=await api(srv.url,"gift/convert",{
      sourceLine:1000001,quantity:1,requestId:"gift_http_after_removed"
    });
    assert.equal(denied.status,400);
    assert.match(denied.result.error,/沒有禮品店/);
  }finally{await srv.stop();}
});
test("多人禮品寄送 HTTP：寄件人扣耐久、收件人得到真實ギフト商品，防重與其他玩家隔離",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{username:"giftSenderMulti",password:"gift-sender-pass-123"});
    const b=await api(srv.url,"register",{username:"giftReceiverMulti",password:"gift-receiver-pass-123"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    const sender=await api(srv.url,"character",{
      name:"送禮測試甲",gender:"other",stats:defaultStats()
    },a.cookie);
    const recipient=await api(srv.url,"character",{
      name:"收禮測試乙",gender:"other",stats:defaultStats()
    },b.cookie);
    assert.equal(sender.status,200);assert.equal(recipient.status,200);
    const raw=Array(33).fill("0");
    raw[0]="ギフト";raw[1]="油取り紙";raw[9]="無";
    raw[21]="4";raw[22]="回";raw[30]=String(Math.floor(sender.result.gameTimeMs/1000));
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const senderId=db.prepare("SELECT user_id FROM characters WHERE name='送禮測試甲'").get().user_id;
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,'__web_retail__',1000001,'ギフト','油取り紙','無',4,'回',?,0,?)"
      ].join(" ")).run(senderId,Number(raw[30]),JSON.stringify(raw));
    }finally{db.close();}
    const payload={
      sourceLine:1000001,quantity:2,recipientName:"收禮測試乙",
      requestId:"gift_http_multi_send"
    };
    const sent=await api(srv.url,"gift/send",payload,a.cookie);
    assert.equal(sent.status,200);
    assert.equal(sent.result.giftResult.recipientUserId>0,true);
    assert.equal(sent.result.giftSources.find(x=>x.sourceLine===1000001).quantity,2);
    const recv=await api(srv.url,"state",undefined,b.cookie);
    const item=recv.result.legacyInventory.find(x=>x.name==="油取り紙");
    assert.ok(item);
    assert.equal(item.category,"ギフト商品");
    assert.equal(item.durability,2);
    assert.equal(item.readOnly,false);
    assert.equal(item.origin,"gift");
    assert.equal((await api(srv.url,"gift/send",payload,a.cookie)).result.giftResult.replayed,true);
    assert.equal((await api(srv.url,"gift/send",{
      ...payload,recipientName:"送禮測試甲",requestId:"gift_http_self_denied"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"gift/send",{
      sourceLine:item.sourceLine,quantity:1,recipientName:"送禮測試甲",
      requestId:"gift_http_other_source"
    },a.cookie)).status,400);
    const finalSender=await api(srv.url,"state",undefined,a.cookie);
    assert.equal(finalSender.result.giftSources.find(x=>x.sourceLine===1000001).quantity,2);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.giftEvents.length,0);
  }finally{await srv.stop();}
});


test("回收商店 HTTP：原版建築、本人出售、二手市場買回、30 分鐘拒售及防重",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"回收二手交易玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.recycleAvailable,false);
    const placed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"リサイ"
    });
    assert.equal(placed.status,200);
    assert.equal(placed.result.recycleAvailable,true);
    const fields=Array(33).fill("0");
    fields[0]="日用品";fields[1]="二手回收測試品";fields[9]="無";
    fields[21]="5";fields[22]="回";
    fields[30]=String(Math.floor((placed.result.gameTimeMs-31*60000)/1000));
    fields[31]="100";
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
        "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(1,'__web_retail__',1000001,'日用品','二手回收測試品','無',5,'回',?,0,?)"
      ].join(" ")).run(Number(fields[30]),JSON.stringify(fields));
    }finally{db.close();}
    const ready=await api(srv.url,"state");
    const sellable=ready.result.recycleSellable.find(x=>x.sourceLine===1000001);
    assert.ok(sellable);
    assert.equal(sellable.canSell,true);
    assert.equal(sellable.payout,500);
    const cash=ready.result.character.money;
    const payload={sourceLine:1000001,requestId:"recycle_http_sale_first"};
    const sold=await api(srv.url,"recycle/sell",payload);
    assert.equal(sold.status,200);
    assert.equal(sold.result.recycleResult.amount,500);
    assert.equal(sold.result.character.money,cash+500);
    assert.equal(sold.result.recycleListings.length,1);
    assert.equal(sold.result.legacyInventory.some(x=>x.sourceLine===1000001),false);
    const order=sold.result.recycleListings[0].id;
    const replay=await api(srv.url,"recycle/sell",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.recycleResult.replayed,true);
    assert.equal(replay.result.character.money,cash+500);
    const bought=await api(srv.url,"recycle/buy",{
      listingId:order,requestId:"recycle_http_buy_back"
    });
    assert.equal(bought.status,200);
    assert.equal(bought.result.recycleResult.amount,-500);
    assert.equal(bought.result.character.money,cash);
    assert.equal(bought.result.recycleListings.length,0);
    assert.equal(bought.result.legacyInventory.find(x=>x.origin==="recycle").category,"リサイクル");
    assert.equal((await api(srv.url,"recycle/buy",{
      listingId:order,requestId:"recycle_http_buyer_twice"
    })).status,400);
    const removed=await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"空地"
    });
    assert.equal(removed.status,200);
    assert.equal(removed.result.recycleAvailable,false);
    const denied=await api(srv.url,"recycle/sell",{
      sourceLine:bought.result.recycleResult.sourceLine,
      requestId:"recycle_http_missing_shop"
    });
    assert.equal(denied.status,400);
    assert.match(denied.result.error,/沒有回收商店/);
  }finally{await srv.stop();}
});


test("原版問屋 HTTP：必有本人住宅商店及地圖建築，普通銀行進貨、店鋪庫存與退貨",async()=>{
  const srv=await start("solo");
  try{
    const created=await api(srv.url,"character",{
      name:"批發商店測試玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.wholesaleAvailable,false);
    assert.deepEqual(created.result.myShops,[]);
    await api(srv.url,"move",{townId:3});
    const placedLot=await api(srv.url,"map/tile",{row:0,column:0,symbol:"空地"});
    assert.equal(placedLot.status,200);
    const bankDb=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{bankDb.prepare("UPDATE characters SET bank=100000000 WHERE name='批發商店測試玩家'").run();}
    finally{bankDb.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    });
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    assert.equal((await api(srv.url,"shop/config",{
      houseId,category:"食料品",title:"還沒室內欄位"
    })).status,400);
    const enabled=await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"1",title:"原版商店"}]
    });
    assert.equal(enabled.status,200);
    const configured=await api(srv.url,"shop/config",{
      houseId,category:"食料品",title:"試營運食料品店"
    });
    assert.equal(configured.status,200);
    assert.equal(configured.result.myShops[0].category,"食料品");
    assert.equal(configured.result.myShops[0].title,"試營運食料品店");
    assert.equal((await api(srv.url,"wholesale/buy",{
      houseId,sku:"wholesale-2",quantity:1,requestId:"wholesale_http_no_building"
    })).status,400);
    const map=await api(srv.url,"map/tile",{
      row:0,column:1,symbol:"問屋"
    });
    assert.equal(map.status,200);
    assert.equal(map.result.wholesaleAvailable,true);
    assert.equal(map.result.wholesaleGoods.length,120);
    const chosen=map.result.wholesaleGoods.find(x=>
      x.category==="食料品"&&x.stock>=3&&x.price<10000);
    assert.ok(chosen,"原版 120 種隨機貨架必須存在一項可測的日用品");
    const cash=map.result.character.money,bank=map.result.character.bank;
    const payload={houseId,sku:chosen.sku,quantity:2,
      requestId:"wholesale_http_buy_two"};
    const bought=await api(srv.url,"wholesale/buy",payload);
    assert.equal(bought.status,200);
    assert.equal(bought.result.wholesaleResult.amount,-chosen.price*2);
    assert.equal(bought.result.character.money,cash);
    assert.equal(bought.result.character.bank,bank-chosen.price*2);
    assert.equal(bought.result.myShops[0].inventory[0].quantity,2);
    assert.equal(bought.result.myShops[0].inventory[0].name,chosen.name);
    assert.equal(bought.result.legacyInventory.some(x=>x.name===chosen.name),false);
    assert.equal(bought.result.wholesaleGoods.find(x=>x.sku===chosen.sku).stock,
      chosen.stock-2);
    const retry=await api(srv.url,"wholesale/buy",payload);
    assert.equal(retry.status,200);
    assert.equal(retry.result.wholesaleResult.replayed,true);
    assert.equal(retry.result.character.bank,bank-chosen.price*2);
    assert.equal((await api(srv.url,"wholesale/buy",{
      ...payload,quantity:1
    })).status,400);
    const refund=await api(srv.url,"wholesale/return",{
      houseId,sku:chosen.sku,quantity:1,requestId:"wholesale_http_return_one"
    });
    assert.equal(refund.status,200);
    assert.equal(refund.result.wholesaleResult.amount,Math.floor(chosen.price*0.75));
    assert.equal(refund.result.myShops[0].inventory[0].quantity,1);
    assert.equal(refund.result.character.bank,
      bank-chosen.price*2+Math.floor(chosen.price*0.75));
    const deleted=await api(srv.url,"map/tile",{
      row:0,column:1,symbol:"空地"
    });
    assert.equal(deleted.status,200);
    assert.equal(deleted.result.wholesaleAvailable,false);
    assert.equal((await api(srv.url,"wholesale/buy",{
      houseId,sku:chosen.sku,quantity:1,requestId:"wholesale_http_removed_building"
    })).status,400);
    // 原版退貨由住宅商店入口進行，不需要問屋仍在同一張地圖。
    const remaining=await api(srv.url,"wholesale/return",{
      houseId,sku:chosen.sku,quantity:0,requestId:"wholesale_http_return_all"
    });
    assert.equal(remaining.status,200);
    assert.equal(remaining.result.myShops[0].inventory.length,0);
    assert.equal(remaining.result.wholesaleHistory.length,3);
  }finally{await srv.stop();}
});


test("多人住宅商店 HTTP：店主進貨與定價，訪客付款入庫，店主銀行收款與售罄防重",async()=>{
  const seed=directory=>{
    const db=new DatabaseSync(join(directory,"multi.sqlite"));
    db.exec("CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,original_name TEXT NOT NULL DEFAULT '',original_record TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    const tiles=Array(192).fill("");tiles[0]="空地";tiles[1]="問屋";
    db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(3,'和歌山アイランド','legacy-import',?,?)")
      .run(JSON.stringify(tiles),Date.now());
    db.close();
  };
  const srv=await start("multi",seed);
  try{
    const owner=await api(srv.url,"register",{username:"storeHttpOwner",password:"owner-password-123456"});
    const guest=await api(srv.url,"register",{username:"storeHttpGuest",password:"guest-password-123456"});
    assert.equal(owner.status,200);assert.equal(guest.status,200);
    assert.equal((await api(srv.url,"character",{name:"線上店主",gender:"other",stats:defaultStats()},owner.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{name:"線上買家",gender:"other",stats:defaultStats()},guest.cookie)).status,200);
    assert.equal((await api(srv.url,"move",{townId:3},owner.cookie)).status,200);
    assert.equal((await api(srv.url,"move",{townId:3},guest.cookie)).status,200);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{db.prepare("UPDATE characters SET bank=100000000 WHERE name='線上店主'").run();}
    finally{db.close();}
    const built=await api(srv.url,"house/build",{
      row:0,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"bank"
    },owner.cookie);
    assert.equal(built.status,200);
    const houseId=built.result.houses[0].id;
    assert.equal((await api(srv.url,"house/room/config",{
      houseId,slots:[{type:"1",title:"住宅商店"}]
    },owner.cookie)).status,200);
    const before=await api(srv.url,"state",undefined,owner.cookie);
    assert.equal(before.result.wholesaleAvailable,true);
    const pick=before.result.wholesaleGoods.find(x=>
      before.result.shopCategories.includes(x.category)&&
      x.category!=="スーパー"&&x.price>=10&&x.price<=10000&&x.stock>=3);
    assert.ok(pick,"問屋貨架應含可安全結帳的原版商品");
    assert.equal((await api(srv.url,"shop/config",{
      houseId,category:pick.category,title:"線上實體商店"
    },owner.cookie)).status,200);
    assert.equal((await api(srv.url,"wholesale/buy",{
      houseId,sku:pick.sku,quantity:3,requestId:"store_http_wholesale_in"
    },owner.cookie)).status,200);
    const publicStore=await api(srv.url,"shop/visit?houseId="+houseId,undefined,guest.cookie);
    assert.equal(publicStore.status,200);
    assert.equal(publicStore.result.items[0].stock,3);
    assert.equal(publicStore.result.items[0].price,pick.price*2);
    assert.equal((await api(srv.url,"shop/price",{
      houseId,sku:pick.sku,price:pick.price*2-1
    },guest.cookie)).status,400);
    const price=pick.price*2-1;
    assert.equal((await api(srv.url,"shop/price",{
      houseId,sku:pick.sku,price
    },owner.cookie)).status,200);
    const sellerBefore=(await api(srv.url,"state",undefined,owner.cookie)).result;
    const buyerBefore=(await api(srv.url,"state",undefined,guest.cookie)).result;
    const payload={
      houseId,sku:pick.sku,quantity:2,payment:"cash",requestId:"store_http_purchase_2"
    };
    const bought=await api(srv.url,"shop/buy",payload,guest.cookie);
    assert.equal(bought.status,200);
    assert.equal(bought.result.playerStoreResult.paid,price*2);
    assert.equal(bought.result.playerStoreResult.cashback,0);
    assert.equal(bought.result.character.money,buyerBefore.character.money-price*2);
    assert.ok(bought.result.legacyInventory.some(x=>
      x.origin==="store"&&x.name===pick.name&&x.readOnly===false));
    const seller=(await api(srv.url,"state",undefined,owner.cookie)).result;
    assert.equal(seller.character.bank,sellerBefore.character.bank+price*2);
    assert.equal(seller.myShops[0].inventory[0].quantity,1);
    assert.equal(seller.playerShopSales[0].role,"seller");
    const repeated=await api(srv.url,"shop/buy",payload,guest.cookie);
    assert.equal(repeated.status,200);
    assert.equal(repeated.result.playerStoreResult.replayed,true);
    assert.equal(repeated.result.character.money,buyerBefore.character.money-price*2);
    assert.equal((await api(srv.url,"shop/buy",{
      ...payload,quantity:1
    },guest.cookie)).status,400);
    const last=await api(srv.url,"shop/buy",{
      houseId,sku:pick.sku,quantity:1,payment:"cash",requestId:"store_http_last_one"
    },guest.cookie);
    assert.equal(last.status,200);
    assert.equal((await api(srv.url,"shop/visit?houseId="+houseId,undefined,guest.cookie)).result.items.length,0);
    assert.equal((await api(srv.url,"shop/buy",{
      houseId,sku:pick.sku,quantity:1,payment:"cash",requestId:"store_http_sold_out"
    },guest.cookie)).status,400);
  }finally{await srv.stop();}
});

test("HTTP：百貨買到原版日制書籍及効果甜點後真的可使用，期限不扣次數",async()=>{
  const catalog=parseLegacyRetailCatalog(
    decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
  );
  const book=catalog.find(x=>x.name==="こちら葛飾区亀有公園前派出所　全巻");
  const dessert=catalog.find(x=>x.name==="元気パフェ");
  assert.ok(book&&dessert);
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"character",{
      name:"日制道具實際驗收",gender:"other",stats:defaultStats()
    })).status,200);
    assert.equal((await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"デパ"
    })).status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const positions=new Set([book.sku,dessert.sku]);
      for(const target of [book,dessert]){
        const exists=db.prepare("SELECT position FROM retail_stock WHERE shop='depart1' AND sku=?")
          .get(target.sku);
        if(exists)continue;
        const next=db.prepare([
          "SELECT position FROM retail_stock WHERE shop='depart1' AND sku NOT IN (?,?)",
          "ORDER BY position LIMIT 1"
        ].join(" ")).get(book.sku,dessert.sku);
        assert.ok(next);
        db.prepare("UPDATE retail_stock SET sku=?,remaining=? WHERE shop='depart1' AND position=?")
          .run(target.sku,target.originalStock,next.position);
      }
      db.prepare("UPDATE characters SET money=1000000 WHERE name='日制道具實際驗收'").run();
    }finally{db.close();}
    const menu=await api(srv.url,"state");
    assert.equal(menu.status,200);
    assert.equal(menu.result.retailGoods.find(x=>x.sku===book.sku)?.details?.usage,"supported");
    assert.equal(menu.result.retailGoods.find(x=>x.sku===dessert.sku)?.details?.usage,"supported");
    const purchased=[];
    for(const [item,id] of [[book,"retail_day_book_buy"],[dessert,"retail_parfait_buy"]]){
      const bought=await api(srv.url,"retail/buy",{
        shop:"depart1",sku:item.sku,quantity:1,requestId:id
      });
      assert.equal(bought.status,200,item.name+" 應真實購買成功");
      purchased.push(bought.result.retailResult.sourceLine);
    }
    const owned=(await api(srv.url,"state")).result;
    const day=owned.legacyItemActions.find(x=>x.sourceLine===purchased[0]);
    assert.ok(day,"購入後的 30 日書籍應有使用動作");
    assert.equal(day.durabilityUnit,"日");
    assert.equal(day.remaining,30);
    const usedBook=await api(srv.url,"inventory/legacy/use",{
      sourceLine:purchased[0],requestId:"actual_day_book_use_01"
    });
    assert.equal(usedBook.status,200);
    assert.equal(usedBook.result.legacyItemActions.find(x=>x.sourceLine===purchased[0]).remaining,30);
    assert.equal(usedBook.result.itemUseResult.replayed,false);
    const restored=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{restored.prepare("UPDATE characters SET body_energy=0,recovered_at=?").run(Date.now());}
    finally{restored.close();}
    const usedDessert=await api(srv.url,"inventory/legacy/use",{
      sourceLine:purchased[1],requestId:"actual_parfait_use_01"
    });
    assert.equal(usedDessert.status,200);
    assert.ok(usedDessert.result.itemUseResult.changes.bodyEnergy>0);
    assert.equal(usedDessert.result.legacyItemActions.find(x=>x.sourceLine===purchased[1]).remaining,0);
    const again=await api(srv.url,"inventory/legacy/use",{
      sourceLine:purchased[0],requestId:"actual_day_book_use_01"
    });
    assert.equal(again.status,200);
    assert.equal(again.result.itemUseResult.replayed,true);
    assert.equal(again.result.legacyItemActions.find(x=>x.sourceLine===purchased[0]).remaining,30);
  }finally{await srv.stop();}
});

test("HTTP：百貨真實買入原版ランダム品後可使用，隨機增益有界且防重送",async()=>{
  const catalog=parseLegacyRetailCatalog(
    decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
  );
  const item=catalog.find(x=>x.category==="薬"&&x.name==="ランダム品");
  assert.ok(item);
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"character",{
      name:"隨機道具驗收",gender:"other",stats:defaultStats()
    })).status,200);
    assert.equal((await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"デパ"
    })).status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const exists=db.prepare("SELECT position FROM retail_stock WHERE shop='depart1' AND sku=?")
        .get(item.sku);
      if(!exists){
        const slot=db.prepare("SELECT position FROM retail_stock WHERE shop='depart1' AND sku<>? ORDER BY position LIMIT 1")
          .get(item.sku);
        assert.ok(slot);
        db.prepare("UPDATE retail_stock SET sku=?,remaining=? WHERE shop='depart1' AND position=?")
          .run(item.sku,item.originalStock,slot.position);
      }
      db.prepare("UPDATE characters SET money=10000000 WHERE name='隨機道具驗收'").run();
    }finally{db.close();}
    const before=(await api(srv.url,"state")).result;
    const listed=before.retailGoods.find(x=>x.sku===item.sku);
    assert.equal(listed?.details?.usage,"supported");
    assert.equal(listed?.details?.randomizedEffects,true);
    const bought=await api(srv.url,"retail/buy",{
      shop:"depart1",sku:item.sku,quantity:1,requestId:"random_http_buy_01"
    });
    assert.equal(bought.status,200);
    assert.equal(bought.result.retailResult.paid,6000000);
    assert.equal(bought.result.character.money,4000000);
    const line=bought.result.retailResult.sourceLine;
    assert.equal(bought.result.legacyItemActions.find(x=>x.sourceLine===line)?.remaining,10);
    const used=await api(srv.url,"inventory/legacy/use",{
      sourceLine:line,requestId:"random_http_use_01"
    });
    assert.equal(used.status,200);
    assert.equal(used.result.itemUseResult.replayed,false);
    for(const [key,was] of Object.entries(bought.result.character.stats)){
      const delta=used.result.character.stats[key]-was;
      assert.ok(Number.isInteger(delta)&&delta>=0&&delta<=10,key+" must roll within 0..10");
      assert.equal(used.result.itemUseResult.changes.stats[key]??0,delta);
    }
    assert.equal(used.result.legacyItemActions.find(x=>x.sourceLine===line)?.remaining,9);
    const replay=await api(srv.url,"inventory/legacy/use",{
      sourceLine:line,requestId:"random_http_use_01"
    });
    assert.equal(replay.status,200);
    assert.equal(replay.result.itemUseResult.replayed,true);
    assert.deepEqual(replay.result.itemUseResult.changes,used.result.itemUseResult.changes);
    assert.equal(replay.result.legacyItemActions.find(x=>x.sourceLine===line)?.remaining,9);
  }finally{await srv.stop();}
});

test("HTTP：百貨購入原版琵琶湖の水和無駄知識書籍後，能力、負熱量與日制使用真正生效",async()=>{
  const catalog=parseLegacyRetailCatalog(
    decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
  );
  const water=catalog.find(x=>x.category==="関西名産店"&&x.name==="琵琶湖の水");
  const book=catalog.find(x=>x.category==="書籍"&&x.name==="無駄知識を覚える本");
  assert.ok(water&&book);
  const srv=await start("solo");
  try{
    assert.equal((await api(srv.url,"character",{
      name:"負熱量與空万能實際驗收",gender:"other",stats:defaultStats()
    })).status,200);
    assert.equal((await api(srv.url,"map/tile",{
      row:0,column:0,symbol:"デパ"
    })).status,200);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      for(const item of [water,book]){
        if(db.prepare("SELECT 1 FROM retail_stock WHERE shop='depart1' AND sku=?").get(item.sku))continue;
        const free=db.prepare([
          "SELECT position FROM retail_stock WHERE shop='depart1'",
          "AND sku NOT IN (?,?) ORDER BY position LIMIT 1"
        ].join(" ")).get(water.sku,book.sku);
        assert.ok(free,"需有可讓原版商品上架的測試貨架");
        db.prepare("UPDATE retail_stock SET sku=?,remaining=? WHERE shop='depart1' AND position=?")
          .run(item.sku,item.originalStock,free.position);
      }
      db.prepare("UPDATE characters SET money=1000000 WHERE name='負熱量與空万能實際驗收'").run();
    }finally{db.close();}
    const initial=(await api(srv.url,"state")).result;
    for(const item of [water,book]){
      const offer=initial.retailGoods.find(x=>x.sku===item.sku);
      assert.equal(offer?.details?.usage,"supported",item.name);
    }
    const purchases=[];
    for(const [item,id] of [[water,"blank_water_buy_001"],[book,"blank_book_buy_001"]]){
      const bought=await api(srv.url,"retail/buy",{
        shop:"depart1",sku:item.sku,quantity:1,requestId:id
      });
      assert.equal(bought.status,200,item.name);
      purchases.push(bought.result.retailResult.sourceLine);
    }
    const owned=(await api(srv.url,"state")).result;
    const weightBefore=owned.character.weight;
    const healthBefore=owned.character.healthIndex;
    const waterUse=await api(srv.url,"inventory/legacy/use",{
      sourceLine:purchases[0],requestId:"blank_water_use_001"
    });
    assert.equal(waterUse.status,200);
    assert.equal(waterUse.result.itemUseResult.changes.healthIndex,0);
    assert.equal(waterUse.result.itemUseResult.changes.weight,-0.1);
    assert.equal(waterUse.result.character.weight,Math.round((weightBefore-0.1)*100)/100);
    assert.equal(waterUse.result.character.healthIndex,healthBefore);
    assert.equal(waterUse.result.itemUseResult.changes.stats.looks,10);
    assert.equal(waterUse.result.legacyItemActions.find(x=>x.sourceLine===purchases[0]).remaining,4);
    const bookUse=await api(srv.url,"inventory/legacy/use",{
      sourceLine:purchases[1],requestId:"blank_book_use_001"
    });
    assert.equal(bookUse.status,200);
    assert.equal(bookUse.result.itemUseResult.changes.healthIndex,0);
    assert.equal(bookUse.result.itemUseResult.changes.stats.kokugo,3);
    assert.equal(bookUse.result.itemUseResult.changes.stats.love,5);
    assert.equal(bookUse.result.legacyItemActions.find(x=>x.sourceLine===purchases[1]).remaining,5);
    const replay=await api(srv.url,"inventory/legacy/use",{
      sourceLine:purchases[1],requestId:"blank_book_use_001"
    });
    assert.equal(replay.status,200);
    assert.equal(replay.result.itemUseResult.replayed,true);
    assert.equal(replay.result.legacyItemActions.find(x=>x.sourceLine===purchases[1]).remaining,5);
  }finally{await srv.stop();}
});

test("多人 HTTP：受贈食品可實際食用，速食共用 60 分鐘冷卻且重送不重複扣除",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{username:"giftFoodSender45",password:"gift-food-sender-123"});
    const b=await api(srv.url,"register",{username:"giftFoodReceiver45",password:"gift-food-receiver-123"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    const sender=await api(srv.url,"character",{
      name:"食品寄件玩家45",gender:"other",stats:defaultStats()
    },a.cookie);
    const recipient=await api(srv.url,"character",{
      name:"食品收件玩家45",gender:"other",stats:defaultStats()
    },b.cookie);
    assert.equal(sender.status,200);assert.equal(recipient.status,200);
    const catalog=parseLegacyRetailCatalog(decodeLegacyText(
      readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))
    ));
    const products=[
      {name:"牛丼弁当",effect:"食料品",line:1000045},
      {name:"特級幻バーガー",effect:"ファ",line:1000046}
    ];
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const owner=db.prepare("SELECT user_id FROM characters WHERE name='食品寄件玩家45'").get().user_id;
      const seconds=Math.floor(sender.result.gameTimeMs/1000);
      for(const product of products){
        const item=catalog.find(x=>x.name===product.name);
        assert.ok(item,"原版商品不存在："+product.name);
        const raw=[...item.rawFields];
        raw[0]="ギフト";raw[9]=product.effect;raw[30]=String(seconds);
        db.prepare([
          "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
          "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
          "VALUES(?,'__web_gift__',?,'ギフト',?,?,?,?,?,?,?)"
        ].join(" ")).run(owner,product.line,raw[1],raw[9],
          Number(raw[21]),raw[22],seconds,0,JSON.stringify(raw));
      }
    }finally{db.close();}
    for(const product of products){
      const sent=await api(srv.url,"gift/send",{
        sourceLine:product.line,quantity:1,recipientName:"食品收件玩家45",
        requestId:"gift_food_http_send_"+product.line
      },a.cookie);
      assert.equal(sent.status,200,product.name);
    }
    const received=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(received.status,200);
    const sourceLines=products.map(product=>{
      const row=received.result.legacyInventory.find(x=>x.name===product.name);
      assert.ok(row);
      assert.equal(row.category,"ギフト商品");
      const action=received.result.legacyItemActions.find(x=>x.sourceLine===row.sourceLine);
      assert.ok(action,"確實有可操作使用動作："+product.name);
      assert.equal(action.food,true);
      return row.sourceLine;
    });
    const before=received.result.character;
    const used=await api(srv.url,"inventory/legacy/use",{
      sourceLine:sourceLines[0],requestId:"gift_food_http_use_bento"
    },b.cookie);
    assert.equal(used.status,200);
    assert.equal(used.result.itemUseResult.changes.food,true);
    assert.equal(used.result.itemUseResult.changes.weight,.72);
    assert.equal(used.result.character.weight,Math.round((before.weight+.72)*100)/100);
    const wait=await api(srv.url,"inventory/legacy/use",{
      sourceLine:sourceLines[1],requestId:"gift_food_http_use_burger_early"
    },b.cookie);
    assert.equal(wait.status,400);
    assert.match(wait.result.error,/60 分鐘/);
    const repeat=await api(srv.url,"inventory/legacy/use",{
      sourceLine:sourceLines[0],requestId:"gift_food_http_use_bento"
    },b.cookie);
    assert.equal(repeat.status,200);
    assert.equal(repeat.result.itemUseResult.replayed,true);
    const current=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(current.result.legacyItemActions.find(x=>x.sourceLine===sourceLines[0]).remaining,0);
    assert.equal(current.result.legacyItemActions.find(x=>x.sourceLine===sourceLines[1]).remaining,1);
    assert.equal(current.result.legacyItemHistory.length,1);
    const check=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const rows=check.prepare([
        "SELECT category,effect,raw_fields_json FROM legacy_inventory_items",
        "WHERE source_line=? AND original_name=?"
      ].join(" ")).all(sourceLines[0],"牛丼弁当");
      assert.equal(rows.length,1);
      assert.equal(rows[0].category,"ギフト商品");
      assert.equal(rows[0].effect,"食料品");
      assert.equal(JSON.parse(rows[0].raw_fields_json)[0],"ギフト商品");
    }finally{check.close();}
  }finally{await srv.stop();}
});

test("多人 HTTP：寄送附信和禮品同筆完成，雙方信箱隔離、重送不重寄、改文不得複用 ID",async()=>{
  const srv=await start("multi");
  try{
    const a=await api(srv.url,"register",{
      username:"phase46MailSender",password:"phase46-mail-sender-123"
    });
    const b=await api(srv.url,"register",{
      username:"phase46MailReader",password:"phase46-mail-reader-123"
    });
    const c=await api(srv.url,"register",{
      username:"phase46MailOther",password:"phase46-mail-other-123"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,200);
    const sender=await api(srv.url,"character",{
      name:"寄禮信件甲",gender:"other",stats:defaultStats()
    },a.cookie);
    const reader=await api(srv.url,"character",{
      name:"收禮信件乙",gender:"other",stats:defaultStats()
    },b.cookie);
    const other=await api(srv.url,"character",{
      name:"第三人信箱丙",gender:"other",stats:defaultStats()
    },c.cookie);
    assert.equal(sender.status,200);assert.equal(reader.status,200);assert.equal(other.status,200);
    const raw=Array(33).fill("0");
    raw[0]="ギフト";raw[1]="油取り紙";raw[9]="無";
    raw[21]="3";raw[22]="回";
    raw[30]=String(Math.floor(sender.result.gameTimeMs/1000));
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name=?").get("寄禮信件甲").user_id;
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
        "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,'__web_gift__',1000046,'ギフト','油取り紙','無',3,'回',?,0,?)"
      ].join(" ")).run(userId,Number(raw[30]),JSON.stringify(raw));
    }finally{db.close();}
    const payload={
      sourceLine:1000046,quantity:2,recipientName:"收禮信件乙",
      message:"這份禮品送給你，祝今天愉快！",
      requestId:"phase46_mail_http_send"
    };
    const sent=await api(srv.url,"gift/send",payload,a.cookie);
    assert.equal(sent.status,200);
    assert.equal(sent.result.giftResult.replayed,false);
    assert.equal(sent.result.giftMail.length,1);
    assert.equal(sent.result.giftMail[0].direction,"sent");
    assert.equal(sent.result.giftMail[0].otherName,"收禮信件乙");
    assert.equal(sent.result.giftMail[0].message,payload.message);
    assert.equal(sent.result.giftMail[0].quantity,2);
    const recv=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(recv.result.giftMail.length,1);
    assert.equal(recv.result.giftMail[0].direction,"inbox");
    assert.equal(recv.result.giftMail[0].otherName,"寄禮信件甲");
    assert.equal(recv.result.giftMail[0].message,payload.message);
    assert.equal(recv.result.giftMail[0].giftName,"油取り紙");
    assert.equal(recv.result.legacyInventory.find(x=>x.name==="油取り紙").durability,2);
    const outsider=await api(srv.url,"state",undefined,c.cookie);
    assert.deepEqual(outsider.result.giftMail,[]);
    const replay=await api(srv.url,"gift/send",payload,a.cookie);
    assert.equal(replay.status,200);
    assert.equal(replay.result.giftResult.replayed,true);
    assert.equal(replay.result.giftMail.length,1);
    const spoof=await api(srv.url,"gift/send",{
      ...payload,message:"企圖改寫既有送禮信件"
    },a.cookie);
    assert.equal(spoof.status,400);
    assert.match(spoof.result.error,/請求編號/);
    const verified=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(verified.result.giftMail.length,1);
    assert.equal(verified.result.giftMail[0].message,payload.message);
    assert.equal(verified.result.legacyInventory.filter(x=>x.name==="油取り紙").length,1);
    assert.equal(verified.result.giftEvents.length,0);
  }finally{await srv.stop();}
});


test("多人 HTTP：寄件帳號刪除後，仍可由收件者讀取自己的信件與已交付禮品",async()=>{
  const srv=await start("multi");
  try{
    const sentAccount=await api(srv.url,"register",{
      username:"phase47SafeSender",password:"phase47-sender-pass-123"
    });
    const inboxAccount=await api(srv.url,"register",{
      username:"phase47SafeReader",password:"phase47-reader-pass-123"
    });
    assert.equal(sentAccount.status,200);
    assert.equal(inboxAccount.status,200);
    const sender=await api(srv.url,"character",{
      name:"收發存續寄件者",gender:"other",stats:defaultStats()
    },sentAccount.cookie);
    const reader=await api(srv.url,"character",{
      name:"收發存續收件者",gender:"other",stats:defaultStats()
    },inboxAccount.cookie);
    assert.equal(sender.status,200);
    assert.equal(reader.status,200);
    const raw=Array(33).fill("0");
    raw[0]="ギフト";raw[1]="油取り紙";raw[9]="無";
    raw[21]="1";raw[22]="回";
    raw[30]=String(Math.floor(sender.result.gameTimeMs/1000));
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const senderId=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("收發存續寄件者").user_id;
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
        "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,'__web_gift__',1000047,'ギフト','油取り紙','無',1,'回',?,0,?)"
      ].join(" ")).run(senderId,Number(raw[30]),JSON.stringify(raw));
    }finally{db.close();}
    const sent=await api(srv.url,"gift/send",{
      sourceLine:1000047,quantity:1,recipientName:"收發存續收件者",
      message:"寄件者刪除帳號後這封信仍須保留",
      requestId:"phase47_safe_mail_http"
    },sentAccount.cookie);
    assert.equal(sent.status,200);
    assert.equal(sent.result.giftResult.replayed,false);
    const before=await api(srv.url,"state",undefined,inboxAccount.cookie);
    assert.equal(before.result.giftMail.length,1);
    assert.equal(before.result.giftMail[0].direction,"inbox");
    assert.equal(before.result.legacyInventory.some(x=>x.name==="油取り紙"),true);
    const writeDb=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      writeDb.exec("PRAGMA foreign_keys=ON");
      const senderId=writeDb.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("收發存續寄件者").user_id;
      writeDb.prepare("DELETE FROM users WHERE id=?").run(senderId);
      assert.equal(writeDb.prepare("PRAGMA foreign_key_check").all().length,0);
      assert.equal(writeDb.prepare("SELECT COUNT(*) AS n FROM gift_events").get().n,0);
    }finally{writeDb.close();}
    const after=await api(srv.url,"state",undefined,inboxAccount.cookie);
    assert.equal(after.status,200);
    assert.equal(after.result.giftMail.length,1);
    assert.equal(after.result.giftMail[0].otherName,"收發存續寄件者");
    assert.equal(after.result.giftMail[0].message,"寄件者刪除帳號後這封信仍須保留");
    assert.equal(after.result.legacyInventory.some(x=>x.name==="油取り紙"),true);
  }finally{await srv.stop();}
});


test("第48階段 HTTP：已有原版警官職業者縮短身高後仍可工作，重選職業會被阻止",async()=>{
  const srv=await start("solo");
  anchorSoloTestAtNoon(srv);
  try{
    const created=await api(srv.url,"character",{
      name:"任職後身高變化驗收",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const police=created.result.jobs.find(job=>job.originalName==="警官");
    assert.ok(police);
    assert.equal(police.minHeight,165);
    assert.equal(police.bmiMin,19);
    assert.equal(police.previousJob,null);
    const db=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const enriched=Object.fromEntries(Object.keys(defaultStats())
        .map(key=>[key,Math.max(200,police.requirements[key]??0)]));
      db.prepare([
        "UPDATE characters SET height=180,weight=65,bmi=20.1,",
        "stats_json=?,body_energy=200,brain_energy=200",
        "WHERE name='任職後身高變化驗收'"
      ].join(" ")).run(JSON.stringify(enriched));
    }finally{db.close();}
    const ready=await api(srv.url,"state");
    assert.equal(ready.result.jobs.find(job=>job.key===police.key).reason,null);
    const hired=await api(srv.url,"job",{key:police.key});
    assert.equal(hired.status,200);
    assert.equal(hired.result.character.jobId,police.key);
    const changedDb=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      // 原版身高改變但保持 BMI、能力與能量門檻，重現現有 Web 額外阻止工作的狀況。
      changedDb.prepare([
        "UPDATE characters SET height=160,weight=51,bmi=19.9",
        "WHERE name='任職後身高變化驗收'"
      ].join(" ")).run();
    }finally{changedDb.close();}
    const shorter=await api(srv.url,"state");
    assert.equal(shorter.result.jobs.find(job=>job.key===police.key).reason,"身高不足");
    assert.equal((await api(srv.url,"job",{key:police.key})).status,400,
      "重新應徵時仍必須遵守原版身高限制");
    const worked=await api(srv.url,"work",{});
    assert.equal(worked.status,200,"已正式任職的角色不會因身高變化而無法出勤");
    assert.equal(worked.result.character.jobId,police.key);
    assert.equal(worked.result.character.jobWorkCount,1);
    assert.equal((await api(srv.url,"work",{})).status,400,
      "不應藉門檻分流繞過原版五分鐘工作冷卻");
  }finally{await srv.stop();}
});

test("第48階段單機完整循環：工作→銀行→百貨→使用→重啟兩次→再出勤與用餐→跨日一次結息",async()=>{
  let srv=await start("solo");
  anchorSoloTestAtNoon(srv);
  const dataPath=srv.directory;
  try{
    const created=await api(srv.url,"character",{
      name:"重要系統跨重啟角色",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    const preference=await api(srv.url,"job/payment",{payment:"bank"});
    assert.equal(preference.status,200);
    const worked=await api(srv.url,"work",{});
    assert.equal(worked.status,200);
    assert.equal(worked.result.result.paid,1000);
    assert.equal(worked.result.character.bank,1000);
    assert.equal(worked.result.character.money,created.result.character.money);
    const saved=await api(srv.url,"bank",{action:"deposit",amount:2000});
    assert.equal(saved.status,200);
    assert.equal(saved.result.character.bank,3000);
    const mapped=await api(srv.url,"map/tile",{row:0,column:0,symbol:"デパ"});
    assert.equal(mapped.status,200);
    const catalog=parseLegacyRetailCatalog(
      decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
    );
    const book=catalog.find(item=>item.category==="書籍"&&item.name==="無駄知識を覚える本");
    assert.ok(book);
    const db=new DatabaseSync(join(dataPath,"solo.sqlite"));
    try{
      if(!db.prepare("SELECT 1 FROM retail_stock WHERE shop='depart1' AND sku=?")
        .get(book.sku)){
        const free=db.prepare([
          "SELECT position FROM retail_stock WHERE shop='depart1'",
          "AND sku<>? ORDER BY position LIMIT 1"
        ].join(" ")).get(book.sku);
        assert.ok(free);
        db.prepare([
          "UPDATE retail_stock SET sku=?,remaining=?",
          "WHERE shop='depart1' AND position=?"
        ].join(" ")).run(book.sku,book.originalStock,free.position);
      }
    }finally{db.close();}
    const offered=(await api(srv.url,"state")).result.retailGoods.find(g=>g.sku===book.sku);
    assert.equal(offered?.details?.usage,"supported");
    const purchase={shop:"depart1",sku:book.sku,quantity:1,
      requestId:"phase48_restart_purchase"};
    const bought=await api(srv.url,"retail/buy",purchase);
    assert.equal(bought.status,200);
    assert.equal(bought.result.retailResult.paid,book.unitPrice);
    const sourceLine=bought.result.retailResult.sourceLine;
    const usage={sourceLine,requestId:"phase48_restart_item_use"};
    const consumed=await api(srv.url,"inventory/legacy/use",usage);
    assert.equal(consumed.status,200);
    assert.equal(consumed.result.itemUseResult.replayed,false);
    const afterFirst=(await api(srv.url,"state")).result;
    assert.equal(afterFirst.character.salaryPayment,"bank");
    assert.equal(afterFirst.character.jobWorkCount,1);
    assert.equal(afterFirst.legacyItemActions.find(x=>x.sourceLine===sourceLine)?.remaining,5);
    assert.equal(afterFirst.retailPurchases.length,1);
    assert.equal(afterFirst.bankLedger.filter(x=>x.action==="工作薪資").length,1);

    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dataPath);
    const resumed=(await api(srv.url,"state")).result;
    assert.equal(resumed.character.name,created.result.character.name);
    assert.equal(resumed.character.money,afterFirst.character.money);
    assert.equal(resumed.character.bank,afterFirst.character.bank);
    assert.equal(resumed.character.salaryPayment,"bank");
    assert.equal(resumed.character.jobWorkCount,1);
    assert.deepEqual(resumed.character.stats,afterFirst.character.stats);
    assert.equal(resumed.retailPurchases.length,1);
    assert.equal(resumed.legacyItemActions.find(x=>x.sourceLine===sourceLine)?.remaining,5);
    assert.equal(resumed.bankLedger.filter(x=>x.action==="工作薪資").length,1);
    assert.equal(resumed.map.cells[0].key,"デパ");
    assert.equal((await api(srv.url,"work",{})).status,400,
      "重新啟動伺服器不能清除工作冷卻");
    const purchaseReplay=await api(srv.url,"retail/buy",purchase);
    assert.equal(purchaseReplay.status,200);
    assert.equal(purchaseReplay.result.retailResult.replayed,true);
    const useReplay=await api(srv.url,"inventory/legacy/use",usage);
    assert.equal(useReplay.status,200);
    assert.equal(useReplay.result.itemUseResult.replayed,true);
    assert.equal(useReplay.result.character.money,resumed.character.money);
    assert.equal(useReplay.result.legacyItemActions.find(x=>x.sourceLine===sourceLine)?.remaining,5);

    const jumped=await api(srv.url,"solo/time/advance",{preset:"5m"});
    assert.equal(jumped.status,200);
    const again=await api(srv.url,"work",{});
    assert.equal(again.status,200);
    assert.equal(again.result.result.payment,"bank");
    assert.equal(again.result.result.paid,1000);
    assert.equal(again.result.character.jobWorkCount,2);
    const affordable=again.result.meals.find(meal=>meal.stock>0&&
      meal.price<=again.result.character.money);
    assert.ok(affordable,"角色應能以實際賺得的資金購買一份食堂餐點");
    const ate=await api(srv.url,"meal/eat",{key:affordable.key});
    assert.equal(ate.status,200);
    assert.ok(ate.result.mealCooldownMs>0);
    assert.equal((await api(srv.url,"meal/eat",{key:affordable.key})).status,400);

    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dataPath);
    const second=(await api(srv.url,"state")).result;
    assert.equal(second.character.jobWorkCount,2);
    assert.equal(second.character.salaryPayment,"bank");
    assert.equal(second.bankLedger.filter(x=>x.action==="工作薪資").length,2);
    assert.ok(second.mealCooldownMs>0,"食堂冷卻不應隨伺服器重啟消失");
    assert.equal((await api(srv.url,"meal/eat",{key:affordable.key})).status,400);
    const nextDay=await api(srv.url,"solo/time/advance",{preset:"1d"});
    assert.equal(nextDay.status,200);
    assert.equal(nextDay.result.bankLedger.filter(x=>x.action==="普通存款利息").length,1);
    const refreshed=(await api(srv.url,"state")).result;
    assert.equal(refreshed.bankLedger.filter(x=>x.action==="普通存款利息").length,1,
      "跨日結息不能因重新查看狀態重複入帳");
    assert.equal(refreshed.mealCooldownMs,0);
    assert.equal(refreshed.character.jobWorkCount,2);
    assert.equal(refreshed.legacyItemActions.find(x=>x.sourceLine===sourceLine)?.remaining,4,
      "按日計效期道具跨一天應自然由五天降至四天，不可誤判為重啟失去存檔");
  }finally{await srv.stop();}
});

test("第48階段多人登入與重啟：兩帳號工作／銀行互不干涉，會話與冷卻持久化",async()=>{
  let srv=await start("multi");
  const dataPath=srv.directory;
  try{
    const a=await api(srv.url,"register",{
      username:"phase48AccountAlpha",password:"phase48-test-alpha-123"
    });
    const b=await api(srv.url,"register",{
      username:"phase48AccountBeta",password:"phase48-test-beta-123"
    });
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"跨重啟甲",gender:"other",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"跨重啟乙",gender:"other",stats:defaultStats()
    },b.cookie)).status,200);
    assert.equal((await api(srv.url,"job/payment",{payment:"bank"},a.cookie)).status,200);
    const awork=await api(srv.url,"work",{},a.cookie);
    const bwork=await api(srv.url,"work",{},b.cookie);
    assert.equal(awork.status,200);
    assert.equal(bwork.status,200);
    assert.equal(awork.result.character.bank,1000);
    assert.equal(bwork.result.character.bank,0);
    const bank=await api(srv.url,"bank",{action:"deposit",amount:3000},b.cookie);
    assert.equal(bank.status,200);
    assert.equal(bank.result.character.bank,3000);
    const beforeA=(await api(srv.url,"state",undefined,a.cookie)).result;
    const beforeB=(await api(srv.url,"state",undefined,b.cookie)).result;
    await srv.stop({preserveData:true});
    srv=await start("multi",undefined,dataPath);
    const afterA=await api(srv.url,"state",undefined,a.cookie);
    const afterB=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(afterA.status,200);
    assert.equal(afterB.status,200);
    assert.equal(afterA.result.character.name,"跨重啟甲");
    assert.equal(afterB.result.character.name,"跨重啟乙");
    for(const [before,after] of [[beforeA,afterA.result],[beforeB,afterB.result]]){
      assert.equal(after.character.money,before.character.money);
      assert.equal(after.character.bank,before.character.bank);
      assert.equal(after.character.salaryPayment,before.character.salaryPayment);
      assert.equal(after.character.jobWorkCount,1);
      assert.ok(after.workCooldownMs>0);
      assert.deepEqual(after.bankLedger,before.bankLedger);
    }
    assert.equal(afterA.result.bankLedger.some(x=>x.action==="存款"),false);
    assert.equal(afterA.result.bankLedger.filter(x=>x.action==="工作薪資").length,1);
    assert.equal(afterB.result.bankLedger.filter(x=>x.action==="工作薪資").length,0);
    assert.equal((await api(srv.url,"work",{},a.cookie)).status,400);
    assert.equal((await api(srv.url,"work",{},b.cookie)).status,400);
    assert.equal((await api(srv.url,"bank",{action:"withdraw",amount:3001},a.cookie)).status,400);
    const loggedOut=await api(srv.url,"logout",{},b.cookie);
    assert.equal(loggedOut.status,200);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.user,null);
    const login=await api(srv.url,"login",{
      username:"phase48AccountBeta",password:"phase48-test-beta-123"
    });
    assert.equal(login.status,200);
    assert.equal(login.result.character.bank,3000);
    assert.equal(login.result.character.jobWorkCount,1);
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.character.bank,1000);
    assert.equal((await api(srv.url,"state",undefined,login.cookie)).result.character.name,"跨重啟乙");
  }finally{await srv.stop();}
});


test("第49階段多人 HTTP：獨立信件＋禮品共用信箱，權限、刪信與重啟後收件仍在",async()=>{
  let srv=await start("multi");
  const dataPath=srv.directory;
  try{
    const a=await api(srv.url,"register",{
      username:"phase49MailAlpha",password:"phase49-mail-alpha-123"
    });
    const b=await api(srv.url,"register",{
      username:"phase49MailBeta",password:"phase49-mail-beta-123"
    });
    const c=await api(srv.url,"register",{
      username:"phase49MailGamma",password:"phase49-mail-gamma-123"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,200);
    for(const [cookie,name] of [[a.cookie,"新信寄件角色"],[b.cookie,"新信收件角色"],
      [c.cookie,"無關郵件角色"]]){
      assert.equal((await api(srv.url,"character",{name,gender:"other",
        stats:defaultStats()},cookie)).status,200);
    }
    const textBody="<img src=x onerror=alert(1)> 這裡有一封普通站內信";
    const payload={
      recipientName:"新信收件角色",message:textBody,requestId:"phase49_http_mail_01"
    };
    const sent=await api(srv.url,"mail/send",payload,a.cookie);
    assert.equal(sent.status,200);
    assert.equal(sent.result.mailResult.replayed,false);
    assert.equal(sent.result.mailbox.length,1);
    assert.equal(sent.result.mailbox[0].type,"plain");
    assert.equal(sent.result.mailbox[0].direction,"sent");
    assert.equal(sent.result.mailbox[0].message,textBody);
    assert.equal(sent.result.giftMail.length,0,"不能把純文字信當成寄禮信");
    const received=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(received.result.mailbox.length,1);
    assert.equal(received.result.mailbox[0].direction,"inbox");
    assert.equal(received.result.mailbox[0].message,textBody);
    const outsider=await api(srv.url,"state",undefined,c.cookie);
    assert.deepEqual(outsider.result.mailbox,[]);
    assert.equal((await api(srv.url,"mail/send",payload)).status,401);
    assert.equal((await api(srv.url,"mail/send",payload,a.cookie)).result.mailResult.replayed,true);
    assert.equal((await api(srv.url,"mail/send",{
      ...payload,message:"試圖改寫信件"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"mail/send",{
      ...payload,recipientName:"新信寄件角色",requestId:"phase49_http_self"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"mail/send",{
      ...payload,message:"",requestId:"phase49_http_empty"
    },a.cookie)).status,400);

    const ownSentId=sent.result.mailbox[0].id;
    const inboxId=received.result.mailbox[0].id;
    assert.notEqual(ownSentId,inboxId);
    assert.equal((await api(srv.url,"mail/delete",{mailId:inboxId},a.cookie)).status,400);
    assert.equal((await api(srv.url,"mail/delete",{mailId:inboxId},c.cookie)).status,400);
    const deleted=await api(srv.url,"mail/delete",{mailId:ownSentId},a.cookie);
    assert.equal(deleted.status,200);
    assert.equal(deleted.result.mailbox.length,0);
    assert.equal((await api(srv.url,"state",undefined,b.cookie)).result.mailbox.length,1);

    const reply=await api(srv.url,"mail/send",{
      recipientName:"新信寄件角色",message:"收到，這是回信",
      requestId:"phase49_http_mail_reply"
    },b.cookie);
    assert.equal(reply.status,200);
    assert.equal(reply.result.mailbox.length,2);
    assert.deepEqual(reply.result.mailbox.map(m=>m.type),["plain","plain"]);
    const raw=Array(33).fill("0");
    raw[0]="ギフト";raw[1]="油取り紙";raw[9]="無";
    raw[21]="2";raw[22]="回";
    raw[30]=String(Math.floor(Date.now()/1000));
    const db=new DatabaseSync(join(dataPath,"multi.sqlite"));
    try{
      const senderId=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("新信寄件角色").user_id;
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,",
        "original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
        "VALUES(?,'__web_gift__',1000049,'ギフト','油取り紙','無',2,'回',?,0,?)"
      ].join(" ")).run(senderId,Number(raw[30]),JSON.stringify(raw));
    }finally{db.close();}
    const gifted=await api(srv.url,"gift/send",{
      sourceLine:1000049,quantity:1,recipientName:"新信收件角色",
      message:"另一封附有禮品",requestId:"phase49_http_gift_01"
    },a.cookie);
    assert.equal(gifted.status,200);
    assert.equal(gifted.result.mailbox.length,2);
    assert.equal(gifted.result.mailbox[0].type,"gift");
    const both=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(both.result.mailbox.length,3);
    assert.equal(both.result.giftMail.length,1);
    assert.equal(both.result.mailbox.filter(m=>m.type==="gift").length,1);
    assert.equal(both.result.mailbox.filter(m=>m.type==="plain").length,2);
    assert.equal(both.result.legacyInventory.some(item=>item.name==="油取り紙"),true);
    const deleteDb=new DatabaseSync(join(dataPath,"multi.sqlite"));
    try{
      deleteDb.exec("PRAGMA foreign_keys=ON");
      const senderId=deleteDb.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("新信寄件角色").user_id;
      deleteDb.prepare("DELETE FROM users WHERE id=?").run(senderId);
      assert.equal(deleteDb.prepare("PRAGMA foreign_key_check").all().length,0);
    }finally{deleteDb.close();}
    const afterDelete=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(afterDelete.status,200);
    assert.equal(afterDelete.result.mailbox.length,3);
    assert.equal(afterDelete.result.mailbox[0].giftName,"油取り紙");
    assert.equal(afterDelete.result.legacyInventory.some(item=>item.name==="油取り紙"),true);

    await srv.stop({preserveData:true});
    srv=await start("multi",undefined,dataPath);
    const restored=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(restored.status,200);
    assert.equal(restored.result.mailbox.length,3);
    assert.deepEqual(restored.result.mailbox.map(m=>m.message),
      afterDelete.result.mailbox.map(m=>m.message));
    assert.equal(restored.result.giftMail.length,1);
    assert.equal(restored.result.legacyInventory.some(item=>item.name==="油取り紙"),true);
    assert.deepEqual((await api(srv.url,"state",undefined,c.cookie)).result.mailbox,[]);
  }finally{await srv.stop();}
});


test("第50階段單機首次遊玩：空白街區一鍵配置後可工作、百貨購物、建屋、重啟保留資料",async()=>{
  let srv=await start("solo");
  const directory=srv.directory;
  try{
    assert.equal((await api(srv.url,"solo/map/starter",{})).status,409,
      "必須先建立自己的單機角色");
    const created=await api(srv.url,"character",{
      name:"單機街區初次探索者",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.map.configured,false);
    assert.equal(created.result.retailAvailable.length,0);
    assert.equal(created.result.equipmentAvailable,false);
    assert.equal(created.result.vendingAvailable,false);

    const first=await api(srv.url,"solo/map/starter",{townId:3});
    assert.equal(first.status,200);
    assert.deepEqual(first.result.mapStarterResult,{
      townId:0,placed:21,source:"web-solo-starter"
    },"初始化只能配置伺服器上的目前城鎮，不接受客戶端冒填城鎮");
    assert.equal(first.result.map.source,"web-solo-starter");
    assert.equal(first.result.map.configured,true);
    assert.equal(first.result.map.cells.length,192);
    assert.equal(first.result.map.cells.filter(x=>x.raw).length,21);
    const expected=[
      [0,0,"駅"],[0,1,"職安"],[0,2,"銀行"],[0,3,"病院"],
      [1,0,"食堂"],[1,1,"食堂２"],[1,2,"デパ"],[1,3,"デパ2"],
      [2,0,"自販機"],[2,1,"装備屋"],[2,2,"教室"],[2,3,"建築"],
      [3,0,"空地"],[3,1,"空地2"],[3,2,"リサイ"],[3,3,"空地3"],[3,4,"クーポン"],[3,5,"販売1"],[3,6,"釣り"]
    ];
    for(const [row,column,symbol] of expected)
      assert.equal(first.result.map.cells[row*16+column].key,symbol);
    assert.deepEqual(first.result.retailAvailable,["depart1","depart2"]);
    assert.equal(first.result.equipmentAvailable,true);
    assert.equal(first.result.vendingAvailable,true);
    assert.equal(first.result.recycleAvailable,true);
    assert.ok(first.result.map.palette.length>16);
    assert.equal(first.result.character.money,created.result.character.money,
      "配置建築不可任意發錢或扣款");

    const worked=await api(srv.url,"work",{});
    assert.equal(worked.status,200);
    assert.equal(worked.result.result.paid,1000);
    const deposited=await api(srv.url,"bank",{action:"deposit",amount:500});
    assert.equal(deposited.status,200);
    assert.equal(deposited.result.character.bank,500);

    const goods=deposited.result.retailGoods.find(x=>x.stock>0&&
      x.price>0&&x.price<=deposited.result.character.money);
    assert.ok(goods,"試玩街區已可實際購買一件原版百貨商品");
    const purchase=await api(srv.url,"retail/buy",{
      shop:"depart1",sku:goods.sku,quantity:1,requestId:"phase50_solo_first_purchase"
    });
    assert.equal(purchase.status,200);
    assert.equal(purchase.result.retailResult.paid,goods.price);
    assert.equal(purchase.result.legacyInventory.some(x=>x.name===goods.name),true);
    const timeBefore=(await api(srv.url,"state")).result.gameTimeOffsetMs;

    const db=new DatabaseSync(join(directory,"solo.sqlite"));
    try{
      // 僅測試住宅真正扣款／實際地圖占用；來源的建造費不靠試玩配置補貼。
      db.prepare("UPDATE characters SET money=100000000 WHERE name=?")
        .run("單機街區初次探索者");
    }finally{db.close();}
    const built=await api(srv.url,"house/build",{
      row:3,column:0,image:"house/kamakura.gif",interiorRank:3,payment:"cash"
    });
    assert.equal(built.status,200);
    assert.equal(built.result.houses.length,1);
    assert.equal(built.result.houses[0].location,"D1");
    assert.equal(built.result.map.cells[3*16].category,"house");
    assert.ok(built.result.houseResult.quote.total>0);
    assert.equal(built.result.character.money,100000000-built.result.houseResult.quote.total);
    assert.equal((await api(srv.url,"solo/map/starter",{})).status,400,
      "已配置或已建屋時再次初始化不能毀掉玩家進度");
    assert.equal((await api(srv.url,"map/tile",{
      row:3,column:0,symbol:"銀行"
    })).status,400,"地圖編輯器亦不得覆蓋已持有住宅");
    const prior=await api(srv.url,"state");
    assert.equal(prior.result.gameTimeOffsetMs,timeBefore);
    const before=prior.result;
    assert.equal(before.retailPurchases.length,1);
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,directory);
    const after=(await api(srv.url,"state")).result;
    assert.equal(after.map.configured,true);
    assert.equal(after.map.cells[0].key,"駅");
    assert.equal(after.map.cells[1*16+2].key,"デパ");
    assert.equal(after.map.cells[3*16].category,"house");
    assert.equal(after.houses.length,1);
    assert.equal(after.houses[0].id,before.houses[0].id);
    assert.equal(after.character.money,before.character.money);
    assert.equal(after.character.bank,before.character.bank);
    assert.equal(after.character.jobWorkCount,before.character.jobWorkCount);
    assert.equal(after.gameTimeOffsetMs,before.gameTimeOffsetMs);
    assert.equal(after.retailPurchases.length,1);
    assert.equal(after.legacyInventory.some(x=>x.name===goods.name),true);
    assert.equal((await api(srv.url,"solo/map/starter",{})).status,400);
  }finally{await srv.stop();}
});

test("第50階段單機試玩街區：原版匯入地圖不能覆蓋，多人模式絕不允許建立",async()=>{
  const seeded=directory=>{
    const db=new DatabaseSync(join(directory,"solo.sqlite"));
    try{
      db.exec([
        "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,",
        "original_name TEXT NOT NULL DEFAULT '',",
        "original_record TEXT NOT NULL DEFAULT '',",
        "source TEXT NOT NULL,tiles_json TEXT NOT NULL,",
        "updated_at INTEGER NOT NULL);"
      ].join(" "));
      const tiles=Array(192).fill("");
      tiles[0]="銀行";
      db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
        .run(0,"原始街區","legacy-import",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
  };
  const solo=await start("solo",seeded);
  try{
    assert.equal((await api(solo.url,"character",{
      name:"保護匯入街區",gender:"other",stats:defaultStats()
    })).status,200);
    assert.equal((await api(solo.url,"solo/map/starter",{})).status,400);
    const unchanged=(await api(solo.url,"state")).result;
    assert.equal(unchanged.map.source,"legacy-import");
    assert.equal(unchanged.map.cells[0].raw,"銀行");
    assert.equal(unchanged.map.cells.filter(x=>x.raw).length,1);
  }finally{await solo.stop();}
  const multi=await start("multi");
  try{
    const registered=await api(multi.url,"register",{
      username:"phase50SoloOnly",password:"phase50-solo-only-pass-123"
    });
    assert.equal(registered.status,200);
    assert.equal((await api(multi.url,"character",{
      name:"多人無權建立試玩城鎮",gender:"other",stats:defaultStats()
    },registered.cookie)).status,200);
    assert.equal((await api(multi.url,"solo/map/starter",{},registered.cookie)).status,403);
    assert.equal((await api(multi.url,"state",undefined,registered.cookie)).result.map.configured,false);
  }finally{await multi.stop();}
});


test("第51階段單機事件券實際兌換：原版兌換所→扣點→33欄獎品入庫→重新啟動",async()=>{
  let srv=await start("solo");
  const directory=srv.directory;
  try{
    const created=await api(srv.url,"character",{
      name:"單機事件優惠券兌換者",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.couponShopAvailable,false);
    assert.equal(created.result.couponRewards.length,30);
    assert.equal(created.result.couponRewards[0].originalName,"福引券");
    assert.equal(created.result.couponRewards[0].requiredCoupons,1);
    const db=new DatabaseSync(join(directory,"solo.sqlite"));
    try{
      const id=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("單機事件優惠券兌換者").user_id;
      db.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)").run(id,4);
    }finally{db.close();}
    const absent=await api(srv.url,"coupon/redeem",{
      sourceIndex:0,originalName:"福引券",requestId:"phase51_coupon_no_building"
    });
    assert.equal(absent.status,400);
    assert.match(absent.result.error,/沒有優惠券兌換所/);
    assert.equal((await api(srv.url,"state")).result.couponBalance,4);
    const layout=await api(srv.url,"solo/map/starter",{});
    assert.equal(layout.status,200);
    assert.equal(layout.result.map.cells[3*16+4].key,"クーポン");
    assert.equal(layout.result.couponShopAvailable,true);
    assert.equal(layout.result.couponRewards.length,30);
    assert.equal(layout.result.couponRewards[0].canRedeem,true);
    assert.equal(layout.result.couponRewards[1].canRedeem,false);
    const name="福引券";
    const payload={sourceIndex:0,originalName:name,requestId:"phase51_solo_redeem_first"};
    assert.equal((await api(srv.url,"coupon/redeem",{
      ...payload,originalName:"４次元福袋"
    })).status,400);
    const redeem=await api(srv.url,"coupon/redeem",payload);
    assert.equal(redeem.status,200);
    assert.equal(redeem.result.couponResult.couponCost,1);
    assert.equal(redeem.result.couponResult.replayed,false);
    assert.equal(redeem.result.couponBalance,3);
    assert.equal(redeem.result.couponRedemptions.length,1);
    const item=redeem.result.legacyInventory.find(x=>x.origin==="coupon");
    assert.equal(item.name,name);
    assert.equal(item.readOnly,false);
    assert.ok(item.sourceLine>=6000000);
    assert.equal(redeem.result.couponRedemptions[0].sourceLine,item.sourceLine);
    const persistedDb=new DatabaseSync(join(directory,"solo.sqlite"));
    try{
      const row=persistedDb.prepare([
        "SELECT raw_fields_json,original_name,durability,durability_unit,original_id",
        "FROM legacy_inventory_items WHERE source_line=?"
      ].join(" ")).get(item.sourceLine);
      assert.equal(row.original_name,name);
      assert.equal(row.original_id,"__web_coupon__");
      assert.equal(JSON.parse(row.raw_fields_json).length,33);
      assert.equal(row.durability_unit,"日");
    }finally{persistedDb.close();}
    const replay=await api(srv.url,"coupon/redeem",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.couponResult.replayed,true);
    assert.equal(replay.result.couponBalance,3);
    assert.equal(replay.result.legacyInventory.filter(x=>x.origin==="coupon").length,1);
    assert.equal((await api(srv.url,"coupon/redeem",{
      ...payload,sourceIndex:1,originalName:"４次元福袋"
    })).status,400);
    assert.equal((await api(srv.url,"coupon/redeem",{
      sourceIndex:1,originalName:"４次元福袋",requestId:"phase51_expensive_reward"
    })).status,400,"原版150點獎品須先存到足額，不是免費領");
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,directory);
    const restored=await api(srv.url,"state");
    assert.equal(restored.status,200);
    assert.equal(restored.result.couponBalance,3);
    assert.equal(restored.result.couponShopAvailable,true);
    assert.equal(restored.result.couponRedemptions.length,1);
    assert.equal(restored.result.legacyInventory.filter(x=>x.origin==="coupon").length,1);
    assert.equal((await api(srv.url,"coupon/redeem",payload)).result.couponResult.replayed,true);
    assert.equal((await api(srv.url,"state")).result.couponBalance,3);
  }finally{await srv.stop();}
});

test("第51階段多人 HTTP：角色各自券點與獎品不得跨帳號借用",async()=>{
  const seeded=dir=>{
    const db=new DatabaseSync(join(dir,"multi.sqlite"));
    try{
      db.exec([
        "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,",
        "original_name TEXT NOT NULL DEFAULT '',",
        "original_record TEXT NOT NULL DEFAULT '',",
        "source TEXT NOT NULL,tiles_json TEXT NOT NULL,updated_at INTEGER NOT NULL);"
      ].join(" "));
      const tiles=Array(192).fill("");tiles[1]="クーポン";
      db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
        .run(0,"共用城鎮","legacy-import",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
  };
  const srv=await start("multi",seeded);
  try{
    const a=await api(srv.url,"register",{username:"phase51RedeemAlpha",
      password:"phase51-redeem-alpha-123"});
    const b=await api(srv.url,"register",{username:"phase51RedeemBeta",
      password:"phase51-redeem-beta-123"});
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"兌換角色甲",gender:"other",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"兌換角色乙",gender:"other",stats:defaultStats()
    },b.cookie)).status,200);
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("兌換角色甲").user_id;
      db.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(?,?)").run(userId,1);
    }finally{db.close();}
    const payload={sourceIndex:0,originalName:"福引券",requestId:"phase51_multi_redeem_01"};
    assert.equal((await api(srv.url,"coupon/redeem",payload)).status,401);
    assert.equal((await api(srv.url,"coupon/redeem",payload,b.cookie)).status,400);
    const claimed=await api(srv.url,"coupon/redeem",payload,a.cookie);
    assert.equal(claimed.status,200);
    assert.equal(claimed.result.couponBalance,0);
    assert.equal(claimed.result.couponRedemptions.length,1);
    const other=await api(srv.url,"state",undefined,b.cookie);
    assert.equal(other.result.couponBalance,0);
    assert.equal(other.result.couponRedemptions.length,0);
    assert.equal(other.result.legacyInventory.filter(x=>x.origin==="coupon").length,0);
    assert.equal((await api(srv.url,"coupon/redeem",{
      ...payload,requestId:"phase51_multi_redeem_02"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"coupon/redeem",payload,a.cookie)).result.couponResult.replayed,true);
  }finally{await srv.stop();}
});


test("第53階段單機 HTTP：買真正原版魚餌→釣魚耗餌及100秒冷卻→賣漁獲→重啟存檔完整保留",async()=>{
  let srv=await start("solo");
  const dir=srv.directory;
  try{
    assert.equal((await api(srv.url,"fishing/bait/buy",{
      sku:"fake",requestId:"phase53_no_character"
    })).status,400);
    const created=await api(srv.url,"character",{
      name:"第53階段釣魚居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.fishing.fishingAvailable,false);
    assert.equal(created.result.fishing.baitShopAvailable,false);
    assert.deepEqual(created.result.fishing.baitGoods,[]);
    const starter=await api(srv.url,"solo/map/starter",{});
    assert.equal(starter.status,200);
    assert.equal(starter.result.mapStarterResult.placed,21);
    assert.equal(starter.result.map.cells[3*16+5].key,"販売1");
    assert.equal(starter.result.map.cells[3*16+6].key,"釣り");
    assert.equal(starter.result.fishing.fishingAvailable,true);
    assert.equal(starter.result.fishing.baitShopAvailable,true);
    assert.equal(starter.result.fishing.baitGoods.length,4);
    const shrimp=starter.result.fishing.baitGoods.find(x=>x.name==="小エビ");
    assert.ok(shrimp);
    assert.equal(shrimp.price,100);
    assert.equal(shrimp.durability,1);
    assert.equal(shrimp.stock,50);
    assert.equal((await api(srv.url,"fishing/bait/buy",{
      sku:"fake",requestId:"phase53_fake_bait"
    })).status,400);
    const before=starter.result.character.money;
    const payload={sku:shrimp.sku,requestId:"phase53_http_buy"};
    const bought=await api(srv.url,"fishing/bait/buy",payload);
    assert.equal(bought.status,200);
    assert.equal(bought.result.fishingResult.name,"小エビ");
    assert.equal(bought.result.character.money,before-100);
    assert.equal(bought.result.fishing.baitGoods.find(x=>x.sku===shrimp.sku).stock,49);
    assert.equal(bought.result.legacyInventory.some(x=>
      x.name==="小エビ"&&x.origin==="fishing"),true);
    const fishBait=bought.result.fishingResult.sourceLine;
    const repeat=await api(srv.url,"fishing/bait/buy",payload);
    assert.equal(repeat.status,200);
    assert.equal(repeat.result.fishingResult.replayed,true);
    assert.equal(repeat.result.character.money,before-100);
    const first=await api(srv.url,"fishing/cast",{
      sourceLine:fishBait,requestId:"phase53_http_cast"
    });
    assert.equal(first.status,200);
    assert.equal(first.result.fishingResult.baitName,"小エビ");
    assert.equal(typeof first.result.fishingResult.caught,"boolean");
    assert.equal(first.result.fishing.baitOptions.some(x=>x.sourceLine===fishBait),false);
    if(first.result.fishingResult.caught){
      const name=first.result.fishingResult.catchName;
      assert.ok(["小魚","ミニたこ","ホタルイカ"].includes(name));
      assert.equal(first.result.legacyInventory.some(x=>x.name===name&&x.origin==="fishing"),true);
    }
    assert.equal((await api(srv.url,"fishing/cast",{
      sourceLine:fishBait,requestId:"phase53_http_second_cast"
    })).status,400);
    assert.equal((await api(srv.url,"fishing/cast",{
      sourceLine:fishBait,requestId:"phase53_http_cast"
    })).result.fishingResult.replayed,true);
    // 競價支線用原版 sea.cgi 的真實「小魚」33欄來源，只在測試 DB
    // 注入一件釣獲來驗證 HTTP 賣出；正式玩家無可自行指定漁獲的 API。
    const src=decodeLegacyText(readFileSync(join(root,"..","sea.cgi")));
    const line=src.split("\n").find(x=>x.includes("'魚<>小魚<>"));
    assert.ok(line);
    let raw=line.match(/'([^']+)'/)[1].replace(/\\n$/,"").split("<>");
    if(raw.length===34&&raw[33]==="")raw.pop();
    assert.equal(raw.length,33);
    const itemLine=7000999;
    const db=new DatabaseSync(join(dir,"solo.sqlite"));
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("第53階段釣魚居民").user_id;
      raw[30]=String(Math.floor(first.result.gameTimeMs/1000));
      db.prepare([
        "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,",
        "category,original_name,effect,durability,durability_unit,purchased_at,",
        "last_used_at,raw_fields_json) VALUES(?,'__web_fishing__',7000999,",
        "'魚','小魚','無',1,'回',?,0,?)"
      ].join(" ")).run(userId,Number(raw[30]),JSON.stringify(raw));
    }finally{db.close();}
    const sell=await api(srv.url,"fishing/sell",{
      sourceLine:itemLine,requestId:"phase53_http_sale"
    });
    assert.equal(sell.status,200);
    assert.equal(sell.result.fishingResult.name,"小魚");
    assert.ok(sell.result.fishingResult.paid>=51&&sell.result.fishingResult.paid<=150);
    assert.equal(sell.result.fishing.sellOptions.some(x=>x.sourceLine===itemLine),false);
    assert.equal(sell.result.fishing.history[0].action,"sell");
    const savedMoney=sell.result.character.money;
    const savedHistory=sell.result.fishing.history.length;
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dir);
    const after=await api(srv.url,"state");
    assert.equal(after.status,200);
    assert.equal(after.result.character.money,savedMoney);
    assert.equal(after.result.fishing.history.length,savedHistory);
    assert.equal(after.result.fishing.baitGoods.find(x=>x.sku===shrimp.sku).stock,49);
    assert.equal(after.result.fishing.sellOptions.some(x=>x.sourceLine===itemLine),false);
    assert.equal((await api(srv.url,"fishing/sell",{
      sourceLine:itemLine,requestId:"phase53_http_sale"
    })).result.fishingResult.replayed,true);
    assert.equal((await api(srv.url,"state")).result.character.money,savedMoney);
  }finally{await srv.stop();}
});


test("第54階段單機 HTTP：原版合成屋→真正扣材料→成品33欄入庫→重送與重啟持久化",async()=>{
  let srv=await start("solo");
  const dir=srv.directory;
  try{
    const created=await api(srv.url,"character",{
      name:"第54階段合成居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.crafting.available,false);
    assert.equal(created.result.crafting.recipes.length,12);
    const recipe=created.result.crafting.recipes.find(x=>x.name==="アイスコーヒー");
    assert.ok(recipe);
    assert.equal((await api(srv.url,"crafting/make",{
      recipeKey:recipe.key,quantity:1,requestId:"phase54_no_house"
    })).status,400);
    const starter=await api(srv.url,"solo/map/starter",{});
    assert.equal(starter.status,200);
    assert.equal(starter.result.mapStarterResult.placed,21);
    assert.equal(starter.result.map.cells[3*16+7].key,"合成");
    assert.equal(starter.result.crafting.available,true);
    assert.equal(starter.result.crafting.recipes.length,12);
    const goods=decodeLegacyText(readFileSync(join(root,"..","dat_dir","syouhin.cgi")))
      .split(/\r?\n/).filter(Boolean).map(line=>{
        const fields=line.split("<>");
        if(fields.length===34&&fields[33]==="")fields.pop();
        return fields;
      }).filter(fields=>fields.length===33);
    const db=new DatabaseSync(join(dir,"solo.sqlite"));
    const lines=[810001,810002];
    try{
      const userId=db.prepare("SELECT user_id FROM characters WHERE name=?")
        .get("第54階段合成居民").user_id;
      for(const [name,sourceLine] of [["冷蔵庫",lines[0]],["コーヒー",lines[1]]]){
        const original=goods.find(row=>row[1]===name);
        assert.ok(original);
        const fields=[...original];
        fields[21]="2";fields[22]="回";
        fields[30]=String(Math.floor(starter.result.gameTimeMs/1000));
        db.prepare([
          "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
          "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
          "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        ].join(" ")).run(userId,"__web_retail__",sourceLine,fields[0],name,
          fields[9],2,"回",Number(fields[30]),0,JSON.stringify(fields));
      }
    }finally{db.close();}
    const overview=(await api(srv.url,"state")).result.crafting;
    assert.equal(overview.recipes.find(x=>x.key===recipe.key).maxBatches,2);
    const request={recipeKey:recipe.key,quantity:2,requestId:"phase54_http_craft_first"};
    assert.equal((await api(srv.url,"crafting/make",{
      ...request,recipeKey:"craft-fake"
    })).status,400);
    assert.equal((await api(srv.url,"crafting/make",{
      ...request,quantity:0
    })).status,400);
    const made=await api(srv.url,"crafting/make",request);
    assert.equal(made.status,200);
    assert.equal(made.result.craftingResult.name,"アイスコーヒー");
    assert.equal(made.result.craftingResult.quantity,2);
    assert.equal(made.result.craftingResult.addedDurability,2);
    assert.equal(made.result.craftingResult.fee,0);
    assert.equal(made.result.crafting.history.length,1);
    assert.equal(made.result.character.money,starter.result.character.money);
    const sourceLine=made.result.craftingResult.sourceLine;
    assert.ok(sourceLine>=8000000);
    const product=made.result.legacyInventory.find(x=>
      x.sourceLine===sourceLine&&x.origin==="crafting");
    assert.ok(product);
    assert.equal(product.name,"アイスコーヒー");
    assert.equal(product.remaining,2);
    const check=new DatabaseSync(join(dir,"solo.sqlite"));
    try{
      for(const line of lines){
        assert.equal(check.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=?")
          .get(line).remaining,0);
      }
      const stored=check.prepare("SELECT * FROM legacy_inventory_items WHERE source_line=?").get(sourceLine);
      assert.equal(stored.original_id,"__web_crafting__");
      assert.equal(stored.durability,2);
      assert.equal(JSON.parse(stored.raw_fields_json).length,33);
    }finally{check.close();}
    const replay=await api(srv.url,"crafting/make",request);
    assert.equal(replay.status,200);
    assert.equal(replay.result.craftingResult.replayed,true);
    assert.equal(replay.result.crafting.history.length,1);
    assert.equal((await api(srv.url,"crafting/make",{
      ...request,quantity:1
    })).status,400);
    assert.equal((await api(srv.url,"crafting/make",{
      recipeKey:recipe.key,quantity:1,requestId:"phase54_http_no_material"
    })).status,400);
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dir);
    const restored=await api(srv.url,"state");
    assert.equal(restored.status,200);
    assert.equal(restored.result.crafting.available,true);
    assert.equal(restored.result.crafting.history.length,1);
    assert.equal(restored.result.character.money,starter.result.character.money);
    assert.equal(restored.result.legacyInventory.find(x=>x.sourceLine===sourceLine).remaining,2);
    assert.equal((await api(srv.url,"crafting/make",request)).result.craftingResult.replayed,true);
  }finally{await srv.stop();}
});


test("第55階段單機 HTTP：骰子遊戲建築→原版奇偶下注→5分鐘限制→重送→重啟存檔",async()=>{
  let srv=await start("solo");
  const dir=srv.directory;
  try{
    const missing=await api(srv.url,"arcade/dice/play",{
      guess:"even",stake:10000,requestId:"phase55_no_character"
    });
    assert.equal(missing.status,400);
    const created=await api(srv.url,"character",{
      name:"第55階段擲骰玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.arcadeDice.available,false);
    assert.deepEqual(created.result.arcadeDice.rates,[10000,50000,100000,500000,1000000]);
    assert.equal((await api(srv.url,"arcade/dice/play",{
      guess:"even",stake:10000,requestId:"phase55_no_game_build"
    })).status,400);
    const starter=await api(srv.url,"solo/map/starter",{});
    assert.equal(starter.status,200);
    assert.equal(starter.result.mapStarterResult.placed,21);
    assert.equal(starter.result.map.cells[3*16+8].key,"ゲーセン");
    assert.equal(starter.result.arcadeDice.available,true);
    assert.equal(starter.result.arcadeDice.cooldownMs,300000);
    const startMoney=starter.result.character.money;
    const payload={guess:"even",stake:10000,requestId:"phase55_http_first_dice"};
    assert.equal((await api(srv.url,"arcade/dice/play",{
      ...payload,stake:10001
    })).status,400);
    assert.equal((await api(srv.url,"arcade/dice/play",{
      ...payload,guess:"both"
    })).status,400);
    const first=await api(srv.url,"arcade/dice/play",payload);
    assert.equal(first.status,200);
    const dice=first.result.arcadeDiceResult;
    assert.ok(dice.dieOne>=1&&dice.dieOne<=6);
    assert.ok(dice.dieTwo>=1&&dice.dieTwo<=6);
    assert.equal(dice.total,dice.dieOne+dice.dieTwo);
    assert.equal(dice.won,dice.total%2===0);
    assert.equal(dice.delta,dice.won?10000:-10000);
    assert.equal(first.result.character.money,startMoney+dice.delta);
    assert.equal(first.result.arcadeDice.history.length,1);
    assert.equal(first.result.arcadeDice.history[0].total,dice.total);
    assert.equal(first.result.arcadeDice.readyAt,dice.playedAt+300000);
    const replay=await api(srv.url,"arcade/dice/play",payload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.arcadeDiceResult.replayed,true);
    assert.equal(replay.result.character.money,first.result.character.money);
    assert.equal((await api(srv.url,"arcade/dice/play",{
      ...payload,guess:"odd"
    })).status,400);
    assert.equal((await api(srv.url,"arcade/dice/play",{
      guess:"odd",stake:50000,requestId:"phase55_http_too_soon"
    })).status,400);
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    const second=await api(srv.url,"arcade/dice/play",{
      guess:"odd",stake:50000,requestId:"phase55_http_second_dice"
    });
    assert.equal(second.status,200);
    assert.equal(second.result.arcadeDiceResult.stake,50000);
    assert.equal(second.result.arcadeDice.history.length,2);
    const savedMoney=second.result.character.money;
    const firstBalance=first.result.character.money;
    assert.equal(savedMoney,firstBalance+second.result.arcadeDiceResult.delta);
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dir);
    const restored=await api(srv.url,"state");
    assert.equal(restored.status,200);
    assert.equal(restored.result.arcadeDice.available,true);
    assert.equal(restored.result.arcadeDice.history.length,2);
    assert.equal(restored.result.character.money,savedMoney);
    assert.equal(restored.result.map.cells[3*16+8].key,"ゲーセン");
    assert.equal((await api(srv.url,"arcade/dice/play",payload)).result.arcadeDiceResult.replayed,true);
    assert.equal((await api(srv.url,"state")).result.character.money,savedMoney);
  }finally{await srv.stop();}
});

test("第55階段多人 HTTP：遊樂中心骰子紀錄、下注與冷卻只屬於本人，其他帳號不可借用",async()=>{
  const seed=dir=>{
    const db=new DatabaseSync(join(dir,"multi.sqlite"));
    try{
      db.exec([
        "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,",
        "original_name TEXT NOT NULL DEFAULT '',",
        "original_record TEXT NOT NULL DEFAULT '',",
        "source TEXT NOT NULL,tiles_json TEXT NOT NULL,",
        "updated_at INTEGER NOT NULL);"
      ].join(" "));
      const tiles=Array(192).fill("");tiles[0]="ゲーセン";
      db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
        .run(0,"測試城鎮","legacy-import",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
  };
  const srv=await start("multi",seed);
  try{
    const a=await api(srv.url,"register",{
      username:"phase55DiceAlpha",password:"phase55-dice-alpha-pass-123"
    });
    const b=await api(srv.url,"register",{
      username:"phase55DiceBeta",password:"phase55-dice-beta-pass-123"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"擲骰多人甲",gender:"other",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"擲骰多人乙",gender:"other",stats:defaultStats()
    },b.cookie)).status,200);
    const payload={guess:"even",stake:10000,requestId:"phase55_shared_request"};
    assert.equal((await api(srv.url,"arcade/dice/play",payload)).status,401);
    const first=await api(srv.url,"arcade/dice/play",payload,a.cookie);
    assert.equal(first.status,200);
    const second=await api(srv.url,"arcade/dice/play",payload,b.cookie);
    assert.equal(second.status,200,"不同帳號可以使用自己的相同請求碼");
    assert.equal(first.result.arcadeDice.history.length,1);
    assert.equal(second.result.arcadeDice.history.length,1);
    assert.equal((await api(srv.url,"arcade/dice/play",{
      ...payload,requestId:"phase55_alpha_cooldown"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"arcade/dice/play",{
      ...payload,requestId:"phase55_beta_cooldown"
    },b.cookie)).status,400);
    assert.equal((await api(srv.url,"arcade/dice/play",payload,b.cookie)).result.arcadeDiceResult.replayed,true);
    const afterA=(await api(srv.url,"state",undefined,a.cookie)).result;
    const afterB=(await api(srv.url,"state",undefined,b.cookie)).result;
    assert.equal(afterA.arcadeDice.history.length,1);
    assert.equal(afterB.arcadeDice.history.length,1);
    assert.equal(afterA.arcadeDice.history[0].delta,first.result.arcadeDiceResult.delta);
    assert.equal(afterB.arcadeDice.history[0].delta,second.result.arcadeDiceResult.delta);
  }finally{await srv.stop();}
});


test("第56階段單機 HTTP：High/Low 空桌原版種子、真實現金輸贏、十分鐘、重送及重啟存檔",async()=>{
  let srv=await start("solo");
  const directory=srv.directory;
  try{
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"hi",requestId:"phase56_missing_character"
    })).status,400);
    const created=await api(srv.url,"character",{
      name:"第56階段卡牌玩家",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.arcadeHighLow.available,false);
    assert.equal(created.result.arcadeHighLow.previousCard,null);
    assert.equal(created.result.arcadeHighLow.stake,10000);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"hi",requestId:"phase56_missing_arcade"
    })).status,400);
    const starter=await api(srv.url,"solo/map/starter",{});
    assert.equal(starter.status,200);
    assert.equal(starter.result.arcadeHighLow.available,true);
    assert.equal(starter.result.arcadeHighLow.cooldownMs,600000);
    assert.equal(starter.result.arcadeHighLow.cardCount,1);
    assert.equal(starter.result.arcadeHighLow.recentCards[0],1);
    const initialCash=starter.result.character.money;
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"equal",requestId:"phase56_invalid_guess"
    })).status,400);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"hi",requestId:"short"
    })).status,400);
    const firstPayload={guess:"hi",requestId:"phase56_first_round"};
    const first=await api(srv.url,"arcade/highlow/play",firstPayload);
    assert.equal(first.status,200);
    const result=first.result.arcadeHighLowResult;
    assert.equal(result.previousCard,null);
    assert.ok(result.drawnCard>=1&&result.drawnCard<=5);
    assert.equal(result.cardsBefore,1);
    assert.equal(result.cardsAfter,2);
    assert.equal(result.stake,10000);
    assert.equal(result.delta,10000);
    assert.equal(result.won,true);
    assert.equal(first.result.character.money,initialCash+10000);
    assert.equal(first.result.arcadeHighLow.stake,20000);
    assert.equal(first.result.arcadeHighLow.previousCard,result.drawnCard);
    assert.equal(first.result.arcadeHighLow.readyAt,result.playedAt+600000);
    const replay=await api(srv.url,"arcade/highlow/play",firstPayload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.arcadeHighLowResult.replayed,true);
    assert.equal(replay.result.character.money,first.result.character.money);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      ...firstPayload,guess:"low"
    })).status,400);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"low",requestId:"phase56_cooldown_reject"
    })).status,400);
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"low",requestId:"phase56_still_cooling"
    })).status,400);
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    const second=await api(srv.url,"arcade/highlow/play",{
      guess:"low",requestId:"phase56_second_round"
    });
    assert.equal(second.status,200);
    assert.equal(second.result.arcadeHighLowResult.stake,20000);
    const change=second.result.arcadeHighLowResult.delta;
    assert.ok([-20000,20000,40000].includes(change));
    assert.equal(second.result.character.money,initialCash+10000+change);
    assert.equal(second.result.arcadeHighLow.history.length,2);
    const balance=second.result.character.money;
    const previous=second.result.arcadeHighLow.previousCard;
    const cards=second.result.arcadeHighLow.cardCount;
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,directory);
    const restored=await api(srv.url,"state");
    assert.equal(restored.status,200);
    assert.equal(restored.result.character.money,balance);
    assert.equal(restored.result.arcadeHighLow.available,true);
    assert.equal(restored.result.arcadeHighLow.previousCard,previous);
    assert.equal(restored.result.arcadeHighLow.cardCount,cards);
    assert.equal(restored.result.arcadeHighLow.history.length,2);
    const again=await api(srv.url,"arcade/highlow/play",firstPayload);
    assert.equal(again.status,200);
    assert.equal(again.result.arcadeHighLowResult.replayed,true);
    assert.equal(again.result.character.money,balance);
  }finally{await srv.stop();}
});

test("第56階段多人 HTTP：遊樂中心共用HighLow牌桌、本人歷史及請求碼隔離",async()=>{
  const seed=dir=>{
    const db=new DatabaseSync(join(dir,"multi.sqlite"));
    try{
      db.exec([
        "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,",
        "original_name TEXT NOT NULL DEFAULT '',",
        "original_record TEXT NOT NULL DEFAULT '',",
        "source TEXT NOT NULL,tiles_json TEXT NOT NULL,",
        "updated_at INTEGER NOT NULL);"
      ].join(" "));
      const tiles=Array(192).fill("");tiles[0]="ゲーセン";
      db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
        .run(0,"測試街區","legacy-import",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
  };
  const srv=await start("multi",seed);
  try{
    const a=await api(srv.url,"register",{
      username:"phase56HighLowA",password:"phase56-high-low-alpha-pass"
    });
    const b=await api(srv.url,"register",{
      username:"phase56HighLowB",password:"phase56-high-low-beta-pass"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"高低卡牌甲",gender:"other",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"高低卡牌乙",gender:"other",stats:defaultStats()
    },b.cookie)).status,200);
    const payload={guess:"hi",requestId:"phase56_shared_request"};
    assert.equal((await api(srv.url,"arcade/highlow/play",payload)).status,401);
    const first=await api(srv.url,"arcade/highlow/play",payload,a.cookie);
    assert.equal(first.status,200);
    const second=await api(srv.url,"arcade/highlow/play",payload,b.cookie);
    assert.equal(second.status,200);
    assert.equal(second.result.arcadeHighLowResult.previousCard,first.result.arcadeHighLowResult.drawnCard);
    assert.equal(second.result.arcadeHighLowResult.stake,20000);
    assert.equal(second.result.arcadeHighLow.cardCount,second.result.arcadeHighLowResult.cardsAfter);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"low",requestId:"phase56_player_a_cooldown"
    },a.cookie)).status,400);
    assert.equal((await api(srv.url,"arcade/highlow/play",{
      guess:"low",requestId:"phase56_player_b_cooldown"
    },b.cookie)).status,400);
    assert.equal((await api(srv.url,"arcade/highlow/play",payload,a.cookie)).result.arcadeHighLowResult.replayed,true);
    const stateA=(await api(srv.url,"state",undefined,a.cookie)).result;
    const stateB=(await api(srv.url,"state",undefined,b.cookie)).result;
    assert.equal(stateA.arcadeHighLow.history.length,1);
    assert.equal(stateB.arcadeHighLow.history.length,1);
    assert.equal(stateA.arcadeHighLow.previousCard,stateB.arcadeHighLow.previousCard);
    assert.equal(stateA.arcadeHighLow.cardCount,stateB.arcadeHighLow.cardCount);
    assert.equal(stateA.arcadeHighLow.history[0].drawnCard,first.result.arcadeHighLowResult.drawnCard);
    assert.equal(stateB.arcadeHighLow.history[0].drawnCard,second.result.arcadeHighLowResult.drawnCard);
  }finally{await srv.stop();}
});


test("第57階段單機HTTP：三種donus獨立牌桌、原版空桌、現金結算、冷卻、防重與重啟持久化",async()=>{
  let srv=await start("solo");
  const dir=srv.directory;
  try{
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus",requestId:"phase57_no_character"
    })).status,400);
    const created=await api(srv.url,"character",{
      name:"第57階段抽牌居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.arcadeDonuts.available,false);
    assert.deepEqual(created.result.arcadeDonuts.modes.map(m=>m.mode),
      ["donus","donus2","donus3"]);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus",requestId:"phase57_without_arcade"
    })).status,400);
    const starter=await api(srv.url,"solo/map/starter",{});
    assert.equal(starter.status,200);
    assert.equal(starter.result.mapStarterResult.placed,21);
    assert.equal(starter.result.arcadeDonuts.available,true);
    assert.equal(starter.result.map.cells[3*16+8].key,"ゲーセン");
    for(const m of starter.result.arcadeDonuts.modes){
      assert.equal(m.cardCount,1);
      assert.equal(m.previousCard,null);
      assert.deepEqual(m.recentCards,[1]);
    }
    const db=new DatabaseSync(join(dir,"solo.sqlite"));
    try{
      db.prepare("UPDATE characters SET money=500000 WHERE name=?")
        .run("第57階段抽牌居民");
    }finally{db.close();}
    assert.equal((await api(srv.url,"state")).result.character.money,500000);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus4",requestId:"phase57_bad_mode"
    })).status,400);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus",requestId:"short"
    })).status,400);
    const firstPayload={mode:"donus",requestId:"phase57_mode1_first"};
    const first=await api(srv.url,"arcade/donuts/draw",firstPayload);
    assert.equal(first.status,200);
    const a=first.result.arcadeDonutResult;
    assert.equal(a.mode,"donus");
    assert.equal(a.previousCard,null);
    assert.ok(a.drawnCard>=1&&a.drawnCard<=5);
    assert.equal(a.won,true,"空白上一張Perl比較0，模式一第一局一定抽到不同點數");
    assert.equal(a.delta,10000);
    assert.equal(a.cardsAfter,2);
    assert.equal(first.result.character.money,510000);
    assert.equal(first.result.arcadeDonuts.modes.find(m=>m.mode==="donus").risk,20000);
    const replay=await api(srv.url,"arcade/donuts/draw",firstPayload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.arcadeDonutResult.replayed,true);
    assert.equal(replay.result.character.money,510000);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      ...firstPayload,mode:"donus2"
    })).status,400);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus",requestId:"phase57_mode1_cooldown"
    })).status,400);
    const mode2=await api(srv.url,"arcade/donuts/draw",{
      mode:"donus2",requestId:"phase57_mode2_first"
    });
    assert.equal(mode2.status,200);
    assert.equal(mode2.result.arcadeDonutResult.delta,20000);
    assert.equal(mode2.result.arcadeDonutResult.cardsAfter,2);
    assert.equal(mode2.result.character.money,530000);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus2",requestId:"phase57_mode2_cooldown"
    })).status,400);
    const mode3=await api(srv.url,"arcade/donuts/draw",{
      mode:"donus3",requestId:"phase57_mode3_first"
    });
    assert.equal(mode3.status,200);
    const c=mode3.result.arcadeDonutResult;
    assert.ok(c.drawnCard>=1&&c.drawnCard<=3);
    assert.equal(c.won,c.drawnCard===1);
    assert.equal(c.delta,c.won?100000:-100000);
    assert.equal(c.cardsAfter,c.won?1:2);
    assert.equal(c.risk,100000);
    assert.equal(c.winAmount,100000);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus3",requestId:"phase57_mode3_cooldown"
    })).status,400);
    const firstAfter=mode3.result.character.money;
    assert.equal(firstAfter,530000+c.delta);
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    const mode1Second=await api(srv.url,"arcade/donuts/draw",{
      mode:"donus",requestId:"phase57_mode1_second"
    });
    assert.equal(mode1Second.status,200);
    assert.equal(mode1Second.result.arcadeDonutResult.risk,20000);
    assert.equal(mode1Second.result.arcadeDonutResult.winAmount,20000);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus2",requestId:"phase57_mode2_still_cooling"
    })).status,400);
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    const mode2Second=await api(srv.url,"arcade/donuts/draw",{
      mode:"donus2",requestId:"phase57_mode2_second"
    });
    assert.equal(mode2Second.status,200);
    assert.equal(mode2Second.result.arcadeDonutResult.risk,40000);
    assert.equal(mode2Second.result.arcadeDonutResult.winAmount,40000);
    assert.equal(mode2Second.result.arcadeDonuts.modes.find(m=>m.mode==="donus2").history.length,2);
    const mode3Second=await api(srv.url,"arcade/donuts/draw",{
      mode:"donus3",requestId:"phase57_mode3_second"
    });
    assert.equal(mode3Second.status,200);
    assert.equal(mode3Second.result.arcadeDonutResult.risk,100000);
    const moneySaved=mode3Second.result.character.money;
    const tableSaved=mode3Second.result.arcadeDonuts.modes.map(m=>({
      mode:m.mode,previousCard:m.previousCard,cardCount:m.cardCount,
      history:m.history.length
    }));
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dir);
    const restored=await api(srv.url,"state");
    assert.equal(restored.status,200);
    assert.equal(restored.result.character.money,moneySaved);
    assert.equal(restored.result.arcadeDonuts.available,true);
    assert.deepEqual(restored.result.arcadeDonuts.modes.map(m=>({
      mode:m.mode,previousCard:m.previousCard,cardCount:m.cardCount,
      history:m.history.length
    })),tableSaved);
    const repeated=await api(srv.url,"arcade/donuts/draw",firstPayload);
    assert.equal(repeated.status,200);
    assert.equal(repeated.result.arcadeDonutResult.replayed,true);
    assert.equal(repeated.result.character.money,moneySaved);
  }finally{await srv.stop();}
});

test("第57階段多人HTTP：三模式共桌但彼此獨立，下注與本人紀錄不會混用",async()=>{
  const seed=dir=>{
    const db=new DatabaseSync(join(dir,"multi.sqlite"));
    try{
      db.exec([
        "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,",
        "original_name TEXT NOT NULL DEFAULT '',",
        "original_record TEXT NOT NULL DEFAULT '',",
        "source TEXT NOT NULL,tiles_json TEXT NOT NULL,",
        "updated_at INTEGER NOT NULL);"
      ].join(" "));
      const tiles=Array(192).fill("");tiles[0]="ゲーセン";
      db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
        .run(0,"測試街區","legacy-import",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
  };
  const srv=await start("multi",seed);
  try{
    const a=await api(srv.url,"register",{
      username:"phase57DonutUserA",password:"phase57-strong-password-a"
    });
    const b=await api(srv.url,"register",{
      username:"phase57DonutUserB",password:"phase57-strong-password-b"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"抽牌多人甲",gender:"other",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"抽牌多人乙",gender:"other",stats:defaultStats()
    },b.cookie)).status,200);
    const request={mode:"donus",requestId:"phase57_same_request"};
    assert.equal((await api(srv.url,"arcade/donuts/draw",request)).status,401);
    const first=await api(srv.url,"arcade/donuts/draw",request,a.cookie);
    assert.equal(first.status,200);
    assert.equal(first.result.arcadeDonutResult.cardsBefore,1);
    const second=await api(srv.url,"arcade/donuts/draw",request,b.cookie);
    assert.equal(second.status,200);
    assert.equal(second.result.arcadeDonutResult.cardsBefore,2);
    assert.equal(second.result.arcadeDonuts.modes.find(m=>m.mode==="donus2").cardCount,1);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      ...request,mode:"donus2"
    },a.cookie)).status,400);
    const otherMode=await api(srv.url,"arcade/donuts/draw",{
      mode:"donus2",requestId:"phase57_mode2_other"
    },a.cookie);
    assert.equal(otherMode.status,200);
    assert.equal(otherMode.result.arcadeDonutResult.cardsBefore,1);
    const stateA=(await api(srv.url,"state",undefined,a.cookie)).result;
    const stateB=(await api(srv.url,"state",undefined,b.cookie)).result;
    const mode=(s,key)=>s.arcadeDonuts.modes.find(m=>m.mode===key);
    assert.equal(mode(stateA,"donus").cardCount,mode(stateB,"donus").cardCount);
    assert.equal(mode(stateA,"donus").previousCard,mode(stateB,"donus").previousCard);
    assert.equal(mode(stateA,"donus").history.length,1);
    assert.equal(mode(stateB,"donus").history.length,1);
    assert.equal(mode(stateA,"donus2").history.length,1);
    assert.equal(mode(stateB,"donus2").history.length,0);
    assert.equal(mode(stateB,"donus3").cardCount,1);
    assert.equal((await api(srv.url,"arcade/donuts/draw",request,a.cookie)).result.arcadeDonutResult.replayed,true);
    assert.equal((await api(srv.url,"arcade/donuts/draw",{
      mode:"donus",requestId:"phase57_mode1_a_cooldown"
    },a.cookie)).status,400);
  }finally{await srv.stop();}
});


test("第58階段單機HTTP：原版六位數即時樂透選號、下注結算、三分鐘冷卻、快轉與重啟",async()=>{
  let srv=await start("solo");
  const dir=srv.directory;
  try{
    assert.equal((await api(srv.url,"arcade/loto/play",{
      stake:500,chosenDigits:[0,0,0,0,0,0],requestId:"phase58_no_character"
    })).status,400);
    const created=await api(srv.url,"character",{
      name:"第58階段樂透居民",gender:"other",stats:defaultStats()
    });
    assert.equal(created.status,200);
    assert.equal(created.result.instantLoto.available,false);
    assert.deepEqual(created.result.instantLoto.rates,[500,1000,5000,10000,50000,100000]);
    assert.deepEqual(created.result.instantLoto.multipliers,[0,2,5,20,100,500,1000]);
    assert.equal((await api(srv.url,"arcade/loto/play",{
      stake:500,chosenDigits:[0,0,0,0,0,0],requestId:"phase58_missing_arcade"
    })).status,400);
    const starter=await api(srv.url,"solo/map/starter",{});
    assert.equal(starter.status,200);
    assert.equal(starter.result.mapStarterResult.placed,21);
    assert.equal(starter.result.instantLoto.available,true);
    assert.equal(starter.result.map.cells[3*16+8].key,"ゲーセン");
    const balance=starter.result.character.money;
    assert.equal((await api(srv.url,"arcade/loto/play",{
      stake:500,chosenDigits:[0,1,2,3,4],requestId:"phase58_bad_selection"
    })).status,400);
    assert.equal((await api(srv.url,"arcade/loto/play",{
      stake:2500,chosenDigits:[0,1,2,3,4,5],requestId:"phase58_bad_stake"
    })).status,400);
    const firstPayload={stake:500,chosenDigits:[0,1,2,3,4,5],
      requestId:"phase58_http_first"};
    const first=await api(srv.url,"arcade/loto/play",firstPayload);
    assert.equal(first.status,200);
    const r=first.result.instantLotoResult;
    assert.equal(r.stake,500);
    assert.deepEqual(r.chosenDigits,[0,1,2,3,4,5]);
    assert.equal(r.drawnDigits.length,6);
    for(const digit of r.drawnDigits)assert.ok(Number.isInteger(digit)&&digit>=0&&digit<=9);
    assert.equal(r.matches,r.drawnDigits.filter((x,i)=>x===r.chosenDigits[i]).length);
    assert.equal(r.multiplier,[0,2,5,20,100,500,1000][r.matches]);
    assert.equal(r.gross,500*r.multiplier);
    assert.equal(r.delta,r.gross-500);
    assert.equal(first.result.character.money,balance+r.delta);
    assert.equal(first.result.instantLoto.history.length,1);
    assert.equal(first.result.instantLoto.totalPlays,1);
    assert.equal(first.result.instantLoto.readyAt,r.playedAt+180000);
    const replay=await api(srv.url,"arcade/loto/play",firstPayload);
    assert.equal(replay.status,200);
    assert.equal(replay.result.instantLotoResult.replayed,true);
    assert.equal(replay.result.character.money,first.result.character.money);
    assert.equal((await api(srv.url,"arcade/loto/play",{
      ...firstPayload,stake:1000
    })).status,400);
    assert.equal((await api(srv.url,"arcade/loto/play",{
      ...firstPayload,chosenDigits:[0,1,2,3,4,4]
    })).status,400);
    assert.equal((await api(srv.url,"arcade/loto/play",{
      ...firstPayload,requestId:"phase58_http_too_early"
    })).status,400);
    assert.equal((await api(srv.url,"solo/time/advance",{preset:"5m"})).status,200);
    const secondPayload={stake:1000,chosenDigits:[9,9,9,9,9,9],
      requestId:"phase58_http_second"};
    const second=await api(srv.url,"arcade/loto/play",secondPayload);
    assert.equal(second.status,200);
    assert.equal(second.result.instantLotoResult.stake,1000);
    const saved=second.result.character.money;
    assert.equal(saved,balance+r.delta+second.result.instantLotoResult.delta);
    assert.equal(second.result.instantLoto.history.length,2);
    assert.equal(second.result.instantLoto.totalPlays,2);
    await srv.stop({preserveData:true});
    srv=await start("solo",undefined,dir);
    const restored=await api(srv.url,"state");
    assert.equal(restored.status,200);
    assert.equal(restored.result.character.money,saved);
    assert.equal(restored.result.instantLoto.history.length,2);
    assert.equal(restored.result.instantLoto.totalPlays,2);
    assert.deepEqual(restored.result.instantLoto.history[0].chosenDigits,[9,9,9,9,9,9]);
    const again=await api(srv.url,"arcade/loto/play",firstPayload);
    assert.equal(again.status,200);
    assert.equal(again.result.instantLotoResult.replayed,true);
    assert.equal(again.result.character.money,saved);
  }finally{await srv.stop();}
});

test("第58階段多人HTTP：只限制連續最後玩家，其他玩家插入後可立即再玩，個人歷史隔離",async()=>{
  const seed=dir=>{
    const db=new DatabaseSync(join(dir,"multi.sqlite"));
    try{
      db.exec([
        "CREATE TABLE town_maps(town_id INTEGER PRIMARY KEY,",
        "original_name TEXT NOT NULL DEFAULT '',",
        "original_record TEXT NOT NULL DEFAULT '',",
        "source TEXT NOT NULL,tiles_json TEXT NOT NULL,",
        "updated_at INTEGER NOT NULL);"
      ].join(" "));
      const tiles=Array(192).fill("");tiles[0]="ゲーセン";
      db.prepare("INSERT INTO town_maps(town_id,original_name,source,tiles_json,updated_at) VALUES(?,?,?,?,?)")
        .run(0,"測試街區","legacy-import",JSON.stringify(tiles),Date.now());
    }finally{db.close();}
  };
  const srv=await start("multi",seed);
  try{
    const a=await api(srv.url,"register",{
      username:"phase58LotoUserA",password:"phase58-strong-password-a"
    });
    const b=await api(srv.url,"register",{
      username:"phase58LotoUserB",password:"phase58-strong-password-b"
    });
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal((await api(srv.url,"character",{
      name:"即時樂透甲",gender:"other",stats:defaultStats()
    },a.cookie)).status,200);
    assert.equal((await api(srv.url,"character",{
      name:"即時樂透乙",gender:"other",stats:defaultStats()
    },b.cookie)).status,200);
    const request={stake:500,chosenDigits:[0,0,0,0,0,0],
      requestId:"phase58_multi_shared_id"};
    assert.equal((await api(srv.url,"arcade/loto/play",request)).status,401);
    const first=await api(srv.url,"arcade/loto/play",request,a.cookie);
    assert.equal(first.status,200);
    assert.equal(first.result.instantLoto.totalPlays,1);
    assert.equal((await api(srv.url,"arcade/loto/play",{
      ...request,requestId:"phase58_multi_a_block"
    },a.cookie)).status,400);
    const second=await api(srv.url,"arcade/loto/play",request,b.cookie);
    assert.equal(second.status,200);
    assert.equal(second.result.instantLotoResult.replayed,false);
    assert.equal(second.result.instantLoto.totalPlays,2);
    const third=await api(srv.url,"arcade/loto/play",{
      ...request,requestId:"phase58_multi_a_after_b"
    },a.cookie);
    assert.equal(third.status,200);
    assert.equal(third.result.instantLoto.totalPlays,3);
    const stateA=(await api(srv.url,"state",undefined,a.cookie)).result;
    const stateB=(await api(srv.url,"state",undefined,b.cookie)).result;
    assert.equal(stateA.instantLoto.history.length,2);
    assert.equal(stateB.instantLoto.history.length,1);
    assert.equal(stateA.instantLoto.totalPlays,3);
    assert.equal(stateB.instantLoto.totalPlays,3);
    assert.equal(stateA.instantLoto.readyAt,third.result.instantLotoResult.playedAt+180000);
    assert.equal(stateB.instantLoto.readyAt,null);
    assert.equal((await api(srv.url,"arcade/loto/play",request,a.cookie))
      .result.instantLotoResult.replayed,true);
  }finally{await srv.stop();}
});
