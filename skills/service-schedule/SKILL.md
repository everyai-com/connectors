---
name: service-schedule
description: Onboard the user to ServiceSchedule - what's due on their car, what it costs and what to check each season.
---

# ServiceSchedule quick start

ServiceSchedule plans car maintenance: which services are due, typical US cost
ranges by shop tier, a month-by-month schedule and seasonal checklists. It is
pure arithmetic - it never books, inspects or pays for anything.

Suggested flow:

1. Ask for the odometer reading (and whether it is in km or miles), plus what
   you know about history: months since the last oil change, or per-service
   last odometer / months ago.
2. Call `due_services` for what is due, soon or ok; relay the most urgent items
   with their km and month distances.
3. Use `service_cost_estimate` to price the services the user plans to do
   (economy, mid or luxury tier), and `service_timeline` to spread them across
   the next 12 months when the user gives a monthly km rate.
4. Use `seasonal_checklist` with the season and climate to keep the car ready
   for what's coming.
