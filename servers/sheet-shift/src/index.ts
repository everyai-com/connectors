/** SheetShift MCP server - CSV/table conversion. 4 tools, all read-only compute. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { cleanTable, columnStats, convertTable, splitColumn } from "./sheet.js";

const PORT = Number(process.env.PORT ?? 3005);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "sheet-shift", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: "SheetShift converts and cleans tables: CSV/TSV/JSON/markdown conversion, dedupe, column stats, column splits. Computed per request, nothing stored." },
  );
  const wrap = (fn: () => unknown) => async () => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] }; }
    catch (e) { return { content: [{ type: "text" as const, text: `ERROR ${e instanceof Error ? e.message : "bad input"}` }], isError: true }; }
  };
  server.tool("convert_table", "Convert a table string between CSV, TSV, JSON and Markdown. Use when you need to change the format of a table. Do NOT use when you need to clean the table, use clean_table instead.",
    { data: z.string(), from_format: z.string().describe("csv, tsv, json"), to_format: z.string().describe("csv, tsv, json, markdown") },
    { title: "Convert table", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => convertTable(a.data, a.from_format, a.to_format))());
  server.tool("clean_table", "Clean a table string by trimming cells, dropping empty rows, and deduplicating rows. Use when you need to prepare data for analysis; NOT when you need to convert table formats, use convert_table.",
    { data: z.string(), format: z.string().describe("csv, tsv, json").optional(),
      trim: z.boolean().optional(), drop_empty_rows: z.boolean().optional(), dedupe: z.boolean().optional() },
    { title: "Clean table", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => cleanTable(a.data, a.format ?? "csv", { trim: a.trim, drop_empty_rows: a.drop_empty_rows, dedupe: a.dedupe }))());
  server.tool("column_stats", "Calculate sum/avg/min/max/count/distinct over one column. Use when needing quick column statistics; avoid when needing to convert table formats, use convert_table.",
    { data: z.string(), format: z.string().describe("csv, tsv, json").optional(),
      column: z.string(), op: z.string().describe("sum, avg, min, max, count, distinct") },
    { title: "Column stats", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => columnStats(a.data, a.format ?? "csv", a.column, a.op))());
  server.tool("split_column", "Split a column into new columns on a delimiter. Use when you need to break down a single column into multiple columns. Do NOT use when you need to convert the entire table format; use convert_table instead.",
    { data: z.string(), format: z.string().describe("csv, tsv, json").optional(),
      column: z.string(), delimiter: z.string(), new_names: z.array(z.string()).optional() },
    { title: "Split column", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => splitColumn(a.data, a.format ?? "csv", a.column, a.delimiter, a.new_names))());
  return server;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { if (!data) return resolve(undefined); try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, tools: 4 })); return; }
  if (url.pathname === "/.well-known/openai-apps-challenge") {
    if (!CHALLENGE) { res.writeHead(404); res.end("not configured"); return; }
    res.writeHead(200, { "content-type": "text/plain" }); res.end(CHALLENGE); return;
  }
  if (url.pathname === "/mcp") {
    if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
      res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch { if (!res.headersSent) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "bad request" })); } }
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: "use POST /mcp, GET /health" }));
});
httpServer.listen(PORT, () => console.log(`sheet-shift MCP on :${PORT}`));
