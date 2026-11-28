import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
const src=n=>readFileSync(new URL("../../"+n,import.meta.url),"utf8");
const operation=src("unei_2.pl"),corporation=src("kaishiya.pl"),lib=src("town_lib.pl");
test("HS-03 source property limits, four independent additions, original retention default",()=>{
 const command=src("command.pl"),house=src("original_house.cgi");
 assert.match(command,/\$mochiie_max\s*=\s*5\s*;/);
 assert.match(command,/@housu_tuika2\s*=\s*\(100,100,1000,500\)/);
 assert.match(command,/\$ie_bairitu\s*=\s*2\s*;/);
 assert.match(command,/\$takuthisyubetu\s*=\s*'no'/);
 assert.match(house,/\$baikyku_syoumetu\s*=\s*'no'/);
 for(const name of ["unei_2","kaishiya","motimono_hanbai"])assert.ok(house.includes("&"+name+";"));
});
test("HS-04 actual original education fee and unsafe debit, not Web authorization",()=>{
 for(const [source,feeVar] of [[operation,"unei_hiyou"],[corporation,"kyouikuhiyou"]]){
  assert.match(source,/\$unei_time\s*=\s*1\s*;/);
  assert.match(source,/\$unei_koritu\s*=\s*10\s*;/);
  assert.ok(source.includes("$"+feeVar+" = 20000;"));
  const gain=source.match(/\$konoagatta_suuti\s*=\s*int\(\$in\{'par_suuti'\}\/\$unei_koritu\);/)[0];
  const fee=source.match(/\$youikuhi\s*=\s*\$konoagatta_suuti\s*\*\s*\$\w+;/)[0];
  const debit=source.match(/if \(\$in\{'siharaihouhou'\} ne "現金"\)\{[\s\S]*?\$money -= \$youikuhi;\s*\}/)[0];
  for(const amount of [1,5,10,19,1000])for(const payment of ["現金","credit"]){
   const program='$money=1000;$bank=1000;$unei_koritu=10;$'+feeVar+'=20000;$in{"par_suuti"}='+amount+';$in{"siharaihouhou"}="'+payment+'";sub error {die $_[0]} sub kityou_syori {};\n'+gain+'\n'+fee+'\n'+debit+'\nprint join(",", $konoagatta_suuti,$youikuhi,$money,$bank);';
   const n=Math.floor(amount/10),cost=n*20000;
   assert.deepEqual(execFileSync("perl",["-e",program],{encoding:"utf8"}).split(",").map(Number),[n,cost,1000-(payment==="現金"?cost:0),1000-(payment==="credit"?cost:0)]);
  }
 }
});
test("HS-04 actual Perl daily revenue: shared accumulator across both companies, isolated synthetic member files",()=>{
 const block=lib.match(/sub unei_siokuri2\s*\{[\s\S]*?(?=\n#-----アイテムゲット)/)[0];
 const dir=mkdtempSync(join(tmpdir(),"town-enterprise-oracle-"));
 try{
  mkdirSync(join(dir,"member","1"),{recursive:true});mkdirSync(join(dir,"member","2"),{recursive:true});
  const row=(job,rank)=>{const fields=Array(32).fill("0");fields[0]="1";fields[4]=job;fields[31]=String(rank);return fields.join("<>")+"\n";};
  writeFileSync(join(dir,"member","1","1_log.cgi"),row("jobA",1));
  writeFileSync(join(dir,"member","1","2_log.cgi"),row("jobB",2));
  writeFileSync(join(dir,"member","1","kaishiya_kanri.cgi"),"1<>owner<>0<>\n2<>officer<>0<>\n");
  writeFileSync(join(dir,"member","2","log.cgi"),"2<>officer<>\n");
  const program=block+'\n$k_id=1;$bank=100;$job_kihonkyuu{"jobA"}=4000;$job_kihonkyuu{"jobB"}=8000;sub error {die $_[0]} sub aite_sprit {$aite_bank=100} sub aite_temp_routin {$aite_k_temp="2<>officer<>$aite_bank<>\\n"} sub kityou_syori {push @owner,$_[2]} sub aite_kityou_syori {push @officer,$_[2]}; unei_siokuri2(); unei_siokuri3(); print join(",",@owner,@officer,$bank,$aite_bank);';
  assert.deepEqual(execFileSync("perl",["-e",program],{cwd:dir,encoding:"utf8"}).split(",").map(Number),[10000,30000,30000,40100,30100]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
