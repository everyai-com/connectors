/**
 * ServiceSchedule MCP server - car maintenance due dates, cost estimates,
 * a month-by-month schedule and seasonal checklists.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { dueServices, seasonalChecklist, serviceCostEstimate, serviceTimeline } from "./serviceschedule.js";

const PORT = Number(process.env.PORT ?? 3014);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const LastService = z.object({
  id: z.string().describe("Service id from the maintenance table, e.g. oil_change"),
  odometer: z.number().optional().describe("Odometer when this service was last done (same unit as the main odometer)"),
  months_ago: z.number().optional().describe("Months since this service was last done"),
});

function wrap(fn: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "computation failed";
    return { content: [{ type: "text" as const, text: `ERROR ${msg}` }], isError: true };
  }
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "service-schedule", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "ServiceSchedule plans car maintenance: which services are due, typical US cost ranges by shop tier, " +
        "a month-by-month schedule for the next 12 months and seasonal checklists. All maths only; nothing stored.",
    },
  );

  server.tool(
    "due_services",
    "Calculate vehicle maintenance service statuses from odometer. Use when planning routine maintenance, NOT when estimating service costs (use service_cost_estimate).",
    {
      odometer: z.number().describe("Current odometer reading"),
      unit: z.enum(["km", "mi"]).optional().describe("Unit of the odometer values, default km"),
      months_since_last_oil: z.number().optional().describe("Months since the last oil change; used as the time baseline for items without their own history"),
      km_per_month: z.number().optional().describe("Average km driven per month (100-10000); used to phrase the next service in months"),
      last_service: z.array(LastService).optional().describe("Optional per-service history from the owner"),
    },
    { title: "Due services", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => dueServices(a)),
  );

  server.tool(
    "service_cost_estimate",
    "Estimate the cost of maintenance services at a specific shop tier. Use when needing a price range for multiple services. Do NOT use when needing a list of due services; use due_services instead.",
    {
      services: z.array(z.string()).describe("Service ids to price, e.g. ['oil_change', 'brake_inspection']"),
      tier: z.enum(["economy", "mid", "luxury"]).optional().describe("Shop tier, default mid"),
    },
    { title: "Service cost estimate", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => serviceCostEstimate(a)),
  );

  server.tool(
    "service_timeline",
    "Project the next 12 months of driving from a monthly km rate and list which maintenance services fall due in each month. Use when planning long-term maintenance, NOT for immediate service needs; use due_services instead.",
    {
      odometer: z.number().describe("Current odometer reading"),
      unit: z.enum(["km", "mi"]).optional().describe("Unit of the odometer values, default km"),
      km_per_month: z.number().describe("Average km driven per month (100-10000)"),
      months_since_last_oil: z.number().optional().describe("Months since the last oil change; time baseline when no other history is given"),
    },
    { title: "Service timeline", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => serviceTimeline(a)),
  );

  server.tool(
    "seasonal_checklist",
    "Generate a seasonal car maintenance checklist. Use when planning routine maintenance; avoid when estimating service costs (use service_cost_estimate).",
    {
      season: z.enum(["spring", "summer", "fall", "winter"]).describe("Season to plan for"),
      climate: z.enum(["hot", "cold", "mixed"]).optional().describe("Local climate, default mixed"),
    },
    { title: "Seasonal checklist", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => seasonalChecklist(a)),
  );

  return server;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function authorized(req: IncomingMessage): boolean {
  if (!API_KEY) return true;
  return req.headers.authorization === `Bearer ${API_KEY}`;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tools: 4 }));
    return;
  }
  if (url.pathname === "/.well-known/openai-apps-challenge") {
    if (!CHALLENGE) { res.writeHead(404); res.end("not configured"); return; }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(CHALLENGE);
    return;
  }
  if (url.pathname === "/mcp") {
    if (!authorized(req)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized: provide Authorization: Bearer <API_KEY>" }));
      return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : "bad request" }));
      }
    }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "use POST /mcp (MCP), GET /health" }));
});

httpServer.listen(PORT, () => console.log(`ServiceSchedule MCP on :${PORT} (POST /mcp, GET /health)`));
