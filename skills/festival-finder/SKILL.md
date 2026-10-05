---
name: festival-finder
description: Onboard the user to FestivalFinder - computed Hindu festival dates.
---

# FestivalFinder quick start

FestivalFinder computes Hindu festival dates live (2020-2040). All tools
read-only and free.

Flows:

1. "When is X?" -> `festival_details` (name + year).
2. "What's next?" -> `next_festival` (from_date).
3. "List year/month" -> `list_festivals` / `festivals_in_month`.

Dates are computed from tithi rules, approximate within a day - say so.
