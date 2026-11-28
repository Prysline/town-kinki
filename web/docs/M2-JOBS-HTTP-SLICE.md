# M2 主要系統切片 02｜工作 HTTP 路由

固定正式 c18f56e8df68f3c8998c1ba7733500026e34424b / d462bbd51f94066499ff3c1e084d6fa4532ed47e。與 #161 職業 UI、#159 骰子獨立候選，無合併依賴。

- 搬移既有 POST /api/job、/api/job/payment、/api/work 至 src/routes/jobs.mjs，原 server dispatch 位置、method/Origin/session/入浴 guard 不動。選職與偏好錯誤映射不改。server 原 HttpError、snapshot、sendJson、mutateCharacter、資料庫、時鐘及 catalog 注入；純規則與 banking helper 由原模組直接 import。
- work 仍先 gameNow→calendarDay→獨立 settleBankInterest（原本可獨立提交），再 mutateCharacter callback（energyContext=work，內部恢復時鐘不改），performWork 原 RNG，bonus 帳簿在 salary 之前，同角色保存交易，失敗回滾；原 catch 範圍、提交後 snapshot 與 response 欄位/順序保留。不搬移/重寫 mutateCharacter、銀行或角色核心，不新增重送規則。
- 原 992 測試及 glob 保留；新增既有 server.test.mjs 內真 HTTP/SQLite 故障注入，受控便利商店第五次與99XP，薪資帳簿 trigger 失敗檢查角色、兩筆帳簿、稅基及冷卻回滾，成功後原順序、重送冷卻與重啟。非真人，預期993，候選待CI。
- V-TR-BK-01、V-AP05-BK-01 既有訓練／溫泉漏稅不混入。工作本身原有交易外結息不可被本次變動；跨日首次工作契約仍應另受控補驗。#160 V04 RNG 比對初次紅燈在非骰子的 starter 階段，已移交 V 診斷，不改 V 分支。
- #153/#159 server 相鄰 import／組裝及不同 dispatch 段；#160 只驗證複本不合併。無其他窗 server.test 寫入。正式合併前重新比對所有 PR／未推送範圍。回滾不合併或經授權 revert，不改資料庫。

## 第二批受控跨日契約
新增星期日 23:58 → 星期一 00:00:05 的真 HTTP/SQLite 持久化時鐘測試：300 萬前次稅基、首個工作請求因既有 5 分鐘冷卻拒絕，但原交易外結息 5000 與稅 30000 已提交，銀行 975000，角色其他欄位及冷卻不變，重送不重複結算。此為既有行為釘選而非新稅務政策。與入浴／現金訓練缺陷分開；預期 994 案，待候選 CI。

## 換窗前測試修正
80ed6bef 雙 CI 993/994，唯一 TAP775 在 SQLite null-prototype row 與普通 object 深比時失敗，欄位值一致（含 bank=975000）。同樣的獨立 V05 #163 已以同型態比較通過42步。將 actual 明確展開為普通 object，比較全部原欄位，不改 runtime、不省略任何斷言；修正提交仍須完整 CI。
