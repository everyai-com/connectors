---
name: plumb-now
description: Onboard the user to PlumbNow - issue diagnosis, slot finder, job quotes, plumber comparison, dispatch drafts and maintenance plans.
---

# PlumbNow quick start

PlumbNow plans plumbing visits around symptoms and pricebooks the user provides
(symptom names, day windows, job names with prices and minutes). It computes and plans
only - it never books with any plumber, holds no plumber inventory, and moves no money.

Suggested flow:

1. Ask for the symptom (leak, burst, clog...) and call `diagnose_issue`
   for severity plus shutoff steps.
2. Ask for the plumber's availability windows (weekday, start, end) and the
   pricebook (name, price, minutes).
3. Call `find_slots` with the job length for open starts every 30 min.
4. Call `quote_job` for the job plus add-ons, and `compare_plumbers`
   with their price, rating and distance numbers for a ranked pick.
5. Call `build_dispatch_request` for a draft message to send the plumber.
   Never claim the visit is booked.
6. Call `maintenance_plan` with the last visit for future checkup dates.
7. If asked to book, pay, or check live plumber availability: explain
   PlumbNow plans only and does not connect to any plumber.
