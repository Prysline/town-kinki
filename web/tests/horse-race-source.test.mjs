import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {parseHorseRaceSource,drawHorseRaceCard,startHorseRace,advanceHorseRace,
  HORSE_LOCK_SECONDS} from "../src/horse-race-source.mjs";

const basic=readFileSync(new URL("../../basic.cgi",import.meta.url),"utf8");
const ini=readFileSync(new URL("../../town_ini.cgi",import.meta.url),"utf8");
const source=parseHorseRaceSource(basic,ini);
const sequence=[0,.99,.23,.72,.1,.53,.45,.8,.33];
function stream(){
  let count=0;
  return {rand:n=>n*sequence[count++%sequence.length],count:()=>count};
}
const constant=f=>n=>n*f;

test("GM-02 original roster, odds, limits and exact Perl insertion shuffle",()=>{
  const r=stream();
  const card=drawHorseRaceCard(source,r.rand);
  const lists=basic.match(/my \(@umaname\)=.*;\r?\nmy \(@umakakeritu\)=.*;/)[0];
  const shuffle=basic.match(/@new_entry = \(\);[\s\S]*?(?=\s*foreach \(0\.\.5\)\{)/)[0];
  const oracle=execFileSync("perl",["-e",
    "BEGIN { @u=("+sequence.join(",")+"); $calls=0; *CORE::GLOBAL::rand=sub { $_[0]*$u[$calls++ % @u] }; }\n"+
    lists+"\n"+shuffle+"\n"+'foreach (0..5){ print "$new_entry[$_]<>$new_kakeritu[$_]\\n"; } print "$calls\\n";'
  ],{encoding:"utf8"}).trim().split("\n");
  assert.equal(r.count(),24);
  assert.equal(oracle.pop(),"24");
  assert.deepEqual(card,oracle.map(s=>{const [name,odds]=s.split("<>");return {name,odds:Number(odds)};}));
  assert.equal(HORSE_LOCK_SECONDS,180);
  assert.throws(()=>parseHorseRaceSource(basic,ini.replace("$keiba_gendomaisuu = '200'","$keiba_gendomaisuu = '201'")),/來源/);
});

test("GM-02 actual Perl initial and turn formulas, discard shuffle, two-way finish and payout",()=>{
  const card=drawHorseRaceCard(source,constant(0));
  const bets=[100,100,0,0,0,0];
  const r=stream(),started=startHorseRace(source,card,bets,100000,r.rand);
  assert.equal(r.count(),30);
  assert.equal(started.cost,100000);
  const initial=basic.match(/\$kyori = int\(\(rand\(60\)\+10\).*?;/)[0];
  const step=basic.match(/\$kyori \+= int\(\(rand\(100\)\+0\).*?;/)[0];
  const cap=basic.match(/if \(\$kyori >= 400\)\{\$kyori = 400;\}/)[0];
  const cases=card.map((h,i)=>[h.odds,sequence[(24+i)%sequence.length]]);
  const script="BEGIN { *CORE::GLOBAL::rand=sub { $_[0]*$fraction }; }\n"+
    cases.map(([ods,f])=>'$fraction='+f+'; $in{"kake0"}='+ods+'; $_=0; '+initial+' print "$kyori\\n";').join("\n")+"\n"+
    cases.map(([ods,f])=>'$fraction='+f+'; $ods='+ods+'; $kyori=390; '+step+cap+' print "$kyori\\n";').join("\n");
  const oracle=execFileSync("perl",["-e",script],{encoding:"utf8"}).trim().split("\n").map(Number);
  assert.deepEqual(started.horses.map(h=>h.distance),oracle.slice(0,6));
  const q=stream(),turn=advanceHorseRace(source,started.horses.map(h=>({...h,distance:390})),q.rand);
  assert.deepEqual(turn.horses.map(h=>h.distance),oracle.slice(6));
  assert.equal(q.count(),30+(turn.finishers.length>1?1:0));
  const all=advanceHorseRace(source,started.horses.map(h=>({...h,distance:399})),constant(.99));
  assert.equal(all.finishers.length,6);
  assert.equal(all.winner,card[5].name);
  assert.equal(all.payout,0);
  const first=advanceHorseRace(source,started.horses.map((h,i)=>({...h,distance:i===0?399:0})),constant(.5));
  assert.equal(first.winner,card[0].name);
  assert.equal(first.payout,card[0].odds*100*500);
  assert.throws(()=>advanceHorseRace(source,first.horses,constant(.5)),/已結束/);
});

test("GM-02 no finish, no bet, insufficient cash, total cap, two entries and forged card",()=>{
  const card=drawHorseRaceCard(source,constant(0));
  const go=(bets,cash=1000000)=>startHorseRace(source,card,bets,cash,constant(0));
  const race=go([1,0,0,0,0,0]);
  const turn=advanceHorseRace(source,race.horses,constant(0));
  assert.equal(turn.finished,false);
  assert.equal(turn.payout,null);
  assert.deepEqual(turn.horses,race.horses);
  assert.throws(()=>go([0,0,0,0,0,0]),/尚未購買/);
  assert.throws(()=>go([1,0,0,0,0,0],499),/現金不足/);
  assert.throws(()=>go([201,0,0,0,0,0]),/張數上限/);
  assert.throws(()=>go([1,1,1,0,0,0]),/兩匹/);
  assert.throws(()=>go([-1,0,0,0,0,0]),/購買數/);
  assert.throws(()=>startHorseRace(source,[{...card[0],odds:999},...card.slice(1)],
    [1,0,0,0,0,0],1000),/名單/);
  assert.throws(()=>drawHorseRaceCard(source,n=>n),/亂數/);
});
