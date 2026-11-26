import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {decodeLegacyText,STAT_KEYS,maxBodyEnergy,maxBrainEnergy,recoverEnergy,createCharacterData} from "../src/engine.mjs";
import {originalBodyEnergyMaximum,originalBrainEnergyMaximum} from "../src/energy-maxima.mjs";
const read=p=>decodeLegacyText(readFileSync(new URL(p,import.meta.url)));
const basic=read("../../basic.cgi"),town=read("../../town_maker.cgi");
const raw=(source,marker)=>{
  const start=source.indexOf(marker);
  assert.ok(start>=0,marker);
  const block=source.slice(start);
  const body=block.match(/\$energy_max\s*=\s*int\([^;]+;/)?.[0];
  const brain=block.match(/\$nou_energy_max\s*=\s*int\([^;]+;/)?.[0];
  assert.ok(body&&brain,marker);
  return body+"\n"+brain;
};
const originals={resident:raw(town,"sub loged_gamen {"),work:raw(basic,"sub do_work {"),"onsen-entry":raw(basic,"sub onsen {")};
const harness=String.raw`use JSON::PP; my $stats=decode_json($ARGV[0]);
for my $key (keys %$stats){$$key=$stats->{$key};}
local $/;my $source=<STDIN>;eval $source;die $@ if $@;
print encode_json([$energy_max,$nou_energy_max]);`;
test("WK-01 三種原版上限直接抽取 Perl 差分；不以全站統一公式替代",()=>{
  const fixtures=[
    Object.fromEntries(STAT_KEYS.map(k=>[k,20])),
    Object.fromEntries(STAT_KEYS.map(k=>[k,1])),
    Object.fromEntries(STAT_KEYS.map(k=>[k,0])),
    Object.fromEntries(STAT_KEYS.map((k,i)=>[k,1+(i+1)*17])),
    Object.fromEntries(STAT_KEYS.map((k,i)=>[k,i*101+5000]))
  ];
  for(const stats of fixtures)for(const [context,expression] of Object.entries(originals)){
    const r=spawnSync("perl",["-e",harness,JSON.stringify(stats)],{input:expression,encoding:"utf8",timeout:5000});
    assert.ifError(r.error);
    assert.equal(r.status,0,r.stderr);
    const expected=JSON.parse(r.stdout);
    assert.deepEqual([originalBodyEnergyMaximum(stats,context),originalBrainEnergyMaximum(stats,context)],expected,context);
    assert.deepEqual([maxBodyEnergy(stats,context),maxBrainEnergy(stats,context)],expected,context);
  }
});
test("WK-01 居民與工作使用不同的恢復上限；輪詢餘秒與未滿刻度夾限維持",()=>{
  const c=createCharacterData("能量情境","other",100000);
  const low={...c,bodyEnergy:0,brainEnergy:0};
  const work=recoverEnergy(low,500000,"work");
  assert.deepEqual([work.bodyEnergy,work.brainEnergy],[25,35]);
  const resident=recoverEnergy(work,500001);
  assert.deepEqual([resident.bodyEnergy,resident.brainEnergy],[21,23]);
  assert.equal(resident.recoveredAt,500000);
  const half=recoverEnergy(low,109999);
  assert.equal(half.recoveredAt,100000);
  assert.equal(half.bodyEnergy,0);
  const one=recoverEnergy(half,110001);
  assert.equal(one.recoveredAt,110000);
  assert.equal(one.bodyEnergy,1);
  assert.equal(one.brainEnergy,1);
});
