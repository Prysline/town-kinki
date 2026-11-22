# 第 69 階段：PR #53 舊 Web 寄禮信箱無損升級驗證

> 工作類型：**跨 Web 版本的自動測試補強**，不是新增私人郵件玩法，也不是完整版本矩陣或真人實機還原。本文承接 [現行狀態計畫](PROJECT-STATUS-AND-PLAN.md) 的 DB-04，使用已有的 `solo-save.mjs`，原版 CGI 玩家私人檔案永久不在範圍。

## 歷史來源與實際差異

- 歷史 Web [PR #53](https://github.com/Prysline/town-kinki/pull/53)，合併 SHA `9a29e04ef03a1c6930094c8a5c3c42ce4e384b4c`：`web/src/gift-shop.mjs::initGiftTables` 的 `gift_mail_messages.event_id` 是 `NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE`，刪掉寄件人／其禮品事件可能連帶刪除**其他收件人的舊信**。
- 中間 [PR #58](https://github.com/Prysline/town-kinki/pull/58) 合併 SHA `eacdc7e3b65f44600b20b1c1bf98a27786ee675b` 導入的安全遷移：`gift-shop.mjs::migrateMailOwnership` 先重建 v2 信件表解除事件外鍵，再由 `private-mail.mjs::initPrivateMailTables` 升級 v3，允許寄禮信與一般純文字信共存。
- **測試資料**：在 OS 暫存目錄按 PR #53 的使用者、角色、寄禮事件、信箱和持有物欄位重建一組**代表性真實 schema 子集**。這不是從實際玩家 SQLite 擷取、不是整份 PR #53 資料庫 dump，亦不保證涵蓋其他歷史欄位。
- 新測試 `web/tests/sqlite-pr53-gift-mail-upgrade.test.mjs`，沿用 Node 22 `node:sqlite`、既有 Web HTTP 伺服器及第 67 階段 CLI 功能，不加 npm 相依、不改現有遊戲規則或資料表宣告。

## 可觀察驗證路徑

1. 建立歷史 PR #53 Web SQLite：本機玩家為收件者、另一 Web 帳號為寄件者；有一筆附信禮物交易、兩位各自的收／寄件紀錄、已入庫的原版 33 欄收禮品，並預先驗證當時確實存在 `gift_events` 外鍵。
2. 在不開啟現行 Web 的情況下，對舊資料執行 WAL 快照、`integrity_check`／SHA-256／外鍵驗證並還原到**全新資料夾**，保護來源檔。
3. 以現行 Web 在還原目錄啟動，確定 v2→v3 遷移後原信件 ID、原文、方向、禮品名稱／份數、收禮資產與角色餘額不變，`private_event_id` 可為 NULL 且 `gift_events` 外鍵已移除。
4. 透過新 HTTP `mail/send` 從升級後角色向舊寄件者寄出**純文字信**，驗證與寄禮信共用信箱以及相同 requestId 防重。
5. 刪除舊寄件者帳號，使舊 `gift_events` 消失；驗證**收件者的歷史寄禮信、已收到的禮品及新文字信**都不被連帶刪除。重啟現行 Web 後再次比對。
6. 最後重新檢查原始舊 Web 資料庫仍有兩名玩家、原始 2 筆收／寄信且依然保留舊外鍵／未新增 v3 欄位，沒有被升級流程覆寫。

## 證據與未完成

- [本次 PR #96](https://github.com/Prysline/town-kinki/pull/96)：已觀察到[測試提交 push CI](https://github.com/Prysline/town-kinki/actions/runs/45024428062)、[測試提交 PR CI](https://github.com/Prysline/town-kinki/actions/runs/45024449683) 均成功；文件補充後**仍必須以最終 HEAD push + pull_request CI 雙成功為合併門檻**，合併後應再核對 Web push 與長期 PR #1 回歸。
- 原有 [PR #94](https://github.com/Prysline/town-kinki/pull/94) 驗的是 **PR #35 百貨舊收據** 與角色銀行／住宅等資產，並沒有重複本次舊信箱外鍵風險。
- 尚待：其他真實 Web schema 時期（後期釣魚／合成／交通／郵件擴充）、完整歷史 DB 鏡像、多 OS／設備現場還原、真人瀏覽器操作，以及正式環境備份輪替演練。**測試通過不等於已完成整個 DB-04 項目。**
