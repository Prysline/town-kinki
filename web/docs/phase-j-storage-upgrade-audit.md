# J｜Web SQLite 整合、歷史升級與存檔安全稽核（進行中）

## 基準與範圍

- #138 已合併正式 Web HEAD `2ddfcf70b67e4ed7f7c571326094eeb7507da847`，tree `a8e2c8542ad3029a02a636f7d14b573662409575`；[正式 Push](https://github.com/Prysline/town-kinki/actions/runs/45814813764)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45814822810) 完整日誌均 955/955、fail/cancelled/skipped/todo=0、server/app 語法通過。master 未變，#1 保持 Draft。
- 只處理 Web SQLite，測試在 OS 暫存資料夾產生；不讀取、搬移或匯入 CGI 私人玩家存檔，不改玩法、機率、數值或冷卻。

## 既有證據（不重做）

- 第67階段 CLI、現行 Web HTTP WAL 備份與新目錄還原續玩；#94 PR35 百貨收據／住宅／背包；#96 PR53 信箱外鍵 v2→v3；#113 PR86 未完成公路旅程；#114 PR42 舊禮品收據（已合併 `05a1af58a59e2c286ef5160fdc04655fe7745409`）。四個歷史測試皆在現行分支，為代表性 schema 子集，不是完整歷史 DB。
- #104/#105 已驗銀行初次稅務升級與跨週欠稅備份還原。現行 banking.mjs 已有非負 K 點稅表重建交易與記憶體測試；#103 合併 `441a30bffc9c45e2a303b988f98fb530f97a9f2a` 的真實舊表含 CHECK(kpoint>=0)。仍需實體舊表→快照→升級→負 K 點週稅及故障回滾。
- #121 已驗現行戰鬥四模組收據、跨模組請求碼、負 K 點、隔離及回滾；原五個 PR #115–119 為來源分支，已被正式整合取代，不重開。B／大阪／街頭／C 各自以 user_id、request_id 唯一收據防重；大阪歷史 JSON 的 npcSource/npcSourceVersion 若缺少則顯示 unknown/null，不應偽填重建來源。現行核准 web-osaka-npc-v1 與原始來源分開。
- I 階段已驗現行 HTTP 重啟、事件歷史、領獎、券、耐久、金流與稅基；歷史 schema 及整合還原仍需驗證。現行 server 先補 characters 欄位，初始化銀行→C 聯賽→事件及券→街頭等→物品、裝備→B／大阪→寄禮／私人信件等，再做大阪獎品遷移及 NPC 來源載入。需以歷史公開 Web 程式核實代表性版本及相依順序；不把歷史文件的未完文字當現況。

## J-1｜來源 WAL 單檔還原防護（本切片）

- 真實缺口：直接將仍有 WAL 交易的主檔傳給舊 restore，verify 讀到 WAL 中的資料，而 copyFileSync 只複製主檔。完整性、外鍵、SHA-256 都通過卻遺失已提交金額。Node 22.16.0 本機以正式來源 blob `0e7238eb7ec85605c5456f1ecbc30e445630f832` 重現：源現金 101000、還原現金 100、WAL 4152 bytes、SHA-256 相同。
- 保留原有 SQLite backup()；拒絕有非空 WAL 的 verify/restore 來源，還原發佈前重查來源 WAL 與雜湊；不刪除或 checkpoint 來源。空 WAL 旁檔不阻擋正常快照。來源必須是固定備份；若 WAL 已被外部移除，僅憑主檔無法找回或辨認遺漏的交易。
- 本機 Node 22.16.0：以正式 blob 原始三項 solo-save 測試 3/3；新增回歸在修正前 3/4（Missing expected exception）；修正後 4/4，腳本語法成功。測試證明合法 WAL 快照能保留最新金額、錯誤來源拒絕發佈且來源主檔與 WAL bytes 不改。未執行完整儲存庫 HTTP／SQLite 回歸，待同 HEAD push/PR CI。
- 同一 Draft PR 追加審查：第一版可經符號連結繞過 WAL 防護，已於本機重現；追加 realpathSync 真實路徑解析，驗證／還原共用真實來源，合法快照的符號連結仍可使用。新增回歸在第一版 4/5，修正後 5/5，語法成功。符號連結測試在 Linux 執行，Windows 權限／設備演練尚未驗證。
- 既有 CLI 不是新功能；不更動資料表或遊戲 API。J-1 未合併前不宣稱完成，合併後須核對正式 HEAD/tree/雙 CI。

## 後續驗收切片（待逐項查證）

1. #103 真實舊稅表、負 K 點、索引及歷史資料的實體 WAL 升級與失敗回滾；保留 #104/#105 已驗證情境。
2. 以歷史公開 Web 戰鬥模組／正式 #121 代表性 schema 核對收據、NPC 來源、重送及帳號隔離，連同舊稅表交叉驗證。
3. 以歷史 Web 事件與券 schema 及 I 前後的正式版本測試歷史、道具耐久、領獎／兌換收據、銀行帳簿與稅基不丟失；保留核准兩笛規則。
4. 聯合回歸與故障復原（新目錄、來源及快照保留、integrity_check、foreign_key_check、HTTP 續玩與重啟、帳號隔離）；整理同 HEAD 四組 CI 及完成界線。真人、跨設備、正式部署演練另列，不能由 CI 取代。
