/**
 * SalonBook engine - salon visit planning: search availability windows,
 * quote services with add-ons, compare salons on your numbers, draft
 * booking requests, rebook schedules and appointment reminders.
 * Pure computation over user-supplied menus and availability: no salon
 * inventory, no booking API, nothing stored. No real bookings are made.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export type Window = { day: string; start: string; end: string };
export type Service = { name: string; price_usd: number; duration_min: number };

function checkDay(raw: unknown, what: string): string {
  const day = (raw as string ?? "").trim().toLowerCase();
  if (!WEEKDAYS.includes(day)) throw new Error(`ERROR ${what} must be a weekday, got '${raw}'.`);
  return day;
}

function checkTime(raw: unknown, what: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test((raw as string) ?? ""))
    throw new Error(`ERROR ${what} must be HH:MM (24h), got '${raw}'.`);
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

export function findSlots(o: { availability: Window[]; day?: string; duration_min?: number; after?: string; before?: string }) {
  const windows = checkWindows(o.availability);
  const duration = o.duration_min ?? 60;
  if (!Number.isInteger(duration) || duration < 15 || duration > 240)
    throw new Error("ERROR duration_min must be an integer 15-240.");
  let list = windows;
  if (o.day !== undefined) {
    const day = checkDay(o.day, "day");
    list = list.filter((w) => w.day === day);
  }
  if (o.after !== undefined) {
    const after = checkTime(o.after, "after");
    list = list.filter((w) => w.end > after);
  }
  if (o.before !== undefined) {
    const before = checkTime(o.before, "before");
    list = list.filter((w) => w.start < before);
  }
  const slots: Array<{ day: string; start: string; end: string }> = [];
  for (const w of list) {
    const lo = Math.max(toMin(w.start), o.after !== undefined ? toMin(o.after as string) : 0);
    const hi = Math.min(toMin(w.end), o.before !== undefined ? toMin(o.before as string) : 24 * 60);
    for (let s = Math.ceil(lo / 30) * 30; s + duration <= hi; s += 30) {
      slots.push({ day: w.day, start: toHHMM(s), end: toHHMM(s + duration) });
      if (slots.length >= 40) break;
    }
    if (slots.length >= 40) break;
  }
  const rank = (d: string): number => WEEKDAYS.indexOf(d);
  slots.sort((a, b) => rank(a.day) - rank(b.day) || (a.start < b.start ? -1 : 1));
  return { duration_min: duration, slots, count: slots.length };
}

export function quoteService(o: { menu: Service[]; service: string; add_ons?: string[] }) {
  if (!Array.isArray(o.menu) || o.menu.length === 0)
    throw new Error("ERROR menu must be a non-empty array of services.");
  const menu = o.menu.map((s, i) => {
    if (!s.name?.trim()) throw new Error(`ERROR menu item ${i + 1} needs a name.`);
    if (typeof s.price_usd !== "number" || s.price_usd <= 0)
      throw new Error(`ERROR price_usd for '${s.name}' must be a number > 0.`);
    if (!Number.isInteger(s.duration_min) || s.duration_min < 10 || s.duration_min > 300)
      throw new Error(`ERROR duration_min for '${s.name}' must be an integer 10-300.`);
    return { name: s.name.trim(), price_usd: s.price_usd, duration_min: s.duration_min };
  });
  const byName = (n: string) => menu.find((s) => s.name.toLowerCase() === n.trim().toLowerCase());
  const base = byName(o.service ?? "");
  if (!base) throw new Error(`ERROR service '${o.service}' is not on the menu: ${menu.map((s) => s.name).join(", ")}.`);
  const lines = [{ item: base.name, price_usd: base.price_usd, duration_min: base.duration_min }];
  for (const a of o.add_ons ?? []) {
    const add = byName(a);
    if (!add) throw new Error(`ERROR add-on '${a}' is not on the menu: ${menu.map((s) => s.name).join(",")}.`);
    lines.push({ item: add.name, price_usd: add.price_usd, duration_min: add.duration_min });
  }
  return {
    lines, total_usd: round2(lines.reduce((s, l) => s + l.price_usd, 0)),
    total_minutes: lines.reduce((s, l) => s + l.duration_min, 0),
    note: "Quote from the menu you provided. Verify the salon's current prices before paying.",
  };
}

export type SalonOption = { name: string; price_usd: number; rating: number; distance_min: number };

export function compareSalons(o: { salons: SalonOption[] }) {
  if (!Array.isArray(o.salons) || o.salons.length < 2 || o.salons.length > 6)
    throw new Error("ERROR salons must be 2-6 options to compare.");
  const rows = o.salons.map((s, i) => {
    const at = `salon ${i + 1}`;
    if (!s.name?.trim()) throw new Error(`ERROR ${at} needs a name.`);
    if (typeof s.price_usd !== "number" || s.price_usd <= 0)
      throw new Error(`ERROR price_usd for '${s.name}' must be a number > 0.`);
    if (typeof s.rating !== "number" || s.rating < 1 || s.rating > 5)
      throw new Error(`ERROR rating for '${s.name}' must be 1-5.`);
    if (typeof s.distance_min !== "number" || s.distance_min < 0)
      throw new Error(`ERROR distance_min for '${s.name}' must be a number >= 0.`);
    return { name: s.name.trim(), price_usd: s.price_usd, rating: s.rating, distance_min: s.distance_min };
  });
  const prices = rows.map((r) => r.price_usd);
  const dists = rows.map((r) => r.distance_min);
  const loP = Math.min(...prices), hiP = Math.max(...prices);
  const loD = Math.min(...dists), hiD = Math.max(...dists);
  const scored = rows.map((r) => {
    const priceScore = hiP === loP ? 1 : 1 - (r.price_usd - loP) / (hiP - loP);
    const distScore = hiD === loD ? 1 : 1 - (r.distance_min - loD) / (hiD - loD);
    const score = round2(0.5 * (r.rating / 5) + 0.3 * priceScore + 0.2 * distScore);
    return { ...r, score };
  }).sort((a, b) => b.score - a.score);
  return {
    ranking: scored, pick: scored[0].name,
    note: "Scored from your numbers: 50% rating, 30% price, 20% distance. Verify ratings and prices yourself.",
  };
}

export function buildBookingRequest(o: { service: string; date: string; time: string; name: string; phone?: string; party_size?: number }) {
  if (!o.service?.trim()) throw new Error("ERROR service must be a non-empty string.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? "")) throw new Error(`ERROR date must be YYYY-MM-DD, got '${o.date}'.`);
  checkTime(o.time, "time");
  if (!o.name?.trim()) throw new Error("ERROR name must be a non-empty string.");
  const party = o.party_size ?? 1;
  if (!Number.isInteger(party) || party < 1 || party > 6)
    throw new Error("ERROR party_size must be an integer 1-6.");
  const contact = o.phone?.trim() ? ` Reach me at ${o.phone.trim()}.` : "";
  const message = `Hi! I'd like to book ${o.service.trim()} on ${o.date} at ${o.time} for ${party} ${party > 1 ? "people" : "person"}. Name: ${o.name.trim()}.${contact} Please confirm availability and the cancellation window. Thanks!`;
  return {
    message,
    details: { service: o.service.trim(), date: o.date, time: o.time, name: o.name.trim(), party_size: party },
    note: "Draft only - SalonBook does not book with any salon. Send this message to the salon to reserve your spot.",
  };
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function rebookSchedule(o: { last_visit: string; every_weeks?: number; count?: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.last_visit ?? ""))
    throw new Error(`ERROR last_visit must be YYYY-MM-DD, got '${o.last_visit}'.`);
  const every = o.every_weeks ?? 6;
  if (!Number.isInteger(every) || every < 1 || every > 26)
    throw new Error("ERROR every_weeks must be an integer 1-26.");
  const count = o.count ?? 4;
  if (!Number.isInteger(count) || count < 1 || count > 12)
    throw new Error("ERROR count must be an integer 1-12.");
  const dates: string[] = [];
  for (let i = 1; i <= count; i++) dates.push(addDaysISO(o.last_visit, every * 7 * i));
  return { last_visit: o.last_visit, every_weeks: every, dates };
}

export function appointmentReminders(o: { service: string; starts_at: string; lead_hours?: number[] }) {
  if (!o.service?.trim()) throw new Error("ERROR service must be a non-empty string.");
  const at = Date.parse(o.starts_at ?? "");
  if (Number.isNaN(at)) throw new Error(`ERROR starts_at must be an ISO datetime, got '${o.starts_at}'.`);
  const leads = o.lead_hours ?? [24, 2];
  if (!Array.isArray(leads) || leads.length === 0 || leads.length > 4)
    throw new Error("ERROR lead_hours must be 1-4 numbers.");
  for (const h of leads)
    if (typeof h !== "number" || h <= 0 || h > 72) throw new Error("ERROR each lead_hours value must be > 0 and <= 72.");
  return {
    service: o.service, starts_at: o.starts_at,
    reminders: leads.map((h) => new Date(at - h * 3600_000).toISOString()),
    note: "Reminder times computed from your appointment start. Set them in your own calendar app.",
  };
}
