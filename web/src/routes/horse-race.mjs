// Feature route, not a second authentication, clock or snapshot authority.
import {quoteHorseRace,enterHorseRace,stepHorseRace} from "../horse-race.mjs";
export function handleHorseRacePost(path,data,{db,user,source,gameNow,todayFor,snapshot,HttpError}){
  const action=path==="/api/horse-race/quote"?quoteHorseRace:
    path==="/api/horse-race/start"?enterHorseRace:
    path==="/api/horse-race/step"?stepHorseRace:null;
  if(!action)return null;
  const now=gameNow(),today=todayFor(now);
  let result;
  try{
    // Do not forward client cash, clock, player, card, odds, RNG or payout.
    result=action(db,user.id,source,{requestId:data.requestId,raceId:data.raceId,
      tickets:data.tickets,expectedTurn:data.expectedTurn,now,today});
  }catch(error){throw new HttpError(400,error.message);}
  return {...snapshot(user),horseRaceResult:result};
}
