import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {HORSE_IMAGES,HORSE_ROUND_MS,horseBetSummary} from "../public/modules/horse-race.js";
test("GM-02 original 15 sprite names and 3 second interval match actual CGI sources",()=>{
  const basic=readFileSync(new URL("../../basic.cgi",import.meta.url),"utf8");
  const lib=readFileSync(new URL("../../town_lib.pl",import.meta.url),"utf8");
  const line=basic.match(/%umagazou =\((.*?)\);/)[1];
  const pairs=[...line.matchAll(/"([^"]+)","([^"]+)"/g)].map(x=>[x[1],x[2]]);
  assert.deepEqual(HORSE_IMAGES,Object.fromEntries(pairs));assert.equal(pairs.length,15);
  for(const [,file] of pairs)assert.ok(existsSync(new URL("../../img/uma/"+file,import.meta.url)));
  const interval=lib.match(/idou = setTimeout\('idousuru\(\)',(\d+)\*1000\);/);
  assert.equal(Number(interval[1])*1000,HORSE_ROUND_MS);
});
test("GM-02 UI betting quote matches original cost and bounds; not payout authority",()=>{
  assert.deepEqual(horseBetSummary([100,100,0,0,0,0],100000),{cost:100000,reason:null});
  assert.match(horseBetSummary([0,0,0,0,0,0],100000).reason,/尚未/);
  assert.match(horseBetSummary([201,0,0,0,0,0],1000000).reason,/200/);
  assert.match(horseBetSummary([1,1,1,0,0,0],1000000).reason,/兩匹/);
  assert.match(horseBetSummary([1,0,0,0,0,0],499).reason,/現金/);
  assert.match(horseBetSummary([1.1,0,0,0,0,0],1000000).reason,/整數/);
});
