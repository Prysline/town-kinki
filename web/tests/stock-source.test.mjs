import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {parseStockSource,projectStockAccess,projectStockMarketTick} from "../src/stock-source.mjs";
const event=readFileSync(new URL("../../event.pl",import.meta.url),"utf8");
const kabu=readFileSync(new URL("../../kabu.cgi",import.meta.url),"utf8");
const lib=readFileSync(new URL("../../town_lib.pl",import.meta.url),"utf8");
const source=parseStockSource(event,kabu);
const block=event.match(/#2006\/12\/17 2007\/01\/05[\s\S]*?(?=\s*if\(\$in\{'goki'\} eq "on"\))/)[0];
const NOW=1000000;
function perlMarket({prices=null,backup=false,guestCount=0,tradeCount=0,tradeUntil=0,fractions}){
  const dir=mkdtempSync(join(tmpdir(),"town-stock-oracle-"));
  try{
    mkdirSync(join(dir,"log_dir"));
    const primary=join(dir,"log_dir/kab_hendou.cgi"),copy=join(dir,"log_dir/kab_hendou_b.cgi");
    writeFileSync(primary,prices===null?"":[...prices,tradeCount,tradeUntil,""].join("<>")+"\n");
    if(backup)writeFileSync(copy,"");
    writeFileSync(join(dir,"guestlog_00.cgi"),"guest\n".repeat(guestCount));
    const program='BEGIN { *CORE::GLOBAL::time=sub(){'+NOW+'}; @r=('+fractions.join(",")+'); $draws=0; *CORE::GLOBAL::rand=sub { my $n=$_[0]||1; die "extra draw" if $draws>=@r; return $r[$draws++]*$n; }; }\n'+
      '$guestfile="./guestlog_00.cgi"; $in{"name"}="fixture"; sub error { die $_[0]; } \n'+block+'\n'+
      'print join(",", map { 0+$_ } ($kabukaA,$kabukaB,$kabukaC,$kabukaD,$kabukaE,$torihiki,$torihiki_time)); print "<>$draws<>".(-z "./log_dir/kab_hendou.cgi"?"empty":"present")."<>".($kab_hendou||0);';
    const [values,draws,file,changed]=execFileSync("perl",["-e",program],{cwd:dir,encoding:"utf8"}).split("<>");
    const n=values.split(",").map(Number);
    // Original event branch only resets the persisted count on a change.
    const persisted=readFileSync(primary,"utf8").split("\n")[0];
    const persistedCount=persisted?Number(persisted.split("<>")[5]):null;
    return {prices:n.slice(0,5),tradeCount:persistedCount,tradeUntil:n[6],draws:Number(draws),file,changed:Number(changed)};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test("BK-05 actual original empty backup shadows 25000 bootstrap; do not invent initialization",()=>{
  assert.deepEqual(source.bootstrapPrices,[25000,25000,25000,25000,25000]);
  const direct=perlMarket({fractions:[.5,.5]});
  assert.deepEqual(direct.prices,source.bootstrapPrices);assert.equal(direct.file,"present");
  const empty=perlMarket({backup:true,fractions:[.5,.5]});
  assert.deepEqual(empty.prices,[0,0,0,0,0]);assert.equal(empty.file,"empty");assert.equal(empty.draws,2);
  const recover=perlMarket({backup:true,guestCount:1,fractions:[.25,.99]});
  assert.deepEqual(recover.prices,[10000,10000,10000,10000,10000]);
  assert.equal(recover.file,"present");assert.equal(recover.changed,1);
});
test("BK-05 market movement actual Perl differential: cap, acquisitions, all ten single stock branches, zero guests and strict deadline",()=>{
  const prices=[250,249,25000,50000,90000];
  const cases=[
    {guestCount:1,fractions:[.15,.99]},{guestCount:1,fractions:[.25,.99]},
    ...Array.from({length:10},(_,i)=>({guestCount:1,fractions:[.95,(i+1.5)/20,.99]})),
    {guestCount:0,fractions:[.99,.99]},{guestCount:1,fractions:[.95,.95]},
    {guestCount:1,tradeCount:1,tradeUntil:NOW,fractions:[]},
    {guestCount:1,tradeCount:1,tradeUntil:NOW-1,fractions:[.15,.99]}
  ];
  for(const c of cases){
    const m={prices,tradeCount:c.tradeCount??0,tradeUntil:c.tradeUntil??0};let calls=0;
    const js=projectStockMarketTick(m,c.guestCount,NOW,n=>n*c.fractions[calls++]);
    const p=perlMarket({...m,...c});
    assert.deepEqual(js.prices,p.prices);assert.equal(js.tradeCount,p.tradeCount);
    assert.equal(js.tradeUntil,p.tradeUntil);assert.equal(calls,p.draws);
    assert.equal(Boolean(js.event),Boolean(p.changed));
  }
});
test("BK-05 source access sliding global window: exact expiry boundary and counter",()=>{
  const m={prices:source.bootstrapPrices,tradeCount:3,tradeUntil:NOW};
  assert.deepEqual(projectStockAccess(m,NOW),{...m,tradeCount:4,tradeUntil:NOW+180,expired:false});
  assert.equal(projectStockAccess(m,NOW+1).expired,true);
  const access=kabu.match(/if \(\$ima_time > \$torihiki_time\)\{[\s\S]*?\$torihiki_time = \$ima_time \+ \$koniyu_kyka;/)[0];
  for(const now of [NOW-1,NOW,NOW+1]){
    const p=execFileSync("perl",["-e",'($ima_time,$torihiki_time,$torihiki)=@ARGV; $koniyu_kyka=180; '+access+' print join(",", $torihiki,$torihiki_time,$torihiki_mukou||0);',String(now),String(NOW),"3"],{encoding:"utf8"});
    const js=projectStockAccess(m,now);
    assert.equal(p,[js.tradeCount,js.tradeUntil,Number(js.expired)].join(","));
  }
});
test("BK-05 actual Perl D and E checks can admit negative cash; E can reject despite sufficient own-price funds",()=>{
  const buy=kabu.match(/if \(\$torihiki_mukou != 1 && \$in\{'command'\} eq "kau"\)\{[\s\S]*?(?=\s*if \(\$torihiki_mukou != 1 && \$in\{'command'\} eq "uru")/)[0];
  const bankruptcy=lib.match(/if \(\$money =~ \/\D*?\\D\\-\/\)\{\$money = 0;\$bank = 0;\}/)?.[0]??
    'if ($money =~ /\\D\\-/){$money = 0;$bank = 0;}';
  assert.ok(lib.includes(bankruptcy),"exact original bankruptcy check");
  function probe(key,money,bank,a,d,e){
    const script='($in{"meigara"},$money,$bank,$kabukaA,$kabukaD,$kabukaE)=@ARGV; $in{"command"}="kau"; $in{"kouniyu"}=1; $konu_jogen=200; sub error {die "reject";} eval {'+buy+'}; $bad=$@?1:0; '+bankruptcy+' print join(",", $bad,$money,$bank);';
    return execFileSync("perl",["-e",script,key,String(money),String(bank),String(a),String(d),String(e)],{encoding:"utf8"});
  }
  assert.equal(probe("Akabu",100,100,100,300,500),"0,0,100");
  assert.equal(probe("Dkabu",100,300,100,300,500),"0,-200,300");
  assert.equal(probe("Ekabu",100,100,100,300,500),"0,-400,100");
  assert.equal(probe("Ekabu",300,300,500,300,100),"1,300,300");
});
