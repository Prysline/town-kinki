import { randomInt } from "node:crypto";
import { STAT_KEYS, recoverEnergy } from "./engine.mjs";
import { getCouponBalance } from "./events.mjs";
import { refreshBankTaxSnapshot } from "./banking.mjs";

export const STREET_COOLDOWN_MS = 5000;
export const STREET_MAX_LOSS = 15000;
// game.cgi::kougekinaiyou: 健康沒有獨立攻擊；LOVE 是精神傷害。
export const STREET_ATTACKS = Object.freeze([
  ["kokugo","brain","漢字問答"], ["suugaku","brain","數學難題"],
  ["rika","brain","理科公式"], ["syakai","brain","歷史問答"],
  ["eigo","brain","英語對話"], ["ongaku","brain","音階問答"],
  ["bijutu","brain","繪畫比試"], ["looks","brain","外貌比試"],
  ["tairyoku","body","體力比試"], ["speed","body","快速步法"],
  ["power","body","摔投"], ["wanryoku","body","拳擊"],
  ["kyakuryoku","body","踢擊"], ["love","brain","炫耀戀人"],
  ["unique","body","笑話突襲"], ["etti","body","秘密技巧"]
].map(([stat,target,label],i)=>Object.freeze({id:i+1,stat,target,label})));

function draw(randomIndex,n){
  const value=randomIndex(n);
  if(!Number.isSafeInteger(value)||value<0||value>=n)throw new Error("街頭格鬥亂數超出範圍");
  return value;
}
function statsOf(stats){
  if(!stats||STAT_KEYS.some(k=>!Number.isSafeInteger(stats[k])||stats[k]<0))
    throw new Error("街頭格鬥能力資料無效");
  return Object.fromEntries(STAT_KEYS.map(k=>[k,stats[k]]));
}
export function streetOpponentEnergy(stats){
  const s=statsOf(stats);
  return {
    body:Math.trunc(s.looks/12+s.tairyoku/4+s.kenkou/4+s.speed/8+s.power/8+s.wanryoku/8+s.kyakuryoku/8),
    brain:Math.trunc(s.kokugo/6+s.suugaku/6+s.rika/6+s.syakai/6+s.eigo/6+s.ongaku/6+s.bijutu/6)
  };
}
// 原版 rand($#array) 保留：最後一列不參與，抽到自己就無對手。
// SQLite 沒有舊名單檔，採角色建立 ID 順序；不讀取舊玩家名單。
export function chooseStreetOpponent(rows,userId,randomIndex=randomInt){
  if(rows.length<2)return null;
  const candidate=rows[draw(randomIndex,rows.length-1)];
  return candidate.user_id===userId?null:candidate;
}
export function simulateStreetFight(player,opponent,randomIndex=randomInt){
  const a=statsOf(player.stats),b=statsOf(opponent.stats);
  const mine={body:player.bodyEnergy,brain:player.brainEnergy};
  if(Object.values(mine).some(n=>!Number.isSafeInteger(n)||n<0))
    throw new Error("街頭格鬥能量資料無效");
  const theirs=streetOpponentEnergy(b);
  const initial={player:{...mine},opponent:{...theirs}};
  let playerTurn=a.speed>b.speed, outcome="draw", reason=null;
  const rounds=[];
  for(let i=1;i<=50;i++){
    const attack=STREET_ATTACKS[draw(randomIndex,16)];
    const damage=Math.max(0,(playerTurn?a:b)[attack.stat]-(playerTurn?b:a)[attack.stat]);
    (playerTurn?theirs:mine)[attack.target]-=damage;
    rounds.push({turn:i,attacker:playerTurn?"player":"opponent",attackId:attack.id,
      label:attack.label,stat:attack.stat,target:attack.target,damage,
      player:{...mine},opponent:{...theirs}});
    // 原版先攻擊，才依對手身體、對手頭腦、本人身體、本人頭腦順序判定。
    if(theirs.body<=0){outcome="win";reason="body";break;}
    if(theirs.brain<=0){outcome="win";reason="brain";break;}
    if(mine.body<=0){outcome="loss";reason="body";break;}
    if(mine.brain<=0){outcome="loss";reason="brain";break;}
    playerTurn=!playerTurn;
  }
  const delta=outcome==="win"?rounds.length*1500:outcome==="loss"?-rounds.length*300:0;
  const coupons=outcome==="win"&&draw(randomIndex,10)===0?draw(randomIndex,5)+1:0;
  const kpointDelta=draw(randomIndex,10)===0?-3:0;
  return {outcome,reason,rounds,initial,delta,coupons,kpointDelta,
    bodyEnergy:Math.max(0,mine.body),brainEnergy:Math.max(0,mine.brain)};
}
export function initStreetFightTables(db){
  db.exec(`CREATE TABLE IF NOT EXISTS street_fights(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, played_at INTEGER NOT NULL, result_json TEXT NOT NULL,
    UNIQUE(user_id,request_id));
    CREATE INDEX IF NOT EXISTS street_fights_user_idx ON street_fights(user_id,id);`);
}
function history(db,userId){
  return db.prepare("SELECT result_json FROM street_fights WHERE user_id=? ORDER BY id DESC LIMIT 20")
    .all(userId).map(row=>JSON.parse(row.result_json));
}
function readyAt(db,userId){
  const row=db.prepare("SELECT played_at FROM street_fights WHERE user_id=? ORDER BY id DESC LIMIT 1").get(userId);
  return row?row.played_at+STREET_COOLDOWN_MS:0;
}
export function streetFightOverview(db,userId,mode){
  const actor=db.prepare("SELECT money FROM characters WHERE user_id=?").get(userId);
  const residents=mode==="multi"?db.prepare("SELECT COUNT(*) AS n FROM characters WHERE user_id<>?").get(userId).n:0;
  return {available:mode==="multi"&&!!actor&&residents>0,eligibleResidents:residents,
    minCash:STREET_MAX_LOSS,readyAt:readyAt(db,userId),history:history(db,userId)};
}
export function playStreetFight(db,userId,{mode,requestId,now,today,randomIndex=randomInt}={}){
  if(mode!=="multi")throw new Error("單機沒有可驗證的原版街頭格鬥對手");
  if(!Number.isSafeInteger(userId)||userId<1||typeof requestId!=="string"||
     !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)||!Number.isSafeInteger(now)||now<=0)
    throw new Error("街頭格鬥請求格式錯誤");
  db.exec("BEGIN IMMEDIATE");
  try{
    const old=db.prepare("SELECT result_json FROM street_fights WHERE user_id=? AND request_id=?").get(userId,requestId);
    if(old){db.exec("COMMIT");return {...JSON.parse(old.result_json),replayed:true};}
    const actor=db.prepare("SELECT user_id,name,money,kpoint,stats_json,body_energy,brain_energy,recovered_at FROM characters WHERE user_id=?").get(userId);
    if(!actor)throw new Error("請先建立角色");
    if(now<readyAt(db,userId))throw new Error("街頭格鬥尚在 5 秒行動間隔");
    const rows=db.prepare("SELECT c.user_id,c.name,c.stats_json FROM characters c JOIN users u ON u.id=c.user_id ORDER BY c.id").all();
    if(rows.length<2)throw new Error("沒有其他已建立角色的居民");
    // Web 現金不得為負（銀行稅務/薪資契約）；抽選前拒絕，不能看結果再免費重抽。
    // 原版可扣成負現金；此保護門檻為明示的相容性限制，待確認是否另行支援負現金。
    if(!Number.isSafeInteger(actor.money)||actor.money<STREET_MAX_LOSS)
      throw new Error("Web 現金安全限制：街頭格鬥需備妥最高敗北損失 15,000 元");
    const opponent=chooseStreetOpponent(rows,userId,randomIndex);
    let result={outcome:"noOpponent",playedAt:now};
    if(opponent){
      const playerStats=statsOf(JSON.parse(actor.stats_json));
      const opponentStats=statsOf(JSON.parse(opponent.stats_json));
      const current=recoverEnergy({stats:playerStats,bodyEnergy:actor.body_energy,
        brainEnergy:actor.brain_energy,recoveredAt:actor.recovered_at},now);
      const fight=simulateStreetFight(current,{stats:opponentStats},randomIndex);
      const cash=actor.money+fight.delta,kpoint=actor.kpoint+fight.kpointDelta;
      if(!Number.isSafeInteger(cash)||cash<0||!Number.isSafeInteger(kpoint))
        throw new Error("街頭格鬥結算超出安全整數範圍");
      if(fight.coupons){
        const balance=getCouponBalance(db,userId)+fight.coupons;
        if(!Number.isSafeInteger(balance))throw new Error("優惠券餘額超出安全整數範圍");
        db.prepare("INSERT INTO character_coupons(user_id,quantity) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET quantity=excluded.quantity").run(userId,balance);
      }
      const changed=db.prepare("UPDATE characters SET money=?,kpoint=?,body_energy=?,brain_energy=?,recovered_at=? WHERE user_id=?")
        .run(cash,kpoint,fight.bodyEnergy,fight.brainEnergy,now,userId);
      if(changed.changes!==1)throw new Error("街頭格鬥角色結算失敗");
      // 資產快照也在本交易中驗證，避免結算成功卻因溢位無法回傳狀態。
      refreshBankTaxSnapshot(db,userId,today);
      result={...fight,playedAt:now,playerName:actor.name,opponentName:opponent.name,
        playerStats,opponentStats};
    }
    db.prepare("INSERT INTO street_fights(user_id,request_id,played_at,result_json) VALUES(?,?,?,?)")
      .run(userId,requestId,now,JSON.stringify(result));
    db.exec("COMMIT");
    return {...result,replayed:false};
  }catch(error){db.exec("ROLLBACK");throw error;}
}
