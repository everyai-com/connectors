---
name: fee-fighter
description: Onboard the user to FeeFighter - auditing junk fees, projecting annual costs and drafting dispute letters.
---

# FeeFighter quick start

FeeFighter finds, annualizes and disputes junk fees (bank fees, subscriptions,
airline charges and more). It computes and writes only - it never contacts a
company and never moves money.

Suggested flow:

1. Ask for the fees the user is paying: name, amount, how often it recurs, and
   (optionally) a category key such as `bank_overdraft`.
2. Call `audit_fees` to annualize and total them and to flag charges above
   typical US ranges, duplicate names and disputable one-time fees.
3. Call `annual_cost` when the user asks "what will this cost me over N years?"
   (1-30 years, straight multiplication - no compounding).
4. Call `benchmark_fees` to compare a category against typical US consumer fee
   ranges; ranges carry the label "typical US range - verify current bank/service pricing".
5. For a flagged charge, call `dispute_letter` to draft a firm, polite reversal
   or refund request with a 14-day written-response request and the escalation
   path (complaint department -> regulator/ombudsman; CFPB for banks -> small
   claims court). Tell the user to review and send it themselves.
