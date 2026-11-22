# 第68階段：PR #35 Web SQLite 歷史版本升級測試

> **工作類型：自動測試補強**，不是新增遊戲玩法／備份功能，也不是「已完成全部跨版本升級矩陣」。本階段僅新增一組第48／67階段沒有涵蓋的舊 Web schema 版本；真人瀏覽器與跨設備驗收仍未完成。

## 確認的來源與範圍

- 舊 Web 基準：PR [#35](https://github.com/Prysline/town-kinki/pull/35)，合併 SHA `934c29f6d6e2b0a8950090b5b44f5022419272da`。
- 從當時 `web/src/server.mjs`、`src/retail.mjs`、`src/banking.mjs`、`src/housing.mjs`、`src/legacy-inventory.mjs`、`src/town-storage.mjs`、`src/solo-clock.mjs` 讀取實際資料表宣告。測試在 OS 暫存資料夾重建**該版本真實結構的代表性子集**，不是複製私人存檔或宣稱涵蓋當時所有資料表。
- 單機商品來源僅使用專案內原版 `dat_dir/syouhin.cgi` 的合法33欄資料；不匯入任何原版 CGI 玩家檔。
- 測試：`web/tests/sqlite-pr35-upgrade.test.mjs`。沿用 `node:sqlite` 與第67階段既有的 `scripts/solo-save.mjs`；沒有新增 Web 遊戲 API、UI、SQLite schema 或 npm 套件。

## 不重複的風險情境

1. 在全新 OS 暫存目錄建立 PR #35 模式的 Web SQLite，包含角色、已保存的領薪偏好、工作與用餐冷卻、銀行和定存、住宅及地圖、原版33欄道具、百貨舊收據。
2. 使用既有備份工具執行 WAL 一致快照、完整性與 SHA-256 驗證、**只還原到另一個全新目錄**。
3. 讓現行 Web 伺服器真正開啟這個舊 schema 還原檔，透過 HTTP／SQLite 核對角色、銀行、住宅、地圖、背包、百貨收據與冷卻。
4. 核對原始 PR #35 `retail_purchases` 尚無的欄位以非破壞性方式補入：`quantity=1`、`payment=cash`、`card_source_line=NULL`、`merged=0`，既有購物紀錄及原金額不變。
5. 升級後再執行一筆普通銀行存款、重啟伺服器，確認舊資產和新交易都存在，SQLite 完整性及外鍵無錯。
6. 最後核對**最初的舊 Web SQLite 仍保留原本 schema 與金錢**，沒有被升級流程覆寫。

## 證據與未完成事項

- 對應 PR：[測試補強 PR #94](https://github.com/Prysline/town-kinki/pull/94)。只有該 PR 的**最終 HEAD** push 與 pull_request CI 均成功，才可以在現行計畫將此單一歷史版本的自動驗證記為已通過。
- **已知已有證據**：第48階段同一 SQLite 跨兩次 Node 重啟；第67階段現行版 WAL 備份→新目錄還原→HTTP 續玩。這裡補的是不同版本資料表欄位與舊資產保護，絕不重做那些流程。
- **仍待**：其他真正有 schema 變更的中期／後期 Web 歷史版本（釣魚、合成、郵件、公路等）、不同 OS／設備的實地還原、真人桌面與375／768px瀏覽器操作、部署備份輪替及正式環境安全。

最新入口請看 [PROJECT-STATUS-AND-PLAN.md](PROJECT-STATUS-AND-PLAN.md) 的 DB-04 與驗收章節。
