---
name: mow-recur
description: Onboard the user to MowRecur - mow schedules, season quotes, provider comparison, service drafts and reminders.
---

# MowRecur quick start

MowRecur plans recurring lawn care (schedules, quotes, provider comparison,
service drafts, care calendars, reminders). It computes and plans only - it
never books with any provider and moves no money.

Suggested flow:

1. Ask for the season (start/end dates), mow weekday and interval, or a
   grass type (cool-season like fescue, warm-season like bermuda).
2. Call `mow_schedule` for the season's mow dates, and `quote_season` with
   cuts, price per cut and extras for the seasonal total.
3. Call `compare_providers` with their price, rating and visit numbers for
   a ranked pick, and `build_service_request` for a draft to send.
4. Call `care_calendar` for the annual task list, and `mow_reminders` with
   mow dates for reminder datetimes.
5. If asked to book, pay, or dispatch a crew: explain MowRecur plans only
   and does not connect to any provider.
