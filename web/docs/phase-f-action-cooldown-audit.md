# F｜全域行動間隔與跨玩法冷卻：來源審查與現況測試（待決策）

依賴：feature/web-battle-integration-check @ 5c91cda3108d2acc074ef8f9037c55d0549077ba；正式整合 9db33c96faace21f4f3ada3fb533a701b44dcc3f；原版 master f74e077780ed96f9b271f66e5afe63037c7c7403 唯讀。2026-11-25 重新取得 [文件 HEAD push CI](https://github.com/Prysline/town-kinki/actions/runs/45577323700)：實際 job 139078372581 日誌 883 tests / 883 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo；server/app 語法成功。此證據僅屬依賴 HEAD。#115～119 全部 open Draft 未合併，現行 HEAD 的 push / PR CI 均 success。不讀取舊玩家檔案。

## 原版執行路徑

- town_ini.cgi:220 預設 $koudou_seigen=5（秒，0 為停用）；229 工作另有 5 分鐘。town_lib.pl:1554–1589 decode 做認證及可調整間隔的分支（不移植私人指定例外）；477–505 check_pass 讀角色並解析 access 欄位；187–248 讀寫格式含 access_byou 和 access_time。此處是程式碼查證，未打開任何玩家資料。
- town_maker.cgi:117–119、basic.cgi:45–47、battle.cgi:17–19、obatyan.cgi:11–13、game.cgi:29–31、kyushitu.cgi:16–18、hanbai.cgi:16–18、hanbai1.cgi:22–24 在 mode 分流前檢查 time - access_byou < koudou_seigen。因此連部分設施表單入口也受 gate 約束。
- 實際寫入點並非以上各 CGI 的每筆交易：town_maker.cgi:149–172,182–336 -> top.pl:678–686 main_view -> town_maker.cgi:660,671,786–788 loged_gamen；取得伺服器秒數，更新 access_byou（mode 為 syokudou、school、gym 時不更新），1039–1041 經 temp_routin/log_kousin 保存。town_lib.pl:989–1035 的 hooter 產生回到 town_maker 的表單，不等於當下執行回城。battle.cgi:87,276、obatyan.cgi:192、game.cgi:199 回城路徑；C 聯賽 game.cgi:933 返回同一設施。上述獨立 CGI 不直接賦值 access_byou。原版是共享城鎮 access gate，不是所有成功 POST 都更新的全域互斥鎖。
- town_maker.cgi:185–188 access_time 是日期，與 access_byou 秒時鐘分開。login_view:331 呼叫 event_happen；event.pl:309–313 每次走到抽選分支擲 1/3 再抽 44 項，並非每日一次。event.cgi:18–19 屬事件投稿 form/save，不是 #26/#34/#38 執行入口。不可用它證明事件需額外獨立五秒。
- town_lib.pl:1431 起的一秒主機限制整段被註解，不是生效規則；不復刻客戶端時間或主機特殊條件。

## 逐玩法對照（靜態原始碼）

| 玩法 | 原版 | Web 依賴 HEAD | 差異判讀 |
|---|---|---|---|
| B 聯賽 | battle.cgi:17–24 bbin/bb 讀共同 access；回城才可能刷新 | b-league.mjs:83–129，本人 b_league_battles MAX(created_at) + 5000ms，先查 receipt，再交易 | 已知安全差異，非證實原版每戰5秒 |
| 大阪 | obatyan.cgi:11–37 弱/強共享 access | osaka-challenge.mjs:103–145，本人 osaka_battles MAX(played_at)+5000ms，弱強共用 | 同上，與B不共享 |
| Street Fight | game.cgi:29–44；town_maker 地圖入口；抽到本人不重抽 | street-fight.mjs:88–148，本人 street_fights 最新列+5000ms；noOpponent 亦記錄 | 已定安全差異；單機不造對手；現金門檻與負K點不改 |
| C 聯賽 | game.cgi:29–39,736–785；town_ini.cgi:129–135；共同 gate 及 60 秒比賽間隔 | c-league.mjs:5,63,84–117,133–156，60秒／100場／14日；train 無5秒、open 依明確入口啟季 | 保留已核准規則；培育、開啟及出賽未接其他 clock |
| #26/#34/#38 | town_maker.cgi:331 -> event.pl:309–313，每次有效 login_view 可能抽選 | server.mjs:325–340 snapshot；events.mjs:90–150 每人每日一次並交易記錄；新角初始化不抽 | 已知 Web 日抽安全差異；不可隨全域改造提高頻率 |
| 工作／銀行／物品 | basic.cgi:45–66；do_work:2839–2851 另5分鐘；item_do:2413–2457 個別物品及用餐間隔 | engine.mjs:16,178,221 工作5分鐘；server.mjs:770–802；legacy-item-use.mjs:279–294,403–469 物品／餐點時鐘及本人請求碼；銀行本身不共用戰鬥間隔 | 跨設施時鐘獨立，不等於重複給薪或重複使用物品 |
| 訓練 | kyushitu.cgi:17–24,94–150 共用 access 加教室 next_tra1 分鐘；school/gym 執行 CGI 缺失，勿推斷 | training.mjs:113–118,145–160 學校每日／gym 與 classroom 各自 readyAt；server.mjs:1177–1213 | 可跨不同訓練與戰鬥；學校/gym 不主張原版完整等價 |
| 商店／裝備 | town_maker.cgi:149–162；command.pl:1404,1948–1962；hanbai.cgi:17–27（購買、穿戴、鍛造）；hanbai1.cgi:23–28 | server.mjs:1011–1063；retail.mjs:192–358 交易／收據；equipment.mjs 交易；沒有共同5秒 | 不是每次購買都必然改寫 access；Web 快速不同購買可為合理 UX |
| 遊戲時鐘 | 原版伺服器 time 秒、access_time 日期 | server.mjs:78 單機 gameTimestamp，multi Date.now；solo-clock.mjs:1–51 持久化偏移；calendarDay 使用 GAME_TIMEZONE | 保留單機核准快轉，不以瀏覽器時鐘、UTC 日期或現實秒混用 |

## 缺陷與資產風險分類

1. 已確認跨玩法獨立：B、大阪、街頭各可在別模組冷卻期間操作，C 聯賽獨立60秒，工作/訓練/購物/使用物品沒有共同 access gate。這是原版介面節奏差異；不直接定性為資產漏洞。不同合法操作會消耗各自能量、現金、耐久或容量；加速累積的收益與耗損須由 G 真實核心長期模擬量化。
2. 防重送不等於冷卻：B/大阪/街頭/C 各自持久化 receipt，先查舊 receipt，再檢查間隔；同 requestId 在不同模組並不是重複執行同一筆交易。共享 requestId namespace 會破壞既有相容性。
3. Web snapshot 不純讀（利息、健康、日事件、稅基等），GET /api/state 和成功 POST 回應都會呼叫；不能直接把 GET 當原版回城刷新 access，會讓輪詢造成永久鎖或額外抽選。資產已提交而後置 snapshot 失敗的風險需逐路徑實測；A～E 已修的戰鬥稅基不重做。非戰鬥／舊事件的剩餘原子性另列 I 或確證的 P0；本輪不宣稱已重現新的資產損失。
4. 工作與訓練以專用冷卻而非 requestId 防重；跨日／跨間隔的舊 HTTP 重送語意不等同戰鬥收據。加全域鎖不能替代操作收據，也不能解決此類潛在風險。未實測重現前不當成已證實漏洞。

## 決策（尚未授權）

- A：維持現況。保留所有模組各自間隔、每日事件，先由 G 量化經濟；補齊現況測試與說明，不引入操作頻率變動。
- B：Web 戰鬥共享 5 秒。B、大阪、街頭、C 出賽共享每人持久化時鐘，C 的60秒仍保留；C 培育、日事件、購物及工作訓練維持不變。此為新增 Web 安全規則，不宣稱原版精確等價。只有新成功結算（含 noOpponent）更新 clock，回滾/拒絕不更新，舊 receipt 優先回傳。
- C：模擬原版城鎮 access gate。明確回城／進入城鎮才推進 shared access，設施執行及表單入口檢查；被動 GET、背景輪詢不推進；需另定原版例外在 SPA 的映射、商店成功後 UI 路徑、回城與每日事件分離，保留已核准模組限制，避免暗中移除既有安全保護。不能簡化為所有 POST 共用5秒。
- D：所有資產操作成功後共享5秒（工作、訓練、商店、物品及戰鬥等）。防止快速切換但對日常操作影響最大，且比原版 gate 更嚴格；目前無足夠資產實證推薦。

建議 A；如果使用者希望先壓低跨戰鬥操作頻率，選 B。未核准前不改 production 源碼、SQLite schema、冷卻時間、獎勵或每日抽選。若核准 B/C/D，另在 F 分支實作，每人同一遊戲時鐘、交易內檢查與寫入、receipt 先於 gate、既有紀錄不覆寫；UI 顯示伺服器 readyAt。需測 4999/5000ms、跨模組、並發、失敗回滾、跨日、重啟、單機快轉、帳號隔離及舊庫升級。

## 本次現況驗證

新增 server.test.mjs 的 F 特性測試：以獨立臨時單機 SQLite、既有正式 HTTP 路徑驗證工作/教室→B→大阪→C 的獨立冷卻，查詢各模組時鐘；另以實際核心及固定時刻檢查 B/大阪/C 在各自 readyAt-1 時拒絕、資料無異動；重啟、跨日及既有收據重送。這是記錄現況，不是核准維持現況的產品決策。既有 A～E 聯合測試涵蓋多人隔離、街頭 noOpponent、回滾、負K點和各模組相同請求碼。新增 CI 結果只以本分支實際 HEAD 為準，尚待取得，不借用 883/883 作為新測試驗收。未宣稱真人或長期經濟驗收。

F 尚未完成：決策、可能實作、完整跨玩法矩陣測試（包含商店/物品/多人精確跨秒）及新 HEAD CI 證據。G～J 不提前進行。原五 PR 和正式／驗證依賴分支均維持不變，不合併。

## 2026-11-25 後續合併紀錄
#120 已合併至獨立驗證分支 `d1ca0a78011efff958ea134a26ceed232002b9d7`，其 [合併後 push CI](https://github.com/Prysline/town-kinki/actions/runs/45589967956) 實際 884/884、0 fail/skipped/cancelled/todo，server/app 語法成功。使用者另已授權 A～E 聯合正式整合，審查與測試可隨之帶入，並不構成 F 玩法決策核准。F 選項與待補驗收維持不變。

## 2026-11-25 正式基準與補驗候選
- A～E 與 F 已有審查經 #121 正式納入；依賴 HEAD `e2e3004ad9af13021c4bae540863f9ca26e34b10`。合併後 push 884/885、PR #1 885/885（IT-02 既有食品快轉 409）；未記錄失敗 response body。原測試建角後才校準中午，可能跨日觸發 #44 限時事件，正式 `/api/solo/time/advance` 於 active challenge 拒絕 409 是既有合法保護。亦有無角色／SQLite 衝突 409 路徑，故不可斷定單次實際原因。修正四處同類測試為建角前校準時鐘，保留正式限制與測試斷言；補快轉錯誤正文。
- 新增多人真實 SQLite 核心固定毫秒測試：四戰鬥同毫秒、百貨購買與食品使用，個人 4999/5000 與 59999/60000 邊界、另一帳號同時同請求碼、拒絕／收據無異動、購物／食物跨日舊收據。固定時間、亂數與庫存只在測試暫存 DB，不新增正式 API。此候選仍待 CI；未變更 production、schema、冷卻、事件頻率或資產公式。
- 尚待使用者選定 F 方案；工作／訓練跨間隔舊 POST 語意、多人 HTTP 真實時間並發、G～J 仍不宣稱完成。
