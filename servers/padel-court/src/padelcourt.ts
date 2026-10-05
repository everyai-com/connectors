/**
 * PadelCourt engine - padel session planning: find clubs matching filters,
 * quote sessions with per-player splits, break-even math for memberships,
 * draft booking requests, compute match reminders, plan a week of sessions
 * within budget. Pure computation over user-supplied clubs and prices: no
 * club inventory, no booking API, nothing stored. Planning only.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function checkDate(raw: unknown, what: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((raw as string) ?? "") || Number.isNaN(Date.parse((raw as string) ?? "")))
    throw new Error(`ERROR ${what} must be YYYY-MM-DD, got '${raw}'.`);
  return raw as string;
}

function checkTime(raw: unknown, what: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test((raw as string) ?? ""))
    throw new Error(`ERROR ${what} must be HH:MM (24h), got '${raw}'.`);
  return raw as string;
}

export type Club = { name: string; indoor: boolean; price_per_hour: number; rating: number; distance_min: number };

export function findCourts(o: { clubs: Club[]; indoor_only?: boolean; max_price?: number; min_rating?: number }) {
  if (!Array.isArray(o.clubs) || o.clubs.length === 0) throw new Error("ERROR clubs must be a non-empty array.");
  const kept = o.clubs.filter((c) => {
    if (c.rating < 1 || c.rating > 5) throw new Error(`ERROR rating for '${c.name}' must be 1-5.`);
    if (o.indoor_only && !c.indoor) return false;
    if (o.max_price !== undefined && c.price_per_hour > o.max_price) return false;
    if (o.min_rating !== undefined && c.rating < o.min_rating) return false;
    return true;
  });
  const prices = kept.map((c) => c.price_per_hour);
  const dists = kept.map((c) => c.distance_min);
  const loP = Math.min(...prices), hiP = Math.max(...prices);
  const loD = Math.min(...dists), hiD = Math.max(...dists);
  const matches = kept.map((c) => ({
    name: c.name,
    indoor: c.indoor,
    price_per_hour: c.price_per_hour,
    score: round3(
      0.5 * (c.rating / 5) +
      0.3 * (hiP === loP ? 1 : 1 - (c.price_per_hour - loP) / (hiP - loP)) +
      0.2 * (hiD === loD ? 1 : 1 - (c.distance_min - loD) / (hiD - loD)),
    ),
  })).sort((a, b) => b.score - a.score);
  return { matches, count: matches.length, pick: matches.length ? matches[0].name : null };
}

export function quoteSession(o: { price_per_hour: number; hours?: number; players?: number; ball_machine?: boolean }) {
  if (typeof o.price_per_hour !== "number" || o.price_per_hour < 0)
    throw new Error("ERROR price_per_hour must be a non-negative number.");
  const hours = o.hours ?? 1;
  const players = o.players ?? 4;
  if (![0.5, 1, 1.5, 2].includes(hours)) throw new Error("ERROR hours must be one of 0.5, 1, 1.5, 2.");
  if (!Number.isInteger(players) || players < 2 || players > 8) throw new Error("ERROR players must be an integer 2-8.");
  const machine = o.ball_machine ? 15 : 0;
  const total = round2(o.price_per_hour * hours + machine);
  return { hours, players, ball_machine_fee: machine, total_usd: total, per_player_usd: round2(total / players) };
}

export function membershipBreakEven(o: { membership_monthly: number; payg_per_session: number; sessions_per_month: number }) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "number" || v < 0) throw new Error(`ERROR ${k} must be a non-negative number.`);
  }
  if (o.payg_per_session === 0) throw new Error("ERROR payg_per_session must be above zero.");
  if (!Number.isInteger(o.sessions_per_month)) throw new Error("ERROR sessions_per_month must be an integer.");
  const breakEven = round2(o.membership_monthly / o.payg_per_session);
  const payg = round2(o.payg_per_session * o.sessions_per_month);
  return {
    break_even_sessions: breakEven,
    you_pay_payg: payg,
    you_pay_member: round2(o.membership_monthly),
    verdict: o.sessions_per_month >= breakEven ? "membership wins" : "pay-as-you-go wins",
  };
}

export function buildBookingRequest(o: { club: string; date: string; time: string; name: string; players?: number }) {
  const date = checkDate(o.date, "date");
  const time = checkTime(o.time, "time");
  if (!o.club.trim() || !o.name.trim()) throw new Error("ERROR club and name must be non-empty.");
  const players = o.players ?? 4;
  if (!Number.isInteger(players) || players < 2 || players > 8) throw new Error("ERROR players must be an integer 2-8.");
  const message = `Hi! I'd like to book a padel court at ${o.club} on ${date} at ${time} for ${players} players. Name: ${o.name}. Please confirm court and price. Thanks!`;
  return { message, club: o.club, date, time, name: o.name };
}

export function matchReminders(o: { match: string; starts_at: string; lead_hours?: number[] }) {
  const start = Date.parse(o.starts_at);
  if (Number.isNaN(start)) throw new Error(`ERROR starts_at must be ISO datetime, got '${o.starts_at}'.`);
  const leads = o.lead_hours ?? [24, 2];
  if (!Array.isArray(leads) || leads.length === 0) throw new Error("ERROR lead_hours must be a non-empty array.");
  return {
    match: o.match,
    starts_at: o.starts_at,
    reminders: leads.map((h) => {
      if (typeof h !== "number" || h <= 0 || h > 168) throw new Error(`ERROR lead hour must be 0-168, got '${h}'.`);
      return new Date(start - h * 3600_000).toISOString();
    }),
  };
}

export function weekPlan(o: { budget: number; sessions: { club: string; price: number }[] }) {
  if (typeof o.budget !== "number" || o.budget < 0) throw new Error("ERROR budget must be a non-negative number.");
  if (!Array.isArray(o.sessions) || o.sessions.length === 0) throw new Error("ERROR sessions must be a non-empty array.");
  const sorted = [...o.sessions].sort((a, b) => a.price - b.price);
  const picked: { club: string; price: number }[] = [];
  let total = 0;
  for (const s of sorted) {
    if (total + s.price <= o.budget) { picked.push(s); total = round2(total + s.price); }
  }
  return { sessions: picked, count: picked.length, total_usd: total, leftover_usd: round2(o.budget - total) };
}
