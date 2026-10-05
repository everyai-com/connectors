/**
 * PlumbNow MCP server - plumbing triage and dispatch planning: diagnose
 * issues with severity + shutoff steps, find plumber slots, quote jobs,
 * compare plumbers, draft dispatch requests, plan maintenance. All tools
 * are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildDispatchRequest, comparePlumbers, diagnoseIssue, findSlots, maintenancePlan, quoteJob } from "./plumbnow.js";

const PORT = Number(process.env.PORT ?? 3220);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Window = z.object({
  day: z.string().describe("Weekday, e.g. 'saturday'"),
  start: z.string().describe("Window start HH:MM 24h"),
  end: z.string().describe("Window end HH:MM 24h"),
});

const PriceItem = z.object({
  name: z.string().describe("Job name, e.g. 'Drain unclog'"),
  price_usd: z.number().describe("Price in USD"),
  duration_min: z.number().describe("Duration in minutes, 10-300"),
});

function wrap(fn: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "computation failed";
    return { content: [{ type: "text" as const, text: msg.startsWith("ERROR") ? msg : `ERROR ${msg}` }], isError: true };
  }
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "plumb-now", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "PlumbNow plans plumbing visits around symptoms and pricebooks you provide: diagnose " +
        "issues with severity and shutoff steps, find open slots for a job length, quote jobs " +
        "with add-ons, compare plumbers on your own price/rating/distance numbers, draft a " +
        "dispatch request to send the plumber, and plan maintenance checkups. Planning only: " +
        "it never books anything and holds no plumber inventory. Pure computation; nothing stored.",
    },
  );

  server.tool(
    "diagnose_issue",
    "Diagnose a plumbing issue: likely causes, severity (emergency/same_day/routine), shutoff steps and whether to call a pro.",
    {
      symptom: z.string().describe("leak, burst_pipe, clog, no_hot_water, low_pressure, running_toilet or sewer_smell"),
      details: z.string().optional().describe("Extra details from the caller"),
    },
    { title: "Diagnose issue", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => diagnoseIssue(a)),
  );

  server.tool(
    "find_slots",
    "Find open start times in availability windows that fit a job length, every 30 minutes.",
    {
      availability: z.array(Window).describe("Plumber availability windows"),
      day: z.string().optional().describe("Filter to a weekday"),
      duration_min: z.number().optional().describe("Job length in minutes, 15-240, default 60"),
      after: z.string().optional().describe("Only slots ending after HH:MM"),
      before: z.string().optional().describe("Only slots starting before HH:MM"),
    },
    { title: "Find slots", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => findSlots(a)),
  );

  server.tool(
    "quote_job",
    "Quote a plumbing job with add-ons from a pricebook: line items, total price and total minutes.",
    {
      pricebook: z.array(PriceItem).describe("Plumber pricebook"),
      job: z.string().describe("Job to quote"),
      add_ons: z.array(z.string()).optional().describe("Add-on job names"),
    },
    { title: "Quote job", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteJob(a)),
  );

  server.tool(
    "compare_plumbers",
    "Rank 2-6 plumbers from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.",
    {
      plumbers: z.array(z.object({
        name: z.string().describe("Plumber name"),
        price_usd: z.number().describe("Quoted price in USD"),
        rating: z.number().describe("Rating 1-5"),
        distance_min: z.number().describe("Travel minutes"),
      })).describe("Plumbers to compare"),
    },
    { title: "Compare plumbers", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => comparePlumbers(a)),
  );

  server.tool(
    "build_dispatch_request",
    "Draft a dispatch-request message to send a plumber: job, date, time, name and units. Draft only, never sent.",
    {
      job: z.string().describe("Job needed"),
      date: z.string().describe("Date YYYY-MM-DD"),
      time: z.string().describe("Time HH:MM 24h"),
      name: z.string().describe("Your name"),
      phone: z.string().optional().describe("Callback number"),
      units: z.number().optional().describe("Units, 1-10, default 1"),
    },
    { title: "Build dispatch request", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildDispatchRequest(a)),
  );

  server.tool(
    "maintenance_plan",
    "Compute the next N plumbing checkup dates every K months after a last visit.",
    {
      last_visit: z.string().describe("Last visit YYYY-MM-DD"),
      every_months: z.number().optional().describe("Interval in months, 1-24, default 12"),
      count: z.number().optional().describe("How many dates, 1-12, default 2"),
    },
    { title: "Maintenance plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => maintenancePlan(a)),
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
    res.end(JSON.stringify({ ok: true, tools: 6 }));
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

httpServer.listen(PORT, () => console.log(`PlumbNow MCP on :${PORT} (POST /mcp, GET /health)`));
