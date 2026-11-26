import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {decodeLegacyText,createCharacterData,maxBodyEnergy,maxBrainEnergy} from "../src/engine.mjs";
import {parseOriginalOnsenConfig,originalOnsenMaxima,originalOnsenOptions,quoteOriginalOnsen,
  projectOriginalOnsenEntryEnergy,projectOriginalOnsenExitEnergy,projectOriginalOnsenAbilityRolls} from "../src/onsen-source.mjs";
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
  // Perl int(-0.979) 為 0；經過兩秒才得到負一的整數偏移。
  assert.equal(over.sourceBodyDisplayOffset,2);
  const longer=projectOriginalOnsenEntryEnergy(state,config,"special_kin",102);
  assert.equal(longer.sourceBodyDisplayOffset,1);
  assert.throws(()=>projectOriginalOnsenEntryEnergy(state,config,"invented",100),/未知/);
  assert.throws(()=>projectOriginalOnsenExitEnergy(state,config,"invented",100),/未知/);
});

const PERL_ABILITY_HARNESS=String.raw`use JSON::PP;
our (@draws,@sizes);
BEGIN {
  *CORE::GLOBAL::rand=sub {
    my ($size)=@_;
    push @sizes,$size;
    die "unexpected RNG draw" unless @draws;
    return shift(@draws)*$size;
  };
}
@draws=@{decode_json($ARGV[0])};
my $stats=decode_json($ARGV[1]);
for my $key (keys %$stats){$$key=$stats->{$key};}
local $/;
my $source=<STDIN>;
eval $source;
my $failure=$@;
print encode_json({error=>$failure,stats=>{map {$_=>0+$$_} keys %$stats},
  sizes=>\@sizes,remaining=>scalar @draws});
`;
function originalAbilityBlock(key){
  const branch=basic.indexOf("}elsif ($in{'onsensyurui'} eq \""+key+"\"){");
  assert.ok(branch>=0,"原始浴池分支");
  const first=key==="special_dou"?"$tairyku_up = int(rand(10)+1);":"$looks_up = int(rand(20)+1);";
  const start=basic.indexOf(first,branch);
  const end=basic.indexOf("\n\t}elsif",start);
  assert.ok(start>branch&&end>start,"抽取原始 RNG 與能力區段");
  return basic.slice(start,end);
}
function executeOriginalAbility(key,rolls,stats){
  const sides=key==="special_dou"?10:20;
  const fractions=rolls.map(n=>(n-0.5)/sides);
  const perl=spawnSync("perl",["-e",PERL_ABILITY_HARNESS,JSON.stringify(fractions),JSON.stringify(stats)],
    {input:originalAbilityBlock(key),encoding:"utf8",timeout:5000});
  assert.ifError(perl.error);
  assert.equal(perl.status,0,perl.stderr);
  const actual=JSON.parse(perl.stdout);
  assert.deepEqual(actual.sizes,rolls.map(()=>sides));
  assert.equal(actual.remaining,0);
  let used=0;
  const model=projectOriginalOnsenAbilityRolls(stats,key,()=>fractions[used++]);
  assert.equal(used,rolls.length);
  assert.deepEqual(model.rolls.map(r=>r.roll),rolls);
  if(actual.error){
    assert.match(actual.error,/Modification of a read-only value attempted/);
    assert.equal(model.status,"source-abort");
    assert.deepEqual(model.uncommittedStats,actual.stats);
    assert.deepEqual(model.stats,stats);
    assert.deepEqual(model.gains,{});
  }else{
    assert.equal(model.status,"source-ok");
    assert.deepEqual(model.stats,actual.stats);
  }
  return model;
}
test("原版 Perl 銅浴能力區段直接差分：兩次抽選與 3/4 邊界",()=>{
  const a=executeOriginalAbility("special_dou",[3,4],stats);
  assert.deepEqual(a.gains,{tairyoku:3});
  assert.deepEqual(executeOriginalAbility("special_dou",[4,3],stats).gains,{kenkou:3});
  assert.deepEqual(executeOriginalAbility("special_dou",[10,10],stats).gains,{});
});
test("原版 Perl 銀／金浴能力區段直接差分：體力拼寫、速度拼寫與腿力中止",()=>{
  const silver=executeOriginalAbility("special_gin",[10,10,11,20,10,11,11],stats);
  assert.deepEqual(silver.gains,{looks:10,speed:20,power:10});
  const abort=executeOriginalAbility("special_gin",[10,10,11,20,10,11,10],stats);
  assert.equal(abort.status,"source-abort");
  assert.equal(abort.uncommittedStats.speed,40);
  const goldRolls=[1,20,10,19,11,10,11,...Array(10).fill(10)];
  const gold=executeOriginalAbility("special_kin",goldRolls,stats);
  assert.equal(gold.gains.speed,19);
  assert.equal(gold.gains.tairyoku,undefined);
  assert.equal(gold.gains.kokugo,10);
  assert.equal(gold.gains.etti,10);
  goldRolls[6]=1;
  const goldAbort=executeOriginalAbility("special_kin",goldRolls,stats);
  assert.equal(goldAbort.status,"source-abort");
  assert.equal(goldAbort.uncommittedStats.kokugo,stats.kokugo);
  for(const leg of [1,20,1000])executeOriginalAbility("special_gin",[20,20,20,20,20,20,1],{...stats,kyakuryoku:leg});
});
test("普通至松浴無能力亂數，不將背景圖片亂數混入能力來源層",()=>{
  for(const bath of originalOnsenOptions(config,stats).slice(0,5)){
    assert.deepEqual(projectOriginalOnsenAbilityRolls(stats,bath.key,()=>{throw Error("不應抽選")}),
      {status:"source-ok",rolls:[],stats,gains:{}});
  }
});
