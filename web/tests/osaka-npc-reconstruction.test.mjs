import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {decodeLegacyText,STAT_KEYS,maxBodyEnergy,maxBrainEnergy} from "../src/engine.mjs";
import {parseOsakaRules,rollOsaka,osakaNpcEnergy} from "../src/osaka-challenge-core.mjs";
import {RECONSTRUCTED_OSAKA_NPCS,OSAKA_RECONSTRUCTION_VERSION} from "../src/osaka-npc-reconstruction.mjs";
import {resolveOsakaNpcCatalog} from "../src/osaka-npc-catalog.mjs";

const rules=parseOsakaRules(decodeLegacyText(readFileSync(new URL("../../obatyan.cgi",import.meta.url))));
function fixture(filename){
  const fields=Array(68).fill("");
  fields[1]="TEST "+filename;fields[2]="TEST-PRIVATE";
  STAT_KEYS.forEach((_,i)=>{fields[6+i]="24";});
  return fields.join("<>");
}
function fullEnergyPlayer(v){
  const stats=Object.fromEntries(STAT_KEYS.map(k=>[k,v]));
  return {stats,bodyEnergy:maxBodyEnergy(stats),brainEnergy:maxBrainEnergy(stats),money:100000};
}
test("Osaka reconstruction: fixed ten distinct profiles, complete 17 stats, source and energy",()=>{
  assert.equal(RECONSTRUCTED_OSAKA_NPCS.length,10);
  assert.equal(new Set(RECONSTRUCTED_OSAKA_NPCS.map(n=>n.id)).size,10);
  for(const mode of ["week","strong"]){
    const pool=RECONSTRUCTED_OSAKA_NPCS.filter(n=>n.mode===mode);
    assert.deepEqual(pool.map(n=>n.index),[1,2,3,4,5]);
    for(const n of pool){
      assert.deepEqual(Object.keys(n.stats),STAT_KEYS);
      assert.ok(Object.isFrozen(n)&&Object.isFrozen(n.stats));
      assert.equal(n.source,"reconstructed");
      assert.equal(n.sourceVersion,OSAKA_RECONSTRUCTION_VERSION);
      assert.equal(Object.hasOwn(n,"sourceFile"),false);
      assert.ok(Object.values(n.stats).every(v=>Number.isSafeInteger(v)&&v>0));
      assert.deepEqual({bodyEnergy:n.bodyEnergy,brainEnergy:n.brainEnergy},osakaNpcEnergy(n.stats));
      assert.ok(n.bodyEnergy>0&&n.brainEnergy>0);
      for(const v of Object.values(n.stats))assert.ok(mode==="week"?v>=20&&v<=38:v>=66&&v<=112);
    }
  }
});
test("Osaka reconstruction policy: missing/partial uses whole fallback, complete files preferred, strict and malformed fail closed",()=>{
  const root=mkdtempSync(join(tmpdir(),"osaka-catalog-policy-"));
  try{
    const dir=join(root,"member","osaka");mkdirSync(dir,{recursive:true});
    const missing=resolveOsakaNpcCatalog(root);
    assert.equal(missing.source,"reconstructed");assert.equal(missing.missing.length,10);
    assert.equal(missing.npcs,RECONSTRUCTED_OSAKA_NPCS);
    assert.equal(resolveOsakaNpcCatalog(root,"original-only").available,false);
    writeFileSync(join(dir,"w1log.cgi"),fixture("w1log.cgi"));
    const partial=resolveOsakaNpcCatalog(root);
    assert.equal(partial.missing.length,9);assert.equal(partial.npcs,RECONSTRUCTED_OSAKA_NPCS);
    assert.equal(resolveOsakaNpcCatalog(root,"original-only").available,false);
    for(const prefix of ["w","s"])for(let i=1;i<=5;i++){
      const filename=prefix+i+"log.cgi";writeFileSync(join(dir,filename),fixture(filename));
    }
    for(const policy of ["auto","original-only"]){
      const ready=resolveOsakaNpcCatalog(root,policy);
      assert.equal(ready.available,true);assert.equal(ready.source,"original-file");
      assert.equal(ready.missing.length,0);assert.equal(ready.npcs.length,10);
      assert.ok(ready.npcs.every(n=>n.source==="original-file"));
      assert.ok(!JSON.stringify(ready).includes("TEST-PRIVATE"));
    }
    writeFileSync(join(dir,"w1log.cgi"),"invalid");
    for(const policy of ["auto","original-only"]){
      const bad=resolveOsakaNpcCatalog(root,policy);
      assert.equal(bad.available,false);assert.equal(bad.sourceInvalid,true);assert.deepEqual(bad.npcs,[]);
    }
    assert.throws(()=>resolveOsakaNpcCatalog(root,"unknown"),/OSAKA_NPC_POLICY/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("Osaka reconstruction: seeded actual combat calibration and uniform five-slot selection",()=>{
  const catalog={available:true,npcs:RECONSTRUCTED_OSAKA_NPCS};
  for(const mode of ["week","strong"])for(let slot=0;slot<5;slot++){
    let first=true;
    const battle=rollOsaka({rules,mode,catalog,player:fullEnergyPlayer(500),rng:n=>{
      if(first){first=false;assert.equal(n,5);return slot;}
      return 0;
    }});
    assert.equal(battle.npc.index,slot+1);assert.equal(battle.npc.sourceVersion,OSAKA_RECONSTRUCTION_VERSION);
    assert.equal(battle.outcome,"win");
  }
  let seed=101;
  const rng=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n);};
  const report=[];
  for(const v of [20,25,30,40,60,80,90,100,120])for(const mode of ["week","strong"]){
    const counts={win:0,loss:0,draw:0};let rounds=0;
    for(let i=0;i<2000;i++){
      const b=rollOsaka({rules,mode,catalog,player:fullEnergyPlayer(v),rng});
      counts[b.outcome]++;rounds+=b.rounds.length;
      assert.ok(b.rounds.length>=1&&b.rounds.length<=50);
    }
    report.push({v,mode,...counts,meanRounds:rounds/2000});
  }
  const get=(v,mode)=>report.find(x=>x.v===v&&x.mode===mode);
  assert.equal(get(20,"week").win,0);
  assert.ok(get(30,"week").win>=1800);
  assert.equal(get(40,"strong").win,0);
  assert.ok(get(80,"strong").win>0&&get(80,"strong").win<1000&&get(80,"strong").draw>0);
  assert.ok(get(100,"strong").win>=1800);
  console.log("OSAKA_RECONSTRUCTION_CALIBRATION "+JSON.stringify(report));
});
