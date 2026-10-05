/**
 * LeaseBreak engine - early lease termination cost estimator, option comparison,
 * notice letters and a negotiation checklist. Pure arithmetic + drafting from
 * user-provided lease terms; informational self-help, not legal advice.
 */

export const DISCLAIMER =
  "Informational self-help based on the numbers and lease terms you provide; not legal advice. Early-termination rules vary by state/country and lease - confirm your rights locally before acting.";

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => round2(n);

function requirePositive(n: number | undefined, field: string): number {
  if (n === undefined || !Number.isFinite(n) || n <= 0) throw new Error(`${field} must be a positive number.`);
  return n;
}

function requireNonNegative(n: number | undefined, field: string, dflt = 0): number {
  if (n === undefined) return dflt;
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number.`);
  return n;
}

export interface BreakInput {
  monthly_rent: number;
  months_remaining: number;
  deposit?: number;
  break_fee_months?: number;
  notice_months?: number;
  reletting_fee?: number;
  expected_relet_months?: number;
  landlord_mitigates?: boolean;
  currency?: string;
}

export interface BreakEstimate {
  currency: string;
  breakdown: {
    rent_during_notice: number;
    break_fee: number;
    reletting_fee: number;
    rent_until_relet_if_liable: number;
    deposit_credit: number;
  };
  net_break_cost: number;
  net_without_break_clause: number;
  stay_cost: number;
  assumptions: string[];
  disclaimer: string;
}

export function estimateBreakCost(input: BreakInput): BreakEstimate {
  const rent = requirePositive(input.monthly_rent, "monthly_rent");
  const remaining = requirePositive(input.months_remaining, "months_remaining");
  const deposit = requireNonNegative(input.deposit, "deposit");
  const breakFeeMonths = requireNonNegative(input.break_fee_months, "break_fee_months");
  const noticeMonths = requireNonNegative(input.notice_months, "notice_months", breakFeeMonths > 0 ? 0 : 2);
  const relettingFee = requireNonNegative(input.reletting_fee, "reletting_fee");
  const reletMonths = requireNonNegative(input.expected_relet_months, "expected_relet_months", 1);
  const mitigates = input.landlord_mitigates ?? true;
  const currency = input.currency ?? "USD";

  if (noticeMonths > remaining) throw new Error(`notice_months (${noticeMonths}) cannot exceed months_remaining (${remaining}).`);

  const rentDuringNotice = money(rent * noticeMonths);
  const breakFee = money(rent * breakFeeMonths);
  // Without a break clause: you owe rent until a replacement tenant is found (if the
  // landlord must mitigate) or until lease end (if not), whichever is sooner.
  const rentUntilRelet = mitigates
    ? money(rent * Math.min(Math.max(reletMonths, noticeMonths), remaining))
    : money(rent * remaining);
  const depositCredit = Math.min(deposit, money(rentDuringNotice + breakFee + relettingFee + rentUntilRelet));

  const withClause = money(rentDuringNotice + breakFee + relettingFee);
  const withoutClause = money(rentUntilRelet + relettingFee);
  const net = money(Math.max(0, Math.min(withClause, withoutClause) - depositCredit));

  return {
    currency,
    breakdown: {
      rent_during_notice: rentDuringNotice,
      break_fee: breakFee,
      reletting_fee: relettingFee,
      rent_until_relet_if_liable: rentUntilRelet,
      deposit_credit: depositCredit,
    },
    net_break_cost: net,
    net_without_break_clause: money(Math.max(0, withoutClause - Math.min(deposit, withoutClause))),
    stay_cost: money(rent * remaining),
    assumptions: [
      breakFeeMonths > 0
        ? `Lease has a break fee of ${breakFeeMonths} month(s)' rent.`
        : "No break fee supplied - computed as the no-clause path (rent until relet).",
      `Notice period assumed: ${noticeMonths} month(s).`,
      mitigates
        ? `Landlord mitigates: liable for rent until relet (~${reletMonths} month(s) estimate).`
        : "Landlord does not mitigate: liable for full remaining rent in this model.",
      "Deposit is credited but assumes no damage or arrears deductions.",
    ],
    disclaimer: DISCLAIMER,
  };
}

export interface CompareInput extends BreakInput {
  sublet_discount_pct?: number;
  sublet_vacancy_months?: number;
}

export function compareOptions(input: CompareInput): object {
  const rent = requirePositive(input.monthly_rent, "monthly_rent");
  const remaining = requirePositive(input.months_remaining, "months_remaining");
  const currency = input.currency ?? "USD";
  const deposit = requireNonNegative(input.deposit, "deposit");
  const discount = requireNonNegative(input.sublet_discount_pct, "sublet_discount_pct", 15);
  const vacancy = requireNonNegative(input.sublet_vacancy_months, "sublet_vacancy_months", 1);
  if (discount >= 100) throw new Error("sublet_discount_pct must be below 100.");

  const breakEstimate = estimateBreakCost({ ...input, deposit });
  const breakOption = breakEstimate.net_break_cost;

  const subletMonths = Math.max(0, remaining - vacancy);
  const subletIncome = money(rent * (1 - discount / 100) * subletMonths);
  const subletTotalRent = money(rent * remaining);
  const subletNet = money(subletTotalRent - subletIncome);
  const stayNet = money(rent * remaining);

  const options = [
    {
      option: "break_lease",
      net_cost: breakEstimate.net_break_cost,
      note: "Pay notice + any break/reletting fees; walk away with a written release.",
      risks: ["Get the surrender agreement in writing before paying.", "Confirm the fee is not payable on top of rent-until-relet in your lease."],
    },
    {
      option: "sublet",
      net_cost: subletNet,
      note: `Rent all ${remaining} month(s); subtenant pays ${100 - discount}% of rent for ~${subletMonths} month(s).`,
      risks: ["Most leases require written landlord consent to sublet.", "You remain liable if the subtenant stops paying."],
    },
    {
      option: "stay",
      net_cost: stayNet,
      note: "Keep the lease to term; relocation delayed.",
      risks: ["Highest cash cost; revisit closer to renewal if circumstances change."],
    },
  ].sort((a, b) => a.net_cost - b.net_cost);

  return {
    currency,
    options,
    cheapest: options[0].option,
    assumptions: [
      `Sublet discount ${discount}% and ${vacancy} month(s) vacancy assumed.`,
      "Deposit credited once in the break option only (it is yours again in all options).",
      "Subletting here means renting to a replacement tenant while staying on the lease.",
    ],
    disclaimer: DISCLAIMER,
  };
}

export interface NoticeInput {
  tenant_name: string;
  property_address: string;
  lease_date?: string;
  notice_months: number;
  intended_move_out_date: string;
  break_fee_months?: number;
  monthly_rent?: number;
  deposit?: number;
  landlord_name?: string;
  reason?: string;
}

export function noticeLetter(input: NoticeInput): object {
  if (!input.tenant_name?.trim()) throw new Error("tenant_name is required.");
  if (!input.property_address?.trim()) throw new Error("property_address is required.");
  const noticeMonths = requirePositive(input.notice_months, "notice_months");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.intended_move_out_date)) throw new Error("intended_move_out_date must be YYYY-MM-DD.");

  const landlord = input.landlord_name?.trim() || "Landlord/Property Manager";
  const fee = input.break_fee_months && input.break_fee_months > 0
    ? `I understand the early-termination fee to be ${input.break_fee_months} month(s)' rent${input.monthly_rent ? ` (${input.monthly_rent.toLocaleString()} per month)` : ""} and I am prepared to pay it on the agreed terms.`
    : "I would like to agree a reasonable early-termination arrangement and will cooperate fully with re-letting the unit.";
  const depositLine = input.deposit && input.deposit > 0
    ? `I would also like to agree the disposition of my security deposit (${input.deposit.toLocaleString()}) and the move-out inspection in writing.`
    : "I would like to agree the move-out inspection process in writing.";

  const letter = `Dear ${landlord},

Re: Notice of intent to terminate tenancy early
Property: ${input.property_address}
${input.lease_date ? `Lease dated: ${input.lease_date}\n` : ""}Tenant: ${input.tenant_name}

I am writing to give formal notice of my intention to terminate my tenancy early, following the ${noticeMonths}-month notice requirement${input.lease_date ? " under my lease" : ""}. My intended move-out date is ${input.intended_move_out_date}.${input.reason ? `\n\nContext: ${input.reason}.` : ""}

${fee}

${depositLine}

I will leave the property in good condition and will make it available for viewings with reasonable notice, so the unit can be re-let as quickly as possible. Please confirm:
1. receipt of this notice and the agreed move-out date;
2. the exact amount payable to terminate early, itemised;
3. the deposit return timeline and inspection date.

I would appreciate a written reply within 14 days so we can complete a written surrender agreement before the move-out date.

Yours sincerely,
${input.tenant_name}
`;

  return {
    letter,
    subject: `Notice of intent to terminate tenancy early - ${input.property_address}`,
    sending_tips: [
      "Send by email AND tracked mail; keep the delivery receipt.",
      "Do not stop paying rent unless a signed agreement says so.",
      "Get every agreed number (fee, deposit, end date) in the final written agreement.",
    ],
    disclaimer: DISCLAIMER,
  };
}

export interface ChecklistInput {
  break_fee_months?: number;
  months_remaining?: number;
  landlord_mitigates?: boolean;
  relet_demand?: "high" | "medium" | "low";
}

export function negotiationChecklist(input: ChecklistInput): object {
  const feeMonths = input.break_fee_months ?? 0;
  const remaining = input.months_remaining ?? 0;
  const demand = input.relet_demand ?? "medium";
  const items: string[] = [
    "Put every agreed term in a signed surrender agreement (end date, total amount, deposit handling, reference letter).",
    "Photograph the unit before move-out and attend the inspection; normal wear is not damage.",
    "Keep paying rent until the agreement is signed - an unsigned goodbye can count as abandonment.",
  ];

  if (feeMonths >= 2) items.push(`The ${feeMonths}-month break fee is worth negotiating down: cite current rental demand in your area and offer to help find a replacement tenant.`);
  else if (feeMonths > 0) items.push("Ask whether the break fee can be waived if a replacement tenant is found quickly.");
  else items.push("No break fee stated: confirm in writing what (if anything) is owed beyond notice; many jurisdictions require the landlord to re-let and offset rent.");

  if (remaining >= 6) items.push(`${remaining} months remain - a longer runway gives the landlord time to re-let; offer flexibility on viewing times as a bargaining chip.`);
  if (demand === "high") items.push("Demand is described as high: suggest a 2-4 week re-let, which usually removes the landlord's loss argument.");
  if (demand === "low") items.push("Demand is described as low: expect to contribute to the landlord's loss; a sublet or lease assignment may be cheaper than a clean break.");

  if (input.landlord_mitigates === false) items.push("If your landlord claims no duty to re-let, ask for that in writing - duties vary by state and many require reasonable mitigation.");
  items.push("Consider a lease assignment to a qualified replacement tenant as an alternative the landlord must usually accept in many jurisdictions.");

  return {
    checklist: items,
    order_of_operations: [
      "1. Ask the landlord for the early termination clause and their calculated amount in writing.",
      "2. Probe mitigation and alternatives (replacement tenant, assignment, sublet).",
      "3. Propose a number below their ask with a fast-clean-exit incentive (flexible viewings, extra cleaning).",
      "4. Sign the surrender agreement, pay only what it says, keep the receipt.",
    ],
    disclaimer: DISCLAIMER,
  };
}
