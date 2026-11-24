// event.pl::get_itm2, event #38；原始 7 筆中 int(rand(6)) 僅能選前 6 筆。
// 保留來源 33 欄（包括原始錯置的文字欄）；實際入手時依 CGI 覆寫購入時間。
import {heldInventoryRows,inventoryLife} from "./inventory-life.mjs";
export const SANTA_FIGHT_ITEM_ORIGIN="__web_event38__";
export const SANTA_FIGHT_SLOT_LIMIT=25;
export const SANTA_FIGHT_SOURCE_ROWS=Object.freeze([["ゲットアイテム","悪魔の笛","0","0","0","0","0","0","0","無","0","0","0","0","0","0","0","0","0","0","0","5","回","10","5","0","","","0","何が起こるのだろう？","0","0","0"],["ゲットアイテム","天使の笛","0","0","0","0","0","0","0","無","0","0","0","0","0","0","0","0","0","0","0","5","回","10","5","0","","","0","何が起こるのだろう？","0","0","0"],["ゲットアイテム","４次元福袋","1","1","1","1","1","1","1","無","1","1","1","1","1","1","1","10000","1","1","5","10","回","30","0","0","","","","","クリスマスプレゼントです","",""],["ゲットアイテム","等身大サンタさん人形","1","1","1","1","1","1","1","無","1","1","1","1","1","1","1","10000","1","1","5","10","回","30","0","0","","","","","クリスマスプレゼントです","",""],["ゲットアイテム","クリスマスケーキ１日分","1","1","1","1","1","1","1","ウエイトアップ,1,食料品","1","1","1","1","1","1","1","10000","1","1","2","1","回","30","0","100","","","","","クリスマスプレゼントです","",""],["ゲットアイテム","トナカイの肉１匹分","0","0","0","0","0","0","0","無","2","2","2","2","2","2","2","1000","2","2","2","1","回","30","0","10","","","","","クリスマスプレゼントです","",""],["ゲットアイテム","巨大クリスマスツリー","1","1","1","1","1","1","1","無","1","1","1","1","1","1","1","10000","1","1","50","1","回","1","0","0","","","","クリスマスプレゼントです","","",""]].map(Object.freeze));
export const SANTA_FIGHT_ITEMS=Object.freeze(SANTA_FIGHT_SOURCE_ROWS.slice(0,6));
export const SANTA_FIGHT_NAMES=Object.freeze(["惡魔之笛","天使之笛","四次元福袋","等身大聖誕老人偶","一日份聖誕蛋糕","一整隻馴鹿肉"]);
// 呼叫者必須持有事件交易。原版先檢查全部持有列 >=25，即使是同名合併也拒絕。
// Web 用既有背包生命週期排除已移除的歷史封存列；仍在冷卻顯示的零耐久列算一格。
export function grantSantaFightItem(db,userId,index,now){
  if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(now)||now<0||
    !Number.isInteger(index)||index<0||index>=SANTA_FIGHT_ITEMS.length)throw Error("聖誕戰鬥獎池參數無效");
  const raw=SANTA_FIGHT_ITEMS[index],name=raw[1],category=raw[0],amount=Number(raw[21]);
  const rows=heldInventoryRows(db,userId,now);
  const base={name,label:SANTA_FIGHT_NAMES[index],index,amount};
  if(rows.length>=SANTA_FIGHT_SLOT_LIMIT)return {...base,status:"full",items:[]};
  const matching=rows.filter(row=>row.category===category&&row.original_name===name);
  const items=[];
  if(matching.length){
    // CGI 對每筆同種類同名列都累加；Web 用 sidecar 保存實際耐久，不改寫原始 33 欄。
    for(const row of matching){
      const fields=JSON.parse(row.raw_fields_json);
      if(!Array.isArray(fields)||fields.length!==33||fields[0]!==category||fields[1]!==name||
        row.durability_unit!=="回"||fields[22]!=="回"||fields[21]!==String(row.durability))throw Error("同名事件獎品欄位不一致");
      const remaining=inventoryLife(row,now).remaining+amount;
      const lastUsedAt=row.last_used_at_ms??((row.last_used_at??0)*1000);
      if(!Number.isSafeInteger(remaining)||!Number.isSafeInteger(lastUsedAt)||lastUsedAt<0)throw Error("事件獎品耐久超出安全範圍");
      db.prepare("INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms) VALUES(?,?,?,?) ON CONFLICT(user_id,source_line) DO UPDATE SET remaining=excluded.remaining,last_used_at_ms=excluded.last_used_at_ms").run(userId,row.source_line,remaining,lastUsedAt);
      items.push({sourceLine:row.source_line,remaining,merged:true});
    }
  }else{
    const max=db.prepare("SELECT COALESCE(MAX(source_line),0) AS n FROM legacy_inventory_items WHERE user_id=?").get(userId).n;
    const sourceLine=Math.max(8000000,max+1),purchase=Math.floor(now/1000);
    if(!Number.isSafeInteger(sourceLine))throw Error("事件獎品行號超出安全範圍");
    const fields=[...raw];fields[30]=String(purchase);fields[32]=""; // CGI split 為 tokubai、寫出 tokubai0（未設）。
    db.prepare("INSERT INTO legacy_inventory_items(user_id,original_id,source_line,category,original_name,effect,durability,durability_unit,purchased_at,last_used_at,raw_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(userId,SANTA_FIGHT_ITEM_ORIGIN,sourceLine,category,name,raw[9],amount,raw[22],purchase,0,JSON.stringify(fields));
    items.push({sourceLine,remaining:amount,merged:false});
  }
  return {...base,status:"awarded",items};
}
