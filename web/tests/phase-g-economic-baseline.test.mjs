// Stage G: reproducible synthetic economy experiment using existing transaction cores.
// No player files, server RNG injection, game-rule overrides or real-time sleeps.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {STAT_KEYS,decodeLegacyText,maxBodyEnergy,maxBrainEnergy,recoverEnergy,createCharacterData,parseLegacyJobs,jobEligibility,performWork} from "../src/engine.mjs";
import {initBankTables,settleBankInterest,refreshBankTaxSnapshot,bankOperation} from "../src/banking.mjs";
import {initCharacterEvents,getCouponBalance,settleDailyIllnessEvent} from "../src/events.mjs";
import {getCockroachChallenge,claimCockroach} from "../src/event-cockroach.mjs";
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
import {settleDailyHealth,getTreatmentQuote,treatAtHospital,conditionWithIllness} from "../src/health.mjs";
import {parseLegacySchool,parseLegacyGym,parseLegacyClassroom,trainingAvailability,performTraining} from "../src/training.mjs";
import {parseLegacyMeals,deriveCondition,eatMeal,hungerStatus} from "../src/dining.mjs";
import {initDiningStockTables,ensureDiningRotation,listedDiningMeals,takeDiningStock} from "../src/dining-stock.mjs";
import {quoteTrainFare,travelByTrain} from "../src/transport.mjs";

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
function run(profile,mode,schedule,seed,gearPolicy="cheap"){
  const db=database(profile),rng=random(seed),stockRng=random(seed^0x5f3759df);
  const result={profile:profile.name,mode,schedule,seed,attempts:0,win:0,loss:0,draw:0,noOpponent:0,skippedCash:0,skippedCap:0,gross:0,gearCost:0,foodCost:0,medicalCost:0,trainingCost:0,gearUses:0,foodUsed:0,foodNotStocked:0,prizeGranted:0,prizeBlocked:0,days:[]};
  result.gearPolicy=gearPolicy;result.winRounds=0;result.winCash=0;result.lossCash=0;
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
        const selected=gear.filter(g=>g.category===type&&g.uses>0&&g.price<=profile.cash/16).sort((a,b)=>gearPolicy==="power"?b.power-a.power||b.accuracy-a.accuracy||a.price-b.price||a.sourceLine-b.sourceLine:a.price-b.price||a.sourceLine-b.sourceLine)[0];
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
      const matched=schedule==="spaced"||schedule==="matched-fast";
      const attempts=cMode?(matched?7:100):(matched?4:24);
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
        if(battle.outcome==="win"){result.winRounds+=battle.rounds.length;result.winCash+=delta;}
        if(battle.outcome==="loss")result.lossCash+=delta;
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

test("階段G等場次間隔及B裝備選擇對照：14日、四種子、真實核心",()=>{
  const rows=[];
  const seeds=[17,20261125,97,314159];
  for(const profile of profiles)for(const mode of ["B-d","Osaka-week","Osaka-strong","Street"])for(const seed of seeds){
    const spaced=run(profile,mode,"spaced",seed),fast=run(profile,mode,"matched-fast",seed);
    assert.equal(spaced.attempts+spaced.skippedCash,56);
    assert.equal(fast.attempts+fast.skippedCash,56);
    rows.push(spaced,fast);
  }
  for(const profile of profiles)for(const seed of seeds)rows.push(run(profile,"B-d","spaced",seed,"power"));
  assert.equal(rows.length,72);
  for(const r of rows){
    const {days,items,...summary}=r;
    console.log("G_MATCHED "+JSON.stringify({...summary,dayCash:days.map(d=>d.cash)}));
  }
});

// Separate progression experiment: initial character from production creation, actual
// work/training/meal/reward/event cores. Persistence adapter exists only in the test.
const jobs=parseLegacyJobs(read("dat_dir/job.cgi"));
const lessons=[...parseLegacySchool(read("dat_dir/school.cgi")),...parseLegacyGym(read("dat_dir/gym.cgi")),...parseLegacyClassroom(read("dat_dir/kyushitu.cgi"))];
const meals=[...parseLegacyMeals(read("dat_dir/syouhin.cgi"),"main"),...parseLegacyMeals(read("dat_dir/syokudou2.cgi"),"second")];
const fieldMap={townId:"town_id",money:"money",bank:"bank",bodyEnergy:"body_energy",brainEnergy:"brain_energy",recoveredAt:"recovered_at",healthIndex:"health_index",lastHealthDay:"last_health_day",lastEventDay:"last_event_day",lastMealAt:"last_meal_at",height:"height",weight:"weight",bmi:"bmi",jobId:"job_id",salaryPayment:"salary_payment",workProgress:"work_progress",lastWorkAt:"last_work_at",workCount:"work_count",jobWorkCount:"job_work_count",jobExperience:"job_experience",masteredJob:"mastered_job",lastSchoolDay:"last_school_day",lastGymAt:"last_gym_at",gymReadyAt:"gym_ready_at",classroomReadyAt:"classroom_ready_at"};
function grow(mode,pace,seed,{duration=14,skipB=false,savings=false}={}){
  const db=database(profiles[0]),rng=random(seed),eventRng=random(seed^0x12345678),menuRng=random(seed^0x5f3759df);
  const unit=()=>eventRng(16777216)/16777216;
  let serial=0;const request=prefix=>prefix+"-"+String(++serial).padStart(8,"0");
  const report={mode,pace,seed,duration,skipB,savings,interest:0,taxPaid:0,eventBank:0,deposits:0,withdrawals:0,wages:0,workCount:0,workBlocked:0,schoolCount:0,gymCount:0,classroomCount:0,lessonCost:0,mealCost:0,mealCount:0,mealMissed:0,medicalCost:0,travelCost:0,gearCost:0,trainingCost:0,rewardUses:0,eventCash:0,eventIds:[],cockroachClaims:0,gross:0,attempts:0,skipped:0,battles:{},days:[]};
  try{
    for(const [name,type] of [["job_id","TEXT"],["salary_payment","TEXT"],["work_progress","INTEGER"],["last_work_at","INTEGER"],["work_count","INTEGER"],["job_work_count","INTEGER"],["job_experience","INTEGER"],["mastered_job","TEXT"],["last_school_day","TEXT"],["last_gym_at","INTEGER"],["gym_ready_at","INTEGER"],["classroom_ready_at","INTEGER"]])db.exec("ALTER TABLE characters ADD COLUMN "+name+" "+type);
    initDiningStockTables(db);
    const load=()=>{const r=row(db);return {...Object.fromEntries(Object.entries(fieldMap).map(([k,v])=>[k,r[v]])),stats:JSON.parse(r.stats_json)};};
    const save=c=>{db.prepare("UPDATE characters SET "+Object.values(fieldMap).map(v=>v+"=?").join(",")+",stats_json=? WHERE user_id=?").run(...Object.keys(fieldMap).map(k=>c[k]??null),JSON.stringify(c.stats),actor);};
    const created=createCharacterData("模擬新居民","other",start,stats(20));
    save(created);
    const job=jobs.find(j=>j.key===created.jobId);assert.ok(job);
    // A minimal zero-transfer C character, then a budget-limited real transfer on day 8.
    trainCLeague(db,actor,{requestId:request("create-c"),name:"模擬培育"},start,dayAt(start));
    if(mode==="multi"){
      trainCLeague(db,1,{requestId:request("rival-c"),name:"模擬對手"},start,dayAt(start));
      playCLeague(db,1,{requestId:request("rival-play")},start,dayAt(start),rng);
    }
    if(!skipB)for(const type of ["武器","防具","魔法","御守"]){
      const selected=gear.filter(g=>g.category===type&&g.uses>0&&g.price<=created.money/16).sort((a,b)=>b.power-a.power||b.accuracy-a.accuracy||a.price-b.price||a.sourceLine-b.sourceLine)[0];
      if(!selected||row(db).money<=selected.price)continue;
      const bought=buyEquipment(db,actor,gear,{sku:selected.sku,requestId:request("buy-gear"),now:start,hasBuilding});
      report.gearCost-=bought.amount;
      equipEquipment(db,actor,{itemId:bought.itemId,requestId:request("equip-gear"),now:start,hasBuilding});
    }
    const battle=(key,now,today)=>{
      const before=row(db);
      // Conservative voluntary entry policy; no changes to server eligibility or reward.
      if(key!=="C"&&(before.town_id!==0||before.money<15000)){report.skipped++;return;}
      if(key!=="C"){
        const current=recoverEnergy(load(),now);
        if(current.bodyEnergy<1||current.brainEnergy<1){report.skipped++;return;}
      }
      let r;
      if(key==="B-d")r=playArena(db,actor,arena,drops,{rank:"d",requestId:request("battle"),now,today,hasBuilding,rng});
      else if(key==="Osaka-week"||key==="Osaka-strong")r=playOsaka(db,actor,osaka,npcs,{mode:key.slice(6),requestId:request("battle"),now,today,rng});
      else if(key==="Street")r=playStreetFight(db,actor,{mode:"multi",requestId:request("battle"),now,today,randomIndex:rng});
      else r=playCLeague(db,actor,{requestId:request("battle")},now,today,rng);
      assert.equal(r.replayed,false);
      const delta=key==="C"?r.reward:(r.moneyDelta??r.delta??0);
      assert.equal(row(db).money-before.money,delta);
      const m=report.battles[key]??={attempts:0,win:0,loss:0,draw:0,noOpponent:0,gross:0,winRounds:0,prizes:0};
      m.attempts++;m[r.outcome]++;m.gross+=delta;
      if(r.outcome==="win")m.winRounds+=r.rounds.length;
      if(key!=="C"&&r.reward?.granted)m.prizes++;
      report.attempts++;report.gross+=delta;
    };
    const mealAt=(now,today)=>{
      if(row(db).town_id!==0){report.mealMissed++;return;}
      const ch=recoverEnergy(load(),now);
      if(!hungerStatus(ch.lastMealAt,now).canEat){report.mealMissed++;return;}
      ensureDiningRotation(db,meals,today,menuRng);
      const affordable=listedDiningMeals(db,meals).filter(m=>m.stock>0&&m.price<=ch.money);
      const list=affordable.filter(m=>m.calories>=200&&m.calories<=800);
      const selected=(list.length?list:affordable).sort((a,b)=>a.price-b.price||a.key.localeCompare(b.key))[0];
      if(!selected){report.mealMissed++;return;}
      const r=eatMeal(ch,selected,now);takeDiningStock(db,selected);save(r.character);
      report.mealCount++;report.mealCost+=r.paid;
    };
    for(let d=0;d<duration;d++){
      const morning=start+d*dayMs,today=dayAt(morning);
      const settled=settleBankInterest(db,actor,today,morning);
      report.interest+=settled.ordinary+settled.term;
      report.taxPaid+=settled.tax?.paid??0;
      const before=recoverEnergy(load(),morning);
      save(settleDailyHealth(before,today,maxBodyEnergy(before.stats),maxBrainEnergy(before.stats),morning).character);
      const cashBefore=row(db).money,bankBefore=row(db).bank;
      const evt=settleDailyIllnessEvent(db,actor,today,morning,unit);
      if(evt.event)report.eventIds.push(evt.originalId);
      if(getCockroachChallenge(db,actor,morning)?.status==="active"){
        claimCockroach(db,actor,morning+1000,unit);report.cockroachClaims++;
      }
      report.eventCash+=row(db).money-cashBefore;report.eventBank+=row(db).bank-bankBefore;
      if(savings&&row(db).money<50000&&row(db).bank>0){
        const amount=Math.min(50000-row(db).money,row(db).bank);
        bankOperation(db,actor,"withdraw",amount,today,morning+2000);report.withdrawals+=amount;
      }
      // If a real event moved the resident, use the real train tariff to return.
      const ch=load();
      if(ch.townId!==0&&ch.money>=quoteTrainFare(ch.townId,0)){
        const r=travelByTrain(ch,0);save(r.character);report.travelCost+=r.fare;
      }
      const medical=load(),quote=getTreatmentQuote(medical);
      if(medical.townId===0&&quote.disease.key!=="healthy"&&medical.money>=quote.price){
        const r=treatAtHospital(medical,morning+5000);save(r.character);report.medicalCost+=r.paid;
      }
      if(row(db).town_id===0)for(const item of db.prepare("SELECT id,uses,status FROM equipment_items WHERE user_id=? AND status!='sold' ORDER BY id").all(actor)){
        if(item.uses!==0||row(db).money<25000)continue;
        report.gearCost-=forgeEquipment(db,actor,{itemId:item.id,usesUp:10,requestId:request("repair"),now:morning+5000,hasBuilding}).amount;
        equipEquipment(db,actor,{itemId:item.id,requestId:request("equip"),now:morning+5000,hasBuilding});
      }
      mealAt(morning+60000,today);
      const useTime=morning+120000;
      const award=listLegacyItemActions(db,actor,recoverEnergy(load(),useTime),useTime).find(x=>["MB","ゲットアイテム"].includes(x.category)&&x.canUse);
      if(award){const r=useLegacyItem(db,actor,award.sourceLine,request("award-use"),useTime,rng);assert.equal(r.replayed,false);report.rewardUses++;}
      for(const hour of [1,3]){
        const now=morning+hour*3600000,c=recoverEnergy(load(),now);
        const condition=conditionWithIllness(deriveCondition(c,maxBodyEnergy(c.stats),maxBrainEnergy(c.stats),now),c);
        if(jobEligibility(c,job)||c.bodyEnergy<job.bodyCost||c.brainEnergy<job.brainCost||condition.baseExperience===null){report.workBlocked++;continue;}
        const r=performWork(c,job,now,()=>rng(16777216)/16777216);save(r.character);report.workCount++;report.wages+=r.paid+r.bonus;
      }
      // Keep chronology monotonic: work above at 10/12; lessons at 13/14/15.
      mealAt(morning+4*3600000,today);
      for(const [index,type] of ["school","gym","classroom"].entries()){
        const now=morning+(5+index)*3600000,c=load();
        const available=lessons.filter(x=>x.type===type&&c.money-x.price>=15000&&!trainingAvailability(c,x,now,today));
        const selected=available.sort((a,b)=>a.price-b.price||a.key.localeCompare(b.key))[0];
        if(!selected)continue;
        const r=performTraining(c,selected,now,today);save(r.character);report[type+"Count"]++;report.lessonCost+=r.paid;
      }
      const at=morning+8*3600000;
      if(d===7&&row(db).money>=25000&&load().stats.kokugo>1){
        report.trainingCost+=trainCLeague(db,actor,{requestId:request("c-train"),transfers:{kokugo:1}},at,today).cost;
      }
      refreshBankTaxSnapshot(db,actor,today);
      const actions=[...(!skipB?["B-d"]:[]),"Osaka-week",...(mode==="multi"?["Street"]:[]),"C"];
      // Strong Osaka only when actual earned stats reach the stated threshold.
      if(STAT_KEYS.every(k=>load().stats[k]>=100))actions.splice(actions.indexOf("Osaka-week")+1,0,"Osaka-strong");
      for(const [i,key] of actions.entries())battle(key,at+i*(pace==="spaced"?3600000:5000),today);
      if(savings&&row(db).money>50000){
        const amount=Math.floor((row(db).money-50000)/4);
        if(amount>0){bankOperation(db,actor,"deposit",amount,today,morning+13*3600000);report.deposits+=amount;}
      }
      refreshBankTaxSnapshot(db,actor,today);
      const end=load();report.days.push({day:d+1,cash:end.money,bank:end.bank,stats:end.stats,health:end.healthIndex,weight:end.weight});
    }
    const final=load();report.finalCash=final.money;report.finalBank=final.bank;report.net=final.money-created.money;report.netAssets=final.money+final.bank-created.money;report.kpoint=row(db).kpoint;report.coupons=getCouponBalance(db,actor);
    report.season=db.prepare("SELECT number FROM c_league_season WHERE id=1").get().number;
    report.seasonRecord=db.prepare("SELECT wins,losses,draws,prev_wins,prev_losses,prev_draws,champions,points FROM c_league_entries WHERE user_id=?").get(actor);
    report.inventory=db.prepare("SELECT i.original_name name,COALESCE(u.remaining,i.durability) remaining FROM legacy_inventory_items i LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line WHERE i.user_id=? ORDER BY i.source_line").all(actor);
    report.taxUnpaid=db.prepare("SELECT COALESCE(SUM(unpaid),0) n FROM bank_tax_assessments WHERE user_id=?").get(actor).n;
    report.finalStats=final.stats;
    assert.equal(report.net,report.wages+report.eventCash+report.gross-report.lessonCost-report.mealCost-report.medicalCost-report.travelCost-report.gearCost-report.trainingCost-report.deposits+report.withdrawals);
    assert.equal(report.netAssets,report.wages+report.eventCash+report.eventBank+report.gross-report.lessonCost-report.mealCost-report.medicalCost-report.travelCost-report.gearCost-report.trainingCost+report.interest-report.taxPaid);
    assert.equal(report.finalBank,report.deposits-report.withdrawals+report.eventBank+report.interest-report.taxPaid);
    assert.ok(final.money>=0);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    return report;
  }finally{db.close();}
}
test("階段G新角色真實成長路徑：工作、食堂、訓練、事件、獎品與混合戰鬥",()=>{
  const rows=[];
  for(const mode of ["solo","multi"])for(const pace of ["spaced","compact"])for(const seed of [17,20261125,97,314159])rows.push(grow(mode,pace,seed));
  assert.equal(rows.length,16);
  assert.deepEqual(grow("solo","spaced",17),rows[0]);
  for(const r of rows){const {days,...summary}=r;console.log("G_GROWTH "+JSON.stringify({...summary,dayCash:days.map(d=>d.cash),lastDay:days.at(-1)}));}
});

test("階段G 42日三賽季新角策略對照：含銀行真實結息稅款、保留／暫緩B聯賽",()=>{
  const rows=[];
  for(const mode of ["solo","multi"])for(const skipB of [false,true])for(const seed of [17,20261125,97,314159]){
    const r=grow(mode,"spaced",seed,{duration:42,skipB,savings:true});
    assert.equal(r.days.length,42);assert.equal(r.season,3);
    assert.equal(r.battles.C.attempts,42);assert.equal(r.seasonRecord.wins+r.seasonRecord.losses+r.seasonRecord.draws,14);
    if(skipB)assert.equal(r.battles["B-d"],undefined);
    rows.push(r);
  }
  assert.equal(rows.length,16);
  assert.deepEqual(grow("solo","spaced",17,{duration:42,skipB:false,savings:true}),rows[0]);
  for(const r of rows){
    const {days,...summary}=r;
    console.log("G_LONG "+JSON.stringify({...summary,dayAssets:days.map(d=>d.cash+d.bank),lastDay:days.at(-1)}));
  }
});
