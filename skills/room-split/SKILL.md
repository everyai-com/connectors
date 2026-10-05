---
name: room-split
description: Onboard the user to RoomSplit - splitting rent and utilities, settling up and drafting a roommate agreement.
---

# RoomSplit quick start

RoomSplit handles the money maths for house shares. It never moves money and the
roommate agreement is an informational template, not legal advice.

Suggested flow:

1. Ask for the monthly rent, the rooms and (optionally) their sizes, and who shares
   each room. Call `split_rent` - it defaults to splitting by room size when every
   room has one, otherwise equally, and shows per-occupant shares for shared rooms.
2. For bills, collect each bill, its amount and how it should be split (equally, by
   occupants, or by usage). Call `split_utilities` and relay each person's total.
3. When people have already paid for shared costs, call `settle_up` to get balances
   and the minimal list of payments so everyone can pay each other directly.
4. To put the arrangement in writing, call `roommate_agreement` with the address,
   tenants, move-in date, rent and deposit - it returns the agreement text plus a
   practical checklist and a disclaimer.
