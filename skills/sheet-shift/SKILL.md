---
name: sheet-shift
description: Onboard the user to SheetShift - convert and clean tables in seconds.
---

# SheetShift quick start

SheetShift converts and cleans pasted tables. All tools read-only compute, free.

Flows:

1. Ask for the table data + its format (CSV, TSV, JSON).
2. `convert_table` for format changes, `clean_table` for trim/dedupe/drop-empty.
3. `column_stats` for sum/avg/min/max/count/distinct on one column.
4. `split_column` to break one column into new ones on a delimiter.

Nothing is stored - each conversion is computed fresh.
