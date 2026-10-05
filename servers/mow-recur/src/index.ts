/**
 * MowRecur MCP server - recurring lawn-care planning: mow schedules,
 * seasonal quotes, provider comparison, service-request drafts, care
 * calendars and mow reminders. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildServiceRequest, careCalendar, compareProviders, mowReminders, mowSchedule, quoteSeason } from "./mowrecur.js";

const PORT = Number(process.env.PORT ?? 3219);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

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
    { name: "mow-recur", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "MowRecur plans recurring lawn care: mow dates across a season, seasonal " +
        "cost quotes, provider comparison on your numbers, service-request drafts " +
        "to send a provider, annual care calendars for cool or warm grass, and mow " +
        "reminders. Planning only: it never books anything. Pure computation; " +
        "nothing stored.",
    },
  );

  server.tool(
    "mow_schedule",
    "Compute mow dates across a season on a weekday, every 1-4 weeks.",
    {
      season_start: z.string().describe("Season start YYYY-MM-DD"),
      season_end: z.string().describe("Season end YYYY-MM-DD"),
      weekday: z.string().optional().describe("Mow weekday, default saturday"),
      every_weeks: z.number().optional().describe("Interval 1-4 weeks, default 1"),
    },
    { title: "Mow schedule", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => mowSchedule(a)),
  );

  server.tool(
    "quote_season",
    "Quote a mowing season: cuts times price per cut plus optional extras like fertilizing.",
    {
      cuts: z.number().describe("Number of cuts, 1-60"),
      price_per_cut: z.number().describe("Price per cut in USD"),
      extras: z.array(z.object({
        name: z.string().describe("Extra service name"),
        price_usd: z.number().describe("Extra price in USD"),
      })).optional().describe("One-off extras"),
    },
    { title: "Quote season", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteSeason(a)),
  );

  server.tool(
    "compare_providers",
    "Rank 2-6 lawn providers from your price, rating and visit numbers: 50% rating, 50% monthly cost.",
    {
      providers: z.array(z.object({
        name: z.string().describe("Provider name"),
        price_per_cut: z.number().describe("Price per cut in USD"),
        rating: z.number().describe("Rating 1-5"),
        visits_per_month: z.number().describe("Visits per month, 1-8"),
      })).describe("Providers to compare"),
    },
    { title: "Compare providers", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => compareProviders(a)),
  );

  server.tool(
    "build_service_request",
    "Draft a service-request message to send a lawn provider: service, start date, frequency and name. Draft only, never sent.",
    {
      service: z.string().describe("Service wanted"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      frequency: z.string().describe("Frequency, e.g. 'weekly'"),
      name: z.string().describe("Your name"),
      phone: z.string().optional().describe("Callback number"),
      lot_size: z.string().optional().describe("Lot size, e.g. 'quarter acre'"),
    },
    { title: "Build service request", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildServiceRequest(a)),
  );

  server.tool(
    "care_calendar",
    "Get the annual lawn-care calendar for cool-season (fescue) or warm-season (bermuda) grass.",
    {
      grass: z.string().describe("'cool' or 'warm'"),
    },
    { title: "Care calendar", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => careCalendar(a)),
  );

  server.tool(
    "mow_reminders",
    "Compute reminder datetimes before each mow date, assuming a 9am mow.",
    {
      mow_dates: z.array(z.string()).describe("Mow dates YYYY-MM-DD, up to 12"),
      lead_hours: z.array(z.number()).optional().describe("Lead times in hours, default [24, 2]"),
    },
    { title: "Mow reminders", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => mowReminders(a)),
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

httpServer.listen(PORT, () => console.log(`MowRecur MCP on :${PORT} (POST /mcp, GET /health)`));
