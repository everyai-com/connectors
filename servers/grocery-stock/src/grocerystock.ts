/**
 * GroceryStock engine - weekly grocery restock planning: runout forecasts,
 * restock lists, basket quotes from typical US prices, store-tier comparison,
 * budget swaps and restock schedules.
 * Pure computation: no dependencies, no network, nothing stored. No ordering.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

const norm = (s: string): string =>
  s.trim().toLowerCase().replace(/[\s_.-]+/g, "_").replace(/[^a-z0-9_]/g, "");

interface PriceDef { unit: string; price_usd: number; }

// Typical US grocery prices (2026 approximations). Always labeled as typical;
// callers must verify against current store pricing before spending.
const TYPICAL_PRICES: Record<string, PriceDef> = {
  milk: { unit: "gallon", price_usd: 4.2 },
  eggs: { unit: "dozen", price_usd: 3.8 },
  bread: { unit: "loaf", price_usd: 3.5 },
  butter: { unit: "lb", price_usd: 4.9 },
  cheddar: { unit: "lb", price_usd: 5.6 },
  yogurt: { unit: "32oz tub", price_usd: 4.4 },
  chicken_breast: { unit: "lb", price_usd: 3.9 },
  ground_beef: { unit: "lb", price_usd: 5.4 },
  ground_turkey: { unit: "lb", price_usd: 4.3 },
  salmon: { unit: "lb", price_usd: 11.9 },
  bacon: { unit: "12oz pack", price_usd: 6.2 },
  bananas: { unit: "lb", price_usd: 0.7 },
  apples: { unit: "lb", price_usd: 1.9 },
  oranges: { unit: "lb", price_usd: 1.6 },
  strawberries: { unit: "lb", price_usd: 2.8 },
  blueberries: { unit: "6oz pack", price_usd: 3.9 },
  frozen_berries: { unit: "12oz bag", price_usd: 3.4 },
  spinach: { unit: "5oz bag", price_usd: 3.2 },
  frozen_veg: { unit: "12oz bag", price_usd: 1.8 },
  broccoli: { unit: "head", price_usd: 2.1 },
  carrots: { unit: "2lb bag", price_usd: 1.9 },
  tomatoes: { unit: "lb", price_usd: 2.4 },
  potatoes: { unit: "5lb bag", price_usd: 3.6 },
  onions: { unit: "3lb bag", price_usd: 2.9 },
  garlic: { unit: "head", price_usd: 0.8 },
  rice: { unit: "5lb bag", price_usd: 4.8 },
  pasta: { unit: "lb", price_usd: 1.4 },
  oats: { unit: "42oz tub", price_usd: 5.2 },
  flour: { unit: "5lb bag", price_usd: 3.4 },
  sugar: { unit: "4lb bag", price_usd: 3.1 },
  coffee: { unit: "12oz bag", price_usd: 9.8 },
  olive_oil: { unit: "17oz bottle", price_usd: 8.4 },
  peanut_butter: { unit: "28oz jar", price_usd: 3.9 },
  cereal: { unit: "box", price_usd: 4.6 },
  tortillas: { unit: "10-pack", price_usd: 2.7 },
  black_beans: { unit: "15oz can", price_usd: 1.1 },
  canned_tomatoes: { unit: "28oz can", price_usd: 1.9 },
};

const KNOWN_ITEMS = Object.keys(TYPICAL_PRICES).join(", ");

function priceOf(raw: string): { key: string; def: PriceDef } {
  const key = norm(raw);
  const def = TYPICAL_PRICES[key];
  if (!def) throw new Error(`ERROR unknown item '${raw}'. Priced staples: ${KNOWN_ITEMS}.`);
  return { key, def };
}

const PRICE_NOTE = "Typical US prices - verify current store pricing before spending.";

export type Staple = { item: string; on_hand: number; unit?: string; use_per_week: number };

function checkStaple(s: Staple): void {
  if (!s.item?.trim()) throw new Error("ERROR each staple needs an item name.");
  if (typeof s.on_hand !== "number" || s.on_hand < 0)
    throw new Error(`ERROR on_hand for '${s.item}' must be a number >= 0.`);
  if (typeof s.use_per_week !== "number" || s.use_per_week <= 0)
    throw new Error(`ERROR use_per_week for '${s.item}' must be a number > 0.`);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function forecastRunout(o: { staples: Staple[]; as_of?: string }) {
  if (!Array.isArray(o.staples) || o.staples.length === 0)
    throw new Error("ERROR staples must be a non-empty array.");
  const asOf = o.as_of ?? todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`ERROR as_of must be YYYY-MM-DD, got '${o.as_of}'.`);
  const items = o.staples.map((s) => {
    checkStaple(s);
    const weeksLeft = s.use_per_week > 0 ? s.on_hand / s.use_per_week : 0;
    const status = s.on_hand <= 0 ? "out" : weeksLeft < 1 ? "low" : "ok";
    return {
      item: s.item, on_hand: s.on_hand, unit: s.unit ?? "unit",
      use_per_week: s.use_per_week, weeks_left: round2(weeksLeft),
      runout_date: addDaysISO(asOf, Math.floor(weeksLeft * 7)), status,
    };
  });
  return {
    as_of: asOf,
    items,
    summary: {
      out: items.filter((i) => i.status === "out").length,
      low: items.filter((i) => i.status === "low").length,
      ok: items.filter((i) => i.status === "ok").length,
    },
  };
}

export function buildRestockList(o: { staples: Staple[]; weeks_ahead?: number }) {
  if (!Array.isArray(o.staples) || o.staples.length === 0)
    throw new Error("ERROR staples must be a non-empty array.");
  const weeks = o.weeks_ahead ?? 2;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8)
    throw new Error("ERROR weeks_ahead must be an integer 1-8.");
  const items = o.staples.map((s) => {
    checkStaple(s);
    const need = Math.max(0, s.use_per_week * weeks - s.on_hand);
    return { item: s.item, unit: s.unit ?? "unit", buy: Math.ceil(need * 100) / 100, covered: need <= 0 };
  });
  return { weeks_ahead: weeks, items, buy_count: items.filter((i) => i.buy > 0).length };
}

export type BasketItem = { item: string; quantity: number };

function checkBasket(items: BasketItem[]): void {
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("ERROR items must be a non-empty array.");
  for (const it of items) {
    if (!it.item?.trim()) throw new Error("ERROR each basket item needs a name.");
    if (typeof it.quantity !== "number" || it.quantity <= 0)
      throw new Error(`ERROR quantity for '${it.item}' must be a number > 0.`);
  }
}

export function quoteBasket(o: { items: BasketItem[] }) {
  checkBasket(o.items);
  const lines = o.items.map((it) => {
    const { key, def } = priceOf(it.item);
    return { item: key, quantity: it.quantity, unit: def.unit, unit_price_usd: def.price_usd, line_total_usd: round2(it.quantity * def.price_usd) };
  });
  return { lines, total_usd: round2(lines.reduce((s, l) => s + l.line_total_usd, 0)), note: PRICE_NOTE };
}

const TIER_MULTIPLIER: Record<string, number> = { budget: 0.85, standard: 1.0, premium: 1.25 };

export function compareStoreTiers(o: { items: BasketItem[] }) {
  const q = quoteBasket(o);
  const tiers = Object.entries(TIER_MULTIPLIER).map(([tier, mult]) => ({
    tier, multiplier: mult, total_usd: round2(q.total_usd * mult),
  }));
  const cheapest = tiers.reduce((a, b) => (a.total_usd <= b.total_usd ? a : b));
  const priciest = tiers.reduce((a, b) => (a.total_usd >= b.total_usd ? a : b));
  return {
    base_total_usd: q.total_usd, tiers, cheapest_tier: cheapest.tier,
    savings_vs_premium_usd: round2(priciest.total_usd - cheapest.total_usd),
    note: "Tier multipliers are estimates (budget 0.85x, standard 1x, premium 1.25x typical). " + PRICE_NOTE,
  };
}

const SWAPS: Array<{ from: string; to: string }> = [
  { from: "salmon", to: "chicken_breast" },
  { from: "strawberries", to: "frozen_berries" },
  { from: "blueberries", to: "frozen_berries" },
  { from: "spinach", to: "frozen_veg" },
  { from: "ground_beef", to: "ground_turkey" },
  { from: "bacon", to: "eggs" },
];

export function suggestSwaps(o: { items: BasketItem[]; budget_usd: number }) {
  checkBasket(o.items);
  if (typeof o.budget_usd !== "number" || o.budget_usd <= 0)
    throw new Error("ERROR budget_usd must be a number > 0.");
  const priced = o.items.map((it) => {
    const { key, def } = priceOf(it.item);
    return { item: key, quantity: it.quantity, unit: def.unit, line_total_usd: round2(it.quantity * def.price_usd) };
  });
  let total = round2(priced.reduce((s, l) => s + l.line_total_usd, 0));
  const swaps: Array<{ from: string; to: string; saved_usd: number }> = [];
  const unswappable: string[] = [];
  for (const line of [...priced].sort((a, b) => b.line_total_usd - a.line_total_usd)) {
    if (total <= o.budget_usd) break;
    const rule = SWAPS.find((s) => s.from === line.item);
    if (!rule) { unswappable.push(line.item); continue; }
    const alt = TYPICAL_PRICES[rule.to];
    const altTotal = round2(line.quantity * alt.price_usd);
    const saved = round2(line.line_total_usd - altTotal);
    if (saved <= 0) { unswappable.push(line.item); continue; }
    line.item = rule.to; line.unit = alt.unit; line.line_total_usd = altTotal;
    total = round2(total - saved);
    swaps.push({ from: rule.from, to: rule.to, saved_usd: saved });
  }
  return {
    original_total_usd: round2(priced.reduce((s, l) => s + l.line_total_usd, 0)) + round2(swaps.reduce((s, w) => s + w.saved_usd, 0)),
    budget_usd: o.budget_usd, lines: priced, swaps, unswappable,
    new_total_usd: total, within_budget: total <= o.budget_usd, note: PRICE_NOTE,
  };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function restockSchedule(o: { start_date: string; weekday?: string; count?: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.start_date))
    throw new Error(`ERROR start_date must be YYYY-MM-DD, got '${o.start_date}'.`);
  const day = (o.weekday ?? "sunday").trim().toLowerCase();
  const target = WEEKDAYS.indexOf(day);
  if (target < 0) throw new Error(`ERROR weekday must be one of ${WEEKDAYS.join(", ")}, got '${o.weekday}'.`);
  const count = o.count ?? 4;
  if (!Number.isInteger(count) || count < 1 || count > 12)
    throw new Error("ERROR count must be an integer 1-12.");
  const start = new Date(`${o.start_date}T00:00:00Z`);
  const delta = (target - start.getUTCDay() + 7) % 7;
  const dates: string[] = [];
  for (let i = 0; i < count; i++) dates.push(addDaysISO(o.start_date, delta + i * 7));
  return { start_date: o.start_date, weekday: day, dates };
}
