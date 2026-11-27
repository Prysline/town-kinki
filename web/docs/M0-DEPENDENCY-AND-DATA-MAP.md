# M0 整合依賴圖與 SQLite 權責索引
基準 c18f56e8df68f3c8998c1ba7733500026e34424b。來源為 A～E 61 個逐檔 SHA 核對的靜態掃描，非執行期 trace。回邊與未解析引用只針對目前靜態本地 import；SQL 候選以實際 CREATE 字面值過濾，仍需語義確認、間接呼叫、動態 SQL、外鍵 CASCADE 與歷史表重命名不可由本表排除。
- 檔案 61，本地靜態依賴邊 168，DFS 回邊 0，未解析 0。
- CREATE 表名候選 76，含歷史升級臨時表，不是當前活躍 schema 表數。
- route path 字面值去重 73。
## 1. 實際有向圖（鄰接表）
- appearance.mjs → 無本地靜態 import
- arcade-cardw.mjs → town-storage.mjs
- arcade-dice.mjs → town-storage.mjs
- arcade-donuts.mjs → town-storage.mjs
- arcade-highlow.mjs → town-storage.mjs
- arcade-loto.mjs → town-storage.mjs
- arcade-loto6.mjs → banking.mjs, town-storage.mjs
- arcade-treasure.mjs → engine.mjs, health.mjs, inventory-life.mjs, legacy-item-use.mjs, town-storage.mjs
- b-league-core.mjs → 無本地靜態 import
- b-league.mjs → b-league-core.mjs, banking.mjs, engine.mjs, equipment.mjs, inventory-life.mjs, legacy-item-use.mjs
- banking.mjs → 無本地靜態 import
- c-league.mjs → banking.mjs, engine.mjs, legacy-credit.mjs
- coupon-catalog.mjs → legacy-inventory.mjs
- coupon-redemption.mjs → coupon-catalog.mjs, events.mjs, legacy-inventory.mjs, town-storage.mjs
- crafting.mjs → inventory-life.mjs, legacy-inventory.mjs, legacy-item-use.mjs, town-storage.mjs
- dining-stock.mjs → 無本地靜態 import
- dining.mjs → i18n/meals.zh-TW.mjs
- energy-maxima.mjs → 無本地靜態 import
- engine.mjs → dining.mjs, energy-maxima.mjs, health.mjs, i18n/jobs.zh-TW.mjs
- equipment.mjs → 無本地靜態 import
- event-cockroach.mjs → banking.mjs, training.mjs
- event-effects.mjs → engine.mjs, event-santa-fight.mjs
- event-item-bonus.mjs → inventory.mjs
- event-resident-transfer.mjs → banking.mjs
- event-santa-fight.mjs → inventory-life.mjs
- events.mjs → banking.mjs, event-cockroach.mjs, event-effects.mjs, event-item-bonus.mjs, event-resident-transfer.mjs, event-santa-fight.mjs
- fishing.mjs → legacy-inventory.mjs, legacy-item-use.mjs, town-storage.mjs
- gift-shop.mjs → inventory-life.mjs
- health.mjs → dining.mjs
- housing.mjs → banking.mjs, engine.mjs, town-map.mjs, town-storage.mjs
- i18n/jobs.zh-TW.mjs → 無本地靜態 import
- i18n/meals.zh-TW.mjs → 無本地靜態 import
- inventory-life.mjs → 無本地靜態 import
- inventory.mjs → 無本地靜態 import
- legacy-character.mjs → engine.mjs, training.mjs
- legacy-credit.mjs → inventory.mjs
- legacy-inventory.mjs → inventory-life.mjs, inventory.mjs
- legacy-item-use.mjs → dining.mjs, engine.mjs, health.mjs, inventory.mjs, legacy-inventory.mjs
- onsen-source.mjs → energy-maxima.mjs
- onsen.mjs → banking.mjs, engine.mjs, event-cockroach.mjs, onsen-source.mjs, town-storage.mjs, training.mjs
- osaka-challenge-core.mjs → engine.mjs
- osaka-challenge.mjs → banking.mjs, engine.mjs, inventory-life.mjs, legacy-item-use.mjs, osaka-challenge-core.mjs, town-map.mjs, town-storage.mjs
- osaka-npc-catalog.mjs → osaka-challenge-core.mjs, osaka-npc-reconstruction.mjs
- osaka-npc-reconstruction.mjs → engine.mjs, osaka-challenge-core.mjs
- player-store.mjs → banking.mjs, inventory.mjs, legacy-credit.mjs, rooms.mjs, wholesale.mjs
- private-mail.mjs → 無本地靜態 import
- recycle.mjs → inventory-life.mjs
- retail.mjs → banking.mjs, inventory.mjs, legacy-credit.mjs, legacy-inventory.mjs, legacy-item-use.mjs, vending.mjs
- road-travel.mjs → arcade-treasure.mjs, coupon-redemption.mjs, engine.mjs, inventory-life.mjs, retail.mjs
- rooms.mjs → 無本地靜態 import
- server.mjs → appearance.mjs, arcade-cardw.mjs, arcade-dice.mjs, arcade-donuts.mjs, arcade-highlow.mjs, arcade-loto.mjs, arcade-loto6.mjs, arcade-treasure.mjs, b-league-core.mjs, b-league.mjs, banking.mjs, c-league.mjs, coupon-catalog.mjs, coupon-redemption.mjs, crafting.mjs, dining-stock.mjs, dining.mjs, engine.mjs, equipment.mjs, event-cockroach.mjs, events.mjs, fishing.mjs, gift-shop.mjs, health.mjs, housing.mjs, inventory-life.mjs, inventory.mjs, legacy-credit.mjs, legacy-inventory.mjs, legacy-item-use.mjs, onsen-source.mjs, onsen.mjs, osaka-challenge-core.mjs, osaka-challenge.mjs, osaka-npc-catalog.mjs, player-store.mjs, private-mail.mjs, recycle.mjs, retail.mjs, road-travel.mjs, rooms.mjs, solo-character.mjs, solo-clock.mjs, solo-starter-town.mjs, street-fight.mjs, town-storage.mjs, training.mjs, transport.mjs, vending.mjs, wholesale.mjs
- solo-character.mjs → housing.mjs, town-storage.mjs
- solo-clock.mjs → 無本地靜態 import
- solo-starter-town.mjs → engine.mjs, town-map.mjs, town-storage.mjs
- street-fight.mjs → banking.mjs, engine.mjs, events.mjs
- town-map.mjs → 無本地靜態 import
- town-storage.mjs → engine.mjs, town-map.mjs
- training.mjs → engine.mjs
- transport.mjs → 無本地靜態 import
- vending.mjs → legacy-inventory.mjs
- wholesale.mjs → banking.mjs, legacy-inventory.mjs, rooms.mjs
## 2. 回邊與缺口
{"cycles":[],"unresolved":[]}
## 3. 表與 SQL 直接讀寫候選
| 表 | CREATE 宣告 | FROM/JOIN | 直接寫入 |
|---|---|---|---|
| arcade_cardw_rounds | arcade-cardw.mjs | arcade-cardw.mjs | arcade-cardw.mjs |
| arcade_cardw_state | arcade-cardw.mjs | arcade-cardw.mjs | arcade-cardw.mjs |
| arcade_dice_rounds | arcade-dice.mjs | arcade-dice.mjs | arcade-dice.mjs |
| arcade_donut_rounds | arcade-donuts.mjs | arcade-donuts.mjs | arcade-donuts.mjs |
| arcade_donut_tables | arcade-donuts.mjs | arcade-donuts.mjs | arcade-donuts.mjs |
| arcade_highlow_rounds | arcade-highlow.mjs | arcade-highlow.mjs | arcade-highlow.mjs |
| arcade_highlow_state | arcade-highlow.mjs | arcade-highlow.mjs | arcade-highlow.mjs |
| arcade_instant_loto_rounds | arcade-loto.mjs | arcade-loto.mjs | arcade-loto.mjs |
| arcade_loto6_draws | arcade-loto6.mjs | arcade-loto6.mjs | arcade-loto6.mjs |
| arcade_loto6_state | arcade-loto6.mjs | arcade-loto6.mjs | arcade-loto6.mjs |
| arcade_loto6_tickets | arcade-loto6.mjs | arcade-loto6.mjs | arcade-loto6.mjs |
| arcade_road_trips | road-travel.mjs | onsen.mjs, road-travel.mjs | road-travel.mjs |
| arcade_treasure_rounds | arcade-treasure.mjs | arcade-treasure.mjs | arcade-treasure.mjs |
| b_league_battles | b-league.mjs | b-league.mjs | b-league.mjs |
| b_league_default_gear | b-league.mjs | b-league.mjs | b-league.mjs |
| bank_accounts | banking.mjs | banking.mjs, c-league.mjs | banking.mjs, legacy-character.mjs |
| bank_ledger | banking.mjs | banking.mjs | banking.mjs |
| bank_loans | banking.mjs | banking.mjs, c-league.mjs | banking.mjs |
| bank_tax_assessments | banking.mjs | banking.mjs | banking.mjs |
| bank_tax_state | banking.mjs | banking.mjs | banking.mjs |
| bank_transfers | banking.mjs | banking.mjs | banking.mjs |
| c_league_chars | c-league.mjs | c-league.mjs | c-league.mjs |
| c_league_entries | c-league.mjs | c-league.mjs | c-league.mjs |
| c_league_requests | c-league.mjs | c-league.mjs | c-league.mjs |
| c_league_season | c-league.mjs | c-league.mjs | c-league.mjs |
| character_cockroach_challenges | event-cockroach.mjs | event-cockroach.mjs | event-cockroach.mjs |
| character_coupons | events.mjs | events.mjs | coupon-redemption.mjs, events.mjs, street-fight.mjs |
| character_events | events.mjs | event-cockroach.mjs, events.mjs | event-cockroach.mjs, event-resident-transfer.mjs, events.mjs |
| characters | server.mjs | arcade-cardw.mjs, arcade-dice.mjs, arcade-donuts.mjs, arcade-highlow.mjs, arcade-loto.mjs, arcade-loto6.mjs, arcade-treasure.mjs, b-league.mjs, banking.mjs, c-league.mjs, coupon-redemption.mjs, crafting.mjs, equipment.mjs, event-cockroach.mjs, event-resident-transfer.mjs, events.mjs, fishing.mjs, gift-shop.mjs, housing.mjs, inventory.mjs, legacy-character.mjs, legacy-inventory.mjs, legacy-item-use.mjs, onsen.mjs, osaka-challenge.mjs, player-store.mjs, private-mail.mjs, recycle.mjs, retail.mjs, road-travel.mjs, rooms.mjs, server.mjs, solo-character.mjs, street-fight.mjs, wholesale.mjs | arcade-cardw.mjs, arcade-dice.mjs, arcade-donuts.mjs, arcade-highlow.mjs, arcade-loto.mjs, arcade-loto6.mjs, arcade-treasure.mjs, b-league.mjs, banking.mjs, c-league.mjs, equipment.mjs, event-cockroach.mjs, event-resident-transfer.mjs, events.mjs, fishing.mjs, gift-shop.mjs, housing.mjs, inventory.mjs, legacy-character.mjs, legacy-item-use.mjs, onsen.mjs, osaka-challenge.mjs, player-store.mjs, recycle.mjs, retail.mjs, road-travel.mjs, server.mjs, street-fight.mjs, wholesale.mjs |
| coupon_redemptions | coupon-redemption.mjs | coupon-redemption.mjs, road-travel.mjs | coupon-redemption.mjs |
| crafting_transactions | crafting.mjs | crafting.mjs | crafting.mjs |
| dining_rotation | dining-stock.mjs | dining-stock.mjs | dining-stock.mjs |
| dining_stock | dining-stock.mjs | dining-stock.mjs | dining-stock.mjs |
| equipment_items | equipment.mjs | b-league.mjs, equipment.mjs, osaka-challenge.mjs | b-league.mjs, equipment.mjs |
| equipment_transactions | equipment.mjs | equipment.mjs | equipment.mjs |
| fishing_bait_stock | fishing.mjs | fishing.mjs | fishing.mjs |
| fishing_cooldown | fishing.mjs | fishing.mjs | fishing.mjs |
| fishing_stock_day | fishing.mjs | fishing.mjs | fishing.mjs |
| fishing_transactions | fishing.mjs | fishing.mjs | fishing.mjs |
| gift_events | gift-shop.mjs | gift-shop.mjs | gift-shop.mjs |
| gift_mail_messages | gift-shop.mjs | gift-shop.mjs, private-mail.mjs | gift-shop.mjs, private-mail.mjs |
| gift_mail_messages_v2 | gift-shop.mjs |  | gift-shop.mjs |
| gift_mail_messages_v3 | private-mail.mjs |  | private-mail.mjs |
| house_events | housing.mjs | housing.mjs | housing.mjs |
| house_remodel_events | housing.mjs | housing.mjs | housing.mjs |
| houses | housing.mjs | housing.mjs, player-store.mjs, rooms.mjs, solo-character.mjs, solo-starter-town.mjs, wholesale.mjs | housing.mjs |
| inventory_items | inventory.mjs | inventory.mjs, legacy-inventory.mjs | inventory.mjs, legacy-inventory.mjs, player-store.mjs, retail.mjs |
| inventory_purchases | inventory.mjs | inventory.mjs | inventory.mjs |
| legacy_character_imports | legacy-character.mjs | appearance.mjs, legacy-character.mjs, legacy-inventory.mjs | legacy-character.mjs |
| legacy_inventory_imports | legacy-inventory.mjs | legacy-inventory.mjs | legacy-inventory.mjs |
| legacy_inventory_items | legacy-inventory.mjs | arcade-treasure.mjs, b-league.mjs, coupon-redemption.mjs, crafting.mjs, event-item-bonus.mjs, event-santa-fight.mjs, fishing.mjs, gift-shop.mjs, inventory-life.mjs, inventory.mjs, legacy-credit.mjs, legacy-item-use.mjs, osaka-challenge.mjs, player-store.mjs, recycle.mjs, retail.mjs, road-travel.mjs | arcade-treasure.mjs, b-league.mjs, coupon-redemption.mjs, crafting.mjs, event-santa-fight.mjs, fishing.mjs, gift-shop.mjs, legacy-inventory.mjs, osaka-challenge.mjs, player-store.mjs, recycle.mjs, retail.mjs |
| legacy_item_usage | legacy-item-use.mjs | coupon-redemption.mjs, event-item-bonus.mjs, fishing.mjs, gift-shop.mjs, inventory-life.mjs, legacy-item-use.mjs, osaka-challenge.mjs, player-store.mjs, recycle.mjs, retail.mjs, road-travel.mjs | arcade-treasure.mjs, b-league.mjs, crafting.mjs, event-item-bonus.mjs, event-santa-fight.mjs, fishing.mjs, gift-shop.mjs, legacy-item-use.mjs, osaka-challenge.mjs, player-store.mjs, retail.mjs, road-travel.mjs |
| legacy_item_use_history | legacy-item-use.mjs | legacy-item-use.mjs | legacy-item-use.mjs |
| onsen_visits | onsen.mjs | onsen.mjs | onsen.mjs |
| osaka_battles | osaka-challenge.mjs | osaka-challenge.mjs | osaka-challenge.mjs |
| player_shop_sales | player-store.mjs | player-store.mjs | player-store.mjs |
| player_shop_stock | wholesale.mjs | player-store.mjs, wholesale.mjs | player-store.mjs, wholesale.mjs |
| player_shops | wholesale.mjs | player-store.mjs, wholesale.mjs | wholesale.mjs |
| private_mail_events | private-mail.mjs | private-mail.mjs | private-mail.mjs |
| recycle_listings | recycle.mjs | recycle.mjs | recycle.mjs |
| recycle_transactions | recycle.mjs | recycle.mjs | recycle.mjs |
| retail_day | retail.mjs | retail.mjs | retail.mjs |
| retail_purchases | retail.mjs | inventory.mjs, retail.mjs, road-travel.mjs | retail.mjs |
| retail_stock | retail.mjs | retail.mjs | retail.mjs |
| room_posts | rooms.mjs | rooms.mjs | rooms.mjs |
| room_settings | rooms.mjs | rooms.mjs | rooms.mjs |
| sessions | server.mjs | server.mjs | server.mjs |
| solo_clock | solo-clock.mjs | solo-clock.mjs | solo-clock.mjs |
| street_fights | street-fight.mjs | street-fight.mjs | street-fight.mjs |
| town_maps | town-storage.mjs | town-storage.mjs | town-storage.mjs |
| users | server.mjs | event-resident-transfer.mjs, legacy-character.mjs, server.mjs, solo-character.mjs, street-fight.mjs | legacy-character.mjs, server.mjs, solo-character.mjs |
| vending_rotation | vending.mjs | vending.mjs | vending.mjs |
| vending_stock | vending.mjs | retail.mjs, vending.mjs | retail.mjs, vending.mjs |
| wholesale_day | wholesale.mjs | wholesale.mjs | wholesale.mjs |
| wholesale_stock | wholesale.mjs | wholesale.mjs | wholesale.mjs |
| wholesale_transactions | wholesale.mjs | wholesale.mjs | wholesale.mjs |
## 4. HTTP path 與原始行
GET: state, town/preview, house/visit, shop/visit；其他均 POST，在共用守衛之後 dispatch。靜態資源不在 API 下。
| method | path | server.mjs line |
|---|---|---:|
| GET | /api/state | 646 |
| GET | /api/town/preview | 647 |
| GET | /api/house/visit | 665 |
| GET | /api/shop/visit | 675 |
| POST | /api/register | 692 |
| POST | /api/login | 708 |
| POST | /api/logout | 722 |
| POST | /api/onsen/enter | 730 |
| POST | /api/onsen/leave | 738 |
| POST | /api/solo/character/delete | 748 |
| POST | /api/solo/time/advance | 761 |
| POST | /api/character | 775 |
| POST | /api/events/cockroach/claim | 787 |
| POST | /api/job | 794 |
| POST | /api/job/payment | 801 |
| POST | /api/work | 810 |
| POST | /api/hospital/treat | 844 |
| POST | /api/inventory/legacy/use | 856 |
| POST | /api/inventory/insurance/buy | 864 |
| POST | /api/fishing/bait/buy | 873 |
| POST | /api/fishing/cast | 873 |
| POST | /api/fishing/sell | 873 |
| POST | /api/crafting/make | 893 |
| POST | /api/osaka/play | 904 |
| POST | /api/street-fight/play | 913 |
| POST | /api/c-league/open | 923 |
| POST | /api/c-league/train | 930 |
| POST | /api/c-league/play | 930 |
| POST | /api/arcade/dice/play | 938 |
| POST | /api/arcade/highlow/play | 949 |
| POST | /api/arcade/donuts/draw | 959 |
| POST | /api/arcade/loto/play | 969 |
| POST | /api/arcade/loto6/buy | 980 |
| POST | /api/arcade/loto6/check | 991 |
| POST | /api/arcade/cardw/draw | 1002 |
| POST | /api/arcade/treasure/open | 1013 |
| POST | /api/road/start | 1023 |
| POST | /api/road/arrive | 1033 |
| POST | /api/coupon/redeem | 1040 |
| POST | /api/retail/buy | 1051 |
| POST | /api/b-league/play | 1068 |
| POST | /api/equipment/buy | 1083 |
| POST | /api/equipment/equip | 1083 |
| POST | /api/equipment/sell | 1084 |
| POST | /api/equipment/forge | 1084 |
| POST | /api/mail/send | 1104 |
| POST | /api/mail/delete | 1114 |
| POST | /api/gift/convert | 1120 |
| POST | /api/gift/send | 1120 |
| POST | /api/recycle/sell | 1140 |
| POST | /api/recycle/buy | 1140 |
| POST | /api/shop/price | 1155 |
| POST | /api/shop/buy | 1155 |
| POST | /api/shop/config | 1170 |
| POST | /api/wholesale/buy | 1171 |
| POST | /api/wholesale/return | 1171 |
| POST | /api/meal/eat | 1197 |
| POST | /api/train | 1217 |
| POST | /api/bank | 1250 |
| POST | /api/bank/term | 1250 |
| POST | /api/bank/transfer | 1267 |
| POST | /api/bank/loan/borrow | 1277 |
| POST | /api/bank/loan/payoff | 1277 |
| POST | /api/house/room/config | 1294 |
| POST | /api/house/room/post | 1301 |
| POST | /api/house/room/delete | 1308 |
| POST | /api/house/build | 1315 |
| POST | /api/house/remodel | 1327 |
| POST | /api/house/sell | 1336 |
| POST | /api/house/rename | 1343 |
| POST | /api/solo/map/starter | 1349 |
| POST | /api/map/tile | 1358 |
| POST | /api/move | 1367 |
