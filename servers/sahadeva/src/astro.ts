/** Sahadeva astro engine - pure TS, shared by node server + Worker. No node deps. */
// ---------------------------------------------------------------- astro math
export const RAD = Math.PI / 180, DEG = 180 / Math.PI;
export const norm = (d: number) => ((d % 360) + 360) % 360;
export const sinD = (d: number) => Math.sin(d * RAD), cosD = (d: number) => Math.cos(d * RAD);

export const NAKSHATRAS = ["Ashwini","Bharani","Krittika","Rohini","Mrigashira","Ardra","Punarvasu","Pushya","Ashlesha","Magha","Purva Phalguni","Uttara Phalguni","Hasta","Chitra","Swati","Vishakha","Anuradha","Jyeshtha","Mula","Purva Ashadha","Uttara Ashadha","Shravana","Dhanishta","Shatabhisha","Purva Bhadrapada","Uttara Bhadrapada","Revati"];
export const RASHIS = ["Mesha","Vrishabha","Mithuna","Karka","Simha","Kanya","Tula","Vrishchika","Dhanu","Makara","Kumbha","Meena"];
export const VARAS = ["Ravivara (Sunday)","Somavara (Monday)","Mangalavara (Tuesday)","Budhavara (Wednesday)","Guruvara (Thursday)","Shukravara (Friday)","Shanivara (Saturday)"];
export const TITHI_NAMES = ["Pratipada","Dwitiya","Tritiya","Chaturthi","Panchami","Shashthi","Saptami","Ashtami","Navami","Dashami","Ekadashi","Dwadashi","Trayodashi","Chaturdashi","Purnima"];
export const DASHA_SEQ: Array<[string, number]> = [["Ketu",7],["Venus",20],["Sun",6],["Moon",10],["Mars",7],["Rahu",18],["Jupiter",16],["Saturn",19],["Mercury",17]];
// Rahu kalam weekday table (approx, assumes ~6:00 sunrise). JS day: 0=Sun.
export const RAHU_KALAM = ["16:30-18:00","07:30-09:00","15:00-16:30","12:00-13:30","13:30-15:00","10:30-12:00","09:00-10:30"];

export function julianDay(y: number, m: number, d: number, hourUTC: number): number {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + hourUTC / 24;
}
export function sunLongitude(jd: number): number {
  const d = jd - 2451543.5;
  const w = 282.9404 + 4.70935e-5 * d, e = 0.016709 - 1.151e-9 * d, M = norm(356.047 + 0.9856002585 * d);
  const E = M + e * DEG * sinD(M) * (1 + e * cosD(M));
  return norm(Math.atan2(Math.sqrt(1 - e * e) * sinD(E), cosD(E) - e) * DEG + w);
}
export function moonLongitude(jd: number): number {
  const d = jd - 2451543.5;
  const N = norm(125.1228 - 0.0529538083 * d), i = 5.1454;
  const w = norm(318.0634 + 0.1643573223 * d), e = 0.0549, M = norm(115.3654 + 13.0649929509 * d);
  let E = M + e * DEG * sinD(M);
  for (let k = 0; k < 4; k++) E = E - (E - e * DEG * sinD(E) - M) / (1 - e * cosD(E));
  const xv = cosD(E) - e, yv = Math.sqrt(1 - e * e) * sinD(E), v = Math.atan2(yv, xv) * DEG;
  const xh = cosD(N) * cosD(v + w) - sinD(N) * sinD(v + w) * cosD(i);
  const yh = sinD(N) * cosD(v + w) + cosD(N) * sinD(v + w) * cosD(i);
  let lon = norm(Math.atan2(yh, xh) * DEG);
  const Ms = norm(356.047 + 0.9856002585 * d), Mm = M;
  const Lm = norm(N + w + Mm), Ls = norm(282.9404 + 4.70935e-5 * d + Ms);
  const D = norm(Lm - Ls), F = norm(Lm - N);
  lon += -1.274 * sinD(Mm - 2 * D) + 0.658 * sinD(2 * D) - 0.186 * sinD(Ms) - 0.059 * sinD(2 * Mm - 2 * D) - 0.057 * sinD(Mm - 2 * D + Ms);
  return norm(lon);
}
export const ayanamsa = (jd: number) => 23.856 + ((jd - 2451545) / 365.25) * 0.01397; // Lahiri approx
export const rashiOf = (sid: number) => RASHIS[Math.floor(norm(sid) / 30)];
export const nakOf = (sid: number) => { const x = norm(sid) / (360 / 27); return { index: Math.floor(x), name: NAKSHATRAS[Math.floor(x)], pada: Math.floor((x % 1) * 4) + 1 }; };
export function tithiOf(sun: number, moon: number) {
  const idx = Math.floor(norm(moon - sun) / 12);
  const paksha = idx < 15 ? "Shukla" : "Krishna";
  const name = idx === 29 ? "Amavasya" : TITHI_NAMES[idx % 15];
  return `${paksha} ${name}`;
}
export function ascendant(jd: number, latDeg: number, lonEastDeg: number): number {
  const T = (jd - 2451545) / 36525;
  const GMST = norm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T);
  const RAMC = norm(GMST + lonEastDeg);
  const eps = 23.4393 - 0.0000004 * (jd - 2451543.5);
  const asc = Math.atan2(cosD(RAMC), -(sinD(RAMC) * cosD(eps) + Math.tan(latDeg * RAD) * sinD(eps))) * DEG;
  return norm(norm(asc) - ayanamsa(jd));
}
export function parseDate(s: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`date must be YYYY-MM-DD, got '${s}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
export const todayStr = () => new Date().toISOString().slice(0, 10);
export function hashStr(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

export const HORO_LINES = [
  "Steady progress on pending work; finish one old task before starting new ones.",
  "Good day for conversations that need patience - listen more than you speak.",
  "Money matters look stable; avoid impulse spending after sunset.",
  "Family and close friends bring useful news; follow up on it.",
  "Travel or a change of routine brings fresh ideas - say yes to small detours.",
  "Health focus: rest on time; small discipline today pays off this week.",
  "Creative work flows well; put important ideas in writing before evening.",
  "A delayed plan restarts - be ready with your documents and dates.",
];
export const HORO_COLORS = ["white","red","yellow","green","saffron","blue","silver","gold"];
export function compatibility(s1: string, s2: string) {
  const a = RASHIS.indexOf(s1), b = RASHIS.indexOf(s2);
  if (a < 0 || b < 0) throw new Error(`unknown sign; valid: ${RASHIS.join(", ")}`);
  const dist = Math.min((a - b + 12) % 12, (b - a + 12) % 12);
  const table: Record<number, [number, string]> = {
    0: [85, "Same sign: deep understanding, watch for shared blind spots."],
    1: [60, "Adjacent signs: different rhythms; needs patience and clear roles."],
    2: [75, "Supportive angle: friendship first, love grows steadily."],
    3: [70, "Working angle: good for projects, effort needed for romance."],
    4: [90, "Trine-like harmony: natural ease and shared values."],
    5: [45, "Challenging angle: growth through compromise; timing matters."],
    6: [95, "Opposite signs: strong attraction, balance independence with togetherness."],
  };
  return { score_36: Math.round(table[dist][0] * 0.36), note: table[dist][1] };
}

