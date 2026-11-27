import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  TOWNS, WORK_COOLDOWN_MS, decodeLegacyText, parseLegacyJobs,
  createCharacterData, recoverEnergy, jobEligibility, selectJob, performWork,
  maxBodyEnergy, maxBrainEnergy
} from "./engine.mjs";
import { parseLegacySchool, parseLegacyGym, parseLegacyClassroom, calendarDay, trainingAvailability, performTraining } from "./training.mjs";
import { initTownMapTable, bootstrapLegacyTownMaps, publicTownMap, editTownTile } from "./town-storage.mjs";
import { createSoloStarterTown } from "./solo-starter-town.mjs";
import { trainDestinations, travelByTrain } from "./transport.mjs";
import { parseHouseCatalog, initHousingTables, listHouses, publicHouseCatalog, buildHouse, renameHouse, sellHouse, getHouseSaleQuote, listHouseEvents, remodelHouse, listHouseRemodelEvents } from "./housing.mjs";
import { initRoomsTables, ROOM_TYPES, setRoomSlots, viewRoom, addRoomPost, deleteRoomPost } from "./rooms.mjs";
import { parseLegacyMeals, eatMeal, deriveCondition, hungerStatus, physiqueStatus, MEAL_COOLDOWN_MS } from "./dining.mjs";
import { initDiningStockTables, ensureDiningRotation, listedDiningMeals, takeDiningStock } from "./dining-stock.mjs";
import { healthStatus, settleDailyHealth, conditionWithIllness, getTreatmentQuote, treatAtHospital } from "./health.mjs";
import { initCharacterEvents, settleDailyIllnessEvent, listCharacterEvents, getCouponBalance } from "./events.mjs";
import {parseLegacyCouponCatalog} from "./coupon-catalog.mjs";
import {parseOriginalFishing,initFishingTables,ensureFishingStock,fishingOverview,buyFishingBait,castFishing,sellFishingCatch} from "./fishing.mjs";
import {parseOriginalCrafting,initCraftingTables,craftingOverview,craftItem} from "./crafting.mjs";
import {parseOriginalArcadeDice,initArcadeDiceTables,arcadeDiceOverview} from "./arcade-dice.mjs";
import {createArcadeDiceRoute} from "./routes/arcade-dice.mjs";
import {parseOriginalArcadeHighLow,initArcadeHighLowTables,arcadeHighLowOverview,playArcadeHighLow} from "./arcade-highlow.mjs";
import {parseOriginalArcadeDonuts,initArcadeDonutTables,arcadeDonutsOverview,playArcadeDonut} from "./arcade-donuts.mjs";
import {parseOriginalInstantLoto,initInstantLotoTables,instantLotoOverview,playInstantLoto} from "./arcade-loto.mjs";
import {parseOriginalLoto6,initLoto6Tables,loto6Overview,buyLoto6Ticket,settleLoto6Draw} from "./arcade-loto6.mjs";
import {parseOriginalMultiCard,initMultiCardTables,multiCardOverview,playMultiCard} from "./arcade-cardw.mjs";
import {parseOriginalTreasure,initTreasureTables,treasureOverview,openTreasure} from "./arcade-treasure.mjs";
import {parseOriginalRoadTransport,initRoadTravelTables,roadOverview,beginRoadTrip,arriveRoadTrip} from "./road-travel.mjs";
import {parseOriginalOnsenConfig} from "./onsen-source.mjs";
import {initOnsenTables,activeOnsenVisit,onsenOverview,enterOnsen,leaveOnsen} from "./onsen.mjs";
import {initCouponRedemptionTables,listCouponRewards,listCouponRedemptions,redeemEventCoupon,COUPON_SHOP_SYMBOL} from "./coupon-redemption.mjs";
import { getCockroachChallenge,claimCockroachForEvent } from "./event-cockroach.mjs";
import { parseLegacyInsurance, initInventoryTables, inventoryOverview, hasActiveHealthInsurance, listInsurancePurchases, buyHealthInsurance } from "./inventory.mjs";
import { listLegacyInventoryItems } from "./legacy-inventory.mjs";
import { inventorySlotUsage } from "./inventory-life.mjs";
import {parseLegacyRetailCatalog,initRetailTables,ensureRetailDay,listRetailStock,listRetailPurchases,buyRetailItem,retailItemDetails,RETAIL_SHOPS} from "./retail.mjs";
import {parseLegacyVendingCatalog,initVendingTables,ensureVendingRotation,listVendingStock,vendingPeriodKey,VENDING_SYMBOL,VENDING_SHOP} from "./vending.mjs";
import {parseArenaCatalog} from "./b-league-core.mjs";
import {parseArenaDrops,initArenaTables,arenaOverview,playArena,ARENA_SYMBOL} from "./b-league.mjs";
import {parseLegacyEquipmentCatalog,initEquipmentTables,listEquipmentItems,listEquipmentTransactions,buyEquipment,equipEquipment,sellEquipment,forgeEquipment,EQUIPMENT_SYMBOL} from "./equipment.mjs";
import {initGiftTables,GIFT_SHOP_SYMBOL,listGiftSources,listGiftEvents,listGiftMail,convertToGift,sendGift} from "./gift-shop.mjs";
import {initPrivateMailTables,sendPrivateMail,listMailbox,deletePrivateMailboxEntry} from "./private-mail.mjs";
import {initRecycleTables,RECYCLE_SYMBOL,listRecycleListings,listRecycleSellable,listRecycleHistory,buyFromRecycle,sellToRecycle} from "./recycle.mjs";
import {parseWholesaleCatalog,initWholesaleTables,ensureWholesaleDay,listWholesaleGoods,
  WHOLESALE_SYMBOL,SHOP_CATEGORIES,configurePlayerShop,listMyShops,
  listShopInventory,buyWholesale,returnWholesale,listWholesaleHistory}
  from "./wholesale.mjs";
import {initPlayerStoreTables,viewPlayerStore,setPlayerStorePrice,
  buyPlayerStore,listPlayerShopSales} from "./player-store.mjs";
import { listValidClassroomCreditCards, requireClassroomCreditCard } from "./legacy-credit.mjs";
import { legacyPlayerIcon } from "./appearance.mjs";
import { initLegacyItemUseTables, listLegacyItemActions, listLegacyItemUseHistory, useLegacyItem } from "./legacy-item-use.mjs";
import { initBankTables, settleBankInterest, bankOperation, bankOverview, bankLedger, recordBankEntry, transferToPlayer, BANK_TRANSFER_LIMIT, NEW_MEMBER_DAYS, NEW_MEMBER_TRANSFER_LIMIT, bankLoanOverview, borrowBankLoan, payoffBankLoan, bankTaxOverview, refreshBankTaxSnapshot } from "./banking.mjs";
import { initSoloClock, gameTimestamp, advanceSoloClock, soloOffset } from "./solo-clock.mjs";
import { deleteSoloCharacter } from "./solo-character.mjs";
import {parseOsakaRules} from "./osaka-challenge-core.mjs";
import {resolveOsakaNpcCatalog} from "./osaka-npc-catalog.mjs";
import {initOsakaTables,osakaOverview,playOsaka,migrateOsakaPowerPrizes} from "./osaka-challenge.mjs";
import { initStreetFightTables,streetFightOverview,playStreetFight } from "./street-fight.mjs";
import {initCLeagueTables,cLeagueOverview,trainCLeague,playCLeague} from "./c-league.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(ROOT, "..");
const STATIC_ROOT = resolve(ROOT, "public");
const IMG_ROOT = resolve(REPO_ROOT, "img");
const MODE = process.env.GAME_MODE === "multi" ? "multi" : "solo";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const COOKIE = "town_web_session";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const DATA_DIR = resolve(process.env.DATA_DIR || resolve(ROOT, "data"));
const GAME_TIMEZONE = process.env.GAME_TIMEZONE || "Asia/Taipei";
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(resolve(DATA_DIR, MODE + ".sqlite"));
if (MODE === "solo") initSoloClock(db);
const gameNow = () => MODE === "solo" ? gameTimestamp(db) : Date.now();
db.exec([
  "PRAGMA journal_mode=WAL;",
  "PRAGMA foreign_keys=ON;",
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS characters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL UNIQUE, gender TEXT NOT NULL, town_id INTEGER NOT NULL, money INTEGER NOT NULL, bank INTEGER NOT NULL, body_energy INTEGER NOT NULL, brain_energy INTEGER NOT NULL, recovered_at INTEGER NOT NULL, job_id TEXT, work_progress INTEGER NOT NULL, last_work_at INTEGER NOT NULL, work_count INTEGER NOT NULL, height INTEGER NOT NULL, bmi REAL NOT NULL, stats_json TEXT NOT NULL);"
].join("\n"));

// 舊版雛形資料庫可直接升級，避免已建立的角色在更新後無法讀取。
for (const [column, definition] of [
  ["weight", "REAL NOT NULL DEFAULT 60"],
  ["job_experience", "INTEGER NOT NULL DEFAULT 0"],
  ["job_work_count", "INTEGER NOT NULL DEFAULT 0"],
  ["mastered_job", "TEXT"],
  ["last_school_day", "TEXT NOT NULL DEFAULT ''"],
  ["last_gym_at", "INTEGER NOT NULL DEFAULT 0"],
  ["classroom_ready_at", "INTEGER NOT NULL DEFAULT 0"],
  ["salary_payment", "TEXT NOT NULL DEFAULT 'cash'"],
  ["gym_ready_at", "INTEGER NOT NULL DEFAULT 0"],
  ["created_at", "INTEGER NOT NULL DEFAULT 0"],
  ["last_meal_at", "INTEGER NOT NULL DEFAULT 0"],
  ["health_index", "INTEGER NOT NULL DEFAULT 50"],
  ["last_health_day", "TEXT NOT NULL DEFAULT ''"],
  ["last_event_day", "TEXT NOT NULL DEFAULT ''"],
  ["kpoint", "INTEGER NOT NULL DEFAULT 0"]
]) {
  const currentColumns = db.prepare("PRAGMA table_info(characters)").all();
  if (!currentColumns.some(info => info.name === column)) {
    db.exec("ALTER TABLE characters ADD COLUMN " + column + " " + definition);
  }
}

initTownMapTable(db);
initHousingTables(db);
initRoomsTables(db);
initBankTables(db);
initCLeagueTables(db);
initCharacterEvents(db);
initCouponRedemptionTables(db);
initFishingTables(db);
initCraftingTables(db);
initArcadeDiceTables(db);
initStreetFightTables(db);
initArcadeHighLowTables(db);
initArcadeDonutTables(db);
initInstantLotoTables(db);
initLoto6Tables(db);
initMultiCardTables(db);
initTreasureTables(db);
initRoadTravelTables(db);
initOnsenTables(db);
initInventoryTables(db);
initDiningStockTables(db);
initLegacyItemUseTables(db);
initRetailTables(db);
initVendingTables(db);
initEquipmentTables(db);
initArenaTables(db);
initOsakaTables(db);
initGiftTables(db);
initPrivateMailTables(db);
initRecycleTables(db);
initWholesaleTables(db);
initPlayerStoreTables(db);
// Administrator may supply the original dedicated NPC directory tree separately from player saves.
const osakaRules=parseOsakaRules(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"obatyan.cgi"))));
const osakaUpgrade=migrateOsakaPowerPrizes(db,osakaRules);
if(osakaUpgrade.skipped)console.warn("大阪舊版待核對獎品："+osakaUpgrade.skipped+" 筆無足夠收據或存在衝突，未修改");
const osakaCatalog=resolveOsakaNpcCatalog(resolve(process.env.OSAKA_NPC_ROOT||REPO_ROOT),process.env.OSAKA_NPC_POLICY||"auto");
const houseCatalog = parseHouseCatalog(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT, "town_ini.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT, "command.pl")))
);
const importedTownIds = bootstrapLegacyTownMaps(db, REPO_ROOT);

const jobPath = resolve(REPO_ROOT, "dat_dir", "job.cgi");
if (!existsSync(jobPath)) throw new Error("找不到原始職業檔案：" + jobPath);
const jobs = parseLegacyJobs(decodeLegacyText(readFileSync(jobPath)));
if (!jobs.length) throw new Error("無法讀取舊版職業資料，請檢查 dat_dir/job.cgi");
const jobsByKey = new Map(jobs.map(job => [job.key, job]));
const trainingLessons = [
  ...parseLegacySchool(decodeLegacyText(readFileSync(resolve(REPO_ROOT, "dat_dir", "school.cgi")))),
  ...parseLegacyGym(decodeLegacyText(readFileSync(resolve(REPO_ROOT, "dat_dir", "gym.cgi")))),
  ...parseLegacyClassroom(decodeLegacyText(readFileSync(resolve(REPO_ROOT, "dat_dir", "kyushitu.cgi"))))
];
const trainingByKey = new Map(trainingLessons.map(lesson => [lesson.key, lesson]));
const meals = [
  ...parseLegacyMeals(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))),"main"),
  ...parseLegacyMeals(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syokudou2.cgi"))),"second")
];
const mealsByKey = new Map(meals.map(meal => [meal.key,meal]));
const insuranceItem=parseLegacyInsurance(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))));
const retailCatalog=parseLegacyRetailCatalog(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))));
const couponCatalog=parseLegacyCouponCatalog(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","coupon.cgi"))));
const fishingCatalog=parseOriginalFishing(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"sea.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"hanbai1.cgi")))
);
const craftingCatalog=parseOriginalCrafting(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","gousei.cgi"))));
const arcadeDiceSource=parseOriginalArcadeDice(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"saikoro.cgi")))
);
const arcadeHighLowSource=parseOriginalArcadeHighLow(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"donut.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_ini.cgi")))
);
const arcadeDonutsSource=parseOriginalArcadeDonuts(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"donut.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_ini.cgi")))
);
const instantLotoSource=parseOriginalInstantLoto(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"loto.cgi")))
);
const loto6Source=parseOriginalLoto6(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"loto6.cgi")))
);
const multiCardSource=parseOriginalMultiCard(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"cardw2.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_ini.cgi")))
);
const treasureSource=parseOriginalTreasure(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"gamerand.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"otakara.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","otakara.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_ini.cgi")))
);
const onsenConfig=parseOriginalOnsenConfig(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_ini.cgi"))));
const roadSource=parseOriginalRoadTransport(
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_ini.cgi"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_lib.pl"))),
  decodeLegacyText(readFileSync(resolve(REPO_ROOT,"town_maker.cgi"))),
  treasureSource,retailCatalog,couponCatalog
);
const wholesaleCatalog=parseWholesaleCatalog(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","syouhin.cgi"))));
const vendingCatalog=parseLegacyVendingCatalog(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","jihanki.cgi"))));
const arenaCatalog=parseArenaCatalog(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","battle.cgi"))));
const arenaDrops=parseArenaDrops(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"battle.cgi"))));
const equipmentCatalog=parseLegacyEquipmentCatalog(decodeLegacyText(readFileSync(resolve(REPO_ROOT,"dat_dir","soubi.cgi"))));

const sessionHash = token => createHash("sha256").update(token).digest("hex");
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString("hex");

function getSoloUser() {
  let user = db.prepare("SELECT * FROM users WHERE username=?").get("__local_player__");
  if (!user) {
    const salt = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)")
      .run("__local_player__", salt, passwordHash(randomBytes(32).toString("hex"), salt), Date.now());
    user = db.prepare("SELECT * FROM users WHERE username=?").get("__local_player__");
  }
  return user;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(item => {
    const i = item.indexOf("=");
    return i < 0 ? ["", ""] : [item.slice(0, i).trim(), item.slice(i + 1).trim()];
  }));
}

function getUser(req) {
  if (MODE === "solo") return getSoloUser();
  const token = parseCookies(req)[COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?")
    .get(sessionHash(token), Date.now()) ?? null;
}

function newSession(res, userId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(sessionHash(token), userId, Date.now() + 7 * 86400000);
  res.setHeader("Set-Cookie", COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800" + (COOKIE_SECURE ? "; Secure" : ""));
}

function clearSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sessionHash(token));
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (COOKIE_SECURE ? "; Secure" : ""));
}

function characterFromRow(row) {
  if (!row) return null;
  return {
    name: row.name, gender: row.gender, townId: row.town_id,
    money: row.money, bank: row.bank, bodyEnergy: row.body_energy,
    brainEnergy: row.brain_energy, recoveredAt: row.recovered_at,
    jobId: row.job_id, salaryPayment:row.salary_payment, workProgress: row.work_progress,
    lastWorkAt: row.last_work_at, workCount: row.work_count,
    height: row.height, weight: row.weight, bmi: row.bmi,
    jobExperience: row.job_experience, jobWorkCount: row.job_work_count,
    masteredJob: row.mastered_job, stats: JSON.parse(row.stats_json),
    lastSchoolDay: row.last_school_day, lastGymAt: row.last_gym_at,
    gymReadyAt: row.gym_ready_at, classroomReadyAt:row.classroom_ready_at,
    lastMealAt: row.last_meal_at,
    healthIndex: row.health_index, lastHealthDay: row.last_health_day,
    lastEventDay: row.last_event_day,
    kpoint: row.kpoint
  };
}

function getCharacter(userId) {
  return characterFromRow(db.prepare("SELECT * FROM characters WHERE user_id=?").get(userId));
}

function saveCharacter(userId, c) {
  db.prepare("UPDATE characters SET town_id=?,money=?,bank=?,body_energy=?,brain_energy=?,recovered_at=?,job_id=?,work_progress=?,last_work_at=?,work_count=?,height=?,bmi=?,stats_json=?,weight=?,job_experience=?,job_work_count=?,mastered_job=?,last_school_day=?,last_gym_at=?,gym_ready_at=?,last_meal_at=?,health_index=?,last_health_day=?,last_event_day=?,classroom_ready_at=?,salary_payment=? WHERE user_id=?")
    .run(c.townId, c.money, c.bank, c.bodyEnergy, c.brainEnergy, c.recoveredAt,
      c.jobId, c.workProgress, c.lastWorkAt, c.workCount, c.height, c.bmi,
      JSON.stringify(c.stats), c.weight, c.jobExperience, c.jobWorkCount, c.masteredJob,
      c.lastSchoolDay, c.lastGymAt, c.gymReadyAt, c.lastMealAt ?? 0,
      c.healthIndex ?? 50,c.lastHealthDay ?? "",c.lastEventDay ?? "",c.classroomReadyAt ?? 0,c.salaryPayment??"cash",userId);
}

function addCharacter(userId, c) {
  db.prepare("INSERT INTO characters(user_id,name,gender,town_id,money,bank,body_energy,brain_energy,recovered_at,job_id,work_progress,last_work_at,work_count,height,bmi,stats_json,weight,job_experience,job_work_count,mastered_job,last_school_day,last_gym_at,gym_ready_at,created_at,last_meal_at,health_index,last_health_day,last_event_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId,c.name,c.gender,c.townId,c.money,c.bank,c.bodyEnergy,c.brainEnergy,
      c.recoveredAt,c.jobId,c.workProgress,c.lastWorkAt,c.workCount,c.height,
      c.bmi,JSON.stringify(c.stats),c.weight,c.jobExperience,c.jobWorkCount,c.masteredJob,
      c.lastSchoolDay,c.lastGymAt,c.gymReadyAt,c.recoveredAt,c.lastMealAt ?? 0,
      c.healthIndex ?? 50,c.lastHealthDay ?? "",c.lastEventDay ?? "");
}

function mutateCharacter(userId, callback, afterSave, energyContext="resident") {
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = getCharacter(userId);
    if (!old) throw new HttpError(409, "請先建立角色");
    const result = callback(recoverEnergy(old,gameNow(),energyContext));
    saveCharacter(userId, result.character);
    afterSave?.();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function snapshot(user) {
  const now = gameNow();
  const today = calendarDay(now, GAME_TIMEZONE);
  // The original bathing screen does not execute the resident/status settlement.
  // While bathing, only expose a read-only preview; explicit exit settles recovery once.
  if(user&&activeOnsenVisit(db,user.id)){
    const character=getCharacter(user.id);
    if(!character)throw Error("入浴角色資料不存在");
    const onsen=onsenOverview(db,user.id,onsenConfig,now);
    return {mode:MODE,gameTimeMs:now,gameTimeZone:GAME_TIMEZONE,
      gameTimeOffsetMs:MODE==="solo"?soloOffset(db):0,
      user:{username:MODE==="solo"?"單機玩家":user.username},
      character,onsen,maxBodyEnergy:onsen.active.entry.maxima.body,
      maxBrainEnergy:onsen.active.entry.maxima.brain,towns:TOWNS};
  }
  if (user) settleBankInterest(db,user.id,today,now);
  const character = user ? getCharacter(user.id) : null;
  let updated = character ? recoverEnergy(character, now) : null;
  if (updated) {
    updated = settleDailyHealth(updated,today,maxBodyEnergy(updated.stats),
      maxBrainEnergy(updated.stats),now).character;
    // 舊 Web 存檔可能高於更正後的一般上限，即使未滿十秒也須保存夾限結果。
    if (updated.bodyEnergy !== character.bodyEnergy || updated.brainEnergy !== character.brainEnergy ||
        updated.recoveredAt !== character.recoveredAt ||
        updated.lastHealthDay !== character.lastHealthDay ||
        updated.healthIndex !== character.healthIndex) saveCharacter(user.id,updated);
    // 原版 event_happen 會在主畫面隨機抽取，Web 每日只抽一次。
    if ((updated.lastEventDay??"")<today) {
      settleDailyIllnessEvent(db,user.id,today,now,Math.random,MODE);
      updated = getCharacter(user.id);
    }
  }
  // 每間食堂使用原版兩份食品來源；本遊戲伺服器上的所有玩家共用同一份
  // SQLite 菜單與剩餘份數，避免每次查看時重新抽選或單人買光不影響別人。
  let dailyMeals=[];
  if(updated){
    db.exec("BEGIN IMMEDIATE");
    try{
      ensureDiningRotation(db,meals,today);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    dailyMeals=listedDiningMeals(db,meals);
  }
  // 真正設於角色所在城鎮地圖中的百貨店才可瀏覽／購買；不提供無建築直購捷徑。
  const retailMap=updated ? publicTownMap(db,updated.townId,false) : null;
  const retailAvailable=retailMap?.configured ? Object.entries(RETAIL_SHOPS)
    .filter(([,symbol])=>retailMap.cells.some(cell=>cell.key===symbol))
    .map(([shop])=>shop) : [];
  let retailGoods=[];
  if(retailAvailable.length){
    db.exec("BEGIN IMMEDIATE");
    try{ensureRetailDay(db,retailCatalog,today);db.exec("COMMIT");}
    catch(error){db.exec("ROLLBACK");throw error;}
    retailGoods=listRetailStock(db,retailCatalog,retailAvailable);
  }
  // 自販機獨立於百貨，販售商品來源 dat_dir/jihanki.cgi、以當地中午換檔。
  const vendingAvailable=Boolean(retailMap?.configured&&
    retailMap.cells.some(cell=>cell.key===VENDING_SYMBOL));
  let vendingGoods=[];
  if(vendingAvailable){
    db.exec("BEGIN IMMEDIATE");
    try{
      ensureVendingRotation(db,vendingCatalog,now,GAME_TIMEZONE);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    // 與百貨共用同一份原版 33 欄效果解讀，只向前端傳必要明細。
    const bySku=new Map(vendingCatalog.map(item=>[item.sku,item]));
    vendingGoods=listVendingStock(db,vendingCatalog).map(good=>({
      ...good,details:retailItemDetails(bySku.get(good.sku))
    }));
  }
  const baitShopIsHere=Boolean(retailMap?.configured&&retailMap.cells.some(cell=>cell.key==="販売1"));
  if(baitShopIsHere){
    db.exec("BEGIN IMMEDIATE");
    try{
      ensureFishingStock(db,fishingCatalog.bait,today);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
  }
  const equipmentAvailable=Boolean(retailMap?.configured&&
    retailMap.cells.some(cell=>cell.key===EQUIPMENT_SYMBOL));
  const couponShopAvailable=Boolean(retailMap?.configured&&
    retailMap.cells.some(cell=>cell.key===COUPON_SHOP_SYMBOL));
  const giftShopAvailable=Boolean(retailMap?.configured&&
    retailMap.cells.some(cell=>cell.key===GIFT_SHOP_SYMBOL));
  const recycleAvailable=Boolean(retailMap?.configured&&
    retailMap.cells.some(cell=>cell.key===RECYCLE_SYMBOL));
  const wholesaleAvailable=Boolean(retailMap?.configured&&
    retailMap.cells.some(cell=>cell.key===WHOLESALE_SYMBOL));
  let wholesaleGoods=[];
  if(wholesaleAvailable){
    db.exec("BEGIN IMMEDIATE");
    try{ensureWholesaleDay(db,wholesaleCatalog,today);db.exec("COMMIT");}
    catch(error){db.exec("ROLLBACK");throw error;}
    wholesaleGoods=listWholesaleGoods(db,wholesaleCatalog);
  }
  const myShops=updated?listMyShops(db,user.id):[];
  const currentJob = updated?.jobId ? jobsByKey.get(updated.jobId) : null;
  const classroomCreditCards=updated?listValidClassroomCreditCards(db,user.id,now):[];
  const ownedHouses = updated ? listHouses(db, user.id).map(h => ({
    ...h, saleRefund: getHouseSaleQuote(houseCatalog, h.townId).refund
  })) : [];
  const townHouses = updated ? listHouses(db).filter(h => h.townId === updated.townId) : [];
  const map = updated ? publicTownMap(db, updated.townId, MODE === "solo") : null;
  if (map) for (const house of townHouses) {
    const cell = map.cells[house.row * 16 + house.column];
    if (cell && cell.raw === "webhouse_" + house.id + "=" + house.originalPlot) {
      cell.label = house.name + "（屋主：" + house.ownerName + "）";
      cell.image = house.image;
      cell.category = "house";
      cell.houseId = house.id;
    }
  }
  // 最後才保存本次主畫面結束後的資產基準，讓下個徵稅日使用前次存檔值。
  if(updated) refreshBankTaxSnapshot(db,user.id,today);
  const residents = updated
    ? db.prepare("SELECT name FROM characters WHERE town_id=? AND user_id<>? ORDER BY name LIMIT 50")
      .all(updated.townId, user.id).map(row => row.name)
    : [];
  return {
    mode: MODE,
    gameTimeMs: now,
    gameTimeZone: GAME_TIMEZONE,
    gameTimeOffsetMs: MODE === "solo" ? soloOffset(db) : 0,
    user: user ? { username: MODE === "solo" ? "單機玩家" : user.username } : null,
    character: updated,
    legacyPlayerIcon: updated ? legacyPlayerIcon(db,user.id) : { status: "none" },
    bankAccount: updated ? bankOverview(db,user.id) : null,
    bankTax: updated ? bankTaxOverview(db,user.id) : null,
    bankLoan: updated ? bankLoanOverview(db,user.id,currentJob) : null,
    bankLedger: updated ? bankLedger(db,user.id) : [],
    bankTransferRules: MODE === "multi" && updated ? {
      maxAmount: BANK_TRANSFER_LIMIT, newMemberDays: NEW_MEMBER_DAYS,
      newMemberMaxExclusive: NEW_MEMBER_TRANSFER_LIMIT
    } : null,
    currentJob: currentJob ? {
      key:currentJob.key,name:currentJob.name,salary:currentJob.salary,
      payEvery:currentJob.payEvery,
      workProgress:updated.jobWorkCount % currentJob.payEvery,
      worksUntilPayday:currentJob.payEvery-
        (updated.jobWorkCount % currentJob.payEvery)
    } : null,
    condition: updated ? conditionWithIllness(deriveCondition(updated,
      maxBodyEnergy(updated.stats),maxBrainEnergy(updated.stats),now),updated) : null,
    health: updated ? healthStatus(updated) : null,
    healthEvents: updated ? listCharacterEvents(db,user.id) : [],
    couponBalance: updated ? getCouponBalance(db,user.id) : 0,
    couponShopAvailable,
    couponRewards:updated?listCouponRewards(couponCatalog,getCouponBalance(db,user.id),couponShopAvailable):[],
    couponRedemptions:updated?listCouponRedemptions(db,user.id):[],
    fishing:updated?fishingOverview(db,user.id,fishingCatalog,now,today):null,
    crafting:updated?craftingOverview(db,user.id,craftingCatalog,now):null,
    osaka:updated?osakaOverview(db,user.id,osakaCatalog):null,
    streetFight:updated?streetFightOverview(db,user.id,MODE):null,
    cLeague:updated?cLeagueOverview(db,user.id,now,{activate:false}):null,
    arcadeDice:updated?arcadeDiceOverview(db,user.id,arcadeDiceSource,now):null,
    arcadeHighLow:updated?arcadeHighLowOverview(db,user.id,arcadeHighLowSource,now):null,
    arcadeDonuts:updated?arcadeDonutsOverview(db,user.id,arcadeDonutsSource,now):null,
    instantLoto:updated?instantLotoOverview(db,user.id,instantLotoSource,now):null,
    loto6:updated?loto6Overview(db,user.id,loto6Source,now,GAME_TIMEZONE):null,
    multiCard:updated?multiCardOverview(db,user.id,multiCardSource,now,{solo:MODE==="solo"}):null,
    treasure:updated?treasureOverview(db,user.id,treasureSource,now):null,
    roadTravel:updated?roadOverview(db,user.id,roadSource,now):null,
    onsen:updated?onsenOverview(db,user.id,onsenConfig,now):null,
    cockroachChallenge: updated ? getCockroachChallenge(db,user.id,now) : null,
    hospital: updated ? getTreatmentQuote(updated,hasActiveHealthInsurance(db,user.id,insuranceItem,now)) : null,
    insurance: updated ? inventoryOverview(db,user.id,insuranceItem,now) : null,
    insurancePurchases: updated ? listInsurancePurchases(db,user.id) : [],
    legacyInventory: updated ? listLegacyInventoryItems(db,user.id,50,retailItemDetails,now) : [],
    inventoryCapacity: updated ? inventorySlotUsage(db,user.id,now) : null,
    retailAvailable,retailGoods,retailDay:updated?today:null,
    retailPurchases:updated?listRetailPurchases(db,user.id):[],
    vendingAvailable,vendingGoods,
    vendingPeriod:vendingAvailable?vendingPeriodKey(now,GAME_TIMEZONE):null,
    bLeague:updated?arenaOverview(db,user.id,now,retailMap?.configured&&retailMap.cells.some(cell=>cell.key===ARENA_SYMBOL)):null,
    equipmentAvailable,equipmentGoods:equipmentAvailable?equipmentCatalog:[],
    equipmentItems:updated?listEquipmentItems(db,user.id):[],
    equipmentTransactions:updated?listEquipmentTransactions(db,user.id):[],
    giftShopAvailable,
    giftSources:updated?listGiftSources(db,user.id,now):[],
    giftEvents:updated?listGiftEvents(db,user.id):[],
    giftMail:updated?listGiftMail(db,user.id):[],
    mailbox:updated?listMailbox(db,user.id):[],
    recycleAvailable,
    recycleListings:recycleAvailable?listRecycleListings(db,now):[],
    recycleSellable:updated?listRecycleSellable(db,user.id,now):[],
    recycleHistory:updated?listRecycleHistory(db,user.id):[],
    wholesaleAvailable,wholesaleGoods:wholesaleAvailable?wholesaleGoods:[],
    wholesaleDay:wholesaleAvailable?today:null,
    shopCategories:SHOP_CATEGORIES,
    myShops:myShops.map(s=>({
      ...s,inventory:listShopInventory(db,user.id,s.houseId)
    })),
    wholesaleHistory:updated?listWholesaleHistory(db,user.id):[],
    playerShopSales:updated?listPlayerShopSales(db,user.id):[],
    legacyItemActions: updated ? listLegacyItemActions(db,user.id,updated,now) : [],
    legacyItemHistory: updated ? listLegacyItemUseHistory(db,user.id) : [],
    hunger: updated ? hungerStatus(updated.lastMealAt,now) : null,
    physique: updated ? physiqueStatus(updated.height,updated.weight) : null,
    mealCooldownMs: updated && updated.lastMealAt ?
      Math.max(0,MEAL_COOLDOWN_MS-(now-updated.lastMealAt)) : 0,
    mealMenuDay: updated ? today : null,
    meals: updated ? dailyMeals.map(meal=>({
      key:meal.key,name:meal.name,menu:meal.menu,
      price:meal.price,calories:meal.calories,gains:meal.gains,
      stock:meal.stock,
      reason:meal.stock<=0 ? "今日已售完" :
        updated.lastMealAt && now-updated.lastMealAt<MEAL_COOLDOWN_MS
          ? "用餐後需間隔 60 分鐘" :
          updated.money<meal.price ? "現金不足" : null
    })) : [],
    maxBodyEnergy: updated ? maxBodyEnergy(updated.stats) : null,
    maxBrainEnergy: updated ? maxBrainEnergy(updated.stats) : null,
    jobLevel: updated ? Math.floor(updated.jobExperience / 100) : 0,
    towns: TOWNS,
    // 票價由原版站點對照表計算；只以角色目前城鎮為起點。
    trainDestinations: updated ? trainDestinations(updated.townId) : [],
    map,
    houses: ownedHouses,
    houseEvents: updated ? listHouseEvents(db, user.id) : [],
    houseRemodelEvents: updated ? listHouseRemodelEvents(db, user.id) : [],
    townHouses,
    roomTypes: updated ? ROOM_TYPES : [],
    houseCatalog: updated ? publicHouseCatalog(houseCatalog, updated.townId, ownedHouses.length) : null,
    residents,
    workCooldownMs: updated ? (updated.lastWorkAt === 0 ? 0 : Math.max(0, WORK_COOLDOWN_MS - (now - updated.lastWorkAt))) : 0,
    schoolRemainingToday: updated ? updated.lastSchoolDay === today : false,
    gymCooldownMs: updated ? Math.max(0, updated.gymReadyAt - now) : 0,
    classroomCooldownMs: updated ? Math.max(0, (updated.classroomReadyAt??0) - now) : 0,
    classroomCreditCards,
    trainingLessons: updated ? trainingLessons.map(lesson => {
      const cashReason=trainingAvailability(updated,lesson,now,today);
      const creditReason=classroomCreditCards.length?
        trainingAvailability(updated,lesson,now,today,"credit"):"沒有有效且屬於本人的原版信用卡";
      return {
        key:lesson.key,type:lesson.type,name:lesson.name,
        price:lesson.price,energyCost:lesson.energyCost,
        bodyCost:lesson.bodyCost,brainCost:lesson.brainCost,
        weightLoss:lesson.weightLoss,gains:lesson.gains,
        cooldownMs:lesson.cooldownMs,
        cashReason,creditReason,
        reason:cashReason&&classroomCreditCards.length&&creditReason===null?null:cashReason
      };
    }) : [],
    jobs: updated ? jobs.map(job => ({
      key: job.key, name: job.name, originalName: job.originalName,
      translated: job.translated, rank: job.rank,
      requirements: job.requirements, bmiMin: job.bmiMin, bmiMax: job.bmiMax,
      gender: job.gender, minHeight: job.minHeight,
      salary: job.salary, payEvery: job.payEvery, bonusRate: job.bonusRate,
      raiseRate: job.raiseRate, bodyCost: job.bodyCost,
      brainCost: job.brainCost, previousJob: job.previousJob,
      reason: jobEligibility(updated, job)
    })) : []
  };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) {
    throw new HttpError(415, "只接受 JSON 請求");
  }
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 16 * 1024) throw new HttpError(413, "資料超出長度限制");
    parts.push(part);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new HttpError(400, "無效的 JSON 格式"); }
  if (typeof data !== "object" || !data || Array.isArray(data)) {
    throw new HttpError(400, "請提供 JSON 物件");
  }
  return data;
}

const safeUsername = str => typeof str === "string" && /^[\p{L}\p{N}_]{2,24}$/u.test(str) && !str.startsWith("__");
const safeCharacterName = str => typeof str === "string" && /^[\p{L}\p{N}_ ]{1,18}$/u.test(str.trim());
const safePassword = str => typeof str === "string" && str.length >= 8 && str.length <= 128;

function safeFile(res, dir, requestPath, prefix) {
  let target;
  try { target = resolve(dir, decodeURIComponent(requestPath.slice(prefix.length))); }
  catch { throw new HttpError(400, "無效的檔案路徑"); }
  if (!target.startsWith(dir + sep)) throw new HttpError(404, "找不到檔案");
  const type = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".gif": "image/gif",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[extname(target).toLowerCase()];
  if (!type || !existsSync(target)) throw new HttpError(404, "找不到檔案");
  res.writeHead(200, {
    "Content-Type": type, "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(readFileSync(target));
}

const handleArcadeDice=createArcadeDiceRoute({db,arcadeDiceSource,gameNow,snapshot,sendJson,HttpError});

async function handle(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    if (req.method === "GET" && path === "/") return safeFile(res, STATIC_ROOT, "/static/index.html", "/static/");
    if (req.method === "GET" && path.startsWith("/static/")) return safeFile(res, STATIC_ROOT, path, "/static/");
    if (req.method === "GET" && path.startsWith("/legacy-assets/")) return safeFile(res, IMG_ROOT, path, "/legacy-assets/");
    if (req.method === "GET" && path === "/api/state") return sendJson(res, 200, snapshot(getUser(req)));
    if (req.method === "GET" && path === "/api/town/preview") {
      const param=url.searchParams.get("townId");
      if(param!==null&&!/^[0-3]$/.test(param))
        throw new HttpError(400,"不存在的城鎮");
      const townId=param===null?0:Number(param);
      const map=publicTownMap(db,townId,false);
      // 未登入只取得允許的顯示欄位：不含 raw、調色盤、私人角色資料。
      return sendJson(res,200,{
        towns:TOWNS.map(({id,name})=>({id,name})),
        map:{
          townId,configured:map.configured,background:map.background,
          cells:map.cells.map(({index,row,column,label,image,category})=>({
            index,row,column,label:category==="unknown"?"未識別的街區符號":label,
            image,category
          }))
        }
      });
    }
    if (req.method === "GET" && path === "/api/house/visit") {
      const visitor = getUser(req);
      if (!visitor) throw new HttpError(401, "請先登入");
      if(activeOnsenVisit(db,visitor.id))throw new HttpError(409,"目前正在泡溫泉，請先離開浴池");
      const houseId = Number(url.searchParams.get("houseId"));
      const slotParam = url.searchParams.get("slot");
      const slot = slotParam === null ? null : Number(slotParam);
      try { return sendJson(res, 200, viewRoom(db, visitor.id, houseId, slot)); }
      catch (error) { throw new HttpError(400, error.message); }
    }
    if(req.method==="GET"&&path==="/api/shop/visit"){
      const visitor=getUser(req);
      if(!visitor)throw new HttpError(401,"請先登入");
      if(activeOnsenVisit(db,visitor.id))throw new HttpError(409,"目前正在泡溫泉，請先離開浴池");
      const houseId=Number(url.searchParams.get("houseId"));
      try{return sendJson(res,200,viewPlayerStore(db,visitor.id,houseId));}
      catch(error){throw new HttpError(400,error.message);}
    }
    if (req.method !== "POST") throw new HttpError(404, "找不到指定的功能");
    const origin = req.headers.origin;
    if (origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === req.headers.host; } catch {}
      if (!sameHost) throw new HttpError(403, "不允許跨來源操作");
    }
    const data = await readBody(req);

    if (path === "/api/register") {
      if (MODE !== "multi") throw new HttpError(404, "單機模式無需註冊");
      if (!safeUsername(data.username) || !safePassword(data.password)) {
        throw new HttpError(400, "帳號須為 2 至 24 個字元；密碼須為 8 至 128 個字元");
      }
      if (db.prepare("SELECT id FROM users WHERE username=?").get(data.username)) {
        throw new HttpError(409, "帳號已被使用");
      }
      const salt = randomBytes(16).toString("hex");
      const created = db.prepare("INSERT INTO users(username,password_salt,password_hash,created_at) VALUES(?,?,?,?)")
        .run(data.username, salt, passwordHash(data.password, salt), Date.now());
      const user = db.prepare("SELECT * FROM users WHERE id=?").get(Number(created.lastInsertRowid));
      newSession(res, user.id);
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/login") {
      if (MODE !== "multi") throw new HttpError(404, "單機模式無需登入");
      const user = typeof data.username === "string"
        ? db.prepare("SELECT * FROM users WHERE username=?").get(data.username) : null;
      if (!user || !safePassword(data.password)) throw new HttpError(401, "帳號或密碼錯誤");
      const actual = Buffer.from(passwordHash(data.password, user.password_salt), "hex");
      const expected = Buffer.from(user.password_hash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new HttpError(401, "帳號或密碼錯誤");
      }
      newSession(res, user.id);
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/logout") {
      if (MODE === "multi") clearSession(req, res);
      return sendJson(res, 200, { ok: true });
    }

    const user = getUser(req);
    if (!user) throw new HttpError(401, "請先登入");

    if(path==="/api/onsen/enter"){
      const now=gameNow();
      let result;
      try{result=enterOnsen(db,user.id,onsenConfig,{bathKey:data.bathKey,requestId:data.requestId,
        now,today:calendarDay(now,GAME_TIMEZONE)});}
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),onsenResult:result});
    }
    if(path==="/api/onsen/leave"){
      let result;
      try{result=leaveOnsen(db,user.id,onsenConfig,{visitId:data.visitId,now:gameNow()});}
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),onsenResult:result});
    }
    // Permit the existing solo clock/delete operations and logout, but no resident actions during a visit.
    if(activeOnsenVisit(db,user.id)&&!["/api/solo/time/advance","/api/solo/character/delete"].includes(path))
      throw new HttpError(409,"目前正在泡溫泉，請先離開浴池");

    if (path === "/api/solo/character/delete") {
      if (MODE !== "solo") throw new HttpError(403, "只有單人模式可以刪除角色");
      // 不接受玩家 ID、帳號名稱或任意 SQL；需重新輸入目前角色名稱，明確確認。
      if (data.confirm !== true)
        throw new HttpError(400, "請先確認已瞭解角色資料將永久刪除");
      let deleted;
      try { deleted=deleteSoloCharacter(db,user.id,data.characterName); }
      catch(error) { throw new HttpError(400,error.message); }
      // 本機自動建立新的專用使用者，但不重建角色；
      // 保留 town_maps 和 solo_clock，回到建角流程。
      return sendJson(res,200,{...snapshot(getSoloUser()),deletion:deleted});
    }

    if (path === "/api/solo/time/advance") {
      // 伺服器決定快轉步長和遊戲時間；多人、未建角均不能改時鐘。
      if (MODE !== "solo") throw new HttpError(403, "只有單機模式可以快轉時間");
      if (!getCharacter(user.id)) throw new HttpError(409,"請先建立角色");
      const before=gameNow();
      const challenge=getCockroachChallenge(db,user.id,before);
      if (challenge?.status === "active")
        throw new HttpError(409,"限時事件進行中，請先處理或等待結束再快轉");
      let advanced;
      try { advanced=advanceSoloClock(db,data.preset); }
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),timeAdvance:advanced});
    }

    if (path === "/api/character") {
      if (!safeCharacterName(data.name) || !["male","female","other"].includes(data.gender)) {
        throw new HttpError(400, "角色名稱或性別不符合格式");
      }
      if (getCharacter(user.id)) throw new HttpError(409, "此帳號已有角色");
      let character;
      try { character = createCharacterData(data.name.trim(), data.gender, gameNow(), data.stats); }
      catch (error) { throw new HttpError(400, error.message); }
      addCharacter(user.id, character);
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/events/cockroach/claim") {
      let result;
      try { const now=gameNow(); result=claimCockroachForEvent(db,user.id,data.eventId,now,Math.random,calendarDay(now,GAME_TIMEZONE)); }
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),cockroachResult:result});
    }

    if (path === "/api/job") {
      const job = jobsByKey.get(data.key);
      if (!job) throw new HttpError(404, "找不到職業");
      mutateCharacter(user.id, old => ({ character: selectJob(old, job) }));
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/job/payment") {
      if(!["cash","bank"].includes(data.payment))
        throw new HttpError(400,"薪資收款方式必須是現金或普通存款");
      mutateCharacter(user.id,old=>({
        character:{...old,salaryPayment:data.payment}
      }));
      return sendJson(res,200,snapshot(user));
    }

    if (path === "/api/work") {
      const now=gameNow();
      const today=calendarDay(now,GAME_TIMEZONE);
      let result;
      try {
        // 工作入帳前先以原有銀行存款結清本日利息。
        // 不讓新入帳薪水在同一天第一次查詢時額外生息。
        settleBankInterest(db,user.id,today,now);
        result=mutateCharacter(user.id,old=>{
          const result=performWork(old,jobsByKey.get(old.jobId),now);
          if(result.payment==="bank"){
            // 與角色銀行餘額更新在同一個 SQLite 交易中，不會單獨留下帳簿紀錄。
            // 原版 bonus 先於 salary 記帳：兩筆分開，方便核對。
            if(result.bonus>0)
              recordBankEntry(db,user.id,"ordinary","升級獎金",0,
                result.bonus,old.bank+result.bonus,now);
            if(result.paid>0)
              recordBankEntry(db,user.id,"ordinary","工作薪資",0,
                result.paid,result.character.bank,now);
          }
          return result;
        },undefined,"work");
      } catch(error){throw new HttpError(400,error.message);}
      return sendJson(res, 200, { ...snapshot(user), result: {
        paid: result.paid, pending: result.pending,
        payEvery:jobsByKey.get(result.character.jobId).payEvery,
        worksUntilPayday:jobsByKey.get(result.character.jobId).payEvery-result.pending,
        experienceGain: result.experienceGain, condition:result.condition,
        jobLevel: result.jobLevel,
        leveledUp: result.leveledUp, bonus: result.bonus, mastered: result.mastered,
        payment:result.payment
      } });
    }

    if (path === "/api/hospital/treat") {
      const now=gameNow();
      const result=mutateCharacter(user.id,old=>{
        try {return treatAtHospital(old,now,
          hasActiveHealthInsurance(db,user.id,insuranceItem,now));}
        catch(error){throw new HttpError(400,error.message);}
      });
      return sendJson(res,200,{...snapshot(user),hospitalResult:{
        paid:result.paid,previousDisease:result.previousDisease
      }});
    }

    if (path === "/api/inventory/legacy/use") {
      let result;
      try {
        result=useLegacyItem(db,user.id,data.sourceLine,data.requestId,gameNow());
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),itemUseResult:result});
    }

    if (path === "/api/inventory/insurance/buy") {
      let result;
      try {
        result=buyHealthInsurance(db,user.id,insuranceItem,
          data.quantity,data.requestId,gameNow());
      } catch(error) {throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),insuranceResult:result});
    }

    if(path==="/api/fishing/bait/buy"||path==="/api/fishing/cast"||path==="/api/fishing/sell"){
      let fishingResult;
      const now=gameNow();
      try{
        if(path==="/api/fishing/bait/buy")
          fishingResult=buyFishingBait(db,user.id,fishingCatalog,{
            sku:data.sku,requestId:data.requestId,
            now,day:calendarDay(now,GAME_TIMEZONE)
          });
        else if(path==="/api/fishing/cast")
          fishingResult=castFishing(db,user.id,fishingCatalog,{
            sourceLine:data.sourceLine,requestId:data.requestId,now
          });
        else fishingResult=sellFishingCatch(db,user.id,{
          sourceLine:data.sourceLine,requestId:data.requestId,now
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),fishingResult});
    }

    if(path==="/api/crafting/make"){
      let craftingResult;
      try{
        craftingResult=craftItem(db,user.id,craftingCatalog,{
          recipeKey:data.recipeKey,quantity:data.quantity,
          requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),craftingResult});
    }

    if(path==="/api/osaka/play"){
      if(!data||typeof data!=="object"||Array.isArray(data)||Object.keys(data).some(k=>!["mode","requestId"].includes(k)))
        throw new HttpError(400,"大阪挑戰只接受難度及請求識別碼");
      let osakaResult;
      try{const now=gameNow();osakaResult=playOsaka(db,user.id,osakaRules,osakaCatalog,{mode:data.mode,requestId:data.requestId,now,today:calendarDay(now,GAME_TIMEZONE)});}
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),osakaResult});
    }

    if(path==="/api/street-fight/play"){
      if(!data||Object.keys(data).some(key=>key!=="requestId"))throw new HttpError(400,"街頭格鬥僅接受請求碼");
      let streetFightResult;
      try{
        const now=gameNow();
        streetFightResult=playStreetFight(db,user.id,{mode:MODE,requestId:data.requestId,now,today:calendarDay(now,GAME_TIMEZONE)});
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),streetFightResult});
    }

    if(path==="/api/c-league/open"){
      if(!getCharacter(user.id))throw new HttpError(409,"請先建立居民");
      if(!data||Object.keys(data).some(k=>k!=="requestId")||typeof data.requestId!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(data.requestId))
        throw new HttpError(400,"C 聯賽請求格式錯誤");
      const opened=cLeagueOverview(db,user.id,gameNow());
      return sendJson(res,200,{...snapshot(user),cLeagueResult:{season:opened.season}});
    }
    if(path==="/api/c-league/train"||path==="/api/c-league/play"){
      const now=gameNow(),today=calendarDay(now,GAME_TIMEZONE);
      let cLeagueResult;
      try{cLeagueResult=path.endsWith("/train")?trainCLeague(db,user.id,data,now,today):playCLeague(db,user.id,data,now,today);}
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),cLeagueResult});
    }

    if(path==="/api/arcade/dice/play"){
      return handleArcadeDice(res,user,data);
    }

    if(path==="/api/arcade/highlow/play"){
      let arcadeHighLowResult;
      try{
        arcadeHighLowResult=playArcadeHighLow(db,user.id,arcadeHighLowSource,{
          guess:data.guess,requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),arcadeHighLowResult});
    }

    if(path==="/api/arcade/donuts/draw"){
      let arcadeDonutResult;
      try{
        arcadeDonutResult=playArcadeDonut(db,user.id,arcadeDonutsSource,{
          mode:data.mode,requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),arcadeDonutResult});
    }

    if(path==="/api/arcade/loto/play"){
      let instantLotoResult;
      try{
        instantLotoResult=playInstantLoto(db,user.id,instantLotoSource,{
          stake:data.stake,chosenDigits:data.chosenDigits,
          requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),instantLotoResult});
    }

    if(path==="/api/arcade/loto6/buy"){
      let loto6TicketResult;
      try{
        loto6TicketResult=buyLoto6Ticket(db,user.id,loto6Source,{
          numbers:data.numbers,random:data.random??false,requestId:data.requestId,
          now:gameNow(),timeZone:GAME_TIMEZONE
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),loto6TicketResult});
    }

    if(path==="/api/arcade/loto6/check"){
      let loto6DrawResult;
      try{
        const now=gameNow();
        if(!loto6Overview(db,user.id,loto6Source,now,GAME_TIMEZONE).available)
          throw new Error("目前城鎮沒有原版遊樂中心");
        loto6DrawResult=settleLoto6Draw(db,loto6Source,{now,timeZone:GAME_TIMEZONE});
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),loto6DrawResult});
    }

    if(path==="/api/arcade/cardw/draw"){
      let multiCardResult;
      try{
        multiCardResult=playMultiCard(db,user.id,multiCardSource,{
          course:data.course,requestId:data.requestId,
          now:gameNow(),solo:MODE==="solo"
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),multiCardResult});
    }

    if(path==="/api/arcade/treasure/open"){
      let treasureResult;
      try{
        treasureResult=openTreasure(db,user.id,treasureSource,{
          boxKey:data.boxKey,requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),treasureResult});
    }

    if(path==="/api/road/start"){
      let roadStartResult;
      try{
        roadStartResult=beginRoadTrip(db,user.id,roadSource,{
          toTownId:data.toTownId,vehicleSourceLine:data.vehicleSourceLine??null,
          byBus:data.byBus??false,requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),roadStartResult});
    }
    if(path==="/api/road/arrive"){
      let roadArrivalResult;
      try{roadArrivalResult=arriveRoadTrip(db,user.id,{tripId:data.tripId,now:gameNow()});}
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),roadArrivalResult});
    }

    if (path === "/api/coupon/redeem") {
      let result;
      try{
        result=redeemEventCoupon(db,user.id,couponCatalog,{
          sourceIndex:data.sourceIndex,originalName:data.originalName,
          requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),couponResult:result});
    }

    if (path === "/api/retail/buy") {
      const now=gameNow();
      let bought;
      try{
        bought=buyRetailItem(db,user.id,data.shop===VENDING_SHOP?vendingCatalog:retailCatalog,{
          shop:data.shop,sku:data.sku,requestId:data.requestId,
          quantity:data.quantity??1,payment:data.payment??"cash",
          cardSourceLine:data.cardSourceLine,
          now,day:calendarDay(now,GAME_TIMEZONE),timeZone:GAME_TIMEZONE,
          hasBuilding:(symbol,townId)=>{
            const map=publicTownMap(db,townId,false);
            return map.configured&&map.cells.some(cell=>cell.key===symbol);
          }
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),retailResult:bought});
    }
    if(path === "/api/b-league/play"){
      let result;
      try{
        if(!data||typeof data!=="object"||Array.isArray(data)||Object.keys(data).some(k=>!["rank","requestId"].includes(k)))
          throw new Error("鬥技場只接受難度與請求編號");
        const now=gameNow();
        result=playArena(db,user.id,arenaCatalog,arenaDrops,{rank:data.rank,requestId:data.requestId,now,today:calendarDay(now,GAME_TIMEZONE),
          hasBuilding:(symbol,townId)=>{
            if(roadOverview(db,user.id,roadSource,now).pending)throw new Error("公路旅程尚未抵達");
            const map=publicTownMap(db,townId,false);
            return map.configured&&map.cells.some(cell=>cell.key===symbol);
          }});
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),bLeagueResult:result});
    }
    if (path === "/api/equipment/buy"||path === "/api/equipment/equip"||
        path === "/api/equipment/sell"||path === "/api/equipment/forge") {
      const now=gameNow();
      const guards={now,requestId:data.requestId,hasBuilding:(symbol,townId)=>{
        const map=publicTownMap(db,townId,false);
        return map.configured&&map.cells.some(cell=>cell.key===symbol);
      }};
      let result;
      try{
        if(path === "/api/equipment/buy")
          result=buyEquipment(db,user.id,equipmentCatalog,{...guards,sku:data.sku});
        else if(path === "/api/equipment/equip")
          result=equipEquipment(db,user.id,{...guards,itemId:data.itemId});
        else if(path === "/api/equipment/sell")
          result=sellEquipment(db,user.id,equipmentCatalog,{...guards,itemId:data.itemId});
        else result=forgeEquipment(db,user.id,{
          ...guards,itemId:data.itemId,powerUp:data.powerUp,usesUp:data.usesUp
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),equipmentResult:result});
    }
    if(path === "/api/mail/send"){
      let result;
      try{
        result=sendPrivateMail(db,user.id,{
          recipientName:data.recipientName,message:data.message,
          requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),mailResult:result});
    }
    if(path === "/api/mail/delete"){
      let result;
      try{result=deletePrivateMailboxEntry(db,user.id,data.mailId);}
      catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),mailResult:result});
    }
    if(path === "/api/gift/convert"||path === "/api/gift/send"){
      const now=gameNow();
      let result;
      try{
        if(path==="/api/gift/convert")
          result=convertToGift(db,user.id,{
            sourceLine:data.sourceLine,quantity:data.quantity??0,
            requestId:data.requestId,now,
            hasBuilding:(symbol,townId)=>{
              const map=publicTownMap(db,townId,false);
              return map.configured&&map.cells.some(cell=>cell.key===symbol);
            }
          });
        else result=sendGift(db,user.id,{
          sourceLine:data.sourceLine,quantity:data.quantity,
          recipientName:data.recipientName,message:data.message,requestId:data.requestId,now
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),giftResult:result});
    }
    if(path==="/api/recycle/sell"||path==="/api/recycle/buy"){
      const now=gameNow();
      const args={requestId:data.requestId,now,
        hasBuilding:(symbol,townId)=>{
          const map=publicTownMap(db,townId,false);
          return map.configured&&map.cells.some(cell=>cell.key===symbol);
        }};
      let outcome;
      try{
        if(path==="/api/recycle/sell")
          outcome=sellToRecycle(db,user.id,{...args,sourceLine:data.sourceLine});
        else outcome=buyFromRecycle(db,user.id,{...args,listingId:data.listingId});
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),recycleResult:outcome});
    }
    if(path==="/api/shop/price"||path==="/api/shop/buy"){
      let result;
      try{
        if(path==="/api/shop/price")
          result=setPlayerStorePrice(db,user.id,{
            houseId:data.houseId,sku:data.sku,price:data.price
          });
        else result=buyPlayerStore(db,user.id,{
          houseId:data.houseId,sku:data.sku,quantity:data.quantity,
          payment:data.payment,cardSourceLine:data.cardSourceLine,
          requestId:data.requestId,now:gameNow()
        });
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),playerStoreResult:result});
    }
    if(path==="/api/shop/config"||
       path==="/api/wholesale/buy"||path==="/api/wholesale/return"){
      const now=gameNow();
      let result;
      try{
        if(path==="/api/shop/config"){
          result=configurePlayerShop(db,user.id,data.houseId,{
            category:data.category,title:data.title,confirmClear:data.confirmClear===true
          },now);
        }else{
          const opts={
            houseId:data.houseId,sku:data.sku,quantity:data.quantity,
            requestId:data.requestId,now,
            hasBuilding:(symbol,townId)=>{
              const map=publicTownMap(db,townId,false);
              return map.configured&&map.cells.some(cell=>cell.key===symbol);
            }
          };
          result=path==="/api/wholesale/buy"?
            buyWholesale(db,user.id,wholesaleCatalog,{
              ...opts,day:calendarDay(now,GAME_TIMEZONE)
            }):
            returnWholesale(db,user.id,{...opts,quantity:data.quantity??0});
        }
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),wholesaleResult:result});
    }
    if (path === "/api/meal/eat") {
      const meal=mealsByKey.get(data.key);
      if (!meal) throw new HttpError(404,"找不到食堂餐點");
      const now=gameNow();
      const result=mutateCharacter(user.id,old=>{
        try {
          // 從原始來源選中的菜單與庫存只能由伺服器認定。
          // 角色扣款與共用庫存扣一份都在 mutateCharacter 的同一筆交易。
          ensureDiningRotation(db,meals,calendarDay(now,GAME_TIMEZONE));
          const eaten=eatMeal(recoverEnergy(old,now),meal,now);
          const remaining=takeDiningStock(db,meal);
          return {...eaten,remaining};
        } catch(error){throw new HttpError(400,error.message);}
      });
      return sendJson(res,200,{...snapshot(user),mealResult:{
        name:result.meal,paid:result.paid,gained:result.gained,
        weightGain:result.weightGain,remaining:result.remaining
      }});
    }

    if (path === "/api/train") {
      const lesson=trainingByKey.get(data.key);
      if(!lesson)throw new HttpError(404,"找不到訓練課程");
      const payment=data.payment??"cash";
      if(!["cash","credit"].includes(payment))
        throw new HttpError(400,"此課程不支援指定付款方式");
      const now=gameNow();
      const today=calendarDay(now,GAME_TIMEZONE);
      let result;
      try{
        if(payment==="credit"){
          // 在任何銀行異動前先驗證本人原版卡片、購買日與剩餘有效天數。
          requireClassroomCreditCard(db,user.id,data.sourceLine,now);
          // 與現有銀行交易一致，先就舊餘額完成當天利息結算。
          settleBankInterest(db,user.id,today,now);
        }
        result=mutateCharacter(user.id,old=>{
          if(payment==="credit")requireClassroomCreditCard(db,user.id,data.sourceLine,now);
          const trained=performTraining(old,lesson,now,today,payment);
          if(payment==="credit")
            // 帳簿和角色餘額一起在 mutateCharacter 的 SQLite 交易內寫入。
            recordBankEntry(db,user.id,"ordinary",
              ({school:"學校",gym:"健身房",classroom:"教室"})[lesson.type]+"信用付款（受講料）",
              lesson.price,0,trained.character.bank,now);
          return trained;
        },()=>refreshBankTaxSnapshot(db,user.id,today));
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),trainingResult:{
        name:result.lesson,gained:result.gained,paid:result.paid,
        weightLoss:result.weightLoss,payment:result.payment
      }});
    }

    if (path === "/api/bank" || path === "/api/bank/term") {
      const now=gameNow();
      const today = calendarDay(now,GAME_TIMEZONE);
      let result;
      try {
        if (path === "/api/bank") {
          result = bankOperation(db,user.id,data.action,data.amount,today,now);
        } else {
          const action = data.action === "deposit" ? "termDeposit" :
            data.action === "cancel" ? "termCancel" : data.action;
          result = bankOperation(db,user.id,action,
            action === "termCancel" ? data.amount : data.units,today,now);
        }
      } catch (error) { throw new HttpError(400,error.message); }
      return sendJson(res, 200, { ...snapshot(user), bankResult: result });
    }

    if (path === "/api/bank/transfer") {
      if (MODE !== "multi") throw new HttpError(403,"單機模式無法轉帳給其他玩家");
      let result;
      try {
        result = transferToPlayer(db,user.id,data.recipientName,data.amount,
          calendarDay(gameNow(),GAME_TIMEZONE),data.requestId);
      } catch(error) { throw new HttpError(400,error.message); }
      return sendJson(res,200,{ ...snapshot(user),transferResult:result });
    }

    if (path === "/api/bank/loan/borrow" || path === "/api/bank/loan/payoff") {
      const now=gameNow();
      const today = calendarDay(now,GAME_TIMEZONE);
      let result;
      try {
        if (path === "/api/bank/loan/borrow") {
          const character = getCharacter(user.id);
          if (!character) throw new Error("請先建立角色");
          const job = jobsByKey.get(character.jobId);
          result = borrowBankLoan(db,user.id,job,data.payments,today,now);
        } else {
          result = payoffBankLoan(db,user.id,today,now);
        }
      } catch (error) { throw new HttpError(400,error.message); }
      return sendJson(res,200,{ ...snapshot(user),loanResult:result });
    }

    if (path === "/api/house/room/config") {
      let result;
      try { result = setRoomSlots(db, user.id, data.houseId, data.slots, gameNow()); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), roomResult: result });
    }

    if (path === "/api/house/room/post") {
      let result;
      try { result = addRoomPost(db, user.id, data.houseId, data.slotIndex, data.body, gameNow()); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), roomResult: result });
    }

    if (path === "/api/house/room/delete") {
      let result;
      try { result = deleteRoomPost(db, user.id, data.houseId, data.postId); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), roomResult: result });
    }

    if (path === "/api/house/build") {
      let result;
      try {
        result = buildHouse(db, houseCatalog, user.id,
          { row: data.row, column: data.column },
          { image: data.image, interiorRank: data.interiorRank, payment: data.payment },gameNow());
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      return sendJson(res, 200, { ...snapshot(user), houseResult: result });
    }

    if (path === "/api/house/remodel") {
      let result;
      try {
        result = remodelHouse(db, houseCatalog, user.id, data.houseId,
          { image: data.image, interiorRank: data.interiorRank },gameNow());
      } catch(error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), houseRemodelResult: result });
    }

    if (path === "/api/house/sell") {
      let result;
      try { result = sellHouse(db, houseCatalog, user.id, data.houseId,gameNow()); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, { ...snapshot(user), houseSaleResult: result });
    }

    if (path === "/api/house/rename") {
      try { renameHouse(db, user.id, data.houseId, data.name); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/solo/map/starter") {
      if (MODE !== "solo") throw new HttpError(403, "只有單機模式可以建立試玩街區");
      const character = getCharacter(user.id);
      if (!character) throw new HttpError(409, "請先建立角色");
      let result;
      try { result = createSoloStarterTown(db, character.townId); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, {...snapshot(user),mapStarterResult:result});
    }
    if (path === "/api/map/tile") {
      if (MODE !== "solo") throw new HttpError(403, "多人模式只能由伺服器管理員匯入街區地圖");
      const character = getCharacter(user.id);
      if (!character) throw new HttpError(409, "請先建立角色");
      try { editTownTile(db, character.townId, data.row, data.column, data.symbol); }
      catch (error) { throw new HttpError(400, error.message); }
      return sendJson(res, 200, snapshot(user));
    }

    if (path === "/api/move") {
      if(roadOverview(db,user.id,roadSource,gameNow()).pending)
        throw new HttpError(400,"公路旅程尚未抵達，不可同時搭乘電車");
      let journey;
      try {
        // mutateCharacter 開啟 BEGIN IMMEDIATE；從伺服器存檔中的 townId
        // 計算原版票價、檢查現金並同筆更新所在地與餘額。
        journey=mutateCharacter(user.id,old=>travelByTrain(old,data.townId));
      }catch(error){throw new HttpError(400,error.message);}
      return sendJson(res,200,{...snapshot(user),travelResult:{
        fromTownId:journey.fromTownId,toTownId:journey.toTownId,fare:journey.fare
      }});
    }
    throw new HttpError(404, "找不到指定的功能");
  } catch (error) {
    if (error?.code?.startsWith("ERR_SQLITE") || /UNIQUE constraint failed/.test(error?.message || "")) {
      return sendJson(res, 409, { error: "資料已存在，請更換名稱" });
    }
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
    if (["請先選擇職業", "身體或頭腦能量不足"].includes(error.message) ||
        error.message?.startsWith("還需要等待") ||
        error.message?.includes("不足") || error.message?.includes("限制") ||
        error.message?.includes("精通")) {
      return sendJson(res, 400, { error: error.message });
    }
    console.error(error);
    return sendJson(res, 500, { error: "伺服器發生錯誤" });
  }
}

const httpServer = createServer(handle);
httpServer.listen(PORT, HOST, () => {
  console.log("TOWN Web [" + MODE + "] http://" + HOST + ":" + httpServer.address().port);
  console.log("已載入職業：" + jobs.length + "，翻譯：" + jobs.filter(job => job.translated).length);
  console.log("原始地圖匯入城鎮：" + (importedTownIds.length ? importedTownIds.join(", ") : "無，保持未設定狀態"));
});
