# M1 主要系統切片 01｜職業介紹所前端

基準 c18f56e8df68f3c8998c1ba7733500026e34424b / d462bbd51f94066499ff3c1e084d6fa4532ed47e。骰子 #159 eda610cc / 9860b406 已雙995/995，V 獨立差分另記；本切片直接以正式基線另立 PR，避免累積或偷渡未合併候選。

選擇理由：主要工作／職業／薪資循環，先拆純 UI 邊界；119 行職業條件、搜尋、資格、待遇、應徵渲染與其他領域耦合小；既有 source/HTTP/Chrome 保障成熟。V-TR-BK-01 與 V-AP05-BK-01 為基線既有訓練／溫泉／稅務缺陷，不混入修正。server、engine、銀行、薪資交易與 snapshot 保留原狀。後續 HTTP 工作路由須維持先獨立結息、callback 內 bonus→salary 帳簿、energyContext=work、提交後 snapshot 的既有契約，另批查證。

- app 原 L1361–1479 搬至 public/modules/jobs.js。factory 以 getter 取得現有 state，兩個同步渲染函式各在入口取得目前狀態（無 await 或共享狀態副本）；原 action、money、labels、el/text 共用；翻譯從現有模組 import。保留 renderJobs 原三個呼叫/事件掛載點及原 job/payment listener/忙碌控制，不先建新全站 core 框架。
- 不改 HTML/CSS、17 欄能力要求、非零門檻、階級星號、展開保留、搜尋／篩選、應徵資格、薪資選項、API、遊戲公式、資料庫、時鐘或 RNG。
- home-ui 原測試全部保留，僅對移出來源之斷言改讀真實模組、增加 app wiring；原 server/原版差分測試保留。新增真 Chrome 隔離 DB 受控中午及警官資格 fixture（沿用正式第48階段），三視埠、150職業、搜尋／篩選、展開、實際應徵與薪資偏好。非真人，待候選 CI。
- #146/#153/#159 共同 app/home-ui/browser 實際 patch 核對：職業段不重疊，import 附近及測試讀檔區相鄰需整合時重核；#154/#156/#157/#158 不重疊。各窗未推送 worktree 不可見。M 未接管任何其他窗分支。
- 回滾不合併或經授權 revert 本切片，不需要 DB 轉換；不自行合併。預期基線992+1=993，須以實際 CI 為準。正式基線、M/V 獨立驗證及真人分開。
