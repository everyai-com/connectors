/** ReportRaja MCP server - weekly client reports. 4 tools, all read-only compute. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TEMPLATES, createWeeklyReport, formatReportPlain, weekBounds, type WeeklyReportInput } from "./report.js";

const PORT = Number(process.env.PORT ?? 3004);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
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
  server.tool("create_weekly_report", "Build a weekly client report from accomplishments, hours, blockers and next-week plans. Nothing stored.",
    ReportShape, { title: "Create weekly report", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => createWeeklyReport(a as WeeklyReportInput))());
  server.tool("render_report_text", "Render a weekly report as plain text (same inputs as create_weekly_report).",
    ReportShape, { title: "Render report text", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => ({ text: formatReportPlain(createWeeklyReport(a as WeeklyReportInput)) }))());
  server.tool("report_templates", "List built-in report templates (freelancer, agency, standup).",
    {}, { title: "Report templates", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async () => wrap(() => ({ templates: TEMPLATES }))());
  server.tool("week_bounds", "Monday..Sunday bounds for the week containing a date (YYYY-MM-DD).",
    { date: z.string() }, { title: "Week bounds", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
