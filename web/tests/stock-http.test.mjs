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


function withDb(srv,mode,fn){const d=new DatabaseSync(join(srv.directory,mode+".sqlite"));try{return fn(d);}finally{d.close();}}
const readReturns=(srv,mode)=>withDb(srv,mode,d=>d.prepare("SELECT COUNT(*) n FROM stock_receipts WHERE args_json=?").get('["town-return"]').n);
test("BK-05 real solo HTTP: source seed, explicit return only, spoof fields ignored, real map and atomic trade/clear/restart",async()=>{
  let srv=await start("solo");
  try{
    const c=await api(srv.url,"character",{name:"股票居民",gender:"other",stats:defaultStats()});
    assert.equal(c.status,200);assert.deepEqual(c.result.stock.market.prices,[25000,25000,25000,25000,25000]);
    assert.equal(c.result.stock.available,false);assert.equal(readReturns(srv,"solo"),0);
    const denied=await api(srv.url,"stock/access",{action:"open",requestId:"stock_open_01"});
    assert.equal(denied.status,400);
    const first=await api(srv.url,"town/return",{requestId:"stock_return_01",guestCount:900,now:0,userId:777,rand:0});
    assert.equal(first.status,200,JSON.stringify(first.result));
    assert.equal(first.result.stockReturnResult.guestCount,0);assert.equal(first.result.stockReturnResult.market.event,null);
    assert.equal(first.result.character,undefined);
    for(let i=0;i<4;i++)assert.equal((await api(srv.url,"state")).status,200);
    assert.equal(readReturns(srv,"solo"),1);
    assert.equal((await api(srv.url,"town/return",{requestId:"stock_return_01"})).result.stockReturnResult.replayed,true);
    assert.equal(readReturns(srv,"solo"),1);
    const map=await api(srv.url,"map/tile",{row:0,column:0,symbol:"株"});
    assert.equal(map.status,200,JSON.stringify(map.result));assert.equal(map.result.stock.available,true);
    withDb(srv,"solo",d=>d.exec("UPDATE characters SET money=1000000,bank=1000000"));
    const open=await api(srv.url,"stock/access",{action:"open",requestId:"stock_open_01"});
    assert.equal(open.status,200,JSON.stringify(open.result));assert.equal(open.result.stockResult.expired,true);
    const price=open.result.stock.market.prices[3],before=open.result.character.money,bank=open.result.character.bank;
    const args={action:"buy",key:"D",quantity:1,requestId:"stock_buy_01",price:1,cash:99999999,now:0};
    const buy=await api(srv.url,"stock/access",args);
    assert.equal(buy.status,200,JSON.stringify(buy.result));assert.equal(buy.result.character.money,before-price);
    assert.equal(buy.result.character.bank,bank);assert.equal(buy.result.stock.holdings[3].shares,1);
    const again=await api(srv.url,"stock/access",args);assert.equal(again.result.stockResult.replayed,true);
    assert.equal(again.result.character.money,before-price);
    assert.equal(readReturns(srv,"solo"),1);
    const directory=srv.directory;await srv.stop({preserveData:true});srv=await start("solo",null,directory);
    assert.equal((await api(srv.url,"state")).result.stock.holdings[3].shares,1);
    const clear=await api(srv.url,"stock/access",{action:"clear",requestId:"stock_clear_01"});
    assert.equal(clear.status,200,JSON.stringify(clear.result));assert.equal(clear.result.character.money,before);
    assert.equal(clear.result.stock.history.length,1);assert.equal(clear.result.stock.holdings[3].shares,0);
    assert.equal(readReturns(srv,"solo"),1);
  }finally{await srv.stop();}
});
test("BK-05 real multi HTTP: authentication, prior guest count, private holdings, same origin and rejection",async()=>{
  const srv=await start("multi");
  try{
    assert.equal((await api(srv.url,"town/return",{requestId:"return_multi_1"})).status,401);
    assert.equal((await api(srv.url,"stock/access",{action:"open",requestId:"stock_multi_1"})).status,401);
    const a=await api(srv.url,"register",{username:"stock_a",password:"stock-pass-123"});
    const b=await api(srv.url,"register",{username:"stock_b",password:"stock-pass-456"});
    for(const [account,name] of [[a,"股票甲"],[b,"股票乙"]])
      assert.equal((await api(srv.url,"character",{name,gender:"other",stats:defaultStats()},account.cookie)).status,200);
    const {storeTownMap}=await import("../src/town-storage.mjs");
    withDb(srv,"multi",d=>{const tiles=Array(192).fill("");tiles[0]="株";storeTownMap(d,0,{tiles},"web-edited");d.exec("UPDATE characters SET money=1000000,bank=1000000");});
    const first=await api(srv.url,"town/return",{requestId:"return_multi_1"},a.cookie);
    assert.equal(first.result.stockReturnResult.guestCount,0);
    const second=await api(srv.url,"town/return",{requestId:"return_multi_1",guestCount:500,userId:1},b.cookie);
    assert.equal(second.result.stockReturnResult.guestCount,1);assert.equal(readReturns(srv,"multi"),2);
    const cross=await fetch(srv.url+"/api/town/return",{method:"POST",headers:{"Content-Type":"application/json",Cookie:a.cookie,Origin:"https://invalid.example"},body:JSON.stringify({requestId:"return_cross_1"})});
    assert.equal(cross.status,403);assert.equal(readReturns(srv,"multi"),2);
    const open=await api(srv.url,"stock/access",{action:"open",requestId:"stock_open_multi"},a.cookie);
    assert.equal(open.status,200);
    const buy=await api(srv.url,"stock/access",{action:"buy",key:"E",quantity:1,requestId:"stock_buy_multi",userId:2},a.cookie);
    assert.equal(buy.status,200);assert.equal(buy.result.stock.holdings[4].shares,1);
    const other=(await api(srv.url,"state",undefined,b.cookie)).result;
    assert.equal(other.stock.holdings[4].shares,0);assert.equal(other.stock.history.length,0);
    const rejected=await api(srv.url,"stock/access",{action:"sell",key:"E",quantity:1,requestId:"stock_sell_multi",userId:1},b.cookie);
    assert.equal(rejected.status,400);assert.match(rejected.result.error,/持股不足/);
    assert.equal((await api(srv.url,"state",undefined,a.cookie)).result.stock.holdings[4].shares,1);
  }finally{await srv.stop();}
});
