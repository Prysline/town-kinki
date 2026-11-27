# V04｜固定正式版本稅基 literal callsite 稽核
正式 c18f56e8df68f3c8998c1ba7733500026e34424b / d462bbd51f94066499ff3c1e084d6fa4532ed47e。實際逐檔讀取 61 個 src .mjs（含 i18n），搜尋 refreshBankTaxSnapshot、settleBankInterest(InTransaction)、bank_tax_state；屬 literal callsite 靜態稽核，未證明全部動態 SQL / 間接資產副作用。結果：
- banking L166–239：核心舊稅基評估後刷新；arcade-loto6 L151 先結算。
- b-league L95→122、c-league L95→115/L137→152、osaka-challenge L114→127、street-fight L108→138：先結算再刷新（需保留路由 today 參數與 transaction）。
- event-resident-transfer L28–29→48–49：先結算雙方再刷新。
- events L189–190：一般日事件在 server.snapshot L342 的銀行結算後；不能把單獨測試核心當直接 HTTP 入口。
- onsen L129–130：已確認 V-AP05-BK-01；A #156 候選獨立 V #157 雙999/999，正式未合併。
- server L1231→1242：信用先結算，現金分支未先結算，已確認 V-TR-BK-01。L817 工作先結算；L342→441 snapshot 順序正常。
- event-cockroach L124–125：直接領獎在一般 snapshot 前刷新，20秒窗可能跨星期一午夜。新增 strict HTTP 重現，使用真事件核心受控建立 #44（非自然低機率證據），時鐘 週日23:59:50→週一00:00:05；領獎10001，應用週日300萬稅基、稅30000、銀行975000。未取得 CI 不列確認缺陷。
- 其餘 51 檔無上述 literal；這不等於沒有資產/銀行利息順序或間接副作用風險。
不改正式規則，不移除任何 V02/V03 strict 斷言。
