// 工作領域 HTTP handler；既有權限、時鐘、資料庫及交易邊界由 server 保持。
import {selectJob,performWork} from "../engine.mjs";
import {calendarDay} from "../training.mjs";
import {settleBankInterest,recordBankEntry} from "../banking.mjs";

export function createJobsRoutes({db,jobsByKey,gameNow,GAME_TIMEZONE,mutateCharacter,snapshot,sendJson,HttpError}){
  function handleJob(res,user,data) {
    const job = jobsByKey.get(data.key);
    if (!job) throw new HttpError(404, "找不到職業");
    mutateCharacter(user.id, old => ({ character: selectJob(old, job) }));
    return sendJson(res, 200, snapshot(user));
  }

  function handleJobPayment(res,user,data) {
    if(!["cash","bank"].includes(data.payment))
      throw new HttpError(400,"薪資收款方式必須是現金或普通存款");
    mutateCharacter(user.id,old=>({
      character:{...old,salaryPayment:data.payment}
    }));
    return sendJson(res,200,snapshot(user));
  }

  function handleWork(res,user,data) {
    const now=gameNow();
    const today=calendarDay(now,GAME_TIMEZONE);
    let result;
    try {
      // 工作入帳前先以原有銀行存款結清本日利息。
      // 不讓新入帳薪水在同一天第一次查詢時額外生息。
      settleBankInterest(db,user.id,today,now);
      result=mutateCharacter(user.id,old=>{
        const result=performWork(old,jobsByKey.get(old.jobId),now);
        if(result.payment==="bank"){
          // 與角色銀行餘額更新在同一個 SQLite 交易中，不會單獨留下帳簿紀錄。
          // 原版 bonus 先於 salary 記帳：兩筆分開，方便核對。
          if(result.bonus>0)
            recordBankEntry(db,user.id,"ordinary","升級獎金",0,
              result.bonus,old.bank+result.bonus,now);
          if(result.paid>0)
            recordBankEntry(db,user.id,"ordinary","工作薪資",0,
              result.paid,result.character.bank,now);
        }
        return result;
      },undefined,"work");
    } catch(error){throw new HttpError(400,error.message);}
    return sendJson(res, 200, { ...snapshot(user), result: {
      paid: result.paid, pending: result.pending,
      payEvery:jobsByKey.get(result.character.jobId).payEvery,
      worksUntilPayday:jobsByKey.get(result.character.jobId).payEvery-result.pending,
      experienceGain: result.experienceGain, condition:result.condition,
      jobLevel: result.jobLevel,
      leveledUp: result.leveledUp, bonus: result.bonus, mastered: result.mastered,
      payment:result.payment
    } });
  }

  return {handleJob,handleJobPayment,handleWork};
}
