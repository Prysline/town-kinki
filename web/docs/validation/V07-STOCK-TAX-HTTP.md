# V07｜股票 HTTP 與週一稅務原子性
固定 A #158 b9a7b6c2428111799c471e9770aa94b475a35bbf / 6b6aa003da2cba5cf59e6933df063bc09e986578。獨立真 HTTP、受控時鐘/RNG/富裕角色與 SQL trigger 故障，不是真人。星期日開窗，星期一首次 POST 股票買入，先測 history insert fault 全庫回滾再同 ID 重試；舊稅基300萬、應繳30000、銀行975000、現金1975000、股票排除新稅基295萬。另測 receipt 衝突、重啟重送、城鎮返回 receipt 故障與重送、GET 不觸發股票行情。沿用 V05 已跑過的隔離 server/SQLite 觀測 helper。正式與 A/M 不修改；CI 未完成，不能宣稱通過，禁止合併。
