/** StayTonight Worker - same engine, served directly. */
import {
  findStays, quoteNight, loyaltyBreakEven, buildBookingRequest, stayReminders, tripPlan,
} from "../../mcp-server/src/staytonight.js";

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
  { name: "find_stays", title: "Find stays",
    description: "Find hotels matching price, rating and amenity filters, ranked by rating, price and distance.",
    inputSchema: { type: "object", properties: {
      hotels: { type: "array", description: "Hotels to search", items: { type: "object" } },
      max_price: { type: "number", description: "Max nightly price in USD" },
      min_rating: { type: "number", description: "Min rating 1-5" },
      need_amenities: { type: "array", description: "Required amenities", items: { type: "string" } } }, required: ["hotels"] },
    annot: RO,
    run: (a: A) => findStays(a as unknown as Parameters<typeof findStays>[0]) },
  { name: "quote_night", title: "Quote night",
    description: "Quote a stay: room rate across nights plus taxes and fees into an all-in total.",
    inputSchema: { type: "object", properties: {
      room_price: { type: "number", description: "Room price per night in USD" },
      taxes_pct: { type: "number", description: "Tax percent 0-40, default 12" },
      fees: { type: "number", description: "Flat fees in USD, default 0" },
      nights: { type: "number", description: "Nights 1-30, default 1" } }, required: ["room_price"] },
    annot: RO,
    run: (a: A) => { req(a, "room_price", "num"); return quoteNight(a as unknown as Parameters<typeof quoteNight>[0]); } },
  { name: "loyalty_break_even", title: "Loyalty break-even",
    description: "Compute how many nights a year justify a hotel loyalty membership, with a verdict at your volume.",
    inputSchema: { type: "object", properties: {
      membership_yearly: { type: "number", description: "Yearly membership in USD" },
      member_discount_pct: { type: "number", description: "Member discount percent 0-90" },
      avg_night_price: { type: "number", description: "Average night price in USD" },
      nights_per_year: { type: "number", description: "Your yearly nights" } }, required: ["membership_yearly", "member_discount_pct", "avg_night_price", "nights_per_year"] },
    annot: RO,
    run: (a: A) => { req(a, "membership_yearly", "num"); req(a, "member_discount_pct", "num"); req(a, "avg_night_price", "num"); req(a, "nights_per_year", "num"); return loyaltyBreakEven(a as unknown as Parameters<typeof loyaltyBreakEven>[0]); } },
  { name: "build_booking_request", title: "Build booking request",
    description: "Draft a booking-request message to send a hotel: hotel, date, name, nights and guests. Draft only, never sent.",
    inputSchema: { type: "object", properties: {
      hotel: { type: "string", description: "Hotel to book" },
      date: { type: "string", description: "Check-in date YYYY-MM-DD" },
      name: { type: "string", description: "Your name" },
      nights: { type: "number", description: "Nights 1-30, default 1" },
      guests: { type: "number", description: "Guests 1-10, default 2" } }, required: ["hotel", "date", "name"] },
    annot: RO,
    run: (a: A) => { req(a, "hotel", "str"); req(a, "date", "str"); req(a, "name", "str"); return buildBookingRequest(a as unknown as Parameters<typeof buildBookingRequest>[0]); } },
  { name: "stay_reminders", title: "Stay reminders",
    description: "Compute reminder datetimes before check-in from lead times in hours.",
    inputSchema: { type: "object", properties: {
      stay: { type: "string", description: "Stay booked" },
      starts_at: { type: "string", description: "Check-in, ISO datetime" },
      lead_hours: { type: "array", description: "Lead times in hours, default [24, 2]", items: { type: "number" } } }, required: ["stay", "starts_at"] },
    annot: RO,
    run: (a: A) => { req(a, "stay", "str"); req(a, "starts_at", "str"); return stayReminders(a as unknown as Parameters<typeof stayReminders>[0]); } },
  { name: "trip_plan", title: "Trip plan",
    description: "Plan the most nights a budget buys: cheapest-first picks with total and leftover.",
    inputSchema: { type: "object", properties: {
      budget: { type: "number", description: "Trip budget in USD" },
      nights: { type: "array", description: "Candidate nights", items: { type: "object" } } }, required: ["budget", "nights"] },
    annot: RO,
    run: (a: A) => { req(a, "budget", "num"); return tripPlan(a as unknown as Parameters<typeof tripPlan>[0]); } },
];

const INSTRUCTIONS = "StayTonight plans tonight stays around hotels and prices you provide: find hotels by price, rating and amenity filters, quote nights with taxes and fees, compute the loyalty break-even, draft a booking request to send the hotel, compute stay reminders and plan a multi-night trip within budget. Planning only: it never books anything and holds no hotel inventory. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - StayTonight</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("StayTonight", "<p>Plan tonight stays - served over MCP at /mcp. Hotel finder, all-in quotes, loyalty math, trip plans.</p>"),
  "/privacy": page("Privacy Policy", "<p>StayTonight computes stay plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>StayTonight provides planning estimates for informational purposes. It never books rooms or processes payments. Verify hotel prices before paying. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan tonight stays"><title>StayTonight — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;StayTonight&quot;,&quot;url&quot;:&quot;https://stay-tonight.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan tonight stays&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>StayTonight</h1><p>StayTonight plans tonight stays around hotels and prices you provide: find hotels by price, rating and amenity filters, quote nights with taxes and fees, compute the loyalty break-even, draft a booking request to send the hotel, compute stay reminders and plan a multi-night trip within budget. Planning only - it never books anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://stay-tonight.magicteams.ai/mcp</code></p><p>Find <strong>StayTonight</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>find_stays</code></td><td>Find hotels matching price, rating and amenity filters, ranked by rating, price and distance.</td></tr><tr><td><code>quote_night</code></td><td>Quote a stay: room rate across nights plus taxes and fees into an all-in total.</td></tr><tr><td><code>loyalty_break_even</code></td><td>Compute how many nights a year justify a hotel loyalty membership, with a verdict at your volume.</td></tr><tr><td><code>build_booking_request</code></td><td>Draft a booking-request message to send a hotel: hotel, date, name, nights and guests. Draft only, never sent.</td></tr><tr><td><code>stay_reminders</code></td><td>Compute reminder datetimes before check-in from lead times in hours.</td></tr><tr><td><code>trip_plan</code></td><td>Plan the most nights a budget buys: cheapest-first picks with total and leftover.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# StayTonight

> Plan tonight stays

StayTonight plans tonight stays around hotels and prices you provide: find hotels by price, rating and amenity filters, quote nights with taxes and fees, compute the loyalty break-even, draft a booking request to send the hotel, compute stay reminders and plan a multi-night trip within budget. Planning only - it never books anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://stay-tonight.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "StayTonight")
- Machine manifest: https://stay-tonight.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://stay-tonight.magicteams.ai/.well-known/ucp

## Tools

- find_stays: Find stays — Find hotels matching price, rating and amenity filters, ranked by rating, price and distance.
- quote_night: Quote night — Quote a stay: room rate across nights plus taxes and fees into an all-in total.
- loyalty_break_even: Loyalty break-even — Compute how many nights a year justify a hotel loyalty membership, with a verdict at your volume.
- build_booking_request: Build booking request — Draft a booking-request message to send a hotel: hotel, date, name, nights and guests. Draft only, never sent.
- stay_reminders: Stay reminders — Compute reminder datetimes before check-in from lead times in hours.
- trip_plan: Trip plan — Plan the most nights a budget buys: cheapest-first picks with total and leftover.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://stay-tonight.magicteams.ai/support
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

Sitemap: https://stay-tonight.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://stay-tonight.magicteams.ai/</loc></url>
  <url><loc>https://stay-tonight.magicteams.ai/privacy</loc></url>
  <url><loc>https://stay-tonight.magicteams.ai/terms</loc></url>
  <url><loc>https://stay-tonight.magicteams.ai/support</loc></url>
  <url><loc>https://stay-tonight.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"StayTonight","version":"1.0.0","description":"Plan tonight stays","url":"https://stay-tonight.magicteams.ai","mcp_endpoint":"https://stay-tonight.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"find_stays","title":"Find stays","description":"Find hotels matching price, rating and amenity filters, ranked by rating, price and distance."},{"name":"quote_night","title":"Quote night","description":"Quote a stay: room rate across nights plus taxes and fees into an all-in total."},{"name":"loyalty_break_even","title":"Loyalty break-even","description":"Compute how many nights a year justify a hotel loyalty membership, with a verdict at your volume."},{"name":"build_booking_request","title":"Build booking request","description":"Draft a booking-request message to send a hotel: hotel, date, name, nights and guests. Draft only, never sent."},{"name":"stay_reminders","title":"Stay reminders","description":"Compute reminder datetimes before check-in from lead times in hours."},{"name":"trip_plan","title":"Trip plan","description":"Plan the most nights a budget buys: cheapest-first picks with total and leftover."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/stay-tonight","smithery":"https://smithery.ai/servers/tradephani/stay-tonight"},"llms_txt":"https://stay-tonight.magicteams.ai/llms.txt","ucp_profile":"https://stay-tonight.magicteams.ai/.well-known/ucp","support":"https://stay-tonight.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "stay-tonight", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
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
