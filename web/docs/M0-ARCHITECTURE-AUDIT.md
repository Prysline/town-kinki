# TOWN Web M0｜架構查證與漸進施工方案
日期：2026-11-28（UTC+8）。本文件是 M0 查證候選，**不授權 M1～M6 實作，不改 runtime，不合併**。以現行功能狀態文件及核准政策為權威；#152 仍 Draft，不假設已合併。

## 1. 固定基線、證據與交付
- 正式 feature/web-dual-mode-phase1 HEAD c18f56e8df68f3c8998c1ba7733500026e34424b，tree d462bbd51f94066499ff3c1e084d6fa4532ed47e；#148、#149、#151 已合併。master f74e077780ed96f9b271f66e5afe63037c7c7403 唯讀。
- [Push](https://github.com/Prysline/town-kinki/actions/runs/46028885558) / [#1](https://github.com/Prysline/town-kinki/actions/runs/46028895284) 原始日誌均 992/992、fail/cancelled/skipped/todo=0；PR 合成 bbd00fdb18e76992a7bf3a9b29d08cc2f652347c 同 tree。兩語法檢查成功。不是 M0 候選 CI 或本窗重跑。
- [#152](https://github.com/Prysline/town-kinki/pull/152) head 5403aa72d5906353e5447c21d1b4997bff5c59b4、open draft、只新增 roadmap；已讀。README、PROJECT-STATUS-AND-PLAN、migration-audit 均已取得固定版本，依現行清冊而非歷史段落判定。#151 [J-6 結案](https://github.com/Prysline/town-kinki/pull/151#issuecomment-7221642195) 留存，不把 972 舊基線當最新版。
- [固定 tree/測試發現/992 TAP 名稱](M0-BASELINE-INVENTORY.md)；[後端依賴及資料圖](M0-DEPENDENCY-AND-DATA-MAP.md)；[來源 A](M0-SOURCE-DEPENDENCIES-A.md) / [B](M0-SOURCE-DEPENDENCIES-B.md) / [C](M0-SOURCE-DEPENDENCIES-C.md) / [D](M0-SOURCE-DEPENDENCIES-D.md) / [E](M0-SOURCE-DEPENDENCIES-E.md)；[前端 A](M0-PUBLIC-DEPENDENCIES-A.md) / [B](M0-PUBLIC-DEPENDENCIES-B.md) / [C](M0-PUBLIC-DEPENDENCIES-C.md)。
- 61/61 src、36/36 public 逐檔 SHA 核對，168 靜態本地 import 邊，未檢出靜態循環或未解析本地 import；76 CREATE 名稱候選含歷史表、73 API 路徑；117 top-level test files、5 fixture 檔、992 實際 TAP 名稱。靜態掃描不是完整語義呼叫圖、當前 schema dump 或玩家驗收。
- 本地 worktree/stash/未推送資料未能查核；各窗須自查。本文件不宣告所有跨模組交易與動態 SQL 已逐分支覆核，後續 M0 補核項見末節。

## 2. 現況依賴與高耦合
- server.mjs（1,403 行）為 Node HTTP 組裝入口、來源 catalog、schema bootstrap、session、HTTP dispatch、角色 mapping、狀態結算；規則模組已存在，不應重新實作。server → 規則／DB／time；禁止新功能反向 import server。
- engine → dining → meals i18n；engine → health → dining、energy-maxima、jobs i18n。training → engine。town-storage → engine/town-map。這些是共用規則依賴，不為拆檔增加介面層。
- arcade-dice/highlow/donuts/cardw/instant-loto → town-storage + crypto；Loto6 多 banking；treasure 多 engine/health/inventory-life/legacy-item-use。road-travel → treasure/coupon/retail/engine/inventory-life，不能與骰子同一批切。
- events → banking/cockroach/effects/item-bonus/resident-transfer/santa；street-fight → events/banking/engine；onsen → banking/engine/cockroach/source/town-storage/training。此類跨日、事件、戰鬥副作用不可用平行 service 重做。
- retail → banking/legacy-credit/inventory/legacy-inventory/legacy-item-use/vending；player-store → banking/inventory/legacy-credit/rooms/wholesale；wholesale → banking/legacy-inventory/rooms。跨玩家商業保留所有權、雙方寫入與收據。
- app.js（5,218 行）以單一 state、render()、api()、notify()、facility/profile navigation、timer 及各功能 pending/busy 變數組裝；index.html 單一 module script，style.css 共用 class。既有 translations 已有多檔，retail-item-translations 是聚合入口；原始鍵與顯示分開，不搬動翻譯資源當第一批。
- 靜態 import 無環不代表業務耦合少：characters 直接寫入候選 29 檔，legacy_inventory_items 直接寫入候選 12 檔。多個角色更新路徑是既有交易所有權，不是已證實缺陷。不要為統一形式改變 SQL 欄位、結算順序或新增全域冷卻。

## 3. API 與模組對照（/api 前綴）
逐路由行號見依賴圖；下列列出領域與既有結果 envelope。GET 只有 state、town/preview、house/visit、shop/visit，其餘 POST。所有未列出新 API 均不在授權內。
| 路徑 | 現行執行模組／入口 | 回應 |
|---|---|---|
| state | server snapshot | snapshot |
| town/preview | town-storage/publicTownMap | 公開 map/towns 欄位 |
| house/visit | rooms/viewRoom | room view |
| shop/visit | player-store/viewPlayerStore | shop view |
| register, login, logout | server 身分與 session | snapshot / ok |
| character | engine + server addCharacter | snapshot |
| solo/character/delete, solo/time/advance | solo-character, solo-clock | deletion/timeAdvance |
| job, job/payment, work | engine + mutateCharacter + banking | snapshot / result |
| hospital/treat | health + inventory + mutateCharacter | hospitalResult |
| events/cockroach/claim | event-cockroach | cockroachResult |
| inventory/legacy/use, inventory/insurance/buy | legacy-item-use, inventory | itemUseResult/insuranceResult |
| fishing/bait/buy, fishing/cast, fishing/sell | fishing | fishingResult |
| crafting/make | crafting | craftingResult |
| osaka/play, street-fight/play | osaka-challenge, street-fight | osakaResult/streetFightResult |
| c-league/open, c-league/train, c-league/play | c-league | cLeagueResult |
| arcade/dice/play | arcade-dice | arcadeDiceResult |
| arcade/highlow/play, arcade/donuts/draw | arcade-highlow, arcade-donuts | arcadeHighLowResult/arcadeDonutResult |
| arcade/loto/play, arcade/loto6/buy, arcade/loto6/check | arcade-loto, arcade-loto6 | instantLotoResult/loto6TicketResult/loto6DrawResult |
| arcade/cardw/draw, arcade/treasure/open | arcade-cardw, arcade-treasure | multiCardResult/treasureResult |
| road/start, road/arrive | road-travel | roadStartResult/roadArrivalResult |
| onsen/enter, onsen/leave | onsen | onsenResult |
| coupon/redeem | coupon-redemption | couponResult |
| retail/buy | retail + vending stock path | retailResult |
| b-league/play | b-league | bLeagueResult |
| equipment/buy, equipment/equip, equipment/sell, equipment/forge | equipment | equipmentResult |
| mail/send, mail/delete | private-mail | mailResult |
| gift/convert, gift/send | gift-shop | giftResult |
| recycle/sell, recycle/buy | recycle | recycleResult |
| shop/price, shop/buy | player-store | playerStoreResult |
| shop/config, wholesale/buy, wholesale/return | wholesale | wholesaleResult |
| meal/eat | dining/dining-stock + mutateCharacter | mealResult |
| train | training/legacy-credit/banking + mutateCharacter | trainingResult |
| bank, bank/term, bank/transfer, bank/loan/borrow, bank/loan/payoff | banking | bankResult/transferResult/loanResult |
| house/room/config, house/room/post, house/room/delete | rooms | roomResult |
| house/build, house/remodel, house/sell, house/rename | housing | houseResult/houseRemodelResult/houseSaleResult/snapshot |
| solo/map/starter, map/tile | solo-starter-town, town-storage | mapStarterResult/snapshot |
| move | transport + mutateCharacter | travelResult |

## 4. 共用核心與副作用契約（禁止先改）
- server L289–325: getCharacter→characterFromRow；saveCharacter 的 UPDATE 欄位清單不含 kpoint，其他領域可能直接更新 kpoint，不可用整列覆寫。mutateCharacter(userId, callback, afterSave, energyContext="resident"): BEGIN IMMEDIATE → load → 無角色 409 → recoverEnergy(old,gameNow(),energyContext) → 同步 callback → saveCharacter(result.character) → afterSave() → COMMIT；任何例外 ROLLBACK 再 throw。不能把 callback 改為 async、改寫 clock 次數、包住自行開交易的模組、改 afterSave 順序。工作能量 context 與居民不同，入浴另依原版。
- snapshot L327 起: 擷取 now/today → 若 activeOnsenVisit，僅讀角色及入浴狀態直接回傳，禁止跑居民結算 → bank interest → reload → energy recovery → daily health → 必要 saveCharacter → daily event RNG Math.random → reload → dining rotation（交易）→ retail rotation（交易）→ vending period（交易）→ fishing stock（交易）→ wholesale day（交易）→ house/map projection → refreshBankTaxSnapshot → residents → 各功能 overview，既有排序與條件不能重排。某些 overview 本身可能有結算，需逐個核實；不可假設是 pure。這不是單一全域交易；亦不在 M0 修正任何既有跨邊界問題。
- HTTP L639–1393: GET 分派及公開欄位限制→非 POST 404→Origin/Host 拒絕 403→readBody→註冊/登入/登出→getUser 401→入浴/離浴→活躍入浴 409 guard（單機快轉與刪角例外）→居民功能路由→錯誤映射。抽離路由只能在原位置 dispatch，不能移到 guard 前面。保留回傳 body 及狀態碼與已核准安全適配。
- server 初始化 L70–155：每模式單一 DatabaseSync，WAL、foreign_keys、characters 歷史欄位補齊，再按現有 init 順序執行，含 NPC 資料來源與升級。不得由 routes module 再開 DB 或 schema 初始化。
- 時鐘單機 gameTimestamp/soloOffset，multi Date.now；session 等真實時間不可混為遊戲時鐘；時區預設 Asia/Taipei。RNG 使用各模組原有 Math.random/crypto.randomInt/注入點；不在正式 HTTP 暴露測試參數。
- 權責：characters、銀行資產、K 點均同 SQLite 權威；banking 擁有銀行帳戶/帳簿/貸款/稅基協議；legacy-inventory、inventory-life、legacy-item-use 與各交易擁有原 33 欄、容量、耐久、所有權與使用收據；功能表由原 init/module 維持；外鍵刪角及升級不得重排。直接讀寫候選見資料圖，不宣稱已完成所有動態 SQL/trigger/cascade 審計。
- 重送：各功能保留原 requestId scope、已結算返回、衝突拒絕及回滾；不得自動推廣同一 idempotency protocol。跨玩家轉帳/購物/禮物/事件需保留雙方資產/收據/稅基一致性及原有 SAVEPOINT/COMMIT。測試必驗丟失回應與重啟，不把 fixture 當真人。

## 5. 前端契約
- api(path,data) 使用相對 /api/、GET/POST、JSON、credentials same-origin，錯誤保留 status。state 由各操作完整替換；render 同步校時、頁面/角色/入浴判斷、全局渲染與功能 render 順序。不要在每模組另行 fetch state。
- browserGameNow 用 syncedGameMs/syncedAtRealMs、Date.now；全局 30 秒 state poll，1 秒 town theme/入浴或其他倒數，250ms Osaka/蟑螂更新。保留快轉、lobby 與入浴 early return，不能新增重複 timer 或改刷新頻率。
- feedback capture listeners、inline feedback/dialog、focus 及通知原行為保留。各 pending/busy 變數生命週期先照搬，特別 coupon sessionStorage、戰鬥 ownership、骰子同 payload requestId；不借機修正 race、reset、存取或視覺。
- HTML id、data-facility、town-home FACILITY_PANELS、CSS 共用 class、繁中與原始識別鍵保留。第一批不搬 HTML/CSS；現有 CSS 樣式與翻譯分割非必要不動。
- home-ui.test.mjs L9–11 直接讀 index/style/app；L806–816 直接檢查骰子函式、呼叫、pending/busy 及 DOM。改檔須將原斷言轉到真實新來源並保留 wiring 斷言，不用註解假裝通過。server.test L1–105 啟動 Node src/server.mjs、PORT=0、隔離 DATA_DIR、cookie/HTTP helper、保存/重啟、正午錨；browser-viewport-smoke 用真實 CDP，Chrome 不可缺席時默默 skip。117 檔 glob 不遞迴；M3 前須維持實際測試發現與名稱，不只總數。

## 6. 工作窗責任（提案，並非已取得其他窗鎖）
| 檔案／領域 | 寫入協調 |
|---|---|
| server/app/index/style | M 協調短切片；A 在自身新功能 PR 可做最小接線，先互報檔案/區段/HEAD；實際寫入 token 一次一人 |
| tests/server, home-ui, browser-viewport | M 協調拆分；A/V 可在各自分支寫與功能相關測試，重疊時短批交接；不得刪 V 歷史證據 |
| 原有規則、來源對照 | A 持續移植，M 不改規則；V 獨立缺陷／驗收 |
| 共用測試工具、routes/core/services | M 維護公開契約，A 可走新介面；V 保持獨立測試 |
| #146 | app/index/style/home-ui/browser-viewport 五檔重疊，M0 只新文件無衝突；M1 前確認實際最新狀態及交接。不得改 #146 分支。 |
| #152 | 規劃 Draft，M0 新文件可獨立查閱；不合併、不修改其分支。 |
| #1/master | #1 長期 Draft 不合併 master。 |
無重疊工作照常；不要求 A/V 全域停工。共享檔施工前公布 owner/區段/base SHA/預期測試、完成後交接 head/tree/diff/CI/未推送；重新讀取正式 HEAD，再從最新基線建小 Draft。

## 7. 骰子試點（待授權）
可選骰子而非其他街道、戰鬥、樂透或溫泉。其規則模組只依 town-storage 與 node:crypto，已獨立交易；仍依賴 characters.money、城鎮、時鐘、原版來源、snapshot。
- M1 試點：新 public/modules/arcade-dice.js 建議 factory createArcadeDiceUI({getState,replaceState,api,render,notify,el,text,money,browserGameNow})，回傳 renderArcadeDice。pendingArcadeDice/arcadeDiceSubmitting 仍單例，原 confirm/crypto.randomUUID、state 更新及 notify 順序、finally render、冷卻顯示、重送保持。僅搬 app L2969–2996、3073–3131；app L4707 改委派。HTML/樣式/導航/全局 timer 不動，不新加骰子倒數 timer（目前依 render 更新）。
- M2 試點：新 src/routes/arcade-dice.mjs 建議 createArcadeDiceRoute({db,arcadeDiceSource,gameNow,snapshot,sendJson,HttpError})，以原 dispatch 位置 L938–947 呼叫同步 handler(res,user,data)；不另驗證身分、不改 guard、不自開 DB，原 400 error mapping；一次 playArcadeDice(db,user.id,source,{guess,stake,requestId,now:gameNow()}) 成功後一次 snapshot(user) 並回傳 {...snapshot,arcadeDiceResult}。保留 source parse、init、snapshot overview 在 server；core 完全不改。
- 原版 gamerand.cgi→saikoro.cgi、五種下注（10000/50000/100000/500000/1000000）、一個 randomIndex(36)、五分鐘、20筆歷史；Web 非負現金、安全整數、本人 requestId 防重，BEGIN IMMEDIATE→查重→資格/現金/冷卻→RNG→UPDATE characters.money→INSERT arcade_dice_rounds→COMMIT/ROLLBACK。不要改成 mutateCharacter 或用新 banking API 調整既有行為。
- 合約：POST /api/arcade/dice/play body guess/stake/requestId，response arcadeDiceResult guess/stake/dieOne/dieTwo/total/won/delta/playedAt/replayed；overview available/rates/cooldownMs/readyAt/history；錯誤狀態及字串照舊；認證/Origin/入浴拒絕照舊。保留所有 arcade-dice-* ID、下注選擇、確認/取消、顯示、按鈕 disable 與歷史。
- 現有 tests/arcade-dice.test.mjs（原版來源、亂數、金錢、冷卻、replay、trigger 失敗回滾、刪角）及 server.test L4801/L4877（solo/multi HTTP、建築、隔離、重啟）全部保留；home-ui 靜態斷言改為真實 module + app wiring，不降低任何斷言。新增 Chrome 實際設施導航、確認/取消、下注、金額/歷史、冷卻/單機快轉及刷新，1440/768/375px；必要測試資料只在隔離 SQLite；同 requestId 重送、回應遺失、重啟、異帳號拒絕、活躍入浴 409、跨來源 403、交易故障，與銀行／事件／快轉 cross regression。差分用固定同基線資料與時間/RNG 單元、HTTP/DB 真實操作；不要求兩次真 RNG 恰好一樣。驗收 992 原測試全部保留（新增測試另計）；候選同 HEAD push/PR、實際 checkout tree、完整測試發現及 diff。若測試有新增，數字按清冊增加。
- 回滾：Draft 不合併即可隔離；合併後只 revert 本切片的 commit/PR（不回退其他窗），無 schema／資料轉換，不覆寫 SQLite。若查到玩家可見缺陷獨立開 issue，待授權，不混入純拆分。

## 8. 已確定的施工優先策略（2026-11-28；不授權實作）

本節記錄使用者確認的方向：**主要內容優先、小型功能試點、核心架構漸進拆分**。取代本文件原先「骰子後預設依序 highlow、donuts、instant-loto、cardw」的排序；與 #152 的 M0～M6 階段定義相容，階段是工作類別而非必須全部完成的串行關卡。現行功能清冊與既有授權仍為 A 窗功能排序權威；本節不更改任何玩法優先決策。

| 執行次序 | 階段 | 交付及邊界 |
|---|---|---|
| 1 | M0 | 補核動態 SQL、間接副作用、snapshot overview、測試路徑與 DOM/CSS/翻譯契約；重查 HEAD/tree/CI、PR、各窗本機及寫入狀態。提交盤點與試點範圍，等待實作授權。 |
| 2 | M1＋M2＋M3 | 以單一骰子功能完成 UI、HTTP、測試工具的最小切片，依各自核准範圍分 PR；維持現有 tests/*.test.mjs 發現方式。V 獨立核對必要差分與整合，確認模板、回滾與既有行為。 |
| 3 | M1～M3／M5 | 建立試點所證實必要的最小共用介面、模組掛載與測試 helper；不另建框架、過度抽象或提前拆全域交易。 |
| 4 | M1～M3／M5 | 轉向商店、打工、住宅、銀行、背包等主要領域，以移植效益、修改頻率、集中檔衝突、依賴與測試保障選定實際切片。不預設上述領域內的固定先後；先拆 UI／路由／測試及安全的邊界，核心規則先保留。 |
| 5 | A＋M 並行 | A 的新移植功能在介面成熟且無衝突時採用新模組方式；尚不成熟時可維持最小既有接線，不得因此阻斷來源一致的移植。 |
| 6 | M4 | 先角色 row mapping、clock 等已證實可純抽離的契約，再交易與 snapshot 結算／投影；逐切片保持資料單一權威、原交易、RNG/時鐘次序、回放、回滾及跨域 golden trace。不得以主要內容優先為由先大改核心。 |
| 7 | M1～M5 | 剩餘小遊戲與邊角模組，整理過渡介面與測試；若個別功能可解除主要施工依賴或必要衝突，可提前單獨處理並記錄原因，不以低耦合為唯一排序依據。 |
| 8 | M6 | 模式專屬 adapter 與擴充方向須在核心成熟後另行核准；不自動新增 MOD 平台、玩法、框架或資料庫。 |

三窗分工：A 依現行清冊優先主要原版玩法及重要缺漏；M 以減少集中檔衝突、提升移植效率為重心；V 優先核心／跨系統及獨立玩家驗收。無衝突工作可並行；同檔實際重疊、必要依賴或已確認相關缺陷才限制受影響範圍。不得要求全部 M1、全部小遊戲或全部 V 真人驗收先完成。

選擇下一個主要切片時，記錄移植效益、玩法重要性、修改頻率、集中檔衝突、依賴／資料交易風險、測試保障及 A/V 實際重疊；先選高效益且已有可驗證邊界的切片，而不是追求拆檔數量。若需要先抽出共用 helper 以解除具體依賴，僅抽必要部分並保留契約。

每步保留 source pins、API/DOM、SQLite 升級、全部 unit/HTTP/Chrome、原子性、重啟與回滾；以最新正式基線及實際候選 checkout tree 的測試證據判定。受控、真實玩家、自然低機率與長程驗收分開；V 的真人驗收不作無關移植或切片的先決條件，已確認相關功能缺陷阻擋該切片。原版 master 唯讀、正式 Web 不直推、不 force push、不自動合併、不擅改其他窗分支。

**授權狀態：本次確定並記錄方向，不視為 M0 已結案、M1 已開工或任何合併授權。** 下一步仍為 M0 補核及試點範圍確認；具體主要領域的第一切片須以當時基線和施工重疊證據選定。

## 9. 未核實事項與決策門檻
本批為 M0 靜態清冊與第一試點方案，不是 M0 完全語義稽核結案。尚須逐個跨領域 SQL 動態表/外鍵、snapshot overview 副作用、每個測試的動態路徑及函式文字斷言、CSS selector 契約、前端間接 API 和翻譯鍵語義；取得各窗本機狀態與施工協調，確認 #146 是否已合併；正式基線若移動需差分補查。沒有本機執行、沒有候選 Chrome 或真人證據。任何後續重構需使用者授權；M0 補核不必等待 A/V 無衝突工作。若第一個試點只准 M1，M2 等另行授權。


## 10. 施工期間新增工作窗交接（再次查詢正式 HEAD 未移動）
- [A #153](https://github.com/Prysline/town-kinki/pull/153) open Draft，HEAD a87717b512a2bdb061bfc32d7eca0cc2cf906563，新增 gm02-horse-race-source.md、src/horse-race-source.mjs、tests/horse-race-source.test.mjs，沒有集中檔重疊；規則候選非已完成 GM-02。允許 A 繼續。後續正式 HTTP/SQLite/玩家入口接線時，由 M 協調 server/app/index 最小差異；不要求等待骰子試點完成。
- [V #154](https://github.com/Prysline/town-kinki/pull/154) open Draft，HEAD 713c39a00cfaa8a0ec4967aa7c9af8c28dc0fafa，驗證專用基線與 reporter、v01-player-flow.test.mjs、4 份 validation 文件。無 M0 檔案重疊；其 PR body 所載 992 TAP、117 tests、73 API 與本窗靜態數字相符。該候選新增測試仍須獨立核對 CI，不自行合併或把自動化當真人。M1 候選可移交 V 使用其獨立基線工具。
- #146、#152、#1 均仍 Draft；本次 M0 只新 Markdown，未取得或占用其他窗分支寫入權。
