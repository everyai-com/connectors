/**
 * HvacRescue engine - HVAC triage and rescue planning: triage symptoms with
 * severity + safety steps (gas and electrical first), search tech
 * availability windows, quote jobs from a pricebook, compare techs on your
 * numbers, draft a dispatch request, compute tuneup schedules. Pure
 * computation over user-supplied pricebooks and availability: no tech
 * inventory, no dispatch API, nothing stored. Planning only.
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
export function triageSymptom(o: { symptom: string; details?: string }) {
  const key = ((o.symptom as string) ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const table: Record<string, { severity: string; causes: string[]; safety: string[]; pro: boolean }> = {
    gas_smell: {
      severity: "emergency",
      causes: ["gas leak at furnace, line or meter"],
      safety: ["leave the building NOW - do not flip switches or light anything", "call 911 and the gas company from outside", "do not re-enter until cleared"],
      pro: true,
    },
    burning_smell: {
      severity: "emergency",
      causes: ["overheating motor or wiring", "dust burn-off on first seasonal heat (mild, brief only)"],
      safety: ["shut the system off at the thermostat", "if smoke or strong burning: kill the breaker and call the fire department", "brief dusty smell on first heat is normal; anything lasting is not"],
      pro: true,
    },
    no_cool: {
      severity: "same_day",
      causes: ["tripped breaker or blown fuse", "clogged filter freezing the coil", "failed capacitor or contactor", "low refrigerant (leak hunt needed)"],
      safety: ["check thermostat mode + batteries, then the breaker", "a frozen indoor coil: shut cooling off, run fan-only to thaw, change the filter"],
      pro: false,
    },
    no_heat: {
      severity: "same_day",
      causes: ["thermostat or breaker", "failed igniter or flame sensor", "clogged filter tripping the limit switch"],
      safety: ["check thermostat heat mode + breaker first", "never bypass safety switches", "carbon-monoxide alarm going off: leave and call 911"],
      pro: false,
    },
    strange_noise: {
      severity: "routine",
      causes: ["loose panel or duct popping", "worn blower belt or bearing", "debris in the outdoor unit"],
      safety: ["shut off before opening any panel", "grinding or screeching: shut down and call a tech - running it worsens damage"],
      pro: false,
    },
    water_leak: {
      severity: "same_day",
      causes: ["clogged condensate drain", "cracked drain pan", "frozen coil thawing over"],
      safety: ["shut cooling off to stop condensate", "wet-vac the water, photo damage for insurance", "water near the furnace electrics: kill the breaker"],
      pro: false,
    },
    high_bill: {
      severity: "routine",
      causes: ["dirty filter or coils", "leaky ducts", "short-cycling from oversizing or low refrigerant", "thermostat schedule drift"],
      safety: ["change the filter and compare next bill before spending on parts", "a sudden 30%+ jump with no weather change: book a tuneup"],
      pro: false,
    },
  };
  const hit = table[key];
  if (!hit) throw new Error(`ERROR symptom must be one of ${Object.keys(table).join(", ")}, got '${o.symptom}'.`);
  return {
    symptom: key,
    severity: hit.severity,
    likely_causes: hit.causes,
    safety_steps: hit.safety,
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

export type Tech = { name: string; price_usd: number; rating: number; distance_min: number };

export function compareTechs(o: { techs: Tech[] }) {
  if (!Array.isArray(o.techs) || o.techs.length < 2 || o.techs.length > 6)
    throw new Error("ERROR techs must be an array of 2-6.");
  const prices = o.techs.map((p) => p.price_usd);
  const dists = o.techs.map((p) => p.distance_min);
  const loP = Math.min(...prices), hiP = Math.max(...prices);
  const loD = Math.min(...dists), hiD = Math.max(...dists);
  const ranked = o.techs.map((p) => {
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
  const message = `Hi! I need an HVAC tech for ${o.job} on ${date} at ${time}. Name: ${o.name}${o.phone ? `, callback: ${o.phone}` : ""}. ${units} system(s). Please confirm ETA and upfront price. Thanks!`;
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

export function tuneupSchedule(o: { last_tuneup: string; every_months?: number; count?: number }) {
  const last = checkDate(o.last_tuneup, "last_tuneup");
  const every = o.every_months ?? 6;
  const count = o.count ?? 4;
  if (!Number.isInteger(every) || every < 1 || every > 24) throw new Error("ERROR every_months must be an integer 1-24.");
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("ERROR count must be an integer 1-12.");
  const [y, m, d] = last.split("-").map(Number);
  const dates: string[] = [];
  for (let i = 1; i <= count; i++) {
    const dt = new Date(Date.UTC(y, m - 1 + every * i, d));
    dates.push(dt.toISOString().slice(0, 10));
  }
  return { last_tuneup: last, every_months: every, dates };
}
