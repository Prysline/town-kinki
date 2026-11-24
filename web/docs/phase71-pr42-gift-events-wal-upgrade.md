# 第71階段：第37階段舊禮品交易帳簿 Web SQLite 無損升級驗收

> **工作類型：DB-04／自動測試補強**。本階段檢驗新 Web 歷史存檔，不匯入或驗證舊 CGI 玩家私人資料，也不新增禮品功能或資料表。

## 直接歷史來源

- [PR #42](https://github.com/Prysline/town-kinki/pull/42) 第37階段合併 SHA `db585bc8b7d4044b8c590ca4fda33b424b126793` 的 `web/src/gift-shop.mjs::initGiftTables`：`gift_events` 實際只有 `id/user_id/request_id/action/source_line/quantity/recipient_user_id/result_source_line/fee/name/created_at`，不含 `message`，當時亦未建立 `gift_mail_messages`。
- 第46階段為防同一 requestId 改寫寄禮信內容，使用 `PRAGMA table_info` 與 `ALTER TABLE gift_events ADD COLUMN message TEXT NOT NULL DEFAULT ''`。先前記錄應預設空字串、保留同一請求碼與已收費金額，不得因此重做交易。
- **既有測試不重做**：`gift-shop.test.mjs` 在記憶體 SQLite 涵蓋舊欄位升級；`sqlite-pr53-gift-mail-upgrade.test.mjs`（PR #96）專測更晚的寄禮信箱 FK 無損升級；`sqlite-pr86-road-upgrade.test.mjs`（PR #113）專測舊公路 pending。這次是另個時期的交易帳簿資產風險。

## 自動驗收路徑

1. 在 OS 暫存目錄建立以 PR #42 真實 `gift_events` schema 為核心的新 Web 歷史 SQLite 代表性子集，保存原已完成的 50,000 元禮品轉換、本人現金與存款、兩件原版33欄商品、實際禮品店地圖及單機時鐘。來源及獎勵都在本專案和測試目錄內。
2. 使用既有 `scripts/solo-save.mjs` 作 SQLite WAL 一致性備份／SHA-256 驗證與全新 `DATA_DIR` 還原。現行 Web 啟動後檢查新增 `message` 欄位與舊事件空字串，而舊禮品及現金原值不變。
3. 透過正式 `POST /api/gift/convert` 重送舊請求碼：回傳 replay，不再扣50,000；同請求碼更換來源物品應拒絕。同時真正轉換第二件合法持有物，僅扣一次50,000，重送仍不得重扣。
4. 停止／重啟現行 Web 後，核對交易數、存款、現金、已轉換道具原版33欄與完整性／外鍵，及舊 Web 原始檔與備份雜湊沒有被升級後的狀態覆寫。

## 驗證狀態與限制

- 實作於 [Draft PR #114](https://github.com/Prysline/town-kinki/pull/114)，測試 `web/tests/sqlite-pr42-gift-events-upgrade.test.mjs`；**CI 必須按該 PR 最終 HEAD 的 Push 與 Pull Request 工作流程實際結果確認，不得提前宣稱成功**。
- 只修改 `web/tests/**` 與 `web/docs/**`；不修改現行遊戲規則、正式 SQLite schema、原始 CGI、`master` 或任何玩家實際存檔。
- 新測試為第37階段重要 schema 的代表性子集，而非整份歷史資料庫；未涵蓋實體多 OS 還原與真人瀏覽器驗收。此 PR 不自動合併。
