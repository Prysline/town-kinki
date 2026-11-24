import {randomInt} from "node:crypto";
import {STAT_KEYS,STAT_LABELS,maxBodyEnergy,maxBrainEnergy} from "./engine.mjs";
import {requireClassroomCreditCard} from "./legacy-credit.mjs";
import {recordBankEntry,refreshBankTaxSnapshot,settleBankInterestInTransaction} from "./banking.mjs";
export const C_SEASON_MS=14*86400000,C_INTERVAL_MS=60000,C_MATCH_LIMIT=100,C_ATTACK_LIMIT=25,C_UNIT_COST=10000;
export const C_POINTS=Object.freeze([10,5,3,2,1]);
const defaults=["你會讀這個漢字嗎？","你知道這題數學的答案嗎？","知道這公式是誰想出來的嗎？","知道這事件在哪一年發生嗎？","知道這個英文單字的意思嗎？","知道這首曲子的作曲者嗎？","看看這幅畫！","比比外貌吧！","比比體力吧！","我對健康很有自信！","跟得上我的速度嗎？","用擒抱一決勝負！","來比腕力！","讓你見識我的踢擊！","愛的深度我可不會輸！","這個笑話如何？","情色方面我不會輸！"];
export const C_DEFAULT_COMMENTS=Object.freeze(Object.fromEntries(STAT_KEYS.map((k,i)=>[k,defaults[i]])));
const empty=()=>Object.fromEntries(STAT_KEYS.map(k=>[k,0]));
const validInt=n=>Number.isSafeInteger(n)&&n>=0;
function safe(n){if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw Error("C 聯賽數值超出安全範圍");return Number(n);}
function statMap(value){if(!value||STAT_KEYS.some(k=>!validInt(value[k])))throw Error("C 聯賽能力資料無效");return value;}
function sumKeys(s,keys){return keys.reduce((total,k)=>total+BigInt(s[k]),0n);}
export function cEnergy(stats){
  const s=statMap(stats);
  const body=safe(sumKeys(s,["looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku","etti"])/10n);
  const brain=safe(sumKeys(s,["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu","love","unique"])/10n);
  return {body,brain,total:safe(BigInt(body)+BigInt(brain))};
}
function draw(rng,n){const x=rng(n);if(!Number.isInteger(x)||x<0||x>=n)throw Error("C 聯賽亂數超出範圍");return x;}
export function chooseCLeagueOpponent(rows,own,rng=randomInt){
  // Perl int(rand($#taisen_list)): 一名對手時 rand(0) 仍截成 0；兩名以上排除最後一列。
  const selected=rows.length?rows[draw(rng,Math.max(1,rows.length-1))]:null;
  const mimic=draw(rng,3)===0||!selected;
  return {opponent:mimic?{...own,name:"模仿者"+own.name,owner:"模仿者"+own.owner}:selected,mimic};
}
function adjusted(n,roll){const v=BigInt(n),d=v/3n;return roll===0?v-d:roll===1?v+d:v;}
export function simulateCLeague(player,opponent,rng=randomInt){
  const a=statMap(player.stats),b=statMap(opponent.stats);
  const initial={player:cEnergy(a),opponent:cEnergy(b)};
  let mine=BigInt(initial.player.total),theirs=BigInt(initial.opponent.total),dealt=0n;
  let playerTurn=a.speed>b.speed,outcome="draw";
  const rounds=[];
  for(let turn=1;turn<=C_ATTACK_LIMIT;turn++){
    const i=draw(rng,17),stat=STAT_KEYS[i],ar=draw(rng,3),br=draw(rng,3);
    const diff=playerTurn?adjusted(a[stat],ar)-adjusted(b[stat],br):adjusted(b[stat],br)-adjusted(a[stat],ar);
    const damage=diff>0n?diff:0n;
    if(playerTurn){theirs-=damage;dealt+=damage;}else mine-=damage;
    // 原版顯示可為負的戰鬥暫存能量；不寫回培育角色或玩家能量。
    const signed=n=>n<0n?-safe(-n):safe(n);
    rounds.push({turn,attacker:playerTurn?"player":"opponent",stat,label:STAT_LABELS[stat],
      type:i<=7||i===14||i===15?"brain":"body",comment:(playerTurn?player:opponent).comments?.[stat]||C_DEFAULT_COMMENTS[stat],
      playerRoll:ar,opponentRoll:br,damage:safe(damage),playerEnergy:signed(mine),opponentEnergy:signed(theirs)});
    if(theirs<=0n){outcome="win";break;}if(mine<=0n){outcome="loss";break;}playerTurn=!playerTurn;
  }
  const reward=safe((outcome==="win"?dealt*2n:outcome==="loss"?dealt:dealt*3n/2n)||100n);
  return {outcome,reward,damageDealt:safe(dealt),initial,rounds};
}
export function initCLeagueTables(db){
  db.exec(`CREATE TABLE IF NOT EXISTS c_league_chars(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,image_url TEXT NOT NULL,stats_json TEXT NOT NULL,comments_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS c_league_season(id INTEGER PRIMARY KEY CHECK(id=1),number INTEGER NOT NULL,start_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS c_league_entries(user_id INTEGER PRIMARY KEY REFERENCES c_league_chars(user_id) ON DELETE CASCADE,
    wins INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,draws INTEGER NOT NULL DEFAULT 0,
    champions INTEGER NOT NULL DEFAULT 0,points INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL DEFAULT 0,
    prev_wins INTEGER NOT NULL DEFAULT 0,prev_losses INTEGER NOT NULL DEFAULT 0,prev_draws INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,last_result_json TEXT);
    CREATE TABLE IF NOT EXISTS c_league_requests(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,kind TEXT NOT NULL,result_json TEXT NOT NULL,UNIQUE(user_id,request_id));`);
}
function tx(db,fn){db.exec("BEGIN IMMEDIATE");try{const out=fn();db.exec("COMMIT");return out;}catch(e){db.exec("ROLLBACK");throw e;}}
function entries(db){return db.prepare("SELECT e.*,c.name,c.image_url,c.stats_json,c.comments_json,p.name AS owner FROM c_league_entries e JOIN c_league_chars c USING(user_id) JOIN characters p USING(user_id) ORDER BY e.sort_order,e.user_id").all();}
function fighter(row){return {userId:row.user_id,name:row.name,owner:row.owner,imageUrl:row.image_url,stats:JSON.parse(row.stats_json),comments:JSON.parse(row.comments_json)};}
function own(db,id){const row=db.prepare("SELECT c.*,p.name AS owner FROM c_league_chars c JOIN characters p USING(user_id) WHERE c.user_id=?").get(id);return row?fighter(row):null;}
function season(db,now){
  let s=db.prepare("SELECT * FROM c_league_season WHERE id=1").get();
  if(!s){db.prepare("INSERT INTO c_league_season VALUES(1,1,?)").run(now);return {number:1,start_at:now};}
  if(now-s.start_at>=C_SEASON_MS){
    // 原版每次到期只結算一季；以本次訪問時間重新起算，保留上次出賽時間。
    const ranked=entries(db).sort((a,b)=>b.wins-a.wins);
    const update=db.prepare("UPDATE c_league_entries SET prev_wins=wins,prev_losses=losses,prev_draws=draws,wins=0,losses=0,draws=0,champions=?,points=?,sort_order=? WHERE user_id=?");
    ranked.forEach((e,i)=>update.run(safe(BigInt(e.champions)+(i===0?1n:0n)),safe(BigInt(e.points)+BigInt(C_POINTS[i]??0)),i,e.user_id));
    s={number:safe(BigInt(s.number)+1n),start_at:now};db.prepare("UPDATE c_league_season SET number=?,start_at=? WHERE id=1").run(s.number,now);
  }
  return s;
}
function validateRequest(id,data,now,keys){
  if(!Number.isSafeInteger(id)||id<1||!validInt(now)||now===0||!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).some(k=>!keys.includes(k))||typeof data.requestId!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(data.requestId))throw Error("C 聯賽請求格式錯誤");
}
function replay(db,id,data,kind){const old=db.prepare("SELECT kind,result_json FROM c_league_requests WHERE user_id=? AND request_id=?").get(id,data.requestId);
  if(!old)return null;if(old.kind!==kind)throw Error("請求碼已用於其他操作");return {...JSON.parse(old.result_json),replayed:true};}
function saveResult(db,id,data,kind,result){db.prepare("INSERT INTO c_league_requests(user_id,request_id,kind,result_json) VALUES(?,?,?,?)").run(id,data.requestId,kind,JSON.stringify(result));return {...result,replayed:false};}
function actor(db,id){const row=db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);if(!row)throw Error("請先建立居民");return row;}
function nameOf(value){if(typeof value!=="string"||!value.trim()||/[\u0000-\u001f\u007f]/.test(value)||[...value.trim()].reduce((n,c)=>n+(c.codePointAt(0)<128?1:2),0)>30)throw Error("培育角色名稱最多全形 15 字／半形 30 字");return value.trim();}
function imageOf(value){if(typeof value!=="string"||value.length>2048)throw Error("圖片網址無效");if(!value)return "";let u;try{u=new URL(value);}catch{throw Error("圖片網址無效");}if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw Error("圖片須為 HTTP(S) 網址");return u.href;}
function partialMap(value,kind){if(value===undefined)return {};if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!STAT_KEYS.includes(k)))throw Error("C 聯賽欄位無效");
  for(const v of Object.values(value)){if(kind==="stats"? !validInt(v):typeof v!=="string"||[...v].length>40||/[\u0000-\u001f\u007f]/.test(v))throw Error("C 聯賽培育數值或台詞無效");}return value;}
export function trainCLeague(db,id,data,now,today){
  validateRequest(id,data,now,["requestId","name","imageUrl","transfers","comments","payment","cardSourceLine"]);
  return tx(db,()=>{
    const old=replay(db,id,data,"train");if(old)return old;
    settleBankInterestInTransaction(db,id,today,now);
    const a=actor(db,id),prior=own(db,id),name=nameOf(data.name??prior?.name),imageUrl=imageOf(data.imageUrl??prior?.imageUrl??"");
    const transfers=partialMap(data.transfers,"stats"),comments=partialMap(data.comments,"comments");
    const source=statMap(JSON.parse(a.stats_json)),target=prior?.stats??empty();
    let amount=0n;
    for(const k of STAT_KEYS){const n=transfers[k]??0;if(n>0&&n>=source[k])throw Error("移轉後居民能力必須至少剩 1 點："+STAT_LABELS[k]);source[k]-=n;target[k]=safe(BigInt(target[k])+BigInt(n));amount+=BigInt(n);}
    cEnergy(target);const cost=safe(amount*BigInt(C_UNIT_COST));
    const payment=data.payment??"cash";if(!["cash","credit"].includes(payment))throw Error("付款方式無效");
    if(payment==="credit")requireClassroomCreditCard(db,id,data.cardSourceLine,now);
    const assets=db.prepare("SELECT a.term_balance,l.daily_payment,l.remaining_payments FROM characters c LEFT JOIN bank_accounts a ON a.user_id=c.user_id LEFT JOIN bank_loans l ON l.user_id=c.user_id WHERE c.user_id=?").get(id);
    if(![a.money,a.bank,assets.term_balance??0,assets.daily_payment??0,assets.remaining_payments??0].every(validInt))throw Error("居民資產資料無效");
    const net=BigInt(a.money)+BigInt(a.bank)+BigInt(assets.term_balance??0)-BigInt(assets.daily_payment??0)*BigInt(assets.remaining_payments??0);
    if(BigInt(cost)>net&&cost>0)throw Error("不得超過總資產");
    if(cost>(payment==="cash"?a.money:a.bank))throw Error("付款餘額不足");
    const money=a.money-(payment==="cash"?cost:0),bank=a.bank-(payment==="credit"?cost:0);
    const merged={...C_DEFAULT_COMMENTS,...prior?.comments};for(const [k,v] of Object.entries(comments))if(v)merged[k]=v;
    db.prepare("INSERT INTO c_league_chars VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,image_url=excluded.image_url,stats_json=excluded.stats_json,comments_json=excluded.comments_json").run(id,name,imageUrl,JSON.stringify(target),JSON.stringify(merged));
    db.prepare("UPDATE characters SET money=?,bank=?,stats_json=?,body_energy=?,brain_energy=? WHERE user_id=?").run(money,bank,JSON.stringify(source),Math.min(a.body_energy,maxBodyEnergy(source)),Math.min(a.brain_energy,maxBrainEnergy(source)),id);
    if(cost&&payment==="credit")recordBankEntry(db,id,"ordinary","C 聯賽信用付款",cost,0,bank,now);
    refreshBankTaxSnapshot(db,id,today);
    return saveResult(db,id,data,"train",{cost,payment,transfers,character:own(db,id)});
  });
}
function standing(e){return {name:e.name,owner:e.owner,imageUrl:e.image_url,wins:e.wins,losses:e.losses,draws:e.draws,champions:e.champions,points:e.points,previousWins:e.prev_wins,previousLosses:e.prev_losses,previousDraws:e.prev_draws};}
export function cLeagueOverview(db,id,now,{activate=true}={}){
  return tx(db,()=>{const s=activate?season(db,now):db.prepare("SELECT * FROM c_league_season WHERE id=1").get(),rows=entries(db),mine=rows.find(e=>e.user_id===id);
    const number=s?.number??1,endsAt=s?s.start_at+C_SEASON_MS:null;
    const history=db.prepare("SELECT result_json FROM c_league_requests WHERE user_id=? AND kind='play' ORDER BY id DESC LIMIT 20").all(id).map(e=>JSON.parse(e.result_json));
    return {season:number,started:!!s,day:s?Math.min(14,Math.max(1,Math.floor((now-s.start_at)/86400000)+1)):1,endsAt,
      matchLimit:C_MATCH_LIMIT,intervalMs:C_INTERVAL_MS,unitCost:C_UNIT_COST,character:own(db,id),record:mine?standing(mine):null,
      readyAt:mine?.last_at?mine.last_at+C_INTERVAL_MS:0,
      rankings:[...rows].sort((a,b)=>b.wins-a.wins).slice(0,10).map(standing),
      previous:number>1?[...rows].sort((a,b)=>b.prev_wins-a.prev_wins).slice(0,5).map(standing):[],
      overall:number>1?[...rows].sort((a,b)=>b.points-a.points).filter(e=>e.points>0).slice(0,10).map(standing):[],
      recent:rows.slice(0,5).flatMap(e=>e.last_result_json?[JSON.parse(e.last_result_json)]:[]),history};
  });
}
export function playCLeague(db,id,data,now,today,rng=randomInt){
  validateRequest(id,data,now,["requestId"]);
  return tx(db,()=>{
    const old=replay(db,id,data,"play");if(old)return old;
    settleBankInterestInTransaction(db,id,today,now);
    const a=actor(db,id),player=own(db,id);if(!player)throw Error("請先建立培育角色");
    const s=season(db,now),rows=entries(db),mine=rows.find(e=>e.user_id===id);
    if(mine&&now-mine.last_at<C_INTERVAL_MS)throw Error("尚在 1 分鐘比賽間隔");
    if(mine&&mine.wins+mine.losses+mine.draws>=C_MATCH_LIMIT)throw Error("本季 100 場賽程已完成");
    const {opponent,mimic}=chooseCLeagueOpponent(rows.filter(e=>e.user_id!==id).map(fighter),player,rng);
    if(!validInt(a.money))throw Error("居民現金資料無效");
    const fight=simulateCLeague(player,opponent,rng),cash=safe(BigInt(a.money)+BigInt(fight.reward));
    const result={...fight,season:s.number,playedAt:now,playerName:player.name,opponentName:opponent.name,mimic};
    db.prepare("INSERT OR IGNORE INTO c_league_entries(user_id) VALUES(?)").run(id);
    // 原版發起者移至名單首位，對手的戰績不變。
    db.prepare("UPDATE c_league_entries SET sort_order=sort_order+1 WHERE user_id<>?").run(id);
    db.prepare("UPDATE c_league_entries SET wins=wins+?,losses=losses+?,draws=draws+?,sort_order=0,last_at=?,last_result_json=? WHERE user_id=?").run(
      +(fight.outcome==="win"),+(fight.outcome==="loss"),+(fight.outcome==="draw"),now,JSON.stringify({playerName:player.name,opponentName:opponent.name,outcome:fight.outcome,comment:fight.outcome==="draw"?"":fight.rounds.at(-1).comment,playedAt:now}),id);
    db.prepare("UPDATE characters SET money=? WHERE user_id=?").run(cash,id);
    refreshBankTaxSnapshot(db,id,today);
    return saveResult(db,id,data,"play",result);
  });
}
