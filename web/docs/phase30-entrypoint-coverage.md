# 第 30 階段：原版設施／入口逐項追蹤（第一批）

> **來源與時間**：2026-11-20，原版 [`unit.pl::get_unit`](../../unit.pl#L1)、[首頁快捷鍵 `town_maker.cgi`](../../town_maker.cgi#L581)、[`top.pl` 地圖渲染](../../top.pl#L472)，對照 Web [`town-map.mjs`](../src/town-map.mjs)、[`town-home.js`](../public/town-home.js)、[`app.js`](../public/app.js)、[`server.mjs`](../src/server.mjs)；以 PR #19 已合併的整合分支為基準。**此表統計「原版定義了互動表單入口」而非歷史上所有城鎮一定設有該格子**。
>
> 先前的 14 領域盤點是**功能分類**而不是原版入口清冊；本表專門避免「整個 CGI／設施沒有被列出」的漏項。不能把一個圖片代碼存在，當成遊戲功能已移植。也不能把不存在的來源路徑當作可運作功能。

## 一、逐入口交叉檢查總覽

直接從原版 `unit.pl` 的 `%unit` 定義重新取出 **73 個地圖代碼**：**43 個**定義互動 `<form>`（包含跨行的「温泉」）；另 **30 個**是地景／道路／裝飾等非表單條目。

針對 43 個互動入口，Web 目前：
- **28 個**有明確的 [`MAP_SYMBOLS`](../src/town-map.mjs) 地圖代碼；**15 個**原版互動入口沒有被加入 Web 地圖代碼清單（匯入真實地圖時可能以未知圖示呈現，實際需要有資料驗證）。
- **7 個**被 [`FACILITY_PANELS`](../public/town-home.js#L2) 導向某個 Web 面板；其中 **6 個**可視為與原始入口相應的部分功能，**「教室」是 1 個確定錯置**，因為目前被導向學校 `school-panel`。
- **21 個**已有 Web 地圖代碼，卻沒有對應 `FACILITY_PANELS` 路由；現行 [`townCellAction`](../public/town-home.js#L12) 會回傳 `unavailable`，按圖示只會提示尚未移植。
- 這些是**程式路由覆蓋率**，不是已完成功能比例；例如車站移動另有 Web 按鈕，但並未按原版 `station.cgi` 收費。

## 二、原版全部 43 個表單入口

`原版行號` 連結至真實 `unit.pl` 定義；「模式」取自原版 `my_data`。欄位是 `—` 時表示此入口以其他方式傳參，未憑空補值。`$script` 是原始 CGI 當時的入口變數，未擅自改成某個檔名。

| 原版代碼／來源行 | 動作目標 | 模式 | Web 地圖代碼 | Web 點擊結果／功能狀態 |
|---|---|---|---|---|
| [`プレ３`](../../unit.pl#L63) | `test.cgi` | `main` | 無 | Web 地圖代碼未收錄 |
| [`プレ２`](../../unit.pl#L65) | `prezent2.cgi` | `top` | 無 | Web 地圖代碼未收錄 |
| [`ＰＨＰ`](../../unit.pl#L67) | `bbs.cgi` | `top` | 無 | Web 地圖代碼未收錄 |
| [`仕事工場`](../../unit.pl#L69) | `job.cgi` | `top` | 無 | Web 地圖代碼未收錄 |
| [`モ投稿`](../../unit.pl#L71) | `mon_make.cgi` | `mon_make` | 無 | Web 地圖代碼未收錄 |
| [`Ｂリーグ`](../../unit.pl#L73) | `battle.cgi` | `bbin` | 有 | Web 有圖示、點選不可進入 |
| [`ランキン`](../../unit.pl#L75) | `$script` | `jamp_url` | 無 | Web 地圖代碼未收錄 |
| [`釣り`](../../unit.pl#L77) | `sea.cgi` | `sea` | 有 | Web 有圖示、點選不可進入 |
| [`イベント`](../../unit.pl#L79) | `event.cgi` | `form` | 無 | Web 地圖代碼未收錄 |
| [`特典`](../../unit.pl#L81) | `tokuten.cgi` | `tokuten` | 無 | Web 地圖代碼未收錄 |
| [`アンケ`](../../unit.pl#L83) | `enq.cgi` | `top` | 有 | Web 有圖示、點選不可進入 |
| [`駅`](../../unit.pl#L85) | `station.cgi` | `map` | 有 | Web 有圖示、點選不可進入 |
| [`おばちゃん`](../../unit.pl#L116) | `obatyan.cgi` | `week` | 無 | Web 地圖代碼未收錄 |
| [`おばちゃん強`](../../unit.pl#L118) | `obatyan.cgi` | `strong` | 無 | Web 地圖代碼未收錄 |
| [`ゲーセン`](../../unit.pl#L120) | `gamerand.cgi` | `—` | 有 | Web 有圖示、點選不可進入 |
| [`アイテム`](../../unit.pl#L122) | `item.cgi` | `item_make` | 無 | Web 地圖代碼未收錄 |
| [`役場`](../../unit.pl#L124) | `yakuba.cgi` | `yakuba` | 有 | Web 有圖示、點選不可進入 |
| [`銀行`](../../unit.pl#L126) | `basic.cgi` | `ginkou` | 有 | 有 Web 入口／僅部分對照 |
| [`病院`](../../unit.pl#L128) | `basic.cgi` | `byouin` | 有 | 有 Web 入口／僅部分對照 |
| [`ギフト屋`](../../unit.pl#L130) | `gifutoya.cgi` | `gifutoya` | 有 | Web 有圖示、點選不可進入 |
| [`株`](../../unit.pl#L132) | `kabu.cgi` | `kabu` | 有 | Web 有圖示、點選不可進入 |
| [`食堂`](../../unit.pl#L134) | `$script` | `syokudou` | 有 | 有 Web 入口／僅部分對照 |
| [`食堂２`](../../unit.pl#L136) | `$script` | `syokudou2` | 有 | 有 Web 入口／僅部分對照 |
| [`デパ`](../../unit.pl#L138) | `$script` | `depart_gamen` | 有 | Web 有圖示、點選不可進入 |
| [`デパ2`](../../unit.pl#L140) | `$script` | `depart_gamen2` | 有 | Web 有圖示、點選不可進入 |
| [`自販機`](../../unit.pl#L142) | `$script` | `hanbai` | 有 | Web 有圖示、點選不可進入 |
| [`装備屋`](../../unit.pl#L144) | `hanbai.cgi` | `hanbai` | 有 | Web 有圖示、點選不可進入 |
| [`販売1`](../../unit.pl#L146) | `hanbai1.cgi` | `hanbai1` | 無 | Web 地圖代碼未收錄 |
| [`リサイ`](../../unit.pl#L148) | `recycle.cgi` | `resycle` | 有 | Web 有圖示、點選不可進入 |
| [`クーポン`](../../unit.pl#L150) | `coupon.cgi` | `coupon` | 無 | Web 地圖代碼未收錄 |
| [`教室`](../../unit.pl#L152) | `kyushitu.cgi` | `kyushitu` | 有 | **錯誤導向學校**（應為獨立教室） |
| [`職安`](../../unit.pl#L154) | `basic.cgi` | `job_change` | 有 | 有 Web 入口／僅部分對照 |
| [`問屋`](../../unit.pl#L158) | `$script` | `orosi` | 有 | Web 有圖示、點選不可進入 |
| [`建築`](../../unit.pl#L160) | `$script` | `kentiku` | 有 | 有 Web 入口／僅部分對照 |
| [`競馬`](../../unit.pl#L162) | `basic.cgi` | `keiba` | 有 | Web 有圖示、點選不可進入 |
| [`プロフ`](../../unit.pl#L164) | `basic.cgi` | `prof` | 有 | Web 有圖示、點選不可進入 |
| [`キャラ`](../../unit.pl#L166) | `game.cgi` | `c_league` | 有 | Web 有圖示、點選不可進入 |
| [`街コン`](../../unit.pl#L168) | `./mati_contest.cgi` | `matikon` | 無 | Web 地圖代碼未收錄 |
| [`温泉`](../../unit.pl#L172) | `basic.cgi` | `onsen` | 有 | Web 有圖示、點選不可進入 |
| [`斡旋`](../../unit.pl#L183) | `kekkon.cgi` | `assenjo` | 有 | Web 有圖示、點選不可進入 |
| [`人生`](../../unit.pl#L185) | `./sugoroku/zinsei.cgi` | `—` | 無 | Web 地圖代碼未收錄 |
| [`合成`](../../unit.pl#L187) | `gouseiya.cgi` | `gousei` | 有 | Web 有圖示、點選不可進入 |
| [`競売`](../../unit.pl#L189) | `auction.cgi` | `auction` | 有 | Web 有圖示、點選不可進入 |

> **重要例外**：[原版「人生」入口](../../unit.pl#L185) 指向 `./sugoroku/zinsei.cgi`；這份 fork 的 GitHub 樹中**沒有該檔**，因此只能標記為「來源中存在外部／缺檔連結」，不能宣稱原版有一套可在此 fork 正常執行的人生遊戲，也不能據此創作其規則。`プレ３` 指向 `test.cgi`，也需要檢查實際有效性，不按名稱賦予遊戲效果。

## 三、逐函式驗證的確定缺口與行為差異

| ID | 原版實際可執行證據 | Web 對照與判定 |
|---|---|---|
| **MP-04 車站收費與跨城** | [`station.cgi::idou` L99–116](../../station.cgi#L99) 明列四城市間六種票價：0↔1 **950**、0↔2 **780**、0↔3 **1,210**、1↔2 **950**、1↔3 **2,210**、2↔3 **1,530**；原版扣 `money`，L135–169 顯示 5 秒移動倒數。 | Web [`/api/move`](../src/server.mjs) 有換城功能，但尚未實作原版六組交通費；地圖「駅」圖示點擊被視為未移植。**確定規則差異**；原版倒數畫面不等於一定有伺服器端 5 秒旅行冷卻。 |
| **UI-05 教室錯誤導航** | [`unit.pl` L152](../../unit.pl#L152) 的 `教室` 指向 [`kyushitu.cgi`](../../kyushitu.cgi)，有**獨立四課資料**。 | [`town-home.js` L6](../public/town-home.js#L6) 將 `教室` 指向 `school-panel`；[Web 學校資料](../src/training.mjs) 為 `dat_dir/school.cgi`，兩者不是同一設施。**確定 Web 導覽錯置，應修正且不假裝教室已移植**。 |
| **IT-05 原版釣魚及漁獲出售** | [`unit.pl` L77](../../unit.pl#L77) 指向 [`sea.cgi`](../../sea.cgi)；`turu` L139–186 檢查上次釣魚間隔、實際持有餌料與釣獲分支；`seri` L244–283 檢查實際漁獲並依不同類別結算售價。 | Web 沒有完整對應釣魚／漁獲出售行為；不得以現有物品封存或餐飲菜單視為完成。**確定缺漏**。 |
| **EV-01 玩家投稿事件** | [`unit.pl` L79](../../unit.pl#L79) 的 `イベント` 指向 [`event.cgi::form/save` L21–103](../../event.cgi#L21)；`save` 將文字、能力、金錢等資料寫 `log_dir/eventlog.cgi`。 | **與 `event.pl` 的 #01～#44 隨機事件完全是兩件事**；Web 已支援部分隨機事件，但沒有此原版玩家投稿入口。投稿並非自動導入隨機事件池。**確定缺漏**。 |
| **SV-01 玩家問卷建立、投票與管理** | [`unit.pl` L83](../../unit.pl#L83) 的 `アンケ` 指向 [`enq.cgi`](../../enq.cgi)，含 `top`、`make`、`setup`、`add`、`write`（投票）、`delete` 等模式；[`enq.cgi::write` L417](../../enq.cgi#L417) 有實際票選條件。 | Web 無獨立問卷／投票系統；與事件抽獎及聊天不可混算。**確定缺漏**。 |
| **BK-05 五種股票及交易記錄** | [`unit.pl` L132](../../unit.pl#L132) 指向 [`kabu.cgi::kabu` L36–108](../../kabu.cgi#L36)；使用 `log_dir/kab_hendou.cgi` 的 A～E 股價與 `member/<ID>` 個人持股記錄，具交易／清算分支。 | Web [`banking.mjs`](../src/banking.mjs) 是存提款／貸款，沒有原版 A～E 股價市場或持股資料模型。**確定缺漏**，不能因有銀行而算股票已完成。 |
| **IT-06 拍賣刊登及結算** | [`unit.pl` L189](../../unit.pl#L189) 指向 [`auction.cgi`](../../auction.cgi)；`auction` L49 起讀拍賣記錄，另有 `syupin`、`syupin_do`、`ukewatashi` 分支。 | Web 尚無此拍賣流程；不可和原版店舖買賣、回收商店、物品封存混成同項。**確定缺漏**。 |
| **GM-01 遊樂中心與卡牌遊戲** | [`unit.pl` L120](../../unit.pl#L120) 的 `ゲーセン` 進入 [`gamerand.cgi` L42–79](../../gamerand.cgi#L42)，其原版畫面直接連至 `donut.cgi` 的卡牌遊戲與 High／Low 玩法、賭注各有提示。 | Web `MAP_SYMBOLS` 只存圖示，沒有該設施路由或對應原版遊戲機制。**確定缺漏**；投注／獎金要另讀 `donut.cgi` 執行分支後才能定數值。 |
| **AC-04 個人設定／備忘錄／死亡通知** | [`town_maker.cgi` L647–649](../../town_maker.cgi#L647) 的首頁快捷鍵進入 [`setup.cgi`](../../setup.cgi)；模式有 `change`、`friend`、`memo`、`die`；[`setup.cgi::memo` L334–348](../../setup.cgi#L334) 寫個人備忘錄，`die` L354 起有密碼驗證、角色檔案處理。 | Web 有獨立 `solo` 刪角色操作，**不能當作原版 `setup.cgi::die` 已完整移植**；朋友清單、備忘錄與字體／聲音偏好另需對照。**確定缺漏／部分重疊**。 |

## 四、首頁快速入口也要盤點，不能只看地圖

原版 [`town_maker.cgi` L581–655](../../town_maker.cgi#L581) 含：刷新、工作、物品、寄送訊息、居民對戰、本人住宅設定、配偶住宅設定、戀愛、育兒、個人設定（`setup.cgi`）、儲存（`game.cgi::data_hozon`）。其中家屋、戀愛與育兒入口有條件才顯示。Web 的角色功能面板或單機刪角只涵蓋部分行為，**需逐個原版按鈕核實模式及 Web 對應**，不能把快捷入口一概視為已完成。可用於下輪的來源清單：

- 原版首頁工作、物品、寄訊、居民對戰：[`town_maker.cgi` L590–611](../../town_maker.cgi#L590)。
- 本人／配偶家屋、戀愛、育兒與顯示條件：[`town_maker.cgi` L615–643](../../town_maker.cgi#L615)。
- 設定、儲存：[`town_maker.cgi` L647–655](../../town_maker.cgi#L647)。

**防漏檢查**：[`tests/audit-entrypoints.test.mjs`](../tests/audit-entrypoints.test.mjs) 會從原始 `unit.pl` 重新抽取所有表單入口，逐一對照本文件 43 列及 Web `MAP_SYMBOLS` 的圖示收錄與否。**它驗證清冊完整性，不測試各 CGI 的功能正確性或歷史地圖可達性。**

## 五、尚未核實的原版可達性與資料

1. 此 fork 的 `log_dir/townlog0.cgi`～`townlog3.cgi` 都是 **0 位元組**；沒有真實原版城市配置可證明 43 個互動代碼當年全部能在實際地圖上點到。**本表只證明入口定義存在**。
2. `unit.pl` 可由動態住宅記錄新增玩家住宅入口（[`kozin_house` L195–223](../../unit.pl#L195)），並非本表 73 個靜態符號之一。Web 已有部分住宅實作，但真實原版關聯檔仍待驗收。
3. 當前只讀取所列每個入口的原始 CGI 名稱／分流，並深入 `station.cgi`、`sea.cgi`、`event.cgi`、`enq.cgi`、`kabu.cgi`、`auction.cgi`、`gamerand.cgi`、`setup.cgi` 的真實執行片段。**仍未把 43 個入口所連到的 CGI／模式及其子函式逐一簽核（多個入口可能共用同一 CGI）**；下一輪按本表逐一追實際扣款、存檔、交易、防重、权限／UI，避免遺漏。
4. 真實瀏覽器／舊玩家存檔端到端測試仍未進行；不得將 43 個原版入口掃描誤報為 43 個功能已完成移植。

