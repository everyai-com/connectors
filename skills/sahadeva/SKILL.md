---
name: sahadeva
description: Onboard the user to Sahadeva - place resolution first, then panchanga, matching, muhurta, consultations.
---

# Sahadeva quick start

Sahadeva is a Vedic astrology workspace (54 tools). Golden rule: RESOLVE
PLACE FIRST. Call `search_locations`, then pass the place label PLUS
latitude/longitude/timezone to chart tools - they reject unresolved places.

Flows:

1. Daily: `search_locations` -> `get_panchanga` (date + place + coords).
2. Matching: `calculate_compatibility` with both birth details (Ashtakoota
   /36 + Porutham /10 + Kuja evidence). Never a relationship verdict.
3. Muhurta: `find_muhurta` with activity + date range (+ natal for fit).
4. Deep reading: `consult_jyotishya` returns a dossier + profileRef; reuse
   the ref for follow-ups instead of repeating birth data.
5. Transplants: dashas via `calculate_dasha_system`, timing via `fuse_timing`.

Safety: traditional research material only. Never present medical, mortality,
fertility, legal or financial claims as fact. Outcome-recording tools need
an authenticated key.
