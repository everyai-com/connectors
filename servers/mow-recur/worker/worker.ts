/** MowRecur Worker - same engine, served directly. */
import {
  mowSchedule, quoteSeason, compareProviders, buildServiceRequest, careCalendar, mowReminders,
} from "../../mcp-server/src/mowrecur.js";

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
  { name: "mow_schedule", title: "Mow schedule",
    description: "Compute mow dates across a season on a weekday, every 1-4 weeks.",
    inputSchema: { type: "object", properties: {
      season_start: { type: "string", description: "Season start YYYY-MM-DD" },
      season_end: { type: "string", description: "Season end YYYY-MM-DD" },
      weekday: { type: "string", description: "Mow weekday, default saturday" },
      every_weeks: { type: "number", description: "Interval 1-4 weeks, default 1" } }, required: ["season_start", "season_end"] },
    annot: RO,
    run: (a: A) => { req(a, "season_start", "str"); req(a, "season_end", "str"); return mowSchedule(a as unknown as Parameters<typeof mowSchedule>[0]); } },
  { name: "quote_season", title: "Quote season",
    description: "Quote a mowing season: cuts times price per cut plus optional extras like fertilizing.",
    inputSchema: { type: "object", properties: {
      cuts: { type: "number", description: "Number of cuts, 1-60" },
      price_per_cut: { type: "number", description: "Price per cut in USD" },
      extras: { type: "array", description: "One-off extras", items: { type: "object" } } }, required: ["cuts", "price_per_cut"] },
    annot: RO,
    run: (a: A) => { req(a, "cuts", "num"); req(a, "price_per_cut", "num"); return quoteSeason(a as unknown as Parameters<typeof quoteSeason>[0]); } },
  { name: "compare_providers", title: "Compare providers",
    description: "Rank 2-6 lawn providers from your price, rating and visit numbers: 50% rating, 50% monthly cost.",
    inputSchema: { type: "object", properties: {
      providers: { type: "array", description: "Providers to compare", items: { type: "object" } } }, required: ["providers"] },
    annot: RO,
    run: (a: A) => compareProviders(a as unknown as Parameters<typeof compareProviders>[0]) },
  { name: "build_service_request", title: "Build service request",
    description: "Draft a service-request message to send a lawn provider: service, start date, frequency and name. Draft only, never sent.",
    inputSchema: { type: "object", properties: {
      service: { type: "string", description: "Service wanted" },
      start_date: { type: "string", description: "Start date YYYY-MM-DD" },
      frequency: { type: "string", description: "Frequency, e.g. 'weekly'" },
      name: { type: "string", description: "Your name" },
      phone: { type: "string", description: "Callback number" },
      lot_size: { type: "string", description: "Lot size, e.g. 'quarter acre'" } }, required: ["service", "start_date", "frequency", "name"] },
    annot: RO,
    run: (a: A) => { req(a, "service", "str"); req(a, "start_date", "str"); req(a, "frequency", "str"); req(a, "name", "str"); return buildServiceRequest(a as unknown as Parameters<typeof buildServiceRequest>[0]); } },
  { name: "care_calendar", title: "Care calendar",
    description: "Get the annual lawn-care calendar for cool-season (fescue) or warm-season (bermuda) grass.",
    inputSchema: { type: "object", properties: {
      grass: { type: "string", description: "'cool' or 'warm'" } }, required: ["grass"] },
    annot: RO,
    run: (a: A) => { req(a, "grass", "str"); return careCalendar(a as unknown as Parameters<typeof careCalendar>[0]); } },
  { name: "mow_reminders", title: "Mow reminders",
    description: "Compute reminder datetimes before each mow date, assuming a 9am mow.",
    inputSchema: { type: "object", properties: {
      mow_dates: { type: "array", description: "Mow dates YYYY-MM-DD, up to 12", items: { type: "string" } },
      lead_hours: { type: "array", description: "Lead times in hours, default [24, 2]", items: { type: "number" } } }, required: ["mow_dates"] },
    annot: RO,
    run: (a: A) => mowReminders(a as unknown as Parameters<typeof mowReminders>[0]) },
];

const INSTRUCTIONS = "MowRecur plans recurring lawn care: mow dates across a season, seasonal cost quotes, provider comparison on your numbers, service-request drafts to send a provider, annual care calendars for cool or warm grass, and mow reminders. Planning only: it never books anything. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - MowRecur</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("MowRecur", "<p>Plan recurring lawn care - served over MCP at /mcp. Mow schedules, season quotes, care calendars, reminders.</p>"),
  "/privacy": page("Privacy Policy", "<p>MowRecur computes lawn plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>MowRecur provides planning estimates for informational purposes. It never books service or processes payments. Verify provider rates before paying. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan recurring lawn care"><title>MowRecur — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;MowRecur&quot;,&quot;url&quot;:&quot;https://mow-recur.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan recurring lawn care&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>MowRecur</h1><p>MowRecur plans recurring lawn care: mow dates across a season on your weekday, seasonal cost quotes with extras, provider comparison on your own numbers, service-request drafts to send a provider, annual care calendars for cool or warm grass, and mow reminders. Planning only - it never books anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://mow-recur.magicteams.ai/mcp</code></p><p>Find <strong>MowRecur</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>mow_schedule</code></td><td>Compute mow dates across a season on a weekday, every 1-4 weeks.</td></tr><tr><td><code>quote_season</code></td><td>Quote a mowing season: cuts times price per cut plus optional extras like fertilizing.</td></tr><tr><td><code>compare_providers</code></td><td>Rank 2-6 lawn providers from your price, rating and visit numbers: 50% rating, 50% monthly cost.</td></tr><tr><td><code>build_service_request</code></td><td>Draft a service-request message to send a lawn provider: service, start date, frequency and name. Draft only, never sent.</td></tr><tr><td><code>care_calendar</code></td><td>Get the annual lawn-care calendar for cool-season (fescue) or warm-season (bermuda) grass.</td></tr><tr><td><code>mow_reminders</code></td><td>Compute reminder datetimes before each mow date, assuming a 9am mow.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# MowRecur

> Plan recurring lawn care

MowRecur plans recurring lawn care: mow dates across a season on your weekday, seasonal cost quotes with extras, provider comparison on your own numbers, service-request drafts to send a provider, annual care calendars for cool or warm grass, and mow reminders. Planning only - it never books anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://mow-recur.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "MowRecur")
- Machine manifest: https://mow-recur.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://mow-recur.magicteams.ai/.well-known/ucp

## Tools

- mow_schedule: Mow schedule — Compute mow dates across a season on a weekday, every 1-4 weeks.
- quote_season: Quote season — Quote a mowing season: cuts times price per cut plus optional extras like fertilizing.
- compare_providers: Compare providers — Rank 2-6 lawn providers from your price, rating and visit numbers: 50% rating, 50% monthly cost.
- build_service_request: Build service request — Draft a service-request message to send a lawn provider: service, start date, frequency and name. Draft only, never sent.
- care_calendar: Care calendar — Get the annual lawn-care calendar for cool-season (fescue) or warm-season (bermuda) grass.
- mow_reminders: Mow reminders — Compute reminder datetimes before each mow date, assuming a 9am mow.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://mow-recur.magicteams.ai/support
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

Sitemap: https://mow-recur.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mow-recur.magicteams.ai/</loc></url>
  <url><loc>https://mow-recur.magicteams.ai/privacy</loc></url>
  <url><loc>https://mow-recur.magicteams.ai/terms</loc></url>
  <url><loc>https://mow-recur.magicteams.ai/support</loc></url>
  <url><loc>https://mow-recur.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"MowRecur","version":"1.0.0","description":"Plan recurring lawn care","url":"https://mow-recur.magicteams.ai","mcp_endpoint":"https://mow-recur.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"mow_schedule","title":"Mow schedule","description":"Compute mow dates across a season on a weekday, every 1-4 weeks."},{"name":"quote_season","title":"Quote season","description":"Quote a mowing season: cuts times price per cut plus optional extras like fertilizing."},{"name":"compare_providers","title":"Compare providers","description":"Rank 2-6 lawn providers from your price, rating and visit numbers: 50% rating, 50% monthly cost."},{"name":"build_service_request","title":"Build service request","description":"Draft a service-request message to send a lawn provider: service, start date, frequency and name. Draft only, never sent."},{"name":"care_calendar","title":"Care calendar","description":"Get the annual lawn-care calendar for cool-season (fescue) or warm-season (bermuda) grass."},{"name":"mow_reminders","title":"Mow reminders","description":"Compute reminder datetimes before each mow date, assuming a 9am mow."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/mow-recur","smithery":"https://smithery.ai/servers/tradephani/mow-recur"},"llms_txt":"https://mow-recur.magicteams.ai/llms.txt","ucp_profile":"https://mow-recur.magicteams.ai/.well-known/ucp","support":"https://mow-recur.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
  if (url.pathname === "/mcp/") url.pathname = "/mcp"; // Rule 19: trailing slash byte-identical
  try {
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, tools: 6 });
    if (request.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
      if (!env.OPENAI_APPS_CHALLENGE_TOKEN) return new Response("not configured", { status: 404 });
      return new Response(env.OPENAI_APPS_CHALLENGE_TOKEN, { headers: { "content-type": "text/plain" } });
    }
    { const surface = agentSurface(url); if (surface) return surface; }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/privacy" || url.pathname === "/terms" || url.pathname === "/support"))
      return new Response(LEGAL_PAGES[url.pathname as "/" | "/privacy" | "/terms" | "/support"], { headers: { "content-type": "text/html; charset=utf-8" } });
    if (request.method === "OPTIONS" && url.pathname === "/mcp")
      return new Response(null, { status: 204, headers: { ...cors(request),
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
        "Access-Control-Max-Age": "86400" } });
    if (request.method === "GET" && url.pathname === "/mcp") {
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("event: endpoint\ndata: {}\n\n", { headers: { "content-type": "text/event-stream", ...cors(request) } });
      return json({ error: "use POST /mcp for JSON-RPC, or GET with Accept: text/event-stream" }, 405, cors(request));
    }
    if (url.pathname !== "/mcp" || request.method !== "POST")
      return json({ error: "use POST /mcp (MCP), GET /health" }, 404, cors(request));
    if (env.API_KEY) {
      const got = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
      if (!safeEqual(got, env.API_KEY)) return json({ error: "unauthorized" }, 401, { ...cors(request), "WWW-Authenticate": "Bearer" });
    }
    const body = await request.json() as { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: A } };
    const base: Record<string, string> = { ...cors(request), "content-type": "application/json" };
    if (body.method === "initialize")
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "mow-recur", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202, headers: base });
    if (body.method === "tools/list")
      return json({ jsonrpc: "2.0", id: body.id, result: { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annot })) } }, 200, base);
    if (body.method === "ping")
      return json({ jsonrpc: "2.0", id: body.id, result: {} }, 200, base);
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
