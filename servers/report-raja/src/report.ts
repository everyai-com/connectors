/** ReportRaja engine - pure compute. No storage: reports are generated per request. */
export type WeeklyReportInput = {
  client_name: string; week_start: string; accomplishments: string[];
  hours_logged?: number; blockers?: string[]; next_week?: string[];
};
export const TEMPLATES = [
  { id: "freelancer-weekly", name: "Freelancer weekly", sections: ["accomplishments", "hours", "blockers", "next_week"] },
  { id: "agency-client", name: "Agency client update", sections: ["accomplishments", "metrics", "blockers", "next_week"] },
  { id: "standup-digest", name: "Standup digest", sections: ["accomplishments", "blockers", "next_week"] },
] as const;

function hashStr(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function parseDate(s: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`'${field}' must be YYYY-MM-DD, got '${s}'`);
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) throw new Error(`'${field}' is not a real date: '${s}'`);
  return d;
}

export function weekBounds(anyDate: string) {
  const d = parseDate(anyDate, "date");
  const dow = d.getUTCDay(); // 0=Sun
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { week_start: iso(monday), week_end: iso(sunday) };
}

export function createWeeklyReport(input: WeeklyReportInput) {
  if (!input.client_name) throw new Error("'client_name' is required");
  const start = parseDate(input.week_start, "week_start");
  if (!Array.isArray(input.accomplishments) || !input.accomplishments.length)
    throw new Error("'accomplishments' must have at least one item");
  if (input.hours_logged !== undefined && (typeof input.hours_logged !== "number" || input.hours_logged < 0))
    throw new Error("'hours_logged' must be a number >= 0");
  for (const k of ["blockers", "next_week"] as const)
    if (input[k] !== undefined && !Array.isArray(input[k])) throw new Error(`'${k}' must be an array`);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const id = `WR-${input.week_start.replace(/-/g, "")}-${(hashStr(input.client_name + JSON.stringify(input.accomplishments)) % 9000 + 1000)}`;
  return {
    report_id: id, client_name: input.client_name,
    week_start: input.week_start, week_end: end.toISOString().slice(0, 10),
    accomplishments: input.accomplishments, hours_logged: input.hours_logged ?? null,
    blockers: input.blockers ?? [], next_week: input.next_week ?? [],
  };
}

export function formatReportPlain(r: ReturnType<typeof createWeeklyReport>): string {
  const L: string[] = [];
  L.push(`WEEKLY REPORT ${r.report_id}`, `Client: ${r.client_name}`, `Week: ${r.week_start} .. ${r.week_end}`, "-".repeat(48),
    "Accomplished:");
  for (const a of r.accomplishments) L.push(`  - ${a}`);
  if (r.hours_logged !== null) L.push(`Hours logged: ${r.hours_logged}`);
  L.push("Blockers:");
  L.push(...(r.blockers.length ? r.blockers.map((b) => `  - ${b}`) : ["  (none)"]));
  L.push("Next week:");
  L.push(...(r.next_week.length ? r.next_week.map((n) => `  - ${n}`) : ["  (tbd)"]));
  return L.join("\n");
}
