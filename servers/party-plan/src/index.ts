/**
 * PartyPlan MCP server - party budget allocation, headcount and quantity
 * planning, a dated countdown timeline and venue-aware checklists.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { headcountPlan, partyBudget, partyChecklist, partyTimeline } from "./partyplan.js";

const PORT = Number(process.env.PORT ?? 3013);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

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
    { name: "party-plan", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "PartyPlan allocates a party budget across categories, turns an invite list into expected " +
        "attendance and shopping quantities, builds a dated countdown timeline, and prepares a " +
        "venue-aware checklist for home or venue parties. All maths only; nothing stored.",
    },
  );

  server.tool(
    "party_budget",
    "Allocate a party budget across venue, food and drink, cake, decorations, entertainment, favors and contingency, with per-guest spend and category tips. Use when planning what to spend before booking; style picks the split (budget, standard or premium).",
    {
      budget: z.number().describe("Total party budget in USD"),
      guests: z.number().describe("Number of guests (1-500)"),
      style: z.enum(["budget", "standard", "premium"]).optional().describe("Spending style, default standard"),
    },
    { title: "Party budget", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => partyBudget(a)),
  );

  server.tool(
    "headcount_plan",
    "Turn an invite list into expected attendance and shopping quantities: mains portions, drinks, cake slices, favors and plates with standard buffers. Use once RSVPs start arriving; attendance assumes adults only unless children_pct is given.",
    {
      invited: z.number().describe("People invited (1-1000)"),
      expected_decline_pct: z.number().optional().describe("Expected share who decline, 0-100 (default 15)"),
      children_pct: z.number().optional().describe("Share of attendees who are children, 0-100 (default 0)"),
    },
    { title: "Headcount plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => headcountPlan(a)),
  );

  server.tool(
    "party_timeline",
    "Build a countdown plan for a party date: dated milestones at T-42, T-28, T-21, T-14, T-7, T-3, T-1 days and the day itself, each with tasks covering venue, invitations, menu, cake, decorations, confirmations, setup and the day-of run sheet.",
    {
      event_date: z.string().describe("Party date in YYYY-MM-DD format"),
      event_type: z.string().optional().describe("Optional event label, e.g. 'birthday', 'bbq' or 'kids party'"),
      guests: z.number().optional().describe("Optional guest count for cake sizing"),
    },
    { title: "Party timeline", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => partyTimeline(a)),
  );

  server.tool(
    "party_checklist",
    "Build a checklist grouped by food and drink, decorations, music and activities, practical items and safety, tailored to a home or venue party. Optional extras keywords (pool, bbq, costume, outdoor, kids, alcohol, potluck) add specific items and safety notes.",
    {
      venue: z.enum(["home", "venue"]).describe("Where the party happens"),
      extras: z.array(z.string()).optional().describe("Optional keywords such as 'pool', 'bbq', 'costume', 'outdoor'"),
    },
    { title: "Party checklist", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => partyChecklist(a)),
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

httpServer.listen(PORT, () => console.log(`PartyPlan MCP on :${PORT} (POST /mcp, GET /health)`));
