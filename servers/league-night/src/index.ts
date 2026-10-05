/**
 * LeagueNight MCP server - round-robin fixtures, standings tables, match-day
 * plans and season planning for sports league organizers.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { matchDayPlan, roundRobinSchedule, seasonPlan, standingsTable } from "./leaguenight.js";

const PORT = Number(process.env.PORT ?? 3010);
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
    { name: "league-night", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "LeagueNight builds round-robin fixture lists, league standings tables, match-day plans and full season plans for sports league organizers. " +
        "All maths only; nothing stored.",
    },
  );

  server.tool(
    "round_robin_schedule",
    "Build a circle-method round-robin fixture schedule: every pair of teams meets once, or twice when second_leg is set. Odd team counts get one bye per round.",
    {
      teams: z.array(z.string()).describe("Team names (2 or more, unique)"),
      rounds: z.number().optional().describe("Optional number of rounds to return (1..full schedule)"),
      second_leg: z.boolean().optional().describe("Also schedule the reverse fixtures for a double round-robin"),
    },
    { title: "Round robin schedule", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => roundRobinSchedule(a)),
  );

  server.tool(
    "standings_table",
    "Aggregate match results into a league table with played, wins, draws, losses, goals for/against, goal difference and points, sorted by points, then goal difference, then goals for, then name.",
    {
      results: z.array(z.object({
        home: z.string().describe("Home team name"),
        away: z.string().describe("Away team name"),
        home_score: z.number().describe("Home goals (non-negative integer)"),
        away_score: z.number().describe("Away goals (non-negative integer)"),
      })).describe("Match results in any order"),
      teams: z.array(z.string()).optional().describe("Full roster; results for teams outside it are skipped with a warning"),
      points_win: z.number().optional().describe("Points for a win, default 3"),
      points_draw: z.number().optional().describe("Points for a draw, default 1"),
    },
    { title: "Standings table", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => standingsTable(a)),
  );

  server.tool(
    "match_day_plan",
    "Lay an ordered list of games onto a courts-by-slots time grid: game i goes to court (i mod courts) in slot (i div courts) and each slot is slot_minutes long, starting at start_time.",
    {
      games: z.array(z.object({
        home: z.string().describe("Home team name"),
        away: z.string().describe("Away team name"),
      })).describe("Games in the order they should be played"),
      courts: z.number().describe("Courts available (1-12)"),
      slot_minutes: z.number().describe("Minutes per time slot (10-180)"),
      start_time: z.string().describe('First kick-off, 24h "HH:MM"'),
    },
    { title: "Match day plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => matchDayPlan(a)),
  );

  server.tool(
    "season_plan",
    "Size a season end-to-end: total fixtures from the round-robin, games per match day given the courts available, match days needed, and the calendar dates from a start date to the estimated finish date.",
    {
      teams: z.array(z.string()).describe("Team names (2 or more, unique)"),
      courts: z.number().describe("Courts available per match day (1-12)"),
      slot_minutes: z.number().describe("Minutes per time slot (10-180)"),
      start_date: z.string().describe('First match day, "YYYY-MM-DD"'),
      days_between_rounds: z.number().optional().describe("Days between match days, default 7"),
      second_leg: z.boolean().optional().describe("Plan a double round-robin (each pair meets twice)"),
    },
    { title: "Season plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => seasonPlan(a)),
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

httpServer.listen(PORT, () => console.log(`LeagueNight MCP on :${PORT} (POST /mcp, GET /health)`));
