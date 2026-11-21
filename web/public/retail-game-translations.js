// TOWN dat_dir/syouhin.cgi「ゲーム」原始 17 筆遊戲商品。
// 只有 UI 名稱及分類翻譯；原文商品鍵、來源行、SKU、原始效果／耐久均不變。
// 「ファイナルクエスト」「ドラゴンクファンタジー」是混搭作品名，採玩笑風格的暫定譯名。
// Wii Sports 與惡靈古堡（Wii版）修正原版商品名稱拼字或括號問題僅限顯示層。
export const RETAIL_GAMES_ZH_TW=Object.freeze({
  "ポケモン・コロシアム": "寶可夢圓形競技場",
  "ハローキティのおしゃべりABC": "Hello Kitty說說ABC",
  "ときめきメモリアル": "純愛手札",
  "ドラゴンクエストV 天空の花嫁": "勇者鬥惡龍V 天空的新娘",
  "ファイナルファンタジー XII": "太空戰士XII",
  "ファイナルクエスト": "最終冒險",
  "ドラゴンクファンタジー": "勇者鬥幻想",
  "TOWN 改造版": "TOWN 改造版",
  "ダービースタリオン": "Derby Stallion",
  "戦国無双": "戰國無雙",
  "逆転裁判バリューパック": "逆轉裁判超值套組",
  "ブラジャータウン": "胸罩鎮",
  "平成教育委員会　DS": "平成教育委員會 DS",
  "星のカービィ参上！ドロッチェ団": "星之卡比 怪盜洛切團登場！",
  "バイオハザード（wiiバージョン": "惡靈古堡（Wii版）",
  "キングダムハーツ2ファイナルミックス＋": "王國之心2 Final Mix+",
  "Wiisｐort": "Wii Sports"
});

export const displayRetailGameName=name=>RETAIL_GAMES_ZH_TW[name]??name;
export const displayRetailGameCategory=category=>category==="ゲーム"?"遊戲":category;
