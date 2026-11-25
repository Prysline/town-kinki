# TOWN Web｜現行功能狀態與下一步計畫

> **現行狀態唯一入口**：本文件統一維護 Web 長期分支的功能完成度、證據界線、驗收與下一步優先序。歷史校正基準（最新戰鬥接續基準見下節）：2026-11-22、重新查得 `feature/web-dual-mode-phase1` 的 `78cb041da5865e856c81bb2a2951165f2f28a203`（PR #96 合併後、本次文件修正前）；[Web push CI](https://github.com/Prysline/town-kinki/actions/runs/45024849335) 與 [長期 PR #1 回歸 CI](https://github.com/Prysline/town-kinki/actions/runs/45024853651) 均 success（715/715）。**下一次使用時必須先確認最新 HEAD；本文 SHA 是稽核時間點，不是永久最新版。**
>
> 產品範圍與禁止事項以 [已確認的專案政策](project-scope-no-legacy-player-import.md) 為準；本文件只統一**現行狀態與排序**，不可推翻使用者確認的範圍。原始 CGI 決定可核對的原版行為；實際 Web 程式及測試決定已實作與自動驗證的事實；[技術差異矩陣](migration-audit.md) 保留原始功能 ID／CGI 來源；各 `phaseXX-*.md` 是當時技術證據與決策，**不是目前待辦**。文件與程式矛盾時，必須回到實際程式、測試、PR、CI 與必要的 CGI 查證，不得只挑較新的文字。

## 2026-11-26｜逐項驗收合併政策（使用者已確認）

- 自本日起，已完成且核准範圍內的 PR 在最新正式 Web 基準上取得同一 HEAD 的 push/PR 全綠、核對差異與保留舊功能後，逐項合併至 `feature/web-dual-mode-phase1`；合併後再核對正式分支 HEAD/tree/CI，下一項從新基準開分支。不得等全部 F～J 才整合。若有新玩法/數值/範圍決策、CI 失敗、衝突或未確認資料，保留 Draft、先解決；master 與長期 #1 仍不可合併。此政策取代下方歷史記錄中逐次另行授權已驗收 PR 合併的流程，不改其他不變政策。
- #122 已合併，正式 HEAD `a32ca02f6dc843d8d65582e6c4e2a2dd97e2d50a`，tree 與已驗證 HEAD 8682e560c95b21a76363dca49784108f3f6bfe59 相同。兩組 CI 886/886。F 測試/來源審查完成；新冷卻規則未核准，維持現況。
- G #123/#124：三輪184案已實際完成，#124 HEAD `61f6f15b71980f66a295d5e4707911eb4e0a5296` 的 push 45685064869 / PR 45685077081 均889/889。#123 PR HEAD 仍為5ccc1fd、分支實為81303e1，故不能盲合併。此整合候選將G兩檔原封保留，僅在已合併F的 server.test.mjs 加入G兩處時鐘校準，更新本計畫；待新基準的聯合CI，方可合併並標記原兩PR由聯合PR取代。G結果不代表調參核准。
- H #125 HEAD 8e11f02c8522edb07dc9fc9c643f6b47027794e1：新Chrome B/大阪測試兩組皆成功，PR 886/886、push 885/886（既有Chrome DevTools啟動失敗）。待G整合後同步正式基準，修復啟動診斷並驗證；不可跳過失敗。I/J未開始；#107翻譯待書名決策。

## 2026-11-25｜戰鬥系列 A～E 已正式整合、F 接續

- 正式長期整合分支 `feature/web-dual-mode-phase1` 已合併 [#121](https://github.com/Prysline/town-kinki/pull/121)，HEAD `e2e3004ad9af13021c4bae540863f9ca26e34b10`；#115～#119 已由聯合 PR 取代並關閉，保留原分支與提交。#114、#120 內容均納入。合併 tree 與驗證 HEAD `9269d53b4c2e0fc884c003743ff1c82e3abd6301` 相同，合併前 [push](https://github.com/Prysline/town-kinki/actions/runs/45590519566) 與 [PR](https://github.com/Prysline/town-kinki/actions/runs/45590556198) 均 885/885。
- 合併後 [push](https://github.com/Prysline/town-kinki/actions/runs/45590908022) 884/885（IT-02 食物快轉 HTTP 409），[PR #1](https://github.com/Prysline/town-kinki/actions/runs/45590912408) 885/885；非戰鬥回歸失敗仍須處理。master 唯讀，A～E 不重新立項；真人、經濟、F～J 仍待驗收。
- 本輪由正式 HEAD 開 `test/web-phase-f-clock-matrix`，修正既有測試時間初始化並補 F 固定毫秒跨玩法矩陣。此新分支尚待 CI，不將舊 HEAD 全綠當作新驗收。

| 階段 | 原始 PR / HEAD | 已正式整合範圍 | 剩餘界線 |
|---|---|---|---|
| A | [#115](https://github.com/Prysline/town-kinki/pull/115) `a3cf013f8d6c99e9c48138232c3469c4c44c6854` | B 聯賽五級、裝備耐久成長、獎賞／藥草 | 真實操作、經濟、全域冷卻 |
| B | [#116](https://github.com/Prysline/town-kinki/pull/116) `c4b498b4963e5775f3cbe4f8c9d629fac7b4588d` | 大阪弱強、八獎品、核准十名重建 NPC、原版來源優先及收據版本 | 原版十筆 NPC 檔仍缺；不冒稱原版 |
| C | [#117](https://github.com/Prysline/town-kinki/pull/117) `1a76168530741c506fc9d240f09acdd54bb734eb` | Street Fight、原版末列排除／本人無對手、15000 元現金門檻、負 K 點 | 單機不虛構對手；全域間隔待查 |
| D | [#118](https://github.com/Prysline/town-kinki/pull/118) `2e71c449348b35f37deaef556d183adcd005d4ce` | C 聯賽培育、模仿者、14日100場60秒、信用不足拒絕、原版零能量判定 | 外部圖片連結而非自動載入；真人與經濟 |
| E | [#119](https://github.com/Prysline/town-kinki/pull/119) `db2e8ec950e7381f3a2c98dc8b7830605f241553` | #26/#34 保留並驗證、#38 力量1000與六種原版掉落／25列容量 | #36/#37 未移植，不擅改每日抽選 |

整合驗證共 44 個 web 檔案（43 原始差異檔＋1 審查文件），8 個共用檔案已協調；修正 B 聯賽有號 K 點，銀行結算與稅基交易一致性。聯合多人跨玩法、各模組相同請求碼、重送、帳號隔離、SQLite 重啟／外鍵、單機刪角、B聯賽／大阪／#38 稅基溢位回滾均通過。詳見 [battle-integration-check.md](battle-integration-check.md)。不得再將 A～E 列為從零開發。

### 戰鬥系列後續 F～J（F 已開始，其餘未開始）

2026-11-25：#120 已合併至驗證分支，來源審查與現況測試已通過 884/884；見 [F 行動間隔與跨玩法冷卻審查](phase-f-action-cooldown-audit.md)。原版是城鎮 access gate，不能直接等同所有 Web POST 的 5 秒鎖。尚未核准操作頻率改變；F 仍待決策與補驗。

| 階段 | 工作種類／範圍 | 必須達成的驗收 |
|---|---|---|
| F（來源審查／待決策） | 原版等價性審查：`$koudou_seigen`、全域 access 時鐘與各玩法間隔；先查公開 CGI、現行 API／SQLite，列單機與多人實際行為 | 逐來源矩陣、跨玩法重送／冷卻／跨日／重啟案例。若改變玩家操作頻率、全域冷卻範圍或其他玩法，先列方案與影響，取得使用者核准才實作；沒有證據不得新增限制。 |
| G | 經濟模擬／驗證：真實核心、固定種子、正常培育階段與裝備／醫療／食物／訓練成本 | 各強度、勝敗率、淨收益、耐久、K點、券、物品、每遊戲日／賽季；分開理論上限與正常流程。不可把模擬當真人或擅自平衡調參。 |
| H | 聯合瀏覽器驗收：B聯賽／大阪欠缺專項實際點擊，四種戰鬥與事件串接 | 真實 Chrome 1440/768/375px、合法入口、戰報、獎品／耐久、重送、錯誤與重啟；真人手動及實體裝置另列。 |
| I | #36/#37 原版事件與共用事件獎勵原子性 | 核對惡魔／天使之笛來源、取得、耗用與效果；檢查 #34/#38 與 #44 蟑螂共用領獎、其他有資產風險的舊事件；同日重送、容量、稅基、回滾與重啟。未知行為先標待核實。 |
| J | 整合／升級／備份與回滾計畫 | 真實歷史 Web SQLite schema、WAL 備份驗證→非覆寫還原→升級→聯合回歸；負 K 點稅務舊表、各戰鬥收據、原版／重建 NPC 來源、資產與外鍵；列原 PR 衝突修正與正式合併順序，使用者另行核准才可合併。 |

每個 F～J 階段先核對最新 HEAD／PR／CI，以最新正式 Web 分支作依賴基準，另開可追溯階段分支與 Draft PR（目標正式 Web 分支；不直接推送）；不得把修正直接塞入原五個 PR 或長期整合分支。依 2026-11-26 逐項驗收合併政策，已驗收且核准範圍內的PR逐項合併；新玩法決策仍須明確核准。P0 資產／越權／損毀問題優先；其他單機優先政策、既有功能矩陣、歷史記錄保留。

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
| PH-10 | C 聯賽自創角色圖片 | 指定範圍已實作（#121 已合併） | C聯賽 HTTP、Chrome 與聯合883/883 | 未驗（真人） | HTTP(S) 外部連結，非原版自動嵌圖 | [C聯賽](phase72-c-league.md) | H 真人／聯合瀏覽器與 J 整合驗收；不重做資料模型 | 戰鬥後續 F～J |
| WK-01 | 能量上限及自然恢復 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/engine.mjs；src/server.mjs | 先查核：Web 有上限與恢復；需核對所有轉職／體格事件的加扣條件 | P1 |
| WK-02 | 工作薪資、經驗、冷卻 | 指定範圍已實作 | 第48階段 HTTP/SQLite 工作→銀行→百貨→物品→食堂，兩次 Node 重啟；薪資與防重送 | 未驗（無真人實機證據） | 該已核對的工作與出勤條件一致；其他邊界待核實 | [第48階段](phase48-core-gameplay-restart.md)、`tests/server.test.mjs`、[第67階段](phase67-solo-save-backup-restore.md) | 真人工作／領薪介面；極端長週期及未覆蓋原版條件 | P1 |
| WK-03 | 飢餓／疾病修正工作 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/dining.mjs L82-L103；src/health.mjs | 先查核：未用餐玩家以 provisional 5 經驗預設；非原版完整懲罰 | P1 |
| WK-04 | 職業需求數值表及現有能力對照 | 指定範圍已實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/engine.mjs::parseLegacyJobs；src/server.mjs::snapshot jobs；public/app.js::jobRequirementsPanel／re | 只補具體未涵蓋邊界與真人操作驗收，不重做核心 | P1 |
| WK-05 | 薪資與獎金領取方式 | 指定範圍已實作 | HTTP/SQLite 領薪偏好、現金／銀行、帳簿、冷卻與重新啟動回歸 | 未驗（無真人實機證據） | 已確認核心薪資分流，未宣稱所有原版細節完全一致 | [第48階段](phase48-core-gameplay-restart.md)、`src/engine.mjs`、`tests/server.test.mjs` | 真人領薪 UI、跨版本偏好保存驗收 | P1 |
| WK-06 | 任職後工作再檢查條件 | 指定範圍已實作 | 引擎與 HTTP 實測選職後身高變更仍可出勤，重選拒絕；跨兩次 Node 重啟 | 未驗（無真人實機證據） | 已確認一致（僅選職／出勤兩種門檻的差別） | [第48階段](phase48-core-gameplay-restart.md)、`src/engine.mjs`、`tests/engine.test.mjs`、`tests/server.test.mjs` | 真人操作與未涵蓋職業極端條件 | P1 |
| WK-07 | 工作工廠職業投稿／清單 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 只載入 dat_dir/job.cgi 正式職業 | 先查核：原版允許提交候選職業到 joblog，並顯示投稿條件；不是直接加入正式職業表；此 fork joblog 0 bytes | 後續／P2 |
| TR-01 | 學校原始課程與使用說明 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs::parseLegacySchool、performTraining | 先查核：原版此 fork 根目錄沒有可執行 school.cgi；有資料和使用說明，無法對照原版實際付款、增益、時鐘執行 CGI | P1 |
| TR-02 | 學校每日一次 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/training.mjs L75–106 | 先查核：每天一次有原始說明依據；跨日、切課、伺服器時區仍需驗證，原版 fork 無獨立 school.cgi 程式可比對 | P1 |
| TR-03 | 健身房課程及 Web 補完減重 | 指定範圍已實作（減重為 Web 明示補完） | `tests/training.test.mjs`：九種原版 gym 資料逐項身體消耗÷100、BMI／能力／費用／冷卻、最低 1kg／不足額與能量拒絕；`tests/server.test.mjs`：單機 HTTP 前後端減重、無重複扣除及 Node 重啟保存；`tests/browser-viewport-smoke.test.mjs`：真實 Chrome 滑鼠點擊健走、減重結果、BMI、冷卻、狀態畫面及重啟保存；完整 CI 以最新 GitHub 結果為準 | 未驗（無真人實機證據） | **原始 fork 沒找到健身房可執行程式，不能證稱原版健身房會依此公式減重**；`dat_dir/gym.cgi`／`gym1.cgi` 只有資料，`town_lib.pl::gym_sprit` 僅解析，`unit.pl` 無健身房入口。此比率只參考原版工作 `basic.cgi::do_work` 和教室 `kyushitu.cgi::kyushitu_go` 的減重設計，由本次明確需求補上 | [本次來源及規則](#2026-11-23-tr-03健身房-web-補完減重與來源限制)、`src/training.mjs`、`public/app.js`、`tests/training.test.mjs`、`tests/server.test.mjs` | 真人介面／不同視埠、課程低體重與多次運動實玩驗收；如取得其他原版 TOWN 的 gym CGI 再調整來源比對，不把此 Web 補完改寫為原版既定規則 | P1 |
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
| MP-06 | 原版公路旅行與寶箱／百貨／事件券載具交通功能 | 指定範圍已實作（券獎五車及背包可達性修正） | `road-travel.test.mjs`、`server.test.mjs`：公路事故／迷路／巴士、百貨18車、本人事件券兌換五車、跨 Node 重啟、拒同名假來源與手機375px真實 Chrome 券獎選車；CI 以本輪實際結果為準 | 未驗（無真人手動實機證據） | 已知差異：手動選車；現金不足巴士拒絕，與 CGI 可成負數不同；券獎只有本人原版25點五車並驗證33欄與兌換流水 | `town_ini.cgi::idou_syudan`、`town_lib.pl::motimono_kensa`、`dat_dir/coupon.cgi`、`src/road-travel.mjs`、`src/coupon-redemption.mjs` | 真人交通入口操作；受贈／禮品屋其他車來源仍待驗，不能依同名推測 | P1（指定範圍） |
| MP-05 | 原版地圖互動入口覆蓋率 | 部分實作（入口盤點完成，設施不全） | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/town-map.mjs::MAP_SYMBOLS；public/town-home.js::FACILITY_PANELS／station | 先查核：43 個原版互動入口的現行代碼／可操作狀態依 [入口盤點](phase30-entrypoint-coverage.md) 為準；原始統計在第31～51階段後已過時。原版 gamerand. | P2 |
| HS-01 | 建屋／賣屋／改裝 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/housing.mjs；tests/housing.test.mjs | 先查核：基礎住宅有功能；全部特殊地形與交易規則未逐檔覆核 | P2 |
| HS-02 | 室內公告／留言與訪客權限 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/rooms.mjs；tests/rooms.test.mjs | 先查核：主流程存在；Web 住宅關聯資料的存檔持續性尚需驗證 | P2 |
| HS-03 | 商店／企業／分店／特殊住宅 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無完整 Web 對應模組 | 先查核：依賴商品市場、玩家間交易、房屋存檔、經濟模型 | P2 |
| HS-04 | 企業員工教育／員工紀錄 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；無 Web 企業員工訓練／名冊模型 | 先查核：原版可增員工、花費自身能力訓練員工、限制名額與間隔，含現金/信用分支；和普通住宅房間留言不同；原版部分付款及可達性須再核實 | 後續／P2 |
| BK-01 | 普通與定存、計息與帳簿 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs；tests/banking.test.mjs | 先查核：利率已有 Web 規則，計息觸發時點與原版不完全同等 | P2 |
| BK-02 | 玩家轉帳與額度 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs；src/server.mjs | 先查核：身份校驗與原子交易已載明；需逐項反查原始限制 | 後續／P2 |
| BK-03 | 住宅貸款及每日還款 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs；tests/loans.test.mjs | 先查核：負餘額與違約模式保留 Web 差異；無法稱為等價 | P2 |
| BK-04 | 原版定期徵稅 | 指定範圍已實作（Web 安全差異） | PR #103 稅基／每週扣款／帳簿、PR #104 歷史欠稅與舊 Web SQLite 升級、PR #105 WAL 備份→還原→續玩；合併後 Web push／Draft PR #1 CI **798／798 通過** | 未驗（無真人手動操作證據；已有 Chrome 自動化） | 星期一按前次已存資產徵稅；Web 使用遊戲當地日期，普通存款不足整筆記未繳且不自動追繳；K 點來源尚非全等價；#121 已納入 B聯賽／Street Fight 有號 K 點、稅表及交易相容 | `town_maker.cgi::login_view`；`src/banking.mjs`、`src/server.mjs`、`public/app.js`；[PR #103](https://github.com/Prysline/town-kinki/pull/103)、[#104](https://github.com/Prysline/town-kinki/pull/104)、[#105](https://github.com/Prysline/town-kinki/pull/105) | **指定稅務切片已結案**；只剩真人介面驗收、F～J 的 K 點來源、稅務升級、Web 安全規則差異，不得再次立項「稅務未接入」 | 已完成切片／真人驗收待辦 |
| BK-05 | 原版 A～E 股票市場及持股紀錄 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/banking.mjs 只有銀行／貸款模組，無股價交易 | 先查核：原版有獨立五類股價、持股、交易與清算記錄；不可因 Web 已有銀行而算股票已移植 | 後續／P2 |
| IT-01 | 原版 33 欄商品格式與 Web 背包 | 部分實作 | `inventory-capacity-collapsible.test.mjs` 核對原版 25／10／10 格與分類 HTML；`browser-viewport-smoke.test.mjs` 真實 Chrome 操作背包兩種分類、收合持續性與 375／768px 檢視；其餘 33 欄與物品範圍仍依各專項回歸 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/legacy-inventory.mjs；src/legacy-item-use.mjs | 先查核：Web 新商品使用原版 33 欄與已核實作用，不需舊玩家持有物匯入 | P1 |
| IT-02 | 可確認消耗品／耐久 | 部分實作（PR #98 寵物／信用卡，新增七款原版食物標記修復） | 既有日／回耐久、17 能力、冷卻與防重；[PR #98](https://github.com/Prysline/town-kinki/pull/98) 寵物／卡片及 Chrome UI；`legacy-item-use.test.mjs` 新增七款逐筆來源、能力／熱量／BMI／食物共用60分鐘限制及偽造來源拒絕，`server.test.mjs` 新增真實百貨購買兩款→使用→拒絕→重啟→快轉再用測試；CI 與 PR 結果以最新 GitHub 紀錄為準 | 未驗（無真人實機證據） | 原版 `command.pl::buy_syouhin` 會依 `食料品`／`ファ` 標記改分類；`basic.cgi::item_do` 仍按普通食物扣耐久、提升能力、加熱量並要求用餐冷卻。Web 先前會轉類但把這兩種標記當成不支援，並非原版沒有使用功能 | [原版商品來源](https://github.com/Prysline/town-kinki/blob/master/dat_dir/syouhin.cgi)、`src/retail.mjs`、`src/legacy-item-use.mjs`、`tests/legacy-item-use.test.mjs`、`tests/server.test.mjs`、[七款來源差異](#2026-11-23-it-02原版食物標記轉類後無法使用的修復) | 僅放行七款來源不變欄位相符的實際食物標記，原 33 欄保持唯讀，現金／庫存／耐久／冷卻與防重仍由既有交易保護；其他特殊商品、不同類別或未核實效果不自動擴大；真人 UI 操作仍未驗收 | P1 |
| IT-03 | 百貨店一／二、販賣機、裝備／禮品／回收 | 部分實作（已完成多種商店交易） | 百貨與自販／裝備／寄禮等已有交易測試；第48階段百貨跨重啟驗收 | 未驗（無真人實機證據） | 各店鋪規則仍有可辨識缺口；不得以「僅單件現金」描述當前百貨 | [第31階段](phase31-department-checkout.md)、[第48階段](phase48-core-gameplay-restart.md)、`src/retail.mjs` | 已支援百貨 1～5 件與本人有效信用卡付款；僅補經證實未涵蓋的店別規則與真人 UI | P2 |
| IT-04 | 優惠券獲得與兌換 | 指定範圍已實作 | `coupon-redemption.test.mjs`、`server.test.mjs`：30件獎品、33欄、扣券、重送、重啟 | 未驗（無真人實機證據） | 已確認兌換核心；獎品後續效果非全部一致 | [第51階段](phase51-event-coupon-redemption.md)、`src/coupon-redemption.mjs` | 可取得獎品中尚未支援的**有來源**單人用途；真人兌換 UI | P1 |
| IT-05 | 原版釣魚與漁獲出售 | 指定範圍已實作 | `fishing.test.mjs`、`server.test.mjs`：買餌、釣魚、賣魚、冷卻、資產及重啟 | 未驗（無真人實機證據） | 已知差異：Web 庫存按本地日界重置，原版使用01時旗標 | [第53階段](phase53-fishing-economy.md)、`src/fishing.mjs` | 真人釣魚 UI；日界差異是否實際阻塞待核定 | P1 |
| IT-06 | 原版拍賣場刊登與結算 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 無該拍賣／結算流程 | 先查核：原版使用獨立拍賣紀錄與刊登、交付分支；不同於普通商店／回收 | 後續／P2 |
| IT-07 | 原版合成屋 | 指定範圍已實作 | `crafting.test.mjs`、`server.test.mjs`：12配方、材料、33欄、回滾、重啟 | 未驗（無真人實機證據） | 已知差異：全域 `$koudou_seigen` 與 Web 行動冷卻關聯尚待核實 | [第54階段](phase54-crafting-house.md)、`src/crafting.mjs` | 真人合成 UI；原版全域限制差異查證 | P1 |
| HL-01 | 疾病指數、症狀、工作限制 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/health.mjs；tests/health.test.mjs | 先查核：病症與工作停工已有規則；需逐病例覆核原始門檻 | P2 |
| HL-02 | 醫院治療與原始保險 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/health.mjs；src/inventory.mjs；tests/inventory.test.mjs | 先查核：30 天有效期、折扣已載明；舊道具與有效期基準仍有差異 | P2 |
| SC-01 | 私訊與玩家互動 | 部分實作 | `private-mail.test.mjs`、`server.test.mjs`：普通信、寄禮信共用50封、刪信、重啟、所有權 | 未驗（無真人實機證據） | 已知差異：已讀／通訊錄／K點附信仍未完成；bbs/tag 非同一功能 | [第49階段](phase49-unified-private-mail.md)、`src/server.mjs` | **私人信核心已完成**，不得當成未開發；其他社交、留言獨立低優先項 | 後續／P2 |
| SC-02 | 戀愛／婚姻／同居／育兒 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無完整 Web 對應 | 先查核：依賴角色關聯檔、多人帳號及安全同步 | 後續／P2 |
| SC-03 | B 聯賽決鬥／裝備／獎賞 | 指定範圍已實作（#121 已合併） | 核心、SQLite、HTTP、負 K 點與聯合883/883 | 未驗（真人／B聯賽專項實際點擊待補） | 原版戰鬥與獎賞已核對；非負現金與模組冷卻為 Web 差異 | [B聯賽](b-league-arena.md)、[聯合驗證](battle-integration-check.md) | F～J，不重做已完成切片；atakka.cgi 是防濫用資料檔而非戰鬥 CGI | 戰鬥後續 F～J |
| SC-04 | 真實個人檔案自願登記／修改 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無 Web 個人檔案資料模型或表單 | 先查核：原版為玩家主動填寫的真實公開資料（性別／年齡／地址、5 組選項、15 題自由填寫），不是遊戲 looks／BMI | 後續／P2 |
| SC-05 | 個人檔案搜尋／分頁／傳訊入口 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；尚無 Web 公開檔案搜尋 UI | 先查核：可依名稱、性別、年齡、住所與五選項查詢，每頁 10 筆並有傳訊入口 | 後續／P2 |
| SC-06 | 原版問卷建立、投票及管理 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 無獨立問卷投票系統 | 先查核：原版有建立問卷、選項、投票與管理分支，不等於登入畫面的事件通知或隨機事件 | 後續／P2 |
| SC-07 | 原版玩家投稿事件 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 隨機事件模組是 event.pl 的抽選；無 event.cgi 投稿流程 | 先查核：event.cgi 會寫玩家投稿文字、能力與金錢等欄，**不能混成 event.pl #01～#44 已移植**；投稿不是自動加入隨機事件表 | 後續／P2 |
| SC-08 | 原版遊樂中心各種遊戲入口 | 部分實作（第55～61階段子玩法已實作） | `arcade-*.test.mjs`、`server.test.mjs`：第55～61階段多種玩法、四寶箱、交易、冷卻與重啟 | 未驗（無真人實機證據） | 已知差異／未完：2010年到期福引不自動重開；部分獎品後續效果未全移植 | [第55階段](phase55-arcade-dice.md)、[第61階段](phase61-treasure-chests.md)、`src/arcade-treasure.mjs` | 已完成玩法只需真人 UI 驗收；獎品用途按實際來源立項 | 後續／P2 |
| GM-02 | 原版競馬 | 未實作 | Web 沒有競馬結算測試證據 | 未驗（無真人實機證據） | 原版 `basic.cgi::keiba` 有實際下注與結果，尚未移植 | `basic.cgi::keiba`、[第30階段差異](migration-audit.md)、`src/server.mjs` | 確認玩家可達、獨立下注／結算與資產風險，按單機價值另立 P2 | 後續／P2 |
| GM-03 | 弱／強おばちゃん挑戰 | 指定範圍已實作（#121 已合併，核准重建版） | 大阪核心、SQLite、兩難度掉落及道具使用、單機／多人 HTTP；重建來源與切換測試 | 未驗（無真人實機證據） | 原版十筆 NPC 缺漏；完整原版資料優先，重建版 v1 明確標記並逐局保存 | [大阪挑戰](osaka-challenge-source.md) | 保留原版資料追查、真人瀏覽器及經濟平衡驗收 | 戰鬥後續 F～J |
| SC-09 | 原版隱藏口令獎勵 | 未實作（原版可達性待核實） | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 無原版活動兌換或已領記錄 | 先查核：原始程式需隱藏口令且每人一次，先領五人與其他玩家獎勵不同；不能從原版片段自動重啟活動或公布口令 | 後續／P2 |
| AC-01 | 單人／多人角色與登入 | 指定範圍已實作 | `server.test.mjs`：單機／多人身分、會話與資料隔離 | 未驗（無真人實機證據） | Web 自建帳號安全模型，不追求原版密碼機制等價 | `src/server.mjs`、`tests/server.test.mjs` | 實機持續登入與公開部署安全檢查 | P1 |
| AC-02 | 單人刪角／繼續遊戲 | 指定範圍已實作 | `server.test.mjs`：單機角色刪除、重啟保存、跨日快轉 | 未驗（無真人實機證據） | Web 可繼續進度與單機時間；不等於全系統歷史持久化已逐一驗收 | `src/server.mjs`、`tests/server.test.mjs`、[第48階段](phase48-core-gameplay-restart.md) | 真人返回首頁／繼續、跨版本 SQLite 升級驗收 | P1 |
| AC-03 | 公開部署／管理權限／速率限制 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；src/server.mjs；README 安全限制 | 先查核：未有完整登入速率限制及公開部署審查；不宜公開直接部署 | 公開部署前門檻 |
| AC-04 | 原版個人設定及備忘錄／朋友清單／死亡通知 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 有獨立 solo 刪角及帳號登入，沒有等價的完整原版設定資料模型 | 先查核：原版備忘錄可保存、好友清單和字體／音效設定可編輯；死亡通知含密碼及原始關聯檔處理，不能用 Web solo 刪角代稱完成 | P2 |
| DB-04 | SQLite 遷移／還原 | 部分實作 |第48階段跨兩次 Node 重啟；第67階段 `solo-save.test.mjs`／HTTP 還原續玩、WAL、SHA-256、外鍵；PR #35 真實歷史 schema 子集升級已由 PR #94 驗證（合併前／後 push 與 PR CI 均成功）；PR #53 寄禮信箱舊 FK→雙階段升級及寄件者刪帳保護由已合併 PR #96 補測；最終 PR HEAD push／PR CI、合併後 Web push／長期 PR #1 CI 均 success（合併後 715/715）；PR #113 新增第62階段 Web 公路舊 SQLite 的實體 WAL 備份／還原／HTTP 到站／重啟跨版驗收（已合併 PR #113；測試／文件提交 `ba58629c` 的 [push CI](https://github.com/Prysline/town-kinki/actions/runs/45315268903) 與 [PR CI](https://github.com/Prysline/town-kinki/actions/runs/45315275294) 均成功，808/808）；PR #114 已合併，合併後 push CI 809/809；長期 PR #1 同 HEAD 808/809（六號樂透既有測試失敗，聯合候選修正測試時鐘） | 未驗（無真人實機證據） | 不適用：新版 SQLite 保存與恢復，不以舊 CGI 匯入衡量 |[第67階段](phase67-solo-save-backup-restore.md)、`scripts/solo-save.mjs`、`tests/solo-save.test.mjs`、`tests/server.test.mjs`；[第68階段跨版測試](phase68-sqlite-pr35-upgrade-verification.md)、[第69階段舊信箱跨版測試](phase69-pr53-gift-mail-upgrade.md)、[PR #96](https://github.com/Prysline/town-kinki/pull/96)、[PR #113](https://github.com/Prysline/town-kinki/pull/113)、[第70階段公路跨版驗收](phase70-pr86-road-wal-upgrade.md)、[PR #114](https://github.com/Prysline/town-kinki/pull/114)、[第71階段禮品舊帳簿跨版驗收](phase71-pr42-gift-events-wal-upgrade.md) |**CLI 備份／驗證／新目錄還原已完成**；待跨 Web 版本升級矩陣、跨設備演練、定期管理與真人操作；其他 Web 歷史版本、跨 OS／設備仍待驗收，PR #96 不代表全面矩陣完成 | P1（驗收） |
| DB-05 | Web 自建個人檔案與職業投稿 | 未實作 | 無已移植玩法驗證；原版來源需核對 | 未驗（無真人實機證據） | 原版已確認有程式或資料；可達條件仍依來源核定 | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；Web 尚缺完整建立／投稿功能 | 先查核：讓新玩家自行填寫，不匯入既有玩家資料 | 後續／P2 |
| UI-01 | 三欄位狀態切換與原始資訊 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；public/index.html L176-L202；public/app.js | 先查核：有 ARIA tab 與原版分頁；實機 375px/768px/桌機驗收缺少 | P1 |
| UI-02 | 事件通知及 20 秒挑戰 | 部分實作 | 既有盤點列有程式／測試線索；本輪未逐項重跑，需按風險核對 | 未驗（無真人實機證據） | 原版完整等價性待核實（不得以入口／測試數量代替） | [`migration-audit.md`](migration-audit.md) 原始 CGI 與 Web 來源列；public/app.js；src/event-cockroach.mjs | 先查核：程式顯示與 API 存在；真實操作與動態尺寸未驗證 | P1 |
| UI-03 | 地圖、餐點與手機 RWD | 部分實作 | `home-ui.test.mjs` 靜態 DOM/文字；`browser-viewport-smoke.test.mjs` 在真實 Chrome 引擎自動觸發建角、工作、銀行、百貨、背包與 1440/768/375px 交互（PR #95 最終 HEAD push／PR CI 及合併後回歸均成功，714/714） | 未驗（無真人實機證據） | UI 響應、可用性與原版介面不可混為單一等價判定 | `public/index.html`、`public/app.js`、`public/style.css`、`tests/home-ui.test.mjs`、[Chrome 自動化測試](../tests/browser-viewport-smoke.test.mjs)、[PR #95](https://github.com/Prysline/town-kinki/pull/95) | 真人桌面／手機／平板實機操作、食堂／住宅／事件、鍵盤／畫面全面驗收仍缺；自動化不得作真人證據 | P1（驗收） |
| UI-04 | 部署／監控／備份 | 部分實作 | 第67階段 CLI／HTTP 備份後續玩測試已通過；正式部署測試無證據 | 未驗（無真人實機證據） | 不適用（部署與備份管理要求） | [第67階段](phase67-solo-save-backup-restore.md)、`scripts/solo-save.mjs` | 部署權限／HTTPS／速率限制、安全審查、定期備份輪替與還原演練 | P2 |
| UI-05 | 地圖教室獨立入口 | 指定範圍已實作 | `home-ui.test.mjs` 與 `server.test.mjs`：教室地圖導航及 HTTP 交易 | 未驗（無真人實機證據） | 已核對地圖教室與獨立學校的差別 | [第30階段教室](phase30-jobs-training-profile-audit.md)、`public/town-home.js` | 只需真人入口操作，不重建導覽 | P1 |

### 2026-11-23 TR-03：健身房 Web 補完減重與來源限制

- **來源確定部分**：原始 `master` 的 [`dat_dir/gym.cgi`](https://github.com/Prysline/town-kinki/blob/master/dat_dir/gym.cgi) 有九種健身房訓練，逐項提供身體能量消耗、能力增益、價格與間隔；[`dat_dir/gym1.cgi`](https://github.com/Prysline/town-kinki/blob/master/dat_dir/gym1.cgi) 是七種運動的另一張資料表。[`town_lib.pl::gym_sprit`](https://github.com/Prysline/town-kinki/blob/master/town_lib.pl#L342-L344) 只拆解 13 欄，[原版使用手冊](https://github.com/Prysline/town-kinki/blob/master/manual.html#L145-L146) 說明健身房能鍛鍊身體。完整原始 Git tree 裡**未找到根目錄可執行的 `gym.cgi` 或 `school.cgi`**；[`unit.pl`](https://github.com/Prysline/town-kinki/blob/master/unit.pl) 無健身房操作入口，[`town_maker.cgi`](https://github.com/Prysline/town-kinki/blob/master/town_maker.cgi#L785-L789) 雖保留 `gym` 模式字串，但沒有實際健身房扣款、扣能量、加能力或更新體重的分派。這是**此 fork 的來源缺口**，不代表歷史上所有 TOWN 版本都沒有健身房。
- **參考但不是健身房原版公式**：[原版工作 `basic.cgi::do_work`](https://github.com/Prysline/town-kinki/blob/master/basic.cgi#L2956-L2961) 以身體能量消耗除以 100 減重；[教室 `kyushitu.cgi::kyushitu_go`](https://github.com/Prysline/town-kinki/blob/master/kyushitu.cgi#L139-L143) 以（身體＋頭腦消耗）除以 100 減重。兩者證明本遊戲已有「能量消耗與減重連動」的可執行案例，**不證明原版健身房必然採用相同算法**。
- **本次 Web 補完決策**：僅針對 `type=gym`，每次成功訓練減重 `energyCost/100` 公斤（九種課程依原始欄位換算，保留兩位小數），最低體重 1 公斤；同次更新 BMI，API `trainingLessons[].weightLoss` 提供預估值，`trainingResult.weightLoss` 回傳扣到下限後的**實際值**。前端課程資訊明示「Web 補完規則」，學校維持不減重、教室沿用有原版 CGI 支持的雙能量公式，健身房原有費用、能力提升與冷卻不變。只在訓練成功的既有 SQLite 交易內儲存，不新增／覆寫資料表及舊資產。
- **證據與界線**：`tests/training.test.mjs` 覆核九種課程、下限、拒絕、學校／教室隔離；`tests/server.test.mjs` 覆核新玩家 HTTP 訓練、無效前端自稱減重、保存／冷卻及重啟。CI 需核對最終 PR 及整合分支的實際執行結果；沒有真人瀏覽器操作證據，不得稱「玩家實機已驗收」，也不得稱「原版健身房減重公式已還原」。

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
<!-- BK-04 已由 PR #103、#104 完成指定範圍，PR #105 補備份還原回歸；不再列為未實作的 P1 候選。仍保留上方功能矩陣的 Web 安全差異與真人驗收缺口。 -->
| **GM-03／可獨立單機玩法（非當前 P1）** | `gamerand.cgi` → `obatyan.cgi::week/strong/battle` | 已由 #121 正式接入兩難度原子結算、獎品使用、重建 NPC、原版資料優先策略 | 十筆原版資料仍缺；重建不是史料復原；真人及營運平衡待驗 | **戰鬥後續 F～J**：保留 [大阪挑戰](osaka-challenge-source.md) 所列來源及差異，補齊實際原版資料時切換，不修改既往收據 |
| **GM-02／競馬（非當前 P1）** | `basic.cgi::keiba` | 原版有實際投注、限制、結果結算；Web 尚無同等投注／結算 API | 依原版可執行功能，但真實街區資料為空；必須確認 Web 單機可達配置與獎金安全 | **P2**：明確單人可達性、下注上限與結算，避免無來源「只有圖示就加賽馬」 |
| **HS-03／住宅商店特殊用途（分段後再排序）** | 住宅／商業 CGI 的相應可執行分支，見 [差異矩陣](migration-audit.md) | 建屋、出售、改裝、留言已存在；室內進階商業及特殊互動仍缺 | 有可建屋基礎但與所有權、對外交易及多人安全耦合 | **P2**：先確認單機真有可操作的原版功能與建置成本，不能把已有住宅重做 |

### 2026-11-22 IT-02／BK-04 來源對照（靜態查核；不是新功能或真人驗收）

本輪重新讀取 **原版 master** 的 `basic.cgi`、`dat_dir/syouhin.cgi`、`town_ini.cgi`、`town_lib.pl`、`town_maker.cgi`；其中四個 CGI／商品檔與 Web 長期分支同路徑的 Git blob SHA 相同，原版保持唯讀。以下只針對已查到的**具體執行路徑**，不推論全部 SKU 或跨日完整等價。

| ID／工作性質 | 原版與 Web、既有測試的可核對事實 | 單機可達性與尚未確認事項 | 可能改動的 Web 檔案、資產風險與驗收門檻 |
|---|---|---|---|
| **IT-02／已明確還原寵物與信用卡原版背包使用語義（PR #98）** | 原版 `dat_dir/syouhin.cgi` L267–273 有七款寵物：六款「回」制已可走 Web 通用 `item_do` 效果，**`ガチャピン` 的效果代碼雖為 `無`，但 `LOVE／趣味／情色` 各 +15**，是 `3日`、`120分`、身體能量 10。L366–369 四款信用卡也能進 `basic.cgi::item_do` 背包一般使用：普通／金卡無能力增益、特殊信用卡 **17 能力各 +1／15 分**、會員卡 **前十四項各 +2／180 分**；日制使用不扣天數，銀行付款是 `command.pl`／`kyushitu.cgi` 的獨立路徑。舊 Web `DAY_USE_TYPES` 錯誤拒絕所有日制寵物與卡片；[PR #98](https://github.com/Prysline/town-kinki/pull/98) 僅新增 **這五款** 可核對來源的背包使用白名單與效果、UI 說明，未重做已存在的卡片結帳。 | Web 新玩家可選擇建立單機街區、設定百貨、購買當日上架的原版商品。百貨貨架仍**每日隨機**，不能保證某天指定 SKU 一定出現；HTTP 測試只為重現，強制在完整測試貨架顯示兩個特定 SKU，不改玩家正式貨架規則。寵物其他特殊設施權益、未驗證商品仍不推定可用。 | `src/legacy-item-use.mjs` 對這五款核對類別／品名／效果／冷卻／能量／17 項能力來源欄位，原 33 欄唯讀、本人操作、防重及原子回滾；`tests/legacy-item-use.test.mjs` 驗證七隻寵物、四張卡片、到期／間隔、拒假資料；`tests/server.test.mjs` 驗證新單機玩家實物購買→使用→卡片續付→重啟與重送。健康保險、防犯攝影機等仍不開放一般使用。自動測試成功不等於真人操作；仍需實際 375／768／1440px 的可見介面驗收。 |
| **BK-04／確定未接入的原版跨日徵稅路徑，安全規則待定** | 原版 `town_ini.cgi` 設 `$zeikin_shitei='Mon'`；`town_maker.cgi::login_view` 在 `access_time` 跨日後以伺服器本地星期一觸發。對**已存檔的** `k_sousisan`（`town_lib.pl` 讀取，`login_view` L332 才重算）以總資產 `≤100萬` 免稅，其他依 `≤1000萬／≤1億／≤10億／更高` 分別 `1%／3%／5%／7%`，按 `kpoint` 的 `25／50／100／250／500／1000` 門檻折減，直接從普通銀行扣款並記通帳。Web `src/server.mjs::snapshot` 呼叫 `settleBankInterest`，`src/banking.mjs` 只涵蓋跨日利息及貸款還款，尚無徵稅扣款與記帳；`tests/banking.test.mjs` 對利息／貸款有測試，但未驗稅務。 | Web 單機 `/api/solo/time/advance` 支援 `1d`，`src/solo-starter-town.mjs` 已有銀行；**單一新 Web 玩家可以走到日期跨越／銀行查看流程**，不需要舊 CGI 玩家匯入。但 Web 現行 `kpoint` 預設為 0，沒有原版歷史 `k_sousisan` 快照；原版使用「前次保存總資產」而非當次重新即時計算，且可把銀行扣成負值。故稅基時點、缺錢時政策及 K 點來源，需明確決策，不能把原版公式直接貼到 Web。 | 預計涉及 `src/banking.mjs`、`src/server.mjs`、資料表／遷移初始化（須先界定），以及 `tests/banking.test.mjs`、`tests/server.test.mjs`；`src/solo-clock.mjs` 只作時間入口核對，不預設需修改。驗收：週一首次跨日登入/查看才徵稅，非徵稅日不扣；資產門檻與 K 點折扣按核定規則逐級測；相同日期重送/重啟不雙扣；利息、貸款、稅和帳簿的先後順序可觀察且原子回滾；稅額超過普通存款、升級舊 Web SQLite、溢位或寫入失敗時不得製造負帳、遺失資產或破壞來源存檔。**需先確定安全政策與可重現測試再開獨立功能 PR**。 |

**修復與盤點結論**：IT-02 原版 **`ガチャピン` 的三項 +15** 和 **特殊信用卡／會員卡能力增益** 已由原始商品欄位及 `basic.cgi::item_do` 證實；以 [PR #98](https://github.com/Prysline/town-kinki/pull/98) 的最小白名單恢復五款日制物品背包使用，原有六種回制寵物與信用卡結帳不重做。合併與 CI 以 GitHub PR 狀態為準，真人介面驗收未完成；IT-02 其他原版效果仍逐項查核。BK-04 仍有 Web 未接入徵稅及單機跨日入口，但需先決定安全的稅基和不足額政策，本 PR **不變更銀行稅務**。

### 2026-11-23 IT-02：原版食物標記轉類後無法使用的修復

- **具體失效原因**：原版 [`dat_dir/syouhin.cgi`](https://github.com/Prysline/town-kinki/blob/master/dat_dir/syouhin.cgi) 的商品表中有七項單段效果欄為 `食料品`／`ファ`。原始 [`command.pl::buy_syouhin`](https://github.com/Prysline/town-kinki/blob/master/command.pl#L2045-L2054) 在購入時改為 `食料品`／`ファーストフード` 類別，[原版 `basic.cgi::item_do`](https://github.com/Prysline/town-kinki/blob/master/basic.cgi#L2395-L2600) 會依食物規則處理能力、熱量、身體／頭腦消耗、剩餘回數及用餐限制；效果代碼本身**不是另有未知特殊效果**。Web `src/retail.mjs::ownedCategory` 已轉類，`src/legacy-item-use.mjs::parseArchivedItem` 卻未接受這兩種單段效果標記，於是可正常買到卻不提供「使用」資格。
- **逐項範圍**：原版行號 3 `ちゃんこ／どすこいちゃんこ`（轉 `食料品`）、4 `ちゃんこ／どすこいつまみ食い`（轉 `ファーストフード`）；314 `東北名産店／笹かまぼこ`、315 `きりたんぽ鍋セット`、317 `秋田名物稲庭うどん`、322 `仙台名物牛タン焼き`、324 `仙台名物ずんだもち`（皆轉 `食料品`）。合計**七款**，不限於原始分類名稱為食物的商品。
- **最小 Web 修復**：`VERIFIED_RECLASSIFIED_FOODS` 對七款檢查轉換後類別、原名、效果標記、價格、使用間隔、原始庫存、熱量、身體／頭腦能量及全部17能力等來源固定欄位後，才視為可使用的食物；繼續使用已實作的共用60分鐘用餐冷卻、單件間隔、增益、體重與 BMI、回制耐久、防重送與 SQLite 交易。不修改 `dat_dir/syouhin.cgi`、原版 `master`、正式隨機百貨貨架或 Web 資料表結構。
- **驗證**：`tests/legacy-item-use.test.mjs` 比對七款原始資料及變造拒絕，包含最高 7000 kcal 的牛舌燒、555 kcal 鍋物，並驗證使用後不覆寫原 33 欄；`tests/server.test.mjs` 使用測試暫存 SQLite 確保兩款ちゃんこ商品上架，逐步真實購入→食用→共用60分鐘拒絕→伺服器重啟保存→相同 requestId 防重→單機快轉再食用及資產核對。這是 Node HTTP／SQLite 自動回歸，未執行真人手動操作或另加 Chromium 端到端本修復案例；CI 依最後 PR 狀態填寫。
- **界線**：未推定其他 `ギフト`／未知效果有一般使用資格；`basic.cgi` 的 `$oyatu_kisei` 在此 fork 目前設定為 `no`，因此不新增無原版當前生效依據的飲料／甜點／酒精共享冷卻。接續 IT-02 應另挑有確切原版可執行效果且玩家可取得的商品，不把整份商品目錄當成單一待辦。

**待核實、不得自動升格為新功能**：學校／健身房在此 fork 缺少原版可執行 CGI；只有課程資料和使用說明；原始城鎮街區檔為空；原版已過期福引是否可再開啟沒有新政策；遊樂中心的各種圖示、寶箱獎品與不存在的「專門店」不能單憑名稱推演全套玩法。其他多人、社交、股票、拍賣、公開個資／投稿與企業依原版及安全需求分開核查，**暫非單機優先**。

## 六、尚待驗收（與新增功能分離）

| 工作類型 | 現況／已有證據 | 尚須完成的可觀察驗收 |
|---|---|---|
| **真人桌面瀏覽器** | Node HTTP、DOM 與 SQLite 測試已涵蓋主要循環；無真人點擊錄影／截圖證據 | 真正用桌面 Chrome/Firefox 建角→工作與領薪→百貨購物→背包使用→食堂／住宅／事件→離開再繼續；檢查每步角色、金錢、道具、冷卻與錯誤提示 |
| **375px 手機／768px 平板** | 有 CSS/RWD 與 DOM 測試，但不等於兩種視埠已人工驗收 | 實際瀏覽器在 375、768px 操作導航、地圖、彈窗、狀態／背包／冷卻、券、合成、釣魚、公路；紀錄水平溢出與點擊失敗 |
| **新版 Web SQLite 升級矩陣** | 第48階段同資料夾重啟、第67階段備份／新目錄還原已通過；PR #94 完成 PR #35 真實 schema 子集跨版測試（兩次合併前／後 CI 成功）；已合併 PR #96 新增 PR #53 寄禮信箱歷史 FK 無損升級切片；最終 PR HEAD push／PR CI 與合併後 Web push／長期 PR #1 回歸 CI 全部成功（715/715） | 按確定舊 Web schema 版本建立資料樣本→備份→升級→重啟，逐一核對現金／銀行／背包／住宅／事件／冷卻／多種設施；失敗不得毀損來源 |
| **不同設備與環境還原** | 已有 CLI WAL 快照、SHA-256、驗證與不覆寫還原 | 在不同 OS／檔案系統／權限與實際部署路徑操作；驗證完整性與恢復續玩，不能把 CLI 完成寫成演練完成 |
| **定期備份管理／正式部署** | 手動 `solo-save.mjs` 已可用；不代表有輪替排程、監控、金鑰或遠端保存 | 若要正式公開部署，實作／驗證排程、保留政策、告警、離線副本、HTTPS／Session／速率限制與資產權限；先經部署安全審查 |
| **多人安全回歸** | 現有隔離、單筆交易、防重送與刪帳後資料持有權已有自動測試；第49階段私訊亦涵蓋 | 修改共享規則或 schema 時核對兩帳戶、資產所有權、併發、回滾；**不因此新增多人功能** |
| **原版局部差異驗收** | 工作條件、魚餌庫存刷新、交通手動選車／巴士安全限制等有明確紀錄 | 只對影響玩家且有來源的差異開修復；來源不足者不宣稱完整等價，也不作必修計畫 |

**已解除的 CI 時鐘測試阻塞（2026-11-22）**：`coupon-redemption.test.mjs` 原以固定 `2026-11-21T10:00:00Z` 兌換一日獎品、卻以真實時間查詢背包，造成 #109、#112 失敗。已由獨立 [PR #93](https://github.com/Prysline/town-kinki/pull/93) 僅修改測試檔，統一查詢時鐘，並補測到期前 1 毫秒可見、到期時不可見；該 PR 的 [push CI](https://github.com/Prysline/town-kinki/actions/runs/45014745689) 與 [pull_request CI](https://github.com/Prysline/town-kinki/actions/runs/45014761000) 均已成功，修復已合併 Web 長期分支。此問題不是兌換遊戲功能退化，文件 PR 仍僅修改 Markdown。

**已完成 Chrome 自動化（PR #95，合併後 Web SHA `2ab61554ab94f9db0c71a6f4d791c1a72cc39d19`）與真人驗收分離**：`tests/browser-viewport-smoke.test.mjs` 使用真實 Chrome/Chromium 引擎在 1440px、768px、375px 視埠執行前端滑鼠點擊與頁面狀態，覆蓋建角、已預設日薪工作、單機試玩街區、銀行存款、百貨選品購買、背包、首頁離開／繼續。[最終 HEAD push CI](https://github.com/Prysline/town-kinki/actions/runs/45022217905)、[PR CI](https://github.com/Prysline/town-kinki/actions/runs/45022224039) 與[合併後 push CI](https://github.com/Prysline/town-kinki/actions/runs/45022371805)、[PR #1 回歸 CI](https://github.com/Prysline/town-kinki/actions/runs/45022376153) 已成功；這些切片**已自動測試**；仍**沒有真人在桌面、平板或手機現場操作的證據**，不涵蓋全部遊戲設施及不同 OS 實機。

**新增近期玩法的真實 Chrome 自動點擊驗收（健身房／寵物／信用卡／PR #100 背包）**：`tests/browser-viewport-smoke.test.mjs` 另設一個獨立的 Chromium CDP 單機遊玩流程，玩家在畫面建立角色與城鎮、點擊健走並檢查 60 → 59.92kg／BMI／冷卻、於測試用臨時 SQLite 固定兩件原版百貨上架商品後**從百貨畫面點擊**購買 `ガチャピン`／`スペシャルクレジットカード`、**從背包畫面點擊**使用並核對能力增益／日制剩餘與冷卻、在原生 details 分類收合後重新整理仍保留選擇、以信用卡付款且普通銀行扣款不附加能力、在 768／375px 檢視背包與體重、Node 重啟後由瀏覽器重新開啟並驗證資料持續。測試專用原始商品貨架及現金／銀行初值只在臨時資料庫處理，**不改玩家正式的每日隨機上架、舊 CGI 玩家資料或其他環境的資產**。首次完整 [Chrome/Node CI](https://github.com/Prysline/town-kinki/actions/runs/45044518909) **729／729 通過（包含兩條 Chrome UI 測試）**；PR 合併後應另核對整合分支 CI。這是**瀏覽器引擎自動化驗收**，不包含真人手動操作、實際手機／平板裝置或跨 OS 實機；現行矩陣「瀏覽器驗收」欄仍保持未驗。此測試沒有覆蓋所有背包 25 格上限分支、全部寵物及信用卡名稱、跨多次快轉或長期日界情境，既有 unit/HTTP/SQLite 測試各自繼續負責。

**跨版本矩陣驗收（PR #94／#96）**：PR #94 以 PR #35 當時百貨收據 schema 子集做無損備份→升級→資產延續，合併後 [Web push](https://github.com/Prysline/town-kinki/actions/runs/45021154461) 與 [PR #1 回歸](https://github.com/Prysline/town-kinki/actions/runs/45021159489) 成功。PR #96 另選 PR #53 的寄禮信件 `event_id` 舊外鍵（刪交易會連刪收件者信），測試兩段 v2／v3 升級以及刪寄件者後的收信與收禮保護；PR #96 的[測試提交 push CI](https://github.com/Prysline/town-kinki/actions/runs/45024428062) 與 [PR CI](https://github.com/Prysline/town-kinki/actions/runs/45024449683) 成功；最終 HEAD `6702c51df6856051f738cf143d7164d8fbc48d05` 的[push CI](https://github.com/Prysline/town-kinki/actions/runs/45024696577) 與 [PR CI](https://github.com/Prysline/town-kinki/actions/runs/45024701156) 亦 success。**已在 2026-11-22 合併**至 Web 長期分支 `78cb041da5865e856c81bb2a2951165f2f28a203`，合併後 [Web push CI](https://github.com/Prysline/town-kinki/actions/runs/45024849335) 與 [長期 PR #1 回歸 CI](https://github.com/Prysline/town-kinki/actions/runs/45024853651) 均 success（715/715）。`master` 仍是 `f74e077780ed96f9b271f66e5afe63037c7c7403`，PR #1 保持草稿。兩者都不是完整歷史 Web 版本矩陣，更不是不同 OS／設備的真人還原。詳見[第69階段](phase69-pr53-gift-mail-upgrade.md)。

**已測不等於已人工驗收；待真人驗收不等於 API 未實作。** 只有真實驗收紀錄、具體裝置／版本／步驟／結果才允許把「未驗」更新為「已驗收」。

## 七、下一階段優先序（只選仍有缺口）

**當前接續：上方戰鬥系列 F～J，從 F 開始，不重開 A～E。** 下列全專案優先序保留，P0 高風險缺陷仍優先；A～E 已獲聯合整合授權；F～J 的新增玩法與限制仍須按各階段核准。

1. **P0（發現即先做）**：單機無法建角／獲薪／購物／使用／繼續遊玩，或經證實造成資產丟失、SQLite 損毀、越權與重複扣款的問題。當前**未憑文件發現尚待實作的 P0**；不得無根據建立新 P0 階段。
2. **P1／驗收**：第48與67階段已測循環的真人桌面／375／768px 操作；新版 Web schema 跨版本升級與不同設備還原演練。這是**驗收階段，不是重寫循環或重做 CLI 備份**。
3. **P1／功能差異**：從玩家確實可取得並有原版可執行效果的商品挑選尚未接通的特殊用途（IT-02）；每案需先記可重現條件、已存在程式、缺失行為、資產風險與驗收條件。**BK-04 已由 PR #103～#105 完成指定切片，不再作為待實作候選。**
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


### 2026-11-23 BK-04：星期一原版徵稅的 Web 安全移植

- **原版基準**：`town_maker.cgi::login_view` 原版在日期變更且本地星期一，先計普通／定期利息與住宅貸款，再以**先前保存**的 `k_sousisan` 算出稅；資產不超過 100 萬免稅，往上級距 1%／3%／5%／7%。K 點 25／50／100／250／500／1000 有不同折扣，不能當成單調倍率。
- **實作範圍**：`bank_tax_state` 保存最近主畫面已存資產快照（現金＋普通存款＋超級定期－尚未還款總額，負數稅基按零計）；`bank_tax_assessments` 以 `(user_id,tax_day)` 做唯一結算紀錄。每次首次跨日結算於遊戲當地星期一發生，稅額依**前次快照**計算，不補計缺席的多個星期一。完整普通存款支付才從普通銀行扣除，銀行通帳記「每週納稅」；沒有正額稅則只留稅務紀錄。
- **Web 安全差異**：原版可以把銀行扣成負值；Web 不允許負餘額，普通存款不足時整筆記為未繳，暫不追繳、不動現金／定存。原版用伺服器星期一；單機 Web 使用可快轉的遊戲當地日期，避免真實星期與遊戲日期衝突。超出 JS 安全整數範圍拒絕更新並保持交易回滾。
- **舊檔相容**：只 `CREATE TABLE IF NOT EXISTS` 新稅務表，不更動舊有帳戶欄位和餘額；在初次讀取舊 Web 角色時建立當日稅基快照，不追溯舊日期扣款。這不是舊 CGI 存檔匯入。
- **可驗證範圍**：`tests/banking.test.mjs` 覆蓋免稅／級距／K 點／快照／不足額／回滾；`tests/server.test.mjs` 透過真實 HTTP 單機快轉星期一、檢查銀行帳簿與重啟持久化。通過測試只能代表自動驗證，不等於真人 Chrome 實際驗收。

### 2026-11-23 BK-04 後續稅務歷史與升級驗收補強

- **可重現缺口**：PR #103 的 `bank_tax_assessments` 永久保存逐週 `unpaid`，但 `bankTaxOverview` 及銀行介面原本只顯示最新結算。若前週欠繳、後週付清，最新 `unpaid=0` 不能代表沒有先前欠稅，玩家會失去可見的歷史提示。
- **最小修正**：`bankTaxOverview` 新增歷史 `unpaidPeriods` 與十進位字串 `unpaidTotal`，從逐週紀錄累加，不更改角色餘額、既有稅額或結算紀錄。以 BigInt 累加避免 SQLite `SUM` 與 JS 安全整數溢位；瀏覽器使用既有 `Intl.NumberFormat` 呈現 BigInt，銀行頁面同時顯示本期與歷史未繳。欠稅仍**不自動追繳**。
- **新增驗收**：`banking.test.mjs` 覆蓋「先欠後繳」與房貸還款／計息／納稅順序，`server.test.mjs` 在臨時 SQLite 模擬舊 Web 已有銀行帳戶但尚無稅務表的週一啟動／重啟；`browser-viewport-smoke.test.mjs` 以真正 Chrome 在 1440、768、375px 驗證銀行文字，該 Chrome 自動化**不代表真人實際操作**。CI 成功與否須以本補強 PR 最新執行結果核定。

### 2026-11-23 DB-04／BK-04：有歷史欠稅的單機 WAL 備份→還原驗收

- **新增而非重做**：第67階段已涵蓋原單機建角、工作、銀行、購物、物品、備份與還原。BK-04 後續已涵蓋兩週欠稅可見性、單機跨日、SQLite 重啟與舊存檔升級；此前缺少**同一份真實單機 SQLite 含兩個星期一（一週未繳、一週已繳）**時，經既有線上 WAL 備份工具、雜湊驗證及新資料夾還原後繼續遊玩的一致性測試。
- **驗證案例**：`tests/server.test.mjs` 新增單機 HTTP 日快轉至兩個星期一：先用低普通存款產生欠稅，再以正式銀行存款 API 建立可繳額度，於次週正常繳稅；核對 `bank_tax_state`、`bank_tax_assessments`、普通存款、帳簿、`solo_clock`，在伺服器運作中透過正式 `scripts/solo-save.mjs` CLI 執行 WAL 備份／驗證／新資料夾還原。備份後原存檔另行提款，還原結果仍須逐項與備份瞬間一致；恢復伺服器後多次 `/api/state` 不雙扣，繼續銀行操作不抹去兩週歷史，且拒絕覆寫已存在的還原目標。
- **範圍界線**：只新增回歸證據，不更動備份程式、SQLite schema、稅率、欠稅政策、原版 CGI 或玩家正式資料。CI 依實際 GitHub 記錄確認；Node HTTP／SQLite 自動化不代表真人操作或跨 OS／設備驗收。

### 2026-11-23 單機可玩性稽核：Web 試玩街區的新手導覽

- **玩家可達性缺口**：既有 21 格 Web 試玩街區已有真正的釣場、合成屋、優惠券及遊樂中心，但常用捷徑只列工作、物品、銀行、醫院、食堂、住宅、學校及健身房；首次遊玩的玩家必須辨識 34px 地圖格及不同設施分頁，無直接新手路線。這不是原版玩法缺失，也不是需要重新開發交易 API。
- **最小 Web 可玩性改善**：僅當 `map.source === "web-solo-starter"` 且是單機模式時顯示新手路線，提供前往**既有**工作、百貨、背包、釣魚／買餌、合成、遊樂中心的可點捷徑。只使用既有 `goToFacility` 選分頁及捲動，不增加遊戲資產、修改存檔、建立新入口權限或替原版／自訂城鎮虛構建築。對釣魚材料／合成材料／遊樂下注危險明示限制。
- **新增遊玩驗證**：真實 Chrome 從單機建角後自行選擇建立試玩街區，實際點新手路線及地圖 D5「クーポン」、D7「釣り」、D8「合成」、D9「ゲーセン」格，確認既有真實設施能切換並接收焦點。這是瀏覽器自動操作而非真人手動驗收；全部交易仍維持原有 API 安全檢查。
- **同步去除過期待辦**：BK-04 的最新實作、未繳歷史和備份續玩自動驗證已由 PR #103～#105 證實。清除「BK-04 尚未接入」的當前開發清單與 P1 優先序；保留 2026-11-22 靜態查核的歷史文字作來源追溯，但不可當現況。

### 2026-11-23 IT-02／MP-06：五款原版優惠券載具終於能上路

- **原版執行來源**：`town_ini.cgi` 的 `%idou_syudan` 列出 20 個公路交通名；`town_lib.pl` 的公路分支用 `motimono_kensa("$_")` 按持有品名判定車輛，不要求原商品分類必須是「乗り物」。原版 `dat_dir/coupon.cgi` 第 9～13 列（零基索引 8～12）為五款 25 點車：`ポルシェ` 3 秒、`フェラーリ` 2 秒、`ジャガー` 4 秒、`キャデラック` 6 秒、`ロータスヨーロッパ` 4 秒，皆為 `クーポン交換品:25`、`回` 耐久、有「※移動手段です。当たり」備註。
- **確定 Web 缺口**：`src/coupon-redemption.mjs` 已能用本人事件券正式兌換，並原樣保存 33 欄與本人 `coupon_redemptions` 流水；但 `src/road-travel.mjs::availableVehicles` 原只接受原版寶箱 `__web_treasure__` 及百貨 `__web_retail__`，所以即使玩家花費 25 券得到上述五車，仍不能把它們選為公路交通工具。
- **最小修復**：道路解析器額外接入**真實** `couponCatalog`，精確核對五款的原版序號、類別、券價、效果、耐久及原始備註，選車時必須同時符合本人 `__web_coupon__` 背包、完整原始 33 欄及 `coupon_redemptions` 的原索引／名稱／價格／來源行號。舊寶箱及百貨來源保持原狀；未核實的跨玩家受贈、禮品屋或任意同名商品**不准冒充券獎車**。不調整兌換價格、取得率、公路速度或事故耐久、不導入舊 CGI 私人存檔。
- **驗證**：來源變造拒絕、五車券兌換→可選、本人與對方隔離、事故只扣一次耐久、重複請求不重複扣券／耐久、跨 Node 重啟後可抵達；以真實 HTTP 和暫時 SQLite 預置測試用 25 點事件券，不代表實際玩家有免費發券機制。CI 與真人瀏覽器驗收證據需獨立記載。

### 2026-11-23 IT-02／MP-06：禮品類載具的實際可玩用途提示

- **可重現的玩家問題**：原始 `dat_dir/syouhin.cgi` 390～396 行的七款 `ギフト` 類商品（如 396 行 `ベスパ`）在原版 `town_ini.cgi` 的交通工具名單內；Web 第66階段已允許玩家從正式百貨購入後憑本人收據、原始33欄及耐久在公路旅行使用，但背包的 `ギフト` 收合區只寫「寄送用禮品，請於禮品店／郵件中操作」，容易誤導玩家以為不能開車。PR #108 已開通五款原版優惠券載具，公路選單原本卻把非百貨來源都統稱「寶箱」，導致優惠券來源顯示錯誤。
- **最小 UI 修正**：背包僅依伺服器 `roadTravel.choices[].sourceLine` 核實後顯示禮品類載具的「可用於公路旅行」與跳轉按鈕，點擊只開啟既有公路面板、選擇合法載具並刷新前端報價；未確認用途的禮品不顯示載具捷徑。公路選單來源明確區分「百貨（含百貨禮品）／優惠券／寶箱」。不修改原始物品分類、所得來源、售價、出發資格、金錢、事故機率、耐久或 SQLite。
- **驗證**：`tests/home-ui.test.mjs` 固定後端認定清單及無誤來源呈現；`tests/browser-viewport-smoke.test.mjs` 以隔離的臨時 SQLite 固定真正原版 `ベスパ` 在百貨上架、使用 Chrome 真實滑鼠購買，於375px背包點擊車輛入口、核對選車本身不扣款／耐久，再以正式公路按鈕出發。這仍是 Chrome 自動化，不代表真人手動驗收。PR 與合併後 CI 以最新工作流程結果為準。

### 2026-11-23 IT-02／MP-06：優惠券交通獎品的背包可達性

- **確切玩家問題**：原版 `dat_dir/coupon.cgi` 第 9～13 筆的五款 `クーポン交換品:25` 載具已有原版公路使用用途，PR #108 已打通後端，本人券獎也已能在 `roadTravel.choices` 合法選車；但 `public/app.js::renderLegacyItems` 的「前往公路旅行」按鈕僅對 `ギフト` 類顯示。真正以事件券兌換保時捷的玩家在一般背包卻看到「目前尚未支援直接使用」，無法從獎品卡片理解或前往已有功能。
- **最小 UI 修正**：以**伺服器已核准**的 `state.roadTravel.choices[].sourceLine` 查核一般背包物品，只有真正合法、未用盡且仍可選擇的載具卡片才顯示「可用於公路旅行」與跳轉按鈕；統一沿用先前 `ギフト` 車的 `goToFacility("road-travel-panel")`、選車與報價更新。其他原版優惠券獎品（例如一點 `福引券`）不得誤顯示載具用途。點背包捷徑不會自動兌券、出發、扣金錢或扣耐久。
- **自動驗收**：新增真實 Chrome 以臨時 SQLite 提供 26 點測試用券，從 UI 分別兌換普通一點獎與 25 點保時捷，於 375px 真實背包驗證只有合法載具擁有入口，點選後確實切換公路面板並預選本人車，確認無額外資產變化，再用真實公路出發按鈕驗證交通可操作。既有寶箱、百貨、優惠券來源與事故耐久不修改。**這仍是 Chrome 自動化，不是實體手機或真人手動驗收**。
