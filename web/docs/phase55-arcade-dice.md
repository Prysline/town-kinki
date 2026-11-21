# 第55階段：單機優先——原版遊樂中心雙骰猜奇偶

日期：2026-11-21。開發分支 `feature/web-phase55-solo-arcade-dice`，目標合併 `feature/web-dual-mode-phase1`；根目錄原版 CGI 與 `master` 不修改。

## 一、原版執行證據

- 原版 `unit.pl` 的地圖「ゲーセン」連 `gamerand.cgi`；`gamerand.cgi` 將骰子遊戲入口指向 `saikoro.cgi`，模式為 `saikoro`。
- `saikoro.cgi::saikoro` 的 `$saikoro_game_time = 5`：玩家上次遊玩不足5分鐘不得再擲骰。
- 五種 `<option value>` 下注額依序為 **10,000／50,000／100,000／500,000／1,000,000** 元。
- 擲骰實際取 `$randed = int(rand(36))`（0～35），第一顆 `int($randed / 6) + 1`、第二顆 `$randed % 6 + 1`；36種骰面組合等可能，奇偶各18種。以總和 `% 2 == 0` 判偶數，選錯 `$money -= $rate`、選對 `$money += $rate`；勝利**不是**下注額乘二的淨收入。
- 原版 `saikoro_log.cgi` 總紀錄最多20筆。原碼 `$motiganeseigen = 'no'` 不禁止現金不足玩家下注；可能導致負現金，Web 特別保留差異說明。
- **本階段只移植骰子**。其他 `donut.cgi` 四種卡牌（含 High/Low）、`loto.cgi`、`loto6.cgi`、`fukubiki.cgi`、`cardw2.cgi`、`otakara.cgi` 等仍待逐個核對與移植；不要把一個入口說成整個遊樂中心已完成。

## 二、Web 玩家可操作功能

- `src/arcade-dice.mjs` 啟動時以原始 `gamerand.cgi`、`saikoro.cgi` 核實規則與來源是否仍相符；拒絕在來源不一致時默默套用其他概率或價格。
- 新建單機試玩街區的 **D9** 新增「ゲーセン」；總數自20格增為**21格**，其餘171格空白。只會在玩家自行確認、原本無地圖且無住宅的城鎮建立；既有地圖絕不覆寫。玩家也可自行在單機地圖編輯器擺放原版「ゲーセン」。
- `town-home.js` 把建築連到新 `games` 設施分頁的 `arcade-dice-panel`。選奇／偶及五種原價下注額後確認；畫面顯示目前冷卻、現金是否足夠、伺服器骰面與個人最近20局，使用安全 `textContent`。
- `POST /api/arcade/dice/play` 僅接受 `guess`、`stake`、`requestId`；骰面由伺服器 `crypto.randomInt(36)` 擲出，前端不能指定中獎、賭局結果或修改現金。單機依 `gameNow()` 計算冷卻，可使用既有單機遊戲時間快轉。多人仍採伺服器時間，資料按本人帳號隔離。
- `arcade_dice_rounds` 以 `BEGIN IMMEDIATE` 在單一 SQLite 交易內核對本人角色／所在地遊樂中心／合法賭注／本人五分鐘冷卻／現金餘額；再同時結算現金與寫入骰面、輸贏及當局金額。失敗全回滾，且相同 `requestId` 重送只回傳原始結果、不能改猜測或賭注；再玩必須產生新請求碼。
- 安全差異：為保護新 Web SQLite 存檔，**下注前必須具有足額現金**，勝利後不能超過安全整數。不同於原版不限制持現金。原版20筆是公共賽局紀錄，Web 本階段採**每位玩家可查看自己的20筆紀錄**，永久資料庫帳本不只保留20筆。這兩點不宣稱與原版完全等價。

## 三、驗收

- `tests/arcade-dice.test.mjs`：原始CGI來源與五下注額、36組骰面等機率、猜中與猜錯±下注額、5分鐘的299秒/300秒界線、防重送及改參數拒絕、現金與骰面輸入檢查、無建築／無角色、多帳號隔離、交易寫入失敗回滾、個人20筆紀錄與刪角色外鍵清除。
- `tests/server.test.mjs`：真實HTTP單機新角→未建遊樂中心拒絕→初始化21格試玩街區→實際下注結算現金→重送／冷卻／非法輸入拒絕→單機快轉5分鐘→第二局→停服後重啟相同SQLite核對現金／紀錄／地圖；另測多人兩帳號各自獨立骰子與冷卻。
- `tests/home-ui.test.mjs`、`tests/solo-starter-town.test.mjs`：地圖入口、安全 DOM、10組設施分頁與21格新建試玩街區；既有配置不覆寫。
- CI 綠燈不等於桌面、375px手機或實際玩家操作都已測過；此外原版全域 `$koudou_seigen` 與 Web 各系統獨立冷卻仍有差異，不在本切片臆測補完。

## 四、後續

單機優先選下一種有原始完整結算流程的遊樂中心小遊戲；候選 `donut.cgi` 的四種抽牌玩法、`loto.cgi`、`fukubiki.cgi`，逐一驗證真正押注／獎品／頻率後才實作。其他原版舊玩家 `member/<ID>/*` 私有存檔匯入不納入需求。
