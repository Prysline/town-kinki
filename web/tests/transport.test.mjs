import test from "node:test";
import assert from "node:assert/strict";
import { quoteTrainFare,trainDestinations,travelByTrain } from "../src/transport.mjs";
import { createCharacterData } from "../src/engine.mjs";

const ORIGINAL_ROUTES=[
  [0,1,950],
  [0,2,780],
  [0,3,1210],
  [1,2,950],
  [1,3,2210],
  [2,3,1530]
];
test("station.cgi::idou 六組四城票價，往返同價且涵蓋全部 12 種異城方向",()=>{
  for(const [from,to,amount] of ORIGINAL_ROUTES){
    assert.equal(quoteTrainFare(from,to),amount);
    assert.equal(quoteTrainFare(to,from),amount);
  }
  for(let from=0;from<4;from++){
    const destinations=trainDestinations(from);
    assert.deepEqual(destinations.map(route=>route.townId),[0,1,2,3]);
    assert.equal(destinations[from].fare,0);
    for(let to=0;to<4;to++){
      if(from!==to)assert.equal(destinations[to].fare,quoteTrainFare(from,to));
    }
  }
});
test("同城、錯誤目的地、非整數目的地皆拒絕，不能免票切換",()=>{
  for(let town=0;town<4;town++)
    assert.throws(()=>quoteTrainFare(town,town),/已在此城鎮/);
  for(const dest of [-1,4,99,1.1,"1",null,undefined])
    assert.throws(()=>quoteTrainFare(0,dest),/不存在的城鎮/);
  for(const from of [-1,4,0.1,"0",null])
    assert.throws(()=>quoteTrainFare(from,1),/不存在的城鎮/);
});
test("移動會按伺服器存檔城鎮收現金；餘額不足不得改地點，來源物件不變",()=>{
  const initial=createCharacterData("旅客","other",100000);
  const enough={...initial,townId:1,money:2210};
  const travelled=travelByTrain(enough,3);
  assert.equal(travelled.fare,2210);
  assert.equal(travelled.fromTownId,1);
  assert.equal(travelled.toTownId,3);
  assert.equal(travelled.character.money,0);
  assert.equal(travelled.character.townId,3);
  assert.equal(enough.money,2210);
  assert.equal(enough.townId,1);
  assert.throws(()=>travelByTrain({...enough,money:2209},3),/現金不足/);
  assert.throws(()=>travelByTrain({...enough,money:-1},3),/現金數值不正確/);
  assert.throws(()=>travelByTrain({...enough,money:1.2},3),/現金數值不正確/);
});
