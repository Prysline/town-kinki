// 單機重建角色：刪除本機專用的暫存帳號，讓 SQLite 外鍵連帶清理所有玩家資料。
// 世界地圖和 solo_clock 不隸屬於 user，保留；已建的個人住宅改回原始建地。
// 所有步驟同一事務，若地圖與房屋紀錄不一致就完全回滾，不冒險覆寫地圖。
import { readTownMap, storeTownMap } from "./town-storage.mjs";
import { RESIDENTIAL_LOTS } from "./housing.mjs";

export function deleteSoloCharacter(db, userId, characterName) {
  if (!Number.isSafeInteger(userId) || userId < 1)
    throw new Error("單機玩家資料不正確");
  if (typeof characterName !== "string" || !characterName || characterName.length > 100)
    throw new Error("請輸入完整的角色名稱確認刪除");
  db.exec("BEGIN IMMEDIATE");
  try {
    const user=db.prepare("SELECT username FROM users WHERE id=?").get(userId);
    if (user?.username !== "__local_player__")
      throw new Error("只允許清除單人模式的本機角色");
    const char=db.prepare("SELECT name FROM characters WHERE user_id=?").get(userId);
    if (!char) throw new Error("目前沒有可刪除的角色");
    if (char.name !== characterName)
      throw new Error("輸入的角色名稱不符，未刪除任何資料");

    const houses=db.prepare(
      "SELECT id,town_id,row_num,column_num,original_plot FROM houses WHERE owner_user_id=? ORDER BY town_id,id"
    ).all(userId);
    const changes=new Map();
    for (const house of houses) {
      if (!RESIDENTIAL_LOTS.includes(house.original_plot))
        throw new Error("住宅原始空地資料不正確，已取消刪除");
      const town=changes.get(house.town_id)??readTownMap(db,house.town_id);
      const i=house.row_num*16+house.column_num;
      if (!Number.isInteger(house.row_num)||house.row_num<0||house.row_num>=12||
          !Number.isInteger(house.column_num)||house.column_num<0||house.column_num>=16||
          town.tiles[i]!=="webhouse_"+house.id+"="+house.original_plot)
        throw new Error("住宅和街區地圖不一致，已取消刪除以保護資料");
      // 僅還原此玩家確實擁有的住宅；其它街區格子一律保留。
      town.tiles[i]=house.original_plot;
      changes.set(house.town_id,town);
    }
    for (const [townId,town] of changes) {
      storeTownMap(db,townId,{
        tiles:town.tiles,originalName:town.originalName,
        originalRecord:town.fields?town.fields.join("<>")+"\n":""
      },"web-edited");
    }
    // 本機專用使用者只承載單機角色；ON DELETE CASCADE 包含帳簿、物品、
    // 住宅、室內、訊息、事件、匯入封存及所有依賴該使用者的紀錄。
    const removed=db.prepare("DELETE FROM users WHERE id=? AND username='__local_player__'").run(userId);
    if (removed.changes!==1) throw new Error("無法刪除單機角色資料");
    db.exec("COMMIT");
    return {deletedCharacter:char.name,restoredHouses:houses.length};
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
