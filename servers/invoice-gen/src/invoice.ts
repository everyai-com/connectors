/** InvoiceGen engine - pure compute. No storage: invoices are generated per request. */
export type LineItem = { description: string; quantity: number; unit_price: number };
export type InvoiceInput = {
  business_name: string; client_name: string; items: LineItem[];
  currency?: string; tax_rate_pct?: number; discount_pct?: number;
  invoice_number?: string; notes?: string; due_in_days?: number;
};
export const CURRENCIES = ["USD","EUR","INR","GBP","AED","SGD","AUD","CAD"] as const;
const SYMBOLS: Record<string, string> = { USD: "$", EUR: "\u20AC", INR: "\u20B9", GBP: "\u00A3", AED: "DH ", SGD: "S$", AUD: "A$", CAD: "C$" };

function hashStr(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculateTotals(items: LineItem[], taxRatePct = 0, discountPct = 0) {
  if (!items.length) throw new Error("items must have at least one line");
  for (const it of items) {
    if (!it.description || it.quantity <= 0 || it.unit_price < 0)
      throw new Error(`bad line item: ${JSON.stringify(it)} (need description, quantity>0, unit_price>=0)`);
  }
  if (taxRatePct < 0 || taxRatePct > 100) throw new Error(`tax_rate_pct must be 0-100, got '${taxRatePct}'`);
  if (discountPct < 0 || discountPct > 100) throw new Error(`discount_pct must be 0-100, got '${discountPct}'`);
  const subtotal = round2(items.reduce((s, it) => s + it.quantity * it.unit_price, 0));
  const discount = round2((subtotal * discountPct) / 100);
  const tax = round2(((subtotal - discount) * taxRatePct) / 100);
  return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
}

export function createInvoice(input: InvoiceInput) {
  if (!input.business_name) throw new Error("'business_name' is required");
  if (!input.client_name) throw new Error("'client_name' is required");
  const currency = (input.currency ?? "USD").toUpperCase();
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number]))
    throw new Error(`currency must be one of ${CURRENCIES.join(", ")}, got '${input.currency}'`);
  const tax = input.tax_rate_pct ?? 0, disc = input.discount_pct ?? 0;
  const totals = calculateTotals(input.items, tax, disc);
  const today = new Date().toISOString().slice(0, 10);
  const number = input.invoice_number ?? `INV-${today.replace(/-/g, "")}-${(hashStr(JSON.stringify(input.items) + input.client_name) % 9000 + 1000)}`;
  const dueDays = input.due_in_days ?? 14;
  const due = new Date(Date.now() + dueDays * 864e5).toISOString().slice(0, 10);
  return {
    invoice_number: number, date: today, due_date: due,
    business_name: input.business_name, client_name: input.client_name,
    currency, symbol: SYMBOLS[currency], items: input.items,
    tax_rate_pct: tax, discount_pct: disc, ...totals,
    notes: input.notes ?? "", payment_terms: `Net ${dueDays}`,
  };
}

export function formatInvoicePlain(inv: ReturnType<typeof createInvoice>): string {
  const L: string[] = [];
  L.push(`INVOICE ${inv.invoice_number}`, `${inv.business_name}  ->  ${inv.client_name}`,
    `Date: ${inv.date}   Due: ${inv.due_date} (${inv.payment_terms})`, "-".repeat(48));
  for (const it of inv.items)
    L.push(`${it.description}  x${it.quantity} @ ${inv.symbol}${it.unit_price} = ${inv.symbol}${round2(it.quantity * it.unit_price)}`);
  L.push("-".repeat(48), `Subtotal: ${inv.symbol}${inv.subtotal}`);
  if (inv.discount) L.push(`Discount: -${inv.symbol}${inv.discount}`);
  if (inv.tax) L.push(`Tax (${inv.tax_rate_pct}%): ${inv.symbol}${inv.tax}`);
  L.push(`TOTAL DUE: ${inv.symbol}${inv.total}`);
  if (inv.notes) L.push(`Notes: ${inv.notes}`);
  return L.join("\n");
}
