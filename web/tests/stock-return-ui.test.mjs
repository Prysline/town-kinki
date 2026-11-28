import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {shouldReturnToTown,canReturnToTown,returnReceiptKey} from "../public/modules/town-return.js";
const live={character:{name:"居民"},stock:{},roadTravel:{pending:null}};
test("BK-05 SPA return semantics: original completed town actions, not GET/poll/stock or facility loops",()=>{
  for(const path of ["login","character","job","work","meal/eat","train","hospital/treat","bank","bank/term","bank/transfer","bank/loan/borrow","bank/loan/payoff","house/build","house/remodel","house/sell","move","road/arrive","onsen/leave"])
    assert.equal(shouldReturnToTown(path,{},live),true,path);
  for(const path of ["state","town/return","stock/access","inventory/legacy/use","retail/buy","crafting/make","coupon/redeem","recycle/buy","recycle/sell","wholesale/buy","arcade/dice/play","fishing/cast","map/tile","solo/time/advance","road/start","onsen/enter","register"])
    assert.equal(shouldReturnToTown(path,{},live),false,path);
  assert.equal(canReturnToTown({...live,onsen:{active:{id:1}}}),false);
  assert.equal(canReturnToTown({...live,roadTravel:{pending:{id:1}}}),false);
  assert.equal(canReturnToTown({character:null}),false);
  assert.equal(returnReceiptKey("road/arrive",{tripId:5}),"stock_road_5");
  assert.equal(returnReceiptKey("onsen/leave",{visitId:7}),"stock_onsen_7");
  assert.equal(returnReceiptKey("bank/transfer",{requestId:"abcdefgh"}),"stock_return_bank_transfer_abcdefgh");
  assert.equal(returnReceiptKey("manual",{},()=>"abcdefghijkl"),"stock_return_abcdefghijkl");
  const script=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(script,/if\(data!==undefined&&shouldReturnToTown\(path,data,result\)\)/);
  assert.match(script,/setInterval\(async \(\) => \{[\s\S]*?state = await api\("state"\); render\(\);[\s\S]*?\}, 30000\);/);
});
