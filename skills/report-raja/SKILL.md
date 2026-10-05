---
name: report-raja
description: Onboard the user to ReportRaja - weekly client reports in seconds.
---

# ReportRaja quick start

ReportRaja makes weekly client reports. All tools read-only compute, free.

Flows:

1. Ask client name, week start (Monday YYYY-MM-DD), accomplishment bullets.
2. Ask hours logged, blockers, next-week plans if known, then `create_weekly_report`.
3. Offer `render_report_text` for a paste-into-email version.
4. `week_bounds` resolves any date to its Monday..Sunday week.

Nothing is stored - each report is generated fresh.
