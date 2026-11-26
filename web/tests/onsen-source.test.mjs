import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {decodeLegacyText,createCharacterData,maxBodyEnergy,maxBrainEnergy} from "../src/engine.mjs";
import {parseOriginalOnsenConfig,originalOnsenMaxima,originalOnsenOptions,quoteOriginalOnsen,
  projectOriginalOnsenEntryEnergy,projectOriginalOnsenExitEnergy} from "../src/onsen-source.mjs";
const read=path=>decodeLegacyText(readFileSync(new URL(path,import.meta.url)));
const configSource=read("../../town_ini.cgi");
const basic=read("../../basic.cgi");
const town=read("../../town_maker.cgi");
const config=parseOriginalOnsenConfig(configSource);
const stats=createCharacterData("來源測試","other",0).stats;
const state={stats,bodyEnergy:0,brainEnergy:0,lastBodyAt:100,lastBrainAt:100};
test("原版八種浴池實際設定、表單鍵與出浴鍵完整對照",()=>{
  assert.deepEqual(originalOnsenOptions(config,stats).map(({key,exitKey,rate,fee})=>[key,exitKey,rate,fee]),[
    ["futuu","one",10,500],["koukyuu","two",2,200],["koukyuu_ume","three",200,10000],
    ["koukyuu_take","fo",400,20000],["koukyuu_matu","five",1000,50000],
    ["special_dou","six",2500,50000],["special_gin","seven",5000,100000],
    ["special_kin","eight",10000,1000000]
  ]);
  assert.equal(config.sintai_kaihuku,10);
  assert.equal(config.zunou_kaihuku,10);
  assert.equal(config.on_gazou_suu,10);
  assert.equal(config.tokubetu_times,100);
  assert.equal(config.tokubetuburo_hiyou,5000);
  for(const bath of originalOnsenOptions(config,stats)){
    assert.ok(basic.includes('name=onsensyurui value="'+bath.key+'"'));
    assert.ok(town.includes('$in{\'iiyudane\'} eq "'+bath.exitKey+'"'));
  }
  assert.throws(()=>parseOriginalOnsenConfig(configSource.replace("$onsen_times","$missing_times")),/設定缺失/);
  assert.throws(()=>parseOriginalOnsenConfig(configSource+"\n$onsen_times = '10';"),/重複/);
});
test("原版入浴與出浴上限有 +1 差異，保留現有 Web 上限不更改",()=>{
  assert.deepEqual(originalOnsenMaxima(stats),{body:22,brain:24});
  assert.deepEqual(originalOnsenMaxima(stats,"exit"),{body:21,brain:23});
  assert.equal(maxBodyEnergy(stats),25);
  assert.equal(maxBrainEnergy(stats),35);
  const high=Object.fromEntries(Object.keys(stats).map(key=>[key,600]));
  const maxima=originalOnsenMaxima(high);
  const rate=Math.max(2,Math.trunc(Math.max(maxima.body,maxima.brain)/50));
  assert.ok(rate>2);
  assert.deepEqual(originalOnsenOptions(config,high).find(b=>b.key==="koukyuu"),{
    key:"koukyuu",exitKey:"two",label:"特別浴池",rate,fee:rate*100});
});
test("原版選單使用松浴倍率暫算 +1，兩個恢復時計各自計算且不修改來源",()=>{
  const before=JSON.stringify(state);
  const quotes=quoteOriginalOnsen(state,config,100);
  assert.equal(quotes.length,8);
  assert.deepEqual(quotes.slice(0,2).map(b=>[b.bodySeconds,b.brainSeconds]),[[21,23],[105,115]]);
  const delayed=quoteOriginalOnsen({...state,lastBrainAt:101},config,101);
  assert.equal(delayed[0].bodySeconds,0);
  assert.equal(delayed[0].brainSeconds,23);
  assert.equal(JSON.stringify(state),before);
  assert.ok(basic.includes("$sintai_kaihuku*$matu_times)+1"));
});
test("入浴先計算帶倍率的既有經過時間再加 1，出浴按來源另一上限與倍率結算",()=>{
  for(const bath of originalOnsenOptions(config,stats)){
    const entry=projectOriginalOnsenEntryEnergy(state,config,bath.key,100);
    assert.equal(entry.bodyEnergy,1);
    assert.equal(entry.brainEnergy,1);
    assert.equal(entry.lastBodyAt,100);
    assert.equal(entry.lastBrainAt,100);
    const out=projectOriginalOnsenExitEnergy({...entry,stats},config,bath.exitKey,101);
    assert.equal(out.bodyEnergy,Math.min(21,1+Math.trunc(bath.rate/10)));
    assert.equal(out.brainEnergy,Math.min(23,1+Math.trunc(bath.rate/10)));
    assert.equal(out.lastBodyAt,101);
    assert.equal(out.lastBrainAt,101);
  }
  const entry=projectOriginalOnsenEntryEnergy({...state,lastBrainAt:101},config,"futuu",101);
  assert.equal(entry.bodyEnergy,2);
  assert.equal(entry.brainEnergy,1);
  const over=projectOriginalOnsenEntryEnergy(state,config,"special_kin",101);
  assert.equal(over.bodyEnergy,22);
  assert.equal(over.brainEnergy,24);
  assert.ok(over.sourceBodyDisplayOffset<2);
  assert.throws(()=>projectOriginalOnsenEntryEnergy(state,config,"invented",100),/未知/);
  assert.throws(()=>projectOriginalOnsenExitEnergy(state,config,"invented",100),/未知/);
});
