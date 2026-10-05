/**
 * PlumbNow engine - plumbing triage and dispatch planning: diagnose common
 * issues with severity + shutoff steps, search plumber availability windows,
 * quote jobs from a pricebook, compare plumbers on your numbers, draft a
 * dispatch request, compute job reminders. Pure computation over
 * user-supplied pricebooks and availability: no plumber inventory, no
 * dispatch API, nothing stored. Planning only - never books anything.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export type Window = { day: string; start: string; end: string };

function checkDay(raw: unknown, what: string): string {
  const day = ((raw as string) ?? "").trim().toLowerCase();
  if (!WEEKDAYS.includes(day)) throw new Error(`ERROR ${what} must be a weekday, got '${raw}'.`);
  return day;
}

function checkTime(raw: unknown, what: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test((raw as string) ?? ""))
    throw new Error(`ERROR ${what} must be HH:MM (24h), got '${raw}'.`);
  return raw as string;
}

function checkDate(raw: unknown, what: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((raw as string) ?? "") || Number.isNaN(Date.parse((raw as string) ?? "")))
    throw new Error(`ERROR ${what} must be YYYY-MM-DD, got '${raw}'.`);
  return raw as string;
}

function toMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function toHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function checkWindows(windows: Window[]): Window[] {
  if (!Array.isArray(windows) || windows.length === 0)
    throw new Error("ERROR availability must be a non-empty array of windows.");
  return windows.map((w, i) => {
    const at = `window ${i + 1}`;
    const day = checkDay(w.day, `${at} day`);
    const start = checkTime(w.start, `${at} start`);
    const end = checkTime(w.end, `${at} end`);
    if (toMin(end) <= toMin(start)) throw new Error(`ERROR ${at} end must be after start.`);
    return { day, start, end };
  });
}

// ---------------------------------------------------------------------------
export function diagnoseIssue(o: { symptom: string; details?: string }) {
  const key = ((o.symptom as string) ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const table: Record<string, { severity: string; causes: string[]; shutoff: string[]; pro: boolean }> = {
    leak: {
      severity: "same_day",
      causes: ["worn washer or O-ring", "loose supply-line connection", "cracked trap or tailpiece"],
      shutoff: ["close the fixture shutoff valves (under sink / behind toilet)", "put a bucket under the drip and dry the area", "photo the leak for the plumber"],
      pro: false,
    },
    burst_pipe: {
      severity: "emergency",
      causes: ["frozen pipe split", "corrosion failure", "high water pressure spike"],
      shutoff: ["shut the MAIN water valve off first", "kill the breaker if water nears outlets or the panel", "open lowest faucets to drain pressure", "call a plumber now - do not wait"],
      pro: true,
    },
    clog: {
      severity: "routine",
      causes: ["grease or hair buildup", "foreign object", "vent stack blockage"],
      shutoff: ["stop running water into the drain", "try a plunger (never chemical cleaner on a full blockage)", "check other drains - many slow at once means a main-line clog, call a pro"],
      pro: false,
    },
    no_hot_water: {
      severity: "same_day",
      causes: ["tripped breaker or failed heating element", "pilot light or igniter out", "sediment-choked tank"],
      shutoff: ["check the water-heater breaker before anything else", "note the tank age (10+ years: plan replacement, not repair)", "do not open the TP relief valve to test - scald risk"],
      pro: false,
    },
    low_pressure: {
      severity: "routine",
      causes: ["clogged faucet aerator", "failing pressure regulator", "hidden leak (check the meter with taps off)"],
      shutoff: ["clean one aerator first - fixes most single-fixture cases", "read the water meter, wait 2h with no use, read again - movement means a leak"],
      pro: false,
    },
    running_toilet: {
      severity: "routine",
      causes: ["worn flapper", "mis-set fill valve or chain"],
      shutoff: ["jiggle the handle - stops it, the flapper is worn", "drop food dye in the tank - color in the bowl in 10 min confirms a flapper leak"],
      pro: false,
    },
    sewer_smell: {
      severity: "same_day",
      causes: ["dry drain trap", "blocked vent stack", "failed wax ring"],
      shutoff: ["run water in every rarely-used drain for 30 seconds", "if the smell is strong across rooms, leave and call a plumber - sewer gas is hazardous"],
      pro: true,
    },
  };
  const hit = table[key];
  if (!hit) throw new Error(`ERROR symptom must be one of ${Object.keys(table).join(", ")}, got '${o.symptom}'.`);
  return {
    symptom: key,
    severity: hit.severity,
    likely_causes: hit.causes,
    shutoff_steps: hit.shutoff,
    call_pro: hit.pro,
    note: o.details ? `Caller adds: ${o.details}` : "No extra details.",
  };
}

export function findSlots(o: { availability: Window[]; day?: string; duration_min?: number; after?: string; before?: string }) {
  const windows = checkWindows(o.availability);
  const duration = o.duration_min ?? 60;
  if (!Number.isInteger(duration) || duration < 15 || duration > 240)
    throw new Error("ERROR duration_min must be an integer 15-240.");
  let list = windows;
  if (o.day !== undefined) list = list.filter((w) => w.day === checkDay(o.day, "day"));
  const afterMin = o.after !== undefined ? toMin(checkTime(o.after, "after")) : 0;
  const beforeMin = o.before !== undefined ? toMin(checkTime(o.before, "before")) : 24 * 60;
  const slots: string[] = [];
  for (const w of list) {
    let s = Math.max(toMin(w.start), afterMin);
    const end = Math.min(toMin(w.end), beforeMin);
    s = Math.ceil(s / 30) * 30;
    while (s + duration <= end) {
      slots.push(`${w.day} ${toHHMM(s)}`);
      s += 30;
    }
  }
  return { duration_min: duration, slots, count: slots.length };
}

export type PriceItem = { name: string; price_usd: number; duration_min: number };

export function quoteJob(o: { pricebook: PriceItem[]; job: string; add_ons?: string[] }) {
  if (!Array.isArray(o.pricebook) || o.pricebook.length === 0)
    throw new Error("ERROR pricebook must be a non-empty array.");
  const find = (n: string): PriceItem => {
    const hit = o.pricebook.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!hit) throw new Error(`ERROR unknown job '${n}'. Valid: ${o.pricebook.map((p) => p.name).join(", ")}.`);
    return hit;
  };
  const lines = [find(o.job), ...(o.add_ons ?? []).map(find)];
  return {
    lines: lines.map((l) => ({ item: l.name, price_usd: l.price_usd })),
    total_usd: round2(lines.reduce((t, l) => t + l.price_usd, 0)),
    total_minutes: lines.reduce((t, l) => t + l.duration_min, 0),
  };
}

export type Plumber = { name: string; price_usd: number; rating: number; distance_min: number };

export function comparePlumbers(o: { plumbers: Plumber[] }) {
  if (!Array.isArray(o.plumbers) || o.plumbers.length < 2 || o.plumbers.length > 6)
    throw new Error("ERROR plumbers must be an array of 2-6.");
  const prices = o.plumbers.map((p) => p.price_usd);
  const dists = o.plumbers.map((p) => p.distance_min);
  const loP = Math.min(...prices), hiP = Math.max(...prices);
  const loD = Math.min(...dists), hiD = Math.max(...dists);
  const ranked = o.plumbers.map((p) => {
    if (p.rating < 1 || p.rating > 5) throw new Error(`ERROR rating for '${p.name}' must be 1-5.`);
    const score = round3(
      0.5 * (p.rating / 5) +
      0.3 * (hiP === loP ? 1 : 1 - (p.price_usd - loP) / (hiP - loP)) +
      0.2 * (hiD === loD ? 1 : 1 - (p.distance_min - loD) / (hiD - loD)),
    );
    return { name: p.name, score };
  }).sort((a, b) => b.score - a.score);
  return { ranking: ranked, pick: ranked[0].name };
}

export function buildDispatchRequest(o: { job: string; date: string; time: string; name: string; phone?: string; units?: number }) {
  const date = checkDate(o.date, "date");
  const time = checkTime(o.time, "time");
  if (!o.job.trim() || !o.name.trim()) throw new Error("ERROR job and name must be non-empty.");
  const units = o.units ?? 1;
  if (!Number.isInteger(units) || units < 1 || units > 10) throw new Error("ERROR units must be an integer 1-10.");
  const message = `Hi! I need a plumber for ${o.job} on ${date} at ${time}. Name: ${o.name}${o.phone ? `, callback: ${o.phone}` : ""}. ${units} unit(s). Please confirm ETA and upfront price. Thanks!`;
  return { message, job: o.job, date, time, name: o.name };
}

export function jobReminders(o: { job: string; starts_at: string; lead_hours?: number[] }) {
  const start = Date.parse(o.starts_at);
  if (Number.isNaN(start)) throw new Error(`ERROR starts_at must be ISO datetime, got '${o.starts_at}'.`);
  const leads = o.lead_hours ?? [24, 2];
  if (!Array.isArray(leads) || leads.length === 0) throw new Error("ERROR lead_hours must be a non-empty array.");
  return {
    job: o.job,
    starts_at: o.starts_at,
    reminders: leads.map((h) => {
      if (typeof h !== "number" || h <= 0 || h > 168) throw new Error(`ERROR lead hour must be 0-168, got '${h}'.`);
      return new Date(start - h * 3600_000).toISOString();
    }),
  };
}

export function maintenancePlan(o: { last_visit: string; every_months?: number; count?: number }) {
  const last = checkDate(o.last_visit, "last_visit");
  const every = o.every_months ?? 12;
  const count = o.count ?? 2;
  if (!Number.isInteger(every) || every < 1 || every > 24) throw new Error("ERROR every_months must be an integer 1-24.");
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("ERROR count must be an integer 1-12.");
  const [y, m, d] = last.split("-").map(Number);
  const dates: string[] = [];
  for (let i = 1; i <= count; i++) {
    const dt = new Date(Date.UTC(y, m - 1 + every * i, d));
    dates.push(dt.toISOString().slice(0, 10));
  }
  return { last_visit: last, every_months: every, dates };
}
