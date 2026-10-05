/**
 * StayTonight MCP server - tonight-stay planning: find hotels, quote nights
 * with taxes and fees, loyalty break-even, booking drafts, stay reminders,
 * trip plans within budget. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildBookingRequest, findStays, loyaltyBreakEven, quoteNight, stayReminders, tripPlan } from "./staytonight.js";

const PORT = Number(process.env.PORT ?? 3225);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Hotel = z.object({
  name: z.string().describe("Hotel name"),
  price: z.number().describe("Nightly price in USD"),
  rating: z.number().describe("Rating 1-5"),
  distance_min: z.number().describe("Travel minutes"),
  amenities: z.array(z.string()).describe("Amenities, e.g. pool, wifi, parking"),
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
    { name: "stay-tonight", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "StayTonight plans tonight stays around hotels and prices you provide: find hotels by " +
        "price, rating and amenity filters, quote nights with taxes and fees, compute the " +
        "loyalty break-even, draft a booking request to send the hotel, compute stay " +
        "reminders and plan a multi-night trip within budget. Planning only: it never books " +
        "anything and holds no hotel inventory. Pure computation; nothing stored.",
    },
  );

  server.tool(
    "find_stays",
    "Find hotels matching price, rating and amenity filters, ranked by rating, price and distance.",
    {
      hotels: z.array(Hotel).describe("Hotels to search"),
      max_price: z.number().optional().describe("Max nightly price in USD"),
      min_rating: z.number().optional().describe("Min rating 1-5"),
      need_amenities: z.array(z.string()).optional().describe("Required amenities"),
    },
    { title: "Find stays", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => findStays(a)),
  );

  server.tool(
    "quote_night",
    "Quote a stay: room rate across nights plus taxes and fees into an all-in total.",
    {
      room_price: z.number().describe("Room price per night in USD"),
      taxes_pct: z.number().optional().describe("Tax percent 0-40, default 12"),
      fees: z.number().optional().describe("Flat fees in USD, default 0"),
      nights: z.number().optional().describe("Nights 1-30, default 1"),
    },
    { title: "Quote night", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteNight(a)),
  );

  server.tool(
    "loyalty_break_even",
    "Compute how many nights a year justify a hotel loyalty membership, with a verdict at your volume.",
    {
      membership_yearly: z.number().describe("Yearly membership in USD"),
      member_discount_pct: z.number().describe("Member discount percent 0-90"),
      avg_night_price: z.number().describe("Average night price in USD"),
      nights_per_year: z.number().describe("Your yearly nights"),
    },
    { title: "Loyalty break-even", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => loyaltyBreakEven(a)),
  );

  server.tool(
    "build_booking_request",
    "Draft a booking-request message to send a hotel: hotel, date, name, nights and guests. Draft only, never sent.",
    {
      hotel: z.string().describe("Hotel to book"),
      date: z.string().describe("Check-in date YYYY-MM-DD"),
      name: z.string().describe("Your name"),
      nights: z.number().optional().describe("Nights 1-30, default 1"),
      guests: z.number().optional().describe("Guests 1-10, default 2"),
    },
    { title: "Build booking request", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildBookingRequest(a)),
  );

  server.tool(
    "stay_reminders",
    "Compute reminder datetimes before check-in from lead times in hours.",
    {
      stay: z.string().describe("Stay booked"),
      starts_at: z.string().describe("Check-in, ISO datetime"),
      lead_hours: z.array(z.number()).optional().describe("Lead times in hours, default [24, 2]"),
    },
    { title: "Stay reminders", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => stayReminders(a)),
  );

  server.tool(
    "trip_plan",
    "Plan the most nights a budget buys: cheapest-first picks with total and leftover.",
    {
      budget: z.number().describe("Trip budget in USD"),
      nights: z.array(z.object({
        hotel: z.string().describe("Hotel name"),
        price: z.number().describe("Night price in USD"),
      })).describe("Candidate nights"),
    },
    { title: "Trip plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => tripPlan(a)),
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

httpServer.listen(PORT, () => console.log(`StayTonight MCP on :${PORT} (POST /mcp, GET /health)`));
