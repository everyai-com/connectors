/**
 * RoomSplit engine - rent splitting by room, utility bill splitting,
 * settle-up transfers and shared-living agreement drafting for house shares.
 * Pure computation; all money handled in cents to avoid float drift.
 */

export interface RentRoom {
  name: string;
  size?: number;
  occupants?: string[];
}

export interface RentInput {
  total_rent: number;
  rooms: RentRoom[];
  method?: "equal" | "by_size";
}

export interface UtilitiesBill {
  name: string;
  amount: number;
  split: "equal" | "by_occupants" | "by_usage";
}

export interface UtilitiesPerson {
  name: string;
  occupants?: number;
  usage_weight?: number;
}

export interface UtilitiesInput {
  bills: UtilitiesBill[];
  people: UtilitiesPerson[];
}

export interface SettleCost {
  name: string;
  amount: number;
}

export interface SettlePayment {
  name: string;
  paid: number;
}

export interface SettleInput {
  costs: SettleCost[];
  payments: SettlePayment[];
}

export interface AgreementRoomAssignment {
  name: string;
  room: string;
}

export interface AgreementInput {
  property_address: string;
  tenants: string[];
  move_in_date: string;
  monthly_rent: number;
  deposit: number;
  room_assignments?: AgreementRoomAssignment[];
  utilities_policy?: string;
  notice_period_months?: number;
  house_rules?: string[];
}

export interface Balance {
  name: string;
  paid: number;
  owed: number;
  balance: number; // positive = should receive money back
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Trims names, rejects blanks and duplicates; returns the cleaned list. */
function cleanNames(values: unknown[], label: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string" || !raw.trim()) throw new Error(`${label} entries must be non-empty strings.`);
    const name = raw.trim();
    if (seen.has(name)) throw new Error(`duplicate ${label} '${name}' - names must be unique.`);
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Splits `totalCents` across `weights` in whole cents, distributing leftover cents fairly. */
function splitCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((totalCents * w) / sum));
  let remainder = totalCents - shares.reduce((a, b) => a + b, 0);
  let i = 0;
  while (remainder > 0) {
    shares[i % shares.length] += 1;
    remainder -= 1;
    i += 1;
  }
  return shares;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface RentResult {
  method: "equal" | "by_size";
  total_rent: number;
  rooms: Array<{ name: string; weight: number; rent: number; per_occupant?: Array<{ name: string; amount: number }> }>;
  note: string;
}

/** Splits monthly rent across rooms by size (default when every room has one) or equally. */
export function splitRent(input: RentInput): object {
  if (!isPositiveNumber(input.total_rent)) throw new Error("total_rent must be a positive number, e.g. 2400.");
  if (!Array.isArray(input.rooms) || input.rooms.length < 1) {
    throw new Error("rooms must be a non-empty list of {name, size?, occupants?}.");
  }
  if (input.method !== undefined && input.method !== "equal" && input.method !== "by_size") {
    throw new Error("method must be 'equal' or 'by_size'.");
  }

  const seenRooms = new Set<string>();
  let allHaveSize = true;
  for (const room of input.rooms) {
    if (!room || typeof room.name !== "string" || !room.name.trim()) {
      throw new Error("every room needs a non-empty name, e.g. 'Master bedroom'.");
    }
    const name = room.name.trim();
    if (seenRooms.has(name)) throw new Error(`duplicate room name '${name}' - room names must be unique.`);
    seenRooms.add(name);
    if (room.size === undefined) {
      allHaveSize = false;
    } else if (!isPositiveNumber(room.size)) {
      throw new Error(`room '${name}': size must be a positive number (e.g. area in m2 or ft2).`);
    }
    if (room.occupants !== undefined) {
      if (!Array.isArray(room.occupants) || room.occupants.length === 0) {
        throw new Error(`room '${name}': occupants must be a non-empty list of names.`);
      }
      cleanNames(room.occupants, `occupant in room '${name}'`);
    }
  }

  const method: "equal" | "by_size" = input.method ?? (allHaveSize ? "by_size" : "equal");
  if (method === "by_size" && !allHaveSize) {
    throw new Error("method 'by_size' needs a positive size on every room; add the missing sizes or use method 'equal'.");
  }

  const weights = input.rooms.map((room) => (method === "by_size" ? (room.size as number) : 1));
  const rentCents = splitCents(Math.round(input.total_rent * 100), weights);
  const rooms = input.rooms.map((room, i) => {
    const result: RentResult["rooms"][number] = {
      name: room.name.trim(),
      weight: method === "by_size" ? (room.size as number) : 1,
      rent: round2(rentCents[i] / 100),
    };
    if (room.occupants && room.occupants.length > 0) {
      const occCents = splitCents(rentCents[i], room.occupants.map(() => 1));
      result.per_occupant = room.occupants.map((occ, j) => ({ name: occ.trim(), amount: round2(occCents[j] / 100) }));
    }
    return result;
  });

  const shared = rooms.some((r) => r.per_occupant);
  const note =
    method === "by_size"
      ? `Rent split by room size (weights ${weights.join(", ")}); bigger rooms pay proportionally more.` +
        (shared ? " Within a shared room, that room's rent is divided equally between its occupants." : "")
      : `Rent split equally between ${rooms.length} room(s).` +
        (shared ? " Within a shared room, that room's rent is divided equally between its occupants." : "");

  return { method, total_rent: round2(input.total_rent), rooms, note };
}

export interface UtilitiesResult {
  bills: Array<{ name: string; amount: number; split: string; shares: Array<{ name: string; amount: number }> }>;
  totals: Array<{ name: string; amount: number }>;
  grand_total: number;
  note: string;
}

/** Splits every bill by its own rule and totals what each housemate owes. */
export function splitUtilities(input: UtilitiesInput): object {
  if (!Array.isArray(input.bills) || input.bills.length < 1) {
    throw new Error("bills must be a non-empty list of {name, amount, split}.");
  }
  if (!Array.isArray(input.people) || input.people.length < 1) {
    throw new Error("people must be a non-empty list of {name, occupants?, usage_weight?}.");
  }
  const names = cleanNames(input.people.map((p) => p?.name), "person");
  for (const person of input.people) {
    const name = person.name.trim();
    if (person.occupants !== undefined && !isPositiveNumber(person.occupants)) {
      throw new Error(`person '${name}': occupants must be a positive number (default 1).`);
    }
    if (person.usage_weight !== undefined && !isPositiveNumber(person.usage_weight)) {
      throw new Error(`person '${name}': usage_weight must be a positive number (e.g. 0.5 for a light user).`);
    }
  }

  const seenBills = new Set<string>();
  const totalsCents = new Map<string, number>(names.map((n) => [n, 0]));
  let grandCents = 0;

  const bills = input.bills.map((bill, idx) => {
    if (!bill || typeof bill.name !== "string" || !bill.name.trim()) {
      throw new Error(`bill ${idx + 1}: name must be a non-empty string, e.g. 'Electricity'.`);
    }
    const name = bill.name.trim();
    if (seenBills.has(name)) throw new Error(`duplicate bill name '${name}' - bill names must be unique.`);
    seenBills.add(name);
    if (!isPositiveNumber(bill.amount)) throw new Error(`bill '${name}': amount must be a positive number.`);
    if (bill.split !== "equal" && bill.split !== "by_occupants" && bill.split !== "by_usage") {
      throw new Error(`bill '${name}': split must be 'equal', 'by_occupants' or 'by_usage'.`);
    }

    let weights: number[];
    if (bill.split === "equal") {
      weights = input.people.map(() => 1);
    } else if (bill.split === "by_occupants") {
      weights = input.people.map((p) => p.occupants ?? 1);
    } else {
      const missing = input.people.filter((p) => p.usage_weight === undefined).map((p) => p.name.trim());
      if (missing.length > 0) {
        throw new Error(`bill '${name}' splits by usage but usage_weight is missing for ${missing.join(", ")}. Add usage_weight to everyone or switch the split.`);
      }
      weights = input.people.map((p) => p.usage_weight as number);
    }

    const billCents = Math.round(bill.amount * 100);
    grandCents += billCents;
    const sharesCents = splitCents(billCents, weights);
    const shares = input.people.map((p, i) => {
      const key = p.name.trim();
      totalsCents.set(key, (totalsCents.get(key) ?? 0) + sharesCents[i]);
      return { name: key, amount: round2(sharesCents[i] / 100) };
    });
    return { name, amount: round2(bill.amount), split: bill.split, shares };
  });

  return {
    bills,
    totals: names.map((name) => ({ name, amount: round2((totalsCents.get(name) ?? 0) / 100) })),
    grand_total: round2(grandCents / 100),
    note: "Every bill adds up to its own amount; totals are each person's sum across all bills.",
  };
}

/** Minimal-transfer settlement between creditors and debtors (greedy largest-first). */
export function minimizeTransfers(balances: Balance[]): Transfer[] {
  const creditors = balances.filter((b) => b.balance > 0.004).map((b) => ({ name: b.name, amount: b.balance })).sort((a, b) => b.amount - a.amount);
  const debtors = balances.filter((b) => b.balance < -0.004).map((b) => ({ name: b.name, amount: -b.balance })).sort((a, b) => b.amount - a.amount);
  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].amount, debtors[di].amount);
    if (amount > 0.004) transfers.push({ from: debtors[di].name, to: creditors[ci].name, amount: round2(amount) });
    creditors[ci].amount -= amount;
    debtors[di].amount -= amount;
    if (creditors[ci].amount <= 0.004) ci += 1;
    if (debtors[di].amount <= 0.004) di += 1;
  }
  return transfers;
}

/** Shared costs split equally; balances are paid minus owed, then settled with the fewest transfers. */
export function settleUp(input: SettleInput): object {
  if (!Array.isArray(input.costs) || input.costs.length < 1) {
    throw new Error("costs must be a non-empty list of {name, amount} shared costs.");
  }
  if (!Array.isArray(input.payments) || input.payments.length < 1) {
    throw new Error("payments must be a non-empty list of {name, paid}; use paid: 0 for anyone who has not paid yet.");
  }
  let totalCents = 0;
  const seenCosts = new Set<string>();
  for (const cost of input.costs) {
    if (!cost || typeof cost.name !== "string" || !cost.name.trim()) {
      throw new Error("every cost needs a non-empty name, e.g. 'Weekly shop'.");
    }
    const name = cost.name.trim();
    if (seenCosts.has(name)) throw new Error(`duplicate cost name '${name}' - cost names must be unique.`);
    seenCosts.add(name);
    if (!isPositiveNumber(cost.amount)) throw new Error(`cost '${name}': amount must be a positive number.`);
    totalCents += Math.round(cost.amount * 100);
  }
  const names = cleanNames(input.payments.map((p) => p?.name), "housemate");
  for (const payment of input.payments) {
    if (typeof payment.paid !== "number" || !Number.isFinite(payment.paid) || payment.paid < 0) {
      throw new Error(`payment for '${payment.name.trim()}': paid must be zero or more.`);
    }
  }

  const owedCents = splitCents(totalCents, names.map(() => 1));
  const people: Balance[] = input.payments.map((payment, i) => {
    const paidCents = Math.round(payment.paid * 100);
    return {
      name: names[i],
      paid: round2(paidCents / 100),
      owed: round2(owedCents[i] / 100),
      balance: round2((paidCents - owedCents[i]) / 100),
    };
  });
  const transfers = minimizeTransfers(people);

  return {
    total_costs: round2(totalCents / 100),
    people,
    transfers,
    note: transfers.length === 0 ? "Everyone is settled up." : `${transfers.length} payment(s) settle the group with the fewest transfers.`,
  };
}

const DEFAULT_HOUSE_RULES = [
  "Quiet hours: 22:00 to 08:00; use headphones and keep noise down at other times too.",
  "Guests: tell housemates before overnight guests; stays longer than two weeks need everyone's agreement.",
  "Cleaning rota: shared areas are cleaned weekly on a rota agreed by all tenants; dishes are washed the same day.",
  "Shared supplies: household basics (bin bags, cleaning products, toilet paper) are bought from a shared kitty split equally.",
];

/** Drafts a plain-language shared-living agreement for a house share. */
export function roommateAgreement(input: AgreementInput): object {
  if (typeof input.property_address !== "string" || !input.property_address.trim()) {
    throw new Error("property_address must be a non-empty street address, e.g. '12 Elm Street, Flat 3'.");
  }
  if (!Array.isArray(input.tenants) || input.tenants.length < 2) {
    throw new Error("tenants must list at least 2 people.");
  }
  const tenants = cleanNames(input.tenants, "tenant");
  if (typeof input.move_in_date !== "string" || !isIsoDate(input.move_in_date)) {
    throw new Error("move_in_date must be a real calendar date in YYYY-MM-DD format, e.g. 2026-11-01.");
  }
  if (!isPositiveNumber(input.monthly_rent)) throw new Error("monthly_rent must be a positive number, e.g. 2400.");
  if (typeof input.deposit !== "number" || !Number.isFinite(input.deposit) || input.deposit < 0) {
    throw new Error("deposit must be zero or more (use 0 when no deposit is collected).");
  }
  const notice = input.notice_period_months ?? 1;
  if (!Number.isInteger(notice) || notice < 1) throw new Error("notice_period_months must be a positive whole number of months (e.g. 1).");
  if (input.utilities_policy !== undefined && (typeof input.utilities_policy !== "string" || !input.utilities_policy.trim())) {
    throw new Error("utilities_policy must be a non-empty sentence, e.g. 'Split equally unless agreed otherwise'.");
  }
  if (input.house_rules !== undefined) {
    if (!Array.isArray(input.house_rules)) throw new Error("house_rules must be a list of rule strings.");
    for (const rule of input.house_rules) {
      if (typeof rule !== "string" || !rule.trim()) throw new Error("every house rule must be a non-empty sentence.");
    }
  }

  const assignments: Array<{ name: string; room: string }> = [];
  if (input.room_assignments !== undefined) {
    if (!Array.isArray(input.room_assignments)) throw new Error("room_assignments must be a list of {name, room}.");
    const seen = new Set<string>();
    for (const entry of input.room_assignments) {
      if (!entry || typeof entry.name !== "string" || typeof entry.room !== "string" || !entry.name.trim() || !entry.room.trim()) {
        throw new Error("every room assignment needs a tenant name and a room label.");
      }
      const name = entry.name.trim();
      if (!tenants.includes(name)) throw new Error(`room assignment for '${name}' - not one of the tenants (${tenants.join(", ")}).`);
      if (seen.has(name)) throw new Error(`tenant '${name}' is assigned more than one room - assign one room per tenant.`);
      seen.add(name);
      assignments.push({ name, room: entry.room.trim() });
    }
  }

  const rentCents = splitCents(Math.round(input.monthly_rent * 100), tenants.map(() => 1));
  const perPerson = tenants.map((name, i) => `${name}: ${(rentCents[i] / 100).toFixed(2)}`);
  const rules = input.house_rules && input.house_rules.length > 0 ? input.house_rules.map((r) => r.trim()) : DEFAULT_HOUSE_RULES;
  const depositText =
    input.deposit > 0
      ? `The tenants pay a deposit of ${input.deposit.toFixed(2)} on or before the move-in date. The deposit is held against unpaid rent or damage beyond normal wear and tear and is returned within 14 days of move-out, after a joint inspection and once all bills are settled.`
      : "No deposit is collected under this agreement.";

  const lines: string[] = [
    "SHARED-LIVING (ROOMMATE) AGREEMENT",
    "",
    `Property: ${input.property_address.trim()}`,
    `Move-in date: ${input.move_in_date}`,
    "",
    "1. Parties",
    `This agreement is between the tenants sharing the property: ${tenants.join(", ")} (each a \"tenant\", together \"the tenants\").`,
    "",
    "2. Term",
    `The tenancy is month-to-month, starting on ${input.move_in_date}, and continues until a tenant gives ${notice} month(s) written notice (or the notice required by local law, if longer).`,
    "",
    "3. Rent",
    `Monthly rent for the property is ${input.monthly_rent.toFixed(2)}. Rent is shared equally between the ${tenants.length} tenants: ${perPerson.join("; ")} per month, due on the 1st of each month unless the tenants agree otherwise in writing.`,
  ];
  if (assignments.length > 0) {
    lines.push(`Room assignments: ${assignments.map((a) => `${a.name} - ${a.room}`).join("; ")}. Rooms may only be swapped with everyone's agreement.`);
  }
  lines.push(
    "",
    "4. Deposit",
    depositText,
    "",
    "5. Utilities and household bills",
    `${(input.utilities_policy ?? "Utilities (electricity, water, gas, internet) are split equally between the tenants unless agreed otherwise.").trim()}`,
    "",
    "6. House rules",
    ...rules.map((rule) => `- ${rule}`),
    "",
    "7. Notice, changes and leaving",
    `A tenant who wants to leave gives ${notice} month(s) written notice. A leaving tenant keeps paying their share until the notice period ends or a replacement tenant is agreed, whichever comes first. Any change to this agreement must be agreed in writing and signed by all tenants.`,
    "",
    "8. Signatures",
    "Signed and dated by each tenant (keep a copy each):",
    "",
  );
  for (const tenant of tenants) {
    lines.push(`${tenant}: ______________________________    Date: ____________`);
  }

  return {
    agreement: lines.join("\n"),
    checklist: [
      "Check local rules first: deposit protection, minimum notice and occupancy limits differ by country and state - adjust the template before signing.",
      "Walk the property together and photograph existing damage before move-in; attach the photo inventory to the agreement.",
      "Agree who holds the deposit and in which account, and write down how and when it is returned.",
      "Confirm which tenant is named on each utility account and how the money is collected each month.",
      "Put the practical details in writing: quiet hours, guest expectations, cleaning rota and shared supplies.",
      "Sign and date a copy per tenant; store one copy with the household papers and revisit the agreement if anyone moves in or out.",
    ],
    disclaimer: "Informational template; not legal advice - have it reviewed if significant amounts are involved.",
  };
}
