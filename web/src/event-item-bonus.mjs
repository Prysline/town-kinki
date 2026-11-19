// event.pl::motimono_kensa_ev、motimono_kensa_ev2：只支援已匯入的「回」耐久道具。
// 原始 33 欄封存不變；事件扣除量與手動使用共用 legacy_item_usage。
export const EVENT_BONUS_ITEMS = Object.freeze({
  3: "英文解釈教室",
  11: "成り上がり",
  17: "おばあちゃんの知恵袋",
  18: "フラフープ",
  19: "谷保天満宮のお守り",
  20: "幸せを呼ぶ香水",
  21: "バイアグラ",
  22: "損害保険",
  29: "幸せの星砂",
  31: "ミグ25",
  42: "阪神タイガースの公式チケット"
});

// event.pl::motimono_kensa_ev2 需要同時持有全部指定物品，不能把「任一件」誤當作達成。
export const EVENT_REQUIRED_SETS=Object.freeze({
  32:Object.freeze(["小さな花束(ラン)","ルパン三世","ファイナルクエスト"])
});
const ALLOWED_EVENT_ITEMS=new Set([
  ...Object.values(EVENT_BONUS_ITEMS),
  ...Object.values(EVENT_REQUIRED_SETS).flat()
]);

function hasTable(db,name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name));
}

export function findEventBonusItem(db,userId,name) {
  if (!Number.isSafeInteger(userId)||userId<=0||!ALLOWED_EVENT_ITEMS.has(name))
    return null;
  // 測試與早期舊 Web 存檔可能還沒有物品表；沒有物品時仍照常抽基本事件。
  if (!hasTable(db,"legacy_inventory_items")||!hasTable(db,"legacy_item_usage"))
    return null;
  const rows=db.prepare([
    "SELECT i.source_line,i.category,i.original_name,i.durability,i.durability_unit,",
    "i.last_used_at,i.raw_fields_json,u.remaining AS web_remaining,",
    "u.last_used_at_ms FROM legacy_inventory_items i",
    "LEFT JOIN legacy_item_usage u ON u.user_id=i.user_id AND u.source_line=i.source_line",
    "WHERE i.user_id=? AND i.original_name=? ORDER BY i.source_line"
  ].join(" ")).all(userId,name);
  for(const row of rows) {
    // 不讓不完整的原始封存項目意外提供事件加成。
    let raw;
    try { raw=JSON.parse(row.raw_fields_json); } catch { continue; }
    if (!Array.isArray(raw)||raw.length!==33||raw.some(x=>typeof x!=="string")||
        raw[0]!==row.category||raw[1]!==name||raw[21]!==String(row.durability)||
        raw[22]!=="回"||row.durability_unit!=="回"||row.category==="ギフト")
      continue;
    const remaining=row.web_remaining??row.durability;
    const lastUsedAt=row.last_used_at_ms??((row.last_used_at??0)*1000);
    if (!Number.isSafeInteger(remaining)||remaining<=0||
        !Number.isSafeInteger(lastUsedAt)||lastUsedAt<0) continue;
    return {sourceLine:row.source_line,name,remaining,lastUsedAt};
  }
  return null;
}

// 呼叫者必須已持有 BEGIN IMMEDIATE 寫入交易，並且只在加成真正發生時扣耐久。
export function consumeEventBonusItem(db,userId,item) {
  if (!item||!Number.isSafeInteger(item.sourceLine)||item.sourceLine<=0||
      !Number.isSafeInteger(item.remaining)||item.remaining<=0)
    throw new Error("事件道具狀態不正確");
  const next=item.remaining-1;
  db.prepare([
    "INSERT INTO legacy_item_usage(user_id,source_line,remaining,last_used_at_ms)",
    "VALUES(?,?,?,?) ON CONFLICT(user_id,source_line) DO UPDATE",
    "SET remaining=excluded.remaining,last_used_at_ms=excluded.last_used_at_ms"
  ].join(" ")).run(userId,item.sourceLine,next,item.lastUsedAt);
  return {name:item.name,sourceLine:item.sourceLine,remaining:next};
}
