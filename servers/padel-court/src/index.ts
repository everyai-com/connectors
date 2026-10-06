/**
 * PadelCourt MCP server - padel session planning: find clubs, quote sessions
 * with per-player splits, membership break-even, booking drafts, match
 * reminders, week plans within budget. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildBookingRequest, findCourts, matchReminders, membershipBreakEven, quoteSession, weekPlan } from "./padelcourt.js";

const PORT = Number(process.env.PORT ?? 3224);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Club = z.object({
  name: z.string().describe("Club name"),
  indoor: z.boolean().describe("Indoor courts"),
  price_per_hour: z.number().describe("Court price per hour in USD"),
  rating: z.number().describe("Rating 1-5"),
  distance_min: z.number().describe("Travel minutes"),
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
    { name: "padel-court", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "PadelCourt plans padel sessions around clubs and prices you provide: find clubs by " +
        "indoor, price and rating filters, quote sessions with per-player splits, compute the " +
        "membership break-even, draft a booking request to send the club, compute match " +
        "reminders and plan a week of sessions within budget. Planning only: it never books " +
        "anything and holds no club inventory. Pure computation; nothing stored.",
    },
  );

  server.tool(
    "find_courts",
    "Filter courts by indoor availability, price and rating, then rank by rating, price and distance. Use when prioritizing specific court features and budget. NOT for finding courts by location or availability..",
    {
      clubs: z.array(Club).describe("Clubs to search"),
      indoor_only: z.boolean().optional().describe("Only indoor courts"),
      max_price: z.number().optional().describe("Max price per hour in USD"),
      min_rating: z.number().optional().describe("Min rating 1-5"),
    },
    { title: "Find courts", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => findCourts(a)),
  );

  server.tool(
    "quote_session",
    "Calculate the total cost and per-player split for a padel session. Use when booking a court and splitting the cost among players; NOT for recurring memberships, use membership_break_even instead.",
    {
      price_per_hour: z.number().describe("Court price per hour in USD"),
      hours: z.number().optional().describe("0.5, 1, 1.5 or 2; default 1"),
      players: z.number().optional().describe("Players splitting, 2-8, default 4"),
      ball_machine: z.boolean().optional().describe("Add $15 ball machine"),
    },
    { title: "Quote session", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => quoteSession(a)),
  );

  server.tool(
    "membership_break_even",
    "Calculate the break-even point for a club membership versus pay-as-you-go sessions. Use when evaluating membership value; NOT for comparing membership tiers. Use membership_break_even_tiers instead.",
    {
      membership_monthly: z.number().describe("Monthly membership in USD"),
      payg_per_session: z.number().describe("Pay-as-you-go price per session in USD"),
      sessions_per_month: z.number().describe("Your monthly sessions"),
    },
    { title: "Membership break-even", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => membershipBreakEven(a)),
  );

  server.tool(
    "build_booking_request",
    "Create a booking-request message for a club. Use when you need to draft a request to book a court. Do NOT use when you need to find available courts; use find_courts instead.",
    {
      club: z.string().describe("Club to book"),
      date: z.string().describe("Date YYYY-MM-DD"),
      time: z.string().describe("Time HH:MM 24h"),
      name: z.string().describe("Your name"),
      players: z.number().optional().describe("Players, 2-8, default 4"),
    },
    { title: "Build booking request", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => buildBookingRequest(a)),
  );

  server.tool(
    "match_reminders",
    "Calculate reminder datetimes before a match starts from lead times in hours. Use when you need to schedule match reminders. Do NOT use for real-time notifications; use find_courts instead.",
    {
      match: z.string().describe("Match booked"),
      starts_at: z.string().describe("Match start, ISO datetime"),
      lead_hours: z.array(z.number()).optional().describe("Lead times in hours, default [24, 2]"),
    },
    { title: "Match reminders", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => matchReminders(a)),
  );

  server.tool(
    "week_plan",
    "Calculate the maximum sessions a budget buys, prioritizing cheapest sessions first. Use when optimizing weekly spending on sessions; NOT for single-session planning. Use find_courts for court availability.",
    {
      budget: z.number().describe("Weekly budget in USD"),
      sessions: z.array(z.object({
        club: z.string().describe("Club name"),
        price: z.number().describe("Session price in USD"),
      })).describe("Candidate sessions"),
    },
    { title: "Week plan", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => wrap(() => weekPlan(a)),
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

httpServer.listen(PORT, () => console.log(`PadelCourt MCP on :${PORT} (POST /mcp, GET /health)`));
