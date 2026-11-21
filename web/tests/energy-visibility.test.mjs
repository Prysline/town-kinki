import test from "node:test";
import assert from "node:assert/strict";
import {shouldShowCompactEnergy} from "../public/energy-visibility.js";

const base={gameVisible:true,hasCharacter:true,statusView:true,bodyRowBottom:200,profileTabsBottom:300};

test("固定列：圖一能量欄早已捲離，設施尚未捲到頂端就必須顯示",()=>{
  assert.equal(shouldShowCompactEnergy({...base,bodyRowBottom:-130,profileTabsBottom:-300}),true);
  assert.equal(shouldShowCompactEnergy({...base,bodyRowBottom:-1}),true);
  assert.equal(shouldShowCompactEnergy({...base,bodyRowBottom:0}),true);
});

test("固定列：捲回身體能量可見處就收起，避免重複資訊",()=>{
  assert.equal(shouldShowCompactEnergy(base),false);
  assert.equal(shouldShowCompactEnergy({...base,bodyRowBottom:1}),false);
  assert.equal(shouldShowCompactEnergy({...base,bodyRowBottom:90}),false);
});

test("固定列：切到物品或能力頁時，依右側頁籤是否離開視窗判定",()=>{
  assert.equal(shouldShowCompactEnergy({...base,statusView:false,profileTabsBottom:80,bodyRowBottom:0}),false);
  assert.equal(shouldShowCompactEnergy({...base,statusView:false,profileTabsBottom:-5,bodyRowBottom:500}),true);
});

test("固定列：無角色、離開遊戲或多人登出後都不可顯示",()=>{
  for(const inputs of [
    {...base,hasCharacter:false,bodyRowBottom:-200},
    {...base,gameVisible:false,bodyRowBottom:-200},
    {...base,hasCharacter:false,statusView:false,profileTabsBottom:-200},
    {...base,gameVisible:false,statusView:false,profileTabsBottom:-200}
  ])assert.equal(shouldShowCompactEnergy(inputs),false);
});
