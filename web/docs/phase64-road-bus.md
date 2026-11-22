# 第64階段：原版 mati_idou2 巴士移植（500元、5秒、無事故及迷路）

日期：2026-11-22。以即時 `feature/web-dual-mode-phase1` HEAD `8f1f512bbe9804e112264651b450f1252689be2c` 新開 `feature/web-phase64-road-bus`。第61～63階段功能保持不變；原版 `master` 維持 `f74e077780ed96f9b271f66e5afe63037c7c7403`，不修改原 CGI 或玩家原始存檔。

## 原版實際執行順序（必須讀原始碼而非臆測）

- `town_lib.pl::header` L540～541：要求已登入；`mati_idou` 與 `mati_idou2` 先進入共用的公路選車及迷路抽選區塊。從編號3城出發不抽迷路；其他城若持有輪滑車必迷路，否則1/5，這是巴士判定之前的暫存結果。
- `town_lib.pl` L570～581：`mati_idou2` 明確將 `$maigo='no'`，`$idousyudan="バスで500円で"`，`$ziko_idousyudan="バス"`，`$matiidou_time2=5`，`$money -= 500`，隨後 `temp_routin`、`log_kousin` 寫入玩家存檔。這段發生在徒步／自行車能力鍛鍊分支之前，所以巴士不屬於兩種可鍛鍊交通方式。
- `town_lib.pl` L641～646：原版仍執行事故隨機抽選，但 `if ($ziko_idousyudan eq 'バス'){$ziko_flag = "off";}` 隨即覆寫事故；之後以 `time+$matiidou_time2` 產生倒數結束時刻。巴士不進入有效事故分支。
- `town_maker.cgi::login_view` L271～329：只有事故旗標 `on` 且不是徒步才扣車輛耐久；迷路加事故才可能 `rand(4)` 改道，純迷路會顯示訊息但不覆寫目的地。對正常 `mati_idou2` 而言，先前旗標已被設定為事故 `off`、迷路 `no`，因此不扣任何載具耐久、不迷路、也不改道。
- **原版風險／Web 明示差異**：CGI 直接 `$money -= 500`，沒有先檢查現金餘額。Web 為避免 500 元巴士造成負現金，要求現金至少500元並回覆錯誤；不足時不建立行程、不扣款。這是刻意的安全保護，不能宣稱與 Perl 負現金行為百分之百相同。

## Web 實作範圍

- 保留 `POST /api/road/start`、`POST /api/road/arrive`；開始請求新增可選 `byBus: true`，且只在 `vehicleSourceLine:null` 時接受。舊客戶端未傳 `byBus` 時預設 `false`，原徒步、20種載具、1/10事故與迷路邏輯完全不變。
- 來源解析 `parseOriginalRoadTransport` 驗證實際原版巴士分支的500元、5秒、迷路清除、事故強制關閉、角色存檔寫入。API 回傳 `roadTravel.busFare`、`roadTravel.busSeconds`，客戶端不提供可自訂車資、秒數、事故或迷路的欄位。
- `arcade_road_trips` 增加 `by_bus INTEGER NOT NULL DEFAULT 0` 與 `fare_paid INTEGER NOT NULL DEFAULT 0`。既有第62／63階段行程透過 `PRAGMA table_info` 條件式 `ALTER TABLE` 無損升級；舊資料的巴士旗標及車資皆為0，不修改目的地、狀態、事故、鍛鍊或完成時間。
- 開始巴士行程時，在同一個 `BEGIN IMMEDIATE` 裡驗證本人當前城鎮、行程互斥、本人有效現金、同請求碼既有結果；以 `UPDATE characters SET money=money-500 ... money>=500` 原子扣款，接著寫入持久行程。DB 寫入失敗則 `ROLLBACK` 同時退回500元。相同 `requestId` 相同內容重播回既有行程，不重扣；改巴士／徒步、目的地或載具則拒絕。
- 巴士行程 `vehicleName="バス"`、`byBus=true`、`farePaid=500`、`seconds=5`、`exercise={}`、`lost=false`、`accident=false`、`rerouted=false`。即使持有輪滑車也不抽迷路，並跳過徒步的五種鍛鍊與事故耐久處理。按遊戲時間達5秒後才能抵達，讀取狀態不自動完成。跨進程重啟仍能依 SQLite完成。
- 與徒步／載具共用每人單一未完成行程的 SQLite 唯一索引；未完成旅程不能開第二趟或搭電車。非本人不能抵達，與既有 `/api/move` 的電車原票價及權限完全分離。
- UI 於既有交通下拉選單加入「巴士（500元、5秒）」；明示現金不足、確認時標明不迷路／無事故／不鍛鍊；已出發顯示倒數、到站才確認結果、歷史列出已付500元。採用 `textContent` 和 DOM 元素，不引入未消毒的 HTML。

## 測試與未完成驗收

- `web/tests/road-travel.test.mjs`：巴士來源防改；5秒、500元、不迷路／事故／鍛鍊；持有輪滑車也不迷路；過早到站拒絕；重播／不同模式同碼拒絕；無資金、非法參數、SQL觸發失敗回滾；多人互不扣款／不可互代到站；舊第62階段SQLite升級多了兩欄且舊行程仍可抵達。
- `web/tests/server.test.mjs`：單機HTTP本人的真實扣款、跨重啟待到站／快轉後到站、結果與電車回歸；多人HTTP本人現金不足、別人不能完成其行程、相同請求碼在不同玩家仍獨立。
- `web/tests/home-ui.test.mjs`：巴士UI文案、選單、參數、文字輸出安全，以及第62／63階段既有DOM斷言。
- 全量 `npm test` 與 GitHub Actions 需以該分支最終提交的 **push**／**pull_request** 兩組工作流程核對，只有雙 CI 成功才能合併；合併後再核對兩組 CI與 `master` 不變。
- **桌面及手機瀏覽器的人工視覺／互動驗收仍未完成**，即使自動化 CI 全部通過也不可視為已人工驗收。

## 明確不包含

不擴張其他商店來源載具、不修改 Perl 無序 Hash 自動選車、不調整車站電車既有定價、不重建原版空白城鎮配置或覆寫單機21格試玩街區、不匯入或更改舊玩家存檔。
