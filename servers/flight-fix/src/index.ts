/**
 * FlightFix MCP server - EU261 / UK261 flight compensation checks, rights,
 * timelines and claim letters. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  checkCompensation,
  claimTimeline,
  compensationTable,
  disruptionRights,
  generateClaimLetter,
  type ReasonCategory,
} from "./flightfix.js";

const PORT = Number(process.env.PORT ?? 3006);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";
const REASONS = [
  "unknown", "weather", "atc", "security", "political",
  "strike_atc", "strike_airline", "technical", "crew", "other",
] as const;

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
    { name: "flight-fix", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "FlightFix computes EU261/UK261 flight delay and cancellation compensation: eligibility, amounts, care rights, " +
        "claim deadlines and a ready claim letter. Uses IATA airport codes. All results are informational, not legal advice.",
    },
  );

  server.tool(
    "check_compensation",
    "Calculate compensation for a disrupted flight between two airports. Use when you need to determine eligibility and amount for a specific flight; NOT when you need to generate a claim letter, use generate_claim_letter.",
    {
      departure: z.string().describe("Departure airport IATA code, e.g. LHR"),
      arrival: z.string().describe("Arrival airport IATA code, e.g. JFK"),
      disrupted: z.enum(["delayed", "cancelled"]),
      arrival_delay_hours: z.number().optional().describe("Hours late at final destination (for delays)"),
      notice_days: z.number().optional().describe("Days' notice given (for cancellations)"),
      rerouted: z.boolean().optional().describe("Was a re-routing offered?"),
      reroute_arrival_delay_hours: z.number().optional(),
      reason_category: z.enum(REASONS).optional().describe("Stated disruption cause if known"),
      carrier_country: z.string().optional().describe("Carrier's country code, e.g. DE (needed for arrivals into the EU)"),
      distance_km: z.number().optional().describe("Override distance for airports not in the table"),
    },
    { title: "Check compensation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => checkCompensation({ ...a, reason_category: a.reason_category as ReasonCategory | undefined })),
  );

  server.tool(
    "compensation_table",
    "Retrieve EU261/UK261 compensation amounts by distance band. Use when needing specific compensation details; avoid when assessing disruption rights, use disruption_rights instead.",
    {},
    { title: "Compensation table", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => wrap(() => compensationTable()),
  );

  server.tool(
    "disruption_rights",
    "Retrieve flight disruption rights for a specific journey. Use when you need to know your rights for a disrupted flight. Do NOT use when you need to know the timeline for claiming compensation, use claim_timeline.",
    {
      departure: z.string(),
      arrival: z.string(),
      disrupted: z.enum(["delayed", "cancelled", "denied_boarding"]),
      arrival_delay_hours: z.number().optional(),
      notice_days: z.number().optional(),
    },
    { title: "Disruption rights", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => disruptionRights(a)),
  );

  server.tool(
    "claim_timeline",
    "Retrieve claim timeline for a flight date and scheme. Use when needing a timeline for a specific flight date and scheme. Do NOT use when needing to check compensation eligibility; use check_compensation instead.",
    {
      flight_date: z.string().describe("Flight date YYYY-MM-DD"),
      scheme: z.enum(["EU261", "UK261"]),
    },
    { title: "Claim timeline", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => claimTimeline(a)),
  );

  server.tool(
    "generate_claim_letter",
    "Generate a claim letter for a flight delay, when you have all the flight details but need a formal letter. NOT when you need to check if you're eligible; use check_compensation instead.",
    {
      passenger_name: z.string(),
      airline_name: z.string(),
      flight_number: z.string().describe("e.g. BA117"),
      flight_date: z.string().describe("YYYY-MM-DD"),
      departure: z.string().describe("IATA code"),
      arrival: z.string().describe("IATA code"),
      incident_summary: z.string().optional().describe("One line about what happened"),
      claimed_amount: z.number().optional(),
      currency: z.enum(["EUR", "GBP"]).optional(),
      booking_reference: z.string().optional(),
      scheme: z.enum(["EU261", "UK261"]).optional(),
    },
    { title: "Generate claim letter", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => generateClaimLetter(a)),
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
    res.end(JSON.stringify({ ok: true, tools: 5 }));
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

httpServer.listen(PORT, () => console.log(`FlightFix MCP on :${PORT} (POST /mcp, GET /health)`));
