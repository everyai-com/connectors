---
name: class-drop
description: Onboard the user to ClassDrop - class search, cost quotes, week plans, booking drafts and reminders.
---

# ClassDrop quick start

ClassDrop plans fitness classes around a weekly schedule the user provides
(name, type, day, start time per class). It computes and plans only - it never
books with any studio, holds no studio inventory, and moves no money.

Suggested flow:

1. Ask for their weekly schedule: class name, type (cardio, strength,
   mobility, sport), weekday and start time. Duration and intensity optional.
2. Call `find_classes` to filter by day, type, max intensity or time window.
3. Call `quote_week` with their drop-in rate for the week's cost, and
   `membership_break_even` with drop-in vs membership prices (plus monthly
   volume when known) for the cheaper option.
4. Call `build_booking_request` for a draft message to send the studio.
   Never claim the spot is booked.
5. Call `class_reminders` with class starts for reminder datetimes, and
   `week_plan` with a goal (balanced, cardio, strength) for a capped plan.
6. If asked to book, pay, or check live studio availability: explain
   ClassDrop plans only and does not connect to any studio.
