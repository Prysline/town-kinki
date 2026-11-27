# M0 public 依賴與契約索引 A
基準 c18f56e8df68f3c8998c1ba7733500026e34424b。逐檔 SHA 核對，靜態文字索引；動態 DOM、CSS selector、間接 API 及翻譯內容語義另行驗證。不可用字面值計數替代行為測試。
## web/public/app.js
- imports: ./battle-item-translations.js, ./energy-visibility.js, ./event-gift-display-translations.js, ./game-display-translations.js, ./item-comment-translations.js, ./item-cooldown.js, ./item-translations.js, ./loto6-display.js, ./retail-item-translations.js, ./shop-effects.js, ./time-theme.js, ./town-home.js
- exports: —
- HTML IDs (0): —
- DOM literal references (312): arcade-cardw-course, arcade-cardw-history, arcade-cardw-quote, arcade-cardw-result, arcade-cardw-status, arcade-cardw-submit, arcade-dice-guess, arcade-dice-history, arcade-dice-quote, arcade-dice-result, arcade-dice-stake, arcade-dice-status, arcade-dice-submit, arcade-donuts-history, arcade-donuts-mode, arcade-donuts-quote, arcade-donuts-result, arcade-donuts-status, arcade-donuts-submit, arcade-donuts-table, arcade-highlow-guess, arcade-highlow-history, arcade-highlow-quote, arcade-highlow-result, arcade-highlow-status, arcade-highlow-submit, arcade-highlow-table, arcade-loto-digit-, arcade-loto-history, arcade-loto-quote, arcade-loto-result, arcade-loto-stake, arcade-loto-status, arcade-loto-submit, arcade-loto6-buy, arcade-loto6-check, arcade-loto6-history, arcade-loto6-number-, arcade-loto6-quote, arcade-loto6-random, arcade-loto6-result, arcade-loto6-status, arcade-treasure-box, arcade-treasure-history, arcade-treasure-open, arcade-treasure-quote, arcade-treasure-result, arcade-treasure-status, attributes, auth, b-league-history, b-league-ranks, b-league-result, b-league-status, bank, bank-available-balance, bank-available-cash, bank-form, bank-interest-day, bank-ledger-filter, bank-ledger-list, bank-tax-status, bank-transfer-form, bank-transfer-panel, body-energy, brain-energy, c-league-cost, c-league-fields, c-league-fighter, c-league-history, c-league-image, c-league-image-preview, c-league-name, c-league-open, c-league-payment, c-league-play, c-league-rankings, c-league-result, c-league-status, c-league-train, character-name, classroom-lessons, classroom-status, cockroach-challenge, cockroach-claim, cockroach-remaining, compact-bank, compact-body-bar, compact-body-energy, compact-brain-bar, compact-brain-energy, compact-character-name, compact-money, compact-status, condition-status, cooldown, coupon-redemptions, coupon-rewards, coupon-shop-status, crafting-history, crafting-quantity, crafting-recipes, crafting-select, crafting-status, crafting-submit, create, create-form, create-submit, current-job, current-town, equipment-goods, equipment-history, equipment-inventory, equipment-status, event-alert, event-coupon-count, event-kpoint, event-popup, event-popup-body, event-popup-claim, event-popup-close, event-popup-title, facility-pane-, facility-shortcuts, facility-tab-, facility-tabs, fishing-bait-goods, fishing-bait-select, fishing-cast, fishing-cooldown, fishing-history, fishing-sell, fishing-sell-select, fishing-shop-status, fishing-status, game, gift-events, gift-sources, gift-status, gym-lessons, gym-status, health-event-history, health-status, home-work, hospital-cost, hospital-diagnosis, hospital-treat, house-count, house-design, house-design-cost, house-events, house-form, house-interior, house-payment, house-preview, house-quote, house-remodel-events, house-submit, house-target, hunger-status, insurance-buy, insurance-buy-form, insurance-purchases, insurance-quantity, insurance-quote, insurance-status, inventory-insurance-inline, inventory-panel, inventory-summary, job-count, job-experience, job-filter, job-level-bar, job-level-progress, job-level-xp, job-mastery-status, job-next-level, job-search, jobs, landing, legacy-icon-help, legacy-icon-image, legacy-icon-panel, legacy-icon-toggle, legacy-inventory-list, legacy-item-use-history, loan-borrow, loan-borrow-form, loan-payoff, loan-plan, loan-quote, loan-status, login-form, logout, mail-compose, mail-messages, mail-status, map-edit-feedback, map-edit-status, map-edit-toggle, map-editor, map-palette, map-selection, map-source, mastered-job, meal-list, meal-menu, meal-menu-day, meal-status, measurements, mode, money, onsen-active-gains, onsen-active-receipt, onsen-active-screen, onsen-active-title, onsen-background, onsen-body-countdown, onsen-brain-countdown, onsen-leave, onsen-options, onsen-status, onsen-time-advance, osaka-history, osaka-modes, osaka-result, osaka-status, owned-houses, physique-status, preview-map, preview-map-status, preview-town, profile-tab-, profile-view-tabs, recycle-history, recycle-market, recycle-sellable, recycle-status, refresh, register-form, residents, result-dialog, result-dialog-close, result-dialog-message, result-dialog-title, retail-items, retail-purchases, retail-search, retail-shop-select, retail-status, road-travel-arrive, road-travel-history, road-travel-quote, road-travel-result, road-travel-start, road-travel-status, road-travel-to, road-travel-vehicle, room-body, room-close, room-config-form, room-nav, room-owner, room-panel, room-settings, room-slot-inputs, room-title, salary-payment, school-lessons, school-status, solo-character-name, solo-continue, solo-delete-ack, solo-delete-details, solo-delete-form, solo-delete-name, solo-delete-submit, solo-game-time, solo-lobby, solo-play-guide, solo-starter-create, solo-starter-town, solo-time-panel, solo-wait-hints, station-heading, station-status, street-fight-history, street-fight-play, street-fight-status, sum-, term-balance, term-cancel, term-deposit-form, town-map, towns, vending-items, vending-purchases, vending-status, wholesale-category, wholesale-goods, wholesale-history, wholesale-house-select, wholesale-inventory, wholesale-search, wholesale-shop-save, wholesale-shop-summary, wholesale-shop-title, wholesale-status, work, work-cost-status, work-count, work-payday-status
- API literal references (40): arcade/cardw/draw, arcade/dice/play, arcade/donuts/draw, arcade/highlow/play, arcade/loto/play, arcade/loto6/buy, arcade/loto6/check, arcade/treasure/open, b-league/play, bank/transfer, c-league/, coupon/redeem, crafting/make, equipment/, fishing/, gift/, house/visit?, inventory/insurance/buy, inventory/legacy/use, logout, mail/delete, mail/send, map/tile, onsen/enter, onsen/leave, osaka/play, recycle/, retail/buy, road/arrive, road/start, shop/buy, shop/config, shop/price, shop/visit?houseId=, solo/character/delete, solo/time/advance, state, street-fight/play, town/preview?townId=, wholesale/
- global state: 13: let state = null;；14: let requestedLegacyIconUrl = null;；15: let loadedLegacyIconUrl = null;；76: let feedbackOrigin=null;；77: let inlineFeedback=null;；78: let resultReturnFocus=null;；150: let selectedMapCell = null;；151: let selectedHouseSpot = null;；152: let selectedMapTown = null;；153: let mapEditBusy = false;；154: let activeRoom = null;；156: let soloAtHome=false;；158: let syncedGameMs=Date.now();；159: let syncedAtRealMs=Date.now();；168: let timeAdvanceBusy=false;；194: let publicPreview=null;；195: let previewLoading=false;；199: let activeProfileView="status";；289: let activeFacilityTab="jobs";；290: let dismissedEventKey=null;；591: let pendingPlayerStorePurchase=null;；1156: let roadTravelBusy=false;；1157: let pendingRoadStart=null;；1524: let pendingLegacyUse=null;；1544: let inventoryCooldownSyncBusy=false;；1545: const inventoryCooldownSyncRequested=new Set();；1593: const collapsedInventoryCategories=new Set();；1828: const couponPendingMemory=new Map();；1830: let couponRedemptionBusy=false;；2047: let pendingRetailPurchase=null;；2154: const shopCartSelections=new Map();；2293: let pendingTreasureOpen=null;；2294: let treasureBusy=false;；2379: let pendingMultiCard=null;；2380: let multiCardBusy=false;；2469: let pendingLoto6Purchase=null;；2470: let loto6Busy=false;；2596: let pendingInstantLoto=null;；2597: let instantLotoSubmitting=false;；2711: let pendingArcadeDonut=null;；2712: let arcadeDonutSubmitting=false;；2811: let pendingArcadeHighLow=null;；2812: let arcadeHighLowSubmitting=false;；2899: let streetFightPending=null;；2900: let streetFightBusy=false;；2969: let pendingArcadeDice=null;；2970: let arcadeDiceSubmitting=false;；2998: let osakaPending=null,osakaBusy=false,osakaOwner=null;；3132: let pendingFishingAction=null;；3236: let pendingCraftingAction=null;；3370: let pendingVendingPurchase=null;；3432: let pendingEquipmentAction=null;；3459: let pendingBLeague=null,bLeagueBusy=false,bLeagueOwner=null;；3663: let pendingGiftAction=null;；3788: let pendingMailAction=null;；3849: let pendingRecycleAction=null;；3942: let selectedWholesaleHouseId=null;；3943: let pendingWholesaleOrder=null;；4151: let trainingTileUpdates=[];；4152: let trainingExpiryRefreshBusy=false;；4153: const trainingExpiryRefreshRequested=new Set();；4214: const trainingPaymentChoices=new Map();；4462: let cLeagueOwner=null,cLeagueBusy=false,cLeaguePending=null;；4547: let onsenBusy=false;；4548: let pendingOnsenEntry=null;；4863: let pendingTransfer = null;；4899: let pendingInsurancePurchase=null;；5001: let soloDeleteBusy=false;；5193: let savingSalaryPayment=false;
- timers: 3064: setInterval(()=>{；4931: setInterval(updateCockroachCountdown,250);；5053: setInterval(()=>{；5214: setInterval(async () => {
- entry tags: —

## web/public/battle-item-translations.js
- imports: —
- exports: BATTLE_CATEGORY_ZH_TW, BATTLE_ITEM_COMMENTS_ZH_TW, BATTLE_ITEM_ZH_TW, BATTLE_MONSTER_ZH_TW, displayBattleItemCategory, displayBattleItemName, displayBattleMonsterName
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/coupon-translations.js
- imports: —
- exports: COUPON_REWARD_NAMES_ZH_TW, displayCouponRewardCategory, displayCouponRewardName
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/crafting-translations.js
- imports: —
- exports: CRAFTING_DISPLAY_CATEGORIES_ZH_TW, CRAFTING_DISPLAY_NAMES_ZH_TW, displayCraftingCategory, displayCraftingName
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/energy-visibility.js
- imports: —
- exports: shouldShowCompactEnergy
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/event-gift-display-translations.js
- imports: ./retail-item-translations.js
- exports: EVENT_ONLY_ITEM_NAMES_ZH_TW, displayEventDescription, displayGiftErrorMessage
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/fishing-translations.js
- imports: —
- exports: FISHING_CATCHES_ZH_TW, FISHING_CATEGORIES_ZH_TW, displayFishingCatchCategory, displayFishingCatchName
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/game-display-translations.js
- imports: ./retail-item-translations.js
- exports: displayBankLedgerAction, displayGameError, displayJobName
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/index.html
- imports: —
- exports: —
- HTML IDs (408): arcade-cardw-course, arcade-cardw-history, arcade-cardw-panel, arcade-cardw-quote, arcade-cardw-result, arcade-cardw-status, arcade-cardw-submit, arcade-dice-guess, arcade-dice-history, arcade-dice-panel, arcade-dice-quote, arcade-dice-result, arcade-dice-stake, arcade-dice-status, arcade-dice-submit, arcade-donuts-history, arcade-donuts-mode, arcade-donuts-panel, arcade-donuts-quote, arcade-donuts-result, arcade-donuts-status, arcade-donuts-submit, arcade-donuts-table, arcade-highlow-guess, arcade-highlow-history, arcade-highlow-panel, arcade-highlow-quote, arcade-highlow-result, arcade-highlow-status, arcade-highlow-submit, arcade-highlow-table, arcade-loto-digit-1, arcade-loto-digit-2, arcade-loto-digit-3, arcade-loto-digit-4, arcade-loto-digit-5, arcade-loto-digit-6, arcade-loto-history, arcade-loto-panel, arcade-loto-quote, arcade-loto-result, arcade-loto-stake, arcade-loto-status, arcade-loto-submit, arcade-loto6-buy, arcade-loto6-check, arcade-loto6-history, arcade-loto6-number-1, arcade-loto6-number-2, arcade-loto6-number-3, arcade-loto6-number-4, arcade-loto6-number-5, arcade-loto6-number-6, arcade-loto6-panel, arcade-loto6-quote, arcade-loto6-random, arcade-loto6-result, arcade-loto6-status, arcade-treasure-box, arcade-treasure-history, arcade-treasure-open, arcade-treasure-panel, arcade-treasure-quote, arcade-treasure-result, arcade-treasure-status, attributes, attributes-panel, auth, b-league-history, b-league-panel, b-league-ranks, b-league-result, b-league-status, bank, bank-available-balance, bank-available-cash, bank-form, bank-interest-day, bank-ledger-filter, bank-ledger-list, bank-panel, bank-tax-status, bank-transfer-form, bank-transfer-panel, body-energy, brain-energy, c-league-cost, c-league-fields, c-league-fighter, c-league-history, c-league-image, c-league-image-preview, c-league-name, c-league-open, c-league-panel, c-league-payment, c-league-play, c-league-rankings, c-league-result, c-league-status, c-league-train, c-league-training, character-name, classroom-lessons, classroom-panel, classroom-payment, classroom-payment-balance, classroom-payment-note, classroom-status, cockroach-challenge, cockroach-claim, cockroach-remaining, compact-bank, compact-body-bar, compact-body-energy, compact-brain-bar, compact-brain-energy, compact-character-name, compact-money, compact-status, condition-status, cooldown, coupon-redemptions, coupon-rewards, coupon-shop-status, crafting-history, crafting-panel, crafting-quantity, crafting-recipes, crafting-select, crafting-status, crafting-submit, create, create-form, create-submit, current-job, current-town, dining-panel, equipment-goods, equipment-history, equipment-inventory, equipment-panel, equipment-status, event-alert, event-coupon-count, event-kpoint, event-panel, event-popup, event-popup-body, event-popup-claim, event-popup-close, event-popup-title, facilities-title, facility-pane-bank, facility-pane-battle, facility-pane-dining, facility-pane-events, facility-pane-games, facility-pane-hospital, facility-pane-house, facility-pane-jobs, facility-pane-mail, facility-pane-onsen, facility-pane-shops, facility-pane-training, facility-shortcuts, facility-tab-bank, facility-tab-battle, facility-tab-dining, facility-tab-events, facility-tab-games, facility-tab-hospital, facility-tab-house, facility-tab-jobs, facility-tab-mail, facility-tab-onsen, facility-tab-shops, facility-tab-training, facility-tabs, fishing-bait-goods, fishing-bait-select, fishing-cast, fishing-cooldown, fishing-history, fishing-panel, fishing-sell, fishing-sell-select, fishing-shop-status, fishing-status, game, gift-events, gift-panel, gift-sources, gift-status, gym-lessons, gym-panel, gym-payment, gym-payment-balance, gym-payment-note, gym-status, health-event-history, health-status, home-c-league, home-street-fight, home-work, hospital-cost, hospital-diagnosis, hospital-panel, hospital-treat, house-count, house-design, house-design-cost, house-events, house-form, house-interior, house-payment, house-preview, house-quote, house-remodel-events, house-submit, house-target, housing-panel, hunger-status, insurance-buy, insurance-buy-form, insurance-purchases, insurance-quantity, insurance-quote, insurance-status, inventory-general-usage, inventory-history-details, inventory-insurance-inline, inventory-insurance-management, inventory-panel, inventory-purchased-gift-usage, inventory-received-gift-usage, inventory-source-info, inventory-summary, job-count, job-experience, job-filter, job-level-bar, job-level-progress, job-level-xp, job-mastery-status, job-next-level, job-search, jobs, jobs-panel, landing, legacy-icon-help, legacy-icon-image, legacy-icon-panel, legacy-icon-toggle, legacy-inventory-list, legacy-item-use-history, loan-borrow, loan-borrow-form, loan-payoff, loan-plan, loan-quote, loan-status, login-form, logout, mail-compose, mail-message, mail-messages, mail-panel, mail-recipient, mail-status, map-edit-feedback, map-edit-status, map-edit-toggle, map-editor, map-palette, map-selection, map-source, map-workspace, mastered-job, meal-list, meal-menu, meal-menu-day, meal-status, measurements, mode, money, onsen-active-gains, onsen-active-receipt, onsen-active-screen, onsen-active-title, onsen-background, onsen-body-countdown, onsen-brain-countdown, onsen-leave, onsen-options, onsen-panel, onsen-status, onsen-time-advance, osaka-history, osaka-modes, osaka-panel, osaka-result, osaka-status, owned-houses, physique-status, physique-summary-title, player-summary, preview-heading, preview-map, preview-map-status, preview-town, profile-tab-attributes, profile-tab-inventory, profile-tab-status, profile-view-tabs, recycle-history, recycle-market, recycle-panel, recycle-sellable, recycle-status, refresh, register-form, residents, result-dialog, result-dialog-close, result-dialog-message, result-dialog-title, retail-items, retail-panel, retail-purchases, retail-search, retail-shop-select, retail-status, road-travel-arrive, road-travel-history, road-travel-panel, road-travel-quote, road-travel-result, road-travel-start, road-travel-status, road-travel-to, road-travel-vehicle, room-body, room-close, room-config-form, room-nav, room-owner, room-panel, room-settings, room-slot-inputs, room-title, salary-payment, school-lessons, school-panel, school-payment, school-payment-balance, school-payment-note, school-status, solo-character-name, solo-continue, solo-delete-ack, solo-delete-details, solo-delete-form, solo-delete-name, solo-delete-submit, solo-game-time, solo-lobby, solo-play-guide, solo-play-guide-title, solo-starter-create, solo-starter-town, solo-time-panel, solo-wait-hints, station-heading, station-status, street-fight-history, street-fight-panel, street-fight-play, street-fight-status, street-fight-title, sum-body, sum-brain, sum-other, term-balance, term-cancel, term-deposit-form, town-map, town-panel, towns, vending-items, vending-panel, vending-purchases, vending-status, wholesale-category, wholesale-goods, wholesale-history, wholesale-house-select, wholesale-inventory, wholesale-panel, wholesale-search, wholesale-shop-save, wholesale-shop-summary, wholesale-shop-title, wholesale-status, work, work-cost-status, work-count, work-payday-status
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: <link rel="stylesheet" href="/static/style.css"> <script type="module" src="/static/app.js">

## web/public/item-comment-translations.js
- imports: ./battle-item-translations.js
- exports: ORIGINAL_ITEM_COMMENTS_ZH_TW, displayOriginalItemComment
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/item-cooldown.js
- imports: —
- exports: formatItemCountdown, itemCooldownRemaining, itemCooldownText, itemRemainingDurability
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —

## web/public/item-translations.js
- imports: —
- exports: EQUIPMENT_CATEGORY_ZH_TW, EQUIPMENT_ZH_TW, VENDING_ZH_TW, displayEquipmentCategory, displayEquipmentName, displayKnownItemCategory, displayKnownItemName, displayVendingName
- HTML IDs (0): —
- DOM literal references (0): —
- API literal references (0): —
- global state: —
- timers: —
- entry tags: —