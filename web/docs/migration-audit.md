# 第 30 階段：原版 CGI → Web 移植盤點（第一輪，持續更新）

> **現行範圍更正（2026-11-21）**：只借用原版 CGI 玩法與原版商品格式；**舊 CGI 玩家存檔／帳號／背包／優惠券／郵件資料的匯入、相容與真實舊玩家檔驗收全部排除**，不再列為開發或驗收門檻。只需保護新版 Web SQLite 存檔與角色資產，詳 [專案範圍](project-scope-no-legacy-player-import.md)。

> **版本與邊界**：原始盤點於 2026-11-20 以 `feature/web-phase29-event34-santa`（`90434f4f...`）的原版與 Web 程式開始比對，後續逐項更新。本文件是**第一輪逐項檢核、持續修正中，並非完整移植或真實玩家驗收通過聲明**。
>
> **來源與整合狀態**：本盤點持續對照 [`feature/web-dual-mode-phase1`](https://github.com/Prysline/town-kinki/tree/feature/web-dual-mode-phase1) 與原版 CGI。已核實的**歷史基準**：PR #18 合併提交 `6ce7fdbfc94d6a0344b0756499ecb41ef6f0c1d4`，整合後 CI run `44670824358` 成功；PR #19、#20 此後也完成盤點修正及入口稽核。**最新 PR／CI 請由 [GitHub PR](https://github.com/Prysline/town-kinki/pulls?q=is%3Apr+is%3Amerged) 與 [Actions](https://github.com/Prysline/town-kinki/actions) 即時查詢**，不把手寫編號當作永久的最新狀態。`master` 不作 Web 修改。
>
> 狀態用語：**已完成（限該單項公式）**、**部分完成**、**未實作**、**缺少來源無法驗證**、**暫不移植**。標示「部分完成」不代表已通過真正瀏覽器／新版 Web 存檔重啟／完整 CGI 玩法等價測試。以目前比對過的程式為準；未讀完每個 CGI 函式的欄位明寫「待逐檔核對」。

## 稽核方法與未驗證邊界

- 實際讀取原版 `town_lib.pl::check_BMI`（L507–520）、`basic.cgi` 工作／物品片段、`command.pl` 食堂片段、`event.pl` #01～#46 分支、`dat_dir` 原始課程與菜單表及 Web 對應模組；樹狀目錄和 README 用於確定其餘模組的範圍。
- **歷史整合證據**：截至 PR #18，PR #9～#18 已合併；PR #18 整合提交 `6ce7fdbfc...` 的 GitHub Actions run `44670824358` 為 success。之後版本一律由 GitHub PR／Actions 查核；**尚未以真實瀏覽器或新版 Web 存檔備份完成驗收**。
- 原版玩家的私人存檔不在需求內；`member/<ID>/mono.cgi` 僅作為原版商品資料格式與玩法來源，原始四城街區資料皆空白，現行單機試玩布局是 Web 新配置。
- 與原版有意採用的安全模型差異（非負金額／能力、安全整數、HTTP session、Web 延伸性別）需記錄保留，未經批准不可為等價而直接退回不安全行為。

**最新待辦總清冊（2026-11-20）**：[尚未深入盤點、已確認缺漏、已修待驗收與不可推定功能](phase30-open-audit-backlog.md)。包含遊樂中心子 CGI、道具／怪物投稿、市公所、活動、銷售等多層入口，以及 PR #29 後應同步的現況。此清冊僅記錄原始證據與後續工作，**不是新功能已移植**。

**入口層總覆蓋對照**：[原版 `unit.pl` 全部 43 個表單入口、Web 地圖／面板與來源功能逐列查核](phase30-entrypoint-coverage.md)。此清冊以原版入口為起點，填補僅看 Web 模組導致的漏項；並不宣稱每個來源 CGI 的交易函式已完整稽核。

## 14 領域初步差異矩陣（不是全部原版設施的逐入口盤點）

每列依序列出「原版來源｜Web 來源／測試線索｜判定｜差異／阻塞｜優先級｜驗收與下一個 PR」。有直接核對到原始執行分支才可標「確定缺漏」；只有資料表、使用手冊或未能定位實際路徑時須標「資料已存在／執行未驗證」。**14 領域是分類框架而非已覆蓋全部 CGI／每個設施的證據**。本輪後續入口盤點獨立追蹤，避免將未列設施誤判為不存在。

### 01 角色與體格

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| PH-01 建立角色身高、體重與原始值 | game.cgi L1609-L1618 | src/engine.mjs L145-L165 | 部分完成 | 男／女依原版；Web 增設 other 預設值；須逐欄核對初始角色亂數 | P0 | 核對男女邊界與 other 擴充分流；建角與新版 Web 存檔回歸（30-體格） |
| PH-02 BMI 五種體型 | town_lib.pl::check_BMI；basic.cgi::job_change | src/dining.mjs::legacyPhysiqueBmi／physiqueStatus | 部分完成（PR #12 與 #14 已合併，待新版 Web 存檔驗收） | 整數 BMI 五段已對齊；最新查出 Perl sprintf 半分界與 JS Math.round 不同，P0-D 已修正並補測 17.95／24.95／25.95 | P0 | 檢查 18／20／24／26 臨界、半分界及真實檔案重讀（30-體格） |
| PH-03 職業 BMI 上下限 | basic.cgi L2691-L2706,L2869-L2879；dat_dir/job.cgi | src/engine.mjs::eligibility；src/dining.mjs::legacyPhysiqueBmi | 部分完成（核心判定已合併） | PR #12 已讓轉職／工作都從身高、體重即時計算原版整數 BMI；P0-D 補 Perl sprintf 半分界；新版 Web 存檔升級與重啟尚須驗收 | P0 | 24.95／24.96、身高變更、體格上下限及新版存檔（30-體格） |
| PH-04 飲食／工作增減重 | command.pl L1342-L1355；basic.cgi L2956-L2961 | src/dining.mjs L105-L125；src/engine.mjs L230-L240 | 部分完成 | 公式對齊，累積四捨五入、極低體重與未記錄用餐相容仍需驗證 | P0 | 連續吃飯／工作與重開 DB，身高變化後 BMI 再計算（30-體格） |
| PH-05 消耗品身高／體重 | basic.cgi L2556-L2579；dat_dir/syouhin.cgi | src/legacy-item-use.mjs L146-L179 | 部分完成 | 僅可確認封存消耗品；不是原版整個物品流通與作用系統 | P0 | 效果名／回或日耐久／過期／無效商品及交易回滾（30-體格） |
| PH-06 狀態頁集中顯示 | basic.cgi L2646-L2657；town_maker.cgi | public/index.html::physique-summary；public/app.js::renderDining | 部分完成（PR #13 已合併） | 身高／體重、體型與 BMI 已移至狀態頁常駐摘要；真實手機與桌面瀏覽器操作未驗證 | P0 | 375px／768px／桌面截圖、對照工作後及用餐後刷新（30-體格） |
| PH-08 玩家圖示 URL／新角色圖示 | town_lib.pl::kozin_sprit（kounyuu＝アイコンURL）；game.cgi::battle | src/appearance.mjs；public/app.js::renderLegacyIcon；src/legacy-character.mjs | 部分完成（已匯入本人圖示可手動預覽） | 原版對戰可顯示 32×32 kounyuu；Web 僅由本人點擊預覽 HTTPS 已封存 URL，未支援原版對戰中對手圖示 | P1 | 新版 Web 存檔、玩家對戰圖示、瀏覽器與 URL 安全驗證（後續） |
| PH-09 原版公開真實個人檔案中的自選外貌描述 | town_ini.cgi L148–179；basic.cgi::prof L1682–2105 | 無完整 Web 真實個人檔案流程（詳 SC-04／SC-05） | 未實作（有原版來源） | 原版是獨立、玩家自願公開的真實個人檔案，並非從角色 looks、BMI 自動生成 | P2（個資） | 自願填寫、同意公開、編輯與搜尋的獨立驗收；不得使用遊戲數值代填 |
| PH-10 C 聯賽自創角色圖片 | game.cgi::doukyo／c_league；member/<ID>/chara_ini.cgi | 尚無完整 Web C 聯賽資料模型 | 未實作 | ch_gazou 是另一個可自訂圖像的比賽角色，與 kounyuu 不同；需要完整遊戲模組前置 | P2 | 原始比賽角色存檔、圖片規範、參賽流程與權限驗證（後續） |

**外貌原版來源對照**：[重新盤點的外貌能力、美容商品、玩家圖示、個人檔案與 C 聯賽來源](appearance-source-audit.md)。只列有原始資料或實際執行分支的功能；單憑商品名稱、備註或未解析欄位，不建立新增功能任務。

**新增逐函式證據**：[職業、獨立教室、學校／健身房資料邊界、真實個人檔案來源盤點](phase30-jobs-training-profile-audit.md)，明確區分可執行 CGI、靜態原始資料與 Web 自行補出的流程。

### 02 能量與工作

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| WK-01 能量上限及自然恢復 | town_ini.cgi；game.cgi；basic.cgi | src/engine.mjs；src/server.mjs | 部分完成 | Web 有上限與恢復；需核對所有轉職／體格事件的加扣條件 | P1 | 上下限、十秒刻度、快轉／多角色隔離（31） |
| WK-02 工作薪資、經驗、冷卻 | dat_dir/job.cgi；basic.cgi::do_work L2838–2961 | src/engine.mjs::performWork；src/server.mjs::/api/work、/api/job/payment；src/banking.mjs；public/app.js | **核心已修（PR #24／#28／#29），待玩家實機驗收** | 出勤依職業發薪週期累積；薪資及升級獎金可依已保存偏好入現金或普通存款，銀行記帳；UI 顯示本週期出勤與精通進度，工作快捷只開分頁。WK-06 入職限定性別／身高誤套工作已於第48階段修正；新版 Web 存檔與瀏覽器仍待核實 | P1（驗收） | 週期發薪 1／5／10 次、角色資料／工作回應、收款順序、銀行帳簿、真實玩家環境（後續） |
| WK-03 飢餓／疾病修正工作 | top.pl L258-L273；basic.cgi | src/dining.mjs L82-L103；src/health.mjs | 部分完成 | 未用餐玩家以 provisional 5 經驗預設；非原版完整懲罰 | P1 | 新角色尚無用餐紀錄、重症、狀態六級實測（31） |
| WK-04 職業需求數值表及現有能力對照 | basic.cgi::job_change L2751–L2781；job.cgi::top L18–L29；dat_dir/job.cgi | src/engine.mjs::parseLegacyJobs；src/server.mjs::snapshot jobs；public/app.js::jobRequirementsPanel／renderJobs | **核心修復（PR #22），顯示精簡（PR #29），待瀏覽器驗收** | 伺服器仍提供完整 17 項原始能力與資格判定；UI 依使用者要求**只顯示需求 > 0 的能力門檻**，其他 BMI／身高／性別／前置精通有條件才顯示；不再列出一堆 0 或強制顯示當前能力值 | P1（驗收） | 150 筆職業條件、375／768px／桌面真實操作、轉職拒絕與原始數值對照 |
| WK-05 薪資與獎金領取方式 | basic.cgi::do_work L2920–2953、L2974–2998；town_maker.cgi L142–146 | src/engine.mjs::performWork；src/server.mjs::/api/job/payment、/api/work；src/banking.mjs::recordBankEntry；public/app.js | **核心缺漏已修復（PR #24），新角色偏好由 Web 保存** | 可選現金／普通存款；實際工作薪資與升級獎金按偏好分流，銀行帳簿分筆、SQLite 交易回滾；新 Web 角色領薪方式預設 cash，之後以本人選擇為準 | P1（Web 存檔／驗收） | 已有 engine、HTTP/SQLite、UI 測試；待新版 Web 領款偏好重啟、極端金額及瀏覽器驗收 |
| WK-06 任職後工作再檢查條件 | basic.cgi::job_change L2695–2719；do_work L2867–2879 | src/engine.mjs::eligibility／performWork；tests/engine.test.mjs／server.test.mjs | **第48階段已修工作重驗差異，待新 Web 角色與瀏覽器驗收** | 原版選職時檢查性別／身高，工作時仍查能力／BMI／能量／冷卻而不重驗性別／身高；Web 現已分離兩階段限制，保留轉職門檻與出勤其餘條件 | P1（驗收） | 真實原版職業警官在 HTTP 轉職後身高下降，重選拒絕但正式工作成功；引擎涵蓋性別變更、BMI、能量及冷卻。見 [第48階段驗收](phase48-core-gameplay-restart.md) |
| WK-07 工作工廠職業投稿／清單 | unit.pl L69；job.cgi::top L13–74；job.cgi::make L80–87；log_dir/joblog.cgi | Web 只載入 dat_dir/job.cgi 正式職業 | **確定缺漏** | 原版允許提交候選職業到 joblog，並顯示投稿條件；不是直接加入正式職業表；此 fork joblog 0 bytes | P2 | 投稿欄位、權限、審核邊界、顯示與真實投稿樣本（後續） |

### 03 學校／健身房／教室

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| TR-01 學校原始課程與使用說明 | dat_dir/school.cgi（課程資料）；manual.html L149–150（一天一堂） | src/training.mjs::parseLegacySchool、performTraining | 部分完成（按資料與說明實作） | 原版此 fork 根目錄沒有可執行 school.cgi；有資料和使用說明，無法對照原版實際付款、增益、時鐘執行 CGI | P1（來源邊界） | 逐課比對數值；明示未能核對的原始實際操作條件，不把 Web 行為說成已證實等價 |
| TR-02 學校每日一次 | manual.html L149–150；dat_dir/school.cgi | src/training.mjs L75–106 | 部分完成（依原版說明） | 每天一次有原始說明依據；跨日、切課、伺服器時區仍需驗證，原版 fork 無獨立 school.cgi 程式可比對 | P1 | 跨日、重啟、同時請求及兩模式隔離（31） |
| TR-03 健身房課程資料與原版執行來源 | dat_dir/gym.cgi（9 筆課程）；town_lib.pl::gym_sprit；manual.html L145–146 | src/training.mjs::parseLegacyGym、performTraining | 部分完成（根據資料運作） | 本 fork 根目錄無可執行 gym.cgi；Web 暫把「間」作分鐘；不能將另一設施 kyushitu.cgi 的減重、信用付款等同健身房的原版效果 | P1（來源邊界） | 欄位、增益、費用、冷卻回歸；找不到實際 gym CGI 時不宣稱完整等價 |
| TR-04 教室獨立訓練設施 | unit.pl L152；kyushitu.cgi::kyushitu／kyushitu_go L30–175；dat_dir/kyushitu.cgi（4 筆） | src/training.mjs::parseLegacyClassroom／performTraining；src/server.mjs::/api/train；public/index.html::classroom-panel | **四課及兩種付款路徑已實作（PR #23／#27），待驗收** | 四課、17 項能力增益、雙能量、減重、分鐘間隔與獨立冷卻；現金或本人有效原版格式信用卡付款，未實作購卡商店 | P1 | 原始課程與付款測試、新 Web 角色操作及瀏覽器驗收 |
| TR-05 教室訓練減重 | kyushitu.cgi::kyushitu_go L121–143 | src/training.mjs::performTraining（type=classroom）、src/engine.mjs::bodyMassIndex | **原版核心公式已實作（PR #23）** | 減重 (身體消耗+頭腦消耗)/100 公斤、更新 BMI；Web 為安全設最低 1kg，和原版沒有下限不同；不挪用到健身房 | P1（驗收） | 四課消耗、連續操作、Web 存檔、極端低體重與 BMI 回歸 |
| TR-06 教室信用物品付款 | kyushitu.cgi L68–84、L108–118；dat_dir/syouhin.cgi L366–369 四種信用卡 | src/legacy-credit.mjs；src/training.mjs；src/server.mjs::/api/train；public/app.js | **本人有效原版格式信用卡付款已修復（PR #27，新 Web 購卡流程待核對）** | 本人持有的 33 欄原版格式卡片須符合效果、日耐久與購入日且尚未到期；銀行足額才可入課，教室付款在同筆 SQLite 交易扣普通存款並記帳。沒有原始卡片就不可憑空刷卡。原版購卡商店仍未移植 | P1（部分完成） | 有效／過期／偽造／跨玩家／銀行不足／重複請求測試通過；新 Web 存檔與瀏覽器驗收待完成 |

### 04 飲食／熱量

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| FD-01 原版雙菜單與售價三倍 | dat_dir/syouhin.cgi；dat_dir/syokudou2.cgi；command.pl::syokudou／syokudou2 | src/dining.mjs::parseLegacyMeals；src/dining-stock.mjs；src/server.mjs::snapshot／api/meal/eat | **雙食堂與每日菜單核心已移植（PR #31），待實機驗收** | 原版兩食品來源、三倍售價、各最多 30 道抽選及原始庫存量已接入 Web；原版全局 log 與城市 flag 的差異見 FD-03 | P1（驗收） | 食品來源欄、售價、份數、舊玩家與實際操作 |
| FD-02 用餐 60 分鐘與熱量增重 | town_ini.cgi L73；command.pl L1330-L1355 | src/dining.mjs L52-L69,L105-L125 | 已完成（核心公式） | 原版可能涉及不同菜單的共用時段；需測試跨菜單防重 | P1 | 60 分鐘臨界、熱量÷1000、多模式同時請求（31） |
| FD-03 每日隨機菜單與剩餘數量 | command.pl L920–1082、L1162–1324；syokuzisuru L1086–1159、syokuzisuru2；town_ini.cgi L84–88；town_maker.cgi L354–360 | src/dining-stock.mjs；src/server.mjs::snapshot／api/meal/eat；public/app.js／index.html | **每日抽選、共用庫存及原子扣庫存已修復（PR #31），待實機驗收** | 兩家每日各抽最多 30，道具資料第 25 欄為庫存；跨日或有庫存品項 <=25 時補貨；後端拒絕未上架／售完，UI 顯示日期／剩餘量。原版補貨判斷混入個人現金（且顯示端有額外價格乘算），Web 只依實際庫存判斷避免任意低現金玩家造成重整；原版共享 syokudoulog 與各城 flag 的關係仍待真實地圖驗證 | P1（已修／待驗收） | 單元／單機跨日／兩玩家共用／售完不扣款／SQLite 回滾已測；仍需實機及原版備份驗收 |
| FD-04 飢餓分類與新 Web 角色保護 | top.pl L258-L273；town_ini.cgi L71-L73 | src/dining.mjs L52-L68,L82-L103 | 部分完成 | 原版 3000 日刪角規則與 Web 保護不一致；不可直接破壞存檔 | P1 | 標記保留差異，設計新版 Web 資料更新安全與玩家告知（後續） |

### 05 地圖／交通

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| MP-01 四城 12×16 格與圖示 | top.pl；admin2.cgi；town_ini.cgi | src/town-map.mjs；public/town-home.js | 部分完成 | 格子和圖示有實作；原始填充街區資料需另查 | P1 | 每城尺寸、已知／未知符號、原始文件反查（31） |
| MP-02 原版 townlog 匯入／地圖編輯 | log_dir/townlog0.cgi ～ townlog3.cgi；town_maker.cgi | src/town-storage.mjs；src/solo-starter-town.mjs；scripts/town-map.mjs | **原版世界佈局原始檔皆為空，單機改用明示的 Web 試玩街區** | 這個 fork 四份原始 townlog 檔皆為 0 byte，無原版真實街區可還原；第50階段 [單機優先與空白街區稽核](phase50-solo-first-play-audit.md) 新增需玩家自行確認、只建立在空白且無住宅的城鎮之 Web 試玩布局，與原版真實地圖分開，不覆蓋任何已有配置 | P0（單機首次遊玩） | 空白原始地圖與新版 Web 配置 round-trip、本人同城試玩初始化與拒覆蓋、住宅／購物與重啟、真實瀏覽器驗收（後續） |
| MP-03 車站／交通票券與跨城成本 | station.cgi；town_ini.cgi；商品檔 | src/transport.mjs；src/server.mjs::/api/move；public/app.js；public/town-home.js | **基本車站收費已移植（PR #26），其他交通票券待驗證** | 四城六組票價與跨城扣現金已實作；實際原版其他交通券／道具是否有獨立效果仍需追來源 | P1（部分完成） | 12 種方向、同城／欠費／多人隔離已測；新 Web 存檔與瀏覽器驗收待完成 |
| MP-04 車站六組票價及跨城移動 | unit.pl L85；station.cgi::idou L99–116、L135–169 | src/transport.mjs；src/server.mjs::/api/move；public/app.js／town-home.js | **原版票價與地圖入口已修復（PR #26）** | 6 組雙向票價 950／780／1210／950／2210／1530 均會扣現金；拒絕同城、非法目的地與餘額不足；原版 5 秒僅前端倒數，未虛構伺服器冷卻 | P1（實機驗收） | 12 方向、SQLite 原子交易／失敗回滾與兩玩家隔離已測 |
| MP-06 原版公路旅行與寶箱／百貨載具的交通功能 | town_ini.cgi::%idou_syudan／$matiidou_time／$ziko_kakuritu；town_lib.pl::header::mati_idou／mati_idou2；town_maker.cgi::login_view 事故耐久 | [road-travel.mjs](../src/road-travel.mjs)；POST /api/road/start、/api/road/arrive；public/app.js::renderRoadTravel | **第62階段完成公路載具／事故；第63階段已新增原版1/5迷路、持有輪滑車必迷路及事故後四城改道，第64階段已新增原版500元、5秒、無事故／迷路的巴士；第65階段核對百貨5種非專門店載具；第66階段修正來源理解偏差，擴充到百貨直接購入的11種乗り物與7種ギフト交通商品（含六筆専門店備註車）** | 原版20種載具移動秒數、徒步10秒、徒步／腳踏車5種能力獨立1～15抽數、非徒步1/10事故令原版33欄載具耐久−1。Web允許本人真正從第61階段原版獎池取得、不可變33欄一致的寶箱來源載具；第65階段另接受dat_dir/syouhin.cgi行號332、333、334、337、338的五種百貨非專門店車，要求本人retail_purchases流水、原SKU、原名與33欄一致，第66階段核對兩間百貨實際可上架的原始18筆商品，11筆乗り物與7筆ギフト皆可持本人真實百貨收據上路；原版専門店限定商品備註只在スーパー問屋進貨分支有阻擋，並非百貨交通禁令；禮品屋轉換與跨玩家受贈__web_gift__仍須完整持久來源鏈核實才可上路；無序Perl Hash自動選車改為手動選車，事故耐久改在出發原子扣，行程兩階段SQLite跨重啟保存且未到時間不准抵達；旅行中禁止電車與再次出發。第63階段核對原版：從編號3城出發不迷路，其他城持有ローラースルーゴーゴー必迷路，否則1/5；迷路但無事故時CGI有rand(4)卻未覆寫town_no，仍按原定目的地到站；迷路且事故才隨機四城改寫實際抵達地。Web新舊行程無損SQLite遷移、本人requestId防重送、未抵達不提前公開迷路或事故／改道；到站才顯示原定與實際地點。第64階段巴士扣現金500元、5秒到站，跳過事故／迷路／鍛鍊，與其他公路共用SQLite交易、重送及旅行互斥，舊旅程的巴士標記和車資預設0；原版沒檢查餘額，Web為避免負現金而拒絕不足500元的出發。詳 [第62階段](phase62-road-travel.md)、[第63階段](phase63-road-lost.md)、[第64階段](phase64-road-bus.md)、[第65階段](phase65-retail-road-vehicles.md)、[第66階段](phase66-road-retail-source-audit.md) | P1（單機） | 桌面／手機實機驗收、禮品屋轉換／跨玩家受贈交通商品來源鏈及Perl其他行動互斥規則待核對 |
| MP-05 原版地圖互動入口覆蓋率 | unit.pl::get_unit L62–191（43 個表單入口）；top.pl L472–490 | src/town-map.mjs::MAP_SYMBOLS；public/town-home.js::FACILITY_PANELS／station | **入口清冊已核對；各設施未全部盤點／移植** | 43 個原版互動入口的現行代碼／可操作狀態依 [入口盤點](phase30-entrypoint-coverage.md) 為準；原始統計在第31～51階段後已過時。原版 gamerand.cgi 等入口內還有多個未逐函式盤點的子 CGI。詳 [入口表](phase30-entrypoint-coverage.md) 與 [新增待辦總清冊](phase30-open-audit-backlog.md) | P1 | 按來源逐原版執行路徑、交易、真實街區存檔、瀏覽器驗收 |

### 06 住宅／進階設施

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| HS-01 建屋／賣屋／改裝 | town_ini.cgi；original_house.cgi | src/housing.mjs；tests/housing.test.mjs | 部分完成 | 基礎住宅有功能；全部特殊地形與交易規則未逐檔覆核 | P1 | 同格競態、現金／銀行、售後還原、回滾（31） |
| HS-02 室內公告／留言與訪客權限 | original_house.cgi；command.pl L214-L218 | src/rooms.mjs；tests/rooms.test.mjs | 部分完成 | 主流程存在；Web 住宅關聯資料的存檔持續性尚需驗證 | P1 | 屋主、訪客、出售搬家保留、越權拒絕（31） |
| HS-03 商店／企業／分店／特殊住宅 | command.pl；kaishiya.pl；hanbai.cgi；original_house.cgi | 尚無完整 Web 對應模組 | 未實作 | 依賴商品市場、玩家間交易、房屋存檔、經濟模型 | P2 | 先盤點各種設施使用條件與原版 CGI 的資料欄位，分 PR 建立（後續） |
| HS-04 企業員工教育／員工紀錄 | original_house.cgi L21、L1586 → unei_2.pl::unei_2；member/<ID>/<slot>_log.cgi | 無 Web 企業員工訓練／名冊模型 | **確定缺漏（由住宅實際呼叫）** | 原版可增員工、花費自身能力訓練員工、限制名額與間隔，含現金/信用分支；和普通住宅房間留言不同；原版部分付款及可達性須再核實 | P2（企業／資料相依） | 住宅入口、slot 與員工資料格式、Web 存檔、能力扣除/付款驗證、防重及多人隔離 |

### 07 銀行／資產

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| BK-01 普通與定存、計息與帳簿 | parabank.cgi；相關銀行 CGI 待逐函式核對 | src/banking.mjs；tests/banking.test.mjs | 部分完成 | 利率已有 Web 規則，計息觸發時點與原版不完全同等 | P1 | 連續跨日、停機、重入、金額上限、交易明細（31） |
| BK-02 玩家轉帳與額度 | parabank.cgi；原始角色資料 | src/banking.mjs；src/server.mjs | 部分完成 | 身份校驗與原子交易已載明；需逐項反查原始限制 | P1 | 七天限制、收款人每日上限、防重／異常回滾（31） |
| BK-03 住宅貸款及每日還款 | parabank.cgi；原始銀行相關 CGI | src/banking.mjs；tests/loans.test.mjs | 部分完成 | 負餘額與違約模式保留 Web 差異；無法稱為等價 | P1 | 貸款上限、逾期、全額清償、遷移與備份（31） |
| BK-04 原版定期徵稅 | town_ini.cgi L40–41；town_maker.cgi::login_view L184–263；town_lib.pl::kozin_sprit（k_sousisan/kpoint） | src/server.mjs 沒有原版徵稅與全資產欄位對應 | **確定缺漏（來源更正）** | 原版指定星期／日期跨日後按全資產 0/1/3/5/7% 階梯徵稅，K 點折扣，普通銀行扣款並記帳；舊清冊誤引 yakuba.cgi（其實是排行榜）。Web 尚未還原稅基，不能隨意以現金/銀行近似，也不照搬負存款 | P2（資產相依） | 逐欄校正 k_sousisan、跨日/指定日、K 點階梯、存款/帳簿、防重/失敗回滾及新 Web 存檔；先完成資產來源再實作 |
| BK-05 原版 A～E 股票市場及持股紀錄 | unit.pl L132；kabu.cgi::kabu L36–108；log_dir/kab_hendou.cgi；member/<ID> 相關股票檔 | src/banking.mjs 只有銀行／貸款模組，無股價交易 | **確定缺漏** | 原版有獨立五類股價、持股、交易與清算記錄；不可因 Web 已有銀行而算股票已移植 | P2 | 檢查原始行情更新、買賣、每人持股、交易限制與新 Web 持股存檔後再實作 |

### 08 物品／商店／裝備

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| IT-01 原版 33 欄商品格式與 Web 背包 | dat_dir/syouhin.cgi；原版 item_do | src/legacy-inventory.mjs；src/legacy-item-use.mjs | 部分完成（商品效果） | Web 新商品使用原版 33 欄與已核實作用，不需舊玩家持有物匯入 | P1（單機） | 真實 Web 購物、堆疊、耐久與存檔測試 |
| IT-02 可確認消耗品／耐久 | basic.cgi L2556-L2579；dat_dir/syouhin.cgi | src/legacy-item-use.mjs；tests/legacy-item-use.test.mjs | 部分完成 | 只支援部分已封存物品效果，回／日與其他道具尚需逐項核對 | P0 | 體格、疾病、冷卻、失效、幂等與安全範圍（30-體格） |
| IT-03 百貨店一／二、販賣機、裝備／禮品／回收 | unit.pl L130–148；command.pl::depart_gamen/buy_syouhin；hanbai.cgi；gifutoya.cgi；recycle.cgi | src/retail.mjs；src/server.mjs::/api/retail/buy；public/app.js::renderRetail；legacy_inventory_items | **百貨店一／二單件現金購物已實作，待瀏覽器驗收；其他建築缺漏** | 兩店依原始 33 欄每日各最多 110 非食商品、三倍售價、共用貨架／庫存、25 格、本人入庫／防重 SQLite 交易；多件、原作堆疊、信用付款、同城回饋與各別商店流程未完成 | P1（建築優先） | 每個有實體地圖建築的交易分別比對來源、舊存檔、多人併發、跨日及實機；先完善百貨規則，再自販機、裝備／禮品、回收與批發 |
| IT-04 優惠券獲得與兌換 | coupon.cgi::coupon/coupon_do；dat_dir/coupon.cgi；event.pl #30/#35 | events.mjs 的 Web 新角色券、coupon-redemption.mjs 的 30 件原版獎品兌換 | **Web 事件券兌換已實作；獎品其他玩法待補** | 新 Web 角色只從 character_coupons 扣點並取得 33 欄商品；不轉入舊 CGI 玩家券；獎品其他使用流程仍未全實作 | P1（單機） | 道具用途、交易原子性、存檔與瀏覽器驗收 |
| IT-05 原版釣魚與漁獲出售 | unit.pl L77、L146；sea.cgi::turu/seri；hanbai1.cgi 與原版餌料商品 | [src/fishing.mjs](../src/fishing.mjs)、公開釣魚面板、三支正式釣魚 API | **第53階段單機核心可操作** | 原版4款餌料原價與庫存、13種魚餌對應、4級別×3種實際可抽魚獲、每次耗餌與100秒冷卻、本人33欄魚獲入庫與12種原版售價區間、25格與5份上限，全部以SQLite原子交易扣款／扣餌／出售；詳 [第53階段](phase53-fishing-economy.md) | P1（單機） | Web庫存每日刷新與原版01時旗標差異、更多跨店堆疊與新版Web存檔／實機驗收 |
| IT-06 原版拍賣場刊登與結算 | unit.pl L189；auction.cgi::auction L49–72、::syupin、::syupin_do、::ukewatashi | Web 無該拍賣／結算流程 | **確定缺漏** | 原版使用獨立拍賣紀錄與刊登、交付分支；不同於普通商店／回收 | P2 | 物品所有權、有效期、競價、交付與多人交易競態 |
| IT-07 原版合成屋 | unit.pl L187；gouseiya.cgi::gousei/gousei_do；dat_dir/gousei.cgi | [src/crafting.mjs](../src/crafting.mjs)、地圖合成面板、POST /api/crafting/make | **第54階段新 Web 單機核心可操作，待 CI 與實機驗收** | 原始12種、2～3種材料配方及33欄成品；本人多筆材料扣耐久、零手續費、25格／同品5份限制、SQLite原子交易、防重送與失敗回滾；原版アイスクリーム多餘冒號採原始Perl解析語義，原始檔不改；詳 [第54階段](phase54-crafting-house.md) | P1（單機） | 新 Web SQLite存檔重啟、多人隔離、原版全域行動限制差異、瀏覽器／手機操作 |

### 09 隨機與限時事件：全部 #01～#44 獨立列示

**可達性：** `event.pl` 在 L314 以 `int(rand(44))+1` 抽 #01～#44；原始碼雖有 #45（L855）及 #46（L860），但在這個抽選入口不可達，另列為「原版存在、預設不可抽」，**不得自行更改為 46 個事件**。

**Web 觀察：** `src/event-effects.mjs::NON_ITEM_EVENT_IDS` 有 37 個非疾病分支；`src/events.mjs::ILLNESS_EVENTS` 有 #04、#15，共 39/44 個程式分支。#34（PR #10）、#35（PR #9）已合併整合分支。「程式已有」只表示分支存在，不代表原作全部細節與實際 UI 已驗收。

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
| #34 | 聖誕人偶：現金翻倍／雙能量恢復／蟑螂 20 秒 | [event.pl L689](../../event.pl#L689) | `src/event-effects.mjs::case 34`; tests/event-santa.test.mjs | 程式已合併整合分支（PR #10） | 仍須實際驗收限時事件、回耐久與重送 |
| #35 | 四次元福袋：四分支、扣回數 | [event.pl L710](../../event.pl#L710) | `src/event-effects.mjs::case 35`; tests/event-bag.test.mjs | 程式已合併整合分支（PR #9） | 仍須驗收四種結果、券數、耐久及無結果分支 |
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

### 10 醫療／保險

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| HL-01 疾病指數、症狀、工作限制 | basic.cgi；原版疾病相關分支 | src/health.mjs；tests/health.test.mjs | 部分完成 | 病症與工作停工已有規則；需逐病例覆核原始門檻 | P1 | 各門檻、跨日、處理順序、能量交互（31） |
| HL-02 醫院治療與原始保險 | 原始健康保險商品與醫院 CGI | src/health.mjs；src/inventory.mjs；tests/inventory.test.mjs | 部分完成 | 30 天有效期、折扣已載明；舊道具與有效期基準仍有差異 | P1 | 有效／過期、批量購買、醫院扣費、資料隔離（31） |

### 11 社交／婚戀／育兒／戰鬥

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| SC-01 私訊與玩家互動 | bbs.cgi；tag.cgi；log_dir/aisatulog.cgi | 尚無完整 Web 對應 | 未實作 | 先確認各 CGI 的權限與儲存格式 | P2 | 收發、跨帳號授權、Web 訊息紀錄、刪除與清理（後續） |
| SC-02 戀愛／婚姻／同居／育兒 | dat_dir/love.cgi；kekkon.cgi；log_dir/couplelog.cgi；log_dir/kodomolog.cgi | 尚無完整 Web 對應 | 未實作 | 依賴角色關聯檔、多人帳號及安全同步 | P2 | 原始關係狀態／事件、隱私及回滾（後續） |
| SC-03 B 聯賽決鬥／裝備／獎賞 | unit.pl L73；battle.cgi::bbin/bb；dat_dir/battle.cgi | 尚無完整 Web 對應 | 未實作 | 原版 battle.cgi 有對戰與結算；atakka.cgi 是 0 位元組資料檔，town_lib.pl::atakka 讀寫防濫用紀錄，**不是戰鬥 CGI**；裝備與其他 C 聯賽須分別來源核對 | P2 | 傷害/掉落/冷卻及道具歸屬，和 C 聯賽、弱／強おばちゃん挑戰分開、跨帳號與重送（後續） |
| SC-04 真實個人檔案自願登記／修改 | basic.cgi::prof L1690–1717、prof_form L1995–2105；town_ini.cgi L148–179 | 尚無 Web 個人檔案資料模型或表單 | **確定缺漏** | 原版為玩家主動填寫的真實公開資料（性別／年齡／地址、5 組選項、15 題自由填寫），不是遊戲 looks／BMI | P2（個資） | 自願公開、欄位選項、修改、遮蔽、權限及防止角色數值自動曝光 |
| SC-05 個人檔案搜尋／分頁／傳訊入口 | basic.cgi::prof L1738–1991；town_ini.cgi L145–146 | 尚無 Web 公開檔案搜尋 UI | **確定缺漏** | 可依名稱、性別、年齡、住所與五選項查詢，每頁 10 筆並有傳訊入口 | P2（個資） | 真正查詢條件、分頁、可見性、訊息收件者權限與資料安全 |
| SC-06 原版問卷建立、投票及管理 | unit.pl L83；enq.cgi::top/make/setup/add/write/delete；enq.cgi L417–426 | Web 無獨立問卷投票系統 | **確定缺漏** | 原版有建立問卷、選項、投票與管理分支，不等於登入畫面的事件通知或隨機事件 | P2 | 建立與管理權限、投票防重、選項數、期限、個人資料隔離 |
| SC-07 原版玩家投稿事件 | unit.pl L79；event.cgi::form/save L21–103；log_dir/eventlog.cgi | Web 隨機事件模組是 event.pl 的抽選；無 event.cgi 投稿流程 | **確定缺漏** | event.cgi 會寫玩家投稿文字、能力與金錢等欄，**不能混成 event.pl #01～#44 已移植**；投稿不是自動加入隨機事件表 | P2 | 欄位、內容驗證、發表權限、審核與來源檔資料分離 |
| SC-08 原版遊樂中心各種遊戲入口 | unit.pl L120；gamerand.cgi → donut.cgi、loto.cgi、loto6.cgi、fukubiki.cgi、saikoro.cgi、cardw2.cgi、otakara.cgi | [arcade-dice.mjs](../src/arcade-dice.mjs)、[arcade-highlow.mjs](../src/arcade-highlow.mjs)、[arcade-donuts.mjs](../src/arcade-donuts.mjs)、[arcade-loto.mjs](../src/arcade-loto.mjs)、[arcade-loto6.mjs](../src/arcade-loto6.mjs)、[arcade-cardw.mjs](../src/arcade-cardw.mjs)、[arcade-treasure.mjs](../src/arcade-treasure.mjs)；新增 POST /api/arcade/treasure/open | **第55～60階段雙骰、四卡牌、兩種樂透與多卡，加上第61階段四種寶箱均接入真實交易；仍有部分物品後續使用及已過期福引未做** | 第61階段 otakara.cgi 四箱銅500、銀1000、金2500000、特殊500000元，來源 dat_dir/otakara.cgi 共110筆原始33欄獎品；原始 int(rand($#array)) 排除末項，因此實際可抽33／34／38／109筆。依原始效果欄立即增加能力／改疾病／獎品標價發現金（如金塊）或寫入本人33欄物品，5分鐘本人間隔，25格一般背包及五份堆疊上限。Web原子扣款與獎品實效、請求碼防重及本人的20筆歷史；不假裝所有持有物的後續特殊用途都已完整支援。詳 [第61階段](phase61-treasure-chests.md) | P1（單機） | 福引原活動已於2010年到期，除非另有需求不擅自續辦；寶箱交通工具、特殊魔法等後續使用仍待逐項核對；桌面／手機實機驗收仍待辦 |
| GM-02 原版競馬 | unit.pl L162；basic.cgi::keiba L530–851 | Web 地圖有競馬圖示，但沒有賽馬下注/結果 API | **確定缺漏** | 原版馬券 500 円/張、最多押兩匹，有限額、賠率、賽事鎖及排行榜；不能自行創造勝率或讓瀏覽器決定結果 | P2 | 逐分支核實原始賠率/鎖/名額、經濟交易及多人同步，拒絕重送 |
| GM-03 弱／強おばちゃん挑戰 | unit.pl L116–118；gamerand.cgi L206–222；obatyan.cgi::week/strong/battle L16–37 | Web 無兩難度戰鬥與掉落 | **確定缺漏** | 原版從地圖/遊樂中心皆可進，與 B 聯賽不同；裝備與獎品須追持有檔 | P2 | 難度/能量/掉落/商品 33 欄/冷卻/多人交易 |
| SC-09 原版隱藏口令獎勵 | unit.pl L65；prezent2.cgi::top/get L18–79；log_dir/prezent2.cgi | Web 無原版活動兌換或已領記錄 | **原版有程式，活動可否開放未驗證** | 原始程式需隱藏口令且每人一次，先領五人與其他玩家獎勵不同；不能從原版片段自動重啟活動或公布口令 | P2（活動確認） | 原站活動/口令安全、權限、同時領取與回滾、K 點及真實 log |

### 12 帳號／角色／安全

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| AC-01 單人／多人角色與登入 | game.cgi；town_lib.pl | src/server.mjs；src/solo-character.mjs；tests/server.test.mjs | 部分完成 | HTTP-only、scrypt、帳號隔離已存在；部署安全審查未完成 | P0 | solo/multi 不互通、跨帳號拒絕、登出與 session 失效（30/31） |
| AC-02 單人刪角／繼續遊戲 | 原版角色保存／刪除行為待逐檔確認 | src/solo-character.mjs；public/app.js | 部分完成 | Web 擴充確認流程，非原版全世界重置 | P1 | 取消/誤名/交易失敗、不刪地圖與時鐘（31） |
| AC-03 公開部署／管理權限／速率限制 | admin.cgi；admin2.cgi；unei.pl | src/server.mjs；README 安全限制 | 部分完成 | 未有完整登入速率限制及公開部署審查；不宜公開直接部署 | P0 | 威脅模型、權限矩陣、網路與備份演練（後續） |
| AC-04 原版個人設定及備忘錄／朋友清單／死亡通知 | town_maker.cgi L647–649；setup.cgi::setup/change/friend/memo/die L19–23、L31–68、L334–354 | Web 有獨立 solo 刪角及帳號登入，沒有等價的完整原版設定資料模型 | **確定功能缺口／部分重疊** | 原版備忘錄可保存、好友清單和字體／音效設定可編輯；死亡通知含密碼及原始關聯檔處理，不能用 Web solo 刪角代稱完成 | P2 | 自願刪除及密碼驗證、個人檔案、保留關聯、其他設定／多人權限與回滾 |

### 13 Web 存檔／資料庫

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| DB-01 舊 CGI 角色匯入 | 原版 `town_lib.pl::kozin_sprit` 只作玩法來源 | 早期匯入器屬歷史實作 | **排除專案範圍** | 不移轉舊玩家角色、密碼或 69 欄存檔 | — | 不列待辦；保護新 Web 角色進度 |
| DB-02 舊 CGI 物品匯入 | 原版 33 欄商品格式只作玩法來源 | Web 新購物品仍保留 33 欄 | **排除舊玩家匯入** | 不轉入任何舊玩家持有物 | — | 驗新 Web 商品、消耗、上限及存檔 |
| DB-03 舊 CGI 住宅／銀行歷史匯入 | 原版住宅及銀行 CGI | Web 住宅、銀行獨立建立資料 | **排除專案範圍** | 不轉入原始私人住宅或帳簿 | — | 驗新版 Web 住宅、銀行及交易資料持續性 |
| DB-04 SQLite 遷移／還原 | 原始多檔保存規則 | src/server.mjs；web/data/（不納入版控） | 部分完成 | 已自動加欄；沒有自動逆遷移，須先備份 | P0 | 破壞性 schema 變更前先做 transaction 與 restore 測試（30/31） |
| DB-05 Web 自建個人檔案與職業投稿 | basic.cgi::prof；job.cgi::make | Web 尚缺完整建立／投稿功能 | **玩法未實作** | 讓新玩家自行填寫，不匯入既有玩家資料 | P2 | 新 Web 資料結構、授權與隱私測試 |

### 14 UI／相容／營運

| ID／功能 | 原版來源 | Web 現況／來源 | 判定 | 差異／相依 | 優先度 | 驗收／切片 |
|---|---|---|---|---|---|---|
| UI-01 三欄位狀態切換與原始資訊 | town_maker.cgi::loged_gamen；top.pl | public/index.html L176-L202；public/app.js | 部分完成 | 有 ARIA tab 與原版分頁；實機 375px/768px/桌機驗收缺少 | P0 | 狀態體格、物品、能力切換不丟資料、鍵盤導覽（30/31） |
| UI-02 事件通知及 20 秒挑戰 | top.pl；event.pl L290-L305 | public/app.js；src/event-cockroach.mjs | 部分完成 | 程式顯示與 API 存在；真實操作與動態尺寸未驗證 | P1 | 模擬快轉阻擋、失效、跨帳號、視覺遮蔽（31） |
| UI-03 地圖、餐點與手機 RWD | top.pl；town_maker.cgi；command.pl | public/style.css；public/index.html；public/app.js | 部分完成 | UI 結構已有改善；尚無 Chrome/Safari 實際截圖 | P1 | 手機與桌面流程、捲動固定條、讀屏／鍵盤（31） |
| UI-04 部署／監控／備份 | 原始 CGI 運行環境；README | web/package.json；.github/workflows/town-web.yml | 部分完成 | CI 有測試；尚無正式營運安全／備份定期還原驗證 | P2 | 部署檢查、日誌、備份和恢復演練（後續） |
| UI-05 地圖教室獨立入口 | unit.pl L152：教室→kyushitu.cgi；dat_dir/kyushitu.cgi 四課 | public/town-home.js::FACILITY_PANELS["教室"]="classroom-panel"；public/index.html::classroom-panel | **已修正錯誤導覽（PR #23）** | 地圖教室不再誤導至學校；已與獨立教室資料及訓練連動 | P1（驗收） | home-ui.test.mjs 及 server／training 測試已涵蓋，待手機與桌面實際操作 |

**實際修復進度（2026-11-20）**：PR #22 職業需求、#23 教室四課與導覽、#24 薪資收款、#26 車站六組票價、#27 有效原版格式信用卡付款、#28 發薪進度與偏好時序、#29 教室快轉冷卻／職業門檻精簡／精通進度／工作快捷均已合併。PR #31 已接入原版每日食堂菜單、共用庫存及點餐交易；尚未完成原版購卡商店、缺少五個事件、問卷、投稿、股票、拍賣及完整遊樂中心玩法（第53階段釣魚核心已新增）；詳 [總清冊](phase30-open-audit-backlog.md)。**CI 成功不等於玩家實機與新版 Web 存檔驗收完成；不以盤點文件替代實作**。

## 第一輪重大發現與應先修項

**新增跨領域重大缺口（逐原版入口核對）**：`unit.pl` 定義 43 個互動入口；Web 地圖只認得其中 28 個，已有 7 個對應面板且教室入口已修正（PR #23）；原版車站六組票價已於 PR #26 實作；釣魚在第53階段已完成核心交易。問卷、活動投稿、股票、拍賣、遊樂中心及設定仍另有來源待實作。詳 [逐入口查核](phase30-entrypoint-coverage.md)；**已核實入口不代表每個遊戲執行函式已檢查完畢**。

1. **P0/體格 BMI 判定口徑（PR #12 已修正，P0-D 補半分界）**：`town_lib.pl::check_BMI` 使用 `int(weight/(height/100)^2)`；原版 `basic.cgi` 的職業門檻使用此整數。PR #12 已讓 Web 的 `eligibility` 即時運算整數 BMI，不再用舊的 `character.bmi` 一位小數值；P0-D 進一步修補 Perl `sprintf("%.1f")` 在 17.95／24.95／25.95 的半分界捨入差異。保留原有存檔欄位。
2. **P1/健身房欄位來源**：`dat_dir/gym.cgi` 的能力增益、費用及能量欄位已對照；「間」與「効果」尚需實際執行路徑驗證。未確定的字串只保留原始資料，不視為待移植的新遊戲效果。
3. **P1/職業需求數值表（PR #22 已修復核心展示）**：原版 `basic.cgi::job_change` L2753–2781 明確輸出每個職業的 17 項能力與 BMI、性別、身高、薪資等，並提供玩家當前值對照；`job.cgi::top` 的滑鼠提示也有各項需求。舊 Web 只向前端送簡化 `reason`，PR #22 已補完整原版數值及玩家比較，**並非原版不存在**。實機驗收仍待完成。
4. **P1/食堂每日菜單與庫存（PR #31 核心已修）**：依 `command.pl` L919–999、L1161–1245 及資料第 25 欄，兩間食堂每日各抽最多 30 道，跨玩家共用庫存；原版低現金造成重抽的漏洞沒有複製，待真實瀏覽器／原版全局食堂 log 與城市旗標驗收。
5. **P0/事件分支**：缺 #28、#36、#37、#38、#40；其中 #28、#36、#37 的 `kifu*` 要先追完整實作；#38、#40 需物品產生與背包容量。
6. **P0/展示（PR #13 已合併）**：`public/index.html` 的 `#measurements`、`#physique-status` 已移至狀態分頁常駐體格摘要；`public/app.js` 延用相同資料流。真實瀏覽器截圖和操作驗收仍未完成。
7. **來源警示**：`src/dining.mjs` L66 用 `2995` 日門檻，對應 `town_ini.cgi` 的 `deleteUser=3000` 與原版 `top.pl` 的 `deleteUser - 5`；數字有來源，真正不同是 Web 無用餐紀錄的 provisional 保護與原版刪角機制。

## 第 30 階段 P0-B 體格核心追蹤：BMI 職業判定

- **原版依據**：`basic.cgi::job_change` 與 `basic.cgi::do_work` 會先執行 `$taijuu = sprintf("%.1f",$taijuu)`，接著由 `town_lib.pl::check_BMI` 使用 `int(體重/(身高/100)^2)` 計算整數 BMI；職業上下限為包含邊界。
- **Web 修正範圍（P0-B 開發分支）**：新增 `src/dining.mjs::legacyPhysiqueBmi`，統一 `physiqueStatus`（五種體型）與 `src/engine.mjs::eligibility`（轉職、工作）使用原版公式。保留 `bodyMassIndex` 的一位小數結果作為現有角色存檔欄位，不改表結構或批量覆寫舊存檔；職業判定由身高／體重即時計算，不信任可能陳舊的 `character.bmi`。
- **測試**：`tests/dining.test.mjs` 涵蓋原版體重小數四捨五入前後的 18／24／26 臨界；`tests/engine.test.mjs` 涵蓋超出／剛好符合 BMI 職業上限、最低門檻、無上限、轉職與實際工作、過時存檔 BMI 不影響判定。
- **保留差異／範圍外**：P0-D 補上 Perl `sprintf` 在半分界的實際行為和測試；極端浮點範圍、真正瀏覽器、新版 Web 存檔及其他職業／消耗品細節仍待驗證。
- **狀態**：PR #12 已合併 `feature/web-dual-mode-phase1`，整合 CI 成功；P0-D 修正已透過 PR #14 合併並通過 CI。

## 第 30 階段 P0-C 狀態頁體格摘要（PR #13 已合併）

- **修改**：`public/index.html` 將既有 `#measurements`、`#physique-status` 自「更多角色資訊」的可展開區移到「狀態」分頁常駐的 `physique-summary` 區塊；`public/style.css` 為 290px 側欄增加緊湊樣式。
- **保持不變**：`public/app.js` 仍由現有 snapshot 更新兩個 ID；沒有新 API、SQLite 欄位或互動控制；體格更新來自現行角色身高、體重與原版整數 BMI。
- **驗收**：`tests/home-ui.test.mjs` 靜態驗證摘要位於折疊區外、ID 唯一、渲染路徑不變。**尚未開啟真實瀏覽器做手機 375px、768px、桌面截圖／操作／鍵盤及讀屏測試**，不可聲稱視覺驗收已完成。
- **狀態**：PR #13 已合併整合分支且 CI 通過；`master` 未修改。實機視覺／鍵盤操作仍待驗收。

## 第 30 階段 P0-D：Perl BMI 半分界捨入與來源驗證（PR #14 已合併）

- **來源**：`basic.cgi::job_change`、`do_work` 使用 `sprintf("%.1f",$taijuu)` 後執行 `town_lib.pl::check_BMI`。Node.js `Math.round(weight*10)/10` 不等於原 Perl 對浮點數的格式化。
- **已核對數值**：使用本機 Perl 與 Node.js 對照，`17.95 → 17.9`、`24.95 → 24.9`、`25.95 → 25.9`，而舊 Web `Math.round` 分別得到 18.0、25.0、26.0；精確半分界 `50.25` 在 Perl 得 50.2（取偶）。逐項對照 **0.00～299.99，步進 0.01，共 30,000 筆**，替代捨入方法在此測試範圍內無差異。
- **Web 修正**：`src/dining.mjs::legacyPhysiqueBmi` 改為 `toFixed(1)` 加上精確中點取偶判斷，使五種體型、轉職、實際工作共用；`tests/dining.test.mjs` 和 `tests/engine.test.mjs` 增加回歸。保留 Web 現有一位小數 `character.bmi` 欄位與現存 SQLite 資料，不執行 migration。
- **整合狀態**：PR #14 已合併並通過 GitHub Actions；新 Web 玩家存檔、極端浮點數、跨作業系統 Perl 字串格式與瀏覽器測試沒有全面驗收。
- **健身房資料範圍**：`dat_dir/gym.cgi` 包含「効果=美」、「間」欄；`town_lib.pl::gym_sprit` 會讀取欄位。尚未定位該字串的執行規則，因此不依字面擴充 Web 訓練效果或視為功能缺漏。

## P0 → P1 → P2 切片與相依／拒絕條件

| 切片／預定 PR | 目標／檔案與資料 | 前置 | 必須新增／保留的測試 | 拒絕條件 |
|---|---|---|---|---|
| P0-A：本盤點 PR | 只新增 `web/docs/migration-audit.md`，README 入口 | PR #10 作為堆疊基底 | 文件 14 領域／44 ID 完整、連結與靜態證據；CI | 未核對的事項不得標成已完成；不改遊戲程式 |
| P0-B：體格核心 | `src/engine.mjs`、`src/dining.mjs`、`src/legacy-item-use.mjs`、相關 tests；必要時非破壞 DB migration | P0-A 審核；查原版工作 BMI 路徑 | BMI 上限邊界、身高變更、連續飲食／工作／物品、存檔重啟、跨帳號隔離 | 不直接覆蓋舊角色 BMI／體重，不從未驗證欄位擴充功能 |
| P0-C：狀態頁體格整理 | `public/index.html`、`public/app.js`、`public/style.css`、UI tests | P0-B 欄位定案 | 手機 375px/768px 與桌面真實瀏覽器／鍵盤檢查 | 無瀏覽器驗證不得標註視覺驗收成功 |
| P1-A：餐飲日表及庫存 | `src/dining.mjs`、`src/server.mjs`、SQLite 日菜單／庫存表、tests | P0-B、每日時鐘與餐飲交易 | 隨機菜單、跨日、賣完、同城共用、重送完整回滾 | 不憑空生成原版不存在的商品或菜單 |
| P1-B：健身資料來源核對 | `src/training.mjs`、原版 gym 相關 CGI／tests | 確認原版實際健身執行函式 | 原版費用、能力增益、課程時間及失敗回滾 | 無原版執行依據的欄位只保留資料，不建立額外效果功能 |
| P1-C：剩餘五事件 | `src/event-effects.mjs`、`src/events.mjs`、物品交易／庫存、tests | `kifu*`、`get_itm*`、來源交易已可表示 | 每 ID 亂數、耐久、容量、日限額、多人隔離、rollback | 未有贈送/物品產生交易時不可用假獎勵替代 |
| P1-D：職業條件原版數值展示 | src/server.mjs::snapshot、public/app.js::renderJobs、UI tests | WK-04、dat_dir/job.cgi 的 150 筆已解析數值 | 每個可選／不可選職業解析完整 17 項能力，UI 只顯示需求 >0 的值（PR #29）、BMI／身高／性別、薪資獎金及發薪週期 | 不因資料缺失假定職業可應徵，不改伺服器資格判定 |
| P1-E：薪資去向與銀行明細 | src/engine.mjs、src/server.mjs、src/banking.mjs、SQLite、tests | WK-05 原版 shiharai 與現行銀行交易模型已比對 | 現金／普通銀行領款切換、升級獎金與發薪、帳簿、多人交易防重與回滾 | 僅依新 Web 角色本人儲存的薪資偏好執行 |
| P1-F：教室獨立訓練 | dat_dir/kyushitu.cgi、src/training.mjs／新模組、server/UI/DB/tests | TR-04～TR-06 原版完整執行分支；與 school/gym 分離 | 4 課原始增益、雙能量、分鐘冷卻、減重、現金與授信付款、多人防重／回滾 | 不把教室來源套到 gym/school；不複製原始 CGI 缺少銀行餘額檢查的風險 |
| P2：工作工廠／真實公開個人檔案／住宅商店等 | job.cgi／unit.pl、basic.cgi::prof、原始社交與住宅 CGI | WK-07／SC-04／SC-05；新 Web 玩法待完成 | 投稿、審核、個人資料公開同意、搜尋、刪改與個資保護 | 不將玩家投稿自動加入正式職業；不自動公開遊戲數值或玩家個資 |

### 驗收與盤點待辦

- [x] 建立實際來源支持的第一輪 `migration-audit.md` 與 14 領域矩陣。
- [x] 逐列列出全部可抽的 #01～#44，並指出預設不可抽的 #45／#46。
- [x] 更新 PR #9／#10 已合併狀態，且區分原版可達／不可達事件。
- [x] 體格優先；已找到整數 BMI 職業判定差異。
- [x] 職業條件表、薪資去向、教室實際減重與付款、真實個人檔案來源已新增可核對項目（詳 [逐函式盤點](phase30-jobs-training-profile-audit.md)）。
- [ ] 對每個 CGI 子函式及 44 事件做完整**數值、資料欄位、條件、相依與單元測試逐項簽核**。
- [x] 原版舊玩家角色／物品／房屋／銀行資料匯入已明確排除；只需驗新版 Web 角色、資產、備份與版本升級。
- [ ] 真實瀏覽器 375px、768px、桌機與鍵盤／讀屏驗收（目前未做）。
- [x] PR #11～#18 的相應盤點／功能提交已合併整合分支、CI 通過；**仍不得宣稱 14 領域或 44 個事件已完整移植或完成真實環境驗收**。
