// BK-05 transaction projection, independent of DB and HTTP.
// 2026-11-28 user approved own-price cash/bank checks for D/E.
import {STOCK_KEYS,STOCK_LIMIT} from "./stock-source.mjs";
function n(v,min=0){if(!Number.isSafeInteger(v)||v<min)throw Error("股票數值不正確");return v;}
const signed=v=>n(v,Number.MIN_SAFE_INTEGER);
export class StockTradeError extends Error {}
export function emptyStockPortfolio(){return STOCK_KEYS.map(key=>({key,shares:0,lastBuyPrice:0,basis:0,invested:0,recovered:0,net:0}));}
function portfolio(rows){
  if(!Array.isArray(rows)||rows.length!==5)throw Error("持股資料不正確");
  return rows.map((r,i)=>{
    if(r.key!==STOCK_KEYS[i]||n(r.shares)>STOCK_LIMIT)throw Error("持股資料不正確");
    return {key:r.key,shares:r.shares,lastBuyPrice:n(r.lastBuyPrice),basis:n(r.basis),
      invested:n(r.invested),recovered:n(r.recovered),net:signed(r.net)};
  });
}
function pricesOf(prices){
  if(!Array.isArray(prices)||prices.length!==5)throw Error("行情資料不正確");
  return prices.map(p=>n(p));
}
export function stockPortfolioOverview(rows,prices){
  const p=pricesOf(prices), holdings=portfolio(rows).map((r,i)=>({...r,price:p[i],remaining:STOCK_LIMIT-r.shares,
    marketValue:n(p[i]*r.shares),average:r.shares?Math.trunc(r.basis/r.shares):0,
    unrealized:r.shares?signed(p[i]*r.shares-r.basis):0}));
  return {holdings,marketValue:n(holdings.reduce((a,r)=>a+r.marketValue,0)),
    cumulativeNet:signed(holdings.reduce((a,r)=>a+r.net,0))};
}
export function projectStockTrade({rows,prices,cash,bank,action,key,quantity,expired=false}){
  const p=pricesOf(prices),out=portfolio(rows);
  n(cash);n(bank);
  if(action==="clear"){
    const amount=stockPortfolioOverview(out,p).marketValue;
    return {rows:emptyStockPortfolio(),cash:n(cash+amount),bank,record:{action,amount},expired};
  }
  if(!["buy","sell"].includes(action)||!STOCK_KEYS.includes(key))throw new StockTradeError("股票操作不正確");
  if(!Number.isSafeInteger(quantity)||quantity<0)throw new StockTradeError("股票數量須為非負整數");
  if(expired)return {rows:out,cash,bank,record:null,expired:true};
  const i=STOCK_KEYS.indexOf(key),r=out[i],price=p[i];
  const amount=price*quantity;
  if(!Number.isSafeInteger(amount))throw new StockTradeError("股票金額超出安全範圍");
  let record=null;
  if(quantity){
    if(action==="buy"){
      if(r.shares+quantity>STOCK_LIMIT)throw new StockTradeError("超過持股上限");
      if(cash<amount)throw new StockTradeError("現金不足");
      if(bank<amount)throw new StockTradeError("普通存款不足");
      r.shares+=quantity;r.lastBuyPrice=price;r.basis=n(r.basis+amount);
      r.invested=n(r.invested+amount);r.net=signed(r.net-amount);cash-=amount;
    }else{
      if(r.shares<quantity)throw new StockTradeError("持股不足");
      r.shares-=quantity;if(!r.shares)r.lastBuyPrice=0;
      // Original sets remaining basis to current market price, not FIFO or weighted cost.
      r.basis=n(price*r.shares);r.recovered=n(r.recovered+amount);
      r.net=signed(r.net+amount);cash=n(cash+amount);
    }
    // Original computes the history projection BEFORE zeroing closed position counters.
    const marketValue=stockPortfolioOverview(out,p).marketValue;
    const projectedNet=signed(marketValue-out.reduce((a,h)=>a+h.invested,0)+out.reduce((a,h)=>a+h.recovered,0));
    record={action,key,quantity,price,amount,projectedNet};
  }
  for(const h of out)if(h.shares===0){h.invested=0;h.recovered=0;}
  return {rows:out,cash,bank,record,expired:false};
}
