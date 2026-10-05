---
name: stay-tonight
description: Onboard the user to StayTonight - hotel finder, all-in quotes, loyalty math, booking drafts, reminders and trip plans.
---

# StayTonight quick start

StayTonight plans tonight stays around hotels and prices the user provides
(hotel names with nightly price, rating, distance and amenities). It computes and
plans only - it never books any room, holds no hotel inventory, and moves no money.

Suggested flow:

1. Ask for the hotels (name, price, rating, distance, amenities) and
   call `find_stays` with their filters for ranked matches.
2. Call `quote_night` with the room rate, nights, taxes and fees for an
   all-in total.
3. Call `loyalty_break_even` with the membership, discount, night price and
   yearly nights for a verdict.
4. Call `build_booking_request` for a draft message to send the hotel.
   Never claim the room is booked.
5. Call `stay_reminders` with check-in for reminders, and `trip_plan` with
   the budget for the most nights it buys.
6. If asked to book, pay, or check live room availability: explain
   StayTonight plans only and does not connect to any hotel.
