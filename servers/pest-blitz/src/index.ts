/**
 * PestBlitz MCP server - pest triage and treatment planning: identify pests
 * from signs, find pro slots, quote treatments, compare providers, draft
 * dispatch requests, plan retreatments. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildDispatchRequest, compareProviders, findSlots, identifyPest, quoteTreatment, retreatSchedule } from "./pestblitz.js";

const PORT = Number(process.env.PORT ?? 3222);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Window = z.object({
  day: z.string().describe("Weekday, e.g. 'saturday'"),
  start: z.string().describe("Window start HH:MM 24h"),
  end: z.string().describe("Window end HH:MM 24h"),
});

const PriceItem = z.object({
  name: z.string().describe("Treatment name, e.g. 'Ant treatment'"),
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
    { name: "pest-blitz", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "PestBlitz plans pest-control visits around signs and pricebooks you provide: identify " +
        "likely pests with confidence and urgency, find open slots for a visit length, quote " +
        "treatments with add-ons, compare providers on your own price/rating/distance numbers, " +
        "draft a dispatch request to send the provider, and plan retreatment dates. Planning " +
        "only: it never books anything and holds no provider inventory. Pure computation; " +
        "nothing stored.",
    },
  );

  server.tool(
    "identify_pest",
    "Identify pests from observed signs in a property. Use when you need to diagnose a pest issue; NOT when you need to find available time slots for a visit (use find_slots).",
    {
      signs: z.array(z.object({
        type: z.string().describe("droppings, noises, mud_tubes, sawdust, trails, nests, bites or damage"),
        where: z.string().describe("Where the sign was seen"),
      })).describe("Observed signs"),
    },
    { title: "Identify pest", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => identifyPest(a)),
  );

  server.tool(
    "find_slots",
    "Find open start times in availability windows that fit a visit length, every 30 minutes. Use when you need to schedule a visit within specific time frames. Do NOT use when you need to identify pests in a property, use identify_pest instead.",
    {
      availability: z.array(Window).describe("Provider availability windows"),
      day: z.string().optional().describe("Filter to a weekday"),
      duration_min: z.number().optional().describe("Visit length in minutes, 15-240, default 60"),
      after: z.string().optional().describe("Only slots ending after HH:MM"),
      before: z.string().optional().describe("Only slots starting before HH:MM"),
    },
    { title: "Find slots", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => findSlots(a)),
  );

  server.tool(
    "quote_treatment",
    "Quote a pest treatment with add-ons from a pricebook. Use when you need to generate a quote for a specific treatment and add-ons. Do NOT use when you need to find available time slots for a treatment; use find_slots instead.",
    {
      pricebook: z.array(PriceItem).describe("Provider pricebook"),
      treatment: z.string().describe("Treatment to quote"),
      add_ons: z.array(z.string()).optional().describe("Add-on treatment names"),
    },
    { title: "Quote treatment", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => quoteTreatment(a)),
  );

  server.tool(
    "compare_providers",
    "Rank 2-6 pest providers by price, rating, and distance. Use when comparing multiple providers; NOT when needing a single best provider (use identify_pest).",
    {
      providers: z.array(z.object({
        name: z.string().describe("Provider name"),
        price_usd: z.number().describe("Quoted price in USD"),
        rating: z.number().describe("Rating 1-5"),
        distance_min: z.number().describe("Travel minutes"),
      })).describe("Providers to compare"),
    },
    { title: "Compare providers", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => compareProviders(a)),
  );

  server.tool(
    "build_dispatch_request",
    "Create a dispatch-request message for a pest provider. Use when you need to draft a request for treatment. Do NOT use when you need to find available time slots; use find_slots instead.",
    {
      treatment: z.string().describe("Treatment needed"),
      date: z.string().describe("Date YYYY-MM-DD"),
      time: z.string().describe("Time HH:MM 24h"),
      name: z.string().describe("Your name"),
      phone: z.string().optional().describe("Callback number"),
      units: z.number().optional().describe("Units, 1-10, default 1"),
    },
    { title: "Build dispatch request", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => buildDispatchRequest(a)),
  );

  server.tool(
    "retreat_schedule",
    "Calculate N retreatment dates every K weeks after a last visit. Use when scheduling regular treatments; avoid when identifying pests with identify_pest.",
    {
      last_visit: z.string().describe("Last visit YYYY-MM-DD"),
      every_weeks: z.number().optional().describe("Interval in weeks, 1-52, default 4"),
      count: z.number().optional().describe("How many dates, 1-12, default 3"),
    },
    { title: "Retreat schedule", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => retreatSchedule(a)),
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

httpServer.listen(PORT, () => console.log(`PestBlitz MCP on :${PORT} (POST /mcp, GET /health)`));
