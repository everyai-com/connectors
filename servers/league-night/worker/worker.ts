/** LeagueNight Worker - same engine, served directly. */
import { matchDayPlan, roundRobinSchedule, seasonPlan, standingsTable } from "../../mcp-server/src/leaguenight.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const ANNOT = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  if (t === "num" && typeof v !== "number") throw new Error(`'${k}' must be a number`);
  if (t === "arr" && !Array.isArray(v)) throw new Error(`'${k}' must be an array`);
  return v;
};

const TOOLS = [
  { name: "round_robin_schedule", title: "Round robin schedule",
    description: "Generate a round-robin fixture schedule for a set of teams. Use when needing a balanced, circular schedule. Avoid when needing a single matchday plan (use match_day_plan).",
    inputSchema: { type: "object", properties: {
      teams: { type: "array", items: { type: "string" }, description: "Team names (2 or more, unique)" },
      rounds: { type: "number", description: "Optional number of rounds to return (1..full schedule)" },
      second_leg: { type: "boolean", description: "Also schedule the reverse fixtures for a double round-robin" },
    }, required: ["teams"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "schedule": {
         "type": "array",
         "description": "List of rounds in the schedule",
         "items": {
          "type": "object",
          "properties": {
           "round": {
            "type": "number",
            "description": "The round number"
           },
           "matches": {
            "type": "array",
            "description": "List of matches in the round",
            "items": {
             "type": "object",
             "properties": {
              "home": {
               "type": "string",
               "description": "The home team name"
              },
              "away": {
               "type": "string",
               "description": "The away team name"
              }
             },
             "required": [
              "home",
              "away"
             ]
            }
           },
           "bye": {
            "type": "string",
            "description": "The team with a bye in this round (if any)"
           }
          },
          "required": [
           "round",
           "matches"
          ]
         }
        }
       },
       "required": [
        "schedule"
       ]
      },
    run: (a: A) => {
      req(a, "teams", "arr");
      return roundRobinSchedule(a as unknown as Parameters<typeof roundRobinSchedule>[0]);
    } },
  { name: "standings_table", title: "Standings table",
    description: "Generate a standings table from match results. Use when you need to rank teams based on their performance. Do NOT use when you need to plan future matches; use round_robin_schedule instead.",
    inputSchema: { type: "object", properties: {
      results: { type: "array", items: { type: "object", properties: { home: { type: "string" }, away: { type: "string" }, home_score: { type: "number" }, away_score: { type: "number" } }, required: ["home", "away", "home_score", "away_score"] }, description: "Match results in any order" },
      teams: { type: "array", items: { type: "string" }, description: "Full roster; results for teams outside it are skipped with a warning" },
      points_win: { type: "number", description: "Points for a win, default 3" },
      points_draw: { type: "number", description: "Points for a draw, default 1" },
    }, required: ["results"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "standings": {
         "type": "array",
         "description": "List of teams with their respective standings data",
         "items": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "description": "Name of the team"
           },
           "played": {
            "type": "number",
            "description": "Number of matches played by the team"
           },
           "wins": {
            "type": "number",
            "description": "Number of matches won by the team"
           },
           "draws": {
            "type": "number",
            "description": "Number of matches drawn by the team"
           },
           "losses": {
            "type": "number",
            "description": "Number of matches lost by the team"
           },
           "goals_for": {
            "type": "number",
            "description": "Total goals scored by the team"
           },
           "goals_against": {
            "type": "number",
            "description": "Total goals conceded by the team"
           },
           "goal_difference": {
            "type": "number",
            "description": "Difference between goals scored and conceded"
           },
           "points": {
            "type": "number",
            "description": "Total points accumulated by the team"
           }
          },
          "required": [
           "name",
           "played",
           "wins",
           "draws",
           "losses",
           "goals_for",
           "goals_against",
           "goal_difference",
           "points"
          ]
         }
        },
        "warnings": {
         "type": "array",
         "description": "List of warnings encountered during processing",
         "items": {
          "type": "string"
         }
        }
       },
       "required": [
        "standings"
       ]
      },
    run: (a: A) => {
      req(a, "results", "arr");
      return standingsTable(a as unknown as Parameters<typeof standingsTable>[0]);
    } },
  { name: "match_day_plan", title: "Match day plan",
    description: "Assign games to courts and time slots for a match day. Use when you need to schedule multiple games across several courts. Do NOT use when you need to generate a full season schedule, use season_plan.",
    inputSchema: { type: "object", properties: {
      games: { type: "array", items: { type: "object", properties: { home: { type: "string" }, away: { type: "string" } }, required: ["home", "away"] }, description: "Games in the order they should be played" },
      courts: { type: "number", description: "Courts available (1-12)" },
      slot_minutes: { type: "number", description: "Minutes per time slot (10-180)" },
      start_time: { type: "string", description: "First kick-off, 24h HH:MM" },
    }, required: ["games", "courts", "slot_minutes", "start_time"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "schedule": {
         "type": "array",
         "description": "List of scheduled games with their respective courts and times.",
         "items": {
          "type": "object",
          "properties": {
           "game_index": {
            "type": "integer",
            "description": "The index of the game in the input list."
           },
           "home": {
            "type": "string",
            "description": "The home team of the game."
           },
           "away": {
            "type": "string",
            "description": "The away team of the game."
           },
           "court": {
            "type": "integer",
            "description": "The court number where the game is scheduled."
           },
           "time": {
            "type": "string",
            "description": "The start time of the game in 24h HH:MM format."
           }
          },
          "required": [
           "game_index",
           "home",
           "away",
           "court",
           "time"
          ]
         }
        }
       },
       "required": [
        "schedule"
       ]
      },
    run: (a: A) => {
      req(a, "games", "arr"); req(a, "courts", "num"); req(a, "slot_minutes", "num"); req(a, "start_time", "str");
      return matchDayPlan(a as unknown as Parameters<typeof matchDayPlan>[0]);
    } },
  { name: "season_plan", title: "Season plan",
    description: "Plan a season end-to-end. Use when you need a full season overview. Do NOT use when you need to plan a single match day; use match_day_plan instead.",
    inputSchema: { type: "object", properties: {
      teams: { type: "array", items: { type: "string" }, description: "Team names (2 or more, unique)" },
      courts: { type: "number", description: "Courts available per match day (1-12)" },
      slot_minutes: { type: "number", description: "Minutes per time slot (10-180)" },
      start_date: { type: "string", description: "First match day, YYYY-MM-DD" },
      days_between_rounds: { type: "number", description: "Days between match days, default 7" },
      second_leg: { type: "boolean", description: "Plan a double round-robin (each pair meets twice)" },
    }, required: ["teams", "courts", "slot_minutes", "start_date"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "total_fixtures": {
         "type": "integer",
         "description": "Total number of matches in the season."
        },
        "games_per_match_day": {
         "type": "integer",
         "description": "Number of games scheduled per match day."
        },
        "match_days_needed": {
         "type": "integer",
         "description": "Total number of match days required to complete the season."
        },
        "start_date": {
         "type": "string",
         "format": "date",
         "description": "The start date of the season."
        },
        "estimated_finish_date": {
         "type": "string",
         "format": "date",
         "description": "The estimated finish date of the season."
        },
        "match_days": { description: "Array of match day plans, each with details for that day.",
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "date": {
            "type": "string",
            "format": "date",
            "description": "The date of the match day."
           },
           "matches": {
            "type": "array",
            "items": {
             "type": "object",
             "properties": {
              "team1": {
               "type": "string",
               "description": "The name of the first team."
              },
              "team2": {
               "type": "string",
               "description": "The name of the second team."
              },
              "time_slot": {
               "type": "string",
               "description": "The time slot for the match."
              }
             },
             "required": [
              "team1",
              "team2",
              "time_slot"
             ]
            }
           }
          },
          "required": [
           "date",
           "matches"
          ]
         }
        }
       },
       "required": [
        "total_fixtures",
        "games_per_match_day",
        "match_days_needed",
        "start_date",
        "estimated_finish_date",
        "match_days"
       ]
      },
    run: (a: A) => {
      req(a, "teams", "arr"); req(a, "courts", "num"); req(a, "slot_minutes", "num"); req(a, "start_date", "str");
      return seasonPlan(a as unknown as Parameters<typeof seasonPlan>[0]);
    } },
];

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
const cors = (request: Request) => {
  const origin = request.headers.get("origin");
  return { "Access-Control-Allow-Origin": origin || "*", Vary: "Origin" };
};
const KNOWN_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
function negotiateVersion(client: unknown): string {
  if (typeof client !== "string") return "2025-11-25";
  const eligible = KNOWN_VERSIONS.filter((v) => v <= client);
  return eligible.length > 0 ? eligible[eligible.length - 1] : KNOWN_VERSIONS[0];
}
const INSTRUCTIONS = "LeagueNight builds round-robin fixture lists, league standings tables, match-day plans and full season plans for sports league organizers. All maths only; nothing stored.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("LeagueNight", `<h1>LeagueNight</h1><p>Round-robin fixtures, standings tables, match-day plans and season planning for league organizers - served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - LeagueNight", `<h1>Privacy Policy - LeagueNight</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Team names, scores, dates and times you provide, and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute fixtures, standings, match-day plans and season schedules for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - LeagueNight", `<h1>Terms of Service - LeagueNight</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>LeagueNight performs scheduling arithmetic on the team names, scores and dates you provide and is not a league management, result-verification or payment service; it does not hold funds or guarantee any fixture is played.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results.</p>`),
  "/support": page("Support - LeagueNight", `<h1>Support - LeagueNight</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Fixtures, standings and dates"><title>LeagueNight — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;LeagueNight&quot;,&quot;url&quot;:&quot;https://league-night.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;EntertainmentApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Fixtures, standings and dates&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>LeagueNight</h1><p>LeagueNight saves league organizers the spreadsheet: build a round-robin fixture list for any set of teams (with byes for odd counts and an optional mirrored second leg), turn match results into a standings table sorted by points, goal difference and goals for, lay a match day across courts and fixed time slots, and plan a whole season from a start date to an estimated finish date. Pure arithmetic - no accounts, no sign-ups, nothing stored.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://league-night.magicteams.ai/mcp</code></p><p>Find <strong>LeagueNight</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>round_robin_schedule</code></td><td>Build a circle-method round-robin fixture schedule: every pair of teams meets once, or twice when second_leg is set. Odd team counts get one bye per round.</td></tr><tr><td><code>standings_table</code></td><td>Aggregate match results into a league table with played, wins, draws, losses, goals for/against, goal difference and points, sorted by points, then goal difference, then goals for, then name.</td></tr><tr><td><code>match_day_plan</code></td><td>Lay an ordered list of games onto a courts-by-slots time grid: game i goes to court (i mod courts) in slot (i div courts) and each slot is slot_minutes long, starting at start_time.</td></tr><tr><td><code>season_plan</code></td><td>Size a season end-to-end: total fixtures from the round-robin, games per match day given the courts available, match days needed, and the calendar dates from a start date to the estimated finish date.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# LeagueNight

> Fixtures, standings and dates

LeagueNight saves league organizers the spreadsheet: build a round-robin fixture list for any set of teams (with byes for odd counts and an optional mirrored second leg), turn match results into a standings table sorted by points, goal difference and goals for, lay a match day across courts and fixed time slots, and plan a whole season from a start date to an estimated finish date. Pure arithmetic - no accounts, no sign-ups, nothing stored.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://league-night.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "LeagueNight")
- Machine manifest: https://league-night.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://league-night.magicteams.ai/.well-known/ucp

## Tools

- round_robin_schedule: Round robin schedule — Build a circle-method round-robin fixture schedule: every pair of teams meets once, or twice when second_leg is set. Odd team counts get one bye per round.
- standings_table: Standings table — Aggregate match results into a league table with played, wins, draws, losses, goals for/against, goal difference and points, sorted by points, then goal difference, then goals for, then name.
- match_day_plan: Match day plan — Lay an ordered list of games onto a courts-by-slots time grid: game i goes to court (i mod courts) in slot (i div courts) and each slot is slot_minutes long, starting at start_time.
- season_plan: Season plan — Size a season end-to-end: total fixtures from the round-robin, games per match day given the courts available, match days needed, and the calendar dates from a start date to the estimated finish date.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://league-night.magicteams.ai/support
`;
const AGENT_ROBOTS = `# Generated by agent-surfaces.mjs (policy: max_visibility, per AIReady)
User-agent: *
Allow: /

# Allow every known AI bot
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: CCBot
Allow: /
User-agent: Meta-ExternalAgent
Allow: /
User-agent: Bytespider
Allow: /
User-agent: Amazonbot
Allow: /

Content-Signal: search=yes, ai-input=yes, ai-train=yes

Sitemap: https://league-night.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://league-night.magicteams.ai/</loc></url>
  <url><loc>https://league-night.magicteams.ai/privacy</loc></url>
  <url><loc>https://league-night.magicteams.ai/terms</loc></url>
  <url><loc>https://league-night.magicteams.ai/support</loc></url>
  <url><loc>https://league-night.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"LeagueNight","version":"1.0.0","description":"Fixtures, standings and dates","url":"https://league-night.magicteams.ai","mcp_endpoint":"https://league-night.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"round_robin_schedule","title":"Round robin schedule","description":"Build a circle-method round-robin fixture schedule: every pair of teams meets once, or twice when second_leg is set. Odd team counts get one bye per round."},{"name":"standings_table","title":"Standings table","description":"Aggregate match results into a league table with played, wins, draws, losses, goals for/against, goal difference and points, sorted by points, then goal difference, then goals for, then name."},{"name":"match_day_plan","title":"Match day plan","description":"Lay an ordered list of games onto a courts-by-slots time grid: game i goes to court (i mod courts) in slot (i div courts) and each slot is slot_minutes long, starting at start_time."},{"name":"season_plan","title":"Season plan","description":"Size a season end-to-end: total fixtures from the round-robin, games per match day given the courts available, match days needed, and the calendar dates from a start date to the estimated finish date."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/league-night","smithery":"https://smithery.ai/servers/tradephani/league-night"},"llms_txt":"https://league-night.magicteams.ai/llms.txt","ucp_profile":"https://league-night.magicteams.ai/.well-known/ucp","support":"https://league-night.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
function agentSurface(url: URL): Response | null {
  if (url.pathname === "/") return new Response(AGENT_HOME, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/llms.txt") return new Response(AGENT_LLMS, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (url.pathname === "/robots.txt") return new Response(AGENT_ROBOTS, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (url.pathname === "/sitemap.xml") return new Response(AGENT_SITEMAP, { headers: { "content-type": "application/xml; charset=utf-8" } });
  if (url.pathname === "/.well-known/ucp") return json(AGENT_UCP);
  if (url.pathname === "/.well-known/agent.json") return json(AGENT_MANIFEST);
  return null;
}
// ==== END AGENT SURFACES ====

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, tools: 4 });
    if (request.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
      if (!env.OPENAI_APPS_CHALLENGE_TOKEN) return new Response("not configured", { status: 404 });
      return new Response(env.OPENAI_APPS_CHALLENGE_TOKEN, { headers: { "content-type": "text/plain" } });
    }
    { const surface = agentSurface(url); if (surface) return surface; }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/privacy" || url.pathname === "/terms" || url.pathname === "/support"))
      return new Response(LEGAL_PAGES[url.pathname as "/" | "/privacy" | "/terms" | "/support"], { headers: { "content-type": "text/html; charset=utf-8" } });
    if (request.method === "OPTIONS" && (url.pathname === "/mcp" || url.pathname === "/mcp/"))
      return new Response(null, { status: 204, headers: { ...cors(request),
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
        "Access-Control-Max-Age": "86400" } });
    if (request.method === "GET" && (url.pathname === "/mcp" || url.pathname === "/mcp/")) {
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("SSE streams not supported; use POST with application/json",
          { status: 405, headers: { Allow: "POST", ...cors(request) } });
      return json({ name: "LeagueNight MCP", transport: "Streamable HTTP (JSON response profile)",
        tools: TOOLS.map((t) => t.name) }, 200, cors(request));
    }
    if (request.method === "DELETE" && (url.pathname === "/mcp" || url.pathname === "/mcp/"))
      return new Response("No sessions; use POST with application/json",
        { status: 405, headers: { Allow: "POST", ...cors(request) } });
    if ((url.pathname !== "/mcp" && url.pathname !== "/mcp/") || request.method !== "POST") return json({ error: "use POST /mcp, GET /health" }, 404);
    if (env.API_KEY && !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.API_KEY}`))
      return json({ error: "unauthorized" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "body too large" }, 413);
    const body = (await request.json()) as { id?: unknown; method?: string; params?: { name?: string; arguments?: A } };
    const id = body.id ?? null;
    if (body.method === undefined || body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (body.method === "ping") return json({ jsonrpc: "2.0", id, result: {} }, 200, cors(request));
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
      protocolVersion: negotiateVersion((body.params as unknown as { protocolVersion?: unknown })?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "league-night", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "league-night", version: VERSION } },
      instructions: INSTRUCTIONS,
      ttlMs: 3600000,
      cacheScope: "public",
    } }, 200, cors(request));
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: { ...ANNOT } })) } }, 200, cors(request));
    if (body.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === body.params?.name);
      if (!tool) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool '${body.params?.name}'` } }, 200, cors(request));
      try {
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(tool.run(body.params?.arguments ?? {})) }] } }, 200, cors(request));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool failed";
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: msg.startsWith("ERROR") ? msg : `ERROR ${msg}` }], isError: true } }, 200, cors(request));
      }
    }
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: `unsupported method '${body.method}'` } }, 200, cors(request));
  } catch { return json({ error: "bad request" }, 400); }
}

export default { async fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } } satisfies ExportedHandler<Env>;
