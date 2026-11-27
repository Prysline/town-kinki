# 第67階段：單機 Web 存檔備份、完整性驗證與新資料夾還原

日期：2026-11-22。起點為第66階段合併後 Web HEAD `6b8e85ad4cc2a591e215888f85698ab92978323c`，分支 `feature/web-phase67-solo-save-backup-restore`。**本階段依使用者再次確認「單機優先」修正後續排序**；只修改 `web/**`，保留原版 `master`、原始 CGI 及所有舊玩家存檔。單機 SQLite 是新版 Web 玩家自己的進度，與原版 CGI 舊檔匯入完全無關。

## 本階段選擇的單機阻塞點

- 第48階段已驗證單機工作、銀行、百貨購物、消耗品、用餐及兩次 Node 進程重啟。但那仍只是**同一個 DATA_DIR 直接重啟**，不是可實際交給玩家使用的備份／復原功能。
- 原版 CGI 根目錄及舊資料與 Web 新存檔沒有直接關聯；此階段不新增前端暴露 SQLite 檔案的 API，也不製作 CGI 匯入器。
- `web/src/server.mjs` 使用 Node `node:sqlite` 的 `DatabaseSync`，預設資料位於 `web/data/solo.sqlite`，且使用 `PRAGMA journal_mode=WAL`。**當 Web 伺服器仍在執行時，不可用單純檔案複製 `solo.sqlite` 的方法假裝得到一致存檔**，必須使用 SQLite 的一致性快照工具。

## 使用方式（Node.js 22.13 以上，僅限本機單機）

從 `web/` 執行，將備份位置改成自己需要的路徑：

```sh
cd web
node scripts/solo-save.mjs backup --data-dir ./data --output ./backups/solo-2026-11-22.sqlite
node scripts/solo-save.mjs verify --file ./backups/solo-2026-11-22.sqlite
```

`backup` 使用內建 `node:sqlite.backup` 產生一致快照，包含 WAL 中已提交的交易；不關閉現有伺服器也可以建立備份。完成前將檔案寫到同一資料夾的亂數暫存檔，通過 SQLite 完整性／外鍵／單機表格檢查才以**原子硬連結**發佈正式備份，且**絕不覆寫既有備份**。備份檔權限設為只有本機檔案擁有者可讀寫（POSIX `0600`；其他檔案系統受作業系統權限模型限制）。

```sh
# 還原前先停掉原本正在使用的單機遊戲伺服器
node scripts/solo-save.mjs restore --file ./backups/solo-2026-11-22.sqlite --data-dir ./restored-solo

# 在新資料夾單獨啟動驗收，不覆寫 data/solo.sqlite
DATA_DIR=./restored-solo npm start
```

Windows PowerShell 啟動新資料夾：

```powershell
cd web
$env:DATA_DIR = "./restored-solo"
npm start
```

`restore` 再次驗證備份 SQLite `integrity_check`、`foreign_key_check`、`users`、`characters`、`solo_clock`（含 `id=1`），複製到新資料夾的暫存檔後計算完整檔案 SHA-256，比對原備份後才原子發佈 `solo.sqlite`。若目的地已有 `solo.sqlite`、`solo.sqlite-wal` 或 `solo.sqlite-shm`，**必須拒絕還原，沒有 `--force` 開關**。請使用全新的資料夾測試確認角色、金錢、背包、工作冷卻及遊戲時間後，再自行決定要不要把該資料夾當作往後遊玩的 `DATA_DIR`。原本 `data/` 始終不改動。

J 階段來源防護：`verify`／`restore` 只接受固定的單檔快照，來源含非空 WAL 時拒絕（先使用 `backup`），不自行 checkpoint 或刪除旁檔。還原發佈前再次檢查來源 WAL 與 SHA-256；已被分離／遺失的 WAL 不能由主檔雜湊推知，也不保證持續被外部修改的來源安全。詳 [J 階段稽核](phase-j-storage-upgrade-audit.md)。

備份檔包含本機角色資訊與資產，請勿上傳公開儲存庫或分享給不信任的人。工具不備份 Web 以外的檔案、原版 CGI 玩家資料、部署環境或外部附加素材；這是**單機 Web 存檔保全工具**，並非所有系統資料的災難復原解決方案。

## 測試

- `web/tests/solo-save.test.mjs`：在 WAL 模式且源資料庫仍開啟時建立一致快照、SHA-256 完整性、還原後角色／現金／時間原值保留，來源繼續修改不影響還原結果；原子拒絕覆寫既有備份與存檔；WAL 旁檔阻擋還原；無效 SQLite、外鍵孤兒、缺少欄位與重複 CLI 參數拒絕。
- `web/tests/server.test.mjs`：用真正單機 API 建角、設銀行領薪、工作、存款、設百貨、購買原版書籍、真實消耗道具；**伺服器仍開啟時執行備份**；來源繼續存錢後另用新 `DATA_DIR` 還原，核對角色、金錢、銀行、能力、地圖、原版33欄道具使用、購買流水，重送購買／使用不重扣，五分鐘後可再次工作，再重啟新的 Node 伺服器仍保存續玩結果。
- 既有所有單機、多人權限隔離測試保持；**本階段沒有新增多人玩法**。沒有新 SQLite schema 遷移，Web 現有存檔仍由原伺服器照常使用。

## 必須坦白保留的邊界

- 這些是透過 Node 和 HTTP／SQLite 自動測試確認的單機流程；**尚未進行真人桌面／手機 `375px`、平板 `768px` 的實際點擊與視覺驗收**，不能用 CI 成功替代。
- 尚未證明不同版 Web 完整升級矩陣、所有隨機事件、住宅及每個設施存檔都已實測。本階段只是把原有單機循環的**可備份、可驗證、可還原並繼續遊玩**這條缺口補完，不表示全原版玩法已完整移植。
- `restore` 故意不支援直接替換現用存檔；避免進程仍在使用 WAL 時覆寫導致資料丟失。這是安全邊界，不是缺漏待實作的 CGI 匯入功能。
- 下個階段繼續依單機優先順序：真實瀏覽器驗收與阻塞流程修復、跨版持久性、已有原版資料依據的單人玩法，**不把轉禮／跨玩家來源鏈排在單機首位**。

本階段合併門檻：功能分支最終 HEAD 的 `push` 與 PR `pull_request` CI 皆 success；PR 只合併到 `feature/web-dual-mode-phase1`，合併後 Web HEAD 同樣兩組 CI success，再確認原始 `master` SHA 沒有變。
