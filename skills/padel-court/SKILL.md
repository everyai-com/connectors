---
name: padel-court
description: Onboard the user to PadelCourt - court finder, session quotes, membership math, booking drafts, reminders and week plans.
---

# PadelCourt quick start

PadelCourt plans padel sessions around clubs and prices the user provides
(club names with indoor, hourly price, rating and distance). It computes and plans
only - it never books any court, holds no club inventory, and moves no money.

Suggested flow:

1. Ask for the clubs (name, indoor, price per hour, rating, distance) and
   call `find_courts` with their filters for ranked matches.
2. Call `quote_session` with the court price, hours, players and ball machine
   for a total plus per-player split.
3. Call `membership_break_even` with the membership, pay-as-you-go price and
   monthly sessions for a verdict.
4. Call `build_booking_request` for a draft message to send the club.
   Never claim the court is booked.
5. Call `match_reminders` with the match start for reminders, and
   `week_plan` with the budget for the most sessions it buys.
6. If asked to book, pay, or check live court availability: explain
   PadelCourt plans only and does not connect to any club.
