# 第56階段：單機優先——遊樂中心 High／Low 猜高低卡牌

日期：2026-11-21。基線 `feature/web-dual-mode-phase1`（第55階段及翻譯 PR #65／#67／#68 已合併），本階段專用 `feature/web-phase56-arcade-high-low`，不修改原版 `master`。

## 一、原版來源與實際執行規則

- 地圖 `unit.pl::ゲーセン` → `gamerand.cgi` → `donut.cgi::donus4`（遊樂中心原文「High＆Low」），與同 CGI 的 `donus`／`donus2`／`donus3` **不同**。
- `donut.cgi` 原始 `$donuts_kakekin4 = "10000"`；依實際執行段落，每局基本輸贏 `$kingaku = $card_suu * 10000`，其中 `$card_suu` 是前次牌桌累積牌串長度，不是固定每次只賭10,000元。
- `$randed = int(rand(5))+1`：1～5點五種等可能抽牌，猜高為 `kake=hi`、低為 `kake=low`。新牌比上一張高且猜高，或新牌較低且猜低，判勝（`$money += $kingaku`）；方向相反判敗（`$money -= $kingaku`）。
- 原版固定 `$dorou='セーフ'`、`$doroubai=2`。**同點數不判平手退還，而是獲勝並把當局收益乘二**。贏則把新牌接在現有串尾端、下一局的基本金額增加10,000元；輸則將牌串重設為這次抽到的牌。
- 原始 `log_dir/donutslog4.cgi` 在此 fork 是 0位元組。空紀錄讀取時 `$do_narandacard=1` 形成一張數字1的桌面牌，但 `$do_hiitakard`（上一位實際抽到的牌）仍為空，在 Perl 數值比較中等同0。因此**第一局的「猜高」對任何1～5點抽牌都判勝，「猜低」判敗**；Web 保留並在介面揭露此原始行為，沒有自創一張隨機起始牌。
- `town_ini.cgi` 設定 `$crad_game_time='10'`，原版 `donus4` 對本人紀錄檢查 `60*$crad_game_time` 秒；另有 `$renzokuhiki` 旗標判定連續抽牌1次或同日3次，但這份 fork 的來源未證明旗標在遊戲期間被設定為 `yes`，不能斷言可無條件連抽。
- 原版以 `donutslog4.cgi` 作為**全玩家共用牌桌**，保存最多20筆的近期玩家紀錄；不是每人各有一副牌。

## 二、Web 實際功能

- `src/arcade-highlow.mjs` 啟動核對上述三份原始來源和關鍵勝敗式；`arcade_highlow_state` 維持共用牌串及上一張卡牌，`arcade_highlow_rounds` 留下注、原卡、抽牌、累積牌數、同點、輸贏、淨變化及時間供重播核對。
- 沿用單機試玩地圖 D9「ゲーセン」及第55階段的遊樂分頁（21格建築不變），在原本骰子下方新增 High／Low 操作：顯示上一張、累積張數、後20張牌、動態本局下注額、現金與10分鐘限制。按高或低後提交伺服器抽牌，成功後呈現實際結果與本人最近20局；不接受前端傳入抽牌、勝率或修改現金。
- `POST /api/arcade/highlow/play` 僅讀 `guess=hi|low`、`requestId`，伺服器使用 `crypto.randomInt(5)`，在 `BEGIN IMMEDIATE` 單筆SQLite交易內檢查本人城鎮確有建築、帳戶現金足額、本人冷卻，以及共用牌桌目前的真實張數；同時修改本人現金、共用牌串與交易帳本。失敗會完整回滾；重送相同請求碼只回傳相同結果，猜測不可更換。
- 單機採 `gameNow()` 遊戲時間，可用原有快轉10分鐘；多人採真實時間、本人獨立冷卻，所有玩家共用同一張牌桌。不同帳號的相同請求碼並不共用交易結果。
- Web 安全／適配差異：原始 `donus4` 的下注按桌面即時計算，Web在伺服器重新驗證足額現金且阻止金額溢出；Web **讓單機同一位玩家滿10分鐘即可續玩**，而不是嚴格套用「上一位玩家不可連續出牌」使單機永遠無法再玩；Web歷史顯示每人20筆，但保留更長的SQLite帳本。原始全域5秒行動限制 `$koudou_seigen` 尚未共用到Web所有交易，不可宣稱完全等價。

## 三、驗收

- `tests/arcade-highlow.test.mjs`：原始執行來源、首次空桌比較0、五張卡牌、猜高猜低、同點雙倍、累積張數下注、失敗重置、10分鐘邊界、跨玩家共桌與本人冷卻、防重送、非法亂數、錢不夠與溢出拒絕、失敗回滾、20筆可見歷史及刪帳號外鍵。
- `tests/server.test.mjs`：完整單機HTTP新角→未建場拒絕→試玩地圖→首次下注→現金結算與防重送→快轉5+5分鐘→次局→重啟同一SQLite檢查牌桌／現金／記錄，另驗證多人共桌但本人歷史隔離。
- `tests/home-ui.test.mjs`：原版 High／Low 來源說明、面板操作元件、安全DOM、伺服器提交，以及第55階段骰子功能與其他原本分頁不受影響。
- GitHub Actions CI 通過不代表已做實際桌面／手機瀏覽器操作驗收。

## 四、仍缺少的原版遊樂中心功能

`donut.cgi::donus`／`donus2`／`donus3` 其餘三種抽牌、`loto.cgi`、`loto6.cgi`、`fukubiki.cgi`、`cardw2.cgi`、`otakara.cgi` 等仍分開排查，不能因此宣稱整座遊樂中心完成；原版缺檔的 `slot.php` 與註解入口 `kuzi.cgi` 仍不應列為可玩。
