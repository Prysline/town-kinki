// BK-05 source-only model: original event.pl market movement and kabu.cgi access.
// No seed policy, persistence, user balance, trigger frequency, or guest authority.
import {randomInt} from "node:crypto";
export const STOCK_KEYS=Object.freeze(["A","B","C","D","E"]);
export const STOCK_LIMIT=200;
export const STOCK_ACCESS_SECONDS=180;
export function parseStockSource(event,kabu){
  const bootstrap=event.match(/\$kab_dat = "(\d+)<>(\d+)<>(\d+)<>(\d+)<>(\d+)<>0<>''<>\\n";/);
  if(!bootstrap||!/\$konu_jogen\s*=\s*200;/.test(kabu)||
    !/\$koniyu_kyka\s*=\s*3\s*\*\s*60;/.test(kabu)||
    !event.includes('if (!(-e "./log_dir/kab_hendou_b.cgi"))')||
    !event.includes('int(rand(10 * ($#all_guest+1)))')||
    !event.includes('int(rand(20*($#all_guest+1)))'))
    throw Error("股票原版來源不一致");
  return {bootstrapPrices:bootstrap.slice(1).map(Number),holdingLimit:STOCK_LIMIT,accessSeconds:STOCK_ACCESS_SECONDS};
}
function integer(n,min=0){
  if(!Number.isSafeInteger(n)||n<min)throw Error("股票數值超出安全範圍");
  return n;
}
function validate(market){
  if(!market||!Array.isArray(market.prices)||market.prices.length!==5)throw Error("股票行情格式不正確");
  return {prices:market.prices.map(n=>integer(n)),tradeCount:integer(market.tradeCount),tradeUntil:integer(market.tradeUntil)};
}
const nativeRand=n=>randomInt(2**32)/2**32*n;
function draw(rand,bound){
  // Perl rand(0) acts as rand(1); int remains 0. Retain the call.
  const effective=bound||1,n=rand(effective);
  if(!Number.isFinite(n)||n<0||n>=effective)throw Error("股票亂數超出來源範圍");
  return Math.trunc(n);
}
export function projectStockAccess(market,nowSeconds){
  const state=validate(market);integer(nowSeconds);
  return {...state,expired:nowSeconds>state.tradeUntil,tradeCount:integer(state.tradeCount+1),
    tradeUntil:integer(nowSeconds+STOCK_ACCESS_SECONDS)};
}
export function projectStockMarketTick(market,guestCount,nowSeconds,rand=nativeRand){
  const state=validate(market);integer(guestCount);integer(nowSeconds);
  integer(20*guestCount);
  if(state.tradeCount>0&&state.tradeUntil>=nowSeconds)return {...state,event:null};
  const next=[...state.prices];
  const economy=draw(rand,10*guestCount);
  let event=null;
  if(economy===1||economy===2){
    const magnitude=draw(rand,100)+1;
    const changes=next.map((price,i)=>{
      const delta=economy===1?Math.min(2500,Math.trunc(price*(magnitude/1000)*1.11111)):
        -Math.trunc(price*(magnitude/1000));
      next[i]=integer(price+delta);
      const acquired=economy===2&&next[i]<250;
      if(acquired)next[i]=10000;
      return {key:STOCK_KEYS[i],delta,acquired};
    });
    event={kind:economy===1?"boom":"recession",magnitude,changes};
  }else{
    const product=draw(rand,20*guestCount);
    if(product>=1&&product<=10){
      const magnitude=(draw(rand,50)+1)/10,i=Math.floor((product-1)/2),price=next[i];
      const success=product%2===1;
      const delta=success?Math.min(1000,Math.trunc(price*(0.05+magnitude/100)*1.11111)+10):
        -Math.trunc(price*(0.05+magnitude/100));
      next[i]=integer(price+delta);
      event={kind:success?"product-success":"product-failure",magnitude,changes:[{key:STOCK_KEYS[i],delta,acquired:false}]};
    }
  }
  return {...state,prices:next,tradeCount:event?0:state.tradeCount,event};
}
