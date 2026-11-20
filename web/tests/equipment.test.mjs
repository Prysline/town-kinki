import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {decodeLegacyText} from "../src/engine.mjs";
import {
  parseLegacyEquipmentCatalog,initEquipmentTables,listEquipmentItems,
  listEquipmentTransactions,buyEquipment,equipEquipment,sellEquipment,forgeEquipment,FORGE_INCREMENTS
} from "../src/equipment.mjs";

const catalog=parseLegacyEquipmentCatalog(decodeLegacyText(readFileSync(
  new URL("../../dat_dir/soubi.cgi",import.meta.url))));
const source=decodeLegacyText(readFileSync(new URL("../../hanbai.cgi",import.meta.url)));
const now=Date.parse("2026-11-20T10:10:00Z");
const opts=(requestId,more={})=>({requestId,now,hasBuilding:()=>true,...more});
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY);",
    "CREATE TABLE characters(user_id INTEGER PRIMARY KEY REFERENCES users(id),",
    "money INTEGER NOT NULL,town_id INTEGER NOT NULL);",
    "INSERT INTO users(id) VALUES(1),(2);",
    "INSERT INTO characters(user_id,money,town_id) VALUES(1,1000000,0),(2,1000000,0);"
  ].join("\n"));
  initEquipmentTables(db);
  return db;
}
test("原版裝備店 6 欄商品與 7 欄倉庫、四種類及原價完全由來源讀取",()=>{
  assert.match(source,/\$syohin_file\s*=\s*'\.\/dat_dir\/soubi\.cgi'/);
  assert.match(source,/sub buy\s*\{/);
  assert.match(source,/sub soubi_do\s*\{/);
  assert.match(source,/sub soubi_uru\s*\{/);
  assert.equal(catalog.length,27);
  assert.deepEqual([...new Set(catalog.map(x=>x.category))],
    ["武器","防具","魔法","御守"]);
  assert.equal(catalog[0].name,"HBの鉛筆");
  assert.equal(catalog[0].price,50);
  assert.equal(catalog.find(x=>x.name==="輪ゴム鉄砲").accuracy,75);
  assert.ok(catalog.some(x=>x.price===10000000000));
  assert.throws(()=>parseLegacyEquipmentCatalog("種類<>名前<>威力<>命中率<>値段<>使用可能回数<>\n"+
      "武器<>破損<>1<>110<>50<>5<>"),/範圍/);
});
test("原版裝備購買只付一次現金，存入本人獨立倉庫；同名不得重複",()=>{
  const db=fixture();try{
    const pencil=catalog[0];
    const before=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.throws(()=>buyEquipment(db,1,catalog,{
      sku:pencil.sku,...opts("equip_no_shop",{hasBuilding:()=>false})
    }),/沒有裝備屋/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM equipment_transactions").get().n,0);
    const first=buyEquipment(db,1,catalog,{sku:pencil.sku,...opts("equip_buy_first")});
    assert.equal(first.amount,-50);
    assert.equal(first.replayed,false);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before-50);
    assert.deepEqual(listEquipmentItems(db,1).map(x=>[x.name,x.status,x.level,x.experience]),
      [["HBの鉛筆","stored",1,0]]);
    assert.deepEqual(listEquipmentItems(db,2),[]);
    const replay=buyEquipment(db,1,catalog,{sku:pencil.sku,...opts("equip_buy_first")});
    assert.equal(replay.replayed,true);
    assert.equal(replay.itemId,first.itemId);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,before-50);
    assert.throws(()=>buyEquipment(db,1,catalog,{
      sku:pencil.sku,...opts("equip_buy_duplicate")
    }),/同名/);
    assert.throws(()=>buyEquipment(db,1,catalog,{
      sku:catalog[1].sku,...opts("equip_buy_first")
    }),/請求編號/);
    assert.equal(listEquipmentTransactions(db,1).length,1);
  }finally{db.close();}
});
test("原始裝備店剛好等於售價的現金不能購買，負餘額與天價不能扣款",()=>{
  const db=fixture();try{
    db.prepare("UPDATE characters SET money=50 WHERE user_id=1").run();
    assert.throws(()=>buyEquipment(db,1,catalog,{
      sku:catalog[0].sku,...opts("equip_exact_money")
    }),/大於/);
    db.prepare("UPDATE characters SET money=51 WHERE user_id=1").run();
    buyEquipment(db,1,catalog,{sku:catalog[0].sku,...opts("equip_more_money")});
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,1);
    assert.throws(()=>buyEquipment(db,1,catalog,{
      sku:catalog.find(x=>x.price===10000000000).sku,...opts("equip_very_expensive")
    }),/大於/);
    assert.equal(listEquipmentItems(db,1).length,1);
  }finally{db.close();}
});
test("倉庫換裝時同類前裝備回倉庫，其他類別獨立；本人權限與操作防重",()=>{
  const db=fixture();try{
    const a=buyEquipment(db,1,catalog,{sku:catalog[0].sku,...opts("equip_buy_first_weapon")});
    const b=buyEquipment(db,1,catalog,{sku:catalog[1].sku,...opts("equip_buy_second_weapon")});
    const armor=catalog.find(x=>x.category==="防具"&&x.price<10000);
    const c=buyEquipment(db,1,catalog,{sku:armor.sku,...opts("equip_buy_first_armor")});
    const f=equipEquipment(db,1,{itemId:a.itemId,...opts("equip_wear_first")});
    assert.equal(f.replayed,false);
    assert.equal(listEquipmentItems(db,1).find(x=>x.id===a.itemId).status,"equipped");
    assert.throws(()=>equipEquipment(db,2,{itemId:a.itemId,...opts("equip_other_user")}),/本人/);
    equipEquipment(db,1,{itemId:c.itemId,...opts("equip_wear_armor")});
    equipEquipment(db,1,{itemId:b.itemId,...opts("equip_wear_second")});
    const owned=listEquipmentItems(db,1);
    assert.equal(owned.find(x=>x.id===a.itemId).status,"stored");
    assert.equal(owned.find(x=>x.id===b.itemId).status,"equipped");
    assert.equal(owned.find(x=>x.id===c.itemId).status,"equipped");
    assert.equal(equipEquipment(db,1,{itemId:b.itemId,...opts("equip_wear_second")}).replayed,true);
    assert.throws(()=>equipEquipment(db,1,{itemId:b.itemId,...opts("equip_wear_again")}),/倉庫內/);
    assert.throws(()=>sellEquipment(db,1,catalog,{itemId:b.itemId,...opts("equip_sell_worn")}),/只能出售/);
  }finally{db.close();}
});
test("原版倉庫物品可出售回收原價十分之一乘等級；裝備不可直接賣，售後可重買",()=>{
  const db=fixture();try{
    const pencil=catalog[0];
    const b=buyEquipment(db,1,catalog,{sku:pencil.sku,...opts("equip_buy_sale")});
    const sold=sellEquipment(db,1,catalog,{itemId:b.itemId,...opts("equip_sell_one")});
    assert.equal(sold.amount,5);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,999955);
    assert.equal(listEquipmentItems(db,1).length,0);
    assert.equal(sellEquipment(db,1,catalog,{itemId:b.itemId,...opts("equip_sell_one")}).replayed,true);
    assert.throws(()=>sellEquipment(db,1,catalog,{itemId:b.itemId,...opts("equip_sell_again")}),/倉庫內/);
    const second=buyEquipment(db,1,catalog,{sku:pencil.sku,...opts("equip_buy_again")});
    assert.notEqual(second.itemId,b.itemId);
    assert.equal(listEquipmentItems(db,1).length,1);
    const hanger=catalog.find(x=>x.price===105);
    const purchase=buyEquipment(db,1,catalog,{sku:hanger.sku,...opts("equip_hanger_buy")});
    const rounded=sellEquipment(db,1,catalog,{itemId:purchase.itemId,...opts("equip_hanger_sell")});
    assert.equal(rounded.amount,10); // Web 整數金額，Perl 原計價為 10.5。
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM equipment_transactions WHERE user_id=1").get().n,5);
  }finally{db.close();}
});
test("裝備購買／換裝／出售沒有地圖建築均拒絕，原裝備不動且交易回滾",()=>{
  const db=fixture();try{
    const purchased=buyEquipment(db,1,catalog,{sku:catalog[0].sku,...opts("equip_buy_valid")});
    const money=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    assert.throws(()=>equipEquipment(db,1,{
      itemId:purchased.itemId,...opts("equip_use_no_map",{hasBuilding:()=>false})
    }),/沒有裝備屋/);
    assert.throws(()=>sellEquipment(db,1,catalog,{
      itemId:purchased.itemId,...opts("equip_sale_no_map",{hasBuilding:()=>false})
    }),/沒有裝備屋/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,money);
    assert.equal(listEquipmentItems(db,1)[0].status,"stored");
    assert.equal(listEquipmentTransactions(db,1).length,1);
  }finally{db.close();}
});


test("原版鍛造僅允許固定增量，費用為每威力一萬與每次耐久一千，倉庫可強化",()=>{
  assert.match(source,/sub kajiya_do\s*\{/);
  assert.match(source,/\$hiyou=\$in\{'iryoku_up'\}\*10000 \+ \$in\{'taikyuu_up'\}\*1000/);
  assert.deepEqual(FORGE_INCREMENTS,[0,1,3,5,10,15,25,50]);
  const db=fixture();try{
    const item=buyEquipment(db,1,catalog,{
      sku:catalog[0].sku,...opts("equipment_forge_buy")
    });
    const original=listEquipmentItems(db,1)[0];
    const cash=db.prepare("SELECT money FROM characters WHERE user_id=1").get().money;
    const forged=forgeEquipment(db,1,{
      itemId:item.itemId,powerUp:3,usesUp:5,...opts("equipment_forge_3_5")
    });
    assert.equal(forged.amount,-35000);
    assert.equal(forged.replayed,false);
    const updated=listEquipmentItems(db,1)[0];
    assert.equal(updated.power,original.power+3);
    assert.equal(updated.uses,original.uses+5);
    assert.equal(updated.level,1);
    assert.equal(updated.experience,0);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,cash-35000);
    assert.equal(forgeEquipment(db,1,{
      itemId:item.itemId,powerUp:3,usesUp:5,...opts("equipment_forge_3_5")
    }).replayed,true);
    assert.throws(()=>forgeEquipment(db,1,{
      itemId:item.itemId,powerUp:5,usesUp:3,...opts("equipment_forge_3_5")
    }),/請求編號/);
    assert.equal(listEquipmentItems(db,1)[0].power,updated.power);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,cash-35000);
    assert.equal(listEquipmentTransactions(db,1).length,2);
  }finally{db.close();}
});
test("已穿戴裝備仍可鍛造，換裝後威力／耐久保留且不能跨帳號鍛造",()=>{
  const db=fixture();try{
    const a=buyEquipment(db,1,catalog,{
      sku:catalog[0].sku,...opts("equipment_forge_worn_buy")
    });
    equipEquipment(db,1,{itemId:a.itemId,...opts("equipment_forge_worn_equip")});
    const worn=forgeEquipment(db,1,{
      itemId:a.itemId,powerUp:1,usesUp:3,...opts("equipment_forge_worn")
    });
    assert.equal(worn.amount,-13000);
    assert.equal(listEquipmentItems(db,1)[0].status,"equipped");
    assert.equal(listEquipmentItems(db,1)[0].power,2);
    assert.equal(listEquipmentItems(db,1)[0].uses,8);
    assert.throws(()=>forgeEquipment(db,2,{
      itemId:a.itemId,powerUp:1,usesUp:0,...opts("equipment_forge_other_player")
    }),/本人/);
    const b=buyEquipment(db,1,catalog,{
      sku:catalog[1].sku,...opts("equipment_forge_worn_second")
    });
    equipEquipment(db,1,{itemId:b.itemId,...opts("equipment_forge_worn_switch")});
    assert.equal(listEquipmentItems(db,1).find(x=>x.id===a.itemId).status,"stored");
    assert.equal(listEquipmentItems(db,1).find(x=>x.id===a.itemId).power,2);
    assert.equal(listEquipmentItems(db,1).find(x=>x.id===a.itemId).uses,8);
  }finally{db.close();}
});
test("原版鍛造現金剛好等於費用時可成功，但非法增量、缺錢或缺建築整筆拒絕",()=>{
  const db=fixture();try{
    const purchased=buyEquipment(db,1,catalog,{
      sku:catalog[0].sku,...opts("equipment_forge_exact_buy")
    });
    db.prepare("UPDATE characters SET money=1000 WHERE user_id=1").run();
    const id=purchased.itemId;
    const before=listEquipmentItems(db,1)[0];
    for(const [up,n] of [[2,0],[-1,0],[1.5,0],[0,0],[51,0]]){
      assert.throws(()=>forgeEquipment(db,1,{
        itemId:id,powerUp:up,usesUp:n,...opts("equipment_forge_wrong_"+String(up).replace(".","_"))
      }),/增量/);
    }
    assert.throws(()=>forgeEquipment(db,1,{
      itemId:id,powerUp:1,usesUp:0,...opts("equipment_forge_no_building",{hasBuilding:()=>false})
    }),/沒有裝備屋/);
    assert.throws(()=>forgeEquipment(db,1,{
      itemId:id,powerUp:1,usesUp:0,...opts("equipment_forge_insufficient")
    }),/現金不足/);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,1000);
    assert.equal(listEquipmentItems(db,1)[0].uses,before.uses);
    const exact=forgeEquipment(db,1,{
      itemId:id,powerUp:0,usesUp:1,...opts("equipment_forge_exact_1000")
    });
    assert.equal(exact.amount,-1000);
    assert.equal(db.prepare("SELECT money FROM characters WHERE user_id=1").get().money,0);
    assert.equal(listEquipmentItems(db,1)[0].uses,before.uses+1);
    assert.throws(()=>forgeEquipment(db,1,{
      itemId:id,powerUp:0,usesUp:1,...opts("equipment_forge_after_zero")
    }),/現金不足/);
    assert.equal(listEquipmentTransactions(db,1).length,2);
  }finally{db.close();}
});
