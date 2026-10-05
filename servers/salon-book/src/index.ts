/**
 * SalonBook MCP server - salon visit planning: availability search, service
 * quotes, salon comparison, booking-request drafts, rebook schedules and
 * appointment reminders. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { appointmentReminders, buildBookingRequest, compareSalons, findSlots, quoteService, rebookSchedule } from "./salonbook.js";

const PORT = Number(process.env.PORT ?? 3218);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Window = z.object({
  day: z.string().describe("Weekday, e.g. 'saturday'"),
  start: z.string().describe("Window start HH:MM 24h"),
  end: z.string().describe("Window end HH:MM 24h"),
});

const Service = z.object({
  name: z.string().describe("Service name, e.g. 'Haircut'"),
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
    { name: "salon-book", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "SalonBook plans salon visits around availability and menus you provide: find " +
        "open slots for a service length, quote services with add-ons, compare salons on " +
        "your own price/rating/distance numbers, draft a booking request to send the salon, " +
        "compute rebook dates and reminder times. Planning only: it never books anything " +
        "and holds no salon inventory. Pure computation; nothing stored.",
    },
  );

  server.tool(
    "find_slots",
    "Find open start times in availability windows that fit a service length, every 30 minutes.",
    {
      availability: z.array(Window).describe("Salon availability windows"),
      day: z.string().optional().describe("Filter to a weekday"),
      duration_min: z.number().optional().describe("Service length in minutes, 15-240, default 60"),
      after: z.string().optional().describe("Only slots ending after HH:MM"),
      before: z.string().optional().describe("Only slots starting before HH:MM"),
    },
    { title: "Find slots", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => findSlots(a)),
  );

  server.tool(
    "quote_service",
    "Quote a service with add-ons from a salon menu: line items, total price and total minutes.",
    {
      menu: z.array(Service).describe("Salon service menu"),
      service: z.string().describe("Service to quote"),
      add_ons: z.array(z.string()).optional().describe("Add-on service names"),
    },
    { title: "Quote service", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteService(a)),
  );

  server.tool(
    "compare_salons",
    "Rank 2-6 salons from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.",
    {
      salons: z.array(z.object({
        name: z.string().describe("Salon name"),
        price_usd: z.number().describe("Quoted price in USD"),
        rating: z.number().describe("Rating 1-5"),
        distance_min: z.number().describe("Travel minutes"),
      })).describe("Salons to compare"),
    },
    { title: "Compare salons", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => compareSalons(a)),
  );

  server.tool(
    "build_booking_request",
    "Draft a booking-request message to send a salon: service, date, time, name and party size. Draft only, never sent.",
    {
      service: z.string().describe("Service to book"),
      date: z.string().describe("Date YYYY-MM-DD"),
      time: z.string().describe("Time HH:MM 24h"),
      name: z.string().describe("Your name"),
      phone: z.string().optional().describe("Callback number"),
      party_size: z.number().optional().describe("People, 1-6, default 1"),
    },
    { title: "Build booking request", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildBookingRequest(a)),
  );

  server.tool(
    "rebook_schedule",
    "Compute the next N rebook dates every K weeks after a last visit.",
    {
      last_visit: z.string().describe("Last visit YYYY-MM-DD"),
      every_weeks: z.number().optional().describe("Interval in weeks, 1-26, default 6"),
      count: z.number().optional().describe("How many dates, 1-12, default 4"),
    },
    { title: "Rebook schedule", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => rebookSchedule(a)),
  );

  server.tool(
    "appointment_reminders",
    "Compute reminder datetimes before an appointment start from lead times in hours.",
    {
      service: z.string().describe("Service booked"),
      starts_at: z.string().describe("Appointment start, ISO datetime"),
      lead_hours: z.array(z.number()).optional().describe("Lead times in hours, default [24, 2]"),
    },
    { title: "Appointment reminders", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => appointmentReminders(a)),
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

httpServer.listen(PORT, () => console.log(`SalonBook MCP on :${PORT} (POST /mcp, GET /health)`));
