/**
 * ServiceSchedule engine - car maintenance planning: what is due, what it
 * costs, a month-by-month schedule and seasonal checklists.
 * Pure computation; distances normalized to km, nothing stored.
 */

export type Unit = "km" | "mi";
export type Tier = "economy" | "mid" | "luxury";
export type Season = "spring" | "summer" | "fall" | "winter";
export type Climate = "hot" | "cold" | "mixed";
export type Status = "due" | "soon" | "ok";

const KM_PER_MILE = 1.609344;
const round1 = (n: number) => Math.round(n * 10) / 10;
const toKm = (value: number, unit: Unit): number => (unit === "mi" ? value * KM_PER_MILE : value);

interface MaintenanceItem {
  id: string;
  name: string;
  interval_km: number; // 0 = no mileage interval (time-only item)
  interval_months: number;
  items: string[]; // what the service typically includes
}

const MAINTENANCE: MaintenanceItem[] = [
  { id: "oil_change", name: "Oil change", interval_km: 10000, interval_months: 12,
    items: ["Engine oil (grade per owner's manual)", "Oil filter", "Drain plug gasket"] },
  { id: "tire_rotation", name: "Tire rotation", interval_km: 10000, interval_months: 12,
    items: ["Rotate all four tires", "Set tire pressures", "Visual tread inspection"] },
  { id: "brake_inspection", name: "Brake inspection", interval_km: 20000, interval_months: 24,
    items: ["Brake pad thickness", "Rotor condition", "Brake fluid level"] },
  { id: "air_filter", name: "Engine air filter", interval_km: 30000, interval_months: 36,
    items: ["Engine air filter replacement", "Airbox cleaning"] },
  { id: "cabin_filter", name: "Cabin air filter", interval_km: 20000, interval_months: 24,
    items: ["Cabin air filter replacement", "HVAC intake check"] },
  { id: "coolant_service", name: "Coolant service", interval_km: 60000, interval_months: 60,
    items: ["Coolant drain and refill", "System pressure test", "Hose and cap inspection"] },
  { id: "spark_plugs", name: "Spark plugs", interval_km: 90000, interval_months: 84,
    items: ["Spark plug replacement", "Plug gap check", "Ignition coil inspection"] },
  { id: "transmission_service", name: "Transmission service", interval_km: 100000, interval_months: 72,
    items: ["Transmission fluid change", "Filter where serviceable", "Pan gasket check"] },
  { id: "battery_check", name: "Battery check", interval_km: 0, interval_months: 36,
    items: ["Battery load test", "Terminal cleaning and corrosion check", "Charging system check"] },
];

const BY_ID = new Map(MAINTENANCE.map((m) => [m.id, m]));
const VALID_IDS = MAINTENANCE.map((m) => m.id).join(", ");

function checkOdometer(odometer: unknown, unit: Unit): number {
  if (typeof odometer !== "number" || !Number.isFinite(odometer) || odometer < 0) {
    throw new Error("odometer must be a non-negative number - pass the vehicle's current odometer reading.");
  }
  const km = round1(toKm(odometer, unit));
  if (km > 2000000) throw new Error("odometer looks too large - check the value or pass unit: 'mi' for miles.");
  return km;
}

function resolveUnit(unit: unknown): Unit {
  if (unit === undefined || unit === "km") return "km";
  if (unit === "mi") return "mi";
  throw new Error(`unit must be 'km' or 'mi' (received '${String(unit)}').`);
}

// ---------------------------------------------------------------------------
// 1. due_services - what is due now / soon / ok
// ---------------------------------------------------------------------------

export interface LastServiceInput {
  id: string;
  odometer?: number;
  months_ago?: number;
}

export interface DueServicesInput {
  odometer: number;
  unit?: Unit;
  months_since_last_oil?: number;
  km_per_month?: number;
  last_service?: LastServiceInput[];
}

export interface ServiceStatus {
  id: string;
  name: string;
  status: Status;
  due_at_km: number | null;
  km_left: number | null;
  due_in_months: number;
  months_left: number;
  items: string[];
}

export function dueServices(input: DueServicesInput): object {
  const unit = resolveUnit(input.unit);
  const odometerKm = checkOdometer(input.odometer, unit);

  if (input.months_since_last_oil !== undefined &&
      (!Number.isFinite(input.months_since_last_oil) || input.months_since_last_oil < 0)) {
    throw new Error("months_since_last_oil must be a non-negative number of months (e.g. 8).");
  }
  if (input.km_per_month !== undefined &&
      (!Number.isFinite(input.km_per_month) || input.km_per_month < 100 || input.km_per_month > 10000)) {
    throw new Error("km_per_month must be between 100 and 10,000 km; omit it if unknown.");
  }

  const history = new Map<string, LastServiceInput>();
  for (const entry of input.last_service ?? []) {
    if (!entry || typeof entry.id !== "string" || !BY_ID.has(entry.id)) {
      throw new Error(`unknown service id '${String(entry?.id)}' in last_service. Valid ids: ${VALID_IDS}.`);
    }
    if (history.has(entry.id)) throw new Error(`duplicate last_service entry for '${entry.id}'; keep one per service.`);
    if (entry.odometer !== undefined && (!Number.isFinite(entry.odometer) || entry.odometer < 0)) {
      throw new Error(`last_service '${entry.id}': odometer must be a non-negative number in the same unit as the main odometer.`);
    }
    if (entry.months_ago !== undefined && (!Number.isFinite(entry.months_ago) || entry.months_ago < 0)) {
      throw new Error(`last_service '${entry.id}': months_ago must be a non-negative number.`);
    }
    history.set(entry.id, entry);
  }

  const services: ServiceStatus[] = [];
  for (const m of MAINTENANCE) {
    const h = history.get(m.id);
    const lastKm = h?.odometer !== undefined ? toKm(h.odometer, unit) : 0;
    if (lastKm > odometerKm) {
      throw new Error(`last_service '${m.id}' odometer (${round1(lastKm)} km) is ahead of the current odometer (${odometerKm} km); check the values.`);
    }
    const monthsAgo = h?.months_ago ?? input.months_since_last_oil ?? 0;
    const kmLeft = m.interval_km > 0 ? round1(m.interval_km - (odometerKm - lastKm)) : null;
    const dueAtKm = m.interval_km > 0 ? Math.round(lastKm + m.interval_km) : null;
    const monthsLeft = round1(m.interval_months - monthsAgo);
    const dueInMonths = monthsLeft; // months from now until due, negative = already due
    const dueNow = (kmLeft !== null && kmLeft <= 1000) || monthsLeft <= 1;
    const soon = !dueNow && ((kmLeft !== null && kmLeft <= 3000) || monthsLeft <= 3);
    services.push({
      id: m.id,
      name: m.name,
      status: dueNow ? "due" : soon ? "soon" : "ok",
      due_at_km: dueAtKm,
      km_left: kmLeft,
      due_in_months: dueInMonths,
      months_left: monthsLeft,
      items: m.items,
    });
  }

  const rank: Record<Status, number> = { due: 0, soon: 1, ok: 2 };
  const urgency = (s: ServiceStatus): number => {
    const m = BY_ID.get(s.id)!;
    const fractions: number[] = [];
    if (s.km_left !== null && m.interval_km > 0) fractions.push(s.km_left / m.interval_km);
    fractions.push(s.months_left / m.interval_months);
    return Math.min(...fractions);
  };
  const sorted = [...services].sort((a, b) =>
    rank[a.status] - rank[b.status] ||
    urgency(a) - urgency(b) ||
    MAINTENANCE.findIndex((m) => m.id === a.id) - MAINTENANCE.findIndex((m) => m.id === b.id));
  const n = sorted[0];
  const nextService = {
    id: n.id,
    name: n.name,
    status: n.status,
    due_at_km: n.due_at_km,
    km_left: n.km_left,
    due_in_months: n.due_in_months,
    months_left: n.months_left,
  };

  const dueCount = services.filter((s) => s.status === "due").length;
  const soonCount = services.filter((s) => s.status === "soon").length;
  const parts: string[] = [
    `${dueCount} due, ${soonCount} soon, ${services.length - dueCount - soonCount} ok.`,
  ];
  const hasHistory = (input.last_service?.length ?? 0) > 0;
  if (!hasHistory) {
    const timeBaseline = input.months_since_last_oil !== undefined
      ? `time counted from your last oil change - ${input.months_since_last_oil} months ago`
      : "time baseline 0 months";
    parts.push(`No last_service history provided, so all items are measured from a fresh baseline: last serviced at odometer 0, ${timeBaseline}. Distances to due are upper bounds.`);
  } else {
    parts.push("Measured from the last_service history provided; items without an entry use a 0 km baseline.");
  }
  if (input.km_per_month !== undefined) {
    parts.push(nextService.km_left !== null && nextService.km_left > 0
      ? `At ~${input.km_per_month} km/month, ${nextService.name} is next due in about ${round1(nextService.km_left / input.km_per_month)} months.`
      : `${nextService.name} is the most urgent item - at or past its interval.`);
  }
  parts.push("Intervals are typical; check your owner's manual for your model.");

  return {
    odometer_km: odometerKm,
    odometer_input: { value: input.odometer, unit },
    services,
    next_service: nextService,
    note: parts.join(" "),
  };
}

// ---------------------------------------------------------------------------
// 2. service_cost_estimate - typical US price ranges by shop tier
// ---------------------------------------------------------------------------

const PRICE: Record<string, { low: number; high: number }> = {
  oil_change: { low: 60, high: 120 },
  tire_rotation: { low: 30, high: 70 },
  brake_inspection: { low: 40, high: 90 },
  air_filter: { low: 25, high: 70 },
  cabin_filter: { low: 40, high: 100 },
  coolant_service: { low: 90, high: 160 },
  spark_plugs: { low: 150, high: 450 },
  transmission_service: { low: 150, high: 400 },
  battery_check: { low: 0, high: 40 },
};

const TIER_MULTIPLIER: Record<Tier, number> = { economy: 0.85, mid: 1.0, luxury: 1.6 };

export interface CostEstimateInput {
  services: string[];
  tier?: Tier;
}

export function serviceCostEstimate(input: CostEstimateInput): object {
  const tier = input.tier ?? "mid";
  if (tier !== "economy" && tier !== "mid" && tier !== "luxury") {
    throw new Error(`tier must be 'economy', 'mid' or 'luxury' (received '${String(input.tier)}').`);
  }
  if (!Array.isArray(input.services) || input.services.length === 0) {
    throw new Error("services must be a non-empty list of service ids, e.g. ['oil_change', 'brake_inspection'].");
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of input.services) {
    if (typeof id !== "string" || !BY_ID.has(id)) {
      throw new Error(`unknown service id '${String(id)}'. Valid ids: ${VALID_IDS}.`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const mult = TIER_MULTIPLIER[tier];
  const items = ids.map((id) => {
    const m = BY_ID.get(id)!;
    const p = PRICE[id];
    return { id, name: m.name, low: Math.round(p.low * mult), high: Math.round(p.high * mult) };
  });
  const totalLow = items.reduce((a, b) => a + b.low, 0);
  const totalHigh = items.reduce((a, b) => a + b.high, 0);
  return {
    tier,
    items,
    total_low: totalLow,
    total_high: totalHigh,
    note: `${items.length} service(s) priced at the '${tier}' tier. Parts and labor vary by vehicle, shop and region.`,
    source_note: "Typical US ranges (curated 2026); verify locally before booking - this is an estimate, not a quote.",
  };
}

// ---------------------------------------------------------------------------
// 3. service_timeline - month-by-month projection for the next 12 months
// ---------------------------------------------------------------------------

export interface TimelineInput {
  odometer: number;
  unit?: Unit;
  km_per_month: number;
  months_since_last_oil?: number;
}

export function serviceTimeline(input: TimelineInput): object {
  const unit = resolveUnit(input.unit);
  const odometerKm = checkOdometer(input.odometer, unit);
  if (typeof input.km_per_month !== "number" || !Number.isFinite(input.km_per_month) ||
      input.km_per_month < 100 || input.km_per_month > 10000) {
    throw new Error("km_per_month must be between 100 and 10,000 km per month - pass your average monthly driving distance.");
  }
  if (input.months_since_last_oil !== undefined &&
      (!Number.isFinite(input.months_since_last_oil) || input.months_since_last_oil < 0)) {
    throw new Error("months_since_last_oil must be a non-negative number of months (e.g. 8).");
  }
  const monthsAgoBase = input.months_since_last_oil ?? 0;

  // Each service fires when either its km interval or its month interval is
  // reached (whichever comes first); both counters reset at that point.
  const state = MAINTENANCE.map((m) => ({
    m,
    kmCounter: m.interval_km > 0 ? m.interval_km : Infinity, // absolute km, fresh baseline at 0
    monthCounter: monthsAgoBase + m.interval_months, // months from now
  }));

  const months: Array<{ month: number; projected_km: number; due: string[] }> = [];
  for (let month = 1; month <= 12; month++) {
    const projected = odometerKm + input.km_per_month * month;
    const due: string[] = [];
    for (const s of state) {
      const kmHit = s.kmCounter !== Infinity && s.kmCounter <= projected;
      const timeHit = s.monthCounter <= month;
      if (!kmHit && !timeHit) continue;
      due.push(s.m.id);
      // Servicing resets both clocks: next due whichever comes first again.
      if (s.kmCounter !== Infinity) s.kmCounter = projected + s.m.interval_km;
      s.monthCounter = month + s.m.interval_months;
    }
    months.push({ month, projected_km: Math.round(projected), due });
  }

  const overdue = months[0]?.due.length ?? 0;
  return {
    months,
    note: `Assumes a steady ${input.km_per_month} km/month and the standard intervals. Month 1 includes ${overdue} item(s) already at or past their interval (assumed serviced in month 1); later months show the next occurrences. Check the owner's manual for model-specific intervals.`,
  };
}

// ---------------------------------------------------------------------------
// 4. seasonal_checklist - preventive checks by season and climate
// ---------------------------------------------------------------------------

interface Area { area: string; items: string[] }

const BASE_CHECKLIST: Record<Season, Area[]> = {
  spring: [
    { area: "Exterior", items: [
      "Wash off winter road salt, including the undercarriage and wheel wells",
      "Touch up paint chips before they rust",
    ] },
    { area: "Wipers", items: ["Replace wiper blades worn by winter ice and salt"] },
    { area: "Tires & suspension", items: [
      "Check alignment after pothole season",
      "Inspect tire sidewalls for pothole bulges and set correct pressures",
    ] },
    { area: "Filters", items: [
      "Replace the cabin filter - pollen season loads it fast",
      "Check the engine air filter",
    ] },
    { area: "Brakes", items: ["Inspect brake pads and rotors for winter grit and rust"] },
    { area: "Fluids", items: ["Check all fluid levels after winter, including coolant and brake fluid"] },
  ],
  summer: [
    { area: "Cooling system", items: [
      "Check coolant level and condition; top up with the correct mix",
      "Inspect radiator hoses, belts and the cooling fan",
    ] },
    { area: "Air conditioning", items: ["Test AC performance before peak heat - weak cooling often needs a refrigerant check"] },
    { area: "Tires", items: [
      "Check pressures when tires are cold - heat raises blowout risk",
      "Check tread depth and inspect the spare",
    ] },
    { area: "Battery", items: ["Check the battery - summer heat is the biggest killer of batteries"] },
    { area: "Fluids", items: [
      "Check oil, brake fluid and washer fluid",
      "Consider a coolant flush if it is due by age or mileage",
    ] },
    { area: "Wipers & glass", items: ["Replace wiper blades cracked by sun; park with a windshield shade"] },
  ],
  fall: [
    { area: "Battery", items: [
      "Test the battery before winter - most failures happen on the first cold snap",
      "Clean and protect the terminals",
    ] },
    { area: "Tires", items: [
      "Check tread depth and pressures; plan winter tires if you see snow",
      "Rotate tires so all four wear evenly into winter",
    ] },
    { area: "Lights", items: ["Check headlights, brake lights and turn signals - darker commutes are coming"] },
    { area: "Wipers & glass", items: ["Fit fresh wiper blades and anti-freeze washer fluid"] },
    { area: "Fluids", items: [
      "Check antifreeze strength before the first freeze",
      "Check oil - cold starts are hard on old oil",
    ] },
    { area: "Heating & defrost", items: ["Test the heater, defroster and rear defogger before you need them"] },
  ],
  winter: [
    { area: "Battery", items: ["Test the battery before the first freeze - cold mornings expose weak cells"] },
    { area: "Tires", items: ["Check tread depth (5/32\" or more for snow) and set pressures - every 10 degrees F drop costs about 1 psi"] },
    { area: "Fluids", items: [
      "Check antifreeze protection for your coldest expected temperature",
      "Top up washer fluid rated for freezing",
    ] },
    { area: "Visibility", items: [
      "Replace wiper blades and test the heater, defroster and rear defogger",
      "Check all exterior lights - it gets dark early",
    ] },
    { area: "Safety kit", items: ["Pack a winter kit: scraper, blanket, jumper cables, flashlight and traction grit"] },
    { area: "Brakes", items: ["Have the brakes inspected before ice and snow arrive"] },
  ],
};

function setItem(list: Area[], area: string, index: number, text: string): void {
  const a = list.find((x) => x.area === area);
  if (a) a.items[index] = text;
  else list.push({ area, items: [text] });
}

function addItem(list: Area[], area: string, text: string): void {
  const a = list.find((x) => x.area === area);
  if (a) a.items.push(text);
  else list.push({ area, items: [text] });
}

export interface SeasonalInput {
  season: Season;
  climate?: Climate;
}

export function seasonalChecklist(input: SeasonalInput): object {
  const season = input.season;
  if (season !== "spring" && season !== "summer" && season !== "fall" && season !== "winter") {
    throw new Error(`season must be 'spring', 'summer', 'fall' or 'winter' (received '${String(season)}').`);
  }
  const climate = input.climate ?? "mixed";
  if (climate !== "hot" && climate !== "cold" && climate !== "mixed") {
    throw new Error(`climate must be 'hot', 'cold' or 'mixed' (received '${String(input.climate)}').`);
  }

  const checklist: Area[] = BASE_CHECKLIST[season].map((a) => ({ area: a.area, items: [...a.items] }));

  if (season === "winter") {
    if (climate === "cold") {
      setItem(checklist, "Battery", 0, "Have the battery load-tested - cranking power can drop 30-50% in freezing weather");
      setItem(checklist, "Tires", 0, "Fit winter tires (or three-peak-rated all-seasons) before the first snow");
      setItem(checklist, "Fluids", 0, "Verify antifreeze protects to at least -30 F; add concentrate instead of just topping up with water");
      setItem(checklist, "Fluids", 1, "Use washer fluid rated to -25 F or lower - summer fluid freezes on the windshield");
    } else if (climate === "hot") {
      setItem(checklist, "Battery", 0, "Test the battery anyway - heat ages batteries year-round; winter only reveals it");
      setItem(checklist, "Tires", 0, "Recheck tire pressures as temperatures finally drop, and tread for winter rain");
    }
  } else if (season === "summer") {
    if (climate === "hot") {
      addItem(checklist, "Tires", "Recheck pressures in the cool morning - hot roads can push them up 10-15%");
    } else if (climate === "cold") {
      addItem(checklist, "Tires", "Check tread for wet summer roads before the rainy season");
    }
  } else if (season === "spring") {
    if (climate === "hot") {
      addItem(checklist, "Air conditioning", "Run the AC for 10 minutes now - catch weak cooling before the summer rush");
    } else if (climate === "cold") {
      addItem(checklist, "Tires & suspension", "Hold off switching to summer tires until overnight lows stay above 45 F");
    }
  } else if (season === "fall") {
    if (climate === "cold") {
      addItem(checklist, "Fluids", "Check the block heater, glow plugs or remote-start system before deep winter");
    } else if (climate === "hot") {
      addItem(checklist, "Fluids", "Check coolant level - cooling systems work year-round in hot climates");
    }
  }

  const itemCount = checklist.reduce((n, a) => n + a.items.length, 0);
  return {
    season,
    climate,
    checklist,
    note: `${itemCount} checks for a ${climate} climate. Preventive reminders only - adjust for your owner's manual, mileage and local conditions; not a substitute for a mechanic's inspection.`,
  };
}
