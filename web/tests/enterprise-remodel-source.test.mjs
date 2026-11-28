import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {parseHouseCatalog} from "../src/housing.mjs";
const src=n=>readFileSync(new URL("../../"+n,import.meta.url),"utf8");
test("HS-03 additional building actual original remodel quote vs deduction (decision evidence only)",()=>{
 const house=src("original_house.cgi"),catalog=parseHouseCatalog(src("town_ini.cgi"),src("command.pl"));
 const display=house.match(/\$ie_hash\{\$_\}\s*=\s*int\(\$ie_hash\{\$_\}\s*\*\s*\$ie_bairitu\);/)[0];
 const branch=house.slice(house.indexOf("if ($in{'command'} eq \"do_change2\")"));
 const cost=branch.match(/\$kensetu_hiyou = \$ie_hash\{\$in\{'iegazou'\}\};/)[0];
 const check=branch.match(/if \(\$kensetu_hiyou > \$money\)\{&error\("[^"]+"\);\}/)[0];
 const debit=branch.match(/\$money -= \$kensetu_hiyou;/)[0];
 const price=catalog.houses.find(x=>x.id==="house/kamakura.gif").priceWan;
 const program='$ie_hash{"house/kamakura.gif"}='+price+';$ie_bairitu=2; $_="house/kamakura.gif"; '+display+' print $ie_hash{$_}*10000,","; $ie_hash{$_}='+price+'; $in{"iegazou"}=$_;$money=1000;sub error {die $_[0]} '+cost+check+debit+' print $kensetu_hiyou,",",$money;';
 assert.deepEqual(execFileSync("perl",["-e",program],{encoding:"utf8"}).split(",").map(Number),[1000000,50,950]);
});
