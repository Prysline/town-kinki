// Source-backed SPA adapter: original result pages returning to login_view.
// Repeated facility actions that remain in the facility are not town returns.
const RETURNS=new Set(["login","character","work","job","meal/eat","train","hospital/treat",
  "bank/transfer","bank/loan/borrow","bank/loan/payoff","inventory/legacy/use","house/build","move","road/arrive","onsen/leave"]);
export function shouldReturnToTown(path,data,result){
  return RETURNS.has(path)&&canReturnToTown(result);
}
export function canReturnToTown(result){
  return Boolean(result?.character&&!result.onsen?.active&&!result.roadTravel?.pending);
}
export function returnReceiptKey(path,data={},random=()=>crypto.randomUUID()){
  // Receipt IDs on previously idempotent actions stay stable across lost responses.
  if(path==="road/arrive"&&Number.isSafeInteger(data.tripId))return "stock_road_"+data.tripId;
  if(path==="onsen/leave"&&Number.isSafeInteger(data.visitId))return "stock_onsen_"+data.visitId;
  if(typeof data.requestId==="string"&&/^[A-Za-z0-9_-]{8,40}$/.test(data.requestId))
    return "stock_return_"+path.replaceAll("/","_")+"_"+data.requestId;
  return "stock_return_"+random();
}
