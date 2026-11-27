import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync,readFileSync,mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const delay = ms => new Promise(done => setTimeout(done, ms));
async function start(mode, seed, existingDirectory = null, extraEnv = {}) {
  const directory = existingDirectory ?? mkdtempSync(join(tmpdir(), "town-web-"));
  if (seed) seed(directory);
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: root, env: { ...process.env, HOST: "127.0.0.1", GAME_MODE: mode, DATA_DIR: directory, ...extraEnv, PORT: "0" }
  });
  let log = "", stdout = "";
  child.stdout.on("data", data => { stdout += data; log += data; });
  child.stderr.on("data", data => { log += data; });
  let url;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) break;
    // 等子程序真正完成 OS bind 才連線，不把釋放後的空埠當成保留埠。
    url = stdout.match(/^TOWN Web \[(?:solo|multi)\] (http:\/\/127\.0\.0\.1:[1-9]\d*)\r?\n/m)?.[1];
    if (!url) { await delay(100); continue; }
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

test("GM-02 real solo HTTP: map gate, quote authority, wager, stale turn, restart, replay, settlement",async()=>{
  let srv=await start("solo");
  try{
    // Move fixture clock to Taipei noon, away from the daily event boundary.
    const clock=new DatabaseSync(join(srv.directory,"solo.sqlite"));
    try{
      const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
      const get=k=>Number(parts.find(p=>p.type===k).value);
      clock.prepare("UPDATE solo_clock SET offset_ms=? WHERE id=1").run((43200000-(get("hour")*3600+get("minute")*60+get("second"))*1000+86400000)%86400000);
    }finally{clock.close();}
    const create=await api(srv.url,"character",{name:"競馬測試",gender:"other",stats:defaultStats()});
    assert.equal(create.status,200);assert.equal(create.result.horseRace.available,false);
    assert.equal((await api(srv.url,"horse-race/quote",{requestId:"http_quote_001"})).status,400);
    const map=await api(srv.url,"map/tile",{row:0,column:0,symbol:"競馬"});
    assert.equal(map.status,200,JSON.stringify(map.result));assert.equal(map.result.horseRace.available,true);
    const before=map.result.character.money;
    const q=await api(srv.url,"horse-race/quote",{requestId:"http_quote_001",card:[{odds:99999}],now:0,userId:999});
    assert.equal(q.status,200,JSON.stringify(q.result));const card=q.result.horseRaceResult;
    assert.equal(card.card.length,6);assert.ok(card.card.every(h=>h.odds<=30));
    const args={requestId:"http_start_001",raceId:card.id,tickets:[1,0,0,0,0,0],cash:999999,odds:999999};
    const started=await api(srv.url,"horse-race/start",args);
    assert.equal(started.status,200,JSON.stringify(started.result));
    assert.equal(started.result.character.money,before-500);
    assert.equal(started.result.horseRace.active.id,card.id);
    const again=await api(srv.url,"horse-race/start",args);
    assert.equal(again.result.horseRaceResult.replayed,true);assert.equal(again.result.character.money,before-500);
    const first={raceId:card.id,expectedTurn:0,requestId:"http_step_000"};
    const next=await api(srv.url,"horse-race/step",first);
    assert.equal(next.status,200,JSON.stringify(next.result));assert.equal(next.result.horseRaceResult.turn,1);
    assert.equal((await api(srv.url,"horse-race/step",{...first,requestId:"http_stale_001"})).status,400);
    const directory=srv.directory;await srv.stop({preserveData:true});srv=await start("solo",null,directory);
    assert.equal((await api(srv.url,"state")).result.horseRace.active.turn,1);
    assert.equal((await api(srv.url,"horse-race/step",first)).result.horseRaceResult.replayed,true);
    let current=next.result.horseRaceResult,terminal;
    for(let i=0;i<200&&current.status==="running";i++){
      terminal=await api(srv.url,"horse-race/step",{raceId:card.id,expectedTurn:current.turn,requestId:"http_step_"+String(current.turn).padStart(3,"0"),payout:999999});
      assert.equal(terminal.status,200,JSON.stringify(terminal.result));current=terminal.result.horseRaceResult;
    }
    assert.equal(current.status,"completed");const winner=current.horses.find(h=>h.name===current.winner);
    assert.equal(current.payout,winner.odds*winner.tickets*500);
    assert.equal(terminal.result.character.money,before-500+current.payout);
    assert.equal(terminal.result.horseRace.active,null);
    assert.equal(terminal.result.horseRace.latest.id,card.id);
    assert.equal(terminal.result.horseRace.rankings[0].spent,500);
  }finally{await srv.stop();}
});
test("GM-02 real multi HTTP: anonymous requests, account ownership, shared lock",async()=>{
  const srv=await start("multi");
  try{
    assert.equal((await api(srv.url,"horse-race/quote",{requestId:"multi_quote_001"})).status,401);
    const a=await api(srv.url,"register",{username:"horse_a",password:"horse-pass-123"});
    const b=await api(srv.url,"register",{username:"horse_b",password:"horse-pass-456"});
    for(const [account,name] of [[a,"競馬甲"],[b,"競馬乙"]])
      assert.equal((await api(srv.url,"character",{name,gender:"other",stats:defaultStats()},account.cookie)).status,200);
    // Multi map is administrator-owned. Controlled fixture installs the original symbol.
    const db=new DatabaseSync(join(srv.directory,"multi.sqlite"));
    try{
      const {storeTownMap}=await import("../src/town-storage.mjs");
      const tiles=Array(192).fill("");tiles[0]="競馬";storeTownMap(db,0,{tiles},"web-edited");
    }finally{db.close();}
    const qa=await api(srv.url,"horse-race/quote",{requestId:"multi_quote_001"},a.cookie);
    const qb=await api(srv.url,"horse-race/quote",{requestId:"multi_quote_001"},b.cookie);
    assert.equal(qa.status,200);assert.equal(qb.status,200);
    const args={raceId:qa.result.horseRaceResult.id,tickets:[1,0,0,0,0,0],requestId:"multi_start_001"};
    assert.equal((await api(srv.url,"horse-race/start",args,b.cookie)).status,400);
    assert.equal((await api(srv.url,"horse-race/start",args,a.cookie)).status,200);
    assert.equal((await api(srv.url,"horse-race/start",{...args,raceId:qb.result.horseRaceResult.id},b.cookie)).status,400);
    assert.equal((await api(srv.url,"horse-race/step",{raceId:args.raceId,expectedTurn:0,requestId:"multi_step_001"},b.cookie)).status,400);
    const bs=(await api(srv.url,"state",undefined,b.cookie)).result;
    assert.equal(bs.horseRace.active,null);assert.equal(bs.horseRace.busy,true);
    assert.equal(bs.horseRace.latest.id,qb.result.horseRaceResult.id);
  }finally{await srv.stop();}
});
