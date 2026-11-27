// 單機的虛擬遊戲時鐘；多人維持真實伺服器時間。
// 以單一持久化偏移量推進時間，所有與冷卻、日結算相關的 API 都使用同一時鐘。
// 僅提供列出的預設值，禁止客戶端任意寫入絕對時間或偏移量。
export const SOLO_TIME_STEPS = Object.freeze({
  "5m": 5 * 60_000,           // 工作：原版等待 5 分鐘
  "30m": 30 * 60_000,         // 能量恢復、健身課程與較長等待
  "1h": 60 * 60_000,          // 用餐與長課程
  "1d": 24 * 60 * 60_000     // 跨一個遊戲日：學校與每日結算
});
export const MAX_SOLO_OFFSET_MS = 10 * 365 * 24 * 60 * 60_000;

export function initSoloClock(db) {
  db.exec("CREATE TABLE IF NOT EXISTS solo_clock (id INTEGER PRIMARY KEY CHECK(id=1), offset_ms INTEGER NOT NULL CHECK(offset_ms>=0));");
  db.prepare("INSERT OR IGNORE INTO solo_clock(id,offset_ms) VALUES(1,0)").run();
}
export function soloOffset(db) {
  const value = db.prepare("SELECT offset_ms FROM solo_clock WHERE id=1").get()?.offset_ms;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SOLO_OFFSET_MS)
    throw new Error("單機時間存檔不正確");
  return value;
}
export function gameTimestamp(db, realNow = Date.now()) {
  if (!Number.isSafeInteger(realNow) || realNow < 0) throw new Error("無效的現實時間");
  const time = realNow + soloOffset(db);
  if (!Number.isSafeInteger(time)) throw new Error("遊戲時間超出安全範圍");
  return time;
}
export function advanceSoloClock(db, preset, realNow = Date.now()) {
  if (typeof preset !== "string" || !Object.hasOwn(SOLO_TIME_STEPS,preset))
    throw new Error("不支援的單機快轉時間");
  const advanceMs=SOLO_TIME_STEPS[preset];
  if (!Number.isSafeInteger(realNow) || realNow < 0)
    throw new Error("無效的現實時間");
  db.exec("BEGIN IMMEDIATE");
  try {
    const before=soloOffset(db);
    const after=before+advanceMs;
    if (!Number.isSafeInteger(after) || after>MAX_SOLO_OFFSET_MS)
      throw new Error("單機遊戲時間已達快轉上限");
    const next=realNow+after;
    if (!Number.isSafeInteger(next))throw new Error("遊戲時間超出安全範圍");
    const result=db.prepare("UPDATE solo_clock SET offset_ms=? WHERE id=1").run(after);
    if(result.changes!==1)throw new Error("單機遊戲時間存檔更新失敗");
    db.exec("COMMIT");
    return {preset,advancedMs:advanceMs,gameTimeMs:next,offsetMs:after};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
