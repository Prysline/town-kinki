// 歷史測試來源 #128 27d8ed7864e58bbb3d81bab526f8295acee542a8; blob 0939acb705e0ca75964ba1c6c60f9370a45b0f76。
// 只改相同 Git blob 的共用相依路徑，非正式 runtime。
// 原始 event.pl 的第 34 號（無聖誕人偶且現金>0）與第 44 號共用 20 秒蟑螂。
// 20 秒內拍死蟑螂可獲得 1～20000 元、K 點數 +3、外貌 -3。
// Web 採伺服器時間與每帳號獨立的 SQLite 挑戰，不接受前端回傳開始時間或角色 ID。
export const COCKROACH_WINDOW_MS=20000;
export const COCKROACH_EVENT_IDS=Object.freeze([34,44]);
function validateUser(userId){
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("無效的角色帳號");
}
function validateNow(now){
  if(!Number.isSafeInteger(now)||now<0)throw new Error("無效的事件時間");
}
function safeNonnegative(value,label){
  if(!Number.isSafeInteger(value)||value<0)throw new Error("角色"+label+"資料不正確");
  return value;
}
function drawReward(random){
  if(typeof random!=="function")throw new Error("事件亂數產生器不正確");
  const roll=random();
  if(typeof roll!=="number"||!Number.isFinite(roll)||roll<0||roll>=1)
    throw new Error("事件亂數產生器回傳無效數值");
  return Math.floor(roll*20000)+1;
}
export function initCockroachChallenges(db){
  db.exec([
    "CREATE TABLE IF NOT EXISTS character_cockroach_challenges(",
    "event_id INTEGER PRIMARY KEY REFERENCES character_events(id) ON DELETE CASCADE,",
    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "started_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,",
    "status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','caught','escaped')),",
    "resolved_at INTEGER);",
    "CREATE INDEX IF NOT EXISTS cockroach_challenge_user_idx",
    "ON character_cockroach_challenges(user_id,event_id);"
  ].join("\n"));
}
// 呼叫者必須已持有 BEGIN IMMEDIATE；事件歷史和挑戰一起提交／回滾。
export function openCockroachChallenge(db,userId,eventId,now){
  validateUser(userId);validateNow(now);
  if(!Number.isSafeInteger(eventId)||eventId<1||
      !Number.isSafeInteger(now+COCKROACH_WINDOW_MS))
    throw new Error("蟑螂事件時間或紀錄不正確");
  db.prepare([
    "INSERT INTO character_cockroach_challenges",
    "(event_id,user_id,started_at,expires_at,status)",
    "VALUES(?,?,?,?,'pending')"
  ].join(" ")).run(eventId,userId,now,now+COCKROACH_WINDOW_MS);
}
export function getCockroachChallenge(db,userId,now=Date.now()){
  validateUser(userId);validateNow(now);
  const row=db.prepare([
    "SELECT event_id,started_at,expires_at FROM character_cockroach_challenges",
    "WHERE user_id=? AND status='pending' ORDER BY event_id DESC LIMIT 1"
  ].join(" ")).get(userId);
  if(!row)return null;
  if(!Number.isSafeInteger(row.expires_at)||!Number.isSafeInteger(row.started_at)||
      row.expires_at-row.started_at!==COCKROACH_WINDOW_MS)
    throw new Error("蟑螂事件計時資料不正確");
  return {eventId:row.event_id,expiresAt:row.expires_at,
    remainingMs:Math.max(0,row.expires_at-now),
    status:now>=row.expires_at?"expired":"active"};
}
function updateHistory(db,eventId,userId,description,effects){
  const result=db.prepare(
    "UPDATE character_events SET description=?,effects_json=? WHERE id=? AND user_id=? AND original_id IN (34,44)"
  ).run(description,JSON.stringify(effects),eventId,userId);
  if(result.changes!==1)throw new Error("蟑螂事件歷史不正確");
}
export function claimCockroach(db,userId,now=Date.now(),random=Math.random){
  validateUser(userId);validateNow(now);
  db.exec("BEGIN IMMEDIATE");
  try{
    const row=db.prepare([
      "SELECT c.event_id,c.started_at,c.expires_at,e.original_id",
      "FROM character_cockroach_challenges c",
      "JOIN character_events e ON e.id=c.event_id AND e.user_id=c.user_id",
      "WHERE c.user_id=? AND c.status='pending'",
      "ORDER BY c.event_id DESC LIMIT 1"
    ].join(" ")).get(userId);
    if(!row||!COCKROACH_EVENT_IDS.includes(row.original_id))throw new Error("沒有待處理的蟑螂事件");
    if(!Number.isSafeInteger(row.started_at)||!Number.isSafeInteger(row.expires_at)||
        row.expires_at-row.started_at!==COCKROACH_WINDOW_MS)
      throw new Error("蟑螂事件計時資料不正確");
    if(now<row.started_at)throw new Error("蟑螂事件尚未開始");
    if(now>=row.expires_at){
      const changed=db.prepare(
        "UPDATE character_cockroach_challenges SET status='escaped',resolved_at=? WHERE event_id=? AND user_id=? AND status='pending'"
      ).run(now,row.event_id,userId);
      if(changed.changes!==1)throw new Error("蟑螂事件狀態不正確");
      updateHistory(db,row.event_id,userId,"超過 20 秒，蟑螂已逃走。",{cockroach:"escaped"});
      db.exec("COMMIT");
      return {status:"escaped",reward:0,kpoint:0,looks:0};
    }
    const character=db.prepare("SELECT money,kpoint,stats_json FROM characters WHERE user_id=?")
      .get(userId);
    if(!character)throw new Error("請先建立角色");
    const money=safeNonnegative(character.money,"現金");
    const kpoint=character.kpoint;
    if(!Number.isSafeInteger(kpoint))throw new Error("角色K 點數資料不正確");
    const stats=JSON.parse(character.stats_json);
    if(!stats||typeof stats!=="object"||Array.isArray(stats))
      throw new Error("角色能力資料不正確");
    const looks=safeNonnegative(stats.looks,"外貌");
    const reward=drawReward(random);
    const nextMoney=BigInt(money)+BigInt(reward);
    const nextKpoint=BigInt(kpoint)+3n;
    if(nextMoney>BigInt(Number.MAX_SAFE_INTEGER)||
        nextKpoint>BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("蟑螂事件獎勵超出安全整數範圍");
    const actualLooks=-Math.min(3,looks); // Web 版不允許原作負能力值。
    const nextStats=JSON.stringify({...stats,looks:looks+actualLooks});
    const updated=db.prepare(
      "UPDATE characters SET money=?,kpoint=?,stats_json=? WHERE user_id=?"
    ).run(Number(nextMoney),Number(nextKpoint),nextStats,userId);
    if(updated.changes!==1)throw new Error("角色資料更新失敗");
    const resolved=db.prepare(
      "UPDATE character_cockroach_challenges SET status='caught',resolved_at=? WHERE event_id=? AND user_id=? AND status='pending'"
    ).run(now,row.event_id,userId);
    if(resolved.changes!==1)throw new Error("蟑螂事件狀態不正確");
    updateHistory(db,row.event_id,userId,
      "在 20 秒內拍死蟑螂，獲得 "+reward+" 元及 K 點數 3 點，外貌減少 "+(-actualLooks)+" 點。",
      {cockroach:"caught",money:reward,kpoint:3,stats:{looks:actualLooks}});
    db.exec("COMMIT");
    return {status:"caught",reward,kpoint:3,looks:actualLooks};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
