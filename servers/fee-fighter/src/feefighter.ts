/**
 * FeeFighter engine - audit junk fees, annualize costs, benchmark against
 * typical US fee ranges and draft dispute letters.
 * Pure computation; no dependencies, no network, no storage.
 * Money is kept in cents and rounded with Math.round(x * 100) / 100.
 */

export type FeeFrequency = "monthly" | "annual" | "one-time";

export interface Fee {
  name: string;
  amount: number;
  frequency: FeeFrequency;
  category?: string;
}

export interface AuditFeeRow {
  name: string;
  amount: number;
  frequency: FeeFrequency;
  annualized: number;
  flags: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (n: number) => Math.round(n * 100);
const money = (n: number) => `$${round2(n).toFixed(2)}`;

const FREQUENCIES: FeeFrequency[] = ["monthly", "annual", "one-time"];

// ---------------------------------------------------------------------------
// Benchmark reference table - typical US consumer fee ranges.
// ---------------------------------------------------------------------------
export const BENCHMARK_BASIS = "typical US range - verify current bank/service pricing";
export const BENCHMARK_DISCLAIMER = "Informational typical ranges; not financial advice";
export const BENCHMARK_SOURCE_NOTE =
  "Compiled from public US consumer-fee surveys and bank/service pricing pages; each range is per charge (monthly categories are per month). " +
  "Sources and pricing change frequently - treat every range as typical, not exact.";

export interface BenchmarkRow {
  category: string;
  label: string;
  typical_min: number;
  typical_max: number;
  basis: string;
}

export const BENCHMARKS: BenchmarkRow[] = [
  { category: "bank_overdraft", label: "Bank overdraft / insufficient funds fee", typical_min: 25, typical_max: 35, basis: BENCHMARK_BASIS },
  { category: "bank_monthly_maintenance", label: "Bank monthly maintenance / service fee", typical_min: 0, typical_max: 12, basis: BENCHMARK_BASIS },
  { category: "atm_out_of_network", label: "Out-of-network ATM fee", typical_min: 2.5, typical_max: 5, basis: BENCHMARK_BASIS },
  { category: "late_payment", label: "Late payment fee", typical_min: 25, typical_max: 40, basis: BENCHMARK_BASIS },
  { category: "gym_membership_monthly", label: "Gym membership (monthly)", typical_min: 10, typical_max: 80, basis: BENCHMARK_BASIS },
  { category: "streaming_monthly", label: "Streaming subscription (monthly)", typical_min: 5, typical_max: 25, basis: BENCHMARK_BASIS },
  { category: "airline_checked_bag", label: "Airline checked bag fee (each way)", typical_min: 30, typical_max: 40, basis: BENCHMARK_BASIS },
  { category: "airline_seat_fee", label: "Airline seat selection fee", typical_min: 10, typical_max: 50, basis: BENCHMARK_BASIS },
  { category: "ticket_convenience", label: "Event ticket convenience fee", typical_min: 5, typical_max: 20, basis: BENCHMARK_BASIS },
  { category: "rental_application", label: "Rental application fee", typical_min: 30, typical_max: 75, basis: BENCHMARK_BASIS },
  { category: "subscription_app_monthly", label: "App subscription (monthly)", typical_min: 2, typical_max: 15, basis: BENCHMARK_BASIS },
  { category: "delivery_fee", label: "Food delivery fee", typical_min: 2, typical_max: 10, basis: BENCHMARK_BASIS },
  { category: "airline_change_fee", label: "Airline change fee", typical_min: 0, typical_max: 200, basis: BENCHMARK_BASIS },
  { category: "hotel_resort_fee", label: "Hotel resort / destination fee (per night)", typical_min: 20, typical_max: 45, basis: BENCHMARK_BASIS },
];

/** Case-insensitive category key: trims, lowercases and maps spaces/hyphens to underscores. */
function normalizeCategory(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function validateFees(fees: Fee[]): void {
  if (!Array.isArray(fees) || fees.length === 0) {
    throw new Error("fees must be a non-empty list of {name, amount, frequency, category?}.");
  }
  fees.forEach((f, i) => {
    const tag = `fee ${i + 1}`;
    if (!f || typeof f !== "object") throw new Error(`${tag} must be an object with name, amount and frequency.`);
    if (typeof f.name !== "string" || !f.name.trim()) throw new Error(`${tag}: name must be a non-empty string.`);
    if (typeof f.amount !== "number" || !Number.isFinite(f.amount)) throw new Error(`${tag} ('${f.name}'): amount must be a number.`);
    if (f.amount <= 0) throw new Error(`${tag} ('${f.name}'): amount must be greater than 0; got ${f.amount}.`);
    if (!FREQUENCIES.includes(f.frequency)) {
      throw new Error(`${tag} ('${f.name}'): frequency must be one of ${FREQUENCIES.join(", ")}; got '${String(f.frequency)}'.`);
    }
  });
}

function annualizedCents(f: Fee): number {
  const cents = toCents(f.amount);
  return f.frequency === "monthly" ? cents * 12 : cents;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`'${field}' must be a non-empty string.`);
  return value.trim();
}

// ---------------------------------------------------------------------------
// 1) auditFees - annualize, total and flag problem fees.
// ---------------------------------------------------------------------------
export interface AuditInput {
  fees: Fee[];
}

export function auditFees(input: AuditInput): object {
  validateFees(input.fees);

  const nameCounts = new Map<string, number>();
  for (const f of input.fees) {
    const key = f.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  let totalCents = 0;
  const rows: AuditFeeRow[] = input.fees.map((f) => {
    const cents = toCents(f.amount);
    const annualized = annualizedCents(f);
    totalCents += annualized;

    const flags: string[] = [];
    if (f.category) {
      const bench = BENCHMARKS.find((b) => b.category === normalizeCategory(f.category as string));
      if (bench && f.amount > bench.typical_max) flags.push("above typical");
    }
    if ((nameCounts.get(f.name.trim().toLowerCase()) ?? 0) > 1) flags.push("duplicate name");
    if (f.frequency === "one-time" && f.amount >= 30) flags.push("worth disputing");

    return {
      name: f.name.trim(),
      amount: round2(cents / 100),
      frequency: f.frequency,
      annualized: round2(annualized / 100),
      flags,
    };
  });

  const flaggedCount = rows.filter((r) => r.flags.length > 0).length;
  return {
    currency: "USD",
    fees: rows,
    total_annual: round2(totalCents / 100),
    total_monthly_average: round2(totalCents / 12 / 100),
    flagged_count: flaggedCount,
    note:
      flaggedCount === 0
        ? `No red flags in ${rows.length} fee(s); all amounts look within typical ranges.`
        : `${flaggedCount} of ${rows.length} fee(s) flagged - review the flags and consider disputing the ones marked 'worth disputing' or 'above typical'.`,
  };
}

// ---------------------------------------------------------------------------
// 2) annualCost - straight-line cumulative projection over 1-30 years.
// ---------------------------------------------------------------------------
export interface AnnualCostInput {
  fees: Fee[];
  years?: number;
}

export function annualCost(input: AnnualCostInput): object {
  validateFees(input.fees);
  const years = input.years ?? 1;
  if (!Number.isInteger(years) || years < 1 || years > 30) {
    throw new Error(`years must be an integer between 1 and 30; got ${String(input.years)}.`);
  }

  let totalCents = 0;
  const perFee = input.fees.map((f) => {
    const annualized = annualizedCents(f);
    const cumulative = annualized * years;
    totalCents += cumulative;
    return {
      name: f.name.trim(),
      annualized: round2(annualized / 100),
      cumulative: round2(cumulative / 100),
    };
  });

  return {
    years,
    per_fee: perFee,
    cumulative_total: round2(totalCents / 100),
    note: `Straight multiplication over ${years} year(s), no compounding or inflation. Per-fee cumulative amounts are rounded to 2 decimals.`,
  };
}

// ---------------------------------------------------------------------------
// 3) benchmarkFees - the curated typical US fee-range reference.
// ---------------------------------------------------------------------------
export interface BenchmarkInput {
  category?: string;
}

export function benchmarkFees(input: BenchmarkInput): object {
  if (input.category !== undefined && (typeof input.category !== "string" || !input.category.trim())) {
    throw new Error("category must be a non-empty string when provided.");
  }
  if (input.category !== undefined) {
    const key = normalizeCategory(input.category as string);
    const row = BENCHMARKS.find((b) => b.category === key);
    if (!row) {
      throw new Error(
        `unknown category '${input.category}'. Valid categories: ${BENCHMARKS.map((b) => b.category).join(", ")}.`,
      );
    }
    return {
      currency: "USD",
      ...row,
      source_note: BENCHMARK_SOURCE_NOTE,
      disclaimer: BENCHMARK_DISCLAIMER,
    };
  }
  return {
    currency: "USD",
    count: BENCHMARKS.length,
    categories: BENCHMARKS,
    source_note: BENCHMARK_SOURCE_NOTE,
    disclaimer: BENCHMARK_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 4) disputeLetter - firm, polite reversal/refund request letter.
// ---------------------------------------------------------------------------
export interface DisputeLetterInput {
  fee_name: string;
  amount: number;
  company: string;
  your_name: string;
  account_reference?: string;
  date_charged?: string;
  reason?: string;
  requested_action?: string;
}

export function disputeLetter(input: DisputeLetterInput): object {
  const feeName = requireString(input.fee_name, "fee_name");
  const company = requireString(input.company, "company");
  const yourName = requireString(input.your_name, "your_name");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a positive number.");
  }
  const amount = round2(input.amount);
  const requested = input.requested_action && input.requested_action.trim() ? input.requested_action.trim() : "reverse or refund";
  const grounds =
    input.reason && input.reason.trim()
      ? input.reason.trim()
      : "The charge was unexpected, was not clearly disclosed when I agreed to the account terms, and may be the result of a billing error. As this is the first time I have raised it, I would also ask you to consider it for a one-time courtesy reversal.";
  const chargedOn = input.date_charged && input.date_charged.trim() ? `, charged on ${input.date_charged.trim()}` : "";
  const accountLine = input.account_reference && input.account_reference.trim() ? `Account reference: ${input.account_reference.trim()}\n` : "";

  const subject = `Request to ${requested} the ${money(amount)} "${feeName}" fee`;
  const letter = [
    `To: ${company} - Customer Accounts / Complaint Department`,
    `From: ${yourName}`,
    ...(accountLine ? [accountLine.trimEnd()] : []),
    `Subject: ${subject}`,
    "",
    `Dear ${company} Customer Service,`,
    "",
    `I am writing to dispute a fee on my account: "${feeName}", in the amount of ${money(amount)}${chargedOn}. I am asking you to ${requested} this fee.`,
    "",
    `My reason for this request: ${grounds}`,
    "",
    "Please respond in writing with your decision within 14 days of the date of this letter. If we cannot resolve this directly, I will escalate in order: your formal complaint department, then the appropriate regulator or ombudsman (for banking matters, the Consumer Financial Protection Bureau), and finally small claims court if the amount warrants it.",
    "",
    "Thank you for taking a second look at this charge.",
    "",
    "Sincerely,",
    yourName,
  ].join("\n");

  return {
    subject,
    letter,
    sending_tips: [
      "Send through the company's secure message centre or by certified mail so delivery is logged; keep a copy of the letter.",
      "Attach or reference the statement line showing the fee - redact account numbers and transactions you do not need to share.",
      "Log the 14-day deadline; if no written reply arrives, follow up with a short second letter referencing the first.",
      "If the first answer is a refusal, ask for the final response in writing and the address of the company's complaint department.",
      "Escalate in order: company complaint department -> regulator or ombudsman (for banks, CFPB at consumerfinance.gov/complaint) -> small claims court.",
      "Stay factual and polite; first-time courtesy reversals are common for fees under about $35.",
    ],
    disclaimer: "Informational self-help; not legal or financial advice.",
  };
}
