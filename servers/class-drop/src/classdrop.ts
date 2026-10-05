/**
 * ClassDrop engine - fitness class planning: search a weekly schedule,
 * quote a week of drop-ins, membership break-even, booking-request drafts,
 * class reminders and balanced week plans.
 * Pure computation over user-supplied schedules: no studio inventory,
 * no booking API, nothing stored. No real bookings are made.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TYPES = ["cardio", "strength", "mobility", "sport"];

export type ClassSession = {
  name: string; type: string; day: string; start: string;
  duration_min?: number; intensity?: number;
};

function checkSchedule(schedule: ClassSession[]): Array<Required<ClassSession>> {
  if (!Array.isArray(schedule) || schedule.length === 0)
    throw new Error("ERROR schedule must be a non-empty array of class sessions.");
  return schedule.map((c, i) => {
    const at = `session ${i + 1}`;
    if (!c.name?.trim()) throw new Error(`ERROR ${at} needs a name.`);
    const type = (c.type ?? "").trim().toLowerCase();
    if (!TYPES.includes(type)) throw new Error(`ERROR ${at} type must be one of ${TYPES.join(", ")}, got '${c.type}'.`);
    const day = (c.day ?? "").trim().toLowerCase();
    if (!WEEKDAYS.includes(day)) throw new Error(`ERROR ${at} day must be a weekday, got '${c.day}'.`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.start ?? ""))
      throw new Error(`ERROR ${at} start must be HH:MM (24h), got '${c.start}'.`);
    const duration = c.duration_min ?? 60;
    if (!Number.isInteger(duration) || duration < 15 || duration > 180)
      throw new Error(`ERROR ${at} duration_min must be an integer 15-180.`);
    const intensity = c.intensity ?? 3;
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5)
      throw new Error(`ERROR ${at} intensity must be an integer 1-5.`);
    return { name: c.name.trim(), type, day, start: c.start, duration_min: duration, intensity };
  });
}

const dayRank = (d: string): number => WEEKDAYS.indexOf(d);

export function findClasses(o: { schedule: ClassSession[]; day?: string; type?: string; intensity_max?: number; after?: string; before?: string }) {
  let list = checkSchedule(o.schedule);
  if (o.day !== undefined) {
    const day = o.day.trim().toLowerCase();
    if (!WEEKDAYS.includes(day)) throw new Error(`ERROR day must be a weekday, got '${o.day}'.`);
    list = list.filter((c) => c.day === day);
  }
  if (o.type !== undefined) {
    const type = o.type.trim().toLowerCase();
    if (!TYPES.includes(type)) throw new Error(`ERROR type must be one of ${TYPES.join(", ")}, got '${o.type}'.`);
    list = list.filter((c) => c.type === type);
  }
  if (o.intensity_max !== undefined) {
    if (!Number.isInteger(o.intensity_max) || o.intensity_max < 1 || o.intensity_max > 5)
      throw new Error("ERROR intensity_max must be an integer 1-5.");
    list = list.filter((c) => c.intensity <= (o.intensity_max as number));
  }
  for (const key of ["after", "before"] as const) {
    const v = o[key];
    if (v !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
      throw new Error(`ERROR ${key} must be HH:MM (24h), got '${v}'.`);
  }
  if (o.after !== undefined) list = list.filter((c) => c.start >= (o.after as string));
  if (o.before !== undefined) list = list.filter((c) => c.start <= (o.before as string));
  list.sort((a, b) => dayRank(a.day) - dayRank(b.day) || (a.start < b.start ? -1 : 1));
  return { matches: list, count: list.length };
}

export function quoteWeek(o: { schedule: ClassSession[]; drop_in_usd: number }) {
  const list = checkSchedule(o.schedule);
  if (typeof o.drop_in_usd !== "number" || o.drop_in_usd <= 0)
    throw new Error("ERROR drop_in_usd must be a number > 0.");
  const total = round2(list.length * o.drop_in_usd);
  return {
    class_count: list.length, drop_in_usd: o.drop_in_usd, week_total_usd: total,
    classes: list.map((c) => c.name),
    note: "Drop-in quote for your schedule. Verify the studio's current drop-in rate before paying.",
  };
}

export function membershipBreakEven(o: { drop_in_usd: number; membership_usd: number; classes_per_month?: number }) {
  for (const [k, v] of [["drop_in_usd", o.drop_in_usd], ["membership_usd", o.membership_usd]] as const)
    if (typeof v !== "number" || v <= 0) throw new Error(`ERROR ${k} must be a number > 0.`);
  const need = Math.ceil(o.membership_usd / o.drop_in_usd);
  const out: Record<string, unknown> = {
    classes_to_break_even: need,
    note: `Take ${need}+ classes a month and the membership beats drop-ins.`,
  };
  if (o.classes_per_month !== undefined) {
    if (!Number.isInteger(o.classes_per_month) || o.classes_per_month < 0)
      throw new Error("ERROR classes_per_month must be an integer >= 0.");
    const dropInCost = round2((o.classes_per_month as number) * o.drop_in_usd);
    out.monthly_comparison = {
      classes_per_month: o.classes_per_month, drop_in_cost_usd: dropInCost,
      membership_usd: o.membership_usd,
      cheaper: dropInCost <= o.membership_usd ? "drop-in" : "membership",
      savings_usd: round2(Math.abs(dropInCost - o.membership_usd)),
    };
  }
  return out;
}

export function buildBookingRequest(o: { class_name: string; date: string; time: string; name: string; party_size?: number }) {
  if (!o.class_name?.trim()) throw new Error("ERROR class_name must be a non-empty string.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? "")) throw new Error(`ERROR date must be YYYY-MM-DD, got '${o.date}'.`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.time ?? "")) throw new Error(`ERROR time must be HH:MM (24h), got '${o.time}'.`);
  if (!o.name?.trim()) throw new Error("ERROR name must be a non-empty string.");
  const party = o.party_size ?? 1;
  if (!Number.isInteger(party) || party < 1 || party > 10)
    throw new Error("ERROR party_size must be an integer 1-10.");
  const message = `Hi! I'd like to book ${party} spot${party > 1 ? "s" : ""} in ${o.class_name.trim()} on ${o.date} at ${o.time}. Name: ${o.name.trim()}. Please confirm availability and the cancellation window. Thanks!`;
  return {
    message,
    details: { class_name: o.class_name.trim(), date: o.date, time: o.time, name: o.name.trim(), party_size: party },
    note: "Draft only - ClassDrop does not book with any studio. Send this message to the studio to reserve your spot.",
  };
}

export function classReminders(o: { sessions: Array<{ name: string; starts_at: string }>; lead_hours?: number[] }) {
  if (!Array.isArray(o.sessions) || o.sessions.length === 0)
    throw new Error("ERROR sessions must be a non-empty array.");
  const leads = o.lead_hours ?? [12, 1];
  if (!Array.isArray(leads) || leads.length === 0 || leads.length > 4)
    throw new Error("ERROR lead_hours must be 1-4 numbers.");
  for (const h of leads)
    if (typeof h !== "number" || h <= 0 || h > 72) throw new Error("ERROR each lead_hours value must be > 0 and <= 72.");
  const out = o.sessions.map((s) => {
    if (!s.name?.trim()) throw new Error("ERROR each session needs a name.");
    const at = Date.parse(s.starts_at ?? "");
    if (Number.isNaN(at)) throw new Error(`ERROR starts_at must be an ISO datetime, got '${s.starts_at}'.`);
    return {
      name: s.name, starts_at: s.starts_at,
      reminders: leads.map((h) => new Date(at - h * 3600_000).toISOString()),
    };
  });
  return { sessions: out, note: "Reminder times computed from your class starts. Set them in your own calendar app." };
}

const GOAL_RANK: Record<string, string[]> = {
  balanced: ["cardio", "strength", "mobility", "sport"],
  cardio: ["cardio", "sport", "mobility", "strength"],
  strength: ["strength", "sport", "cardio", "mobility"],
};

export function weekPlan(o: { schedule: ClassSession[]; goal?: string; max_classes?: number }) {
  const list = checkSchedule(o.schedule);
  const goal = (o.goal ?? "balanced").trim().toLowerCase();
  if (!GOAL_RANK[goal]) throw new Error(`ERROR goal must be one of balanced, cardio, strength, got '${o.goal}'.`);
  const max = o.max_classes ?? 5;
  if (!Number.isInteger(max) || max < 1 || max > 14)
    throw new Error("ERROR max_classes must be an integer 1-14.");
  const rank = GOAL_RANK[goal];
  const perDay: Record<string, number> = {};
  const plan: Array<Required<ClassSession>> = [];
  const sorted = [...list].sort((a, b) =>
    rank.indexOf(a.type) - rank.indexOf(b.type) || dayRank(a.day) - dayRank(b.day) || (a.start < b.start ? -1 : 1));
  for (const c of sorted) {
    if (plan.length >= max) break;
    if ((perDay[c.day] ?? 0) >= 2) continue;
    perDay[c.day] = (perDay[c.day] ?? 0) + 1;
    plan.push(c);
  }
  plan.sort((a, b) => dayRank(a.day) - dayRank(b.day) || (a.start < b.start ? -1 : 1));
  const mix: Record<string, number> = {};
  for (const c of plan) mix[c.type] = (mix[c.type] ?? 0) + 1;
  return { goal, max_classes: max, plan, mix, total_minutes: plan.reduce((s, c) => s + c.duration_min, 0) };
}
