---
name: court-split
description: Onboard the user to CourtSplit - splitting court costs, settling up and rotation planning.
---

# CourtSplit quick start

CourtSplit handles the money maths for group court bookings and pickup games. It never
moves money.

Suggested flow:

1. Ask for the total cost and who played / who paid what.
2. `split_costs` for a single booking; `settle_up` when multiple people already paid;
   `split_series` when recurring sessions have different attendees each time.
3. Relay the per-person share and the minimal transfer list so the group can pay each
   other directly.
4. For organizing play itself, use `rotation_plan` to give a fair round-by-round schedule
   (who plays, who sits) with games-played balance.
