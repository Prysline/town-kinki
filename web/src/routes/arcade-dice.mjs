// 既有 POST 骰子 handler；認證、Origin、入浴 guard 與資料庫仍由 server 組裝。
import {playArcadeDice} from "../arcade-dice.mjs";

export function createArcadeDiceRoute({db,arcadeDiceSource,gameNow,snapshot,sendJson,HttpError}){
  return function handleArcadeDice(res,user,data){
    let arcadeDiceResult;
    try{
      arcadeDiceResult=playArcadeDice(db,user.id,arcadeDiceSource,{
        guess:data.guess,stake:data.stake,
        requestId:data.requestId,now:gameNow()
      });
    }catch(error){throw new HttpError(400,error.message);}
    return sendJson(res,200,{...snapshot(user),arcadeDiceResult});
  };
}
