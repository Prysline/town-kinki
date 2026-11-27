# V04｜固定正式版本稅基 literal callsite 稽核
正式 c18f56e8df68f3c8998c1ba7733500026e34424b / d462bbd51f94066499ff3c1e084d6fa4532ed47e。實際逐檔讀取 61 個 src .mjs（含 i18n），搜尋 refreshBankTaxSnapshot、settleBankInterest(InTransaction)、bank_tax_state；屬 literal callsite 靜態稽核，未證明全部動態 SQL / 間接資產副作用。結果：
- banking L166–239：核心舊稅基評估後刷新；arcade-loto6 L151 先結算。
- b-league L95→122、c-league L95→115/L137→152、osaka-challenge L114→127、street-fight L108→138：先結算再刷新（需保留路由 today 參數與 transaction）。
- event-resident-transfer L28–29→48–49：先結算雙方再刷新。
- events L189–190：一般日事件在 server.snapshot L342 的銀行結算後；不能把單獨測試核心當直接 HTTP 入口。
- onsen L129–130：已確認 V-AP05-BK-01；A #156 候選獨立 V #157 雙999/999，正式未合併。
- server L1231→1242：信用先結算，現金分支未先結算，已確認 V-TR-BK-01。L817 工作先結算；L342→441 snapshot 順序正常。
- event-cockroach L124–125：直接領獎在一般 snapshot 前刷新，20秒窗可能跨星期一午夜。新增 strict HTTP 重現，使用真事件核心受控建立 #44（非自然低機率證據），時鐘 週日23:59:50→週一00:00:05；領獎10001，應用週日300萬稅基、稅30000、銀行975000。未取得 CI 不列確認缺陷。
- 其餘 50 檔無上述 literal；這不等於沒有資產/銀行利息順序或間接副作用風險。
不改正式規則，不移除任何 V02/V03 strict 斷言。

## 已取得實際 V04 結果
固定 V runtime/測試候選 acaff08a9313422018738582ba5dc97b4ebe333d / e684d2d4122505a408c43e837c846e8e1769bb4f，合成 3b70252e1d9167158b7ed7e5135bc7e8463888ef 同 tree。Push 46073622403/job140756133670、PR 46073629112/job140756157076：雙996/999、fail3、其餘0，TAP983/985/986。逐檔 46073622507/job140756133743：122檔999，artifact15233882452；未下載該新版ZIP，不宣稱其 bytes 已查。V-EV-BK-01 已確認 P1，雙實際 reward10001/tax0/bank1005000/新稅基3015001，應稅30000/bank975000，原 V04 test:106 嚴格紅燈。#154 留言7228945434、A #156留言7228946078、M #155留言7228946570。兩項 V03 缺陷仍存在於正式；#156 修復候選已雙999/999獨立驗證，未合併。
V04 #160 最新實際驗證 b455b45fe237c399de6130af42595f7177cb9336 / 05d1394671dda87b8889c52634f3853eda67c4e3：獨立46073791370/job140756687928，36/36 HTTP SQLite RNG、7/7真Chrome DOM SQLite、1440/768/375；M #159 eda610cc/9860b406 對固定正式。一般Push46073791433/job140756688266、PR46073796224/job140756703740 雙995/995。M 原992 TAP名稱及相對順序全部保留、117測試檔。先前 V工具兩次紅燈保留（初始化RNG假設、stdout收集競爭），修正工具非runtime。非真人。
V05 #163 固定M #162 80ed6bef/b040fa51，V a12bf654c35045c3237f49acff4bf3ec3f876a96 / 8fb6a3defc131e1a353c4390b382629fa52c0a04；獨立46074250838/job140758131958 42/42 HTTP/SQLite/RNG 差分通過。M 該候選雙993/994，TAP775 SQLite prototype mismatch 已通知 M；不能代替 M 最新完整CI。另 #164 職業介紹所真Chrome差分候選待實際結果。
以上結果只對應所列確切 SHA/tree。本文件修正靜態命中計數筆誤（61檔中11命中/50無命中），不修改測試或遊戲程式。