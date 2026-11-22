# TOWN Web｜現行功能狀態與下一步計畫

> **現行狀態唯一入口**：本文件統一維護 Web 長期分支的功能完成度、證據界線、驗收與下一步優先序。校正基準：2026-11-22、`feature/web-dual-mode-phase1` 的 `e7cb0eb04af3152e15266136de42923cbcf66661`（PR #91／第67階段合併後）。**下一次使用時必須先確認最新 HEAD；本文 SHA 是稽核時間點，不是永久最新版。**
>
> 產品範圍與禁止事項以 [已確認的專案政策](project-scope-no-legacy-player-import.md) 為準；本文件只統一**現行狀態與排序**，不可推翻使用者確認的範圍。原始 CGI 決定可核對的原版行為；實際 Web 程式及測試決定已實作與自動驗證的事實；[技術差異矩陣](migration-audit.md) 保留原始功能 ID／CGI 來源；各 `phaseXX-*.md` 是當時技術證據與決策，**不是目前待辦**。文件與程式矛盾時，必須回到實際程式、測試、PR、CI 與必要的 CGI 查證，不得只挑較新的文字。

## 一、已確認的不變政策

- `master` 是**唯讀**原版 Perl／CGI；Web 長期整合在 `feature/web-dual-mode-phase1`；開發從最新 Web HEAD 開分支、僅變更 `web/**`。本文件的維護也遵守此限制。
- **單機優先**：新建角色 → 工作領薪 → 商店購物 → 背包及物品使用 → 住宅／事件／可單人設施 → 新版 SQLite 保存、繼續遊玩。優先修實際阻塞與資產風險；多人既有身分隔離、資產所有權、原子交易仍需回歸，**新增多人功能不是自動的下一階段**。
- **完全排除原版 CGI 舊玩家帳號、私人存檔、郵件、背包、銀行及房屋匯入／轉檔／相容驗收**（DB-01～DB-03）；原版 33 欄商品格式是新 Web 物品資料／玩法參考，不是舊玩家遷移任務。新版 Web SQLite 升級、備份、還原與資產保護仍必要。
- `log_dir/townlog0.cgi`～`townlog3.cgi` 都是空檔。**21 格單機街區是玩家明確選擇的 Web 試玩配置**，不是歷史原版地圖。不可要求從不存在的舊玩家地圖復原。
- 不依圖示、原始檔名、商品標籤或單一備註推斷可達玩法。原版不能定位實際分支的需求標記「待核實」；安全差異（如避免負現金）必須明示。
- **保留目前 Web SQLite 資料與資產**；任何版本更新不能直接覆寫玩家存檔。第67階段 CLI 備份完成不等於跨版本與正式部署保護全都完成。

## 二、完成度判讀規則

**實作狀態**限：未實作／部分實作／指定範圍已實作。後者僅表示表中明確描述的切片可運作，**不聲稱原版全功能等價**。**自動驗證**須寫明測試名稱、流程或仍待證據；既有 CI 可作回歸，但不得把舊測試改稱新玩法。**瀏覽器驗收**只能以實際 Chrome／其他瀏覽器、裝置尺寸、人工操作及留存結果證據標為已驗收；沒有證據一律「未驗」。**原版差異**獨立註記已知分歧、指定條件一致或待核實；不因 Node 測試全綠就寫「完全符合原版」。

本表沿用原始 75 個功能 ID 中的 **72 個現行／可追溯功能**；DB-01～DB-03 明列於「已排除範圍」，**不得當待辦**。一般行的「待核實」表示沒有在本次文件 PR 重測該功能的所有情境，不代表程式、API 或既有測試不存在。需要具體判斷時回查證據欄。

## 三、功能完成度矩陣

| 功能 ID | 功能名稱 | 實作狀態 | 自動驗證 | 瀏覽器驗收 | 原版差異 | 相關證據 | 剩餘工作 | 優先級 |
|---|---|---|---|---|---|---|---|---|
| PH-01 | 建立角色身高、體重與原始值 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/engine.mjs L145-L165 | 先查核：男／女依原版；Web 增設 other 預設值；須逐欄核對初始角色亂數 | P1 |
| PH-02 | BMI 五種體型 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs::legacyPhysiqueBmi／physiqueStatus | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| PH-03 | 職業 BMI 上下限 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/engine.mjs::eligibility；src/dining.mjs::legacyPhysiqueBmi | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| PH-04 | 飲食／工作增減重 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs L105-L125；src/engine.mjs L230-L240 | 先查核：公式對齊，累積四捨五入、極低體重與未記錄用餐相容仍需驗證 | P1 |
| PH-05 | 消耗品身高／體重 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/legacy-item-use.mjs L146-L179 | 先查核：僅可確認封存消耗品；不是原版整個物品流通與作用系統 | P1 |
| PH-06 | 狀態頁集中顯示 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；public/index.html::physique-summary；public/app.js::renderDining | 先查核：身高／體重、體型與 BMI 已移至狀態頁常駐摘要；真實手機與桌面瀏覽器操作未驗證 | P1 |
| PH-08 | 玩家圖示 URL／新角色圖示 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/appearance.mjs；public/app.js::renderLegacyIcon；src/legacy-character.mjs | 先查核：原版對戰可顯示 32×32 kounyuu；Web 僅由本人點擊預覽 HTTPS 已封存 URL，未支援原版對戰中對手圖示 | P2 |
| PH-09 | 原版公開真實個人檔案中的自選外貌描述 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；無完整 Web 真實個人檔案流程（詳 SC-04／SC-05） | 先查核：原版是獨立、玩家自願公開的真實個人檔案，並非從角色 looks、BMI 自動生成 | 後續／P2 |
| PH-10 | C 聯賽自創角色圖片 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無完整 Web C 聯賽資料模型 | 先查核：ch_gazou 是另一個可自訂圖像的比賽角色，與 kounyuu 不同；需要完整遊戲模組前置 | 後續／P2 |
| WK-01 | 能量上限及自然恢復 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/engine.mjs；src/server.mjs | 先查核：Web 有上限與恢復；需核對所有轉職／體格事件的加扣條件 | P1 |
| WK-02 | 工作薪資、經驗、冷卻 | 指定範圍已實作 | 第48階段 HTTP/SQLite 工作→銀行→百貨→物品→食堂，兩次 Node 重啟；薪資與防重送 | 未驗（無真人實機證據） | 該已核對的工作與出勤條件一致；其他邊界待核實 | [第48階段](phase48-core-gameplay-restart.md)、`tests/server.test.mjs`、[第67階段](phase67-solo-save-backup-restore.md) | 真人工作／領薪介面；極端長週期及未覆蓋原版條件 | P1 |
| WK-03 | 飢餓／疾病修正工作 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs L82-L103；src/health.mjs | 先查核：未用餐玩家以 provisional 5 經驗預設；非原版完整懲罰 | P1 |
| WK-04 | 職業需求數值表及現有能力對照 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/engine.mjs::parseLegacyJobs；src/server.mjs::snapshot jobs；public/app.js::jobRequirementsPanel／re | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| WK-05 | 薪資與獎金領取方式 | 指定範圍已實作 | HTTP/SQLite 領薪偏好、現金／銀行、帳簿、冷卻與重新啟動回歸 | 未驗（無真人實機證據） | 已確認核心薪資分流，未宣稱所有原版細節完全一致 | [第48階段](phase48-core-gameplay-restart.md)、`src/engine.mjs`、`tests/server.test.mjs` | 真人領薪 UI、跨版本偏好保存驗收 | P1 |
| WK-06 | 任職後工作再檢查條件 | 指定範圍已實作 | 引擎與 HTTP 實測選職後身高變更仍可出勤，重選拒絕；跨兩次 Node 重啟 | 未驗（無真人實機證據） | 已確認一致（僅選職／出勤兩種門檻的差別） | [第48階段](phase48-core-gameplay-restart.md)、`src/engine.mjs`、`tests/engine.test.mjs`、`tests/server.test.mjs` | 真人操作與未涵蓋職業極端條件 | P1 |
| WK-07 | 工作工廠職業投稿／清單 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 只載入 dat_dir/job.cgi 正式職業 | 先查核：原版允許提交候選職業到 joblog，並顯示投稿條件；不是直接加入正式職業表；此 fork joblog 0 bytes | 後續／P2 |
| TR-01 | 學校原始課程與使用說明 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs::parseLegacySchool、performTraining | 先查核：原版此 fork 根目錄沒有可執行 school.cgi；有資料和使用說明，無法對照原版實際付款、增益、時鐘執行 CGI | P1 |
| TR-02 | 學校每日一次 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs L75–106 | 先查核：每天一次有原始說明依據；跨日、切課、伺服器時區仍需驗證，原版 fork 無獨立 school.cgi 程式可比對 | P1 |
| TR-03 | 健身房課程資料與原版執行來源 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs::parseLegacyGym、performTraining | 先查核：本 fork 根目錄無可執行 gym.cgi；Web 暫把「間」作分鐘；不能將另一設施 kyushitu.cgi 的減重、信用付款等同健身房的原版效果 | P1 |
| TR-04 | 教室獨立訓練設施 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs::parseLegacyClassroom／performTraining；src/server.mjs::/api/train；public/index.html: | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| TR-05 | 教室訓練減重 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs::performTraining（type=classroom）、src/engine.mjs::bodyMassIndex | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| TR-06 | 教室信用物品付款 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/legacy-credit.mjs；src/training.mjs；src/server.mjs::/api/train；public/app.js | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| FD-01 | 原版雙菜單與售價三倍 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs::parseLegacyMeals；src/dining-stock.mjs；src/server.mjs::snapshot／api/meal/eat | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| FD-02 | 用餐 60 分鐘與熱量增重 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs L52-L69,L105-L125 | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| FD-03 | 每日隨機菜單與剩餘數量 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining-stock.mjs；src/server.mjs::snapshot／api/meal/eat；public/app.js／index.html | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| FD-04 | 飢餓分類與新 Web 角色保護 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs L52-L68,L82-L103 | 先查核：原版 3000 日刪角規則與 Web 保護不一致；不可直接破壞存檔 | P1 |
| MP-01 | 四城 12×16 格與圖示 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/town-map.mjs；public/town-home.js | 先查核：格子和圖示有實作；原始填充街區資料需另查 | P1 |
| MP-02 | 原版 townlog 匯入／地圖編輯 | 指定範圍已實作 | `solo-starter-town.test.mjs`、`server.test.mjs`：21格、拒絕覆寫、交易、重啟 | 未驗（無真人實機證據） | 已知差異：四份原版 townlog 為空；21格為明示 Web 試玩配置 | [第50階段](phase50-solo-first-play-audit.md)、`src/solo-starter-town.mjs` | 真人首次點擊、375/768px 與既有配置保護驗收；**不重做初始化** | P1（僅實機驗收） |
| MP-03 | 車站／交通票券與跨城成本 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/transport.mjs；src/server.mjs::/api/move；public/app.js；public/town-home.js | 先查核：四城六組票價與跨城扣現金已實作；實際原版其他交通券／道具是否有獨立效果仍需追來源 | P2 |
| MP-04 | 車站六組票價及跨城移動 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/transport.mjs；src/server.mjs::/api/move；public/app.js／town-home.js | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| MP-06 | 原版公路旅行與寶箱／百貨載具的交通功能 | 指定範圍已實作 | `road-travel.test.mjs`、`server.test.mjs`：公路、事故、迷路、巴士、18車及跨 Node 重啟 | 未驗（無真人實機證據） | 已知差異：手動選車；現金不足巴士拒絕，與 CGI 可成負數不同 | [第62](phase62-road-travel.md)～[66階段](phase66-road-retail-source-audit.md)、`src/road-travel.mjs` | 真人操作；受贈車永久來源鏈另立低優先議題，不重開五車限制 | P1 |
| MP-05 | 原版地圖互動入口覆蓋率 | 部分實作（入口盤點完成，設施不全） | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/town-map.mjs::MAP_SYMBOLS；public/town-home.js::FACILITY_PANELS／station | 先查核：43 個原版互動入口的現行代碼／可操作狀態依 [入口盤點](phase30-entrypoint-coverage.md) 為準；原始統計在第31～51階段後已過時。原版 gamerand. | P2 |
| HS-01 | 建屋／賣屋／改裝 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/housing.mjs；tests/housing.test.mjs | 先查核：基礎住宅有功能；全部特殊地形與交易規則未逐檔覆核 | P2 |
| HS-02 | 室內公告／留言與訪客權限 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/rooms.mjs；tests/rooms.test.mjs | 先查核：主流程存在；Web 住宅關聯資料的存檔持續性尚需驗證 | P2 |
| HS-03 | 商店／企業／分店／特殊住宅 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無完整 Web 對應模組 | 先查核：依賴商品市場、玩家間交易、房屋存檔、經濟模型 | P2 |
| HS-04 | 企業員工教育／員工紀錄 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；無 Web 企業員工訓練／名冊模型 | 先查核：原版可增員工、花費自身能力訓練員工、限制名額與間隔，含現金/信用分支；和普通住宅房間留言不同；原版部分付款及可達性須再核實 | 後續／P2 |
| BK-01 | 普通與定存、計息與帳簿 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs；tests/banking.test.mjs | 先查核：利率已有 Web 規則，計息觸發時點與原版不完全同等 | P2 |
| BK-02 | 玩家轉帳與額度 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs；src/server.mjs | 先查核：身份校驗與原子交易已載明；需逐項反查原始限制 | 後續／P2 |
| BK-03 | 住宅貸款及每日還款 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs；tests/loans.test.mjs | 先查核：負餘額與違約模式保留 Web 差異；無法稱為等價 | P2 |
| BK-04 | 原版定期徵稅 | 未實作 | 尚無針對原版跨日徵稅執行的 Web 驗證證據 | 未驗（無真人實機證據） | 已確認原版 `town_maker.cgi::login_view` 有徵稅路徑；Web 缺該流程 | `town_maker.cgi::login_view`、[來源重盤點](phase30-source-recheck.md)、`src/server.mjs` | 核實當前 Web 日期結算未執行的稅務扣款、風險與單機可達條件；定義安全入帳測試 | P1（先確認現行缺口） |
| BK-05 | 原版 A～E 股票市場及持股紀錄 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs 只有銀行／貸款模組，無股價交易 | 先查核：原版有獨立五類股價、持股、交易與清算記錄；不可因 Web 已有銀行而算股票已移植 | 後續／P2 |
| IT-01 | 原版 33 欄商品格式與 Web 背包 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/legacy-inventory.mjs；src/legacy-item-use.mjs | 先查核：Web 新商品使用原版 33 欄與已核實作用，不需舊玩家持有物匯入 | P1 |
| IT-02 | 可確認消耗品／耐久 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/legacy-item-use.mjs；tests/legacy-item-use.test.mjs | 先查核：只支援部分已封存物品效果，回／日與其他道具尚需逐項核對 | P1 |
| IT-03 | 百貨店一／二、販賣機、裝備／禮品／回收 | 部分實作（已完成多種商店交易） | 百貨與自販／裝備／寄禮等已有交易測試；第48階段百貨跨重啟驗收 | 未驗（無真人實機證據） | 各店鋪規則仍有可辨識缺口；不得以「僅單件現金」描述當前百貨 | [第31階段](phase31-department-checkout.md)、[第48階段](phase48-core-gameplay-restart.md)、`src/retail.mjs` | 已支援百貨 1～5 件與本人有效信用卡付款；僅補經證實未涵蓋的店別規則與真人 UI | P2 |
| IT-04 | 優惠券獲得與兌換 | 指定範圍已實作 | `coupon-redemption.test.mjs`、`server.test.mjs`：30件獎品、33欄、扣券、重送、重啟 | 未驗（無真人實機證據） | 已確認兌換核心；獎品後續效果非全部一致 | [第51階段](phase51-event-coupon-redemption.md)、`src/coupon-redemption.mjs` | 可取得獎品中尚未支援的**有來源**單人用途；真人兌換 UI | P1 |
| IT-05 | 原版釣魚與漁獲出售 | 指定範圍已實作 | `fishing.test.mjs`、`server.test.mjs`：買餌、釣魚、賣魚、冷卻、資產及重啟 | 未驗（無真人實機證據） | 已知差異：Web 庫存按本地日界重置，原版使用01時旗標 | [第53階段](phase53-fishing-economy.md)、`src/fishing.mjs` | 真人釣魚 UI；日界差異是否實際阻塞待核定 | P1 |
| IT-06 | 原版拍賣場刊登與結算 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 無該拍賣／結算流程 | 先查核：原版使用獨立拍賣紀錄與刊登、交付分支；不同於普通商店／回收 | 後續／P2 |
| IT-07 | 原版合成屋 | 指定範圍已實作 | `crafting.test.mjs`、`server.test.mjs`：12配方、材料、33欄、回滾、重啟 | 未驗（無真人實機證據） | 已知差異：全域 `$koudou_seigen` 與 Web 行動冷卻關聯尚待核實 | [第54階段](phase54-crafting-house.md)、`src/crafting.mjs` | 真人合成 UI；原版全域限制差異查證 | P1 |
| HL-01 | 疾病指數、症狀、工作限制 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/health.mjs；tests/health.test.mjs | 先查核：病症與工作停工已有規則；需逐病例覆核原始門檻 | P2 |
| HL-02 | 醫院治療與原始保險 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/health.mjs；src/inventory.mjs；tests/inventory.test.mjs | 先查核：30 天有效期、折扣已載明；舊道具與有效期基準仍有差異 | P2 |
| SC-01 | 私訊與玩家互動 | 部分實作 | `private-mail.test.mjs`、`server.test.mjs`：普通信、寄禮信共用50封、刪信、重啟、所有權 | 未驗（無真人實機證據） | 已知差異：已讀／通訊錄／K點附信仍未完成；bbs/tag 非同一功能 | [第49階段](phase49-unified-private-mail.md)、`src/server.mjs` | **私人信核心已完成**，不得當成未開發；其他社交、留言獨立低優先項 | 後續／P2 |
| SC-02 | 戀愛／婚姻／同居／育兒 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無完整 Web 對應 | 先查核：依賴角色關聯檔、多人帳號及安全同步 | 後續／P2 |
| SC-03 | B 聯賽決鬥／裝備／獎賞 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無完整 Web 對應 | 先查核：原版 battle.cgi 有對戰與結算；atakka.cgi 是 0 位元組資料檔，town_lib.pl::atakka 讀寫防濫用紀錄，**不是戰鬥 CGI**；裝備與其他 C 聯賽須 | 後續／P2 |
| SC-04 | 真實個人檔案自願登記／修改 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無 Web 個人檔案資料模型或表單 | 先查核：原版為玩家主動填寫的真實公開資料（性別／年齡／地址、5 組選項、15 題自由填寫），不是遊戲 looks／BMI | 後續／P2 |
| SC-05 | 個人檔案搜尋／分頁／傳訊入口 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無 Web 公開檔案搜尋 UI | 先查核：可依名稱、性別、年齡、住所與五選項查詢，每頁 10 筆並有傳訊入口 | 後續／P2 |
| SC-06 | 原版問卷建立、投票及管理 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 無獨立問卷投票系統 | 先查核：原版有建立問卷、選項、投票與管理分支，不等於登入畫面的事件通知或隨機事件 | 後續／P2 |
| SC-07 | 原版玩家投稿事件 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 隨機事件模組是 event.pl 的抽選；無 event.cgi 投稿流程 | 先查核：event.cgi 會寫玩家投稿文字、能力與金錢等欄，**不能混成 event.pl #01～#44 已移植**；投稿不是自動加入隨機事件表 | 後續／P2 |
| SC-08 | 原版遊樂中心各種遊戲入口 | 部分實作（第55～61階段子玩法已實作） | `arcade-*.test.mjs`、`server.test.mjs`：第55～61階段多種玩法、四寶箱、交易、冷卻與重啟 | 未驗（無真人實機證據） | 已知差異／未完：2010年到期福引不自動重開；部分獎品後續效果未全移植 | [第55階段](phase55-arcade-dice.md)、[第61階段](phase61-treasure-chests.md)、`src/arcade-treasure.mjs` | 已完成玩法只需真人 UI 驗收；獎品用途按實際來源立項 | 後續／P2 |
| GM-02 | 原版競馬 | 未實作 | Web 沒有競馬結算測試證據 | 未驗（無真人實機證據） | 原版 `basic.cgi::keiba` 有實際下注與結果，尚未移植 | `basic.cgi::keiba`、[第30階段差異](migration-audit.md)、`src/server.mjs` | 確認玩家可達、獨立下注／結算與資產風險，按單機價值另立 P2 | 後續／P2 |
| GM-03 | 弱／強おばちゃん挑戰 | 未實作 | Web 沒有弱／強挑戰交易測試證據 | 未驗（無真人實機證據） | 原版 `obatyan.cgi` 有可執行分支；目前 Web 未實作 | `obatyan.cgi::week/strong/battle`、`gamerand.cgi`、[來源重盤點](phase30-source-recheck.md) | 確認單機挑戰入口與獎勵，評估風險後排入玩法而非僅圖示 | 後續／P2 |
| SC-09 | 原版隱藏口令獎勵 | 未實作（原版可達性待核實） | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 無原版活動兌換或已領記錄 | 先查核：原始程式需隱藏口令且每人一次，先領五人與其他玩家獎勵不同；不能從原版片段自動重啟活動或公布口令 | 後續／P2 |
| AC-01 | 單人／多人角色與登入 | 指定範圍已實作 | `server.test.mjs`：單機／多人身分、會話與資料隔離 | 未驗（無真人實機證據） | Web 自建帳號安全模型，不追求原版密碼機制等價 | `src/server.mjs`、`tests/server.test.mjs` | 實機持續登入與公開部署安全檢查 | P1 |
| AC-02 | 單人刪角／繼續遊戲 | 指定範圍已實作 | `server.test.mjs`：單機角色刪除、重啟保存、跨日快轉 | 未驗（無真人實機證據） | Web 可繼續進度與單機時間；不等於全系統歷史持久化已逐一驗收 | `src/server.mjs`、`tests/server.test.mjs`、[第48階段](phase48-core-gameplay-restart.md) | 真人返回首頁／繼續、跨版本 SQLite 升級驗收 | P1 |
| AC-03 | 公開部署／管理權限／速率限制 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/server.mjs；README 安全限制 | 先查核：未有完整登入速率限制及公開部署審查；不宜公開直接部署 | 公開部署前門檻 |
| AC-04 | 原版個人設定及備忘錄／朋友清單／死亡通知 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 有獨立 solo 刪角及帳號登入，沒有等價的完整原版設定資料模型 | 先查核：原版備忘錄可保存、好友清單和字體／音效設定可編輯；死亡通知含密碼及原始關聯檔處理，不能用 Web solo 刪角代稱完成 | P2 |
| DB-04 | SQLite 遷移／還原 | 部分實作 |第48階段跨兩次 Node 重啟；第67階段 `solo-save.test.mjs`／HTTP 還原續玩、WAL、SHA-256、外鍵；PR #35 真實歷史 schema 子集升級已由 PR #94 驗證（合併前／後 push 與 PR CI 均成功）；PR #53 寄禮信箱舊 FK→雙階段升級及寄件者刪帳保護由 PR #96 補測，測試提交 push／PR CI 已成功（最終 HEAD 仍須重驗） | 未驗（無真人實機證據） | 不適用：新版 SQLite 保存與恢復，不以舊 CGI 匯入衡量 |[第67階段](phase67-solo-save-backup-restore.md)、`scripts/solo-save.mjs`、`tests/solo-save.test.mjs`、`tests/server.test.mjs`；[第68階段跨版測試](phase68-sqlite-pr35-upgrade-verification.md)、[第69階段舊信箱跨版測試](phase69-pr53-gift-mail-upgrade.md)、[PR #96](https://github.com/Prysline/town-kinki/pull/96) |**CLI 備份／驗證／新目錄還原已完成**；待跨 Web 版本升級矩陣、跨設備演練、定期管理與真人操作；其他 Web 歷史版本、跨 OS／設備仍待驗收，PR #96 不代表全面矩陣完成 | P1（驗收） |
| DB-05 | Web 自建個人檔案與職業投稿 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 尚缺完整建立／投稿功能 | 先查核：讓新玩家自行填寫，不匯入既有玩家資料 | 後續／P2 |
| UI-01 | 三欄位狀態切換與原始資訊 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；public/index.html L176-L202；public/app.js | 先查核：有 ARIA tab 與原版分頁；實機 375px/768px/桌機驗收缺少 | P1 |
| UI-02 | 事件通知及 20 秒挑戰 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；public/app.js；src/event-cockroach.mjs | 先查核：程式顯示與 API 存在；真實操作與動態尺寸未驗證 | P1 |
| UI-03 | 地圖、餐點與手機 RWD | 部分實作 | `home-ui.test.mjs` 靜態 DOM/文字；`browser-viewport-smoke.test.mjs` 在真實 Chrome 引擎自動觸發建角、工作、銀行、百貨、背包與 1440/768/375px 交互（PR #95 最終 HEAD push／PR CI 及合併後回歸均成功，714/714） | 未驗（無真人實機證據） | UI 響應、可用性與原版介面不可混為單一等價判定 | `public/index.html`、`public/app.js`、`public/style.css`、`tests/home-ui.test.mjs`、[Chrome 自動化測試](../tests/browser-viewport-smoke.test.mjs)、[PR #95](https://github.com/Prysline/town-kinki/pull/95) | 真人桌面／手機／平板實機操作、食堂／住宅／事件、鍵盤／畫面全面驗收仍缺；自動化不得作真人證據 | P1（驗收） |
| UI-04 | 部署／監控／備份 | 部分實作 | 第67階段 CLI／HTTP 備份後續玩測試已通過；正式部署測試無證據 | 未驗（無真人實機證據） | 不適用（部署與備份管理要求） | [第67階段](phase67-solo-save-backup-restore.md)、`scripts/solo-save.mjs` | 部署權限／HTTPS／速率限制、安全審查、定期備份輪替與還原演練 | P2 |
| UI-05 | 地圖教室獨立入口 | 指定範圍已實作 | `home-ui.test.mjs` 與 `server.test.mjs`：教室地圖導航及 HTTP 交易 | 未驗（無真人實機證據） | 已核對地圖教室與獨立學校的差別 | [第30階段教室](phase30-jobs-training-profile-audit.md)、`public/town-home.js` | 只需真人入口操作，不重建導覽 | P1 |

### 已排除範圍（保留既有 ID，不得轉回待辦）

| ID | 早期名稱 | 目前結論 |
|---|---|---|
| DB-01 | 舊 CGI 角色匯入 | **永久排除**：只核對新 Web 角色登入與新版 SQLite 保存 |
| DB-02 | 舊 CGI 物品匯入 | **永久排除**：33 欄格式可用於新 Web 購入的商品 |
| DB-03 | 舊 CGI 住宅／銀行歷史匯入 | **永久排除**：不轉移任何舊玩家私人資產 |

## 四、已完成成果與禁止重複階段

- **第1～47階段**：既有角色、登入、工作與職業、BMI／飲食／疾病、銀行／貸款、地圖、住宅／留言、事件／部分物品、百貨／商店交易、多人資產隔離與教室等已有實作及相應測試。個別規則差異見上表；不得用早期 README 的「未完成」一筆抹掉。
- **第48階段（WK-02／WK-06 等）**：完成原版選職與出勤重驗分流，以及單機**兩次 Node 重啟**的工作、銀行、百貨、用物品、食堂與冷卻／資產／交易防重送 HTTP／SQLite 回歸；多人兩帳號持續與隔離回歸。[證據](phase48-core-gameplay-restart.md)。**不能再寫核心遊戲循環尚未測試**。
- **第49階段**：普通私人信已與寄禮附信共用各人50封信箱，支援寄收、刪除、所有權／防重及重啟驗證；不要把「沒有獨立私人信」寫成現況。[證據](phase49-unified-private-mail.md)。
- **第50階段（MP-02）**：已完成可選擇、拒覆蓋既有地圖的單機試玩街區，隨第51～55階段擴充到**21格**；不得重新提出相同初始化功能。[證據](phase50-solo-first-play-audit.md)。
- **第51、53～54階段**：事件券30獎品實際兌換、釣魚／買餌／賣魚、12種合成配方已接入正式 API、SQLite 扣款／入庫／防重與測試；獎品額外用途另列。
- **第55～61階段（SC-08）**：遊樂中心骰子、High／Low／抽牌、兩種樂透、多卡與四種寶箱已分階段實作並測試；福引是否開辦與寶箱獎品之後如何用，不可混成「遊樂中心未移植」。
- **第62～64階段（MP-06）**：公路徒步／載具、事故扣耐久與鍛鍊、迷路／改道、500元巴士與跨重啟持久旅程已實作。[證據](phase62-road-travel.md)、[迷路](phase63-road-lost.md)、[巴士](phase64-road-bus.md)。
- **第65→66階段（MP-06）**：第65階段五車限制已被第66階段原版來源重查**取代**；兩間百貨可購買並使用 **18筆合法交通商品＝11筆「乗り物」＋7筆「ギフト」**，包含六筆標註「専門店限定商品」的車，該備註只限制問屋進貨，**非百貨上架禁令**。跨玩家受贈車缺少持久來源鏈是另一個非單機首要問題。[證據](phase66-road-retail-source-audit.md)。
- **第67階段（DB-04）**：`scripts/solo-save.mjs` 已完成 SQLite WAL 一致備份、SQLite 完整性／外鍵／SHA-256 驗證、絕不覆寫既有資料的新 `DATA_DIR` 還原；`solo-save.test.mjs` 與 `server.test.mjs` 實測 HTTP／SQLite 備份→還原→續玩。PR [#91](https://github.com/Prysline/town-kinki/pull/91) 合併時 **712項自動測試通過**。**CLI 備份不再是待開發功能**；跨版本矩陣與部署備份管理另列。

## 五、真正未完成的單機缺口（不是純驗收）

下表只收錄已有原版執行路徑與可辨識 Web 缺口的項目。所列優先級不代表可以略過實際玩家可達性、資產安全與範圍再核查。

| 功能 ID／工作種類 | 原版執行來源 | Web 現有基礎與具體缺少的行為 | 玩家可達性、依賴、資產風險 | 優先與可觀察的完成條件 |
|---|---|---|---|---|
| **IT-02／原版等價性修復（逐個效果）** | `basic.cgi::item_do`、`dat_dir/syouhin.cgi` 與相關設施 CGI | 已有 Web 33欄背包、購物、一般消耗／耐久、事件券與寶箱實體獎品；**不是所有實際取得獎品的特殊效果都可用** | 單機可經百貨、事件券、寶箱獲得；應先按商品效果／來源核查玩家是否實際取得、是否有可執行原版效果；風險為耐久、能力、資產重複扣除 | **P1（限已確認可取得且有來源的單人效果）**：先列出一個確實不可用的 SKU、原版分支及 API 行為，再實作或修正，測試真實取得→使用→重啟／防重；不可將全部商品名稱當任務 |
| **BK-04／原版玩法差異修復（待單機可達性再排序）** | `town_maker.cgi::login_view` 跨日徵稅 | Web 已有個人金錢、普通／定存、跨日計息與資產帳簿，但原版定期徵稅執行路徑未接入 | 登入／跨日循環可能觸發；需先核對原版時間／免稅／金額及是否對單機實際發生，避免直接複製負存款與破壞現存資料 | **P1 候選（核實後）**：形成可重現的單機跨日案例、原版明確公式、一次性安全扣款／入帳／錯誤回滾與升級相容測試 |
| **GM-03／可獨立單機玩法（非當前 P1）** | `gamerand.cgi` → `obatyan.cgi::week/strong/battle` | Web 已有獨立遊樂中心交易基礎，但沒有弱／強挑戰的實際戰鬥結算與掉落 | 是否能進入需以城鎮實際入口和原版限制核對；可能更動生命／能力／獎品，風險高 | **P2**：先鎖定單機可達入口、兩難度規則及實際獎勵；只有完整扣款／能力／物品原子結算與回歸才算完成 |
| **GM-02／競馬（非當前 P1）** | `basic.cgi::keiba` | 原版有實際投注、限制、結果結算；Web 尚無同等投注／結算 API | 依原版可執行功能，但真實街區資料為空；必須確認 Web 單機可達配置與獎金安全 | **P2**：明確單人可達性、下注上限與結算，避免無來源「只有圖示就加賽馬」 |
| **HS-03／住宅商店特殊用途（分段後再排序）** | 住宅／商業 CGI 的相應可執行分支，見 [差異矩陣](migration-audit.md) | 建屋、出售、改裝、留言已存在；室內進階商業及特殊互動仍缺 | 有可建屋基礎但與所有權、對外交易及多人安全耦合 | **P2**：先確認單機真有可操作的原版功能與建置成本，不能把已有住宅重做 |

**待核實、不得自動升格為新功能**：學校／健身房在此 fork 缺少原版可執行 CGI；只有課程資料和使用說明；原始城鎮街區檔為空；原版已過期福引是否可再開啟沒有新政策；遊樂中心的各種圖示、寶箱獎品與不存在的「專門店」不能單憑名稱推演全套玩法。其他多人、社交、股票、拍賣、公開個資／投稿與企業依原版及安全需求分開核查，**暫非單機優先**。

## 六、尚待驗收（與新增功能分離）

| 工作類型 | 現況／已有證據 | 尚須完成的可觀察驗收 |
|---|---|---|
| **真人桌面瀏覽器** | Node HTTP、DOM 與 SQLite 測試已涵蓋主要循環；無真人點擊錄影／截圖證據 | 真正用桌面 Chrome/Firefox 建角→工作與領薪→百貨購物→背包使用→食堂／住宅／事件→離開再繼續；檢查每步角色、金錢、道具、冷卻與錯誤提示 |
| **375px 手機／768px 平板** | 有 CSS/RWD 與 DOM 測試，但不等於兩種視埠已人工驗收 | 實際瀏覽器在 375、768px 操作導航、地圖、彈窗、狀態／背包／冷卻、券、合成、釣魚、公路；紀錄水平溢出與點擊失敗 |
| **新版 Web SQLite 升級矩陣** | 第48階段同資料夾重啟、第67階段備份／新目錄還原已通過；PR #94 完成 PR #35 真實 schema 子集跨版測試（兩次合併前／後 CI 成功）；PR #96 新增 PR #53 寄禮信箱歷史 FK 無損升級切片（測試提交 push／PR CI 已成功，最終 HEAD 合併前仍須同樣成功） | 按確定舊 Web schema 版本建立資料樣本→備份→升級→重啟，逐一核對現金／銀行／背包／住宅／事件／冷卻／多種設施；失敗不得毀損來源 |
| **不同設備與環境還原** | 已有 CLI WAL 快照、SHA-256、驗證與不覆寫還原 | 在不同 OS／檔案系統／權限與實際部署路徑操作；驗證完整性與恢復續玩，不能把 CLI 完成寫成演練完成 |
| **定期備份管理／正式部署** | 手動 `solo-save.mjs` 已可用；不代表有輪替排程、監控、金鑰或遠端保存 | 若要正式公開部署，實作／驗證排程、保留政策、告警、離線副本、HTTPS／Session／速率限制與資產權限；先經部署安全審查 |
| **多人安全回歸** | 現有隔離、單筆交易、防重送與刪帳後資料持有權已有自動測試；第49階段私訊亦涵蓋 | 修改共享規則或 schema 時核對兩帳戶、資產所有權、併發、回滾；**不因此新增多人功能** |
| **原版局部差異驗收** | 工作條件、魚餌庫存刷新、交通手動選車／巴士安全限制等有明確紀錄 | 只對影響玩家且有來源的差異開修復；來源不足者不宣稱完整等價，也不作必修計畫 |

**已解除的 CI 時鐘測試阻塞（2026-11-22）**：`coupon-redemption.test.mjs` 原以固定 `2026-11-21T10:00:00Z` 兌換一日獎品、卻以真實時間查詢背包，造成 #109、#112 失敗。已由獨立 [PR #93](https://github.com/Prysline/town-kinki/pull/93) 僅修改測試檔，統一查詢時鐘，並補測到期前 1 毫秒可見、到期時不可見；該 PR 的 [push CI](https://github.com/Prysline/town-kinki/actions/runs/45014745689) 與 [pull_request CI](https://github.com/Prysline/town-kinki/actions/runs/45014761000) 均已成功，修復已合併 Web 長期分支。此問題不是兌換遊戲功能退化，文件 PR 仍僅修改 Markdown。

**已完成 Chrome 自動化（PR #95，合併後 Web SHA `2ab61554ab94f9db0c71a6f4d791c1a72cc39d19`）與真人驗收分離**：`tests/browser-viewport-smoke.test.mjs` 使用真實 Chrome/Chromium 引擎在 1440px、768px、375px 視埠執行前端滑鼠點擊與頁面狀態，覆蓋建角、已預設日薪工作、單機試玩街區、銀行存款、百貨選品購買、背包、首頁離開／繼續。[最終 HEAD push CI](https://github.com/Prysline/town-kinki/actions/runs/45022217905)、[PR CI](https://github.com/Prysline/town-kinki/actions/runs/45022224039) 與[合併後 push CI](https://github.com/Prysline/town-kinki/actions/runs/45022371805)、[PR #1 回歸 CI](https://github.com/Prysline/town-kinki/actions/runs/45022376153) 已成功；這些切片**已自動測試**；仍**沒有真人在桌面、平板或手機現場操作的證據**，不涵蓋全部遊戲設施及不同 OS 實機。

**跨版本矩陣驗收（PR #94／#96）**：PR #94 以 PR #35 當時百貨收據 schema 子集做無損備份→升級→資產延續，合併後 [Web push](https://github.com/Prysline/town-kinki/actions/runs/45021154461) 與 [PR #1 回歸](https://github.com/Prysline/town-kinki/actions/runs/45021159489) 成功。PR #96 另選 PR #53 的寄禮信件 `event_id` 舊外鍵（刪交易會連刪收件者信），測試兩段 v2／v3 升級以及刪寄件者後的收信與收禮保護；PR #96 的[測試提交 push CI](https://github.com/Prysline/town-kinki/actions/runs/45024428062) 與 [PR CI](https://github.com/Prysline/town-kinki/actions/runs/45024449683) 成功；**最終 HEAD 仍須 push／PR CI 雙成功才合併**。兩者都不是完整歷史 Web 版本矩陣，更不是不同 OS／設備的真人還原。詳見[第69階段](phase69-pr53-gift-mail-upgrade.md)。

**已測不等於已人工驗收；待真人驗收不等於 API 未實作。** 只有真實驗收紀錄、具體裝置／版本／步驟／結果才允許把「未驗」更新為「已驗收」。

## 七、下一階段優先序（只選仍有缺口）

1. **P0（發現即先做）**：單機無法建角／獲薪／購物／使用／繼續遊玩，或經證實造成資產丟失、SQLite 損毀、越權與重複扣款的問題。當前**未憑文件發現尚待實作的 P0**；不得無根據建立新 P0 階段。
2. **P1／驗收**：第48與67階段已測循環的真人桌面／375／768px 操作；新版 Web schema 跨版本升級與不同設備還原演練。這是**驗收階段，不是重寫循環或重做 CLI 備份**。
3. **P1／功能差異**：從玩家確實可取得並有原版可執行效果的商品挑選尚未接通的特殊用途（IT-02），或查實 BK-04 的單機跨日徵稅缺口。每案需先記可重現條件、已存在程式、缺失行為、資產風險與驗收條件。
4. **P2**：非阻塞 UI、特殊住宅／來源待核的遊樂玩法、競馬；後續才考慮跨玩家寄禮來源鏈、股票／拍賣、社交、投稿、公開檔案／企業等。不得只依可完成難度或原版 CGI 檔數排序。

## 八、防止再次重複開發：每次新階段及 PR 的強制門檻

**開階段前五項對照**：①最新 Web HEAD 現行程式是否已有功能與 API；②已有單元、HTTP、SQLite、重啟與 CI 測試哪些情境；③先前 PR／階段在哪個 SHA 已完成；④尚缺的**可觀察玩家行為或驗收證據**；⑤對新 Web 單機玩家增加的實際價值、依賴與資料風險。五項無法確定即標「待核實」，**不可只因 phase30/README 的「待完成」開發**。

**分開記錄工作種類**：每項新增任務必選「新功能／原版等價性修復／錯誤修復／測試補強／真人操作驗收／文件維護」。補測試是驗證，不是新玩法；補文檔是維護，不是功能移植；真人驗收不應讓已測 API 回到未實作。

**真正功能 PR 每次更新本檔對應原始功能 ID**：新證據填入實作、自動驗證、真人驗收、原版差異、相關 PR／程式／測試、剩餘工作和優先級各欄。完成項目結案或縮小剩餘範圍；若未改本檔，PR 應說明為何現行狀態不變。不得只新增 phaseXX 文件讓本檔過時。歷史文件為來源追溯，**不能直接決定下一階段**。

**不重複包裝舊測試**：既有「建角→工作→銀行→百貨→道具→重啟」照常由 CI 回歸，但沒有**新風險情境或修正實際缺陷**，不應重做成新階段。新增驗收須寫出原回歸不包含的瀏覽器、版本、設備或資產風險。

**狀態更新紀律**：只有 Web 程式與測試、相關 PR 合併、CI 的**實際證據**能改成已實作／已測／已驗收；有文件與程式矛盾先回查，必要時再查對應原版 CGI。每次 PR 合併後核對最終 Web HEAD，勿把本檔的舊 SHA 當最新。

## 九、交接查核快速入口

- [README 操作及部署限制](../README.md)／[早期 README 完整歷史紀錄](README-HISTORICAL-NOTES.md)。
- [原版 CGI／Web 詳細差異、原始功能 ID](migration-audit.md)；[第30階段歷史待辦](phase30-open-audit-backlog.md)；[原版43互動入口歷史清冊](phase30-entrypoint-coverage.md)。
- [單機優先與試玩街區](phase50-solo-first-play-audit.md)；[第48階段跨重啟實測](phase48-core-gameplay-restart.md)；[第66階段18車來源](phase66-road-retail-source-audit.md)；[第67階段備份還原](phase67-solo-save-backup-restore.md)；[第68階段百貨舊收據](phase68-sqlite-pr35-upgrade-verification.md)；[第69階段寄禮信箱](phase69-pr53-gift-mail-upgrade.md)。
- [原版舊玩家匯入排除政策](project-scope-no-legacy-player-import.md)；[最新合併 PR](https://github.com/Prysline/town-kinki/pulls?q=is%3Apr+is%3Amerged)；[CI](https://github.com/Prysline/town-kinki/actions)。

此檔不修改原始 CGI、Web API、遊戲規則或 SQLite schema；只為下次開發提供可回查的現行判讀與排序。
