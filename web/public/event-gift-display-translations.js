// 原版隨機事件描述中的《道具名》是玩家可見文字，必須在 UI 才替換。
// 僅處理可由事件 source 逐一核對的名稱；不改 event.description、獎懲、物品鍵。
import {displayRetailItemName} from "./retail-item-translations.js";
// 已存在的事件歷史可能保留舊譯名及括號內原文；只處理六種確定的系統獎品格式。
const SANTA_LEGACY_LABELS=Object.freeze({
  "惡魔之笛":"悪魔の笛","天使之笛":"天使の笛","四次元福袋":"４次元福袋",
  "等身大聖誕老人偶":"等身大サンタさん人形","真人大小聖誕老人玩偶":"等身大サンタさん人形",
  "一日份聖誕蛋糕":"クリスマスケーキ１日分","一整隻馴鹿肉":"トナカイの肉１匹分"
});
export const EVENT_ONLY_ITEM_NAMES_ZH_TW=Object.freeze({
  "損害保険":"損害保險",
  "幸せの星砂":"幸福星砂"
});
export const displayEventDescription=message=>{
  if(typeof message!=="string")return "";
  const awarded=/^擊敗聖誕老人，獲得([^（）]+)（([^（）]+)），耐久增加 (\d+) 次。$/.exec(message);
  if(awarded&&Object.hasOwn(SANTA_LEGACY_LABELS,awarded[1])&&SANTA_LEGACY_LABELS[awarded[1]]===awarded[2])
    return "擊敗聖誕老人，獲得"+displayRetailItemName(awarded[2])+"，耐久增加 "+awarded[3]+" 次。";
  const other=/^(擊敗聖誕老人，(?:但持有物已達 25 格，未取得|抽中))([^。]+)。$/.exec(message);
  if(other&&Object.hasOwn(SANTA_LEGACY_LABELS,other[2]))
    return other[1]+displayRetailItemName(SANTA_LEGACY_LABELS[other[2]])+"。";
  return message.replace(/《([^》\n]+)》/g,(full,name)=>{
    const known=displayRetailItemName(name);
    return "《"+(known!==name?known:EVENT_ONLY_ITEM_NAMES_ZH_TW[name]??name)+"》";
  });
};
// 這是固定伺服器錯誤文案的前端顯示翻譯，不更動後端的原始禮品分類鍵。
export const displayGiftErrorMessage=message=>
  message==="只有已轉換或購入的「ギフト」可以寄送"?
    "只有已轉換或購入的「禮品」可以寄送":message;
