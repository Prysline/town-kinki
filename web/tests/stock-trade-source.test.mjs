import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {emptyStockPortfolio,projectStockTrade,stockPortfolioOverview} from "../src/stock-trade-source.mjs";
const kabu=readFileSync(new URL("../../kabu.cgi",import.meta.url),"utf8");
const original=kabu.match(/if \(\$torihiki_mukou != 1 && \$in\{'command'\} eq "kau"\)\{[\s\S]*?(?=\s*#\t\t\$torihiki--;)/)[0]+"\n}";
const keys=["A","B","C","D","E"];
const p=[100,200,300,400,500];
function oracle(input,corrected=false){
  let block=original;
  if(corrected){
    // The two approved corrections only. All other Perl code is verbatim.
    block=block.replace("$kabukadD*","$kabukaD*");
    const e=block.indexOf("elsif ($in{'meigara'} eq \"Ekabu\"");
    const end=block.indexOf('if ($torihiki_mukou != 1 && $in{\'command\'} eq "uru"',e);
    assert.ok(e>=0&&end>e);
    block=block.slice(0,e)+block.slice(e,end).replaceAll("$kabukaA * $in{'kouniyu'}","$kabukaE * $in{'kouniyu'}")+block.slice(end);
  }
  const dir=mkdtempSync(join(tmpdir(),"stock-trade-"));
  try{
    mkdirSync(join(dir,"member","1"),{recursive:true});
    const init=keys.map((k,i)=>{
      const r=input.rows[i];
      return "$kabuka"+k+"="+input.prices[i]+";$kabuka_"+k+"="+r.lastBuyPrice+";$moti_"+k+"="+r.shares+";$sisan"+k+"="+r.basis+";$sisan"+k+"_0="+r.invested+";$sisan"+k+"_1="+r.recovered+";$sisan"+k+"_2="+r.net+";";
    }).join("\n");
    const program=init+'\n($money,$bank,$in{"meigara"},$in{"kouniyu"},$in{"command"},$torihiki_mukou)=@ARGV; $konu_jogen=200; $k_id=1; $kabu_f="mykabu.cgi"; sub error {die "reject";} eval { '+block+' }; if($@){print "reject";exit;} print join(",", $money,$bank,$syushi||0,'+
      keys.flatMap(k=>["$moti_"+k,"$kabuka_"+k,"$sisan"+k,"$sisan"+k+"_0","$sisan"+k+"_1","$sisan"+k+"_2"]).join(",")+');';
    const raw=execFileSync("perl",["-e",program,String(input.cash),String(input.bank),input.key+"kabu",String(input.quantity),input.action==="buy"?"kau":"uru",input.expired?"1":"0"],{cwd:dir,encoding:"utf8"});
    if(raw==="reject")return null;
    const [cash,bank,projectedNet,...fields]=raw.split(",").map(Number);
    const rows=keys.map((key,i)=>{const [shares,lastBuyPrice,basis,invested,recovered,net]=fields.slice(i*6,i*6+6);return {key,shares,lastBuyPrice,basis,invested,recovered,net};});
    return {cash,bank,rows,projectedNet};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test("BK-05 A/B/C and approved D/E exact Perl trade differential with original partial sale basis and net",()=>{
  let rows=emptyStockPortfolio(),cash=1000000,bank=1000000;
  const commands=[...keys.map(key=>({action:"buy",key,quantity:3,prices:p})),
    ...keys.map(key=>({action:"sell",key,quantity:1,prices:p.map(n=>n+30)})),
    ...keys.map(key=>({action:"sell",key,quantity:2,prices:p.map(n=>n-10)}))];
  for(const command of commands){
    const input={rows,cash,bank,...command},js=projectStockTrade(input);
    const pl=oracle(input,true);
    assert.deepEqual(js.rows,pl.rows);assert.equal(js.cash,pl.cash);assert.equal(js.bank,pl.bank);
    assert.equal(js.record.projectedNet,pl.projectedNet);
    ({rows,cash,bank}=js);
  }
  assert.ok(rows.every(r=>!r.shares&&!r.invested&&!r.recovered));
  assert.equal(stockPortfolioOverview(rows,p).cumulativeNet,50);
});
test("BK-05 decision A exact own-price funds, 200 cap, zero, insufficient holding, expired buy/sell",()=>{
  const base={rows:emptyStockPortfolio(),prices:p,cash:100,bank:1000,action:"buy",key:"D",quantity:1};
  assert.ok(oracle(base,false));assert.equal(oracle(base,true),null);
  assert.throws(()=>projectStockTrade(base),/現金不足/);
  assert.throws(()=>projectStockTrade({...base,key:"E",cash:500,bank:499}),/存款不足/);
  const e={...base,prices:[900,200,300,400,100],key:"E",cash:100,bank:100};
  assert.equal(oracle(e,false),null);assert.deepEqual(projectStockTrade(e).rows,oracle(e,true).rows);
  assert.equal(projectStockTrade(e).cash,0);assert.equal(projectStockTrade(e).bank,100);
  assert.throws(()=>projectStockTrade({...base,cash:1000000,bank:1000000,quantity:201}),/上限/);
  const held=projectStockTrade({...base,cash:1000000,bank:1000000,quantity:200});
  assert.equal(held.rows[3].shares,200);
  assert.throws(()=>projectStockTrade({...base,action:"sell"}),/持股不足/);
  assert.equal(projectStockTrade({...base,quantity:0}).record,null);
  assert.equal(projectStockTrade({...base,expired:true}).cash,100);
});
test("BK-05 original clear liquidates all at current prices even expired; resets all record totals",()=>{
  const rows=emptyStockPortfolio();rows[0]={...rows[0],shares:3,lastBuyPrice:100,basis:300,invested:300,net:-300};
  rows[4]={...rows[4],shares:2,lastBuyPrice:500,basis:1000,invested:1000,net:-1000};
  const out=projectStockTrade({rows,prices:[120,200,300,400,450],cash:100,bank:300,action:"clear",expired:true});
  assert.equal(out.cash,1360);assert.equal(out.bank,300);assert.deepEqual(out.rows,emptyStockPortfolio());
  assert.deepEqual(out.record,{action:"clear",amount:1260});
});
