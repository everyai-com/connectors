/**
 * HvacRescue MCP server - HVAC triage and rescue planning: triage symptoms
 * with severity + safety steps, find tech slots, quote jobs, compare techs,
 * draft dispatch requests, plan tuneups. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildDispatchRequest, compareTechs, findSlots, quoteJob, triageSymptom, tuneupSchedule } from "./hvacrescue.js";

const PORT = Number(process.env.PORT ?? 3221);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Window = z.object({
  day: z.string().describe("Weekday, e.g. 'saturday'"),
  start: z.string().describe("Window start HH:MM 24h"),
  end: z.string().describe("Window end HH:MM 24h"),
});

const PriceItem = z.object({
  name: z.string().describe("Job name, e.g. 'AC tune-up'"),
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
    { name: "hvacrescue", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "HvacRescue plans HVAC rescue visits around symptoms and pricebooks you provide: triage " +
        "symptoms with severity and safety steps (gas and electrical first), find open slots " +
        "for a job length, quote jobs with add-ons, compare techs on your own " +
        "price/rating/distance numbers, draft a dispatch request to send the tech, and plan " +
        "tuneups. Planning only: it never books anything and holds no tech inventory. Pure " +
        "computation; nothing stored.",
    },
  );

  server.tool(
    "triage_symptom",
    "Triage an HVAC symptom: severity (emergency/same_day/routine), safety steps, likely causes and whether to call a pro.",
    {
      symptom: z.string().describe("gas_smell, burning_smell, no_cool, no_heat, strange_noise, water_leak or high_bill"),
      details: z.string().optional().describe("Extra details from the caller"),
    },
    { title: "Triage symptom", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => triageSymptom(a)),
  );

  server.tool(
    "find_slots",
    "Find open start times in availability windows that fit a job length, every 30 minutes.",
    {
      availability: z.array(Window).describe("Tech availability windows"),
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
    "Quote an HVAC job with add-ons from a pricebook: line items, total price and total minutes.",
    {
      pricebook: z.array(PriceItem).describe("Tech pricebook"),
      job: z.string().describe("Job to quote"),
      add_ons: z.array(z.string()).optional().describe("Add-on job names"),
    },
    { title: "Quote job", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteJob(a)),
  );

  server.tool(
    "compare_techs",
    "Rank 2-6 HVAC techs from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.",
    {
      techs: z.array(z.object({
        name: z.string().describe("Tech name"),
        price_usd: z.number().describe("Quoted price in USD"),
        rating: z.number().describe("Rating 1-5"),
        distance_min: z.number().describe("Travel minutes"),
      })).describe("Techs to compare"),
    },
    { title: "Compare techs", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => compareTechs(a)),
  );

  server.tool(
    "build_dispatch_request",
    "Draft a dispatch-request message to send an HVAC tech: job, date, time, name and systems. Draft only, never sent.",
    {
      job: z.string().describe("Job needed"),
      date: z.string().describe("Date YYYY-MM-DD"),
      time: z.string().describe("Time HH:MM 24h"),
      name: z.string().describe("Your name"),
      phone: z.string().optional().describe("Callback number"),
      units: z.number().optional().describe("Systems, 1-10, default 1"),
    },
    { title: "Build dispatch request", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildDispatchRequest(a)),
  );

  server.tool(
    "tuneup_schedule",
    "Compute the next N HVAC tuneup dates every K months after a last tuneup.",
    {
      last_tuneup: z.string().describe("Last tuneup YYYY-MM-DD"),
      every_months: z.number().optional().describe("Interval in months, 1-24, default 6"),
      count: z.number().optional().describe("How many dates, 1-12, default 4"),
    },
    { title: "Tuneup schedule", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => tuneupSchedule(a)),
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

httpServer.listen(PORT, () => console.log(`HvacRescue MCP on :${PORT} (POST /mcp, GET /health)`));
