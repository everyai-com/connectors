/**
 * FestivalFinder engine - COMPUTED Hindu festival dates (no hardcoded list).
 * Scans each day: low-precision Sun/Moon -> tithi + lunar month + nakshatra,
 * matches festival rules. Approximate (+/-1 day at tithi edges); label it.
 */
import { norm, sunLongitude, moonLongitude, ayanamsa, julianDay, nakOf } from "./astro.js";

export const MONTHS = ["Vaisakha","Jyeshtha","Ashadha","Shravana","Bhadrapada","Ashwin","Kartika","Margashirsha","Pausha","Magha","Phalguna","Chaitra"];
const RASHI_OF_SUN = (sid: number) => Math.floor(norm(sid) / 30);

type Rule = { name: string; about: string; match: (t: number, m: number, nk: number) => boolean };
const T = (tithi: number, month: string): Rule["match"] => (t, m) => t === tithi && MONTHS[m] === month;

const RULES: Rule[] = [
  { name: "Ugadi / Gudi Padwa", about: "Lunar new year: Chaitra Shukla Pratipada.", match: T(0, "Chaitra") },
  { name: "Ram Navami", about: "Rama's birth: Chaitra Shukla Navami.", match: T(8, "Chaitra") },
  { name: "Raksha Bandhan", about: "Sibling festival: Shravana Purnima.", match: T(14, "Shravana") },
  { name: "Janmashtami", about: "Krishna's birth: Shravana Krishna Ashtami.", match: T(22, "Shravana") },
  { name: "Ganesh Chaturthi", about: "Ganesha's arrival: Bhadrapada Shukla Chaturthi.", match: T(3, "Bhadrapada") },
  { name: "Navratri begins", about: "Nine nights: Ashwin Shukla Pratipada.", match: T(0, "Ashwin") },
  { name: "Dussehra / Vijayadashami", about: "Victory day: Ashwin Shukla Dashami.", match: T(9, "Ashwin") },
  { name: "Karva Chauth", about: "Fast for spouse: Kartika Krishna Chaturthi.", match: T(18, "Kartika") },
  { name: "Diwali / Lakshmi Puja", about: "Festival of lights: Ashwin Amavasya.", match: T(29, "Ashwin") },
  { name: "Bhai Dooj", about: "Siblings day: Kartika Shukla Dwitiya.", match: T(1, "Kartika") },
  { name: "Maha Shivaratri", about: "Shiva's night: Magha Krishna Chaturdashi.", match: T(27, "Magha") },
  { name: "Holi", about: "Festival of colors: Phalguna Purnima.", match: T(14, "Phalguna") },
  { name: "Thiruvonam (Onam)", about: "Kerala harvest: Shravana nakshatra while Sun is in Simha.", match: (_t, m, nk) => nk === 21 && m === 4 },
];

export type Festival = { name: string; date: string; about: string; tithi: string; month: string };

function dayData(y: number, m: number, d: number) {
  const jd = julianDay(y, m, d, 12 - 5.5); // IST noon in UTC
  const aya = ayanamsa(jd);
  const sun = norm(sunLongitude(jd) - aya), moon = norm(moonLongitude(jd) - aya);
  return {
    tithi: Math.floor(norm(moon - sun) / 12),
    month: RASHI_OF_SUN(sun),
    nak: nakOf(moon).index,
    sunRashi: RASHI_OF_SUN(sun),
  };
}

function daysInYear(year: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function festivalsInYear(year: number): Festival[] {
  if (year < 2020 || year > 2040) throw new Error(`year must be 2020-2040, got '${year}'`);
  const found: Festival[] = [];
  const seen = new Set<string>();
  let prevRashi = -1;
  let lockedMonth = -1;
  const all = daysInYear(year).map((ds) => {
    const [y, m, d] = ds.split("-").map(Number);
    return { ds, ...dayData(y, m, d) };
  });
  // Seed locked month from December of prior year (avoid Jan boundary error).
  {
    const dec = new Date(Date.UTC(year - 1, 11, 15));
    lockedMonth = dayData(dec.getUTCFullYear(), 12, 15).month;
  }
  let prevT = -1;
  for (const { ds, tithi, month, nak, sunRashi } of all) {
    // Lock the lunar month at each new-month wrap (tithi falls to 0):
    // the whole 30-tithi cycle keeps one name (amanta approximation).
    if (prevT >= 0 && tithi <= prevT && tithi <= 2) lockedMonth = month;
    if (lockedMonth < 0) lockedMonth = month;
    const useMonth = lockedMonth;
    prevT = tithi;
    for (const r of RULES) {
      if (r.match(tithi, useMonth, nak) && !seen.has(r.name + ds.slice(0, 7))) {
        seen.add(r.name + ds.slice(0, 7));
        found.push({ name: r.name, date: ds, about: r.about, tithi: `index ${tithi}`, month: MONTHS[useMonth] });
      }
    }
    if (prevRashi >= 0 && sunRashi !== prevRashi) {
      const names = ["Mesha","Vrishabha","Mithuna","Karka","Simha","Kanya","Tula","Vrishchika","Dhanu","Makara","Kumbha","Meena"];
      found.push({ name: `${names[sunRashi]} Sankranti${names[sunRashi] === "Makara" ? " / Pongal" : ""}`, date: ds, about: `Solar ingress into ${names[sunRashi]}.`, tithi: `index ${tithi}`, month: MONTHS[useMonth] });
    }
    prevRashi = sunRashi;
  }
  return found.sort((a, b) => a.date.localeCompare(b.date));
}

export function nextFestival(fromDate: string): Festival {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw new Error(`date must be YYYY-MM-DD, got '${fromDate}'`);
  const year = Number(fromDate.slice(0, 4));
  for (const f of festivalsInYear(year)) if (f.date >= fromDate) return f;
  return festivalsInYear(year + 1)[0];
}

export function festivalDetails(name: string, year: number): Festival {
  const q = name.toLowerCase();
  const hit = festivalsInYear(year).find((f) => f.name.toLowerCase().includes(q));
  if (!hit) throw new Error(`unknown festival '${name}' for ${year}; call list_festivals first`);
  return hit;
}
