# 第 51 階段：單機優先——Web 事件券真正兌換原版 33 欄獎品

日期：2026-11-21；目標分支 `feature/web-dual-mode-phase1`，不改 `master`。第50階段確立單機優先：玩家從事件獲得優惠券後，不應只能看到餘額而無法使用。**本階段完成新版 Web 角色事件券的原子兌換；原版舊玩家券轉移已不在專案範圍。**

## 一、原版 CGI 來源

- 原版 `unit.pl` 第150行 `"クーポン"` 以 `img/coupon.gif` 導向 `coupon.cgi`。之前 Web 未收錄此建築；本階段補 `town-map.mjs::MAP_SYMBOLS` 與 `town-home.js::FACILITY_PANELS`，讓它可在單機地圖編輯器中配置，也在新建的「Web 單機試玩街區」D5 放置。
- `coupon.cgi::coupon` 讀本人 `member/<ID>/mono.cgi`，從 `ギフト`／`クーポン` 的耐久取券點數。原版 `coupon_do` 以 `koniyubangou`（行序）與 `syouhin`（獎品名）雙重核對，將類別 `クーポン交換品:N` 的 N 點扣除，最後把指定獎品原始 33 欄 append 到角色的物品檔。
- `dat_dir/coupon.cgi` 原始資料共有 30 筆獎品，已由 `web/src/coupon-catalog.mjs` 保留原始行序、類別、名稱、點數、33 欄與 `日`／`回` 耐久。獎品耐久**不是**優惠券到期日；本階段不虛構券跨日失效。
- 原版 `coupon_do` 本身沒有完整的交易去重與多資料表回滾；Web 以 SQLite 交易補強資料正確性，不聲稱檔案寫入流程逐 byte 等價。

## 二、核心修復及安全界線

1. `src/coupon-redemption.mjs` 在 `BEGIN IMMEDIATE` 中確認本人角色、目前所在城鎮有 `クーポン` 建築、使用者自 `character_coupons` 獲得的 **Web 事件券**餘額足夠，以及一般持有物是否已達現行 Web 25 格限制。**只讀寫 Web 新角色的 `character_coupons`**；不需要舊 CGI 玩家的 `mono.cgi` 匯入或轉換。
2. 伺服器用現有 `requireLegacyCouponReward` 同時驗證原始序號與名稱，不從前端讀取券價或 33 欄物品；不支援臆造獎品、任意負點數或自報商店位置。
3. 在同筆交易扣 `character_coupons` N 點、以 `__web_coupon__` 新增一筆真正 `legacy_inventory_items` 原版 33 欄獎品、記錄 `coupon_redemptions`。原版資料只把購入時間欄 `fields[30]` 改成本次時間，其餘 32 欄維持 `dat_dir/coupon.cgi` 原始內容，獎品以獨立來源行號供背包與使用模組查詢。
4. `UNIQUE(user_id,request_id)` 防重送；相同請求重送不重扣也不再產生獎品，已使用識別碼不可換獎品，伺服器重啟後仍有效。從背包寫入到歷史紀錄任何一步失敗都完整回滾扣券和獎品。
5. 背包容量檢查引用現有 Web 一般持有物 **25 格**規則，計入本人 Web 持有且尚有效的物品，避免超過標準限制。這是 Web 已有商店規則的一致性修復，**不宣稱原版 coupon_do 自身有 25 格檢查**。
6. 單機玩家可從新配置的 Web 試玩街區 D5 點「優惠券兌換所」進入「事件」分頁；已於第50階段配置舊版 16 格試玩街區者**不會被覆蓋**，可開地圖編輯器在空格放置 `クーポン`。多人模式共用經過本人權限驗證的 API，但本次功能優先為單機遊玩。

## 三、畫面與獎品使用差異

- `GET /api/state` 增加 `couponShopAvailable`、`couponRewards` 30 件原版獎品資料與 `couponRedemptions` 最近兌換歷史；`couponBalance` 繼續是本人 Web 事件所得點數。
- `POST /api/coupon/redeem` 的請求是 `sourceIndex`（0～29）、`originalName`（來源原名）和一次性 `requestId`。介面顯示各獎品點數、耐久及持有點數，無兌換所或點數不足就禁用、確認後才兌換，所有玩家文字以 `textContent` 安全呈現。
- 兌換得到的是**完整原始獎品物件**，不是假圖示或自動加能力。原版獎品例如「福引券」需對應其他 CGI／場景才能使用；`legacy-item-use.mjs` 仍只對原版效果已查證的安全子集提供「使用」操作。**本階段不冒稱 30 種獎品的全部特殊用途已可使用，也不自行加入抽獎機制**。
- 獎品 `日` 耐久以兌換時刻入庫；Web 事件券點數仍由事件本身累積，不以獎品耐久決定 Web 事件券的時效。

## 四、測試涵蓋與未完成事項

- `web/tests/coupon-redemption.test.mjs`：核對原版 `coupon_do`、30 筆獎品及原版地圖入口；真正 Web 券扣點、33 欄一欄不差（除購入時間）、Web 角色券不得偽造、25 格滿額拒絕、券不足、無建築、無角色、換獎品、防重、獎品寫入或交易歷史失敗兩種回滾、另一角色隔離與刪帳級聯。
- `web/tests/server.test.mjs`：單機角色建立→事件券餘額→空白城鎮不可兌→建置試玩街區→完整扣券與實體背包入庫→新 Node 重新以同一 SQLite 起動後依舊保留兌換紀錄、重送不重扣；多人兩角色各自的券餘額和獎品隔離。
- `web/tests/home-ui.test.mjs` 及 `web/tests/audit-entrypoints.test.mjs`：前端兌換列表與來源文字、按鈕禁用、地圖入口與 43 座原版互動設施盤點同步。
- **仍須完成的玩法**：30 種獎品的可執行使用／抽獎子 CGI、現有 Web 物品的堆疊與耐久互通，以及真實瀏覽器不同螢幕尺寸和**新版 Web 角色存檔**的重啟／升級驗收。**原版舊玩家存檔匯入及其券轉換完全排除**，不再列為未完成事項。

第52階段仍維持**單機可玩性**：選擇已有原版可執行來源的事件獎品實際使用（如需抽獎機制應先閱讀其 CGI），或釣魚／合成等單人設施，而非回頭擴充私人訊息與跨玩家互贈。
