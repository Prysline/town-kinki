// GM-02: original basic.cgi::keiba rules only. No HTTP, money or persistence authority.
import {randomInt} from "node:crypto";

export const HORSE_TICKET_PRICE=500;
export const HORSE_TICKET_LIMIT=200;
export const HORSE_MAX_BET_ENTRIES=2;
export const HORSE_FINISH_DISTANCE=400;
export const HORSE_LOCK_SECONDS=180;

export function parseHorseRaceSource(basic,ini){
  const list=(key)=>{
    const match=basic.match(new RegExp("my \\(@"+key+"\\)=\\(([^\\n]+)\\);"));
    if(!match)throw new Error("競馬來源清單缺失");
    return [...match[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
  };
  const names=list("umaname"), odds=list("umakakeritu").map(Number);
  if(names.length!==15||new Set(names).size!==15||
     odds.length!==9||odds.join(",")!=="8,28,2,12,16,4,30,3,5"||
     !/\$keiba_gendomaisuu\s*=\s*'200'/.test(ini)||
     !basic.includes("$mtime < time - 180"))
    throw new Error("競馬來源規則不一致");
  return Object.freeze({names:Object.freeze(names),odds:Object.freeze(odds)});
}
const nativeRand=bound=>randomInt(2**32)/2**32*bound;
function draw(rand,bound){
  const n=rand(bound);
  if(!Number.isFinite(n)||n<0||n>=bound)throw new Error("競馬亂數超出來源範圍");
  return n;
}
function shuffle(list,rand){
  const out=[];
  for(const value of list){
    // Perl: push(@out,$out[$r]); $out[$r]=$_; r=int(rand(length+1)).
    const i=Math.trunc(draw(rand,out.length+1));
    out.push(out[i]);
    out[i]=value;
  }
  return out;
}
export function drawHorseRaceCard(source,rand=nativeRand){
  const names=shuffle(source.names,rand), odds=shuffle(source.odds,rand);
  return names.slice(0,6).map((name,i)=>({name,odds:odds[i]}));
}
function validateCard(source,card){
  if(!Array.isArray(card)||card.length!==6||
     new Set(card.map(x=>x?.name)).size!==6||
     new Set(card.map(x=>x?.odds)).size!==6||
     card.some(x=>!source.names.includes(x?.name)||!source.odds.includes(x?.odds)))
    throw new Error("競馬出賽名單不符原版來源");
}
function safeAmount(n){
  if(!Number.isSafeInteger(n)||n<0)throw new Error("競馬金額超出安全範圍");
  return n;
}
// Valid start/go calls in original CGI reshuffle both lists before the command branch.
// Their results are discarded; preserve the 24 RNG draws, without trusting browser odds.
export function startHorseRace(source,card,tickets,cash,rand=nativeRand){
  validateCard(source,card);
  if(!Array.isArray(tickets)||tickets.length!==6||
     tickets.some(n=>!Number.isSafeInteger(n)||n<0))
    throw new Error("馬券購買數不正確");
  safeAmount(cash);
  drawHorseRaceCard(source,rand);
  const horses=card.map((h,i)=>({...h,tickets:tickets[i],
    distance:Math.trunc((draw(rand,60)+10)/(1+h.odds/70))}));
  const total=safeAmount(tickets.reduce((a,b)=>a+b,0));
  const cost=safeAmount(total*HORSE_TICKET_PRICE);
  if(cost===0)throw new Error("尚未購買馬券");
  if(cash<cost)throw new Error("現金不足");
  if(total>HORSE_TICKET_LIMIT)throw new Error("超過馬券張數上限");
  if(tickets.filter(n=>n>0).length>HORSE_MAX_BET_ENTRIES)throw new Error("最多投注兩匹馬");
  return {horses,cost};
}
export function advanceHorseRace(source,horses,rand=nativeRand){
  validateCard(source,horses);
  if(horses.some(h=>!Number.isSafeInteger(h.tickets)||h.tickets<0||
     !Number.isInteger(h.distance)||h.distance<0||h.distance>=HORSE_FINISH_DISTANCE))
    throw new Error("競馬回合資料不正確或已結束");
  const total=safeAmount(horses.reduce((a,h)=>a+h.tickets,0));
  if(total===0||total>HORSE_TICKET_LIMIT||horses.filter(h=>h.tickets>0).length>2)
    throw new Error("競馬持久化馬券資料不正確");
  drawHorseRaceCard(source,rand);
  const next=horses.map(h=>({...h,distance:Math.min(HORSE_FINISH_DISTANCE,
    h.distance+Math.trunc(draw(rand,100)/(1+h.odds/80)))}));
  const finishers=next.filter(h=>h.distance===HORSE_FINISH_DISTANCE);
  const winner=finishers.length===0?null:finishers.length===1?finishers[0]:
    finishers[Math.trunc(draw(rand,finishers.length))];
  return {horses:next,finished:winner!==null,winner:winner?.name??null,
    finishers:finishers.map(h=>h.name),cost:total*HORSE_TICKET_PRICE,
    payout:winner===null?null:safeAmount(winner.odds*winner.tickets*HORSE_TICKET_PRICE)};
}
