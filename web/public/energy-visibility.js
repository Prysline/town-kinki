// 固定能量列是否需要顯示：依「原本可看到的能量數值」離開視窗判定，
// 而不是等到整個地圖／設施區都捲完。純函式便於測試不同捲動位置。
export function shouldShowCompactEnergy({gameVisible,hasCharacter,statusView,bodyRowBottom,profileTabsBottom}){
  if(!gameVisible||!hasCharacter)return false;
  // 狀態頁：身體能量一離開視窗，就用固定列補上身體與頭腦資訊。
  // 物品／能力頁：狀態本來不可見，等右側頁籤也捲出畫面再顯示。
  return statusView ? bodyRowBottom<=0 : profileTabsBottom<=0;
}
