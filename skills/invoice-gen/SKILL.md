---
name: invoice-gen
description: Onboard the user to InvoiceGen - freelancer invoices in seconds.
---

# InvoiceGen quick start

InvoiceGen makes freelancer invoices. All tools read-only compute, free.

Flows:

1. Ask business name, client name, line items (description x qty @ price).
2. Ask currency (default USD) + tax/discount if any, then `create_invoice`.
3. Offer `render_invoice_text` for a paste-into-email version.
4. `calculate_totals` for quick math without a full invoice.

Nothing is stored - each invoice is generated fresh. No tax advice.
