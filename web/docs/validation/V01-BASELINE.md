# V01｜模組化前獨立驗證基線（2026-11-28 UTC+8）

本分支僅供驗證，不是正式 runtime，不合併 master、不變更正式規則。被測正式 SHA c18f56e8df68f3c8998c1ba7733500026e34424b，tree d462bbd51f94066499ff3c1e084d6fa4532ed47e；master f74e077780ed96f9b271f66e5afe63037c7c7403 / 6d2c623bdddaa347c2db0ad53063eb737717f0a5。PR #1 合成 bbd00fdb18e76992a7bf3a9b29d08cc2f652347c 同 tree，parents master/正式。#148、#149、#151 已 merged；#146 UI Draft（舊基底、mergeable=false），#152 僅一份文件 Draft，尚無模組候選。

## 已核實既有 CI
- Push [46028885558/job 140607274314](https://github.com/Prysline/town-kinki/actions/runs/46028885558/job/140607274314)
- PR [46028895284/job 140607306338](https://github.com/Prysline/town-kinki/actions/runs/46028895284/job/140607306338)
- 兩份原始日誌均 992/992、fail/cancelled/skipped/todo=0、server/app 語法成功；實際 checkout tree 同一。兩份 TAP 的 992 個編號及名稱完全相同。非本窗重新執行。
- 117 個 glob 測試檔及 blob pins 見 v01-test-files.tsv；全 992 個實際案例名稱見 v01-tap-cases.tsv。日誌不標每個案例來源檔，逐檔實際數量尚待事件 reporter 輸出；不得猜測對應。299 web blobs，61 src mjs。Node22，npm test = node --test tests/*.test.mjs；巢狀 fixtures 非測試入口。M3 不得漏跑子目錄測試或只比較總數。
- 最新兩組真實 Chrome 11 個操作案例：建角/工作/銀行/百貨/背包、兩種車取得、健身/信用、街頭/C/#38/B與大阪、街區編輯、共用付款、溫泉。UI_MAP_EDIT 4 格、0 次強制捲動、restart；UI_TRAINING_PAYMENT 3 棟、reload、expiredBlocked；UI_ONSEN 8 池、reload、exit，1440/768/375。非真人/實體裝置。

## 原版查證與核准適配
重新讀 master：town_maker.cgi 663–664 居民/出浴；basic.cgi 2881–2891 工作；basic.cgi 1037–1038 入浴；town_ini.cgi 76–78 自然 10 秒/點，198–205 普通 500 元、10 倍；unit.pl 172–181 溫泉入口。與 energy-maxima.mjs 直接核對，能力均20為21/23、25/35、22/24。AP-05 來源文件記錄已核准銀金三處最小筆誤修復，不以未修正 Perl 結果誤判該核准差異；其完整 RNG 差分目前沿用既有測試證據，未獨立重跑 Perl。README 21格舊描述、migration-audit WK-01 舊部分完成列與最新已合併功能存在文件落差，交文件維護責任人核對；非確認玩法缺陷。

## 主要契約
- server.mjs:311–325 mutateCharacter BEGIN IMMEDIATE→getCharacter→recoverEnergy(context)→callback→saveCharacter→afterSave→COMMIT，例外 ROLLBACK。工作另先結算當日銀行利息，工作情境不能改為 resident。
- snapshot:327 起，入浴先走唯讀提前回傳，不執行一般結算；一般路徑先利息、恢復/健康及保存、每日事件（單日一次），其後設施庫存、狀態組裝、稅基刷新。不得拆成各頁自行結算。
- server 683 起 POST，跨來源 403；無 session 401；入浴封鎖其他居民操作 409（單機快轉/刪角及登出例外）；入/出浴錯誤 400；同本人 requestId 唯一，出浴依 visitId 本人，活躍每人一筆、重送原收據。API 路由清單為源碼 literal 靜態擷取，非逐路由重新跑。
- SQLite 主要表（靜態抽查非完整 DDL）：users/sessions/characters、bank_accounts/bank_ledger/bank_loans/bank_transfers/bank_tax_state/bank_tax_assessments、legacy_inventory_imports/items、character_events/coupons、coupon_redemptions、houses/house_events/house_remodel_events、private_mail_events、town_maps、solo_clock、arcade_road_trips、onsen_visits。重要契約：資產/帳簿/稅基/收據原子、FK、本人所有權、拒絕/重送、非覆寫備份/還原、solo/multi 各自 SQLite。完整 schema/index/trigger 清冊需實際資料庫輸出。
- 所有 API literal 73 個（路由清單見 v01-api-routes.tsv）；方法依 server 分流標記，不含靜態資源。精確 request/response schema、錯誤及逐路由執行待補。

## 歷史有效證據與未驗
- #151 [結案](https://github.com/Prysline/town-kinki/pull/151#issuecomment-7221642195) J-6 ca0e1620f9717615a53b8aba47e6892deaf0555b / 6c8f72031823b2bd48265c6a9ee9cfb20a0ef7a2 四組972/972；J-5 5f1179ad192ddf685da08c72dd7a0d21a9922db5 / 25c1b7bfa89c64b9ded5b7c87947e20099e6aeb7，單機 CLI、多人測試快照、聯合事件/戰鬥/券/耐久/回滾。歷史資料為合成 Web fixture，不是全部舊存檔。
- G 固定種子184案例/14及42遊戲日；H Chrome；I 44個已實作ID不等於窮盡子分支。歷史失敗保留：#121紅燈、Chrome 啟動根因未證、J4c EADDRINUSE、AP-05 Perl int 邊界測試失敗、翻譯定位斷言未同步。未重取所有歷史日誌。
- 本機 Node22.16/Perl5.40.1 可用但 GitHub DNS 無法解析，未本機 clone/npm test。已新增 V01 正式 API 無資料寫入注入的單機串接測試，使用真時鐘/RNG、獨立暫存DB；僅自動化，CI 待查。另新增逐檔 reporter，可在正式基線及後續候選使用，不改既有 npm test 或 workflow。
- M 軌：尚無程式候選，未作前後差分。先固定 12 項契約；比較時間用相同時鐘或明確正規化時間戳，ID 用同初始資料/映射，不可全忽略；RNG 必須同序列及呼叫次數。M1 先 DOM/倒數/成功拒絕，M2 HTTP/SQLite，M3 全案例清冊，M4–6 核心/交易/日結算及歷史升級。
- A 軌：下一步 AP-05/WK-01 跨日、正常工作收入→銀行→入浴→重啟→出浴及續玩；#146 需責任窗更新候選後與新正式基準做差分。真人手動、長期自然經營、自然低機率、實體裝置、跨OS及完整版本矩陣均待證，非阻擋無關移植。無新確認 P0/P1；本輪未核證不代表全功能無缺陷。
