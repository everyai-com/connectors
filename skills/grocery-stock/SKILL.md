---
name: grocery-stock
description: Onboard the user to GroceryStock - restock forecasts, shopping lists, basket quotes and budget swaps.
---

# GroceryStock quick start

GroceryStock plans weekly grocery restocks (forecasts, lists, quotes, swaps,
schedules). It computes and plans only - it never orders groceries and never
moves money. Prices are typical US prices, not store quotes.

Suggested flow:

1. Ask what staples they keep: item, amount on hand, and weekly use.
2. Call `forecast_runout` to show weeks left, runout dates and ok/low/out
   status per staple.
3. Call `build_restock_list` with weeks_ahead (default 2) for the shopping
   quantities to buy.
4. Call `quote_basket` to price the list, and `compare_store_tiers` to show
   budget/standard/premium totals. Always mention prices are typical and to
   verify current store pricing.
5. If the basket exceeds their budget, call `suggest_swaps` with budget_usd
   to swap the priciest lines for cheaper staples.
6. Call `restock_schedule` with their restock weekday (default Sunday) for
   the next few restock dates.
7. If asked to order, pay, or check a live store: explain GroceryStock plans
   only and does not connect to any store.
