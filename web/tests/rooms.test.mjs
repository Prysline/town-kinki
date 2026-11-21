import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ROOM_TYPES, roomCapacity, validateRoomSlots, initRoomsTables,
  getRoomSlots, setRoomSlots, viewRoom, addRoomPost, deleteRoomPost
} from "../src/rooms.mjs";
import { initHousingTables } from "../src/housing.mjs";

const blank = () => ({type:"",title:"",url:""});
const slot = (type,title,url="") => ({type,title,url});

function setup(rank = 0) {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "PRAGMA foreign_keys=ON;",
    "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);",
    "CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT,town_id INTEGER);",
    "INSERT INTO users(id,username) VALUES(1,'owner'),(2,'visitor'),(3,'far'),(4,'intruder');",
    "INSERT INTO characters(user_id,name,town_id) VALUES(1,'屋主',3),(2,'訪客',3),(3,'遠地居民',0),(4,'陌生人',3);"
  ].join("\n"));
  initHousingTables(db);
  initRoomsTables(db);
  db.prepare(
    "INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,interior_rank,purchase_price,original_plot,created_at) VALUES(1,1,3,0,0,'小木屋','house/kamakura.gif',?,6500000,'空地',100)"
  ).run(rank);
  return db;
}

test("原版室內等級對應四、三、二、一欄，商店內容可設定但零售須另行移植", () => {
  assert.deepEqual([0,1,2,3].map(roomCapacity), [4,3,2,1]);
  assert.deepEqual(ROOM_TYPES.map(x => x.type), ["","0","1","2","3"]);
  assert.throws(() => roomCapacity(-1),/室內/);
  assert.throws(() => validateRoomSlots([blank(),blank()], 1),/數量/);
  assert.deepEqual(validateRoomSlots([slot("1","商店")],1),[slot("1","商店")]);
});

test("室內內容標題、連結與程式注入有伺服器端限制", () => {
  assert.deepEqual(validateRoomSlots([slot("2","遊戲網站","https://example.org/path?q=1")],1),
    [slot("2","遊戲網站","https://example.org/path?q=1")]);
  for (const url of ["javascript:alert(1)","http://example.org/","ftp://example.org/","https://user:pass@example.org/"]) {
    assert.throws(() => validateRoomSlots([slot("2","錯誤連結",url)],1),/HTTPS/);
  }
  assert.throws(() => validateRoomSlots([slot("0","<script>")],1),/標題/);
  assert.throws(() => validateRoomSlots([slot("0","a".repeat(33))],1),/標題/);
});

test("未設置室內內容時訪客不得入內，只有屋主可以修改", () => {
  const db = setup(3);
  try {
    const view = viewRoom(db,1,1);
    assert.equal(view.owner,true);
    assert.equal(view.capacity,1);
    assert.equal(view.available.length,0);
    assert.throws(() => viewRoom(db,2,1),/尚未公開/);
    assert.throws(() => setRoomSlots(db,2,1,[slot("0","陌生設定")]),/只有屋主/);
    assert.equal(getRoomSlots(db,1)[0].type,"");
    assert.equal(viewRoom(db,1,1).editableSlots.length,1);
  } finally { db.close(); }
});

test("設定 A 級四欄，公開一般留言板、屋主公告板、自訂網址並允許訪客瀏覽", () => {
  const db = setup(0);
  try {
    const options=[slot("0","留言區"),slot("3","公告"),slot("2","網站","https://example.com/"),blank()];
    const result=setRoomSlots(db,1,1,options);
    assert.equal(result.slots.length,4);
    const publicView=viewRoom(db,2,1);
    assert.equal(publicView.owner,false);
    assert.deepEqual(publicView.available.map(x=>x.index),[0,1,2]);
    assert.equal(publicView.selected.type,"0");
    assert.equal(publicView.editableSlots,null);
    assert.equal(viewRoom(db,2,1,1).canPost,false);
    assert.equal(viewRoom(db,2,1,1).selected.type,"3");
    assert.equal(viewRoom(db,2,1,2).selected.url,"https://example.com/");
    assert.equal(viewRoom(db,1,1).editableSlots.length,4);
    assert.throws(() => viewRoom(db,2,1,3),/未公開/);
    assert.throws(() => viewRoom(db,2,1,4),/無效/);
  } finally { db.close(); }
});

test("一般留言板可由訪客留言，公告板只能屋主發文，兩份內容獨立", () => {
  const db=setup(0);
  try {
    setRoomSlots(db,1,1,[slot("0","討論"),slot("3","公告"),blank(),blank()]);
    const first=addRoomPost(db,2,1,0,"早安",10000);
    assert.equal(first.postId,1);
    assert.throws(() => addRoomPost(db,2,1,0,"同時再貼",10001),/五秒/);
    assert.throws(() => addRoomPost(db,2,1,1,"不該成功",20000),/權限/);
    const second=addRoomPost(db,1,1,1,"屋主通知",20000);
    assert.equal(second.postId,2);
    const normal=viewRoom(db,4,1,0);
    const ownerOnly=viewRoom(db,4,1,1);
    assert.deepEqual(normal.posts.map(x=>x.body),["早安"]);
    assert.deepEqual(ownerOnly.posts.map(x=>x.body),["屋主通知"]);
    assert.equal(normal.canPost,true);
    assert.equal(ownerOnly.canPost,false);
    assert.equal(viewRoom(db,1,1,1).canPost,true);
  } finally { db.close(); }
});

test("只能本人或屋主刪文，訪客不能改動他人留言", () => {
  const db=setup(3);
  try {
    setRoomSlots(db,1,1,[slot("0","留言")]);
    const post=addRoomPost(db,2,1,0,"訪客心得",10000);
    assert.throws(() => deleteRoomPost(db,4,1,post.postId),/權限/);
    assert.equal(viewRoom(db,1,1).posts[0].canDelete,true);
    assert.equal(viewRoom(db,4,1).posts[0].canDelete,false);
    assert.deepEqual(deleteRoomPost(db,1,1,post.postId),{postId:post.postId,houseId:1});
    assert.equal(viewRoom(db,2,1).posts.length,0);
    assert.throws(() => deleteRoomPost(db,1,1,post.postId),/找不到/);
  } finally { db.close(); }
});

test("跨城鎮無法進入房屋，室內設定不能對不存在的住宅或他人的住宅操作", () => {
  const db=setup(3);
  try {
    setRoomSlots(db,1,1,[slot("0","留言")]);
    assert.throws(() => viewRoom(db,3,1),/前往/);
    assert.throws(() => addRoomPost(db,3,1,0,"遠距留言",10000),/前往/);
    assert.throws(() => viewRoom(db,2,999),/找不到住宅/);
    assert.throws(() => setRoomSlots(db,2,1,[slot("0","竄改")]),/屋主/);
    assert.equal(getRoomSlots(db,1)[0].title,"留言");
  } finally {db.close();}
});

test("售屋後保留室內設定及兩種留言板內容，新買家不取得舊主人的資料", () => {
  const db=setup(0);
  try {
    setRoomSlots(db,1,1,[slot("0","原屋主留言"),slot("3","原屋主公告"),blank(),blank()]);
    addRoomPost(db,1,1,0,"我的歷史留言",10000);
    addRoomPost(db,1,1,1,"我的舊公告",20000);
    db.prepare("DELETE FROM houses WHERE id=1").run();
    db.prepare(
      "INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,interior_rank,purchase_price,original_plot,created_at) VALUES(2,2,3,0,0,'新屋','house/kamakura.gif',3,6500000,'空地',200)"
    ).run();
    assert.equal(viewRoom(db,2,2).available.length,0);
    assert.throws(() => viewRoom(db,1,2),/尚未公開/);
    db.prepare("UPDATE houses SET owner_user_id=1 WHERE id=2").run();
    assert.equal(viewRoom(db,1,2).available.length,1);
    assert.equal(viewRoom(db,1,2).posts[0].body,"我的歷史留言");
    assert.equal(getRoomSlots(db,1)[1].title,"原屋主公告");
    assert.equal(viewRoom(db,1,2).capacity,1);
    db.prepare("UPDATE houses SET interior_rank=0 WHERE id=2").run();
    assert.equal(viewRoom(db,1,2,1).posts[0].body,"我的舊公告");
  } finally {db.close();}
});

test("訪客發表的文字不會被替換或執行，拒絕過長及空白訊息", () => {
  const db=setup(3);
  try {
    setRoomSlots(db,1,1,[slot("0","測試")]);
    const text="<script>alert('x')</script>";
    addRoomPost(db,2,1,0,text,10000);
    assert.equal(viewRoom(db,1,1).posts[0].body,text);
    assert.throws(() => addRoomPost(db,2,1,0,"x".repeat(251),20000),/250/);
    assert.throws(() => addRoomPost(db,2,1,0,"   ",20000),/250/);
  } finally {db.close();}
});
