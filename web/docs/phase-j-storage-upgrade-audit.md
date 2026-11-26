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

## 後續驗收切片（待逐項查證）

1. 【J-2 已完成】#103 真實舊稅表、負 K 點、索引及歷史資料的實體 WAL 升級與失敗回滾；保留 #104/#105 已驗證情境。
2. 【J-3a／J-3b 已完成】以歷史公開 Web 戰鬥模組／正式 #121 代表性 schema 核對收據、NPC 來源、重送及帳號隔離，連同舊稅表交叉驗證。
3. 【J-4 進行中】以歷史 Web 事件與券 schema 及 I 前後的正式版本測試歷史、道具耐久、領獎／兌換收據、銀行帳簿與稅基不丟失；保留核准兩笛規則。
4. 聯合回歸與故障復原（新目錄、來源及快照保留、integrity_check、foreign_key_check、HTTP 續玩與重啟、帳號隔離）；整理同 HEAD 四組 CI 及完成界線。真人、跨設備、正式部署演練另列，不能由 CI 取代。
