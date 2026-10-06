/** ReportRaja MCP server - weekly client reports. 4 tools, all read-only compute. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TEMPLATES, createWeeklyReport, formatReportPlain, weekBounds, type WeeklyReportInput } from "./report.js";

const PORT = Number(process.env.PORT ?? 3004);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ReportShape = {
  client_name: z.string(), week_start: z.string().describe("YYYY-MM-DD, Monday"),
  accomplishments: z.array(z.string()), hours_logged: z.number().optional(),
  blockers: z.array(z.string()).optional(), next_week: z.array(z.string()).optional(),
};

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "report-raja", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: "ReportRaja builds weekly client reports: accomplishments, hours, blockers, next week. Computed per request, nothing stored." },
  );
  const wrap = (fn: () => unknown) => async () => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] }; }
    catch (e) { return { content: [{ type: "text" as const, text: `ERROR ${e instanceof Error ? e.message : "bad input"}` }], isError: true }; }
  };
  server.tool("create_weekly_report", "Generate a weekly report from accomplishments, hours, blockers, and next-week plans. Use when needing a structured report. Do NOT use when needing a text-only report; use render_report_text instead.",
    ReportShape, { title: "Create weekly report", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => createWeeklyReport(a as WeeklyReportInput))());
  server.tool("render_report_text", "Generate a weekly report as plain text. Use when needing a text-only report. Avoid when needing a formatted report, use report_templates instead.",
    ReportShape, { title: "Render report text", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => ({ text: formatReportPlain(createWeeklyReport(a as WeeklyReportInput)) }))());
  server.tool("report_templates", "List all built-in report templates for the current user. Use when needing a list of available templates; NOT when generating a specific report (use create_weekly_report).",
    {}, { title: "Report templates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => wrap(() => ({ templates: TEMPLATES }))());
  server.tool("week_bounds", "Retrieve Monday-Sunday bounds for a given date. Use when you need to determine the week range for a specific date. Do NOT use when you need to generate a text report, use render_report_text instead.",
    { date: z.string() }, { title: "Week bounds", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => weekBounds(a.date))());
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
httpServer.listen(PORT, () => console.log(`report-raja MCP on :${PORT}`));
