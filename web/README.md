# TOWN 繁體中文 Web 移植

以原始 Perl／CGI 的**可查證玩法與商品資料**為依據，為**新玩家**提供繁體中文單機／多人 Web 版本。原始程式在 `master` 保持唯讀，Web 開發與合併目標為 `feature/web-dual-mode-phase1`。**以單機可持續遊玩為優先**，多人已完成的隔離與原子交易安全仍需維持。

> **下一階段必讀：[現行功能狀態與開發計畫](docs/PROJECT-STATUS-AND-PLAN.md)**。它獨立區分「已實作／自動驗證／真人瀏覽器驗收／原版差異／真正未完成」。舊第30～67階段文件只作技術、PR 與決策證據，不能當最新待辦。
>
> **[正式產品範圍](docs/project-scope-no-legacy-player-import.md)**：**完全不需要考慮原版 CGI 舊玩家存檔匯入**；完全不做舊 CGI 玩家帳號、私人存檔、郵件、背包、銀行、住宅匯入／轉檔／相容驗收。原版 CGI 是玩法來源；新 Web SQLite 存檔、升級、備份與還原仍是正式需求。原版 `log_dir/townlog0.cgi`～`townlog3.cgi` 全為空檔；21格單機試玩街區是自願建立的 Web 配置，並非原版歷史地圖。

## 需求、安裝與啟動

**Node.js 22.13 以上**（使用內建 `node:sqlite`；Node 22 可能顯示實驗性功能警告），無額外 npm 套件。從儲存庫根目錄執行：

```sh
cd web
npm test
npm start
```

預設為**單機**，開啟 <http://127.0.0.1:3000> 建立角色；資料保存在 `web/data/solo.sqlite`（路徑以 `DATA_DIR` 設定為準）。退出頁面／清除瀏覽器 Cookie 不會刪除本機 SQLite 角色。首次進入空白地圖時，可自行確認建立**21格 Web 單機試玩街區**；已有地圖／住宅時不覆寫，也不自動發放金錢。建立後會顯示前往工作、百貨、背包、釣魚、合成與遊樂中心的可點新手路線；只在 Web 試玩配置出現，實際交易仍須滿足原有金錢、材料及冷卻條件。跨城仍依既有城鎮配置及交通條件操作。

啟用**多人**（獨立帳號、工作階段與資料庫）：

```sh
cd web
GAME_MODE=multi HOST=127.0.0.1 PORT=3000 npm start
```

Windows PowerShell 範例：

```powershell
cd web
$env:GAME_MODE = "multi"
npm start
```

兩種模式沿用遊戲規則與介面，**角色與資料庫彼此獨立**，沒有自動同步或彼此轉移功能。遊戲日期預設採 `Asia/Taipei`，可於啟動時用 `GAME_TIMEZONE` 指定有效 IANA 時區（如 `Asia/Tokyo`）。原版的工作間隔為5分鐘、能量恢復每10秒1點；伺服器判斷時間，不直接採信使用者瀏覽器時鐘。

## 單機新版 SQLite 備份、驗證與不覆寫還原

第67階段的 `scripts/solo-save.mjs` **已實作且通過自動測試**。在 `web/` 下執行：

```sh
# 可在原單機伺服器運行時建立一致 WAL 快照；每次使用全新備份檔名
node scripts/solo-save.mjs backup --data-dir ./data --output ./backups/solo-2026-11-22.sqlite
node scripts/solo-save.mjs verify --file ./backups/solo-2026-11-22.sqlite
# 先關閉原伺服器；只還原到新的 DATA_DIR，不覆寫原有 solo.sqlite/WAL
node scripts/solo-save.mjs restore --file ./backups/solo-2026-11-22.sqlite --data-dir ./restored-solo
DATA_DIR=./restored-solo npm start
```

這是 **Web 新單機存檔**的 SQLite WAL 一致快照、完整性／外鍵／SHA-256 檢查，以及不覆寫還原。**不能直接複製正在執行的 `solo.sqlite` 充當完整 WAL 備份**；`verify`／`restore` 拒絕含非空 WAL 旁檔的來源，請先用 `backup` 取得固定快照；若已遺失 WAL，僅憑主檔無法證明沒有遺漏交易；`verify` 不等於已在真實另一台設備完成演練。若目標資料夾已有單機資料庫或 WAL／SHM 旁檔，還原會拒絕。備份檔含玩家資產，需保管權限，建議複製到安全的離線位置。詳細步驟與失敗限制：[第67階段備份與還原](docs/phase67-solo-save-backup-restore.md)。

**跨 Web 版本的完整 SQLite 升級矩陣、不同 OS／設備還原、排程輪替與公開部署備份管理尚未驗收**；不應把它們與已完成的 CLI 混為一談。升級前應先使用此工具製作並驗證備份，任何 schema 變更必須保留原有角色資產。

## 可操作系統摘要與已知界線

現有單機主線包含新建角色、職業工作與收薪偏好、銀行／貸款、雙食堂與醫院、原版33欄商品的百貨與部分其他商店交易、背包／經核實可用的物品、住宅及室內留言、日常事件與事件券30獎品兌換、釣魚／買餌／賣魚、12種合成、遊樂中心骰子／卡牌／兩種樂透／四寶箱、公路行程（事故、迷路、改道、巴士）、**兩間百貨可實際購入的18筆合法交通商品**、可選21格試玩街區與新版 SQLite 保存、備份還原續玩。

已在 Node HTTP／SQLite 測試中實證工作→銀行→百貨→物品使用→食堂跨**兩次 Node 重啟**；第67階段另實證從 WAL 快照還原後繼續遊玩。**這不是手機375px、平板768px或桌面真人瀏覽器點擊驗收，也不等於每個原版系統完整移植**。部分特殊商品效果、住宅商業、競馬、原版多項社交與高風險交易等仍有獨立缺口；星期一稅務已實作指定 Web 安全切片（普通銀行不足時不扣成負值，記錄未繳而不追繳），見[現行矩陣及可核實待辦](docs/PROJECT-STATUS-AND-PLAN.md)。第65階段舊五車限制已被[第66階段來源重查](docs/phase66-road-retail-source-audit.md)取代；原版空白地圖不會自行出現歷史街道。

多人已存在帳號登入、雙方帳簿／資產所有權、寄禮及第49階段獨立站內信等功能；後續增加多人、社交或跨玩家受贈車載具來源鏈**不是單機首要任務**，但不得破壞現有多人交易原子性與刪帳隔離。

## 部署、安全與資料來源

本機開發預設只綁定回環地址。其他設備若需接入，在可信任的 **HTTPS 反向代理**後配置 `HOST=0.0.0.0`、`COOKIE_SECURE=1`。目前**沒有完整登入速率限制與正式公開部署安全審查**，不建議把伺服器直接暴露在公開網際網路。多人登入使用 HttpOnly Cookie 與 scrypt 密碼雜湊；正式部署前仍需重新驗證權限、防濫用、監控與備份保護。

原版職業、商品與規則來自根目錄 `dat_dir/`、`town_ini.cgi`、`basic.cgi`、`command.pl` 等相應來源；原始日文識別鍵、33欄格式及事件效果不得因 UI 翻譯而變動。單機／多人 SQLite 不與原始 CGI 私人玩家檔相連。原作來自 `tyage/town-kinki`，CGI 檔頭保留 `Copyright (c) 2003-2004 brassiere`；未確認獨立授權時，對外發佈需另行確認授權與權利。

## 文件導覽

- **[現行狀態與下一步（唯一現行排序來源）](docs/PROJECT-STATUS-AND-PLAN.md)**。
- [產品範圍與禁止舊玩家匯入](docs/project-scope-no-legacy-player-import.md)。
- [原始 CGI → Web 技術差異矩陣（原始功能 ID 保留）](docs/migration-audit.md)；[第30階段歷史盤點](docs/phase30-open-audit-backlog.md)。
- [第48階段跨重啟測試](docs/phase48-core-gameplay-restart.md)、[第50階段21格試玩街區](docs/phase50-solo-first-play-audit.md)、[第66階段18車](docs/phase66-road-retail-source-audit.md)、[第67階段備份](docs/phase67-solo-save-backup-restore.md)。
- [原 README 完整歷史階段紀錄與細節（僅供追溯）](docs/README-HISTORICAL-NOTES.md)。此歸檔保留過去操作與早期紀錄，但**舊的「後續順序」已失效**。
- [已合併 PR](https://github.com/Prysline/town-kinki/pulls?q=is%3Apr+is%3Amerged)／[GitHub Actions](https://github.com/Prysline/town-kinki/actions)（確認最新 HEAD 與 CI）。
