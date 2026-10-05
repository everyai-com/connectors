---
name: recipe-scale
description: Onboard the user to RecipeScale - scaling recipes, converting kitchen units and merging shopping lists.
---

# RecipeScale quick start

RecipeScale does the kitchen arithmetic so nobody has to: scale a recipe to the
serving count you actually need, convert between cooking units (cups, grams,
tablespoons and more), merge shopping lists, and work out cost per serving. It
never orders or buys anything.

Suggested flow:

1. Ask for the recipe and the serving counts if the user has not given them.
2. `scale_recipe` multiplies every amount and returns friendly measures; items
   like "salt to taste" pass through untouched.
3. `convert_units` for a one-off conversion - mention that cups to grams needs a
   known ingredient (flour, sugar, brown sugar, butter, water, milk, rice, oats,
   cocoa, honey).
4. `merge_shopping_list` when the user has several lists to add up; quantities
   for the same item are summed in a common unit.
5. `cost_per_serving` when the user wants the budget: it totals the priced
   ingredients and divides by the servings.
