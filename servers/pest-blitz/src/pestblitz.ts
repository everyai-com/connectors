/**
 * PestBlitz engine - pest triage and treatment planning: identify likely
 * pests from signs with confidence + urgency, search pro availability
 * windows, quote treatments from a pricebook, compare providers on your
 * numbers, draft a dispatch request, compute retreatment schedules. Pure
 * computation over user-supplied pricebooks and availability: no provider
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
export type Sign = { type: string; where: string };

const SIGN_TABLE: Record<string, { pests: string[]; urgency: string; steps: string[] }> = {
  droppings: {
    pests: ["rodent", "cockroach"],
    urgency: "high",
    steps: ["do not sweep dry - spray disinfectant first (hantavirus risk)", "photo the droppings next to a coin for scale", "seal food in hard containers tonight"],
  },
  noises: {
    pests: ["rodent", "squirrel", "raccoon"],
    urgency: "medium",
    steps: ["note night vs day: night scratching = rodent, day thumps = squirrel/raccoon", "check the attic hatch for footprints in dust"],
  },
  mud_tubes: {
    pests: ["termite"],
    urgency: "high",
    steps: ["do not break the tubes - breaks scatter the colony trail for inspection", "tap nearby wood for hollow sound", "book a termite inspection this week - damage compounds fast"],
  },
  sawdust: {
    pests: ["carpenter_ant", "termite"],
    urgency: "high",
    steps: ["check if piles reappear after cleanup (active colony)", "look up for the kick-out hole above the pile"],
  },
  trails: {
    pests: ["ant", "termite"],
    urgency: "low",
    steps: ["follow the trail to the entry point, seal it with caulk", "wipe the trail with vinegar to break the pheromone line"],
  },
  nests: {
    pests: ["wasp", "bee", "rodent"],
    urgency: "medium",
    steps: ["paper nest + daytime buzzing = wasp: do not swat, treat at dusk or call a pro", "honeybee swarm: call a beekeeper, not an exterminator"],
  },
  bites: {
    pests: ["bedbug", "flea", "mosquito"],
    urgency: "high",
    steps: ["check mattress seams for rust spots and shed skins", "hot-dry bedding 30+ min, bag what you cannot wash", "do not move rooms - spreads bedbugs through the house"],
  },
  damage: {
    pests: ["termite", "carpenter_ant", "rodent"],
    urgency: "high",
    steps: ["probe damaged wood with a screwdriver - soft and papery means active", "photo everything before any repair covers evidence"],
  },
};

export function identifyPest(o: { signs: Sign[] }) {
  if (!Array.isArray(o.signs) || o.signs.length === 0)
    throw new Error("ERROR signs must be a non-empty array.");
  const votes = new Map<string, { hits: number; urgency: string; steps: string[] }>();
  const urgRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  for (const [i, s] of o.signs.entries()) {
    const key = ((s.type as string) ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const hit = SIGN_TABLE[key];
    if (!hit) throw new Error(`ERROR sign ${i + 1} type must be one of ${Object.keys(SIGN_TABLE).join(", ")}, got '${s.type}'.`);
    if (!s.where || !s.where.trim()) throw new Error(`ERROR sign ${i + 1} needs a 'where'.`);
    for (const p of hit.pests) {
      const cur = votes.get(p) ?? { hits: 0, urgency: "low", steps: hit.steps };
      cur.hits += 1;
      if (urgRank[hit.urgency] > urgRank[cur.urgency]) { cur.urgency = hit.urgency; cur.steps = hit.steps; }
      votes.set(p, cur);
    }
  }
  const total = o.signs.length;
  const candidates = [...votes.entries()].map(([pest, v]) => ({
    pest,
    confidence: round2(Math.min(0.95, v.hits / total + (v.hits > 1 ? 0.2 : 0))),
    urgency: v.urgency,
    next_steps: v.steps,
  })).sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  return { candidates, top_pick: candidates[0].pest };
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

export function quoteTreatment(o: { pricebook: PriceItem[]; treatment: string; add_ons?: string[] }) {
  if (!Array.isArray(o.pricebook) || o.pricebook.length === 0)
    throw new Error("ERROR pricebook must be a non-empty array.");
  const find = (n: string): PriceItem => {
    const hit = o.pricebook.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!hit) throw new Error(`ERROR unknown treatment '${n}'. Valid: ${o.pricebook.map((p) => p.name).join(", ")}.`);
    return hit;
  };
  const lines = [find(o.treatment), ...(o.add_ons ?? []).map(find)];
  return {
    lines: lines.map((l) => ({ item: l.name, price_usd: l.price_usd })),
    total_usd: round2(lines.reduce((t, l) => t + l.price_usd, 0)),
    total_minutes: lines.reduce((t, l) => t + l.duration_min, 0),
  };
}

export type Provider = { name: string; price_usd: number; rating: number; distance_min: number };

export function compareProviders(o: { providers: Provider[] }) {
  if (!Array.isArray(o.providers) || o.providers.length < 2 || o.providers.length > 6)
    throw new Error("ERROR providers must be an array of 2-6.");
  const prices = o.providers.map((p) => p.price_usd);
  const dists = o.providers.map((p) => p.distance_min);
  const loP = Math.min(...prices), hiP = Math.max(...prices);
  const loD = Math.min(...dists), hiD = Math.max(...dists);
  const ranked = o.providers.map((p) => {
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

export function buildDispatchRequest(o: { treatment: string; date: string; time: string; name: string; phone?: string; units?: number }) {
  const date = checkDate(o.date, "date");
  const time = checkTime(o.time, "time");
  if (!o.treatment.trim() || !o.name.trim()) throw new Error("ERROR treatment and name must be non-empty.");
  const units = o.units ?? 1;
  if (!Number.isInteger(units) || units < 1 || units > 10) throw new Error("ERROR units must be an integer 1-10.");
  const message = `Hi! I need pest control for ${o.treatment} on ${date} at ${time}. Name: ${o.name}${o.phone ? `, callback: ${o.phone}` : ""}. ${units} unit(s). Please confirm ETA and upfront price. Thanks!`;
  return { message, treatment: o.treatment, date, time, name: o.name };
}

export function visitReminders(o: { treatment: string; starts_at: string; lead_hours?: number[] }) {
  const start = Date.parse(o.starts_at);
  if (Number.isNaN(start)) throw new Error(`ERROR starts_at must be ISO datetime, got '${o.starts_at}'.`);
  const leads = o.lead_hours ?? [24, 2];
  if (!Array.isArray(leads) || leads.length === 0) throw new Error("ERROR lead_hours must be a non-empty array.");
  return {
    treatment: o.treatment,
    starts_at: o.starts_at,
    reminders: leads.map((h) => {
      if (typeof h !== "number" || h <= 0 || h > 168) throw new Error(`ERROR lead hour must be 0-168, got '${h}'.`);
      return new Date(start - h * 3600_000).toISOString();
    }),
  };
}

export function retreatSchedule(o: { last_visit: string; every_weeks?: number; count?: number }) {
  const last = checkDate(o.last_visit, "last_visit");
  const every = o.every_weeks ?? 4;
  const count = o.count ?? 3;
  if (!Number.isInteger(every) || every < 1 || every > 52) throw new Error("ERROR every_weeks must be an integer 1-52.");
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("ERROR count must be an integer 1-12.");
  const base = Date.parse(`${last}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 1; i <= count; i++) {
    dates.push(new Date(base + every * i * 7 * 86400_000).toISOString().slice(0, 10));
  }
  return { last_visit: last, every_weeks: every, dates };
}
