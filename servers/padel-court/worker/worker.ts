/** PadelCourt Worker - same engine, served directly. */
import {
  findCourts, quoteSession, membershipBreakEven, buildBookingRequest, matchReminders, weekPlan,
} from "../../mcp-server/src/padelcourt.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }

const VERSION = "1.0.0";
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

type A = Record<string, unknown>;
const str = (v: unknown) => typeof v === "string";
const num = (v: unknown) => typeof v === "number";
const req = (a: A, k: string, t: "str" | "num") => {
  if (t === "str" && !str(a[k])) throw new Error(`ERROR ${k} must be a string.`);
  if (t === "num" && !num(a[k])) throw new Error(`ERROR ${k} must be a number.`);
};

const TOOLS = [
  { name: "find_courts", title: "Find courts",
    description: "Find padel clubs matching indoor, price and rating filters, ranked by rating, price and distance.",
    inputSchema: { type: "object", properties: {
      clubs: { type: "array", description: "Clubs to search", items: { type: "object" } },
      indoor_only: { type: "boolean", description: "Only indoor courts" },
      max_price: { type: "number", description: "Max price per hour in USD" },
      min_rating: { type: "number", description: "Min rating 1-5" } }, required: ["clubs"] },
    annot: RO,
    run: (a: A) => findCourts(a as unknown as Parameters<typeof findCourts>[0]) },
  { name: "quote_session", title: "Quote session",
    description: "Quote a padel session: hours, players and ball machine into a total plus per-player split.",
    inputSchema: { type: "object", properties: {
      price_per_hour: { type: "number", description: "Court price per hour in USD" },
      hours: { type: "number", description: "0.5, 1, 1.5 or 2; default 1" },
      players: { type: "number", description: "Players splitting, 2-8, default 4" },
      ball_machine: { type: "boolean", description: "Add $15 ball machine" } }, required: ["price_per_hour"] },
    annot: RO,
    run: (a: A) => { req(a, "price_per_hour", "num"); return quoteSession(a as unknown as Parameters<typeof quoteSession>[0]); } },
  { name: "membership_break_even", title: "Membership break-even",
    description: "Compute how many sessions a month justify a club membership over pay-as-you-go, with a verdict at your volume.",
    inputSchema: { type: "object", properties: {
      membership_monthly: { type: "number", description: "Monthly membership in USD" },
      payg_per_session: { type: "number", description: "Pay-as-you-go price per session in USD" },
      sessions_per_month: { type: "number", description: "Your monthly sessions" } }, required: ["membership_monthly", "payg_per_session", "sessions_per_month"] },
    annot: RO,
    run: (a: A) => { req(a, "membership_monthly", "num"); req(a, "payg_per_session", "num"); req(a, "sessions_per_month", "num"); return membershipBreakEven(a as unknown as Parameters<typeof membershipBreakEven>[0]); } },
  { name: "build_booking_request", title: "Build booking request",
    description: "Draft a booking-request message to send a club: club, date, time, name and players. Draft only, never sent.",
    inputSchema: { type: "object", properties: {
      club: { type: "string", description: "Club to book" },
      date: { type: "string", description: "Date YYYY-MM-DD" },
      time: { type: "string", description: "Time HH:MM 24h" },
      name: { type: "string", description: "Your name" },
      players: { type: "number", description: "Players, 2-8, default 4" } }, required: ["club", "date", "time", "name"] },
    annot: RO,
    run: (a: A) => { req(a, "club", "str"); req(a, "date", "str"); req(a, "time", "str"); req(a, "name", "str"); return buildBookingRequest(a as unknown as Parameters<typeof buildBookingRequest>[0]); } },
  { name: "match_reminders", title: "Match reminders",
    description: "Compute reminder datetimes before a match start from lead times in hours.",
    inputSchema: { type: "object", properties: {
      match: { type: "string", description: "Match booked" },
      starts_at: { type: "string", description: "Match start, ISO datetime" },
      lead_hours: { type: "array", description: "Lead times in hours, default [24, 2]", items: { type: "number" } } }, required: ["match", "starts_at"] },
    annot: RO,
    run: (a: A) => { req(a, "match", "str"); req(a, "starts_at", "str"); return matchReminders(a as unknown as Parameters<typeof matchReminders>[0]); } },
  { name: "week_plan", title: "Week plan",
    description: "Plan the most sessions a budget buys: cheapest-first picks with total and leftover.",
    inputSchema: { type: "object", properties: {
      budget: { type: "number", description: "Weekly budget in USD" },
      sessions: { type: "array", description: "Candidate sessions", items: { type: "object" } } }, required: ["budget", "sessions"] },
    annot: RO,
    run: (a: A) => { req(a, "budget", "num"); return weekPlan(a as unknown as Parameters<typeof weekPlan>[0]); } },
];

const INSTRUCTIONS = "PadelCourt plans padel sessions around clubs and prices you provide: find clubs by indoor, price and rating filters, quote sessions with per-player splits, compute the membership break-even, draft a booking request to send the club, compute match reminders and plan a week of sessions within budget. Planning only: it never books anything and holds no club inventory. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - PadelCourt</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("PadelCourt", "<p>Plan padel sessions - served over MCP at /mcp. Club finder, session quotes, membership math, week plans.</p>"),
  "/privacy": page("Privacy Policy", "<p>PadelCourt computes session plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>PadelCourt provides planning estimates for informational purposes. It never books courts or processes payments. Verify club prices before paying. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/support": page("Support", "<p>Questions or issues? Email support@magicteams.ai. Include the tool name and the input you sent. Operated by MagicTeams.</p>"),
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
    Vary: "Origin",
  };
}

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan padel sessions"><title>PadelCourt — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;PadelCourt&quot;,&quot;url&quot;:&quot;https://padel-court.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan padel sessions&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>PadelCourt</h1><p>PadelCourt plans padel sessions around clubs and prices you provide: find clubs by indoor, price and rating filters, quote sessions with per-player splits, compute the membership break-even, draft a booking request to send the club, compute match reminders and plan a week of sessions within budget. Planning only - it never books anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://padel-court.magicteams.ai/mcp</code></p><p>Find <strong>PadelCourt</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>find_courts</code></td><td>Find padel clubs matching indoor, price and rating filters, ranked by rating, price and distance.</td></tr><tr><td><code>quote_session</code></td><td>Quote a padel session: hours, players and ball machine into a total plus per-player split.</td></tr><tr><td><code>membership_break_even</code></td><td>Compute how many sessions a month justify a club membership over pay-as-you-go, with a verdict at your volume.</td></tr><tr><td><code>build_booking_request</code></td><td>Draft a booking-request message to send a club: club, date, time, name and players. Draft only, never sent.</td></tr><tr><td><code>match_reminders</code></td><td>Compute reminder datetimes before a match start from lead times in hours.</td></tr><tr><td><code>week_plan</code></td><td>Plan the most sessions a budget buys: cheapest-first picks with total and leftover.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# PadelCourt

> Plan padel sessions

PadelCourt plans padel sessions around clubs and prices you provide: find clubs by indoor, price and rating filters, quote sessions with per-player splits, compute the membership break-even, draft a booking request to send the club, compute match reminders and plan a week of sessions within budget. Planning only - it never books anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://padel-court.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "PadelCourt")
- Machine manifest: https://padel-court.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://padel-court.magicteams.ai/.well-known/ucp

## Tools

- find_courts: Find courts — Find padel clubs matching indoor, price and rating filters, ranked by rating, price and distance.
- quote_session: Quote session — Quote a padel session: hours, players and ball machine into a total plus per-player split.
- membership_break_even: Membership break-even — Compute how many sessions a month justify a club membership over pay-as-you-go, with a verdict at your volume.
- build_booking_request: Build booking request — Draft a booking-request message to send a club: club, date, time, name and players. Draft only, never sent.
- match_reminders: Match reminders — Compute reminder datetimes before a match start from lead times in hours.
- week_plan: Week plan — Plan the most sessions a budget buys: cheapest-first picks with total and leftover.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://padel-court.magicteams.ai/support
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

Sitemap: https://padel-court.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://padel-court.magicteams.ai/</loc></url>
  <url><loc>https://padel-court.magicteams.ai/privacy</loc></url>
  <url><loc>https://padel-court.magicteams.ai/terms</loc></url>
  <url><loc>https://padel-court.magicteams.ai/support</loc></url>
  <url><loc>https://padel-court.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"PadelCourt","version":"1.0.0","description":"Plan padel sessions","url":"https://padel-court.magicteams.ai","mcp_endpoint":"https://padel-court.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"find_courts","title":"Find courts","description":"Find padel clubs matching indoor, price and rating filters, ranked by rating, price and distance."},{"name":"quote_session","title":"Quote session","description":"Quote a padel session: hours, players and ball machine into a total plus per-player split."},{"name":"membership_break_even","title":"Membership break-even","description":"Compute how many sessions a month justify a club membership over pay-as-you-go, with a verdict at your volume."},{"name":"build_booking_request","title":"Build booking request","description":"Draft a booking-request message to send a club: club, date, time, name and players. Draft only, never sent."},{"name":"match_reminders","title":"Match reminders","description":"Compute reminder datetimes before a match start from lead times in hours."},{"name":"week_plan","title":"Week plan","description":"Plan the most sessions a budget buys: cheapest-first picks with total and leftover."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/padel-court","smithery":"https://smithery.ai/servers/tradephani/padel-court"},"llms_txt":"https://padel-court.magicteams.ai/llms.txt","ucp_profile":"https://padel-court.magicteams.ai/.well-known/ucp","support":"https://padel-court.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, tools: 6 });
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
        return new Response("event: endpoint\ndata: {}\n\n", { headers: { "content-type": "text/event-stream", ...cors(request) } });
      return json({ error: "use POST /mcp for JSON-RPC, or GET with Accept: text/event-stream" }, 405, cors(request));
    }
    if ((url.pathname !== "/mcp" && url.pathname !== "/mcp/") || request.method !== "POST")
      return json({ error: "use POST /mcp (MCP), GET /health" }, 404, cors(request));
    if (env.API_KEY) {
      const got = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
      if (!safeEqual(got, env.API_KEY)) return json({ error: "unauthorized" }, 401, { ...cors(request), "WWW-Authenticate": "Bearer" });
    }
    const body = await request.json() as { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: A } };
    const base: Record<string, string> = { ...cors(request), "content-type": "application/json" };
    if (body.method === "ping") return json({ jsonrpc: "2.0", id: body.id, result: {} }, 200, base);
    if (body.method === "initialize")
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "padel-court", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202, headers: base });
    if (body.method === "tools/list")
      return json({ jsonrpc: "2.0", id: body.id, result: { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annot })) } }, 200, base);
    if (body.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === body.params?.name);
      if (!tool) return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: `unknown tool '${body.params?.name}'` } }, 200, base);
      try {
        return json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(tool.run(body.params?.arguments ?? {})) }] } }, 200, base);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "computation failed";
        return json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: msg.startsWith("ERROR") ? msg : `ERROR ${msg}` }], isError: true } }, 200, base);
      }
    }
    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `unknown method '${body.method}'` } }, 200, base);
  } catch {
    return json({ error: "bad request" }, 400);
  }
}

export default { async fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } };
