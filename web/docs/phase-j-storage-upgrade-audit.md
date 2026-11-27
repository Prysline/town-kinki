# J｜Web SQLite 整合、歷史升級與存檔安全稽核（J-1～J-5 正式完成；J-6 結案清冊）

> 現行結案證據見本文末節；各候選／未完成文字保留當時歷史，不代表現行待辦。J-6 文件本身的四組 CI 與正式結案見 [#151](https://github.com/Prysline/town-kinki/pull/151)。

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

## J-1 正式驗收

- #139 已合併 `0ebd42100de9bbf84834995641681d006dd91935`，tree `9409ba6cfd1086181570396df2d52f56efcf2efc`。合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45815722218)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45815734733)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45816981606)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45816991773) 四份完整日誌皆 957/957，fail/cancelled/skipped/todo=0、server/app 語法成功，測試 tree 一致。
- 其後 #136 i18n 合併，正式基準 `a5b6a4f2865ca1d1a2fc04432ba02f3373455907`，tree `cade5967ad9f353c3999915c7fca872267ed19cd`。[Push](https://github.com/Prysline/town-kinki/actions/runs/45823836341)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45823844212) 完整日誌均 962/962、其餘計數 0、語法成功；差異僅九個 web 檔案，不更改銀行或備份工具。master 不變，#1 Draft。

## J-2｜#103 歷史稅表實體遷移（候選驗收）

- `tests/sqlite-pr103-bank-tax-upgrade.test.mjs` 取 #103 真實歷史 Web bank DDL、核心表及逐欄新增順序，建立代表性 schema 子集。已繳與未繳歷史、帳簿、稅基、兩個隔離測試帳號與 WAL 提交資料均為合成 fixture。
- 驗收設計：一致備份、兩個新目錄還原、來源 bytes/SHA-256 不變；在正式遷移複製後注入真實 SQL 錯誤、DDL 回滾、關閉重啟重試、索引及其他約束保留；稅務 INSERT 失敗時利息／銀行餘額／帳簿／稅基整筆回滾。另一未升級副本走實際 server 啟動順序，負 K 點星期一結算、歷史欠稅、HTTP 存款、同日重送、重啟及帳號隔離。
- 本切片不修改正式遊戲程式或 schema。測試的負 K 點以隔離資料注入，非新增單機對手；不代表完整歷史 DB 或真人操作驗收。重建後的候選檔完整 HTTP 測試待本 PR 同 HEAD 雙 CI，不沿用上一工作環境的局部測試結果。

## J-2 正式驗收

- #140 已合併 `06711c4cc0bc88b5251c912ad9be0038ff73692a`，tree `01567438bd707028e5147e8d4299ecb27aef6aa5`；合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45824388143)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45824398323)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45825464170)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45825475912)，四份完整日誌 963/963、fail/cancelled/skipped/todo=0、server/app 語法成功；合併與 PR 測試 tree 一致。master 未變、#1 Draft。J-2 指定範圍正式驗收。

## J-3a｜#121 單機歷史戰鬥收據（候選）

- #121 正式合併 `e2e3004ad9af13021c4bae540863f9ca26e34b10` 與目前基準的 B、大阪、C、街頭、戰鬥核心、NPC 來源／重建、銀行、裝備、道具使用、town-storage Git blob 一致；事件與 legacy-inventory 模組後續有變動，故以歷史核心與 legacy-inventory DDL、相同 blob 初始化器建立代表性子集，而非宣稱是完整舊版 DB。
- `tests/sqlite-pr121-solo-battle-upgrade.test.mjs`：歷史 B／大阪／C 收據與實際產生的獎品、培育紀錄、稅基、共用請求碼，WAL 快照到新目錄後走正式 HTTP；大阪以隔離合成的專用十檔 NPC 測試 original-file，與核准 reconstructed 分開。另依歷史 Draft c38adff1 原始無標記收據形狀建立 fixture，來源 unknown/null，不將未曾正式合併的 Draft 當正式歷史版本。
- 來源政策切換（auto 缺檔→original-only 缺檔→完整合成專用檔→auto 缺檔）與重送、拒絕改難度／操作種類、實際續玩新戰鬥、重啟、原收據 JSON／資產不變、來源主檔/WAL及快照 SHA-256、完整性與外鍵。只讀公開遊戲規則/商品來源，合成 NPC 檔不是真實原版 NPC 或玩家檔。
- 單機只建立一個角色，街頭拒絕挑戰；多人街頭歷史收據、真正多帳號隔離、負 K 點與整合稅表交叉驗收留 J-3b。J-3a 新測試待同 HEAD CI，不宣稱已通過。

## J-3a 正式驗收

- #141 已合併 `cbbfbe2e6a4cf05f81c6c14c66d43986dbcb1884`，tree `5b5bd4e95f086187c529d9673c1b14f25111b3b3`；合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45826004413)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45826016226)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45830714882)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45830725846)，四份完整日誌 964/964、fail/cancelled/skipped/todo=0、server/app 語法成功；合併與 PR 測試 tree 一致。master 未變、#1 Draft。J-3a 正式驗收。
- 在該正式 HEAD 分批掃描 web/** 共 282 檔案，以四戰鬥表名、模組初始化器、HTTP route/result、NPC 標記及相關文字定位來源、前端、測試、文件及工具；直接程式相依仍為四戰鬥模組、server、前端 app。無需改正式玩法。

## J-3b｜#121 多人歷史戰鬥收據（候選）

- `tests/sqlite-pr121-multi-battle-upgrade.test.mjs`：與 J-3a 同一歷史正式 #121 schema 子集，去除單機時鐘，採同版 character_coupons DDL 及實際兩個合成 Web 帳號／歷史 session、正式戰鬥核心產生街頭無對手／勝利／負 K 點／券、B、大阪、C 收據。非私有 CGI 存檔、非完整歷史 DB。
- 使用 SQLite backup()、SHA-256、完整性／FK、COPYFILE_EXCL 到獨立 multi.sqlite 測試目錄；只測歷史多人 DB 升級及續玩，不新增多人產品備份 CLI。來源主檔/WAL/快照保持不變。本機 Node 22.16.0 獨立合成 SQLite 快照冒煙 1/1，候選測試主體語法通過；不冒稱完整 HTTP CI。
- 真正歷史 session 與登入、拒絕未登入及冒用 userId、兩帳號跨玩法同請求碼與原收據防重；不同玩家可以使用相同請求碼產生自己的收據，對方資產、戰績和歷史不得改動（C 聯賽全域排序可合法更新）。以 SQLite trigger 注入街頭收據寫入失敗，現金、能量、K 點、券、帳簿、稅基及歷史回滾，原請求重試後重啟。
- 另一還原副本直接使用正式銀行核心結算下週一，驗證街頭真正產生的負 K 點、歷史已繳／未繳稅、索引外鍵、重複結算與隔離；#121 本來就是有號稅表，#103 非負約束的遷移已由 J-2 實測，不混成未存在的歷史版本。多人時鐘仍是真實時間。
- J-3b 待同 HEAD 雙 CI 及合併後雙 CI，完成後 J-3 結案；J-4 另窗接續，不先做。

## J-3b 正式驗收

- #142 已合併 `9c53829ba76bc4cb539844f260d035ed9453d9f7`，tree `cb53b3fd47ee46eec5a4e9899a0df02cdc0c4086`；合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45832487149)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45832499741)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45833156131)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45833166687) 四份完整日誌皆 965/965、fail/cancelled/skipped/todo=0、server/app 語法成功；正式與 #1 合成 tree 一致，master 未變、#1 Draft。J-3a／J-3b 指定範圍正式驗收，不重做。

## J-4a｜早期歷史事件欄位升級（候選）

- 正式分支祖先 `6859a66427bd1ce45e4a987d11ef245e0b8ea31a` 的 server 已初始化舊疾病事件表；events 尚無 description、effects_json，下一個 `1ae4134b4a462d3b990d688cd6ccaa8254943da8` 才有兩欄遷移。歷史 server/events/banking blob 分別為 `be6d97fa50daaa93c1a49aef7226b52c2477d165`、`18fd468008efaacdbc768ade30e4813439d88a1e`、`801950ea5227e430f685c337b22e6003180c93fb`。以代表性歷史 DDL 與歷史疾病核心、合成 Web 角色建立 #4/#15 事件，不假裝是完整舊版 DB。
- `tests/sqlite-historical-event-columns-upgrade.test.mjs`：原版 Web 尚無 solo_clock，現行備份 CLI 要求該表；以測試 SQLite backup() 建立一致 WAL 快照並 COPYFILE_EXCL 到獨立新目錄，不放寬產品 CLI。正式 server 初始化、歷史欄位預設與顯示、索引外鍵、單機無其他居民、銀行續玩、#30 發券歷史故障回滾與重試、同日防重、重啟與來源/快照 SHA-256。僅合成 fixture，未讀 CGI 私人資料。
- I 前 #128 `27d8ed7864e58bbb3d81bab526f8295acee542a8`、I 結案 #137 `008c4556519a97f1d4d20721dc1d3213e55b82b8` 均已有完整事件欄位、券、蟑螂挑戰與兌換表；其既有領獎／兌換收據、耐久、多人及跨 I 資產事件另切 J-4b 等，不以本切片宣稱 J-4 完成。
- 本機 GitHub DNS 不通，未執行完整儲存庫；待同 HEAD Push/PR CI、完整 diff 與合成 tree 審查及合併後雙 CI。未改正式玩法、schema 或備份 CLI。

## J-4a 正式驗收

- #143 已合併 `32aa6d070b504d1d1b1c1cecfe7ce31c799d63f6`，tree `e4fd2d534a24ff92d987e9ccbb0997038eaa1a1d`；合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45840184845)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45840215989)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45843890966)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45843904080)，四份完整日誌皆 966/966、fail/cancelled/skipped/todo=0、server/app 語法成功；正式與 #1 合成 tree 一致，master 未變、#1 Draft。J-4a 正式驗收，不重做。

## J-4b｜I 前歷史券、領獎、耐久收據（候選）

- 取 #128 `27d8ed7864e58bbb3d81bab526f8295acee542a8` 的實際 server/core、banking、events、cockroach、legacy-inventory、legacy-item-use、coupon-redemption、solo-clock、town-storage 初始化 DDL 及歷史蟑螂領獎核心；兌換及使用核心在目前與 #128 的 blob 分別一致為 `7a7138e659827bfbda5a7d834286ecb989b115ed`、`d574c365625aa943de4cfd83f450e815b05e13b4`。歷史事件及 33 欄道具為合成 fixture，不是完整歷史 DB，無 CGI 私人檔。
- tests/sqlite-pr128-event-receipts-upgrade.test.mjs：真正單機 backup/verify/restore、WAL 雜湊、拒絕覆寫、新目錄 server、caught/escaped/pending、指定事件 ID、原券兌換與使用收據重送、來源行號/原始欄位及剩餘耐久、CHECK/UNIQUE、注入三種 SQL 錯誤回滾、HTTP 重試、重啟。未改玩法、資料表或 CLI；多人及跨 I 金流另切 J-4c。
- 本機未執行完整儲存庫測試，待同 HEAD 四組 CI；不提前宣布 J-4b 完成。

## J-4b 正式驗收

- #144 已合併 `811b0dee15582c2958cdb54f388acc3381ffe853`，tree `2a3650420872fe3fbdbff4065cc142d6a98931d5`；合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45851612499)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45851622316)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45852059416)／[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45852075850) 四份完整日誌皆 967/967、fail/cancelled/skipped/todo=0、server/app 語法成功；正式與 #1 合成 tree 一致，master 未變、#1 Draft。J-4b 正式驗收。

## J-4c｜I 前後歷史多人事件金流（候選）

- #128 `27d8ed7864e58bbb3d81bab526f8295acee542a8`、#137 `008c4556519a97f1d4d20721dc1d3213e55b82b8` 的 server 核心 DDL 完全相同；banking、town-storage、券、道具使用初始化器與目前 blob 一致。#137 的 events/event-effects/事件道具/蟑螂/居民轉帳/聖誕及河中物品模組與目前 blob 一致。以 tests/fixtures/j4c-pr128 保存五個 #128 公開 Web 歷史模組及來源 blob；只調整同 blob 相依的 import 相對路徑，非 runtime。兩個 fixture 為代表性 schema 子集、合成三帳號及合成 Web session。健康日期固定當日避免 HTTP 無關日結算。
- tests/sqlite-pr128-pr137-multi-event-upgrade.test.mjs：真正歷史 #16 兩次攝影機耐久及銀行扣款、#128 交易後未刷新稅基與 #137 已刷新差異；#137 真實 #36/#40 收據，跨 I 保留歷史。實體 WAL 快照、新目錄非覆寫、SHA-256、FK/完整性；多人實際 HTTP session、同請求碼各自兌換、他人道具拒絕、手動笛使用重送與重啟。
- 現行銀行日結算正常刷新後，固定 RNG 走正式事件核心驗證 #36/#37 足額及不足額、#28 轉帳、抽本人、K 點、雙方普通帳簿/稅基/歷史/耐久、不重抽；四個故障注入點驗證原子回滾再重試。非真實隨機 HTTP 抽選、非真人測試。多人快照為測試 SQLite backup() 與 COPYFILE_EXCL，不增加產品多人備份 CLI。未讀取私人 CGI 檔、未改玩法或正式 schema。本機未執行完整儲存庫，待同 HEAD 四組 CI；J-4 尚未結案。

### J-4c 首輪 CI 故障與修正（候選）

- #145 首輪 [PR](https://github.com/Prysline/town-kinki/actions/runs/45855464247) 969/969，兩項 J-4c 成功；[Push](https://github.com/Prysline/town-kinki/actions/runs/45855452497) 968/969，第840項既有第55階段多人骰子 HTTP 測試在啟動時 EADDRINUSE（127.0.0.1:36495），不是遊戲斷言失敗；server/app 語法步驟因 npm test 失敗未執行。保留紅燈，不以另一份成功替代。
- 根因為 11 個 HTTP 測試啟動器先綁定空埠、關閉再啟動子程序，存在 TOCTOU。改由現有 PORT=0 讓 OS 在實際 server 綁定時原子分配，啟動日誌印出實際 server.address().port，測試等待自己的子程序日誌並保留 HTTP /api/state readiness。固定 PORT 的正式啟動方式不變，沒有新增測試 API 或改遊戲規則。原斷言、測試並行與超時保留；新增雙子程序同時啟動、不同 URL、真正建角與另一存檔隔離測試。待新 HEAD 雙 CI 完整日誌及合併後雙 CI。


## J-4 正式驗收

- #145 已合併正式 HEAD `b084e46e3551f7da470d33438290f1e2153ca470`，tree `63bc512f3e8e2add84a29bbc326307dfbb4e20d1`；候選 `d1a2e8b568c05833f15016734048558c122808b9`、#145 合成 `c9b67bc9b18608ea153a02619e2faf49f7aa151d`、#1 合成 `57e0d540ca2ad4f9b2303f9271c3eac0763b1809` 同 tree。
- 合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45856408980) job 140035836178（6311 行）、[PR](https://github.com/Prysline/town-kinki/actions/runs/45856418555) job 140035868089（6327 行）；合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45861165887) job 140052260113（6311 行）、[長期 PR #1](https://github.com/Prysline/town-kinki/actions/runs/45861175640) job 140052293423（6327 行），[正式交接](https://github.com/Prysline/town-kinki/pull/145#issuecomment-7198283180) 四份完整日誌 970/970、fail/cancelled/skipped/todo=0、server/app 語法成功。本窗重新取得合併後兩組完整日誌，核對 checkout 與全部 970 個 ok。保留首輪 Push EADDRINUSE 失敗紀錄，非隱藏或降斷言。master `f74e077780ed96f9b271f66e5afe63037c7c7403` 不變，#1 Draft，#146 另窗。
- J-4a/b/c 指定範圍正式完成，不再重做。合成 fixture 不是完整真實舊資料庫、自然 RNG、真人或跨設備驗收。

## J-5｜聯合歷史升級與故障復原（候選切片）

- 既有 J-1–4 已分別驗證單機 WAL 防護、稅表遷移、兩模式戰鬥收據、跨 I 歷史事件／券／稅基；第67–71階段既有 CLI、百貨、房屋、郵件、禮品及未完成公路旅程還原證據保留，不重做。多人快照使用測試 SQLite backup() / COPYFILE_EXCL，不新增正式多人備份功能。
- 基準 tree 遞迴檔案清冊及上述測試／工具盤點定位本切片：J-3b 有戰鬥獲券與負 K 點，J-4c 有事件、券與耐久，但未在同一歷史 fixture 串接街頭獲券→同碼歷史兌換→新兌換失敗／重試。新增測試沿用 J-4c 的 #137 post-I 歷史 schema 子集，補同版街頭表及正式核心；#137 與基準 street-fight blob `1c0a6e95208fcba0d4e1a2e65abb7b2dbd052c5d`、events `3c7e4ea023f6bb12d5085d8a16d6d08849988594`、banking `faa6920f3fe1539f095f73a4098d98b2b5f2664f`、coupon-redemption `7a7138e659827bfbda5a7d834286ecb989b115ed`、legacy-inventory `0a58961d6ff7018c51aecd4362955c6bdd155214`、engine `161d8930b78c954b511ff17f3f463d5b5fd82369` 一致。既有兩項 J-4c 測試原斷言保留。
- 新增 J-5 test：三個合成帳號、真實核心受控 RNG 產生戰鬥勝利、券及負 K 點，與既存事件、銀行帳簿、稅基、庫存、同請求碼分模組收據一同 WAL 快照；新目錄拒絕覆寫、FK/integrity、來源主檔/WAL/快照 SHA-256。正式 HTTP 歷史重送、另一帳號隔離、未登入／冒用拒絕；注入券收據 INSERT 失敗，核對整個受測歷史資料集合原子回滾，重試只扣一次券、只發一次獎品，重啟後重送及歷史保存。
- 無玩法、schema、正式 API 變更；只用合成 Web 資料與公開原版規則來源。本機 GitHub DNS 仍失敗，未跑完整 repo，不冒稱本機測試。待同 HEAD Push/PR 完整 CI、diff/合成 tree 與合併後雙 CI。J-5 未結案；聯合證據覆蓋及 J-6 完成清冊另待正式確認。

## J-5 多人切片正式驗收

- #147 已合併正式 HEAD `5fd210b990ac73815b192c420bf31b78fe2716e0`，tree `08097fadaba20a16c5dad6a1bda03f41169b85ce`；候選 `3ef210265494823438e1d1fd90bc2a277c00af8f`、合成 `1140187bd8a432267fe2c586b1312128c41e7133`、#1 合成 `98f7bfd39232b725ff9b97600d5b05d99007a8c2` 同 tree。合併前 [Push](https://github.com/Prysline/town-kinki/actions/runs/45864096827)／[PR](https://github.com/Prysline/town-kinki/actions/runs/45864106443)，合併後 [Push](https://github.com/Prysline/town-kinki/actions/runs/45875844558)／[#1](https://github.com/Prysline/town-kinki/actions/runs/45875855012)，四份完整日誌 971/971、fail/cancelled/skipped/todo=0、server/app 語法成功；多人聯合切片正式完成。
- 既有 J-3a、J-4b 分別證明單機戰鬥、事件歷史還原，H 有同角色跨系統 Chrome 受控整合，但不是同一歷史單機 DB；因此補下列單機聯合切片，不重做其他歷史測試。

## J-5 單機聯合切片（候選）

- #137 `008c4556519a97f1d4d20721dc1d3213e55b82b8` 與正式基準的 B 聯賽、核心、裝備、事件、道具、銀行、券、單機時鐘及相關公開原版資料共20個直接相關 blob 相同；沿用 J-4c 歷史核心 DDL 及同版初始化器，合成一名角色、虛擬中午時鐘。不是完整舊資料庫。
- 真實 #30 事件獲5券、B 聯賽勝利取得 MB 藥草及資產、同碼兌換一券且行號不衝突、#4 疾病，實際單機備份/驗證/非覆寫還原至新目錄、來源主檔/WAL/快照雜湊及 FK/integrity。正式 HTTP 同碼分模組收據、單機街頭拒絕；使用收據 INSERT 故障整筆回滾、重試健康與原始能力增量、空白耐久單位不扣回數、其他歷史與稅基保持、重啟防重。受控 RNG、合成 fixture，不是真人或自然低機率驗收。
- 僅測試與稽核文件，既有多人斷言保留，不修改正式玩法、schema、API、CI 或原版私人檔。待本切片同 HEAD Push/PR、完整 diff、合成 tree、合併後正式 Push/#1 完整 CI，才正式結案 J-5；J-6 未開始。

## J-5 正式完整驗收（2026-11-27）

- [#150](https://github.com/Prysline/town-kinki/pull/150) 已合併正式 `5f1179ad192ddf685da08c72dd7a0d21a9922db5`，tree `25c1b7bfa89c64b9ded5b7c87947e20099e6aeb7`。候選 `cb110efd0e73371e44cb819422df875f16f8131a`、合成 `e8cc5f3ace876f3e38d5269629fbdc47a65e92ff`、正式與 #1 合成 `ae4272a775899c7cec4c1a80af6d5388b2e6a23e` 同 tree。正式 parents #147 正式 HEAD／#150 候選；#1 parents 唯讀 master／正式 HEAD。
- [#147 與 #150 結案原始紀錄](https://github.com/Prysline/town-kinki/pull/150#issuecomment-7203060793)：兩切片四組完整日誌各自 971/971 及 972/972。以下列實際 run/job、日誌行數及 checkout；本輪重新取得 #150 合併後兩份完整日誌確認 972 個唯一 TAP ok，含 #910/#911，fail/cancelled/skipped/todo=0，server/app 語法成功。此前完整候選與 #147 日誌沿用結案紀錄，不冒稱在本輪重新執行。

| 切片／組別 | Run | Job | 日誌行數／通過 | checkout |
|---|---|---|---|---|
| #147 Push | [45864096827](https://github.com/Prysline/town-kinki/actions/runs/45864096827) | 140062328590 | 6317／971 | 3ef210265494823438e1d1fd90bc2a277c00af8f |
| #147 PR | [45864106443](https://github.com/Prysline/town-kinki/actions/runs/45864106443) | 140062359887 | 6333／971 | 1140187bd8a432267fe2c586b1312128c41e7133 |
| #147 正式 Push | [45875844558](https://github.com/Prysline/town-kinki/actions/runs/45875844558) | 140102576393 | 6317／971 | 5fd210b990ac73815b192c420bf31b78fe2716e0 |
| #147 #1 | [45875855012](https://github.com/Prysline/town-kinki/actions/runs/45875855012) | 140102612325 | 6333／971 | 98f7bfd39232b725ff9b97600d5b05d99007a8c2 |
| #150 Push | [45892595899](https://github.com/Prysline/town-kinki/actions/runs/45892595899) | 140158644453 | 6323／972 | cb110efd0e73371e44cb819422df875f16f8131a |
| #150 PR | [45892609910](https://github.com/Prysline/town-kinki/actions/runs/45892609910) | 140158690905 | 6339／972 | e8cc5f3ace876f3e38d5269629fbdc47a65e92ff |
| #150 正式 Push | [45892933426](https://github.com/Prysline/town-kinki/actions/runs/45892933426) | 140159766715 | 6323／972 | 5f1179ad192ddf685da08c72dd7a0d21a9922db5 |
| #150 #1 | [45892939716](https://github.com/Prysline/town-kinki/actions/runs/45892939716) | 140159787553 | 6339／972 | ae4272a775899c7cec4c1a80af6d5388b2e6a23e |

- #147 真實街頭核心取得 5 券後餘額 4→9→4，五券獎品、另一帳號4券拒絕；#150 真實 #30／B 藥草／同碼券兌換／#4 疾病與藥草使用，完整選定表及角色故障回滾、重試及重啟。單機 CLI 實測，歷史多人使用測試快照。兩項均驗來源主檔/WAL/快照、外鍵／完整性、非覆寫及 HTTP 收據；J-5 沒有指定範圍未完成項。

## J-6｜最終稽核與完成清冊（#151）

依 [現行 A～J 清冊](PROJECT-STATUS-AND-PLAN.md) 統一實作、自動驗證、真人驗收、原版差異與待辦。重新查得下表 PR 皆 merged，與原正式紀錄一致。較早各切片的四組完整 CI 取自上方正式驗收紀錄（非本輪重新下載全部歷史日誌）；#145 首輪 EADDRINUSE、其他歷史失敗保留，不以後來綠燈抹去。

| 切片 | 正式 PR／完成內容 | 合併前 Push／PR | 合併後 Push／#1 | 各組通過 |
|---|---|---|---|---|
| J-1 | [#139](https://github.com/Prysline/town-kinki/pull/139) WAL 單檔遺失防護、symlink | 45815722218／45815734733 | 45816981606／45816991773 | 957/957 |
| J-2 | [#140](https://github.com/Prysline/town-kinki/pull/140) #103 真實舊稅表、負K、DDL/利息原子性 | 45824388143／45824398323 | 45825464170／45825475912 | 963/963 |
| J-3a | [#141](https://github.com/Prysline/town-kinki/pull/141) #121 單機 B/大阪/C、NPC 來源及收據 | 45826004413／45826016226 | 45830714882／45830725846 | 964/964 |
| J-3b | [#142](https://github.com/Prysline/town-kinki/pull/142) 多人四戰鬥、街頭負K及隔離 | 45832487149／45832499741 | 45833156131／45833166687 | 965/965 |
| J-4a | [#143](https://github.com/Prysline/town-kinki/pull/143) 早期事件欄位 | 45840184845／45840215989 | 45843890966／45843904080 | 966/966 |
| J-4b | [#144](https://github.com/Prysline/town-kinki/pull/144) #128 單機券／蟑螂／耐久 | 45851612499／45851622316 | 45852059416／45852075850 | 967/967 |
| J-4c | [#145](https://github.com/Prysline/town-kinki/pull/145) I 前後多人事件金流、PORT=0 | 45856408980／45856418555 | 45861165887／45861175640 | 970/970 |
| J-5 多人 | [#147](https://github.com/Prysline/town-kinki/pull/147) 聯合戰鬥獲券與兌換故障 | 45864096827／45864106443 | 45875844558／45875855012 | 971/971 |
| J-5 單機 | [#150](https://github.com/Prysline/town-kinki/pull/150) 事件／戰鬥藥草／CLI 還原及使用故障 | 45892595899／45892609910 | 45892933426／45892939716 | 972/972 |

**指定 Web SQLite 升級矩陣完成**：承接第67～71階段 #94/#96/#113/#114 與 #104/#105，不重做。J-1 真產品缺陷為直接還原主檔時遺失尚未 checkpoint 的已提交 WAL 交易（含符號連結繞過）；J-4c 另修測試埠競態，不混為遊戲規則問題。其他 J 切片為測試及稽核補強；正式 J-5 無新確認產品缺陷。

**證據界線**：合成資料是實際歷史公開 Web DDL／相同核心 blob 的代表性子集，不是完整舊資料庫、原版 CGI 私人存檔或完整所有版本矩陣。真 SQLite、真 Node HTTP、真 CLI 函式與注入故障是受控證據；非真實網路事故、自然低機率、真人長期操作、完整全部原版子分支或跨設備部署。多人 backup()/COPYFILE_EXCL 是測試方法，不是產品多人備份功能。不同 OS、Windows symlink/權限、設備還原、備份輪替、部署及安全審查由獨立驗收負責。不得因未驗收將已完成指定移植改列未實作；不得因綠燈宣稱全部原版等價。

**J-6 文件驗收契約**：只改兩份 Markdown（本檔與 PROJECT-STATUS-AND-PLAN.md）；重新核對正式基準、291 個 web blob、既有 PR 及兩份最終正式 CI 完整日誌；保留 72 功能 ID 與 3 永久排除 ID、既有政策與歷史證據，更新現行受影響的矩陣欄和優先序。本文件由 [#151](https://github.com/Prysline/town-kinki/pull/151) 提交，須驗證自身 Push/PR 完整 CI、diff/合成 tree、正式合併及合併後 Push/#1 完整 CI。最終結案以該 PR 的正式留言和實際 CI 為準，不預填未存在的自我引用 SHA／CI。master、#1、#146/#148/#149 未修改或合併。無玩法、schema、API、測試、CI 或原版變更；不新增未核准功能，不進入其他工作線。

## 原定驗收切片對照（指定 J-1～J-5 已完成）

1. 【J-2 已完成】#103 真實舊稅表、負 K 點、索引及歷史資料的實體 WAL 升級與失敗回滾；保留 #104/#105 已驗證情境。
2. 【J-3a／J-3b 已完成】以歷史公開 Web 戰鬥模組／正式 #121 代表性 schema 核對收據、NPC 來源、重送及帳號隔離，連同舊稅表交叉驗證。
3. 【J-4 已完成】以歷史 Web 事件與券 schema 及 I 前後的正式版本測試歷史、道具耐久、領獎／兌換收據、銀行帳簿與稅基不丟失；保留核准兩笛規則。
4. 【J-5 已完成／J-6 結案清冊見 #151】聯合回歸與故障復原（新目錄、來源及快照保留、integrity_check、foreign_key_check、HTTP 續玩與重啟、帳號隔離）；四組 CI 及完成界線已整理；本文件 PR 的正式四組 CI 與結案以 #151 留言為準。真人、跨設備、正式部署演練另列，不能由 CI 取代。
