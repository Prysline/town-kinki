// 原版隨機事件描述中的《道具名》是玩家可見文字，必須在 UI 才替換。
// 僅處理可由事件 source 逐一核對的名稱；不改 event.description、獎懲、物品鍵。
import {displayRetailItemName} from "./retail-item-translations.js";
export const EVENT_ONLY_ITEM_NAMES_ZH_TW=Object.freeze({
  "損害保険":"損害保險",
  "幸せの星砂":"幸福星砂"
});
export const displayEventDescription=message=>{
  if(typeof message!=="string")return "";
  return message.replace(/《([^》\n]+)》/g,(full,name)=>{
    const known=displayRetailItemName(name);
    return "《"+(known!==name?known:EVENT_ONLY_ITEM_NAMES_ZH_TW[name]??name)+"》";
  });
};
// 這是固定伺服器錯誤文案的前端顯示翻譯，不更動後端的原始禮品分類鍵。
export const displayGiftErrorMessage=message=>
  message==="只有已轉換或購入的「ギフト」可以寄送"?
    "只有已轉換或購入的「禮品」可以寄送":message;
