/** SheetShift engine - pure compute. No storage: tables are converted per request. */
export type TableFormat = "csv" | "tsv" | "json" | "markdown";
const FORMATS = ["csv", "tsv", "json", "markdown"] as const;

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c === "\r") { /* skip */ }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows;
}
function escCsv(cell: string, delim: string): string {
  return /["\n\r]/.test(cell) || cell.includes(delim) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
function toObjects(rows: string[][]): Array<Record<string, string>> {
  const [head, ...rest] = rows;
  if (!head) throw new Error("table has no rows");
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
function toMarkdown(rows: string[][]): string {
  if (!rows.length) throw new Error("table has no rows");
  const L = [`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`];
  for (const r of rows.slice(1)) L.push(`| ${r.join(" | ")} |`);
  return L.join("\n");
}
export function parseTable(data: string, from: string): string[][] {
  if (!data || !data.trim()) throw new Error("'data' must be a non-empty table string");
  if (from !== "csv" && from !== "tsv" && from !== "json") throw new Error(`'from_format' must be csv, tsv or json, got '${from}'`);
  if (from === "json") {
    const v = JSON.parse(data) as Array<Record<string, unknown>>;
    if (!Array.isArray(v) || !v.length) throw new Error("JSON must be a non-empty array of objects");
    const head = Object.keys(v[0]);
    return [head, ...v.map((o) => head.map((h) => String(o[h] ?? "")))];
  }
  return parseDelimited(data, from === "csv" ? "," : "\t");
}
export function renderTable(rows: string[][], to: string): string {
  if (!FORMATS.includes(to as TableFormat)) throw new Error(`'to_format' must be one of ${FORMATS.join(", ")}, got '${to}'`);
  if (to === "json") return JSON.stringify(toObjects(rows));
  if (to === "markdown") return toMarkdown(rows);
  const delim = to === "csv" ? "," : "\t";
  return rows.map((r) => r.map((c) => escCsv(c, delim)).join(delim)).join("\n");
}
export function convertTable(data: string, from_format: string, to_format: string) {
  const rows = parseTable(data, from_format);
  return { text: renderTable(rows, to_format), rows: rows.length - 1, columns: rows[0].length };
}
export function cleanTable(data: string, format: string, opts: { trim?: boolean; drop_empty_rows?: boolean; dedupe?: boolean }) {
  let rows = parseTable(data, format);
  const before = rows.length - 1;
  const trim = opts.trim ?? true, drop = opts.drop_empty_rows ?? true, ded = opts.dedupe ?? false;
  if (trim) rows = rows.map((r) => r.map((c) => c.trim()));
  let body = rows.slice(1);
  if (drop) body = body.filter((r) => r.some((c) => c !== ""));
  if (ded) { const seen = new Set<string>(); body = body.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
  const out = [rows[0], ...body];
  return { text: renderTable(out, format === "json" ? "json" : format), rows_before: before, rows_after: body.length };
}
function resolveColumn(rows: string[][], column: string): number {
  const head = rows[0];
  if (/^\d+$/.test(column)) {
    const i = Number(column);
    if (i < 0 || i >= head.length) throw new Error(`column index ${i} out of range (0..${head.length - 1})`);
    return i;
  }
  const i = head.indexOf(column);
  if (i < 0) throw new Error(`unknown column '${column}'; have: ${head.join(", ")}`);
  return i;
}
export function columnStats(data: string, format: string, column: string, op: string) {
  const rows = parseTable(data, format);
  const i = resolveColumn(rows, column);
  const vals = rows.slice(1).map((r) => r[i] ?? "");
  if (!["sum", "avg", "min", "max", "count", "distinct"].includes(op)) throw new Error(`'op' must be sum, avg, min, max, count or distinct, got '${op}'`);
  if (op === "count") return { column: rows[0][i], op, result: vals.filter((v) => v !== "").length };
  if (op === "distinct") return { column: rows[0][i], op, result: [...new Set(vals)].sort() };
  const nums = vals.filter((v) => v !== "").map((v) => { const n = Number(v); if (isNaN(n)) throw new Error(`non-numeric value '${v}' in column '${rows[0][i]}'`); return n; });
  if (!nums.length) throw new Error(`no numeric values in column '${rows[0][i]}'`);
  const result = op === "sum" ? nums.reduce((a, b) => a + b, 0) : op === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length : op === "min" ? Math.min(...nums) : Math.max(...nums);
  return { column: rows[0][i], op, result: Math.round(result * 100) / 100 };
}
export function splitColumn(data: string, format: string, column: string, delimiter: string, new_names?: string[]) {
  if (!delimiter) throw new Error("'delimiter' is required");
  const rows = parseTable(data, format);
  const i = resolveColumn(rows, column);
  const parts = rows.slice(1).map((r) => (r[i] ?? "").split(delimiter));
  const n = Math.max(...parts.map((p) => p.length));
  const names = new_names ?? Array.from({ length: n }, (_, k) => `${rows[0][i]}_${k + 1}`);
  if (names.length !== n) throw new Error(`'new_names' has ${names.length} names but split yields ${n} parts`);
  const out = rows.map((r, ri) => {
    const head = ri === 0;
    const vals = head ? names : parts[ri - 1].concat(Array(n - parts[ri - 1].length).fill(""));
    return [...r.slice(0, i), ...vals, ...r.slice(i + 1)];
  });
  return { text: renderTable(out, format === "json" ? "json" : format), parts: n };
}
