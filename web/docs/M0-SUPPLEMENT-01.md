# M0 補核 01｜骰子試點邊界與共用核心風險

2026-11-28 UTC+8。接續 #155 9a402c12b1ab029b5b14362459cefc1a040c8d73 / 92392e7aec04a314ee0171b30f602b47e957f597。使用者本次 M 窗指令已授權受控、可逆模組化施工，未授權合併、玩法或資料權威變更；#152 歷史授權文字保留。此補件只新增文件。

## 1. 固定基線及實際 CI
正式 c18f56e8df68f3c8998c1ba7733500026e34424b / d462bbd51f94066499ff3c1e084d6fa4532ed47e。重新讀取 Git commit API 及完整原始 job logs：
- Push [46028885558 / 140607274314](https://github.com/Prysline/town-kinki/actions/runs/46028885558/job/140607274314)，checkout c18f56e8。
- #1 [46028895284 / 140607306338](https://github.com/Prysline/town-kinki/actions/runs/46028895284/job/140607306338)，checkout bbd00fdb18e76992a7bf3a9b29d08cc2f652347c，同正式 tree。
- #155 [46043703111 / 140657547407](https://github.com/Prysline/town-kinki/actions/runs/46043703111/job/140657547407)，checkout e5c8f16f65dee43431edd14c9a615bd0b57d2316，同 9a402c12 候選 tree。
三者各 992/992，fail/cancelled/skipped/todo=0，兩語法步驟 success；實際 992 個 TAP 名稱含順序逐項相等。不是本地重跑，也不是本補件或新骰子候選 CI。

## 2. 已補核的核心契約（固定正式來源）
- server L289–325：saveCharacter UPDATE 不含 kpoint；不許全列覆寫。mutateCharacter 同步 callback，在 BEGIN IMMEDIATE 與 saveCharacter 之前可寫其他資料，afterSave 在 saveCharacter 之後、COMMIT 之前；callback 或 afterSave 丟錯均回滾。禁止以 async、巢狀交易或獨立 COMMIT 代替。
- 七個實際呼叫：job/job-payment 僅角色映射；work 先獨立 settleBankInterest，再在 callback 記 bonus→salary 帳簿，energyContext=work；hospital 在 callback 讀保險；meal 在 callback rotate→recoverEnergy/eatMeal→takeDiningStock；train 信用卡先驗證、交易外 settleBankInterest，callback 內再驗卡並記帳，afterSave refreshBankTaxSnapshot；move 先查 road pending，再交易內計票價扣款與移動。交易外的利息若已提交，後續角色操作失敗不應被重構默默改成全部回滾。上述不是對既有玩法安全性的重新核准。
- snapshot L327–553：activeOnsenVisit 早退只走唯讀 preview；否則依原順序銀行、角色恢復、每日健康／事件、食堂、百貨、自販機、餌料、批發輪替、房屋投影、refreshBankTaxSnapshot、各 overview。不可把 GET 視為純讀取，也不可在 action 交易內再呼叫 snapshot。
- c-league.mjs L120：overview 即使 activate:false 仍開 BEGIN IMMEDIATE/COMMIT，false 分支不呼叫 season()；true 可建立／推進賽季並更新排名。arcade-loto6.mjs L229 的 drawDue 僅 SELECT 與時間／張數判定，不開獎；不要因名稱誤判副作用。arcade-cardw 的 state 僅讀既有單列，不補建；arcade-dice overview 查角色、地圖與本人歷史，不扣款、不消耗 RNG。onsenOverview 與 activeOnsenVisit 查資料並投影，不結算出浴。bankOverview/bankTaxOverview 直接讀取；bankLoanOverview 查角色、帳戶、貸款報價。inventory-life heldInventoryRows 依表存在性選有／無 usage 的 SELECT，過期過濾不刪資料；listLegacyInventoryItems/listLegacyItemActions 查來源、耐久與可用狀態，非使用物品。
- 現金、普通存款、K 點由 characters 對應欄位維持，定存/貸款/稅務/帳簿由 banking 現有表協議維持；物品原始資料與 usage 分開，讀時合併，不可另建平行背包。solo-character 刪本機 user 依 FK CASCADE，不能改為只刪角色。
- server L107–109 動態 ALTER TABLE characters ADD COLUMN 使用既有升級欄位清單；不得當成普通 runtime 更新。roadOverview 組合 SELECT_TRIP 常量與 WHERE，參數綁定。靜態索引不能涵蓋所有拼接 SQL。逐檔全域掃描受到工具單次呼叫上限，未取得完整動態 SQL／外鍵傳遞閉包；本補件不宣稱完整 M4 契約。

## 3. 試點局部契約
- 固定 blob arcade-dice.mjs 7cbcf4a815d594bd2a79fcf6fcc720ce2eb2ca3a；原版 gamerand/saikoro 解析、五種下注額、一次 randomIndex(36)、五分鐘、20 筆不動。成功及 replay 在同一 BEGIN IMMEDIATE 中完成；同本人同 requestId 不同 payload 拒絕；replay 在角色／位置／冷卻檢查之前；失敗 ROLLBACK。僅 characters.money 與 arcade_dice_rounds 寫入；不經 mutateCharacter、不額外刷新稅基或調整 RNG。
- server 原 L938–947 的 POST handler 僅將 core 例外映射 400；snapshot 與 sendJson 在 catch 外，不能誤轉其錯誤成 400。gameNow 在 core 呼叫前一次；完成 action transaction 才 snapshot 一次。方法、Origin/Host、JSON、session 與入浴 409 guard 均保留在 server 原位置。新 route 不初始化 DB、無新增入口。
- app 原 L2969–2997、3073–3130、4707：pending/busy 全生命週期單例；confirm 先於 requestId；失敗保留 requestId；成功先更新全域 state 再 render/notify；finally 解除 busy 並按現有 state render；閉包的 amount/guess 與最新 state 現金檢查不改。只透過 getter/setter 接全域 state；不複製 state、不加 timer，不將 pending 改成帳號 scope。保留 zh-TW 字串、日期、money formatter、原始 HTML ID 及 health-event-list class。static safeFile 可直接送出同源 /static/modules/*.js，無新 CSP 或 URL。
- test glob node --test tests/*.test.mjs；117 原檔不移動。home-ui 原第55階段測試的 render、API、pending/busy、安全 DOM 斷言應對真正模組來源，保留 app 呼叫並增 import/factory wiring；server.test 兩個真 HTTP 原測試保留；arcade-dice.test 原規則、冷卻、交易回滾、刪角保留。新瀏覽器／lost response／Origin／入浴守衛及候選差分仍要實際驗證，未執行不算通過。

## 4. 工作窗與衝突
- #146 df87e3f2... app patch 僅 renderCompactStatus L277、home-ui 末尾追加；#153 8f77b262... app patches L1 import、L541 地圖、L4544/4647/4665/5212 競馬組裝，server patches L32/129/212/488/745，home-ui L148 地圖清冊。逐 patch 無骰子增刪。共同檔仍有 import 附近可能整合重疊，合併前須重查；本窗只在獨立分支改骰子區段，不占用別窗整個檔案。
- #154 31723c0e... 只有 V 專用驗證檔與 workflow，#156 c8fa1bba... 只 onsen、獨立測試與文件。
- V [#155 留言](https://github.com/Prysline/town-kinki/pull/155#issuecomment-7228107605) 已確認 V-AP05-BK-01：基線 Monday direct POST 入浴提前刷新稅基漏 30,000；由 #156 修復，V 獨立重驗。暫不拆相關溫泉、銀行稅務、共用結算，不混入骰子，不全面阻擋 A/V。
- 已讀 web/README、現行狀態、migration-audit、#152 決策、#155 11 份清冊，原版 master 不寫。README 在 web/ 而非 repo root。
- 本地 DNS 無法連 GitHub，無其他窗 worktree/stash 或未推送資訊；遠端 connector 可讀寫。全域動態 SQL、所有 overview 間接 helper、所有測試動態路徑及 DOM/CSS 契約仍是後續按受影響領域補核的風險清冊；不以此聲稱全域 M0 已完全語義結案，也不因此阻擋已核清的骰子邊界。試點候選須另開 Draft，CI 未過前不交付為完成；不得自動合併。
