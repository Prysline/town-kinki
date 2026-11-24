# 第70階段：PR #86（第62階段）Web 公路旅程實體 SQLite WAL 升級與續玩驗收

> 工作類型：**DB-04／跨版本自動測試補強**。這是對既有公路跨版**記憶體**測試的外部持久化補強，不是新玩法，不是新備份工具，也不是完整歷史版本矩陣。

## 歷史來源與選定風險

- 實際歷史 Web：公路第62階段 [PR #86](https://github.com/Prysline/town-kinki/pull/86) 已合併 SHA \`8de151b68b54836f7d58c2cdc5e4b7571cd6bd34\`；當時 \`web/src/road-travel.mjs::initRoadTravelTables\` 的 \`arcade_road_trips\` 只有目的地、選定載具、預計到站時間、事故、鍛鍊與完成欄位。
- 後續第63／64階段新增 \`requested_to_town\`、\`lost\`、\`rerouted\`、\`by_bus\`、\`fare_paid\`；現行 \`initRoadTravelTables\` 以欄位存在檢查逐一補建，舊行程應維持原目的地、不重抽迷路、不冒充巴士或增加已付車資。
- **已有證據**：\`tests/road-travel.test.mjs\` 已於記憶體 SQLite 驗證第62階段未完成旅程、舊完成紀錄的欄位升級與函式抵達，\`tests/server.test.mjs\` 已於**現行 schema**覆蓋公路 HTTP 重啟。這兩者並未覆蓋**歷史實體 Web SQLite→正式 WAL 快照→新資料夾還原→現行 HTTP→第二次重啟**這條鏈。
- 本次測試只在 OS 暫存目錄重建第62階段真實公路資料表及索引，搭配新 Web 身分、角色、時鐘與銀行的代表性歷史 schema 子集；**未使用、讀取或轉換 CGI 玩家存檔**，不是完整第62階段 SQLite dump。

## 新增回歸（\`tests/sqlite-pr86-road-upgrade.test.mjs\`）

1. 舊玩家現金 80,500、普通銀行 9,500、定存 2,500；出發時徒步鍛鍊已得到體力 3 點（20→23），歷史完成旅程一筆、未完成的第62階段行程一筆；\`solo_clock\` 偏移為 0。
2. 用既有 \`scripts/solo-save.mjs\` 的 SQLite WAL 一致快照、SHA-256、完整性與外鍵檢查，還原到全新 \`DATA_DIR\`，由現行 \`src/server.mjs\` 真實啟動並做條件式 schema 升級。
3. 透過 HTTP 核對舊旅程 \`requested_to_town=to_town\`、\`lost=0\`、\`rerouted=0\`、\`by_bus=0\`、\`fare_paid=0\`；歷史結果及鍛鍊不重算，pending 狀態下不洩漏事故／迷路。
4. 舊 \`requestId\` 不重複出發；另一趟出發與未到時抵達均被拒絕；使用正式單機 30 分鐘快轉後手動到站，抵達重送不得再次改城、扣金額或加能力。
5. 再啟動伺服器，核對錢、銀行、體力、城鎮、單機時間、歷史紀錄與 SQLite 外鍵／完整性；原始舊資料庫 schema 與備份雜湊不因新的 \`DATA_DIR\` 升級而被改動。

## 範圍與證據界線

- 本次 [Draft PR #113](https://github.com/Prysline/town-kinki/pull/113) 僅修改 Web 測試與狀態文件；CI 以 PR 最終 SHA 的 push 與 pull_request 實際結果為準，**未核對前不得填寫為通過**。
- 不改動任何正式玩家資產、SQLite 正式 schema、遊戲規則、原始 Perl/CGI 或 \`master\`。
- Node HTTP／SQLite 自動化不是跨實體 OS／設備還原演練，也不是真人桌面／375px／768px 遊玩驗收。
- 第70階段只驗**第62階段公路 schema 的代表性切片**；其他 Web 歷史版本、複雜事故車輛耗損、跨設備演練仍需另外有明確證據的工作。
