# GM-02 A-03 HTTP candidate
A-02 58f4b27e / 0c777a21 raw Push/PR 1000/1000. Add isolated routes/horse-race.mjs and minimal server composition only; no dice dispatch edits, no shared test changes. M coordination #155.

POST /api/horse-race/quote, /start, /step reuse authenticated same-origin JSON gate, gameNow, local calendarDay and existing snapshot. Client-supplied clock, cash, odds, winner, RNG, user ID are ignored. State horseRace contains available, busy, own active/latest and public top10; no other player's cards. Normal snapshot retains existing settlement; no new global restriction on existing resident APIs. Bath guard applies. Existing single-player map editor can place original 競馬 symbol; multiplayer map is admin-owned. No default map overwrite.

V02 #154 showed Monday first direct bath entry can advance tax base before old tax settlement. GM-02 now uses existing settleBankInterestInTransaction before cash mutations within own transaction, no nested BEGIN. Added independent Monday regression and solo/multi real HTTP tests; controlled clock/map fixtures identified. UI and original display timing implemented in A-04; see UI document. User decision A recorded below; no claim of formal completion or merge.

2026-11-28 使用者明確選 A：原版 basic.cgi 636–675, 852–878 逾180秒先清舊鎖，之後無效投注也不恢復舊賽事。不退費、不記排名。本人真名單及安全契約先驗證；正常投注錯誤以 typed error + SQLite savepoint 回滾新投注/稅務，僅提交舊鎖棄權及拒絕收據。同一失敗請求重送不清除其他賽事；SQL/RNG/權限異常仍全回滾。原版 Perl 實際檔案鎖差分與 SQLite 邊界/拒絕/重送/故障測試新增。非原版漏洞放寬不在授權內。
