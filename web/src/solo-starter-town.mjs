// 第50階段：原版 log_dir/townlog0～3.cgi 在此 fork 皆是空檔。
// 單機玩家可自行建立 Web「試玩用」街區，不能宣稱它是原版歷史街區。
import { TOWNS } from "./engine.mjs";
import { emptyTownMap, MAP_SYMBOLS } from "./town-map.mjs";
import { readTownMap, storeTownMap } from "./town-storage.mjs";

// 只選已知原版 unit.pl／town-map.mjs 建築代碼，且有真正 Web 操作。
// 不放置原版未實作建築、虛構的 NPC 或冒充已匯入的地圖。
const SYMBOLS=[
  ["駅","職安","銀行","病院"],
  ["食堂","食堂２","デパ","デパ2","温泉"],
  ["自販機","装備屋","教室","建築"],
  ["空地","空地2","リサイ","空地3","クーポン","販売1","釣り","合成","ゲーセン"]
];
const known=new Set(MAP_SYMBOLS.map(symbol=>symbol.key));
if(SYMBOLS.some(row=>row.some(symbol=>!known.has(symbol))))
  throw new Error("單機試玩街區引用了未知的原版建築代碼");
export const SOLO_STARTER_LAYOUT=Object.freeze(
  SYMBOLS.flatMap((row,r)=>row.map((symbol,c)=>Object.freeze({
    row:r,column:c,symbol
  })))
);

export function createSoloStarterTown(db,townId){
  if(!TOWNS.some(town=>town.id===townId))
    throw new Error("不存在的城鎮");
  db.exec("BEGIN IMMEDIATE");
  try{
    // 即使是一張全空的已編輯地圖，也不可擅自覆寫玩家先前的選擇。
    if(readTownMap(db,townId).configured)
      throw new Error("這座城鎮已有街區配置，不能用試玩配置覆蓋");
    // 保護任何因舊版匯入或破損資料而尚未建立 town_maps 的房屋。
    if(db.prepare("SELECT 1 FROM houses WHERE town_id=? LIMIT 1").get(townId))
      throw new Error("這座城鎮已有住宅，不能初始化試玩街區");
    const tiles=emptyTownMap();
    for(const {row,column,symbol} of SOLO_STARTER_LAYOUT)
      tiles[row*16+column]=symbol;
    storeTownMap(db,townId,{
      tiles,originalName:TOWNS[townId].originalName,originalRecord:""
    },"web-solo-starter");
    db.exec("COMMIT");
    return {townId,placed:SOLO_STARTER_LAYOUT.length,source:"web-solo-starter"};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
