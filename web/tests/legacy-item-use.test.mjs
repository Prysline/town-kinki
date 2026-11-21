import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {STAT_KEYS,decodeLegacyText} from "../src/engine.mjs";
import {
  initLegacyItemUseTables,listLegacyItemActions,listLegacyItemUseHistory,useLegacyItem,
  supportsLegacyItemUse
} from "../src/legacy-item-use.mjs";

const NOW=1_700_000_000_000;
const stats=()=>Object.fromEntries(STAT_KEYS.map(key=>[key,20]));
function archived({
  category="薬",name="風邪薬",effect="風邪,10",durability=3,
  unit="回",interval=30,bodyCost=0,brainCost=0,calories=0,
  lastUsed=0,bonuses={},purchasedAt=1690000000
}={}){
  const fields=Array(33).fill("");
  fields[0]=category;fields[1]=name;fields[9]=effect;
  for(const [key,i] of STAT_KEYS.map((key,i)=>[key,[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20][i]]))
    fields[i]=String(bonuses[key]??0);
  fields[17]="1500";fields[21]=String(durability);fields[22]=unit;
  fields[23]=String(interval);fields[25]=String(calories);fields[26]=String(lastUsed);
  fields[27]=String(bodyCost);fields[28]=String(brainCost);
  fields[30]=String(purchasedAt);
  return fields;
}
function createDb(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "name TEXT NOT NULL,money INTEGER NOT NULL,bank INTEGER NOT NULL,",
    "stats_json TEXT NOT NULL,body_energy INTEGER NOT NULL,brain_energy INTEGER NOT NULL,",
    "recovered_at INTEGER NOT NULL,health_index INTEGER NOT NULL,weight REAL NOT NULL,",
    "height INTEGER NOT NULL,bmi REAL NOT NULL,last_meal_at INTEGER NOT NULL);",
    "INSERT INTO users(id,username) VALUES(1,'owner'),(2,'other');"
  ].join("\n"));
  const stmt=db.prepare([
    "INSERT INTO characters(user_id,name,money,bank,stats_json,body_energy,brain_energy,",
    "recovered_at,health_index,weight,height,bmi,last_meal_at)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" "));
  for(const [id,name] of [[1,"甲"],[2,"乙"]])
    stmt.run(id,name,100000,50000,JSON.stringify(stats()),25,35,
      NOW,-13,60,165,22,0);
  initLegacyItemUseTables(db);
  return db;
}
function addItem(db,sourceLine,fields,userId=1){
  const stmt=db.prepare([
    "INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,",
    "effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json)",
    "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ].join(" "));
  stmt.run(userId,"00042",sourceLine,fields[0],fields[1],fields[9],
    Number(fields[21]),fields[22],Number(fields[30])||null,Number(fields[26])||0,
    JSON.stringify(fields));
}
function read(db,id=1){
  const row=db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);
  return {...row,stats:JSON.parse(row.stats_json)};
}
const use=(db,line,requestId="olditem-0001",now=NOW,userId=1)=>
  useLegacyItem(db,userId,line,requestId,now);

test("只允許原版 33 欄與已核對使用規則；未開放的特殊道具仍為唯讀",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived());
    addItem(db,2,archived({name:"おばあちゃんの知恵薬",
      effect:"万能,20"}));
    addItem(db,3,archived({name:"ランダム品",effect:"無"}));
    addItem(db,4,archived({name:"健康保険",unit:"日"}));
    addItem(db,5,archived({name:"ギフト",category:"ギフト",effect:"無"}));
    addItem(db,6,archived({name:"基本薬",effect:"無",durability:0}));
    const available=listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW);
    assert.deepEqual(available.map(x=>x.sourceLine),[1,2,6]);
    assert.equal(available[0].canUse,true);
    assert.equal(available[1].canUse,true);
    assert.equal(available[2].canUse,false);
    assert.match(available[2].reason,/用盡/);
    for(const line of [3,4,5])
      assert.throws(()=>use(db,line,"blocked-"+line+"-01"),/尚未支援/);
    assert.equal(listLegacyItemUseHistory(db,1).length,0);
  }finally{db.close();}
});

test("原版自販機牛奶「効果」透過負能量消耗實際回復，冷卻及請求防重不變",()=>{
  const db=createDb();
  try{
    db.prepare("UPDATE characters SET brain_energy=0,body_energy=0 WHERE user_id=1").run();
    addItem(db,1,archived({category:"ドリンク",name:"爽快ミルク",effect:"効果",
      durability:2,interval:3,bodyCost:0,brainCost:-500,calories:300,
      bonuses:{kokugo:1}}));
    addItem(db,2,archived({category:"ドリンク",name:"元気ミルク",effect:"効果",
      durability:1,interval:3,bodyCost:-500,brainCost:0,calories:300}));
    const available=listLegacyItemActions(db,1,{
      bodyEnergy:0,brainEnergy:0,lastMealAt:0
    },NOW);
    assert.deepEqual(available.map(x=>x.sourceLine),[1,2]);
    assert.ok(available.every(x=>x.canUse));
    const first=use(db,1,"vending_milk_brain");
    assert.equal(first.replayed,false);
    assert.ok(first.changes.brainEnergy>0);
    assert.equal(first.changes.stats.kokugo,1);
    assert.equal(read(db).weight,60.3);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=1").get().remaining,1);
    assert.throws(()=>use(db,1,"vending_milk_cooldown",NOW+1000),/間隔/);
    const again=use(db,1,"vending_milk_brain",NOW+10000);
    assert.equal(again.replayed,true);
    assert.deepEqual(again.changes,first.changes);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=1").get().remaining,1);
    const body=use(db,2,"vending_milk_body",NOW);
    assert.ok(body.changes.bodyEnergy>0);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=2").get().remaining,0);
    assert.equal(listLegacyItemUseHistory(db,1).length,2);
  }finally{db.close();}
});

test("沒有來源證實的「効果」商品與篡改能量欄位不能假冒自販機牛奶",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({category:"ドリンク",name:"仿製牛奶",effect:"効果",
      bodyCost:0,brainCost:-500}));
    addItem(db,2,archived({category:"ドリンク",name:"爽快ミルク",effect:"効果",
      bodyCost:0,brainCost:-501}));
    addItem(db,3,archived({category:"ドリンク",name:"爽快ミルク",effect:"効果,1",
      bodyCost:0,brainCost:-500}));
    const actions=listLegacyItemActions(db,1,{bodyEnergy:25,brainEnergy:35,lastMealAt:0},NOW);
    assert.deepEqual(actions,[]);
    for(let i=1;i<=3;i++)
      assert.throws(()=>use(db,i,"fake-milk-"+i+"-0001"),/尚未支援/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_item_usage").get().n,0);
  }finally{db.close();}
});

test("感冒藥依原版只在風邪分類增加疾病指數，扣除使用次數並保存獨立歷史",()=>{
  const db=createDb();
  try{
    const original=archived({bodyCost:2,brainCost:3,bonuses:{kenkou:1}});
    addItem(db,1,original);
    const first=use(db,1);
    assert.equal(first.replayed,false);
    assert.equal(first.changes.healthIndex,10);
    assert.equal(first.changes.stats.kenkou,1);
    assert.equal(first.changes.bodyEnergy,-2);
    assert.equal(first.changes.brainEnergy,-3);
    assert.equal(read(db).health_index,-3);
    assert.equal(read(db).stats.kenkou,21);
    assert.equal(read(db).body_energy,23);
    assert.equal(read(db).brain_energy,32);
    assert.equal(read(db).money,100000);
    assert.equal(read(db).bank,50000);
    assert.equal(db.prepare("SELECT remaining,last_used_at_ms FROM legacy_item_usage").get().remaining,2);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.equal(listLegacyItemUseHistory(db,2).length,0);
    const saved=db.prepare("SELECT raw_fields_json,durability FROM legacy_inventory_items WHERE user_id=1 AND source_line=1").get();
    assert.equal(saved.durability,3);
    assert.deepEqual(JSON.parse(saved.raw_fields_json),original);
    assert.throws(()=>use(db,1,"olditem-0002",NOW+1),/間隔/);
    const second=use(db,1,"olditem-0002",NOW+30*60000);
    assert.equal(second.changes.healthIndex,10);
    assert.equal(read(db).health_index,7);
    const third=use(db,1,"olditem-0003",NOW+60*60000);
    assert.equal(third.changes.healthIndex,0);
    assert.equal(read(db).health_index,7);
    assert.equal(listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW+60*60000)[0].remaining,0);
    assert.throws(()=>use(db,1,"olditem-0004",NOW+90*60000),/用盡/);
    assert.equal(listLegacyItemUseHistory(db,1).length,3);
  }finally{db.close();}
});

test("網路回覆遺失時同一請求重送不重複套用效果，也不能改用其他道具",()=>{
  const db=createDb();
  try {
    addItem(db,1,archived({effect:"無",interval:0,bonuses:{kokugo:3}}));
    addItem(db,2,archived({effect:"無",interval:0,bonuses:{suugaku:3}}));
    const first=use(db,1,"repeat-old-item-1");
    assert.equal(read(db).stats.kokugo,23);
    const repeat=use(db,1,"repeat-old-item-1",NOW+DAY);
    assert.equal(repeat.replayed,true);
    assert.deepEqual(repeat.changes,first.changes);
    assert.equal(read(db).stats.kokugo,23);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.throws(()=>use(db,2,"repeat-old-item-1"),/相同請求/);
  }finally{db.close();}
});
const DAY=86400000;

test("食品與食堂共用 60 分鐘用餐間隔，增加熱量、能力及體重",()=>{
  const db=createDb();
  try {
    addItem(db,1,archived({category:"食料品",name:"頭脳パン",effect:"無",
      durability:2,interval:0,calories:800,bonuses:{kokugo:3,tairyoku:1}}));
    const first=use(db,1,"food-old-0001");
    assert.equal(first.changes.food,true);
    assert.equal(read(db).last_meal_at,NOW);
    assert.equal(read(db).weight,60.8);
    assert.equal(read(db).stats.kokugo,23);
    assert.equal(read(db).stats.tairyoku,21);
    assert.throws(()=>use(db,1,"food-old-0002",NOW+59000),/60 分鐘/);
    const second=use(db,1,"food-old-0002",NOW+3600000);
    assert.equal(second.changes.food,true);
    assert.equal(read(db).weight,61.6);
    assert.equal(read(db).last_meal_at,NOW+3600000);
    assert.equal(listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:NOW+3600000
    },NOW+3600000)[0].remaining,0);
  }finally{db.close();}
});

test("腹瀉、肺炎及結核效果只有對應病症時作用，其他疾病不會憑空治療",()=>{
  const effects=[["下痢,18",-17],["肺炎,20",-21],["結核,40",-41]];
  for(const [effect,index] of effects){
    const db=createDb();
    try {
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=1").run(index);
      addItem(db,1,archived({effect,interval:0}));
      const first=use(db,1,"disease-item-01");
      assert.ok(first.changes.healthIndex>0);
      const after=read(db).health_index;
      assert.equal(after,index+Number(effect.split(",")[1]));
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=1").run(-13);
      const second=use(db,1,"disease-item-02",NOW+1);
      assert.equal(second.changes.healthIndex,0);
      assert.equal(read(db).health_index,-13);
    }finally{db.close();}
  }
});

test("身高、增重、減重與原始 17 種能力均能一致更新 BMI",()=>{
  for(const [effect,weight,height] of [
    ["ウエイトアップ,2",62,165],
    ["ダイエット,2",58,165],
    ["身長,1",60,166],
    ["縮み,1",60,164]
  ]){
    const db=createDb();
    try{
      addItem(db,1,archived({effect,interval:0}));
      const result=use(db,1,"change-body-01");
      assert.equal(read(db).weight,weight);
      assert.equal(read(db).height,height);
      assert.equal(read(db).bmi,Math.round(weight/((height/100)**2)*10)/10);
      assert.equal(result.changes.weight,weight-60);
    }finally{db.close();}
  }
});

test("不足的身體／頭腦能量、原版冷卻時間、無效行號及其他帳號物品均拒絕並回滾",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:30,bodyCost:100}));
    addItem(db,2,archived({effect:"無",interval:30,brainCost:100}));
    addItem(db,3,archived({effect:"無",interval:10,
      lastUsed:Math.floor(NOW/1000)-60}));
    addItem(db,4,archived({effect:"無",interval:0,bonuses:{kokugo:5}}),2);
    assert.throws(()=>use(db,1,"energy-body-01"),/能量不足/);
    assert.throws(()=>use(db,2,"energy-brain-01"),/能量不足/);
    assert.throws(()=>use(db,3,"orig-cooldown-01"),/間隔/);
    assert.throws(()=>use(db,4,"other-player-01"),/找不到本人/);
    assert.throws(()=>use(db,999,"bad-line-0001"),/找不到本人/);
    assert.throws(()=>use(db,1,"x"),/識別碼/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,0);
    assert.equal(read(db).stats.kokugo,20);
    assert.equal(read(db,2).stats.kokugo,20);
  }finally{db.close();}
});

test("能力溢位、封存原始欄位變造會整筆拒絕且耐久不減",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:0,bonuses:{kokugo:1000}}));
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=1")
      .run(JSON.stringify({...stats(),kokugo:Number.MAX_SAFE_INTEGER}));
    assert.throws(()=>use(db,1,"overflow-item-01"),/安全範圍/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    db.prepare("UPDATE characters SET stats_json=? WHERE user_id=1")
      .run(JSON.stringify(stats()));
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json='[]' WHERE user_id=1 AND source_line=1").run();
    assert.throws(()=>use(db,1,"overflow-item-01"),/封存物品/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,0);
  }finally{db.close();}
});

test("建立道具使用資料表後重複初始化不會刪除既有封存或使用歷史",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:0}));
    use(db,1,"first-version-01");
    initLegacyItemUseTables(db);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,2);
  }finally{db.close();}
});


test("不完整的原版物品只從可使用清單略過，保留唯讀封存且不能消耗",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({effect:"無",interval:0}));
    addItem(db,2,archived({effect:"無",interval:0}));
    db.prepare("UPDATE legacy_inventory_items SET raw_fields_json='[]' WHERE user_id=1 AND source_line=2").run();
    const actions=listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW);
    assert.deepEqual(actions.map(x=>x.sourceLine),[1]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_inventory_items WHERE user_id=1").get().n,2);
    assert.throws(()=>use(db,2,"broken-item-01"),/封存物品/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_usage").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,0);
  }finally{db.close();}
});


test("原版萬能藥錯誤判斷式修正：任何疾病分級及健康時皆直接增加疾病指數",()=>{
  for(const [before,amount] of [
    [-130,3],[-80,15],[-50,20],[-30,2],[-13,15],[-5,20],[0,3],[50,15]
  ]){
    const db=createDb();
    try{
      db.prepare("UPDATE characters SET health_index=? WHERE user_id=1").run(before);
      addItem(db,1,archived({
        name:"おばあちゃんの知恵薬",effect:"万能,"+amount,
        durability:2,interval:0
      }));
      const actions=listLegacyItemActions(db,1,{
        bodyEnergy:25,brainEnergy:35,lastMealAt:0
      },NOW);
      assert.equal(actions.length,1);
      assert.equal(actions[0].canUse,true);
      const result=use(db,1,"universal-medicine-01");
      assert.equal(result.changes.healthIndex,amount);
      assert.equal(read(db).health_index,before+amount);
      assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,1);
      const replay=use(db,1,"universal-medicine-01",NOW+1000);
      assert.equal(replay.replayed,true);
      assert.equal(read(db).health_index,before+amount);
      assert.equal(listLegacyItemUseHistory(db,1).length,1);
    }finally{db.close();}
  }
});

test("萬能藥與只治特定疾病的藥物保持分流，非法萬能格式不能執行",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({name:"萬能藥",effect:"万能,15",interval:0}));
    addItem(db,2,archived({name:"損壞萬能藥",effect:"万能,-15",interval:0}));
    addItem(db,3,archived({name:"效果缺失",effect:"万能",interval:0}));
    addItem(db,4,archived({name:"萬能藥多段",effect:"万能,15,20",interval:0}));
    const actions=listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW);
    assert.deepEqual(actions.map(x=>x.sourceLine),[1]);
    for(const line of [2,3,4])
      assert.throws(()=>use(db,line,"invalid-universal-"+line),/尚未支援/);
    const result=use(db,1,"valid-universal-01");
    assert.equal(result.changes.healthIndex,15);
    assert.equal(read(db).health_index,2);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
  }finally{db.close();}
});


test("原版商品表五款萬能藥可按原本的疾病指數增幅直接使用",()=>{
  const catalog=decodeLegacyText(
    readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))
  );
  const rows=catalog.split(/\r?\n/).filter(line=>line.startsWith("薬<>"))
    .map(line=>{
      const fields=line.split("<>");
      if(fields.length===34&&fields[33]==="")fields.pop();
      return fields;
    }).filter(fields=>fields[9]?.startsWith("万能,"));
  const expected=[
    ["ユンケル",3],["おばあちゃんの知恵薬",15],
    ["おばあちゃんの知恵薬（スーパー）",20],
    ["リポビタンD",2],["リコリス",2]
  ];
  assert.deepEqual(rows.map(fields=>[fields[1],Number(fields[9].split(",")[1])]),expected);
  const db=createDb();
  try{
    db.prepare("UPDATE characters SET health_index=-80 WHERE user_id=1").run();
    for(let i=0;i<rows.length;i++){
      const fields=rows[i];
      assert.equal(fields.length,33);
      addItem(db,i+1,fields);
      const oldIndex=read(db).health_index;
      const result=use(db,i+1,"actual-medicine-"+(i+1));
      assert.equal(result.changes.healthIndex,expected[i][1]);
      assert.equal(read(db).health_index,oldIndex+expected[i][1]);
    }
    assert.equal(read(db).health_index,-38);
    assert.equal(listLegacyItemUseHistory(db,1).length,5);
  }finally{db.close();}
});


test("原版 13 筆美容用品：移植外貌增益、瘦身、身高與耐久，絕不假定改變角色圖像",()=>{
  const catalog=decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)));
  const cosmetics=catalog.split(/\r?\n/).filter(line=>line.startsWith("美容<>"))
    .map(line=>{
      const fields=line.split("<>");
      if(fields.length===34&&fields[33]==="")fields.pop();
      return fields;
    });
  assert.equal(cosmetics.length,13,"商品數量必須與原版美容分類一致");
  assert.deepEqual(cosmetics.map(fields=>fields[1]),[
    "ヘアーカラー(髪染め)","リフレッシュエステ","美顔パック","油取り紙",
    "シャネルの５番","シャネルの限定コフレ","Dior2004限定KIT",
    "ヌーブラ","フェロモン香水","幸せを呼ぶ香水",
    "スリムアップビューティ","バストアップブラ","セイ・ノビール"
  ]);
  for(const fields of cosmetics){
    const db=createDb();
    try{
      assert.equal(fields.length,33);
      assert.equal(fields[22],"回");
      addItem(db,1,fields);
      const expectedLooks=Number(fields[10]);
      const result=use(db,1,"cosmetics-original-1");
      assert.equal(result.changes.stats.looks??0,expectedLooks,fields[1]);
      assert.equal(read(db).stats.looks,20+expectedLooks,fields[1]);
      assert.equal(read(db,2).stats.looks,20,"不得影響其他玩家");
      assert.equal(result.changes.weight,fields[1]==="スリムアップビューティ"?-2:0);
      assert.equal(result.changes.height,fields[1]==="セイ・ノビール"?1:0);
      assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE user_id=1").get().remaining,
        Number(fields[21])-1);
      const replay=use(db,1,"cosmetics-original-1",NOW+1);
      assert.equal(replay.replayed,true);
      assert.equal(read(db).stats.looks,20+expectedLooks);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history WHERE user_id=1").get().n,1);
      assert.deepEqual(JSON.parse(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items WHERE user_id=1").get().raw_fields_json),fields,
        "原版 33 欄應保持唯讀封存");
    }finally{db.close();}
  }
});

function originalCatalogRows(){
  return decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url)))
    .split(/\r?\n/).map(line=>{
      const f=line.split("<>");if(f.length===34&&f[33]==="")f.pop();
      return f;
    }).filter(f=>f.length===33);
}
function originalItem(category,name){
  const found=originalCatalogRows().find(f=>f[0]===category&&f[1]===name);
  assert.ok(found,"找不到原版來源："+category+"／"+name);
  return [...found];
}
test("四款原始効果恢復商品包含兩款甜點：負耗能按實際欄位恢復，防重及間隔保留",()=>{
  const items=[
    ["ドリンク","元気ミルク",-500,0],
    ["ドリンク","爽快ミルク",0,-500],
    ["デザート","元気パフェ",-500,0],
    ["デザート","爽快パフェ",0,-500]
  ];
  for(const [category,name,bodyCost,brainCost] of items){
    const db=createDb();
    try{
      const fields=originalItem(category,name);
      assert.equal(fields[9],"効果");
      assert.equal(Number(fields[27]),bodyCost);
      assert.equal(Number(fields[28]),brainCost);
      assert.equal(supportsLegacyItemUse(fields),true);
      db.prepare("UPDATE characters SET body_energy=0,brain_energy=0 WHERE user_id=1").run();
      addItem(db,1,fields);
      const result=use(db,1,"parfait-recover-001");
      assert.equal(result.replayed,false);
      assert.equal(result.changes.bodyEnergy>0,bodyCost<0);
      assert.equal(result.changes.brainEnergy>0,brainCost<0);
      assert.equal(read(db).weight,60.3);
      assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,0);
      assert.throws(()=>use(db,1,"parfait-recover-002",NOW+1000),/用盡/);
      assert.equal(use(db,1,"parfait-recover-001",NOW+1000).replayed,true);
    }finally{db.close();}
  }
});
test("能量恢復標記必須符合原版四款品名與 -500 欄位，仿製品仍拒絕使用",()=>{
  const db=createDb();
  try{
    addItem(db,1,archived({category:"デザート",name:"自製元気パフェ",
      effect:"効果",bodyCost:-500,brainCost:0}));
    addItem(db,2,archived({category:"デザート",name:"元気パフェ",
      effect:"効果",bodyCost:-501,brainCost:0}));
    addItem(db,3,archived({category:"デザート",name:"爽快パフェ",
      effect:"効果",bodyCost:0,brainCost:-499}));
    assert.equal(listLegacyItemActions(db,1,{
      bodyEnergy:25,brainEnergy:35,lastMealAt:0
    },NOW).length,0);
    for(const [i,id] of [[1,"false-parfait-01"],[2,"false-parfait-02"],
      [3,"false-parfait-03"]])
      assert.throws(()=>use(db,i,id),/尚未支援/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,0);
  }finally{db.close();}
});
test("ステータス 原版三款實際只套用能力／能量欄位，不偽造額外特效",()=>{
  const cases=[
    ["関西名産店","阪神タイガースの公式チケット"],
    ["ゲーム","バイオハザード（wiiバージョン"],
    ["ゲーム","キングダムハーツ2ファイナルミックス＋"]
  ];
  for(const [category,name] of cases){
    const db=createDb();
    try{
      const fields=originalItem(category,name);
      assert.equal(fields[9],"ステータス");
      assert.equal(supportsLegacyItemUse(fields),true);
      if(fields[22]==="日")
        fields[30]=String(Math.floor(NOW/1000));
      // 遊戲道具的原版能量消耗較高；增加角色能力，讓「能量足額」可測。
      const stronger=Object.fromEntries(STAT_KEYS.map(k=>[k,1000]));
      db.prepare("UPDATE characters SET stats_json=?,body_energy=400,brain_energy=400 WHERE user_id=1")
        .run(JSON.stringify(stronger));
      addItem(db,1,fields);
      const before=read(db);
      const result=use(db,1,"status-effect-01");
      assert.equal(result.replayed,false);
      assert.equal(result.changes.healthIndex,0);
      const expectedLooks=Number(fields[10]||0);
      assert.equal(result.changes.stats.looks??0,expectedLooks);
      assert.equal(read(db).stats.looks,1000+expectedLooks);
      assert.equal(result.changes.bodyEnergy,-Number(fields[27]||0)||0);
      assert.equal(result.changes.brainEnergy,-Number(fields[28]||0)||0);
      assert.equal(read(db).health_index,before.health_index);
    }finally{db.close();}
  }
  const db=createDb();
  try{
    addItem(db,1,archived({category:"ゲーム",name:"捏造遊戲效果",effect:"ステータス"}));
    assert.throws(()=>use(db,1,"invalid-status-01"),/尚未支援/);
  }finally{db.close();}
});
test("有第三段原版食物標記的體重效果會正常生效，並遵守食物冷卻限制",()=>{
  const examples=[
    ["ちゃんこ","どすこいスーパーちゃんこ","ウエイトアップ,1,食料品",1],
    ["ちゃんこ","どすこいスーパーつまみ食い","ウエイトアップ,1,ファ",1],
    ["スーパー","断食セット","ダイエット,30,食料品",-30]
  ];
  for(const [category,name,effect,weightEffect] of examples){
    const db=createDb();
    try{
      const fields=originalItem(category,name);
      assert.equal(fields[9],effect);
      // 原版販售時會依第三段將商品分類改成食料品／ファーストフード。
      fields[0]=effect.endsWith("ファ")?"ファーストフード":"食料品";
      assert.equal(supportsLegacyItemUse(fields),true);
      const needsBody=Number(fields[27]||0),needsBrain=Number(fields[28]||0);
      if(needsBody>25||needsBrain>35){
        const stronger=Object.fromEntries(STAT_KEYS.map(k=>[k,1000]));
        db.prepare("UPDATE characters SET stats_json=?,body_energy=400,brain_energy=400 WHERE user_id=1")
          .run(JSON.stringify(stronger));
      }
      addItem(db,1,fields);
      const first=use(db,1,"third-token-food-001");
      assert.equal(first.replayed,false);
      assert.equal(first.changes.food,true);
      assert.equal(first.changes.weight,weightEffect+Number(fields[25]||0)/1000);
      assert.equal(read(db).last_meal_at,NOW);
      if(Number(fields[21])>1){
        assert.throws(()=>use(db,1,"third-token-food-002",NOW+2000),/間隔|60 分鐘/);
        if(Number(fields[23])<60)
          assert.throws(()=>use(db,1,"third-token-food-003",
            NOW+(Number(fields[23])+1)*60000),/60 分鐘/);
      }
    }finally{db.close();}
  }
});
test("一般書籍「日」耐久以購入後已過整天數計算；期限內可冷卻後重用、不扣天數",()=>{
  const db=createDb();
  try{
    const DAY=86400000;
    const book=originalItem("書籍","こちら葛飾区亀有公園前派出所　全巻");
    assert.equal(book[22],"日");
    assert.equal(book[21],"30");
    assert.equal(supportsLegacyItemUse(book),true,
      "商品還沒買入時，商品目錄時間 0 應可預覽已支援");
    const boughtAt=Math.floor((NOW-2*DAY)/1000);
    book[30]=String(boughtAt);
    addItem(db,1,book);
    let available=listLegacyItemActions(db,1,{bodyEnergy:25,brainEnergy:35,lastMealAt:0},NOW);
    assert.equal(available.length,1);
    assert.equal(available[0].durabilityUnit,"日");
    assert.equal(available[0].remaining,28);
    const first=use(db,1,"day-book-01");
    assert.equal(first.replayed,false);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,28);
    assert.equal(listLegacyItemUseHistory(db,1).length,1);
    assert.deepEqual(JSON.parse(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items").get().raw_fields_json),book);
    assert.throws(()=>use(db,1,"day-book-cooldown",NOW+60_000),/使用間隔/);
    const second=use(db,1,"day-book-02",NOW+31*60_000);
    assert.equal(second.replayed,false);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,28);
    assert.equal(listLegacyItemUseHistory(db,1).length,2);
    const deadline=NOW+28*DAY;
    available=listLegacyItemActions(db,1,{bodyEnergy:25,brainEnergy:35,lastMealAt:0},deadline);
    assert.equal(available[0].remaining,0);
    assert.match(available[0].reason,/過期/);
    assert.throws(()=>use(db,1,"day-book-expired",deadline),/過期/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_item_use_history").get().n,2);
  }finally{db.close();}
});
test("原版特殊權益的日制商品與變造日期仍不能被當成一般書籍使用",()=>{
  const db=createDb();
  try{
    for(const [i,category,name] of [
      [1,"日用品","健康保険"],[2,"日用品","クレジットカード"],
      [3,"日用品","防犯カメラ"],[4,"ペット","ガチャピン"],
      [5,"ギフト","船艦大和"]
    ]){
      const f=originalItem(category,name);
      f[30]=String(Math.floor(NOW/1000));
      addItem(db,i,f);
      assert.equal(supportsLegacyItemUse(f),false);
      assert.throws(()=>use(db,i,"restricted-day-"+i),/尚未支援/);
    }
    const noDate=originalItem("書籍","こちら葛飾区亀有公園前派出所　全巻");
    addItem(db,6,noDate);
    assert.throws(()=>use(db,6,"invalid-day-time"),/尚未支援/);
    const forged=originalItem("書籍","こちら葛飾区亀有公園前派出所　全巻");
    forged[30]=String(Math.floor(NOW/1000));
    addItem(db,7,forged);
    db.prepare("UPDATE legacy_inventory_items SET purchased_at=? WHERE source_line=7")
      .run(Number(forged[30])+86400);
    assert.throws(()=>use(db,7,"mismatched-day-time"),/尚未支援/);
  }finally{db.close();}
});


test("原版「薬／ランダム品」每次獨立抽 17 項 0～10，歷史記錄實際抽值且不改原始 33 欄",()=>{
  const fields=originalItem("薬","ランダム品");
  const indices=[2,3,4,5,6,7,8,10,11,12,13,14,15,16,18,19,20];
  assert.equal(fields[9],"無");
  assert.ok(indices.every(i=>fields[i]==="10"));
  assert.equal(supportsLegacyItemUse(fields),true);
  const db=createDb();
  try{
    addItem(db,1,fields);
    const upper=useLegacyItem(db,1,1,"random_upper_0001",NOW,limit=>limit-1);
    assert.equal(upper.replayed,false);
    for(const key of STAT_KEYS){
      assert.equal(upper.changes.stats[key],10,"原版隨機上限："+key);
      assert.equal(read(db).stats[key],30);
    }
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,9);
    assert.equal(useLegacyItem(db,1,1,"random_upper_0001",NOW+1,()=>0).replayed,true);
    assert.throws(()=>useLegacyItem(db,1,1,"random_cooldown",NOW+179999,()=>0),/間隔/);
    const lower=useLegacyItem(db,1,1,"random_lower_0002",NOW+180000,()=>0);
    assert.deepEqual(lower.changes.stats,{});
    for(const key of STAT_KEYS)assert.equal(read(db).stats[key],30);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,8);
    const before=db.prepare("SELECT COUNT(*) AS n FROM legacy_item_use_history").get().n;
    assert.throws(()=>useLegacyItem(db,1,1,"random_invalid_003",NOW+360000,()=>11),/隨機道具/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_item_use_history").get().n,before);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,8);
    const middle=useLegacyItem(db,1,1,"random_middle_003",NOW+360000,limit=>Math.floor(limit/2));
    for(const key of STAT_KEYS){
      assert.equal(middle.changes.stats[key],5);
      assert.equal(read(db).stats[key],35);
    }
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage").get().remaining,7);
    assert.equal(listLegacyItemUseHistory(db,1).length,3);
    assert.deepEqual(JSON.parse(db.prepare("SELECT raw_fields_json FROM legacy_inventory_items").get().raw_fields_json),fields);
  }finally{db.close();}
});

test("偽造ランダム品的分類、能力上限、單價或間隔一律不能取得亂數效果",()=>{
  const source=originalItem("薬","ランダム品");
  const versions=[
    f=>{f[0]="書籍";},
    f=>{f[2]="100000";},
    f=>{f[10]="-10";},
    f=>{f[17]="1";},
    f=>{f[23]="0";},
    f=>{f[29]="偽造品";},
    f=>{f[9]="効果";},
    f=>{f[27]="-500";}
  ];
  const db=createDb();
  try{
    for(const [i,modify] of versions.entries()){
      const f=[...source];modify(f);
      addItem(db,i+1,f);
      assert.equal(supportsLegacyItemUse(f),false,"偽造變體 "+i);
      assert.throws(()=>useLegacyItem(db,1,i+1,"random_forged_"+i,NOW,()=>10),/尚未支援/);
    }
    assert.equal(listLegacyItemActions(db,1,{bodyEnergy:25,brainEnergy:35,lastMealAt:0},NOW).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_item_use_history").get().n,0);
  }finally{db.close();}
});
