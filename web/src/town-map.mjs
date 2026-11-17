// TOWN 原版街道布局相容層。
// top.pl / admin2.cgi: 12 列(A~L) x 16 欄(1~16)，每一列在 <> 中佔 17 格（包含第 0 格）。
export const MAP_ROWS = 12;
export const MAP_COLUMNS = 16;
export const MAP_CELL_COUNT = MAP_ROWS * MAP_COLUMNS;
export const LEGACY_REQUIRED_FIELDS = 259; // 地名、三項城鎮數值、x及a~n的整列資料
export const LEGACY_FULL_FIELDS = 266; // 再加上地價與六個備用欄位

const BASE = [
  ["", "空白格", null, "empty"],
  ["空地", "住宅用空地", "akiti.gif", "lot"],
  ["空地2", "住宅用空地（二）", "akiti.gif", "lot"],
  ["空地3", "商業用空地", "akiti3.gif", "lot"],
  ["空地4", "商業用空地（二）", "akiti3.gif", "lot"],
  ["地", "預定建地", "kentiku_yotei.gif", "lot"],
  ["駅", "車站", "train.gif", "transport"],
  ["銀行", "銀行", "bank.gif", "facility"],
  ["職安", "職業介紹所", "work.gif", "facility"],
  ["役場", "市公所", "yakuba.gif", "facility"],
  ["病院", "醫院", "hospital.gif", "facility"],
  ["食堂", "食堂", "syokudou.gif", "facility"],
  ["食堂２", "食堂（二）", "syokudou.gif", "facility"],
  ["デパ", "百貨公司", "depart.gif", "facility"],
  ["デパ2", "百貨公司（二）", "depart.gif", "facility"],
  ["問屋", "批發商", "tonya.gif", "facility"],
  ["建築", "建築公司", "kentiku.gif", "facility"],
  ["競馬", "賽馬場", "keiba.gif", "facility"],
  ["温泉", "溫泉", "onsen.gif", "facility"],
  ["教室", "教室", "kyositu.gif", "facility"],
  ["ゲーセン", "遊樂中心", "game.gif", "facility"],
  ["自販機", "自動販賣機", "jihanki.gif", "facility"],
  ["装備屋", "裝備商店", "kaziya.gif", "facility"],
  ["ギフト屋", "禮品店", "gift.gif", "facility"],
  ["株", "股票交易所", "kabu.gif", "facility"],
  ["釣り", "釣魚", "blank.gif", "facility"],
  ["斡旋", "交友介紹所", "assenjo.gif", "facility"],
  ["プロフ", "個人檔案", "prof.gif", "facility"],
  ["アンケ", "問卷", "enq.gif", "facility"],
  ["Ｂリーグ", "B 聯盟", "mon.gif", "facility"],
  ["キャラ", "C 聯盟", "chara_battle.gif", "facility"],
  ["競売", "拍賣場", "auction.gif", "facility"],
  ["リサイ", "回收商店", "resai.gif", "facility"],
  ["合成", "合成商店", "gouseiyai.gif", "facility"],
  ["大仏", "大佛", "daibutu.gif", "nature"],
  ["鹿", "鹿", "sika.gif", "nature"],
  ["イルカ", "海豚", "iruka.gif", "nature"],
  ["みかん", "柑橘", "mikan.gif", "nature"],
  ["海", "海", "umi.gif", "nature"],
  ["草", "草地", "kusa.gif", "nature"],
  ["砂漠", "沙地", "sabaku.gif", "nature"],
  ["灯台", "燈塔", "toudai.gif", "nature"],
  ["木", "樹木", "sakura.gif", "nature"],
  ["道横", "橫向道路", "road/yoko.gif", "road"],
  ["道縦", "縱向道路", "road/tate.gif", "road"],
  ["歩道横", "橫向步道", "road/hodo_yoko.gif", "road"],
  ["歩道縦", "縱向步道", "road/hodo_tate.gif", "road"],
  ["信号", "交通號誌", "road/singou.gif", "road"]
];
for (let i = 1; i <= 9; i++) BASE.push(["道" + "１２３４５６７８９"[i - 1], "道路 " + i, "road/" + i + ".gif", "road"]);
for (let i = 1; i <= 4; i++) BASE.push(["街" + i, "城鎮連接 " + i, "mati_link.gif", "transport"]);
const entries = BASE.map(([key, label, image, category]) => Object.freeze({ key, label, image, category }));
export const MAP_SYMBOLS = Object.freeze(entries);
const symbols = new Map(entries.map(item => [item.key, item]));
const editKeys = new Set(symbols.keys());

export function tileIndex(row, column) {
  if (!Number.isInteger(row) || row < 0 || row >= MAP_ROWS ||
      !Number.isInteger(column) || column < 0 || column >= MAP_COLUMNS)
    throw new Error("無效的街區格子位置");
  // top.pl: 第一列從 $i=21，$yokoziku_bangou=1 開始。
  return 22 + row * 17 + column;
}

export function cellLocation(row, column) {
  tileIndex(row, column);
  return "ABCDEFGHIJKL"[row] + (column + 1);
}

export function emptyTownMap() {
  return Array.from({ length: MAP_CELL_COUNT }, () => "");
}

export function validateTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== MAP_CELL_COUNT)
    throw new Error("街區地圖格數不正確");
  return tiles.map(value => {
    if (typeof value !== "string" || value.length > 100 || /[\r\n<>]/.test(value))
      throw new Error("無效的街區內容");
    return value;
  });
}

export function parseLegacyTown(source) {
  if (typeof source !== "string" || !source.trim())
    throw new Error("原始地圖檔案沒有內容");
  const row = source.replace(/\r?\n$/, "").split(/\r?\n/)[0];
  const fields = row.split("<>");
  if (fields.length < LEGACY_REQUIRED_FIELDS)
    throw new Error("原始城鎮地圖欄位不足，至少需要 " + LEGACY_REQUIRED_FIELDS + " 個欄位");
  const tiles = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLUMNS; col++) tiles.push(fields[tileIndex(row, col)] ?? "");
  }
  return {
    originalName: fields[0],
    population: fields[1],
    economy: fields[2],
    prosperity: fields[3],
    landPrice: fields[259] ?? "",
    fields, tiles: validateTiles(tiles)
  };
}

export function serializeLegacyTown(map, originalName = "", landPrice = "0") {
  const tiles = validateTiles(map.tiles);
  const fields = map.fields ? [...map.fields] : Array(LEGACY_FULL_FIELDS).fill("");
  while (fields.length < LEGACY_FULL_FIELDS) fields.push("");
  if (!map.fields) {
    fields[0] = originalName;
    fields[1] = "0"; fields[2] = "0"; fields[3] = "0";
    fields[259] = landPrice;
  }
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLUMNS; col++) {
      fields[tileIndex(row, col)] = tiles[row * MAP_COLUMNS + col];
    }
  }
  return fields.join("<>") + "\n";
}

export function describeTile(raw) {
  if (typeof raw !== "string") return { key: "", label: "無法辨識的格子", image: null, category: "unknown" };
  // 原版玩家建築會使用 角色ID_...=空地 的形式。只展示標籤，絕不把 raw 當成圖片路徑。
  const [key] = raw.split("=", 1);
  if (symbols.has(key)) return symbols.get(key);
  if (/^\d+(?:_\d+)*$/.test(key) || /^\d+_[^\s<>]+$/.test(key)) {
    return { key, label: "原版居民建築（待匯入房屋資料）", image: "house_mini.gif", category: "house" };
  }
  return { key, label: "未識別原始地圖符號：" + key, image: null, category: "unknown" };
}

export function setTile(tiles, row, column, symbol) {
  if (!editKeys.has(symbol)) throw new Error("不支援的街區圖示");
  const offset = row * MAP_COLUMNS + column;
  tileIndex(row, column);
  const result = validateTiles(tiles);
  result[offset] = symbol;
  return result;
}

export function availableMapSymbols() {
  return MAP_SYMBOLS.filter(item => item.key !== "").map(item => ({...item}));
}
