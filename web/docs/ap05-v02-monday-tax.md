# AP-05 V02 星期一首次入浴漏稅修正候選

正式基線 c18f56e8 / d462bbd5。V02 #154 Push 46044517626 job 140660297734 實際 995/996，失敗案例 Monday direct entry：前一日稅基 3,000,000，首次入浴將稅基日提前到週一，出浴後應繳 30,000 的紀錄為空，銀行 1,005,000 而非 975,000。來源 town_maker.cgi 207–265；現行 banking.mjs settleWeeklyTax 要求 prior.snapshot_day < today。修正僅限 AP-05：入浴原子交易扣款前，使用既有 settleBankInterestInTransaction，先用前次稅基計息、還款與徵稅，再更新資產快照。重送、交易失敗回滾與浴中唯讀契約保留；不改共用銀行公式、不改 HTTP。新增受控 SQLite 測試，V 獨立真 HTTP 重跑待驗，不改 V 分支。未核定其他功能是否同樣有漏稅，另行稽核。

75cea27a / 326491e2 Push 46064719243、PR 46064726795 完整原始日誌 993/993、fail/skip 0，同 tree。新增 A 窗自己的真 HTTP 受控測試：保留 V02 直接 POST 的原斷言並追加進浴即徵稅、入浴/出浴重送不重複；仍不算 V 獨立驗收。新候選需重跑。