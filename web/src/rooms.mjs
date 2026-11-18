// 原版 original_house.cgi 與 town_lib.pl 的室內四欄設定移植。
// 設定、一般留言板、屋主公告板均掛在玩家身上，搬家後仍然保留。
export const ROOM_TYPES = Object.freeze([
  { type: "", label: "不公開" },
  { type: "0", label: "一般留言板" },
  { type: "2", label: "自訂網址（開啟外部網頁）" },
  { type: "3", label: "屋主公告板（僅屋主發文）" }
]);
const TYPES = new Set(ROOM_TYPES.map(item => item.type));
const emptySlot = () => ({ type: "", title: "", url: "" });
export function roomCapacity(interiorRank) {
  if (!Number.isInteger(interiorRank) || interiorRank < 0 || interiorRank > 3)
    throw new Error("無效的室內等級");
  return 4 - interiorRank;
}
function safeTitle(value) {
  if (typeof value !== "string" || Array.from(value).length > 32 ||
      /[\u0000-\u001F\u007F<>]/u.test(value))
    throw new Error("室內內容標題最多 32 個字，不能包含控制字元或標籤");
  return value.trim();
}
function safeLink(value) {
  if (typeof value !== "string" || value.length > 500)
    throw new Error("自訂網址格式不正確");
  let url;
  try { url = new URL(value); }
  catch { throw new Error("請輸入有效的 HTTPS 網址"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
    throw new Error("自訂網址僅接受不含帳號密碼的 HTTPS 網址");
  return url.href;
}
export function validateRoomSlots(slots, capacity) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4 ||
      !Array.isArray(slots) || slots.length !== capacity)
    throw new Error("室內配置數量不符合房屋等級");
  return slots.map(slot => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot) ||
        typeof slot.type !== "string" || !TYPES.has(slot.type))
      throw new Error("不支援的室內內容種類");
    const title = safeTitle(slot.title ?? "");
    const url = slot.type === "2" ? safeLink(slot.url) : "";
    return { type: slot.type, title, url };
  });
}

export function initRoomsTables(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS room_settings(",
    "owner_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,",
    "slots_json TEXT NOT NULL,updated_at INTEGER NOT NULL);",
    "CREATE TABLE IF NOT EXISTS room_posts(",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "board_type TEXT NOT NULL CHECK(board_type IN ('0','3')),",
    "body TEXT NOT NULL,created_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS room_posts_board_idx ON room_posts(owner_user_id,board_type,id);",
    "CREATE INDEX IF NOT EXISTS room_posts_author_idx ON room_posts(author_user_id,id);"
  ].join("\n"));
}

export function getRoomSlots(db, ownerId) {
  const found = db.prepare("SELECT slots_json FROM room_settings WHERE owner_user_id=?").get(ownerId);
  if (!found) return Array.from({ length: 4 }, emptySlot);
  let slots;
  try { slots = JSON.parse(found.slots_json); }
  catch { throw new Error("室內存檔損壞"); }
  if (!Array.isArray(slots) || slots.length !== 4)
    throw new Error("室內存檔格式不正確");
  return slots;
}

function houseForVisitor(db, visitorId, houseId) {
  if (!Number.isSafeInteger(houseId) || houseId < 1) throw new Error("無效的住宅編號");
  const visitor = db.prepare("SELECT town_id FROM characters WHERE user_id=?").get(visitorId);
  if (!visitor) throw new Error("請先建立角色");
  const house = db.prepare(
    "SELECT h.*, c.name AS owner_name FROM houses h JOIN characters c ON c.user_id=h.owner_user_id WHERE h.id=?"
  ).get(houseId);
  if (!house) throw new Error("找不到住宅，可能已出售");
  if (visitor.town_id !== house.town_id) throw new Error("必須先前往住宅所在的城鎮");
  return house;
}

export function setRoomSlots(db, visitorId, houseId, input, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const house = houseForVisitor(db, visitorId, houseId);
    if (house.owner_user_id !== visitorId) throw new Error("只有屋主可以更改室內設定");
    const capacity = roomCapacity(house.interior_rank);
    const updated = validateRoomSlots(input, capacity);
    const all = getRoomSlots(db, visitorId);
    // 原版位於 member/<玩家ID>，不因房屋出售而清除其餘欄位。
    for (let i = 0; i < capacity; i++) all[i] = updated[i];
    db.prepare(
      "INSERT INTO room_settings(owner_user_id,slots_json,updated_at) VALUES(?,?,?) "+
      "ON CONFLICT(owner_user_id) DO UPDATE SET slots_json=excluded.slots_json,updated_at=excluded.updated_at"
    ).run(visitorId, JSON.stringify(all), now);
    db.exec("COMMIT");
    return { houseId, slots: all.slice(0, capacity) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function viewRoom(db, visitorId, houseId, requestedSlot = null) {
  const house = houseForVisitor(db, visitorId, houseId);
  const owner = visitorId === house.owner_user_id;
  const capacity = roomCapacity(house.interior_rank);
  const slots = getRoomSlots(db, house.owner_user_id).slice(0, capacity);
  const available = slots.map((slot, index) => ({ index, ...slot }))
    .filter(slot => slot.type !== "");
  if (!owner && !available.length) throw new Error("這間住宅尚未公開室內內容");
  let selectedIndex;
  if (requestedSlot === null || requestedSlot === undefined) {
    selectedIndex = available[0]?.index ?? null;
  } else {
    if (!Number.isInteger(requestedSlot) || requestedSlot < 0 || requestedSlot >= capacity)
      throw new Error("無效的內容欄位");
    selectedIndex = requestedSlot;
  }
  const selected = selectedIndex === null ? null : available.find(item => item.index === selectedIndex) ?? null;
  if (!selected && !owner) throw new Error("這個內容尚未公開");
  const type = selected?.type;
  const posts = type === "0" || type === "3"
    ? db.prepare([
        "SELECT p.id,p.body,p.created_at,p.author_user_id,c.name AS author_name",
        "FROM room_posts p JOIN characters c ON c.user_id=p.author_user_id",
        "WHERE p.owner_user_id=? AND p.board_type=? ORDER BY p.id DESC LIMIT 50"
      ].join(" ")).all(house.owner_user_id, type)
      .map(p => ({ id:p.id,body:p.body,authorName:p.author_name,createdAt:p.created_at,
        canDelete:owner || p.author_user_id === visitorId }))
    : [];
  return {
    houseId: house.id, houseName: house.name, ownerName: house.owner_name,
    owner, capacity, available, selectedIndex, selected, posts,
    canPost: type === "0" || (type === "3" && owner),
    editableSlots: owner ? slots : null
  };
}

export function addRoomPost(db, visitorId, houseId, slotIndex, body, now = Date.now()) {
  if (typeof body !== "string" || !body.trim() ||
      Array.from(body.trim()).length > 250 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(body))
    throw new Error("留言須為 1 至 250 個字，且不可包含控制字元");
  db.exec("BEGIN IMMEDIATE");
  try {
    const room = viewRoom(db, visitorId, houseId, slotIndex);
    const board = room.selected?.type;
    if ((board !== "0" && board !== "3") || !room.canPost)
      throw new Error("沒有在此留言板發文的權限");
    const ownerId = db.prepare("SELECT owner_user_id FROM houses WHERE id=?").get(houseId).owner_user_id;
    const last = db.prepare(
      "SELECT created_at FROM room_posts WHERE owner_user_id=? AND author_user_id=? AND board_type=? ORDER BY id DESC LIMIT 1"
    ).get(ownerId, visitorId, board);
    if (last && now - last.created_at < 5000)
      throw new Error("發文間隔至少需五秒");
    const added = db.prepare(
      "INSERT INTO room_posts(owner_user_id,author_user_id,board_type,body,created_at) VALUES(?,?,?,?,?)"
    ).run(ownerId, visitorId, board, body.trim(), now);
    db.exec("COMMIT");
    return { postId:Number(added.lastInsertRowid), houseId, slotIndex };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteRoomPost(db, visitorId, houseId, postId) {
  if (!Number.isSafeInteger(postId) || postId < 1) throw new Error("無效的留言編號");
  db.exec("BEGIN IMMEDIATE");
  try {
    const house = houseForVisitor(db, visitorId, houseId);
    const post = db.prepare(
      "SELECT owner_user_id,author_user_id,board_type FROM room_posts WHERE id=?"
    ).get(postId);
    if (!post || post.owner_user_id !== house.owner_user_id)
      throw new Error("找不到留言");
    if (post.author_user_id !== visitorId && house.owner_user_id !== visitorId)
      throw new Error("沒有刪除這篇留言的權限");
    const slots = getRoomSlots(db, house.owner_user_id).slice(0, roomCapacity(house.interior_rank));
    if (!slots.some(slot => slot.type === post.board_type))
      throw new Error("留言板目前未公開");
    db.prepare("DELETE FROM room_posts WHERE id=? AND owner_user_id=?").run(postId, house.owner_user_id);
    db.exec("COMMIT");
    return { postId, houseId };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
