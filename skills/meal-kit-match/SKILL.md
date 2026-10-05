---
name: meal-kit-match
description: Onboard the user to MealKitMatch - kit matching, week plans, cost quotes, tier comparison, meal swaps and delivery schedules.
---

# MealKitMatch quick start

MealKitMatch plans meal-kit choices around a diet profile and kit catalog the user
provides (diets, allergies, budget, kit names with prices and options). It computes
and plans only - it never orders any kit, holds no vendor inventory, and moves
no money.

Suggested flow:

1. Ask for the diet profile (diets, allergies, budget per serving, servings,
   meals per week) and the kit catalog, then call `match_kits` for ranked
   matches with rejection reasons.
2. Call `plan_week` with the kit meals for a day-by-day plan, and
   `quote_week` for the weekly cost with shipping.
3. Call `compare_kit_tiers` with plan prices and ratings for a ranked pick.
4. Call `suggest_swaps` for meals clashing with avoids.
5. Call `delivery_schedule` with the first delivery for upcoming dates.
6. If asked to order, pay, or check live kit availability: explain
   MealKitMatch plans only and does not connect to any vendor.
