// 原版 town_lib.pl::kozin_sprit 的 kounyuu 欄是玩家圖示 URL；
// game.cgi::battle 以 32x32 顯示。Web 僅從本人已匯入封存讀取，
// 不替使用者下載圖片、不修改原始資料，且需本人明確點擊才可載入外部來源。
export function safeLegacyIconUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 ||
      /[\\\s\x00-\x1f\x7f]/.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  // 舊 CGI 能儲存 http://，但 Web 不在 HTTPS 頁面預覽不安全的混合內容。
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || !url.hostname.includes(".")) return null;
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
  return url.href;
}

export function legacyPlayerIcon(db, userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) return { status: "none" };
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_character_imports'").get();
  if (!table) return { status: "none" };
  const record = db.prepare("SELECT unmapped_json FROM legacy_character_imports WHERE target_user_id=?").get(userId);
  if (!record) return { status: "none" };
  let archive;
  try { archive = JSON.parse(record.unmapped_json); }
  catch { return { status: "blocked" }; }
  if (!archive || typeof archive !== "object" || Array.isArray(archive))
    return { status: "blocked" };
  if (!archive.kounyuu) return { status: "none" };
  const url = safeLegacyIconUrl(archive.kounyuu);
  return url ? { status: "available", url } : { status: "blocked" };
}
