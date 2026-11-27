# M1/M2 骰子試點切片 01（候選）

固定正式 base c18f56e8df68f3c8998c1ba7733500026e34424b / d462bbd51f94066499ff3c1e084d6fa4532ed47e；M0 補核見 #155 M0-SUPPLEMENT-01.md。主要系統優先，骰子僅作一次小型架構試點。

- app 原 L2969–2997、3073–3130 搬到 public/modules/arcade-dice.js。單例 factory 於原 pending/busy 位置組裝。getter 在原 state 讀取位置取得即時全域值，setter 在原 await 結束時替換全域；原確認、重送、busy、通知、finally、DOM、計時與繁中保持。原 render 呼叫位置不變。
- server 原 L938–947 handler 移至 src/routes/arcade-dice.mjs；原 dispatch 位置與方法、Origin/Host、session、入浴 guard 不變；一次 gameNow→core→snapshot→sendJson；core catch 範圍不變。無新資料庫、schema、交易、RNG 或稅務規則。
- 原規則 web/src/arcade-dice.mjs、index/style/town-home、server.test、arcade-dice.test 完全不改。home-ui 第55階段原名與斷言保留，搬動來源的斷言改查真實新模組，並新增 app import/factory/state wiring；原測試 glob 不改。
- 本切片不把 M0 全域風險清冊當成已完成 M4。V-AP05-BK-01 為正式基線既有缺陷，由 A/V #156 處理，不混入本候選。
- #146/#153 已檢查實際 patch，骰子段無重疊；共同 import 附近整合前需重查。未取得各窗本機工作樹。
- 回滾：Draft 不合併可隔離；日後合併則 revert 本切片，不回退其他窗、不改 SQLite。未授權合併。
- 驗收待辦：候選同 HEAD/tree 實際 CI、992 原 TAP 名稱與全測試發現、必要瀏覽器與受控行為差分、HTTP 守衛、遺失回應、重啟／交易回滾與 V 獨立驗證。未執行不得報為通過。M3 尚未施工。

## M3 必要測試補件（候選，待 CI）
沿用既有 arcade-dice.test SQLite setup 與 browser-viewport-smoke CDP helpers，避免新框架及重複啟動工具。增加兩項 adapter 交易次序／失敗差分測試及一項實際 Chrome 測試；原 117 檔及 992 案不移動、不刪除，預期 995，實際以 CI 清冊為準。Chrome 受控固定中午及 200000 現金，真實伺服器 RNG、原版建築、CDP 點擊、取消、丟失回應、重試、快轉、三視埠、保存重啟、HTTP 跨來源／非 POST／入浴拒絕。非真人；不假造事件或勝負。測試檔新增案例避開 #146/#153 實際 patch 區段。
