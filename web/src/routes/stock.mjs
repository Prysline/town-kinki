// Authenticated server composition owns clock, caller, same-origin and response.
import {accessStockMarket,stockOverview,stockTownReturn} from "../stock-market.mjs";
export function handleStockPost(path,data,{db,user,gameNow,todayFor,snapshot,HttpError}){
  const now=gameNow();
  if(path==="/api/town/return"){
    let result;
    try{result=stockTownReturn(db,user.id,{now,requestId:data.requestId});}
    catch(error){throw new HttpError(400,error.message);}
    // Only the market delta. No second resident snapshot/daily settlement on a return.
    return {stock:stockOverview(db,user.id),stockReturnResult:result};
  }
  if(path==="/api/stock/access"){
    let result;
    try{result=accessStockMarket(db,user.id,{action:data.action,key:data.key,quantity:data.quantity,
      requestId:data.requestId,now,today:todayFor(now)});}
    catch(error){throw new HttpError(400,error.message);}
    return {...snapshot(user),stockResult:result};
  }
  return null;
}
