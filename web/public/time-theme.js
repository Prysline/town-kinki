// 原版 top.pl::sonomati 的 $sotonoiro：依遊戲時區的小時切換城鎮背景。
// 色碼由 CSS 設定，此處只決定時段，確保單機快轉與多人伺服器時間一致。
export function townTimePhase(timeMs, timeZone = "Asia/Taipei") {
  if (!Number.isFinite(timeMs)) return "day";
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", hourCycle: "h23"
    }).format(new Date(timeMs)));
  } catch {
    return "day";
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "day";
  if (hour >= 22 || hour < 7) return "night";
  if (hour < 10) return "morning";
  if (hour < 16) return "day";
  if (hour < 18) return "sunset";
  return "evening";
}
