/**
 * CourtSplit MCP server - fair cost splitting, settle-up, recurring series
 * accounting and rotation planning for sports courts and pickup games.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { rotationPlan, settleUp, splitCosts, splitSeries } from "./courtsplit.js";

const PORT = Number(process.env.PORT ?? 3007);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Participant = z.object({
  name: z.string().describe("Player name"),
  paid: z.number().optional().describe("Amount this player already paid (default 0)"),
});

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
    { name: "court-split", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "CourtSplit splits court, pitch or venue costs fairly, minimizes settle-up payments between players, " +
        "accounts for recurring sessions with rotating attendance, and plans fair play rotations. All maths only; nothing stored.",
    },
  );

  server.tool(
    "split_costs",
    "Split one total cost across players (equally or by relative weights) and show who owes what plus the fewest settle-up payments.",
    {
      total_cost: z.number().describe("Total court/venue cost"),
      participants: z.array(Participant).describe("Players in the split"),
      shares: z.array(z.number()).optional().describe("Optional relative weights, one per participant (e.g. [2,1,1])"),
      currency: z.string().optional().describe("Currency code for display, default USD"),
    },
    { title: "Split costs", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => splitCosts(a)),
  );

  server.tool(
    "settle_up",
    "Given who paid what for a total cost, compute balances and the minimal set of payments to settle everyone.",
    {
      total_cost: z.number().describe("Total cost that should be shared"),
      participants: z.array(Participant).describe("Players with what each paid"),
      shares: z.array(z.number()).optional().describe("Optional relative weights, one per participant"),
      currency: z.string().optional(),
    },
    { title: "Settle up", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => settleUp(a)),
  );

  server.tool(
    "split_series",
    "Account for recurring sessions where different players attend different days: each session splits only among its attendees; returns who owes what and settle-up payments.",
    {
      sessions: z.array(z.object({
        label: z.string().optional().describe("e.g. 'Tue 7pm'"),
        cost: z.number().describe("Cost of this session"),
        attendees: z.array(z.string()).describe("Names present this session"),
      })).describe("Sessions in order"),
      players: z.array(z.string()).optional().describe("Full roster (includes players who missed sessions)"),
      payments: z.array(Participant).optional().describe("Who already paid what (e.g. who fronted the court fees)"),
      currency: z.string().optional(),
    },
    { title: "Split series", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => splitSeries(a)),
  );

  server.tool(
    "rotation_plan",
    "Plan fair rotations for pickup games: who plays each round, who sits out, and games-played balance across the roster.",
    {
      players: z.array(z.string()).describe("Roster names"),
      capacity: z.number().describe("Players per court (2 singles, 4 doubles)"),
      courts: z.number().optional().describe("Number of courts, default 1"),
      rounds: z.number().describe("Rounds to schedule (1-50)"),
    },
    { title: "Rotation plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => rotationPlan(a)),
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

httpServer.listen(PORT, () => console.log(`CourtSplit MCP on :${PORT} (POST /mcp, GET /health)`));
