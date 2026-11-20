# 第 30 階段：原版 CGI → Web 移植盤點（第一輪，持續更新）

> **版本與邊界**：2026-11-20 核對 `feature/web-phase29-event34-santa`（`90434f4f67854b5099a24da16377b48063669e6f`），原版根目錄與 Web 模組對照。這是**第一輪逐項檢核，不是完整驗收通過聲明**。本 PR 僅新增盤點與 README 入口，不修改遊戲規則、不合併 PR、不修改 master。
>
> 堆疊關係：整合 `feature/web-dual-mode-phase1` ← PR #9 `feature/web-phase28-event35-bag` ← PR #10 `feature/web-phase29-event34-santa` ← 本盤點分支。第 #34、#35 已有程式和測試，但尚未併入整合分支。
>
> 狀態用語：**已完成（限該單項公式）**、**部分完成**、**未實作**、**缺少來源無法驗證**、**暫不移植**。標示「部分完成」不代表已通過真正瀏覽器／真實舊存檔／完整 CGI 等價測試。以目前比對過的程式為準；未讀完每個 CGI 函式的欄位明寫「待逐檔核對」。

## 稽核方法與未驗證邊界

- 實際讀取原版 `town_lib.pl::check_BMI`（L507–520）、`basic.cgi` 工作／物品片段、`command.pl` 食堂片段、`event.pl` #01～#46 分支、`dat_dir` 原始課程與菜單表及 Web 對應模組；樹狀目錄和 README 用於確定其餘模組的範圍。
- 查驗 PR #9 / #10 仍 Open；`90434f4...` 的 GitHub Actions「TOWN Web tests」run `44593642283` 結論為 success；**本輪沒有本機重跑、真實瀏覽器操作或真實玩家存檔可用**。
- 原始 `member/<ID>/mono.cgi`、舊銀行／房屋玩家關聯紀錄、實際街區歷史存檔尚無使用者提供的真實樣本，不能虛構匯入相容性。
- 與原版有意採用的安全模型差異（非負金額／能力、安全整數、HTTP session、Web 延伸性別）需記錄保留，未經批准不可為等價而直接退回不安全行為。

## 14 領域逐項差異矩陣

每列依序列出「原版來源｜Web 來源／測試線索｜判定｜差異／阻塞｜優先級｜驗收與下一個 PR」。其中精準行號已直接比對；未列行號者需要下一輪深入函式稽核。

### 01 角色與體格

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| PH-01 建立角色身高、體重與原始值 | game.cgi L1609-L1618 | src/engine.mjs L145-L165 | 部分完成 | 男／女依原版；Web 增設 other 預設值；須逐欄核對初始亂數與匯入 | P0 | 核對男女邊界與 other 擴充分流；建角與匯入回歸（30-體格） |
| PH-02 BMI 五種體型 | town_lib.pl L507-L520 | src/dining.mjs L70-L80 | 已完成（分類公式） | 分類使用 floor 與 18/20/24/26；展示 BMI 與職業 BMI 口徑不同 | P0 | 參照原版 17.99/18/19.99/20/23.99/24/25.99/26 的分類表（30-體格） |
| PH-03 職業 BMI 上下限 | basic.cgi L2691-L2706,L2869-L2879；dat_dir/job.cgi 首列 | src/engine.mjs L141-L142,L183-L187 | 部分完成 | 原版使用整數 $BMI；Web character.bmi 保留小數，BMI 上限邊界可能誤拒 | P0 | 職業上限 24、BMI 24.x 原版可通行的測試；匯入存檔重算口徑（30-體格） |
| PH-04 飲食／工作增減重 | command.pl L1342-L1355；basic.cgi L2956-L2961 | src/dining.mjs L105-L125；src/engine.mjs L230-L240 | 部分完成 | 公式對齊，累積四捨五入、極低體重與未記錄用餐相容仍需驗證 | P0 | 連續吃飯／工作與重開 DB，身高變化後 BMI 再計算（30-體格） |
| PH-05 消耗品身高／體重 | basic.cgi L2556-L2579；dat_dir/syouhin.cgi | src/legacy-item-use.mjs L146-L179 | 部分完成 | 僅可確認封存消耗品；不是原版整個物品流通與作用系統 | P0 | 效果名／回或日耐久／過期／無效商品及交易回滾（30-體格） |
| PH-06 狀態頁集中顯示 | basic.cgi L2646-L2657；town_maker.cgi | public/index.html L176-L202；public/app.js L995-L1004 | 部分完成 | 資訊已顯示但折入 details，尚未完成手機與桌機實際操作驗收 | P0 | 狀態頁直接確認身高、體重、體型、BMI，手機 375px 與桌機截圖（30-體格） |
| PH-07 體型驅動外觀 | town_lib.pl L507-L520；原始 img/ 素材 | 目前未找到對應 Web 規則 | 缺少來源無法驗證 | 需找原始外觀變形規則／對應圖片；不能將 BMI 分類當作外觀已完成 | P2 | 取得來源與素材映射才開實作 PR（待排定） |

### 02 能量與工作

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| WK-01 能量上限及自然恢復 | town_ini.cgi；game.cgi；basic.cgi | src/engine.mjs；src/server.mjs | 部分完成 | Web 有上限與恢復；需核對所有轉職／體格事件的加扣條件 | P1 | 上下限、十秒刻度、快轉／多角色隔離（31） |
| WK-02 工作薪資、經驗、冷卻 | dat_dir/job.cgi；basic.cgi L2869-L2961 | src/engine.mjs L194-L245；tests/engine.test.mjs | 部分完成 | 工作經驗和薪資已存在，職業限制仍與整數 BMI 有差距 | P0 | BMI 條件、工作次數、升階、精通與固定亂數測試（30/31） |
| WK-03 飢餓／疾病修正工作 | top.pl L258-L273；basic.cgi | src/dining.mjs L82-L103；src/health.mjs | 部分完成 | 未用餐玩家以 provisional 5 經驗預設；非原版完整懲罰 | P1 | 舊玩家無紀錄、重症、狀態六級實測（31） |

### 03 學校／健身房

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| TR-01 原版課程／費用／能量 | dat_dir/school.cgi；dat_dir/gym.cgi | src/training.mjs L30-L66 | 部分完成 | 主表有解析；須逐課核對原始欄位及能力增幅 | P1 | 各課費用、能量扣除、能力變動快照（31） |
| TR-02 學校每日一次 | manual.html；dat_dir/school.cgi | src/training.mjs L75-L106 | 部分完成 | 有每日限制；日期、時區與伺服器重啟須覆核 | P1 | 跨日、切換課程及兩模式無繞過（31） |
| TR-03 健身房時間欄與額外效果 | dat_dir/gym.cgi 首列與游泳「美」 | src/training.mjs L47-L55,L75-L106 | 部分完成 | 「間」當分鐘仍是 Web 假設；extraEffect 被解析但未套用 | P1 | 先查找原版實際訓練 CGI 行為，再決定效果和冷卻（31） |
| TR-04 健身改變體格 | dat_dir/gym.cgi；原版訓練操作待定位 | src/training.mjs；src/engine.mjs | 缺少來源無法驗證 | Web 通用訓練只改能力／能量；不應假定健身必然減重 | P0 | 先取得原版可重現證據，再決定是否改重（30-體格） |

### 04 飲食／熱量

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| FD-01 原版雙菜單與售價三倍 | dat_dir/syouhin.cgi；dat_dir/syokudou2.cgi；command.pl L1330-L1355 | src/dining.mjs L29-L50；src/server.mjs L90-L99 | 部分完成 | 兩份表解析與三倍價；原版菜單更新／庫存另列 | P1 | 各品項原始序號、售價、熱量與交易一致性（31） |
| FD-02 用餐 60 分鐘與熱量增重 | town_ini.cgi L73；command.pl L1330-L1355 | src/dining.mjs L52-L69,L105-L125 | 已完成（核心公式） | 原版可能涉及不同菜單的共用時段；需測試跨菜單防重 | P1 | 60 分鐘臨界、熱量÷1000、多模式同時請求（31） |
| FD-03 每日隨機菜單與剩餘數量 | command.pl L919-L999,L1161-L1245 | src/dining.mjs L1-L2；public/index.html L330-L337 | 未實作 | 現在固定列示；原版抽選、剩餘庫存與更替規則未接 | P1 | 伺服器每日生成、同城共享、賣完／跨日／重送驗收（31） |
| FD-04 飢餓分類與舊角色保護 | top.pl L258-L273；town_ini.cgi L71-L73 | src/dining.mjs L52-L68,L82-L103 | 部分完成 | 原版 3000 日刪角規則與 Web 保護不一致；不可直接破壞存檔 | P1 | 標記保留差異，設計遷移與玩家告知（後續） |

### 05 地圖／交通

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| MP-01 四城 12×16 格與圖示 | top.pl；admin2.cgi；town_ini.cgi | src/town-map.mjs；public/town-home.js | 部分完成 | 格子和圖示有實作；原始填充街區資料需另查 | P1 | 每城尺寸、已知／未知符號、原始文件反查（31） |
| MP-02 原版 townlog 匯入／地圖編輯 | log_dir/townlog0.cgi ～ townlog3.cgi；town_maker.cgi | src/town-storage.mjs；scripts/town-map.mjs | 部分完成 | 目前 fork 的原始地圖日誌需實際確認是否有資料，不能補造配置 | P1 | 空檔與真實檔 round-trip、權限、備份／回滾（後續） |
| MP-03 車站／交通票券與跨城成本 | station.cgi；town_ini.cgi；商品檔 | public/app.js；src/town-map.mjs | 未實作（原版完整流程） | Web 城市切換不等於原版車站收費與物品效果 | P1 | 交通費、權限、票券扣除、跨城交易（後續） |

### 06 住宅／進階設施

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| HS-01 建屋／賣屋／改裝 | town_ini.cgi；original_house.cgi | src/housing.mjs；tests/housing.test.mjs | 部分完成 | 基礎住宅有功能；全部特殊地形與交易規則未逐檔覆核 | P1 | 同格競態、現金／銀行、售後還原、回滾（31） |
| HS-02 室內公告／留言與訪客權限 | original_house.cgi；command.pl L214-L218 | src/rooms.mjs；tests/rooms.test.mjs | 部分完成 | 主流程存在；舊版角色關聯日誌尚未完整匯入 | P1 | 屋主、訪客、出售搬家保留、越權拒絕（31） |
| HS-03 商店／企業／分店／特殊住宅 | command.pl；kaishiya.pl；hanbai.cgi；original_house.cgi | 尚無完整 Web 對應模組 | 未實作 | 依賴商品市場、玩家間交易、房屋存檔、經濟模型 | P2 | 先盤點各種設施使用條件與原始存檔，分 PR 建立（後續） |

### 07 銀行／資產

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| BK-01 普通與定存、計息與帳簿 | parabank.cgi；相關銀行 CGI 待逐函式核對 | src/banking.mjs；tests/banking.test.mjs | 部分完成 | 利率已有 Web 規則，計息觸發時點與原版不完全同等 | P1 | 連續跨日、停機、重入、金額上限、交易明細（31） |
| BK-02 玩家轉帳與額度 | parabank.cgi；原始角色資料 | src/banking.mjs；src/server.mjs | 部分完成 | 身份校驗與原子交易已載明；需逐項反查原始限制 | P1 | 七天限制、收款人每日上限、防重／異常回滾（31） |
| BK-03 住宅貸款及每日還款 | parabank.cgi；原始銀行相關 CGI | src/banking.mjs；tests/loans.test.mjs | 部分完成 | 負餘額與違約模式保留 Web 差異；無法稱為等價 | P1 | 貸款上限、逾期、全額清償、遷移與備份（31） |
| BK-04 稅務／原版全部資產檔匯入 | yakuba.cgi；銀行及資產關聯檔待整理 | 目前未找到完整 Web 對應 | 缺少來源無法驗證 | 需先定位 CGI 實際徵稅/帳簿來源，不推斷規則 | P2 | 來源核實後拆資料結構與交易 PR（待排定） |

### 08 物品／商店／裝備

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| IT-01 33 欄存檔封存與對照 | dat_dir/syouhin.cgi 首列；member/<ID>/mono.cgi（未提供真實玩家檔） | src/legacy-inventory.mjs；scripts/legacy-inventory.mjs | 部分完成 | 解析／封存存在；未能以真實玩家存檔完成相容性驗證 | P1 | 33 欄全欄測試、未知道具、重匯防重、無損回滾（31） |
| IT-02 可確認消耗品／耐久 | basic.cgi L2556-L2579；dat_dir/syouhin.cgi | src/legacy-item-use.mjs；tests/legacy-item-use.test.mjs | 部分完成 | 只支援部分已封存物品效果，回／日與其他道具尚需逐項核對 | P0 | 體格、疾病、冷卻、失效、幂等與安全範圍（30-體格） |
| IT-03 商店、贈送、裝備與回收 | dat_dir/prezento.cgi；dat_dir/soubi.cgi；gifutoya.cgi；recycle.cgi | 尚無完整 Web 對應 | 未實作（完整流程） | 商品來源、ギフト限制、裝備效果、交易記錄互相依賴 | P1 | 依原始商品與操作逐項拆分商品、裝備與交易 PR（31/後續） |
| IT-04 優惠券獲得與兌換 | coupon.cgi；dat_dir/coupon.cgi；event.pl #30/#35 | src/event-effects.mjs；src/events.mjs | 部分完成 | 已處理事件發券；兌換入口與商店通路不可視為完成 | P1 | 券數一致性、兌換防重、跨日／過期（31） |

### 10 醫療／保險

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| HL-01 疾病指數、症狀、工作限制 | basic.cgi；原版疾病相關分支 | src/health.mjs；tests/health.test.mjs | 部分完成 | 病症與工作停工已有規則；需逐病例覆核原始門檻 | P1 | 各門檻、跨日、處理順序、能量交互（31） |
| HL-02 醫院治療與原始保險 | 原始健康保險商品與醫院 CGI | src/health.mjs；src/inventory.mjs；tests/inventory.test.mjs | 部分完成 | 30 天有效期、折扣已載明；舊道具與有效期基準仍有差異 | P1 | 有效／過期、批量購買、醫院扣費、資料隔離（31） |

### 11 社交／婚戀／育兒／戰鬥

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| SC-01 私訊與玩家互動 | bbs.cgi；tag.cgi；log_dir/aisatulog.cgi | 尚無完整 Web 對應 | 未實作 | 先確認各 CGI 的權限與儲存格式 | P2 | 收發、跨帳號授權、歷史匯入、刪除與清理（後續） |
| SC-02 戀愛／婚姻／同居／育兒 | dat_dir/love.cgi；kekkon.cgi；log_dir/couplelog.cgi；log_dir/kodomolog.cgi | 尚無完整 Web 對應 | 未實作 | 依賴角色關聯檔、多人帳號及安全同步 | P2 | 原始關係狀態／事件、隱私及回滾（後續） |
| SC-03 決鬥／裝備／獎賞 | battle.cgi；atakka.cgi；dat_dir/battle.cgi | 尚無完整 Web 對應 | 未實作 | 裝備及傷害計算先追來源，不可發明戰鬥公式 | P2 | 傷害、冷卻、結算交易、跨帳號與重送（後續） |

### 12 帳號／角色／安全

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| AC-01 單人／多人角色與登入 | game.cgi；town_lib.pl | src/server.mjs；src/solo-character.mjs；tests/server.test.mjs | 部分完成 | HTTP-only、scrypt、帳號隔離已存在；部署安全審查未完成 | P0 | solo/multi 不互通、跨帳號拒絕、登出與 session 失效（30/31） |
| AC-02 單人刪角／繼續遊戲 | 原版角色保存／刪除行為待逐檔確認 | src/solo-character.mjs；public/app.js | 部分完成 | Web 擴充確認流程，非原版全世界重置 | P1 | 取消/誤名/交易失敗、不刪地圖與時鐘（31） |
| AC-03 公開部署／管理權限／速率限制 | admin.cgi；admin2.cgi；unei.pl | src/server.mjs；README 安全限制 | 部分完成 | 未有完整登入速率限制及公開部署審查；不宜公開直接部署 | P0 | 威脅模型、權限矩陣、網路與備份演練（後續） |

### 13 轉檔／資料庫

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| DB-01 原版角色 69 欄匯入 | town_lib.pl::kozin_sprit | src/legacy-character.mjs；scripts/legacy-character.mjs | 部分完成 | 無真實玩家資料，僅可確認解析器與測試資料 | P1 | 69 欄 round-trip、未知欄保留、拒絕覆蓋（31） |
| DB-02 物品 33 欄匯入 | dat_dir/syouhin.cgi；member/<ID>/mono.cgi（來源未提供） | src/legacy-inventory.mjs；scripts/legacy-inventory.mjs | 部分完成 | 封存來源未能以真實 mono.cgi 回歸 | P1 | 重複匯入、原始 ID、損毀／過期、私有備份（31） |
| DB-03 住宅／銀行／關聯歷史匯入 | log_dir/*；原始住宅與銀行資料 | src/town-storage.mjs；src/housing.mjs；src/banking.mjs | 部分完成 | 已涵蓋部分地圖資料，關聯檔非完整搬移 | P1 | 來源欄位映射、交易一致性與回滾清單（後續） |
| DB-04 SQLite 遷移／還原 | 原始多檔保存規則 | src/server.mjs；web/data/（不納入版控） | 部分完成 | 已自動加欄；沒有自動逆遷移，須先備份 | P0 | 破壞性 schema 變更前先做 transaction 與 restore 測試（30/31） |

### 14 UI／相容／營運

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| UI-01 三欄位狀態切換與原始資訊 | town_maker.cgi::loged_gamen；top.pl | public/index.html L176-L202；public/app.js | 部分完成 | 有 ARIA tab 與原版分頁；實機 375px/768px/桌機驗收缺少 | P0 | 狀態體格、物品、能力切換不丟資料、鍵盤導覽（30/31） |
| UI-02 事件通知及 20 秒挑戰 | top.pl；event.pl L290-L305 | public/app.js；src/event-cockroach.mjs | 部分完成 | 程式顯示與 API 存在；真實操作與動態尺寸未驗證 | P1 | 模擬快轉阻擋、失效、跨帳號、視覺遮蔽（31） |
| UI-03 地圖、餐點與手機 RWD | top.pl；town_maker.cgi；command.pl | public/style.css；public/index.html；public/app.js | 部分完成 | UI 結構已有改善；尚無 Chrome/Safari 實際截圖 | P1 | 手機與桌面流程、捲動固定條、讀屏／鍵盤（31） |
| UI-04 部署／監控／備份 | 原始 CGI 運行環境；README | web/package.json；.github/workflows/town-web.yml | 部分完成 | CI 有測試；尚無正式營運安全／備份定期還原驗證 | P2 | 部署檢查、日誌、備份和恢復演練（後續） |

### 09 隨機與限時事件：全部 #01～#44 獨立列示

**可達性：** `event.pl` 在 L314 以 `int(rand(44))+1` 抽 #01～#44；原始碼雖有 #45（L855）及 #46（L860），但在這個抽選入口不可達，另列為「原版存在、預設不可抽」，**不得自行更改為 46 個事件**。

**Web 觀察：** `src/event-effects.mjs::NON_ITEM_EVENT_IDS` 有 37 個非疾病分支；`src/events.mjs::ILLNESS_EVENTS` 有 #04、#15，共 39/44 個程式分支。以下「程式已有」表示原始 ID 的對應分支存在，不保證已逐分支完成所有原作邊緣條件和實際 UI 驗證。除 #34、#35 位於堆疊 PR，其他分支在整合後續狀態仍應以 PR diff 查核。

| 事件 ID | 原版條件／效果（摘要） | 原版位置 | Web 分支／測試線索 | 完成度／整合狀態 | 尚需驗收／阻塞 |
|---|---|---|---|---|---|
| #01 | 扒手：失竊或抓到扒手領賞 | [event.pl L316](../../event.pl#L316) | `src/event-effects.mjs::case 1`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #02 | 撿到錢包：取得金錢 | [event.pl L332](../../event.pl#L332) | `src/event-effects.mjs::case 2`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #03 | 傳教士教英語：可能受英文教材加成 | [event.pl L338](../../event.pl#L338) | `src/event-effects.mjs::case 3`; tests/event-item-bonus.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #04 | 感冒：疾病指數變化 | [event.pl L353](../../event.pl#L353) | `src/events.mjs::ILLNESS_EVENTS`; tests/events.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #05 | NHK 收費：現金 -1,000 | [event.pl L358](../../event.pl#L358) | `src/event-effects.mjs::case 5`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #06 | 失戀暴食：體重 +5kg | [event.pl L363](../../event.pl#L363) | `src/event-effects.mjs::case 6`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #07 | 國語事件：能力 ±3 | [event.pl L368](../../event.pl#L368) | `src/event-effects.mjs::case 7`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #08 | 數學事件：能力 ±3 | [event.pl L378](../../event.pl#L378) | `src/event-effects.mjs::case 8`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #09 | 理科事件：能力 ±3 | [event.pl L388](../../event.pl#L388) | `src/event-effects.mjs::case 9`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #10 | 社會事件：能力 ±3 | [event.pl L398](../../event.pl#L398) | `src/event-effects.mjs::case 10`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #11 | 音樂事件：能力 ±3／道具加成 | [event.pl L408](../../event.pl#L408) | `src/event-effects.mjs::case 11`; tests/event-item-bonus.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #12 | 美術事件：能力 ±3 | [event.pl L423](../../event.pl#L423) | `src/event-effects.mjs::case 12`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #13 | 幸運籤：隨機金錢 | [event.pl L433](../../event.pl#L433) | `src/event-effects.mjs::case 13`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #14 | 溫暖心情：LOVE +5 | [event.pl L440](../../event.pl#L440) | `src/event-effects.mjs::case 14`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #15 | 受寒生病：疾病指數變化 | [event.pl L445](../../event.pl#L445) | `src/events.mjs::ILLNESS_EVENTS`; tests/events.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #16 | 小偷／監視器：銀行存款損失分支 | [event.pl L450](../../event.pl#L450) | `src/event-effects.mjs::case 16`; tests/event-bank-ufo.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #17 | 祖母智慧書：版稅加成 | [event.pl L476](../../event.pl#L476) | `src/event-effects.mjs::case 17`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #18 | 呼拉圈：金錢加成 | [event.pl L491](../../event.pl#L491) | `src/event-effects.mjs::case 18`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #19 | 護身符：車禍賠償分支 | [event.pl L506](../../event.pl#L506) | `src/event-effects.mjs::case 19`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #20 | 香水：現金翻倍或撿錢 | [event.pl L519](../../event.pl#L519) | `src/event-effects.mjs::case 20`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #21 | 藥品：LOVE／親密能力增減 | [event.pl L534](../../event.pl#L534) | `src/event-effects.mjs::case 21`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #22 | 地震：保險保全或現金變少 | [event.pl L550](../../event.pl#L550) | `src/event-effects.mjs::case 22`; tests/event-collection.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #23 | 會員卡：獎金分支 | [event.pl L567](../../event.pl#L567) | `src/event-effects.mjs::case 23`; tests/event-bank-ufo.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #24 | 彩票：中獎或支出 | [event.pl L590](../../event.pl#L590) | `src/event-effects.mjs::case 24`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #25 | 大阪阿姨：體重 -1kg | [event.pl L603](../../event.pl#L603) | `src/event-effects.mjs::case 25`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #26 | 街頭打鬥：能量減損 | [event.pl L608](../../event.pl#L608) | `src/event-effects.mjs::case 26`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #27 | 溫泉券：雙能量 +1,000 | [event.pl L625](../../event.pl#L625) | `src/event-effects.mjs::case 27`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #28 | 捐款 10,000：呼叫 kifu（待追實際結果） | [event.pl L631](../../event.pl#L631) | `尚無對應事件實作` | 未實作 | 必須先查清 kifu 的完整副作用與使用對象，再實作捐款交易 |
| #29 | 幸運星砂：現金翻倍或撿錢 | [event.pl L636](../../event.pl#L636) | `src/event-effects.mjs::case 29`; tests/event-cash-item.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #30 | 優惠券：隨機 1～5 張 | [event.pl L647](../../event.pl#L647) | `src/event-effects.mjs::case 30`; tests/event-coupon.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #31 | MiG-25 耐久／販賣機找零 | [event.pl L653](../../event.pl#L653) | `src/event-effects.mjs::case 31`; tests/event-collection.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #32 | 三件收藏品：滿足條件可獲高額現金 | [event.pl L663](../../event.pl#L663) | `src/event-effects.mjs::case 32`; tests/event-collection.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #33 | 搞笑藝人／鹿：趣味或能量效果 | [event.pl L674](../../event.pl#L674) | `src/event-effects.mjs::case 33`; tests/event-collection.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #34 | 聖誕人偶：現金翻倍／雙能量恢復／蟑螂 20 秒 | [event.pl L689](../../event.pl#L689) | `src/event-effects.mjs::case 34`; tests/event-santa.test.mjs | 程式已有／PR #10 或 #9 未併整合 | 需要 PR #9 → #10 堆疊整合；限時／回耐久與重送 |
| #35 | 四次元福袋：四分支、扣回數 | [event.pl L710](../../event.pl#L710) | `src/event-effects.mjs::case 35`; tests/event-bag.test.mjs | 程式已有／PR #10 或 #9 未併整合 | 需 PR #9；四種結果、券數、耐久及無結果分支 |
| #36 | 惡魔之笛：捐款／扣現金／被偷錢 | [event.pl L732](../../event.pl#L732) | `尚無對應事件實作` | 未實作 | kifu2/kifu3 及惡魔／天使之笛原版副作用未完全追查，先做依賴圖 |
| #37 | 天使之笛：捐款／得獎／收錢 | [event.pl L750](../../event.pl#L750) | `尚無對應事件實作` | 未實作 | kifu2/kifu3 及惡魔／天使之笛原版副作用未完全追查，先做依賴圖 |
| #38 | 與聖誕老人戰鬥：力量門檻、掉寶／1 萬元、失敗歸零能量 | [event.pl L769](../../event.pl#L769) | `尚無對應事件實作` | 未實作 | 依賴 get_itm/get_itm2 道具生成、背包容量、封存格式與交易 |
| #39 | 工作集中：經驗增減 | [event.pl L789](../../event.pl#L789) | `src/event-effects.mjs::case 39`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #40 | 河中物品：得道具或失 500 元 | [event.pl L799](../../event.pl#L799) | `尚無對應事件實作` | 未實作 | 依賴 get_itm/get_itm2 道具生成、背包容量、封存格式與交易 |
| #41 | 販賣機找零：獲 1,000 元 | [event.pl L814](../../event.pl#L814) | `src/event-effects.mjs::case 41`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #42 | 球隊應援票券：精力／能力／道具效果 | [event.pl L819](../../event.pl#L819) | `src/event-effects.mjs::case 42`; tests/event-collection.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #43 | 失戀無食慾：體重 -5kg | [event.pl L845](../../event.pl#L845) | `src/event-effects.mjs::case 43`; tests/event-effects.test.mjs | 程式已有／待逐分支複核 | 來源條件、機率、道具有效性、安全值差異、歷史及交易回滾 |
| #44 | 蟑螂：20 秒領賞、K 點數及外貌變化 | [event.pl L850](../../event.pl#L850) | `src/event-effects.mjs::case 44`; tests/event-cockroach.test.mjs | 程式已有／待逐分支複核 | 20 秒截止、跨帳號及同事件二次領取 |

**原版 #45／#46：** `event.pl` L855–863 含「遭搶劫現金減半」及「銀行帳戶扣 1/3」，但預設 44 項抽選不會選中；標記「原始碼存在、不可達」，不得計入 39/44，也不得擅自開放。

**事件後續必要工作：** 逐 ID 建立分支覆蓋表，對照 `event.pl` 全部條件、`motimono_kensa_ev*`、`kifu*`、`get_itm*`、抽選權重與資產/能力上下限；以亂數固定種子驗證、同日防重、跨日、多人隔離、歷史寫入失敗 rollback、二次領獎、逾時、單機快轉。**目前只核實已存在 39 個實作分支與各自測試檔線索，不宣稱 39 個完整等價驗收。**

## 第一輪重大發現與應先修項

1. **P0/體格 BMI 判定口徑**：`town_lib.pl::check_BMI` 使用 `int(weight/(height/100)^2)`；原版 `basic.cgi` L2691-L2706、L2869-L2879 的職業門檻使用此整數。Web `src/dining.mjs::physiqueStatus` 已按整數分類，但 `src/engine.mjs::bodyMassIndex` 回傳 1 位小數，`eligibility` 直接用 `character.bmi`。例如實際 BMI 24.4、職業上限 24：原版整數值 24 允許，Web 24.4 可能誤拒。先統一**職業判定使用原版取整值**，保留是否另外顯示 1 位小數的 UI 區分。不得未測試就重寫現存角色資料。
2. **P0/健身與體格**：`dat_dir/gym.cgi` 游泳課程原始效果為 `美`，`src/training.mjs` 僅保留 `extraEffect` 欄未套用；不可自行把此欄當作「體重 -X」或設計外觀變形。
3. **P1/食堂每日菜單與庫存**：`command.pl` L919–999、L1161–1245 有更新菜單與剩餘量，Web `src/dining.mjs` 頂部承認固定展示。
4. **P0/事件分支**：缺 #28、#36、#37、#38、#40；其中 #28、#36、#37 的 `kifu*` 要先追完整實作；#38、#40 需物品產生與背包容量。
5. **P0/展示**：`public/index.html` 已有 `#measurements`、`#physique-status`，`public/app.js` 已更新 BMI；下一 PR 先將體格整理為可快速查看的區塊，不能說 UI 完全沒有體格。
6. **來源警示**：`src/dining.mjs` L66 用 `2995` 日門檻，對應 `town_ini.cgi` 的 `deleteUser=3000` 與原版 `top.pl` 的 `deleteUser - 5`；數字有來源，真正不同是 Web 無用餐紀錄的 provisional 保護與原版刪角機制。

## 第 30 階段 P0-B 體格核心追蹤：BMI 職業判定

- **原版依據**：`basic.cgi::job_change` 與 `basic.cgi::do_work` 會先執行 `$taijuu = sprintf("%.1f",$taijuu)`，接著由 `town_lib.pl::check_BMI` 使用 `int(體重/(身高/100)^2)` 計算整數 BMI；職業上下限為包含邊界。
- **Web 修正範圍（P0-B 開發分支）**：新增 `src/dining.mjs::legacyPhysiqueBmi`，統一 `physiqueStatus`（五種體型）與 `src/engine.mjs::eligibility`（轉職、工作）使用原版公式。保留 `bodyMassIndex` 的一位小數結果作為現有角色存檔欄位，不改表結構或批量覆寫舊存檔；職業判定由身高／體重即時計算，不信任可能陳舊的 `character.bmi`。
- **測試**：`tests/dining.test.mjs` 涵蓋原版體重小數四捨五入前後的 18／24／26 臨界；`tests/engine.test.mjs` 涵蓋超出／剛好符合 BMI 職業上限、最低門檻、無上限、轉職與實際工作、過時存檔 BMI 不影響判定。
- **保留差異／範圍外**：原版 Perl 的 `sprintf` 在極端浮點數／半分界的行為尚無全量對照；本修正不宣稱醫療／服裝／健身額外效果與所有職業規則已完整等價。真正瀏覽器、真實舊存檔驗證仍待執行。
- **狀態**：已提交 P0-B 程式及測試；**CI 與 PR 最終審查狀態以 GitHub 即時結果為準**，在此文件不將其標為已合併。

## P0 → P1 → P2 切片與相依／拒絕條件

| 切片／預定 PR | 目標／檔案與資料 | 前置 | 必須新增／保留的測試 | 拒絕條件 |
|---|---|---|---|---|
| P0-A：本盤點 PR | 只新增 `web/docs/migration-audit.md`，README 入口 | PR #10 作為堆疊基底 | 文件 14 領域／44 ID 完整、連結與靜態證據；CI | 未核對的事項不得標成已完成；不改遊戲程式 |
| P0-B：體格核心 | `src/engine.mjs`、`src/dining.mjs`、`src/legacy-item-use.mjs`、相關 tests；必要時非破壞 DB migration | P0-A 審核；查原版工作 BMI 路徑 | BMI 上限邊界、身高變更、連續飲食／工作／物品、存檔重啟、跨帳號隔離 | 不直接覆蓋舊角色 BMI／體重，不加入無來源的健身減重 |
| P0-C：狀態頁體格整理 | `public/index.html`、`public/app.js`、`public/style.css`、UI tests | P0-B 欄位定案 | 手機 375px/768px 與桌面真實瀏覽器／鍵盤檢查 | 無瀏覽器驗證不得標註視覺驗收成功 |
| P1-A：餐飲日表及庫存 | `src/dining.mjs`、`src/server.mjs`、SQLite 日菜單／庫存表、tests | P0-B、每日時鐘與餐飲交易 | 隨機菜單、跨日、賣完、同城共用、重送完整回滾 | 不憑空生成原版不存在的商品或菜單 |
| P1-B：健身特殊效果 | `src/training.mjs`、原版 gym 相關 CGI／tests | 原版實際效果與「間」欄來源確定 | 課程額外效果、時間、失敗回滾 | 來源不足則先補研究，不造數值 |
| P1-C：剩餘五事件 | `src/event-effects.mjs`、`src/events.mjs`、物品交易／庫存、tests | `kifu*`、`get_itm*`、來源交易已可表示 | 每 ID 亂數、耐久、容量、日限額、多人隔離、rollback | 未有贈送/物品產生交易時不可用假獎勵替代 |
| P2：住宅商店／社交／戰鬥／部署 | 原始 CGI 對應表、Web 新模組、SQLite、UI | 角色資料、經濟／權限／真實舊存檔依賴 | 端到端與安全／備份演練 | 未核對規則不宣稱等價 |

### 驗收與盤點待辦

- [x] 建立實際來源支持的第一輪 `migration-audit.md` 與 14 領域矩陣。
- [x] 逐列列出全部可抽的 #01～#44，並指出預設不可抽的 #45／#46。
- [x] 區分 PR #9／#10 未整合與原版可達／不可達事件。
- [x] 體格優先；已找到整數 BMI 職業判定差異。
- [ ] 對每個 CGI 子函式及 44 事件做完整**數值、資料欄位、條件、相依與單元測試逐項簽核**。
- [ ] 取得真實角色／物品／房屋／銀行備份後驗證匯入（目前沒有）。
- [ ] 真實瀏覽器 375px、768px、桌機與鍵盤／讀屏驗收（目前未做）。
- [ ] P0-A PR CI 綠燈後，才將此文件升級為「初版盤點 PR 已驗收」；仍不得宣稱 14 領域全部移植。
