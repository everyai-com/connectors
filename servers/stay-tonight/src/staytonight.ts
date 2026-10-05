/**
 * StayTonight engine - tonight-stay planning: find hotels matching filters,
 * quote nights with taxes and fees, loyalty break-even math, draft booking
 * requests, compute stay reminders, plan a multi-night trip within budget.
 * Pure computation over user-supplied hotels and prices: no hotel
 * inventory, no booking API, nothing stored. Planning only.
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

export type Hotel = { name: string; price: number; rating: number; distance_min: number; amenities: string[] };

export function findStays(o: { hotels: Hotel[]; max_price?: number; min_rating?: number; need_amenities?: string[] }) {
  if (!Array.isArray(o.hotels) || o.hotels.length === 0) throw new Error("ERROR hotels must be a non-empty array.");
  const need = (o.need_amenities ?? []).map((a) => a.toLowerCase());
  const kept = o.hotels.filter((h) => {
    if (h.rating < 1 || h.rating > 5) throw new Error(`ERROR rating for '${h.name}' must be 1-5.`);
    if (o.max_price !== undefined && h.price > o.max_price) return false;
    if (o.min_rating !== undefined && h.rating < o.min_rating) return false;
    const have = h.amenities.map((a) => a.toLowerCase());
    return need.every((n) => have.includes(n));
  });
  const prices = kept.map((h) => h.price);
  const dists = kept.map((h) => h.distance_min);
  const loP = Math.min(...prices), hiP = Math.max(...prices);
  const loD = Math.min(...dists), hiD = Math.max(...dists);
  const matches = kept.map((h) => ({
    name: h.name,
    price: h.price,
    rating: h.rating,
    score: round3(
      0.5 * (h.rating / 5) +
      0.3 * (hiP === loP ? 1 : 1 - (h.price - loP) / (hiP - loP)) +
      0.2 * (hiD === loD ? 1 : 1 - (h.distance_min - loD) / (hiD - loD)),
    ),
  })).sort((a, b) => b.score - a.score);
  return { matches, count: matches.length, pick: matches.length ? matches[0].name : null };
}

export function quoteNight(o: { room_price: number; taxes_pct?: number; fees?: number; nights?: number }) {
  if (typeof o.room_price !== "number" || o.room_price < 0)
    throw new Error("ERROR room_price must be a non-negative number.");
  const taxes = o.taxes_pct ?? 12;
  const fees = o.fees ?? 0;
  const nights = o.nights ?? 1;
  if (typeof taxes !== "number" || taxes < 0 || taxes > 40) throw new Error("ERROR taxes_pct must be 0-40.");
  if (typeof fees !== "number" || fees < 0) throw new Error("ERROR fees must be a non-negative number.");
  if (!Number.isInteger(nights) || nights < 1 || nights > 30) throw new Error("ERROR nights must be an integer 1-30.");
  const subtotal = round2(o.room_price * nights);
  const taxAmt = round2(subtotal * taxes / 100);
  return {
    nightly: round2(o.room_price),
    nights,
    subtotal,
    taxes_usd: taxAmt,
    fees_usd: round2(fees),
    total_usd: round2(subtotal + taxAmt + fees),
  };
}

export function loyaltyBreakEven(o: { membership_yearly: number; member_discount_pct: number; avg_night_price: number; nights_per_year: number }) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "number" || v < 0) throw new Error(`ERROR ${k} must be a non-negative number.`);
  }
  if (o.member_discount_pct > 90) throw new Error("ERROR member_discount_pct must be 0-90.");
  if (!Number.isInteger(o.nights_per_year)) throw new Error("ERROR nights_per_year must be an integer.");
  const savePerNight = round2(o.avg_night_price * o.member_discount_pct / 100);
  if (savePerNight === 0) throw new Error("ERROR discount and price must combine above zero savings.");
  const breakEven = round2(o.membership_yearly / savePerNight);
  const yourSavings = round2(savePerNight * o.nights_per_year);
  return {
    savings_per_night: savePerNight,
    break_even_nights: breakEven,
    your_savings: yourSavings,
    verdict: o.nights_per_year >= breakEven ? "membership wins" : "pay-as-you-go wins",
  };
}

export function buildBookingRequest(o: { hotel: string; date: string; name: string; nights?: number; guests?: number }) {
  const date = checkDate(o.date, "date");
  if (!o.hotel.trim() || !o.name.trim()) throw new Error("ERROR hotel and name must be non-empty.");
  const nights = o.nights ?? 1;
  const guests = o.guests ?? 2;
  if (!Number.isInteger(nights) || nights < 1 || nights > 30) throw new Error("ERROR nights must be an integer 1-30.");
  if (!Number.isInteger(guests) || guests < 1 || guests > 10) throw new Error("ERROR guests must be an integer 1-10.");
  const message = `Hi! I'd like to book ${o.hotel} for ${nights} night(s) from ${date} for ${guests} guest(s). Name: ${o.name}. Please confirm room and all-in price. Thanks!`;
  return { message, hotel: o.hotel, date, name: o.name };
}

export function stayReminders(o: { stay: string; starts_at: string; lead_hours?: number[] }) {
  const start = Date.parse(o.starts_at);
  if (Number.isNaN(start)) throw new Error(`ERROR starts_at must be ISO datetime, got '${o.starts_at}'.`);
  const leads = o.lead_hours ?? [24, 2];
  if (!Array.isArray(leads) || leads.length === 0) throw new Error("ERROR lead_hours must be a non-empty array.");
  return {
    stay: o.stay,
    starts_at: o.starts_at,
    reminders: leads.map((h) => {
      if (typeof h !== "number" || h <= 0 || h > 168) throw new Error(`ERROR lead hour must be 0-168, got '${h}'.`);
      return new Date(start - h * 3600_000).toISOString();
    }),
  };
}

export function tripPlan(o: { budget: number; nights: { hotel: string; price: number }[] }) {
  if (typeof o.budget !== "number" || o.budget < 0) throw new Error("ERROR budget must be a non-negative number.");
  if (!Array.isArray(o.nights) || o.nights.length === 0) throw new Error("ERROR nights must be a non-empty array.");
  const sorted = [...o.nights].sort((a, b) => a.price - b.price);
  const picked: { hotel: string; price: number }[] = [];
  let total = 0;
  for (const s of sorted) {
    if (total + s.price <= o.budget) { picked.push(s); total = round2(total + s.price); }
  }
  return { nights: picked, count: picked.length, total_usd: total, leftover_usd: round2(o.budget - total) };
}
