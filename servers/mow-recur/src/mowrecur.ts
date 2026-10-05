/**
 * MowRecur engine - recurring lawn-care planning: mow schedules, seasonal
 * quotes, provider comparison, service-request drafts, annual care calendars
 * and mow reminders.
 * Pure computation: no provider inventory, no booking API, nothing stored.
 * No real bookings are made.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function checkDate(raw: unknown, what: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((raw as string) ?? ""))
    throw new Error(`ERROR ${what} must be YYYY-MM-DD, got '${raw}'.`);
  return raw as string;
}

function checkWeekday(raw: unknown, what: string): string {
  const day = ((raw as string) ?? "").trim().toLowerCase();
  if (!WEEKDAYS.includes(day)) throw new Error(`ERROR ${what} must be a weekday, got '${raw}'.`);
  return day;
}

export function mowSchedule(o: { season_start: string; season_end: string; weekday?: string; every_weeks?: number }) {
  const start = checkDate(o.season_start, "season_start");
  const end = checkDate(o.season_end, "season_end");
  if (end < start) throw new Error("ERROR season_end must be on or after season_start.");
  const day = checkWeekday(o.weekday ?? "saturday", "weekday");
  const every = o.every_weeks ?? 1;
  if (!Number.isInteger(every) || every < 1 || every > 4)
    throw new Error("ERROR every_weeks must be an integer 1-4.");
  const target = WEEKDAYS.indexOf(day);
  const startDay = new Date(`${start}T00:00:00Z`).getUTCDay();
  const jsTarget = (target + 1) % 7;
  const delta = (jsTarget - startDay + 7) % 7;
  const dates: string[] = [];
  for (let d = delta; ; d += every * 7) {
    const iso = addDaysISO(start, d);
    if (iso > end) break;
    dates.push(iso);
    if (dates.length >= 40) break;
  }
  return { season_start: start, season_end: end, weekday: day, every_weeks: every, dates, cuts: dates.length };
}

export function quoteSeason(o: { cuts: number; price_per_cut: number; extras?: Array<{ name: string; price_usd: number }> }) {
  if (!Number.isInteger(o.cuts) || o.cuts < 1 || o.cuts > 60)
    throw new Error("ERROR cuts must be an integer 1-60.");
  if (typeof o.price_per_cut !== "number" || o.price_per_cut <= 0)
    throw new Error("ERROR price_per_cut must be a number > 0.");
  const lines = [{ item: `Mowing x${o.cuts}`, price_usd: round2(o.cuts * o.price_per_cut) }];
  for (const e of o.extras ?? []) {
    if (!e.name?.trim()) throw new Error("ERROR each extra needs a name.");
    if (typeof e.price_usd !== "number" || e.price_usd <= 0)
      throw new Error(`ERROR price_usd for '${e.name}' must be a number > 0.`);
    lines.push({ item: e.name.trim(), price_usd: round2(e.price_usd) });
  }
  return {
    lines, total_usd: round2(lines.reduce((s, l) => s + l.price_usd, 0)),
    per_cut_usd: round2(o.price_per_cut),
    note: "Quote from your numbers. Verify the provider's current rates before paying.",
  };
}

export type Provider = { name: string; price_per_cut: number; rating: number; visits_per_month: number };

export function compareProviders(o: { providers: Provider[] }) {
  if (!Array.isArray(o.providers) || o.providers.length < 2 || o.providers.length > 6)
    throw new Error("ERROR providers must be 2-6 options to compare.");
  const rows = o.providers.map((p, i) => {
    const at = `provider ${i + 1}`;
    if (!p.name?.trim()) throw new Error(`ERROR ${at} needs a name.`);
    if (typeof p.price_per_cut !== "number" || p.price_per_cut <= 0)
      throw new Error(`ERROR price_per_cut for '${p.name}' must be a number > 0.`);
    if (typeof p.rating !== "number" || p.rating < 1 || p.rating > 5)
      throw new Error(`ERROR rating for '${p.name}' must be 1-5.`);
    if (!Number.isInteger(p.visits_per_month) || p.visits_per_month < 1 || p.visits_per_month > 8)
      throw new Error(`ERROR visits_per_month for '${p.name}' must be an integer 1-8.`);
    return { name: p.name.trim(), price_per_cut: p.price_per_cut, rating: p.rating, visits_per_month: p.visits_per_month };
  });
  const monthly = rows.map((r) => ({ ...r, monthly_usd: round2(r.price_per_cut * r.visits_per_month) }));
  const costs = monthly.map((r) => r.monthly_usd);
  const lo = Math.min(...costs), hi = Math.max(...costs);
  const scored = monthly.map((r) => {
    const costScore = hi === lo ? 1 : 1 - (r.monthly_usd - lo) / (hi - lo);
    const score = round2(0.5 * (r.rating / 5) + 0.5 * costScore);
    return { ...r, score };
  }).sort((a, b) => b.score - a.score);
  return {
    ranking: scored, pick: scored[0].name,
    note: "Scored from your numbers: 50% rating, 50% monthly cost. Verify ratings and rates yourself.",
  };
}

export function buildServiceRequest(o: { service: string; start_date: string; frequency: string; name: string; phone?: string; lot_size?: string }) {
  if (!o.service?.trim()) throw new Error("ERROR service must be a non-empty string.");
  checkDate(o.start_date, "start_date");
  if (!o.frequency?.trim()) throw new Error("ERROR frequency must be a non-empty string (e.g. 'weekly').");
  if (!o.name?.trim()) throw new Error("ERROR name must be a non-empty string.");
  const lot = o.lot_size?.trim() ? ` Lot size: ${o.lot_size.trim()}.` : "";
  const contact = o.phone?.trim() ? ` Reach me at ${o.phone.trim()}.` : "";
  const message = `Hi! I'd like a quote for ${o.service.trim()} starting ${o.start_date}, ${o.frequency.trim()}. Name: ${o.name.trim()}.${lot}${contact} Please confirm availability and pricing. Thanks!`;
  return {
    message,
    details: { service: o.service.trim(), start_date: o.start_date, frequency: o.frequency.trim(), name: o.name.trim() },
    note: "Draft only - MowRecur does not book with any provider. Send this message to the provider to request service.",
  };
}

const CARE: Record<string, Array<{ month: string; task: string }>> = {
  cool: [
    { month: "March", task: "Soil test; sharpen mower blades; first tidy mow high." },
    { month: "April", task: "Pre-emergent weed control; first spring feeding." },
    { month: "May", task: "Spot-treat weeds; mow weekly at 3.5-4 inches." },
    { month: "June", task: "Watch for grubs and brown patch; water deeply 1 inch/week." },
    { month: "July", task: "Raise cut height in heat; water early morning." },
    { month: "August", task: "Plan fall renovation; control crabgrass escapes." },
    { month: "September", task: "Aerate, overseed and feed - the most important month." },
    { month: "October", task: "Winterizer feeding; keep mowing until growth stops." },
    { month: "November", task: "Final mow; mulch leaves; drain irrigation." },
    { month: "December-February", task: "Dormant: service equipment, plan spring seeding." },
  ],
  warm: [
    { month: "March", task: "Scalp dormant turf; pre-emergent weed control." },
    { month: "April", task: "First feeding as green-up starts; check irrigation." },
    { month: "May", task: "Mow twice weekly if needed; spot-treat weeds." },
    { month: "June", task: "Feed; watch for chinch bugs and armyworms." },
    { month: "July", task: "Deep water 1 inch/week; mow at recommended height." },
    { month: "August", task: "Last summer feeding; treat active pests." },
    { month: "September", task: "Final nitrogen 4-6 weeks before first frost." },
    { month: "October", task: "Overseed rye if wanted; raise cut height." },
    { month: "November", task: "Final mow; winterize irrigation." },
    { month: "December-February", task: "Dormant: limit traffic; plan spring scalp." },
  ],
};

export function careCalendar(o: { grass: string }) {
  const grass = (o.grass ?? "").trim().toLowerCase();
  if (grass !== "cool" && grass !== "warm")
    throw new Error("ERROR grass must be 'cool' (fescue, bluegrass) or 'warm' (bermuda, zoysia).");
  return {
    grass, calendar: CARE[grass],
    note: "General guidance for US lawns. Adjust dates to your frost calendar and local extension advice.",
  };
}

export function mowReminders(o: { mow_dates: string[]; lead_hours?: number[] }) {
  if (!Array.isArray(o.mow_dates) || o.mow_dates.length === 0 || o.mow_dates.length > 12)
    throw new Error("ERROR mow_dates must be 1-12 dates (YYYY-MM-DD).");
  const leads = o.lead_hours ?? [24, 2];
  if (!Array.isArray(leads) || leads.length === 0 || leads.length > 4)
    throw new Error("ERROR lead_hours must be 1-4 numbers.");
  for (const h of leads)
    if (typeof h !== "number" || h <= 0 || h > 72) throw new Error("ERROR each lead_hours value must be > 0 and <= 72.");
  const out = o.mow_dates.map((d) => {
    checkDate(d, "mow date");
    const at = Date.parse(`${d}T09:00:00Z`);
    return { date: d, reminders: leads.map((h) => new Date(at - h * 3600_000).toISOString()) };
  });
  return { mows: out, note: "Reminders assume a 9am mow. Set them in your own calendar app." };
}
