// Stage G: reproducible synthetic economy experiment using existing transaction cores.
// No player files, server RNG injection, game-rule overrides or real-time sleeps.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {STAT_KEYS,decodeLegacyText,maxBodyEnergy,maxBrainEnergy,recoverEnergy} from "../src/engine.mjs";
import {initBankTables,settleBankInterest,refreshBankTaxSnapshot} from "../src/banking.mjs";
import {initCharacterEvents,getCouponBalance} from "../src/events.mjs";
import {initTownMapTable,storeTownMap} from "../src/town-storage.mjs";
import {parseArenaCatalog} from "../src/b-league-core.mjs";
import {initArenaTables,parseArenaDrops,playArena} from "../src/b-league.mjs";
import {parseOsakaRules} from "../src/osaka-challenge-core.mjs";
import {RECONSTRUCTED_OSAKA_NPCS} from "../src/osaka-npc-reconstruction.mjs";
import {initOsakaTables,playOsaka} from "../src/osaka-challenge.mjs";
import {initStreetFightTables,playStreetFight,STREET_MAX_LOSS} from "../src/street-fight.mjs";
import {initCLeagueTables,trainCLeague,playCLeague,C_MATCH_LIMIT,C_INTERVAL_MS} from "../src/c-league.mjs";
import {parseLegacyEquipmentCatalog,buyEquipment,equipEquipment,forgeEquipment,EQUIPMENT_SYMBOL} from "../src/equipment.mjs";
import {parseLegacyRetailCatalog,initRetailTables,ensureRetailDay,buyRetailItem} from "../src/retail.mjs";
import {listLegacyItemActions,useLegacyItem} from "../src/legacy-item-use.mjs";
import {settleDailyHealth,getTreatmentQuote,treatAtHospital} from "../src/health.mjs";

const read=p=>decodeLegacyText(readFileSync(new URL("../../"+p,import.meta.url)));
const arena=parseArenaCatalog(read("dat_dir/battle.cgi")),drops=parseArenaDrops(read("battle.cgi"));
const osaka=parseOsakaRules(read("obatyan.cgi")),npcs={available:true,npcs:RECONSTRUCTED_OSAKA_NPCS};
const gear=parseLegacyEquipmentCatalog(read("dat_dir/soubi.cgi"));
const retail=parseLegacyRetailCatalog(read("dat_dir/syouhin.cgi"));
const food=retail.find(x=>x.name==="どすこいちゃんこ");
assert.ok(food);
const modes=["B-d","B-c","B-b","B-a","B-s","Osaka-week","Osaka-strong","Street","C-solo","C-multi"];
const profiles=[{name:"start",stat:20,cash:100000,transfer:0},{name:"trained-synthetic",stat:100,cash:1500000,transfer:3}];
const dayMs=86400000, start=Date.parse("2026-11-25T09:00:00+08:00");
const dayAt=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const stats=n=>Object.fromEntries(STAT_KEYS.map(k=>[k,n]));
function random(seed){
  // xorshift32; rejection rather than modulo bias; independent streams per scenario.
  let state=seed>>>0||1;
  return n=>{
    assert.ok(Number.isSafeInteger(n)&&n>0&&n<=0x100000000);
    const limit=Math.floor(0x100000000/n)*n;
    do{state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;}while(state>=limit);
    return state%n;
  };
}
const hasBuilding=(symbol,town)=>town===0&&["Ｂリーグ","デパ",EQUIPMENT_SYMBOL].includes(symbol);
function database(profile){
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3); CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE REFERENCES users(id),name TEXT,town_id INTEGER,money INTEGER,bank INTEGER,kpoint INTEGER,body_energy INTEGER,brain_energy INTEGER,recovered_at INTEGER,stats_json TEXT,health_index INTEGER,last_health_day TEXT,weight REAL,height INTEGER,bmi REAL,last_meal_at INTEGER,last_event_day TEXT);");
  initBankTables(db);initCharacterEvents(db);initTownMapTable(db);initArenaTables(db);initOsakaTables(db);initStreetFightTables(db);initCLeagueTables(db);initRetailTables(db);
  const tiles=Array(192).fill("");tiles[0]="Ｂリーグ";tiles[1]="おばちゃん";tiles[2]="おばちゃん強";tiles[3]="デパ";tiles[4]=EQUIPMENT_SYMBOL;
  storeTownMap(db,0,{tiles},"test");
  const insert=db.prepare("INSERT INTO characters VALUES(?,?,?,0,?,0,0,?,?,?, ?,50,'',60,165,22,0,'')");
  for(const id of [1,2,3]){
    const s=stats(id===1?Math.max(20,Math.floor(profile.stat/2)):profile.stat);
    insert.run(id,id,"模擬居民"+id,profile.cash,maxBodyEnergy(s),maxBrainEnergy(s),start,JSON.stringify(s));
  }
  return db;
}
const actor=2;
function row(db){return db.prepare("SELECT * FROM characters WHERE user_id=?").get(actor);}
function resident(db,now){
  const r=row(db);
  return recoverEnergy({money:r.money,stats:JSON.parse(r.stats_json),bodyEnergy:r.body_energy,brainEnergy:r.brain_energy,recoveredAt:r.recovered_at,healthIndex:r.health_index,lastHealthDay:r.last_health_day,lastMealAt:r.last_meal_at,height:r.height,weight:r.weight,bmi:r.bmi},now);
}
function run(profile,mode,schedule,seed){
  const db=database(profile),rng=random(seed),stockRng=random(seed^0x5f3759df);
  const result={profile:profile.name,mode,schedule,seed,attempts:0,win:0,loss:0,draw:0,noOpponent:0,skippedCash:0,skippedCap:0,gross:0,gearCost:0,foodCost:0,medicalCost:0,trainingCost:0,gearUses:0,foodUsed:0,foodNotStocked:0,prizeGranted:0,prizeBlocked:0,days:[]};
  let serial=0;const id=prefix=>prefix+"-"+String(++serial).padStart(8,"0");
  try{
    const cMode=mode.startsWith("C-");
    if(cMode){
      const transfers=stats(profile.transfer);
      if(mode==="C-multi"){
        trainCLeague(db,1,{requestId:id("rival-train"),name:"模擬對手",transfers},start,dayAt(start));
        playCLeague(db,1,{requestId:id("rival-play")},start,dayAt(start),rng);
      }
      result.trainingCost=trainCLeague(db,actor,{requestId:id("train"),name:"模擬培育",transfers},start,dayAt(start)).cost;
    }
    if(mode.startsWith("B-")){
      // Real catalog, conservative initial budget; not a claim about player preferences.
      for(const type of ["武器","防具","魔法","御守"]){
        const selected=gear.filter(g=>g.category===type&&g.uses>0&&g.price<=profile.cash/16).sort((a,b)=>a.price-b.price||a.sourceLine-b.sourceLine)[0];
        if(!selected||row(db).money<=selected.price)continue;
        const bought=buyEquipment(db,actor,gear,{sku:selected.sku,requestId:id("gear-buy"),now:start,hasBuilding});
        result.gearCost-=bought.amount;
        equipEquipment(db,actor,{itemId:bought.itemId,requestId:id("gear-equip"),now:start,hasBuilding});
      }
    }
    for(let day=0;day<14;day++){
      const morning=start+day*dayMs,today=dayAt(morning);
      settleBankInterest(db,actor,today,morning);
      const ch=resident(db,morning);
      const health=settleDailyHealth(ch,today,maxBodyEnergy(ch.stats),maxBrainEnergy(ch.stats),morning).character;
      db.prepare("UPDATE characters SET health_index=?,last_health_day=?,body_energy=?,brain_energy=?,recovered_at=? WHERE user_id=?").run(health.healthIndex,health.lastHealthDay,health.bodyEnergy,health.brainEnergy,health.recoveredAt,actor);
      const quote=getTreatmentQuote(health);
      if(quote.disease.key!=="healthy"&&health.money>=quote.price){
        const treatment=treatAtHospital(health,morning);
        db.prepare("UPDATE characters SET money=?,health_index=? WHERE user_id=?").run(treatment.character.money,treatment.character.healthIndex,actor);
        result.medicalCost+=treatment.paid;
      }
      if(mode.startsWith("B-")){
        for(const item of db.prepare("SELECT id,uses,status FROM equipment_items WHERE user_id=? AND status!='sold' ORDER BY id").all(actor)){
          if(item.uses!==0||row(db).money<10000)continue;
          result.gearCost-=forgeEquipment(db,actor,{itemId:item.id,usesUp:10,requestId:id("gear-repair"),now:morning,hasBuilding}).amount;
          equipEquipment(db,actor,{itemId:item.id,requestId:id("gear-equip"),now:morning,hasBuilding});
        }
      }
      // A reproducible shop rotation; buy food only if genuinely stocked, then use an available item.
      ensureRetailDay(db,retail,today,stockRng);
      let owned=listLegacyItemActions(db,actor,resident(db,morning),morning).find(x=>x.name===food.name&&x.remaining>0);
      if(!owned){
        const shelf=db.prepare("SELECT remaining FROM retail_stock WHERE shop='depart1' AND sku=?").get(food.sku);
        if(shelf?.remaining>0&&row(db).money>=food.unitPrice){
          const bought=buyRetailItem(db,actor,retail,{shop:"depart1",sku:food.sku,requestId:id("food-buy"),now:morning,day:today,hasBuilding});
          result.foodCost+=bought.paid;
          owned=listLegacyItemActions(db,actor,resident(db,morning),morning).find(x=>x.sourceLine===bought.sourceLine);
        }else if(!shelf?.remaining)result.foodNotStocked++;
      }
      if(owned?.canUse){
        const used=useLegacyItem(db,actor,owned.sourceLine,id("food-use"),morning,rng);
        assert.equal(used.changes.food,true);result.foodUsed++;
      }
      refreshBankTaxSnapshot(db,actor,today);
      const attempts=cMode?(schedule==="spaced"?7:100):(schedule==="spaced"?4:24);
      const interval=schedule==="spaced"?3600000:(cMode?C_INTERVAL_MS:5000);
      for(let i=0;i<attempts;i++){
        if(cMode&&result.attempts>=C_MATCH_LIMIT){result.skippedCap+=attempts-i;break;}
        if(mode==="Street"&&row(db).money<STREET_MAX_LOSS){result.skippedCash++;continue;}
        const now=morning+60000+i*interval,requestId=id("fight");
        const before=row(db),usesBefore=db.prepare("SELECT COALESCE(SUM(uses),0) n FROM equipment_items WHERE user_id=?").get(actor).n;
        let battle;
        if(mode.startsWith("B-"))battle=playArena(db,actor,arena,drops,{rank:mode.slice(2),requestId,now,today,hasBuilding,rng});
        else if(mode.startsWith("Osaka-"))battle=playOsaka(db,actor,osaka,npcs,{mode:mode.slice(6),requestId,now,today,rng});
        else if(mode==="Street")battle=playStreetFight(db,actor,{mode:"multi",requestId,now,today,randomIndex:rng});
        else battle=playCLeague(db,actor,{requestId},now,today,rng);
        const after=row(db);
        assert.equal(battle.replayed,false);
        const delta=cMode?battle.reward:(battle.moneyDelta??battle.delta??0);
        assert.equal(after.money-before.money,delta);
        assert.ok(Object.hasOwn(result,battle.outcome));
        result.attempts++;result[battle.outcome]++;result.gross+=delta;
        result.gearUses+=usesBefore-db.prepare("SELECT COALESCE(SUM(uses),0) n FROM equipment_items WHERE user_id=?").get(actor).n;
        if(!cMode&&battle.reward?.granted===true)result.prizeGranted++;
        if(!cMode&&battle.reward?.granted===false)result.prizeBlocked++;
      }
      const end=row(db);result.days.push({day:day+1,cash:end.money,body:end.body_energy,brain:end.brain_energy,kpoint:end.kpoint,coupons:getCouponBalance(db,actor)});
    }
    const final=row(db);result.finalCash=final.money;result.net=final.money-profile.cash;result.kpoint=final.kpoint;result.coupons=getCouponBalance(db,actor);
    result.taxUnpaid=db.prepare("SELECT COALESCE(SUM(unpaid),0) n FROM bank_tax_assessments WHERE user_id=?").get(actor).n;
    result.items=db.prepare("SELECT original_name name,COALESCE(u.remaining,i.durability) remaining FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line WHERE i.user_id=? ORDER BY i.source_line").all(actor);
    assert.equal(result.net,result.gross-result.gearCost-result.foodCost-result.medicalCost-result.trainingCost);
    assert.equal(result.attempts,result.win+result.loss+result.draw+result.noOpponent);
    assert.ok(result.finalCash>=0&&result.gearUses>=0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    return result;
  }finally{db.close();}
}

test("階段G 14日固定種子經濟基線：正式四戰鬥交易、真實商品成本、每日資產對帳",()=>{
  const rows=[];
  for(const profile of profiles)for(const mode of modes)for(const schedule of ["spaced","burst"])for(const seed of [17,20261125]){
    const r=run(profile,mode,schedule,seed);rows.push(r);
    if(mode==="C-solo"&&profile.transfer===0){
      assert.equal(r.attempts,schedule==="spaced"?98:100);
      assert.equal(r.gross,r.attempts*100);assert.equal(r.win,r.attempts);
    }
  }
  assert.equal(rows.length,80);
  assert.deepEqual(run(profiles[0],"B-d","spaced",17),rows[0]);
  // One compact machine-readable line per simulation; no private identifiers.
  for(const r of rows){
    const {days,items,...summary}=r;
    console.log("G_ECON "+JSON.stringify({...summary,dayCash:days.map(d=>d.cash),lastDay:days.at(-1),items}));
  }
});
