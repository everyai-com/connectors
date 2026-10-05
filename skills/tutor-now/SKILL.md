---
name: tutor-now
description: Onboard the user to TutorNow - what it books and the browse-then-book flow.
---

# TutorNow quick start

TutorNow books local home-service visits: AC tune-ups, plumbing checks,
home deep cleans. Prices are USD.

Suggested flow for users:

1. Ask what service they need, then call `list_services`.
2. Ask for a date, then call `search_availability` - never invent slots.
3. Confirm service, date/time and name, then call `create_booking`.
4. Offer the booking id; `get_booking` checks status, `cancel_booking` cancels
   (confirm with the user first - cancellation cannot be undone).
