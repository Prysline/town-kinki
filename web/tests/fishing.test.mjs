import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {initFishingTables,parseOriginalFishing,ensureFishingStock,
  buyFishingBait,castFishing,sellFishingCatch,fishingOverview,
  FISHING_ITEM_ORIGIN,FISHING_STACK_LIMIT} from "../src/fishing.mjs";

const source=parseOriginalFishing(
  decodeLegacyText(readFileSync(new URL("../../dat_dir/syouhin.cgi",import.meta.url))),
  decodeLegacyText(readFileSync(new URL("../../sea.cgi",import.meta.url))),
  decodeLegacyText(readFileSync(new URL("../../hanbai1.cgi",import.meta.url)))
);
const now=Date.parse("2026-11-21T10:00:00Z");
const day="2026-11-21";
function setup({tiles=["販売1","釣り"],money=100000}={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "town_id INTEGER NOT NULL,money INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,town_id,money) VALUES(1,0,"+money+"),(2,0,100000);"
  ].join(" "));
  initTownMapTable(db);
  const map=Array(192).fill("");
  for(let i=0;i<tiles.length;i++)map[i]=tiles[i];
  storeTownMap(db,0,{tiles:map},"web-edited");
  initFishingTables(db);
  ensureFishingStock(db,source.bait,day);
  return db;
}
function buy(db,sku=source.bait[0].sku,id="phase53_bait_0001",time=now){
  return buyFishingBait(db,1,source,{sku,requestId:id,now:time,day});
}
function cast(db,line,id="phase53_cast_0001",time=now,randomIndex=(n)=>0){
  return castFishing(db,1,source,{sourceLine:line,requestId:id,now:time,randomIndex});
}
function sell(db,line,id="phase53_sell_0001",time=now,randomIndex=(n)=>0){
  return sellFishingCatch(db,1,{sourceLine:line,requestId:id,now:time,randomIndex});
}
function held(db){
  return db.prepare("SELECT * FROM legacy_inventory_items WHERE user_id=1 ORDER BY source_line").all();
}
function balance(db){return db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;}

test("原始 sea.cgi 的 100秒冷卻、四組三種實際魚獲、四款真正餌料與所有售價以原始碼核對",()=>{
  assert.equal(source.intervalSeconds,100);
  assert.equal(source.bait.length,4);
  assert.deepEqual(source.bait.map(x=>x.name).sort(),[
    "小エビ","魚ルアー（小）","魚ルアー（中）","魚ルアー（大）"
  ].sort());
  assert.deepEqual(source.bait.map(x=>[x.price,x.durability,x.stock]).sort(
    (a,b)=>a[0]-b[0]
  ),[[100,1,50],[500,5,25],[1000,5,25],[5000,5,25]]);
  assert.equal(source.catches.length,4);
  assert.deepEqual(source.catches.map(g=>g.map(x=>x[1])),[
    ["小魚","ミニたこ","ホタルイカ"],
    ["中くらいの魚","クラゲ","スルメイカ"],
    ["でかい魚","ウツボ","ミズダコ"],
    ["サメ","海がめ","マグロ"]
  ]);
  assert.equal(source.catches.every(g=>g.every(x=>x.length===33)),true);
  const text=decodeLegacyText(readFileSync(new URL("../../sea.cgi",import.meta.url)));
  assert.match(text,/\$my_rand = int\(rand\(3\)\)/);
  assert.match(text,/\$turi_kankaku=100;/);
  assert.match(text,/&motimono_kensa_ev2\("\$in\{'gift_souhu'\}"\)/);
  assert.match(text,/&motimono_kensa_ev2\("\$in\{'seri_item'\}"\)/);
});

test("實際交易：買餌扣原價、釣魚扣餌並真正入庫、出售扣魚取得原版隨機價格",()=>{
  const db=setup();
  try{
    const item=source.bait.find(x=>x.name==="小エビ");
    const result=buy(db,item.sku);
    assert.equal(result.replayed,false);
    assert.equal(result.price,100);
    assert.equal(balance(db),99900);
    const bait=held(db).find(x=>x.original_name==="小エビ");
    assert.equal(bait.original_id,FISHING_ITEM_ORIGIN);
    assert.equal(bait.durability,1);
    assert.equal(JSON.parse(bait.raw_fields_json).length,33);
    assert.equal(JSON.parse(bait.raw_fields_json)[30],String(now/1000));
    const history=fishingOverview(db,1,source,now,day);
    assert.equal(history.baitGoods.length,4);
    assert.equal(history.baitOptions.length,1);
    assert.equal(history.baitGoods.find(x=>x.sku===item.sku).stock,item.stock-1);
    let rolls=[];
    const win=cast(db,bait.source_line,"phase53_cast_won",now,n=>{
      rolls.push(n);return 0;
    });
    assert.deepEqual(rolls,[3,7]);
    assert.equal(win.caught,true);
    assert.equal(win.catchName,"小魚");
    assert.equal(win.readyAt,now+100000);
    assert.equal(held(db).length,2);
    const fish=held(db).find(x=>x.original_name==="小魚");
    assert.equal(fish.original_id,FISHING_ITEM_ORIGIN);
    assert.equal(JSON.parse(fish.raw_fields_json)[0],"魚");
    assert.equal(JSON.parse(fish.raw_fields_json)[21],"1");
    assert.equal(fishingOverview(db,1,source,now,day).baitOptions.some(x=>x.name==="小魚"),true);
    assert.equal(fishingOverview(db,1,source,now,day).sellOptions.length,1);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=?")
      .get(bait.source_line).remaining,0);
    const price=sell(db,fish.source_line,"phase53_fish_sell",now,()=>0);
    assert.equal(price.paid,51);
    assert.equal(balance(db),99951);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=?")
      .get(fish.source_line).remaining,0);
    assert.equal(fishingOverview(db,1,source,now,day).sellOptions.length,0);
    const historyAfter=fishingOverview(db,1,source,now,day).history;
    assert.deepEqual(historyAfter.map(x=>x.action).slice(0,3),["sell","cast","buy"]);
  }finally{db.close();}
});

test("中魚與不中魚都扣一回，同步寫入100秒釣魚冷卻；時間未到拒絕但不重扣",()=>{
  const db=setup();
  try{
    const item=source.bait.find(x=>x.name==="魚ルアー（小）");
    const bait=buy(db,item.sku).sourceLine;
    const lose=cast(db,bait,"phase53_cast_lost",now,n=>n===3?1:0);
    assert.equal(lose.caught,false);
    assert.equal(lose.catchName,null);
    assert.equal(fishingOverview(db,1,source,now,day).baitOptions[0].remaining,4);
    assert.throws(()=>cast(db,bait,"phase53_cast_early",now+99000),/冷卻/);
    assert.equal(fishingOverview(db,1,source,now,day).baitOptions[0].remaining,4);
    const win=cast(db,bait,"phase53_cast_later",now+100000,()=>0);
    assert.equal(win.caught,true);
    assert.equal(win.catchName,"小魚");
    assert.equal(fishingOverview(db,1,source,now+100000,day).baitOptions
      .find(x=>x.sourceLine===bait).remaining,3);
  }finally{db.close();}
});

test("原版魚可當餌再次釣魚、來源真正釣魚的幻の魚才可高價出售；不得冒充原版第四獎品",()=>{
  const db=setup();
  try{
    const bait=buy(db,source.bait.find(x=>x.name==="魚ルアー（大）").sku).sourceLine;
    const rare=cast(db,bait,"phase53_bigfish_01",now,()=>0);
    assert.equal(rare.catchName,"でかい魚");
    const useFish=cast(db,rare.catchSourceLine,"phase53_fishbait_02",now+100000,()=>0);
    assert.equal(useFish.catchName,"サメ");
    const rareFish=held(db).find(x=>x.original_name==="サメ");
    assert.equal(rareFish.category,"幻の魚");
    assert.equal(fishingOverview(db,1,source,now+100000,day).baitOptions
      .some(x=>x.name==="サメ"),false,"稀有魚不是原版可直接用的餌料");
    const sold=sell(db,rareFish.source_line,"phase53_big_sell",now+100001,n=>n-1);
    assert.equal(sold.paid,100000);
    assert.equal(balance(db),100000-5000+100000);
    assert.equal(held(db).some(x=>x.original_name==="ポン・デ・リング"),false);
    assert.equal(held(db).some(x=>x.original_name==="船艦大和の一部"),false);
  }finally{db.close();}
});

test("請求重送只回放記帳結果；同 ID 不可換魚、買餌或改動作；魚價不會被前端指定",()=>{
  const db=setup();
  try{
    const item=source.bait[0];
    const bought=buy(db,item.sku,"phase53_replay_buy");
    assert.equal(buy(db,item.sku,"phase53_replay_buy").replayed,true);
    assert.equal(balance(db),100000-item.price);
    assert.throws(()=>buy(db,source.bait[1].sku,"phase53_replay_buy"),/相同操作識別碼/);
    const caught=cast(db,bought.sourceLine,"phase53_replay_cast");
    assert.equal(cast(db,bought.sourceLine,"phase53_replay_cast",now+100000,()=>1).replayed,true);
    assert.equal(fishingOverview(db,1,source,now,day).history.length,2);
    assert.equal(held(db).filter(x=>x.category==="魚").length,1);
    assert.throws(()=>sell(db,bought.sourceLine,"phase53_replay_cast"),/相同操作識別碼/);
    assert.throws(()=>cast(db,99999,"phase53_bad_bait"),/不是原版可釣魚/);
    assert.throws(()=>buy(db,"fake","phase53_fake_shop"),/不是原版/);
  }finally{db.close();}
});

test("無真實釣魚或販售建築、別人持有的餌料、無現金、售空與假道具都拒絕，資產不改變",()=>{
  const db=setup({tiles:["販売1"],money:20});
  try{
    const item=source.bait[0];
    assert.throws(()=>buy(db,item.sku,"phase53_no_cash"),/現金不足/);
    assert.equal(balance(db),20);
    assert.throws(()=>cast(db,1,"phase53_no_pond"),/沒有釣魚場/);
    db.prepare("UPDATE characters SET money=100000 WHERE user_id=1").run();
    const bought=buy(db,item.sku);
    assert.equal(bought.replayed,false);
    const tiles=Array(192).fill("");tiles[0]="釣り";
    storeTownMap(db,0,{tiles},"web-edited");
    assert.throws(()=>buy(db,item.sku,"phase53_no_store"),/沒有販售魚餌/);
    assert.throws(()=>castFishing(db,2,source,{
      sourceLine:bought.sourceLine,requestId:"phase53_cross_user",now
    }),/不是原版可釣魚/);
    assert.equal(fishingOverview(db,2,source,now,day).baitOptions.length,0);
    assert.throws(()=>sell(db,bought.sourceLine),/不是本人從釣魚獲得/);
    assert.equal(held(db).filter(x=>x.category==="餌").length,1);
  }finally{db.close();}
});

test("原版五份同魚類持有上限與25格上限阻止多領，新增失敗須回滾餌與冷卻",()=>{
  const db=setup();
  try{
    assert.equal(FISHING_STACK_LIMIT,5);
    const bait=buy(db,source.bait.find(x=>x.name==="魚ルアー（小）").sku).sourceLine;
    const first=cast(db,bait,"phase53_stack_one",now,()=>0);
    assert.equal(first.catchName,"小魚");
    const fish=held(db).find(x=>x.original_name==="小魚");
    // Web 正式漁獲可同類堆疊，不能取得五份以上。
    for(let i=1;i<5;i++){
      cast(db,bait,"phase53_stack_"+i,now+i*100000,()=>0);
    }
    assert.equal(held(db).filter(x=>x.original_name==="小魚").length,1);
    assert.equal(held(db).find(x=>x.original_name==="小魚").durability,5);
    assert.throws(()=>cast(db,fish.source_line,"phase53_stack_six",now+600000,()=>0),/五份持有上限/);
    // 六次嘗試不會在第六次扣走原來的魚當餌。
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=?").get(fish.source_line).remaining,5);
  }finally{db.close();}
});

test("釣魚寫入漁獲與出售記帳失敗時整筆回滾，保留 Web 現金、魚餌與出釣紀錄",()=>{
  const db=setup();
  try{
    const bait=buy(db,source.bait[0].sku).sourceLine;
    db.exec([
      "CREATE TRIGGER stop_fish_prize BEFORE INSERT ON legacy_inventory_items",
      "WHEN NEW.category='魚' BEGIN SELECT RAISE(ABORT,'prize denied'); END;"
    ].join(" "));
    assert.throws(()=>cast(db,bait,"phase53_rollback_cast"),/prize denied/);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=?").get(bait),undefined);
    assert.equal(db.prepare("SELECT * FROM fishing_cooldown").all().length,0);
    assert.equal(fishingOverview(db,1,source,now,day).history.length,1);
    db.exec("DROP TRIGGER stop_fish_prize");
    const good=cast(db,bait,"phase53_rollback_cast",now,()=>0);
    assert.equal(good.caught,true);
    const money=balance(db);
    db.exec([
      "CREATE TRIGGER stop_fish_sale BEFORE INSERT ON fishing_transactions",
      "WHEN NEW.action='sell' BEGIN SELECT RAISE(ABORT,'sale denied'); END;"
    ].join(" "));
    assert.throws(()=>sell(db,good.catchSourceLine,"phase53_rollback_sale"),/sale denied/);
    assert.equal(balance(db),money);
    assert.equal(db.prepare("SELECT remaining FROM legacy_item_usage WHERE source_line=?")
      .get(good.catchSourceLine),undefined);
    db.exec("DROP TRIGGER stop_fish_sale");
    assert.equal(sell(db,good.catchSourceLine,"phase53_rollback_sale").paid,51);
    assert.equal(balance(db),money+51);
  }finally{db.close();}
});

test("餌料庫存跨日更新回原版商品份數，原版舊玩家資料根本不是釣魚必要輸入",()=>{
  const db=setup();
  try{
    const item=source.bait[0];
    buy(db,item.sku);
    assert.equal(fishingOverview(db,1,source,now,day).baitGoods[0].stock,item.stock-1);
    assert.equal(ensureFishingStock(db,source.bait,day),false);
    assert.equal(ensureFishingStock(db,source.bait,"2026-11-22"),true);
    assert.equal(fishingOverview(db,1,source,now+86400000,"2026-11-22").baitGoods[0].stock,item.stock);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();}
});
