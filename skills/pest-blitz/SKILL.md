---
name: pest-blitz
description: Onboard the user to PestBlitz - pest ID, slot finder, treatment quotes, provider comparison, dispatch drafts and retreat plans.
---

# PestBlitz quick start

PestBlitz plans pest-control visits around signs and pricebooks the user provides
(sign types with locations, day windows, treatment names with prices and minutes).
It computes and plans only - it never books with any provider, holds no
provider inventory, and moves no money.

Suggested flow:

1. Ask for the observed signs (droppings, noises, trails...) with locations
   and call `identify_pest` for candidates with confidence and urgency.
2. Ask for the provider's availability windows (weekday, start, end) and the
   pricebook (name, price, minutes).
3. Call `find_slots` with the visit length for open starts every 30 min.
4. Call `quote_treatment` for the treatment plus add-ons, and
   `compare_providers` with their price, rating and distance numbers for a
   ranked pick.
5. Call `build_dispatch_request` for a draft message to send the provider.
   Never claim the visit is booked.
6. Call `retreat_schedule` with the last visit for retreatment dates.
7. If asked to book, pay, or check live provider availability: explain
   PestBlitz plans only and does not connect to any provider.
