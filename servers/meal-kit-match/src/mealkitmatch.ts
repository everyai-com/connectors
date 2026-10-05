/**
 * MealKitMatch engine - meal-kit matching and week planning: match kits to
 * a diet/budget profile, plan a week of meals, quote weekly cost, compare
 * kit tiers on your numbers, suggest swaps around avoids, compute delivery
 * schedules. Pure computation over user-supplied kit catalogs: no vendor
 * inventory, no order API, nothing stored. Planning only.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function checkDate(raw: unknown, what: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((raw as string) ?? "") || Number.isNaN(Date.parse((raw as string) ?? "")))
    throw new Error(`ERROR ${what} must be YYYY-MM-DD, got '${raw}'.`);
  return raw as string;
}

export type Kit = {
  name: string; diets: string[]; price_per_serving: number;
  servings_options: number[]; meals_per_week_options: number[];
  skill: string; rating: number; allergens: string[];
};
export type Profile = {
  diets: string[]; allergies?: string[]; max_price_per_serving?: number;
  servings?: number; meals_per_week?: number; skill?: string;
};

export function matchKits(o: { profile: Profile; kits: Kit[] }) {
  const p = o.profile;
  if (!p || !Array.isArray(p.diets) || p.diets.length === 0)
    throw new Error("ERROR profile.diets must be a non-empty array.");
  if (!Array.isArray(o.kits) || o.kits.length === 0)
    throw new Error("ERROR kits must be a non-empty array.");
  const wants = p.diets.map((d) => d.toLowerCase());
  const avoid = (p.allergies ?? []).map((a) => a.toLowerCase());
  const ranked = o.kits.map((k) => {
    const fails: string[] = [];
    const why: string[] = [];
    const kdiets = k.diets.map((d) => d.toLowerCase());
    for (const w of wants) if (!kdiets.includes(w)) fails.push(`no ${w} menu`);
    const kall = k.allergens.map((a) => a.toLowerCase());
    for (const a of avoid) if (kall.includes(a)) fails.push(`contains ${a}`);
    if (p.max_price_per_serving !== undefined && k.price_per_serving > p.max_price_per_serving)
      fails.push(`$${k.price_per_serving}/serving over budget`);
    if (p.servings !== undefined && !k.servings_options.includes(p.servings))
      fails.push(`no ${p.servings}-serving plan`);
    if (p.meals_per_week !== undefined && !k.meals_per_week_options.includes(p.meals_per_week))
      fails.push(`no ${p.meals_per_week}-meals/week plan`);
    if (p.skill !== undefined && k.skill.toLowerCase() !== p.skill.toLowerCase())
      fails.push(`skill ${k.skill}, want ${p.skill}`);
    if (k.rating < 1 || k.rating > 5) throw new Error(`ERROR rating for '${k.name}' must be 1-5.`);
    let score = 0;
    if (fails.length === 0) {
      const budget = p.max_price_per_serving ?? Math.max(...o.kits.map((x) => x.price_per_serving));
      score = round3(0.6 * (k.rating / 5) + 0.4 * (1 - k.price_per_serving / (budget * 1.5)));
      why.push(`rating ${k.rating}/5`, `$${k.price_per_serving}/serving fits budget`);
    }
    return { name: k.name, score, why, fails };
  }).sort((a, b) => b.score - a.score);
  const matches = ranked.filter((r) => r.fails.length === 0);
  return { matches, rejected: ranked.filter((r) => r.fails.length > 0), pick: matches.length ? matches[0].name : null };
}

export function planWeek(o: { kit_meals: { name: string; servings: number }[]; days?: number; servings_needed?: number }) {
  if (!Array.isArray(o.kit_meals) || o.kit_meals.length === 0)
    throw new Error("ERROR kit_meals must be a non-empty array.");
  const days = o.days ?? 7;
  const need = o.servings_needed ?? 2;
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error("ERROR days must be an integer 1-14.");
  if (!Number.isInteger(need) || need < 1 || need > 12) throw new Error("ERROR servings_needed must be an integer 1-12.");
  const plan = [];
  for (let d = 0; d < days; d++) {
    const meal = o.kit_meals[d % o.kit_meals.length];
    plan.push({ day: d + 1, meal: meal.name, servings: meal.servings, covers_need: meal.servings >= need });
  }
  return { days: plan, servings_needed: need, short_days: plan.filter((p) => !p.covers_need).map((p) => p.day) };
}

export function quoteWeek(o: { price_per_serving: number; meals_per_week: number; servings: number; shipping?: number }) {
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && (typeof v !== "number" || v < 0)) throw new Error(`ERROR ${k} must be a non-negative number.`);
  }
  if (!Number.isInteger(o.meals_per_week) || o.meals_per_week < 1 || o.meals_per_week > 21)
    throw new Error("ERROR meals_per_week must be an integer 1-21.");
  if (!Number.isInteger(o.servings) || o.servings < 1 || o.servings > 12)
    throw new Error("ERROR servings must be an integer 1-12.");
  const food = round2(o.price_per_serving * o.meals_per_week * o.servings);
  const shipping = round2(o.shipping ?? 0);
  return {
    per_meal_per_person: round2(o.price_per_serving),
    weekly_food: food,
    shipping,
    weekly_total: round2(food + shipping),
    monthly_estimate: round2((food + shipping) * 4.33),
  };
}

export type KitTier = { name: string; price_usd: number; rating: number; meals: number };

export function compareKitTiers(o: { plans: KitTier[] }) {
  if (!Array.isArray(o.plans) || o.plans.length < 2 || o.plans.length > 6)
    throw new Error("ERROR plans must be an array of 2-6.");
  const prices = o.plans.map((p) => p.price_usd);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const ranked = o.plans.map((p) => {
    if (p.rating < 1 || p.rating > 5) throw new Error(`ERROR rating for '${p.name}' must be 1-5.`);
    const score = round3(0.6 * (p.rating / 5) + 0.4 * (hi === lo ? 1 : 1 - (p.price_usd - lo) / (hi - lo)));
    return { name: p.name, score };
  }).sort((a, b) => b.score - a.score);
  return { ranking: ranked, pick: ranked[0].name };
}

export function suggestSwaps(o: { meals: { name: string; tags: string[] }[]; avoid: string[] }) {
  if (!Array.isArray(o.meals) || o.meals.length === 0) throw new Error("ERROR meals must be a non-empty array.");
  if (!Array.isArray(o.avoid) || o.avoid.length === 0) throw new Error("ERROR avoid must be a non-empty array.");
  const bad = o.avoid.map((a) => a.toLowerCase());
  const clean = o.meals.filter((m) => !m.tags.some((t) => bad.includes(t.toLowerCase())));
  const swaps = o.meals
    .filter((m) => m.tags.some((t) => bad.includes(t.toLowerCase())))
    .map((m) => {
      const hit = m.tags.filter((t) => bad.includes(t.toLowerCase()));
      const alt = clean[0]?.name ?? null;
      return { from: m.name, because: hit, swap_with: alt, note: alt ? `clean swap: ${alt}` : "no clean meal in this list - pick another kit" };
    });
  return { swaps, clean_meals: clean.map((m) => m.name) };
}

export function deliverySchedule(o: { first_delivery: string; every_weeks?: number; count?: number }) {
  const first = checkDate(o.first_delivery, "first_delivery");
  const every = o.every_weeks ?? 1;
  const count = o.count ?? 4;
  if (!Number.isInteger(every) || every < 1 || every > 12) throw new Error("ERROR every_weeks must be an integer 1-12.");
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("ERROR count must be an integer 1-12.");
  const base = Date.parse(`${first}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(base + every * i * 7 * 86400_000).toISOString().slice(0, 10));
  }
  return { first_delivery: first, every_weeks: every, dates };
}
