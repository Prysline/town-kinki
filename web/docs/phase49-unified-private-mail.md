# 第 49 階段：重要社交系統——原版私人站內信與寄禮信統一信箱

日期：2026-11-21。目標分支：`feature/web-dual-mode-phase1`。本階段交付**原版核心玩家間通信**，不是新增零散商品特例。

## 一、原版 CGI 依據

- `town_maker.cgi` 有 `mail_sousin` 與 `mail_do` 首頁命令入口；`command.pl::mail_sousin` 是獨立郵件畫面，原版不是需進禮品店才可看信。
- `command.pl::mail_do` 約第 2828～2940 行：必須提供其他玩家角色名稱與非空 `m_com`，寄送後在收件人的 `member/<ID>/mail.cgi` 寫 `受信`，同時在寄件者 `mail.cgi` 寫 `送信` 備份。原版另可選 `gift_souhu` 禮品與 `okuru_kpoint` 點數；**普通純文字並不要求附贈禮品**。
- `command.pl::mail_sousin` 約第 2400～2600 行：**收信加寄件共用同一位角色 `$mail_hozon_gandosuu`**；`town_ini.cgi` 指定 50。可刪除自己保存的信；郵件有從既有寄件對象建立通訊錄、朋友名冊等額外功能。
- 原版含 Shift-JIS 日文檢查、以 HTML 片段儲存信文。Web 採現代 Unicode 純文字與 `textContent` 顯示，以避免來自另一玩家的 HTML 被執行；**不聲稱逐 byte 還原原版格式**。

## 二、現有第 46／47 階段資料無損延伸

第 46 階段 `gift_mail_messages` 只能存禮品附信：`event_id NOT NULL`、`gift_name NOT NULL`、`quantity>0`。第 47 階段移除了信件對寄件者 `gift_events` 的 `ON DELETE CASCADE`，使對方刪帳不刪除本人的收信。本階段不再建另一個單獨擁有 50 封上限的信箱，而是用**同一個持有者信箱表**：

1. `web/src/private-mail.mjs::initPrivateMailTables` 先建立 `private_mail_events` 防重送事件；在啟動時檢查 `gift_mail_messages`，未升級時使用 `BEGIN IMMEDIATE` 交易建立 v3 表，將原本所有 `id/user_id/event_id/direction/other_name/message/gift_name/quantity/created_at` 原樣複製，換表並重建索引。任何失敗全部回滾，重新啟動判斷欄位後不重複改寫。
2. v3 的 `gift_mail_messages` 有兩種互斥合法記錄：**寄禮信**的 `event_id`、禮物名稱和正數份數，或**一般信**的 `private_event_id`、空的禮物欄位。持有者 `user_id` 仍以 `REFERENCES users(id) ON DELETE CASCADE` 限本人；不讓對方的寄件事件或交易紀錄刪除本人的副本。
3. `sendPrivateMail` 在同一個 `BEGIN IMMEDIATE` 寫寄件事件與收件／寄件兩筆記錄，兩筆任一失敗則事件與全部信回滾；同一 `requestId` 且內容與收件角色相同重送回傳 `replayed:true`，不能換文字或對象後重用請求 ID。
4. `recordGiftMail` 原本會以本人的 `gift_mail_messages` 刪除最舊資料；統一表後，這個裁切自然包含新舊兩類信。一般信寄出後也用同一排序及 50 封上限裁切。裁切舊信**不會刪除對應事件防重送記錄**，避免重送重新產生郵件。
5. 刪信是用本人 `user_id` 加上信件 `id` 定位；收件方刪自己的信不會影響寄件人的備份。帳號刪除後另一方的收寄副本保留，包含原版禮物與非禮物訊息。

## 三、實際 Web 使用流程

- 城鎮快捷新增「郵件」，設施分頁新增「郵件」獨立面板。純文字 `/api/mail/send` 提供收件角色名、1～1,000 字訊息、`requestId`；`/api/mail/delete` 只能刪本人信件。所有請求從登入 Cookie／單機本地角色取得身份，不能以傳入的玩家 ID 冒用他人。沒有收件角色、寄給本人、空訊息、格式或重送內容不符會拒絕。
- `/api/state` 的 `mailbox` 顯示**收件＋寄件、一般信＋禮品附信，合計最多 50 封**；保留舊 `giftMail` 只列禮物相關紀錄供原有 API 相容。禮品店仍能附信寄禮，閱讀和刪信集中於獨立郵件分頁，不顯示第二個信箱。
- 郵件內的其他玩家文字使用 DOM `textContent`，不使用 `innerHTML`；有附贈物品的紀錄會另列禮品名稱和份數。前端重試保留相同 requestId，成功才清除。
- 郵件可寄到遊戲中其他已建立角色；單機模式只有一名角色，沒有其他收件者可寄，功能會按「找不到對方」拒絕，不憑空建立虛擬用戶。

## 四、測試與驗收界線

- `web/tests/private-mail.test.mjs`：原版發件、收件、50 封來源；雙方信箱分離；拒絕自寄、空信、錯誤收件人／識別碼；重送、防改件；刻意在第二筆郵件寫入時造成 SQLite 失敗並檢查完整回滾；**寄禮 1 封＋普通信 50 封**裁掉最舊寄禮信、再寄禮裁掉最舊普通信；本人刪除與另一方刪帳仍保留；第 46 階段有原始 gift_events 級聯外鍵的資料表經 47→49 兩次遷移，重啟冪等且完整保留所有欄位。
- `web/tests/server.test.mjs`：三位多人角色經 HTTP 寄出一般信、重送／換文拒絕、收件／寄件／第三者隔離、越權刪除拒絕、本人刪信只刪自己副本、回信、寄禮附信與普通信在同一 `mailbox`、寄件者刪帳後收件與物品仍在、**新 Node 程序以同一 SQLite 重啟後仍能查看**。
- `web/tests/home-ui.test.mjs`：郵件快捷、鍵盤設施分頁、必填／上限、資料來源與純文字安全呈現。

**仍未完成**：原始 `member/<ID>/mail.cgi` 舊郵件匯入、收件已讀時間與刪信順序／時間值的完全一致、地址簿／朋友清單、K 點數附信、優惠券特例與原版完整 HTML 文字相容；這些不在第 49 階段冒稱完成。真實玩家舊檔及 375px／768px／桌面瀏覽器實際操作仍要另驗收。合併只在最新 head 的 push＋pull_request CI 成功後進行，合併後再確認兩組 CI，`master` 不變。
