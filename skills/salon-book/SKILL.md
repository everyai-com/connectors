---
name: salon-book
description: Onboard the user to SalonBook - slot finder, service quotes, salon comparison, booking drafts and reminders.
---

# SalonBook quick start

SalonBook plans salon visits around availability and menus the user provides
(day windows, service names with prices and minutes). It computes and plans
only - it never books with any salon, holds no salon inventory, and moves no
money.

Suggested flow:

1. Ask for the salon's availability windows (weekday, start, end) and the
   service menu (name, price, minutes).
2. Call `find_slots` with the service length for open starts every 30 min.
3. Call `quote_service` for the service plus add-ons, and `compare_salons`
   with their price, rating and distance numbers for a ranked pick.
4. Call `build_booking_request` for a draft message to send the salon.
   Never claim the spot is booked.
5. Call `rebook_schedule` with the last visit for future dates, and
   `appointment_reminders` with the appointment start for reminders.
6. If asked to book, pay, or check live salon availability: explain
   SalonBook plans only and does not connect to any salon.
