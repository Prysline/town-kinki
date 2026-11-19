// 依原始 unit.pl 與 town-map.mjs 的建築代碼導航，沒有移植的功能不冒充已支援。
export const FACILITY_PANELS=Object.freeze({
  "銀行":"bank-panel",
  "病院":"hospital-panel",
  "職安":"jobs-panel",
  "教室":"school-panel",
  "食堂":"dining-panel",
  "食堂２":"dining-panel",
  "建築":"housing-panel"
});
const BUILDABLE=new Set(["空地","空地2","空地3","空地4"]);
export function townCellAction(cell) {
  if(!cell||typeof cell!=="object")return {kind:"inspect"};
  if(Number.isSafeInteger(cell.houseId)&&cell.houseId>0)
    return {kind:"house",houseId:cell.houseId};
  if(BUILDABLE.has(cell.key))return {kind:"build",panelId:"housing-panel"};
  if(Object.hasOwn(FACILITY_PANELS,cell.key))
    return {kind:"facility",panelId:FACILITY_PANELS[cell.key]};
  if(["facility","transport","house"].includes(cell.category))
    return {kind:"unavailable"};
  return {kind:"inspect"};
}
