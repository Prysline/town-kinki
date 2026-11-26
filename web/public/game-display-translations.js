// 僅轉換顯示值；職業原名、API 錯誤文字及帳簿原始交易內容維持原樣。
import {displayRetailItemName} from "./retail-item-translations.js";
export function displayJobName(name,jobs=[]){
  return jobs.find(job=>job.originalName===name)?.name??name;
}
const SHOP_ERRORS=Object.freeze({
  "住宅室內未啟用「お店」內容，無法經營商店":"住宅室內未啟用「玩家商店」內容，無法經營商店",
  "請先在住宅室內設定「お店」欄位":"請先在住宅室內設定「玩家商店」欄位"
});
export function displayGameError(message,jobs=[]){
  if(typeof message!=="string")return message;
  const prefix="需先精通：";
  if(message.startsWith(prefix))return prefix+displayJobName(message.slice(prefix.length),jobs);
  return Object.hasOwn(SHOP_ERRORS,message)?SHOP_ERRORS[message]:message;
}
// 只處理已核對的系統帳簿格式，不翻譯玩家姓名、轉帳對象或未知歷史內容。
const LEDGER_PREFIXES=Object.freeze({
  "問屋進貨：":"問屋進貨：","問屋退貨：":"問屋退貨：",
  "玩家商店信用付款：":"玩家商店信用付款：","店鋪出售：":"店鋪出售：",
  "百貨信用付款：":"百貨信用付款：","自販機信用付款：":"自動販賣機信用付款："
});
export function displayBankLedgerAction(action){
  if(typeof action!=="string")return action;
  for(const [prefix,label] of Object.entries(LEDGER_PREFIXES)){
    if(action.startsWith(prefix))return label+displayRetailItemName(action.slice(prefix.length));
  }
  // 課程名稱為固定系統文案，舊帳簿也保留原始內容。
  if(/^(學校|健身房|教室)信用付款（受講料）$/.test(action))
    return action.replace("（受講料）","（學費）");
  return action;
}
