---
name: hvacrescue
description: Onboard the user to HvacRescue - symptom triage, slot finder, job quotes, tech comparison, dispatch drafts and tuneup plans.
---

# HvacRescue quick start

HvacRescue plans HVAC rescue visits around symptoms and pricebooks the user provides
(symptom names, day windows, job names with prices and minutes). It computes and plans
only - it never books with any tech, holds no tech inventory, and moves no money.

Suggested flow:

1. Ask for the symptom (no cool, no heat, noises...) and call `triage_symptom`
   for severity plus safety steps. Gas smell or CO alarm: tell them to leave
   and call emergency services first.
2. Ask for the tech's availability windows (weekday, start, end) and the
   pricebook (name, price, minutes).
3. Call `find_slots` with the job length for open starts every 30 min.
4. Call `quote_job` for the job plus add-ons, and `compare_techs`
   with their price, rating and distance numbers for a ranked pick.
5. Call `build_dispatch_request` for a draft message to send the tech.
   Never claim the visit is booked.
6. Call `tuneup_schedule` with the last tuneup for future tuneup dates.
7. If asked to book, pay, or check live tech availability: explain
   HvacRescue plans only and does not connect to any tech.
