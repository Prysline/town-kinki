# 第 30 階段：原版設施／入口逐項追蹤（第一批）

> **現行決策**：原版舊玩家存檔匯入、兼容及真實舊玩家資料驗收已**完全排除專案範圍**。本文件的原版 CGI 與資料格式引用只用來還原玩法；新 Web SQLite 存檔持續性與瀏覽器驗收仍必要。詳 [專案範圍](project-scope-no-legacy-player-import.md)。

> **來源與時間**：2026-11-20，原版 [`unit.pl::get_unit`](../../unit.pl#L1)、[首頁快捷鍵 `town_maker.cgi`](../../town_maker.cgi#L581)、[`top.pl` 地圖渲染](../../top.pl#L472)，對照 Web [`town-map.mjs`](../src/town-map.mjs)、[`town-home.js`](../public/town-home.js)、[`app.js`](../public/app.js)、[`server.mjs`](../src/server.mjs)；最初以 PR #19 已合併分支盤點；本次同步 PR #26／#29 之後的入口狀態。**此表統計「原版定義了互動表單入口」而非歷史上所有城鎮一定設有該格子**。
>
> 先前的 14 領域盤點是**功能分類**而不是原版入口清冊；本表專門避免「整個 CGI／設施沒有被列出」的漏項。不能把一個圖片代碼存在，當成遊戲功能已移植。也不能把不存在的來源路徑當作可運作功能。

> **根目錄來源補查**：另對整個 fork 的 67 個根目錄 CGI/Perl 檔交叉盤點，辨識企業員工教育 `unei_2.pl` 實際呼叫，以及 `unit_temp.pl` 副本、空檔與非遊戲管理／診斷 CGI；見 [第二層來源分類](phase30-root-source-classification.md)。

## 一、逐入口交叉檢查總覽

> **2026-11-20 再核對**：43 入口統計保持不變；另查出 `basic.cgi::keiba`、`gouseiya.cgi::gousei_do`、`obatyan.cgi::battle` 與 `prezent2.cgi::get` 確有程式，但其 Web 玩法尚未移植；`town_maker.cgi::login_view` 有不屬於地圖設施的真實跨日徵稅。詳細證據見 [CGI 來源重盤點](phase30-source-recheck.md)。



直接從原版 `unit.pl` 的 `%unit` 定義重新取出 **73 個地圖代碼**：**43 個**定義互動 `<form>`（包含跨行的「温泉」）；另 **30 個**是地景／道路／裝飾等非表單條目。

針對 43 個互動入口，Web 目前：
- **29 個**有明確的 [`MAP_SYMBOLS`](../src/town-map.mjs) 地圖代碼；**14 個**原版互動入口沒有被加入 Web 地圖代碼清單（匯入真實地圖時可能以未知圖示呈現，實際需要有資料驗證）。
- **16 個**有操作入口：**15 個**由 [`FACILITY_PANELS`](../public/town-home.js#L2) 導向 Web 面板（含 PR #23 的獨立教室，PR #27 的已匯入有效信用卡付款），另 **1 個「駅」**由 [`townCellAction`](../public/town-home.js#L12) 導向車站票價與乘車選項（PR #26）。這只是入口覆蓋，不代表設施全部規則已移植。
- **13 個**已有 Web 地圖代碼，但既未映射 `FACILITY_PANELS`，也不是車站特例；[`townCellAction`](../public/town-home.js#L12) 會回傳 `unavailable`，按圖示只會提示尚未移植。
- 百貨兩入口、自販機與裝備屋已有各自實際購物交易，**仍不等於原版全部商店功能**。詳 [百貨店](phase31-department-checkout.md)、[自販機](phase33-vending-shopping.md) 與 [裝備屋](phase35-equipment-shop.md)。
- 這些是**程式路由覆蓋率**，不是已完成功能比例；車站已按原版 `station.cgi` 收取四城六組雙向車資（PR #26），而真實原版地圖存檔及其他交通道具仍待核查。

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
| [`駅`](../../unit.pl#L85) | `station.cgi` | `map` | 有 | **PR #26 已修復** → 點車站可查看六組原版票價並實際跨城扣現金；其他交通券未核實 |
| [`おばちゃん`](../../unit.pl#L116) | `obatyan.cgi` | `week` | 無 | Web 地圖代碼未收錄 |
| [`おばちゃん強`](../../unit.pl#L118) | `obatyan.cgi` | `strong` | 無 | Web 地圖代碼未收錄 |
| [`ゲーセン`](../../unit.pl#L120) | `gamerand.cgi` | `—` | 有 | Web 有圖示、點選不可進入 |
| [`アイテム`](../../unit.pl#L122) | `item.cgi` | `item_make` | 無 | Web 地圖代碼未收錄 |
| [`役場`](../../unit.pl#L124) | `yakuba.cgi` | `yakuba` | 有 | Web 有圖示、點選不可進入 |
| [`銀行`](../../unit.pl#L126) | `basic.cgi` | `ginkou` | 有 | 有 Web 入口／僅部分對照 |
| [`病院`](../../unit.pl#L128) | `basic.cgi` | `byouin` | 有 | 有 Web 入口／僅部分對照 |
| [`ギフト屋`](../../unit.pl#L130) | `gifutoya.cgi` | `gifutoya` | 有 | 已接入 [原版 50,000 元禮品轉換、部分耐久分割、跨玩家ギフト商品寄送與雙側 10 格上限](phase37-gift-shop.md)；原版附信部分細節與優惠券玩法尚未全部完成（舊檔轉換不在範圍） |
| [`株`](../../unit.pl#L132) | `kabu.cgi` | `kabu` | 有 | Web 有圖示、點選不可進入 |
| [`食堂`](../../unit.pl#L134) | `$script` | `syokudou` | 有 | 有 Web 入口／僅部分對照 |
| [`食堂２`](../../unit.pl#L136) | `$script` | `syokudou2` | 有 | 有 Web 入口／僅部分對照 |
| [`デパ`](../../unit.pl#L138) | `$script` | `depart_gamen` | 有 | 已接入地圖、每日最多 110 種、原價×3、1～5 件、本人有效信用卡／普通存款、同品耐久及共用庫存；仍缺特殊物品／贈券全部流程 |
| [`デパ2`](../../unit.pl#L140) | `$script` | `depart_gamen2` | 有 | 已接入第二間獨立貨架、1～5 件／現金或本人有效信用卡、耐久入庫與共用庫存；全部原版效果仍待逐項驗證 |
| [`自販機`](../../unit.pl#L142) | `$script` | `hanbai` | 有 | 已加入 [獨立原價飲料貨架、每期十種、當地中午 12 點換檔、真實扣款與本人入庫](phase33-vending-shopping.md)；特殊飲料效果仍待驗證 |
| [`装備屋`](../../unit.pl#L144) | `hanbai.cgi` | `hanbai` | 有 | 已接入 [原版 6 欄商品原價單件現金購買、獨立 7 欄倉庫、四類換裝、倉庫回收與防重交易](phase35-equipment-shop.md)；[鍛造](phase36-equipment-forge.md)已接入，戰鬥尚未移植 |
| [`販売1`](../../unit.pl#L146) | `hanbai1.cgi` | `hanbai1` | 無 | Web 地圖代碼未收錄 |
| [`リサイ`](../../unit.pl#L148) | `recycle.cgi` | `resycle` | 有 | 已接入 [原版 30 分鐘限制、最高回收 200,000、50 件／7 日二手市場、真實出售與跨玩家購買](phase38-recycle-market.md)；不需要原版玩家持有物轉檔 |
| [`クーポン`](../../unit.pl#L150) | `coupon.cgi` | `coupon` | 有 | **第51階段新增原版兌換所圖示及事件分頁入口**：按原始 30 筆獎品與點數，只扣本人 Web 事件所得券；完整 33 欄獎品真實入庫。新 Web 事件券可兌換、部分獎品使用效果未移植；原版舊券轉檔已排除，見 [第51階段](phase51-event-coupon-redemption.md) |
| [`教室`](../../unit.pl#L152) | `kyushitu.cgi` | `kyushitu` | 有 | **PR #23／#27 已修正** → `classroom-panel`（四堂課，現金或有效匯入信用卡） |
| [`職安`](../../unit.pl#L154) | `basic.cgi` | `job_change` | 有 | 有 Web 入口／僅部分對照 |
| [`問屋`](../../unit.pl#L158) | `$script` | `orosi` | 有 | 已加入 [原版問屋最多 120 種、來源庫存×2、住宅店鋪分類、普通銀行進貨、店鋪庫存與 75% 退貨](phase39-wholesale-store.md)；[住宅商店對外銷售](phase40-player-store-sales.md) 已提供，配偶代理及原始歷史匯入仍待移植 |
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

**後續多層入口補盤**：原版 [`gamerand.cgi`](../../gamerand.cgi) 另連到 `donut.cgi`、`loto.cgi`、`loto6.cgi`、`fukubiki.cgi`、`saikoro.cgi`、`cardw2.cgi`、`otakara.cgi` 等子流程。詳 [尚未盤點與未修復總清冊](phase30-open-audit-backlog.md)。不把一個地圖入口算成一個完整系統，也不把 `slot.php` 缺檔、已註解的 `kuzi.cgi` 當成確認可玩。

## 三、逐函式驗證的確定缺口與行為差異

| ID | 原版實際可執行證據 | Web 對照與判定 |
|---|---|---|
| **MP-04 車站收費與跨城（已修核心、待新版存檔／瀏覽器驗收）** | [`station.cgi::idou` L99–116](../../station.cgi#L99) 有四城六組票價：0↔1 **950**、0↔2 **780**、0↔3 **1,210**、1↔2 **950**、1↔3 **2,210**、2↔3 **1,530**；L135–169 為畫面移動倒數。 | PR #26 已修復 [`/api/move`](../src/server.mjs) 與地圖「駅」：按原版票價扣現金、更新城鎮，同城或餘額不足拒絕；原版 5 秒倒數**不是**新增伺服器旅行冷卻的證據；其他交通券及真實玩家地圖仍待核實。 |
| **UI-05 教室獨立導航（已修復）** | [`unit.pl` L152](../../unit.pl#L152) 的 `教室` 指向 [`kyushitu.cgi`](../../kyushitu.cgi)，有獨立四課資料。 | [`town-home.js` L6](../public/town-home.js#L6) 已將「教室」導向 `classroom-panel`；Web 由 [`training.mjs`](../src/training.mjs) 按原版資料執行四堂現金課程及原版有效匯入卡片付款。**PR #23 修正地圖導覽；PR #27 補入本人有效原版信用卡付款，購卡流程未移植**。 |
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
4. 新版 Web 角色存檔／真實瀏覽器端到端測試仍需補足；不得將 43 個原版入口掃描誤報為 43 個功能已完成移植。

