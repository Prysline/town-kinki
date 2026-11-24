import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {decodeLegacyText,STAT_KEYS} from "../src/engine.mjs";
import {parseOsakaRules,parseOsakaNpcRecord,loadOsakaNpcCatalog,osakaNpcEnergy,simulateOsaka,rollOsaka} from "../src/osaka-challenge-core.mjs";

const source=decodeLegacyText(readFileSync(new URL("../../obatyan.cgi",import.meta.url)));
const rules=parseOsakaRules(source);
const stats=value=>Object.fromEntries(STAT_KEYS.map(key=>[key,value]));
// Synthetic test fixtures ONLY. Never bundled as production NPCs.
function npcRecord(filename,value=24,overrides={}){
 const f=Array(68).fill("");
 f[0]="test-id";f[1]="TEST "+filename;f[2]="not-production-secret";
 const values={...stats(value),...overrides};
 STAT_KEYS.forEach((key,i)=>{f[6+i]=String(values[key]);});
 return f.join("<>");
}
const npc=(filename,value=24,overrides={})=>parseOsakaNpcRecord(filename,npcRecord(filename,value,overrides));
const player=(value=100,extra={})=>({stats:stats(value),bodyEnergy:100,brainEnergy:100,money:1000,...extra});
const seq=(...values)=>n=>{assert.ok(values.length,"unexpected RNG");const v=values.shift();assert.ok(v>=0&&v<n);return v;};
test("Osaka original source: 16 attacks, separate base money, four declared prizes and original three-choice discrepancy",()=>{
 assert.deepEqual(rules.attackIndices,[1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17]);
 assert.equal(rules.attackLimit,50);assert.equal(rules.originalDropChoices,3);
 assert.equal(rules.week.base,300);assert.equal(rules.strong.base,1000);
 assert.deepEqual(rules.week.prizes.map(x=>x.name),["おばちゃんの力","関西弁翻訳機","おばちゃんの知恵薬","おばちゃんの知恵袋"]);
 assert.deepEqual(rules.strong.prizes.map(x=>x.name),["おばちゃんの力","関西弁翻訳機","おばちゃんの知恵薬（スーパー）","おばちゃんの知恵袋（スーパー）"]);
 for(const mode of ["week","strong"]){
   assert.ok(rules[mode].prizes.every(x=>x.rawFields.length===33));
   assert.equal(rules[mode].prizes[0].usableShape,true);
   assert.equal(rules[mode].prizes[1].usableShape,true);
   assert.equal(rules[mode].prizes[2].usableShape,true);
   assert.equal(rules[mode].prizes[3].usableShape,true);
 }
 assert.equal(rules.week.prizes[0].originalRawFields[9],"無3");
 assert.equal(rules.strong.prizes[0].originalRawFields[21],"回");
 for(const [mode,amount,uses] of [["week","3","3"],["strong","10","5"]]){
  const p=rules[mode].prizes[0];assert.ok(p.correction);assert.equal(p.rawFields[9],"無");assert.equal(p.rawFields[21],uses);assert.equal(p.rawFields[22],"回");assert.equal(p.rawFields[23],"30");assert.equal(p.rawFields[28],"10");assert.deepEqual(p.rawFields.slice(2,9),Array(7).fill("0"));assert.deepEqual(p.rawFields.slice(10,21),[...Array(7).fill(amount),"0",...Array(3).fill(amount)]);
 }
});
test("Osaka NPC loader: only designated ten files, safe projected fields, missing catalog fails closed",()=>{
 const root=mkdtempSync(join(tmpdir(),"osaka-source-"));
 try{
  mkdirSync(join(root,"member","osaka"),{recursive:true});
  const empty=loadOsakaNpcCatalog(root);
  assert.equal(empty.available,false);assert.equal(empty.missing.length,10);assert.deepEqual(empty.npcs,[]);
  assert.throws(()=>rollOsaka({rules,mode:"week",player:player(),catalog:empty}),/資料尚未完整/);
  for(const prefix of ["w","s"])for(let i=1;i<=5;i++){
    const filename=prefix+i+"log.cgi";
    writeFileSync(join(root,"member","osaka",filename),npcRecord(filename));
  }
  const catalog=loadOsakaNpcCatalog(root);
  assert.equal(catalog.available,true);assert.equal(catalog.npcs.length,10);
  assert.deepEqual(osakaNpcEnergy(stats(24)),{bodyEnergy:26,brainEnergy:28});
  assert.equal(catalog.npcs[0].name,"TEST w1log.cgi");
  assert.ok(!JSON.stringify(catalog).includes("not-production-secret"));
  assert.throws(()=>parseOsakaNpcRecord("../private.cgi",npcRecord("w1log.cgi")),/專用檔名/);
  assert.throws(()=>parseOsakaNpcRecord("w1log.cgi",""),/原始資料為空/);
  const win=rollOsaka({rules,mode:"week",player:player(),catalog,rng:seq(4,0,2)});
  assert.equal(win.npc.sourceFile,"w5log.cgi");assert.equal(win.prizeIndex,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("Osaka all sixteen attacks use the source attribute and mental/body target, not B league equipment",()=>{
 for(let attack=1;attack<=16;attack++){
  const target=npc("w1log.cgi");
  const p=player(24,{stats:{...stats(24),speed:25,[STAT_KEYS[rules.attackIndices[attack-1]-1]]:1000}});
  const result=simulateOsaka({rules,mode:"week",player:p,npc:target,rng:seq(attack-1,0)});
  const round=result.rounds[0];
  assert.equal(round.actor,"player");assert.equal(round.stat,STAT_KEYS[rules.attackIndices[attack-1]-1]);
  assert.equal(round.energy,attack<=8||attack===14?"brainEnergy":"bodyEnergy");
  assert.equal(round.damage,976);assert.equal(result.outcome,"win");assert.equal(result.rounds.length,1);
 }
});
test("Osaka week/strong: original one-turn cash reward, corrected four accessible prize indices, no K points",()=>{
 for(const [mode,file,base] of [["week","w1log.cgi",300],["strong","s1log.cgi",1000]]){
  for(let drop=0;drop<rules[mode].prizes.length;drop++){
   const result=simulateOsaka({rules,mode,player:player(),npc:npc(file),rng:(n)=>{if(n===16)return 0;assert.equal(n,4);return drop;}});
   assert.equal(result.outcome,"win");assert.equal(result.moneyDelta,base*5);
   assert.equal(result.originalCashDelta,base*5);assert.equal(result.prizeIndex,drop);
   assert.equal(result.prize.name,rules[mode].prizes[drop].name);
   assert.equal(Object.hasOwn(result,"kpointDelta"),false);
  }
 }
});
test("Osaka strict speed order, loss cash floor, fifty-attack draw and no reward on loss/draw",()=>{
 const p=player(24,{bodyEnergy:1,stats:{...stats(24),speed:24}});
 const a=simulateOsaka({rules,mode:"strong",player:p,npc:npc("s1log.cgi",24,{power:100}),rng:seq(10)});
 assert.equal(a.rounds[0].actor,"npc");assert.equal(a.outcome,"loss");assert.equal(a.moneyDelta,-1000);assert.equal(a.player.money,0);
 assert.equal(a.prize,null);assert.equal(a.player.bodyEnergy,0);
 const b=simulateOsaka({rules,mode:"week",player:{...p,money:5},npc:npc("w1log.cgi",24,{power:100}),rng:seq(10)});
 assert.equal(b.originalCashDelta,-300);assert.equal(b.moneyDelta,-5);
 const c=simulateOsaka({rules,mode:"week",player:player(24),npc:npc("w1log.cgi"),rng:n=>n-1});
 assert.equal(c.rounds.length,50);assert.equal(c.outcome,"draw");assert.equal(c.moneyDelta,0);assert.equal(c.prize,null);
});

test("Osaka corrected prize selection derives range from array length, not original or hard-coded four",()=>{
 const extra={name:"TEST-only future prize"};
 const expanded={...rules,week:{...rules.week,prizes:[...rules.week.prizes,extra]}};
 const result=simulateOsaka({rules:expanded,mode:"week",player:player(),npc:npc("w1log.cgi"),rng:n=>{if(n===16)return 0;assert.equal(n,5);return 4;}});
 assert.equal(result.prizeIndex,4);assert.equal(result.prize,extra);
});
