---
name: flight-fix
description: Onboard the user to FlightFix - flight compensation checks, rights, deadlines and claim letters under EU261/UK261.
---

# FlightFix quick start

FlightFix is informational self-help for EU261/UK261 air passenger rights. It never books
travel and never gives legal representation.

Suggested flow:

1. Get the flight details: route (IATA codes), what went wrong (delay/cancellation),
   how late they arrived, and any reason the airline gave.
2. Call `check_compensation` for eligibility, band and amount. For arrivals into the EU,
   pass `carrier_country` (the airline's home country) to resolve jurisdiction.
3. If the user asks "what are my rights" or was re-routed, call `disruption_rights`.
4. Before they claim, call `claim_timeline` for the deadline and evidence checklist.
5. When they are ready to claim, call `generate_claim_letter` and hand them the letter
   plus the sending tips.
6. Always relay the disclaimer: informational self-help, not legal advice; airline
   practice and national courts can vary.
