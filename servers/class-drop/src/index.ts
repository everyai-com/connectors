/**
 * ClassDrop MCP server - fitness class planning: schedule search, weekly
 * quotes, membership break-even, booking-request drafts, reminders and
 * balanced week plans. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildBookingRequest, classReminders, findClasses, membershipBreakEven, quoteWeek, weekPlan } from "./classdrop.js";

const PORT = Number(process.env.PORT ?? 3217);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Session = z.object({
  name: z.string().describe("Class name, e.g. 'Sunrise Spin'"),
  type: z.string().describe("One of cardio, strength, mobility, sport"),
  day: z.string().describe("Weekday, e.g. 'tuesday'"),
  start: z.string().describe("Start time HH:MM 24h, e.g. '18:30'"),
  duration_min: z.number().optional().describe("Duration in minutes, 15-180, default 60"),
  intensity: z.number().optional().describe("Intensity 1-5, default 3"),
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
    { name: "class-drop", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "ClassDrop plans fitness classes around a weekly schedule you provide: find classes " +
        "by day, type or intensity, quote a week of drop-ins, compute the membership " +
        "break-even, draft a booking request to send the studio, compute reminder times and " +
        "build a balanced week plan. Planning only: it never books anything and holds no " +
        "studio inventory. Pure computation; nothing stored.",
    },
  );

  server.tool(
    "find_classes",
    "Search a weekly class schedule by day, class type, max intensity or time window.",
    {
      schedule: z.array(Session).describe("Weekly schedule to search"),
      day: z.string().optional().describe("Filter to a weekday"),
      type: z.string().optional().describe("Filter to cardio, strength, mobility or sport"),
      intensity_max: z.number().optional().describe("Max intensity 1-5"),
      after: z.string().optional().describe("Only classes at or after HH:MM"),
      before: z.string().optional().describe("Only classes at or before HH:MM"),
    },
    { title: "Find classes", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => findClasses(a)),
  );

  server.tool(
    "quote_week",
    "Quote a week of classes at a drop-in rate: class count and week total.",
    {
      schedule: z.array(Session).describe("This week's classes"),
      drop_in_usd: z.number().describe("Drop-in price per class in USD"),
    },
    { title: "Quote week", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteWeek(a)),
  );

  server.tool(
    "membership_break_even",
    "Compute how many classes a month justify a membership over drop-ins, with an optional comparison at your volume.",
    {
      drop_in_usd: z.number().describe("Drop-in price per class in USD"),
      membership_usd: z.number().describe("Monthly membership price in USD"),
      classes_per_month: z.number().optional().describe("Your monthly volume for a direct comparison"),
    },
    { title: "Membership break-even", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => membershipBreakEven(a)),
  );

  server.tool(
    "build_booking_request",
    "Draft a booking-request message to send a studio: class, date, time, name and party size. Draft only, never sent.",
    {
      class_name: z.string().describe("Class to book"),
      date: z.string().describe("Date YYYY-MM-DD"),
      time: z.string().describe("Time HH:MM 24h"),
      name: z.string().describe("Your name"),
      party_size: z.number().optional().describe("Spots to reserve, 1-10, default 1"),
    },
    { title: "Build booking request", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildBookingRequest(a)),
  );

  server.tool(
    "class_reminders",
    "Compute reminder datetimes before each class start from lead times in hours.",
    {
      sessions: z.array(z.object({
        name: z.string().describe("Class name"),
        starts_at: z.string().describe("Class start, ISO datetime"),
      })).describe("Upcoming classes"),
      lead_hours: z.array(z.number()).optional().describe("Lead times in hours, default [12, 1]"),
    },
    { title: "Class reminders", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => classReminders(a)),
  );

  server.tool(
    "week_plan",
    "Build a balanced week plan from a schedule for a goal: balanced, cardio or strength, capped at N classes.",
    {
      schedule: z.array(Session).describe("Weekly schedule to plan from"),
      goal: z.string().optional().describe("balanced, cardio or strength; default balanced"),
      max_classes: z.number().optional().describe("Max classes, 1-14, default 5"),
    },
    { title: "Week plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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

httpServer.listen(PORT, () => console.log(`ClassDrop MCP on :${PORT} (POST /mcp, GET /health)`));
