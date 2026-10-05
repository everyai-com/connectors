/** SalonBook Worker - same engine, served directly. */
import {
  findSlots, quoteService, compareSalons, buildBookingRequest, rebookSchedule, appointmentReminders,
} from "../../mcp-server/src/salonbook.js";

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
  { name: "find_slots", title: "Find slots",
    description: "Find open start times in availability windows that fit a service length, every 30 minutes.",
    inputSchema: { type: "object", properties: {
      availability: { type: "array", description: "Salon availability windows", items: { type: "object" } },
      day: { type: "string", description: "Filter to a weekday" },
      duration_min: { type: "number", description: "Service length in minutes, 15-240, default 60" },
      after: { type: "string", description: "Only slots ending after HH:MM" },
      before: { type: "string", description: "Only slots starting before HH:MM" } }, required: ["availability"] },
    annot: RO,
    run: (a: A) => findSlots(a as unknown as Parameters<typeof findSlots>[0]) },
  { name: "quote_service", title: "Quote service",
    description: "Quote a service with add-ons from a salon menu: line items, total price and total minutes.",
    inputSchema: { type: "object", properties: {
      menu: { type: "array", description: "Salon service menu", items: { type: "object" } },
      service: { type: "string", description: "Service to quote" },
      add_ons: { type: "array", description: "Add-on service names", items: { type: "string" } } }, required: ["menu", "service"] },
    annot: RO,
    run: (a: A) => { req(a, "service", "str"); return quoteService(a as unknown as Parameters<typeof quoteService>[0]); } },
  { name: "compare_salons", title: "Compare salons",
    description: "Rank 2-6 salons from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.",
    inputSchema: { type: "object", properties: {
      salons: { type: "array", description: "Salons to compare", items: { type: "object" } } }, required: ["salons"] },
    annot: RO,
    run: (a: A) => compareSalons(a as unknown as Parameters<typeof compareSalons>[0]) },
  { name: "build_booking_request", title: "Build booking request",
    description: "Draft a booking-request message to send a salon: service, date, time, name and party size. Draft only, never sent.",
    inputSchema: { type: "object", properties: {
      service: { type: "string", description: "Service to book" },
      date: { type: "string", description: "Date YYYY-MM-DD" },
      time: { type: "string", description: "Time HH:MM 24h" },
      name: { type: "string", description: "Your name" },
      phone: { type: "string", description: "Callback number" },
      party_size: { type: "number", description: "People, 1-6, default 1" } }, required: ["service", "date", "time", "name"] },
    annot: RO,
    run: (a: A) => { req(a, "service", "str"); req(a, "date", "str"); req(a, "time", "str"); req(a, "name", "str"); return buildBookingRequest(a as unknown as Parameters<typeof buildBookingRequest>[0]); } },
  { name: "rebook_schedule", title: "Rebook schedule",
    description: "Compute the next N rebook dates every K weeks after a last visit.",
    inputSchema: { type: "object", properties: {
      last_visit: { type: "string", description: "Last visit YYYY-MM-DD" },
      every_weeks: { type: "number", description: "Interval in weeks, 1-26, default 6" },
      count: { type: "number", description: "How many dates, 1-12, default 4" } }, required: ["last_visit"] },
    annot: RO,
    run: (a: A) => { req(a, "last_visit", "str"); return rebookSchedule(a as unknown as Parameters<typeof rebookSchedule>[0]); } },
  { name: "appointment_reminders", title: "Appointment reminders",
    description: "Compute reminder datetimes before an appointment start from lead times in hours.",
    inputSchema: { type: "object", properties: {
      service: { type: "string", description: "Service booked" },
      starts_at: { type: "string", description: "Appointment start, ISO datetime" },
      lead_hours: { type: "array", description: "Lead times in hours, default [24, 2]", items: { type: "number" } } }, required: ["service", "starts_at"] },
    annot: RO,
    run: (a: A) => { req(a, "service", "str"); req(a, "starts_at", "str"); return appointmentReminders(a as unknown as Parameters<typeof appointmentReminders>[0]); } },
];

const INSTRUCTIONS = "SalonBook plans salon visits around availability and menus you provide: find open slots that fit a service length, quote services with add-ons, compare salons on your own price, rating and distance numbers, draft a booking request to send the salon, compute rebook dates and reminder times. Planning only: it never books anything and holds no salon inventory. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - SalonBook</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("SalonBook", "<p>Plan salon visits - served over MCP at /mcp. Slot finder, service quotes, salon compare, rebook dates.</p>"),
  "/privacy": page("Privacy Policy", "<p>SalonBook computes visit plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>SalonBook provides planning estimates for informational purposes. It never books visits or processes payments. Verify salon prices and availability before paying. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan salon visits"><title>SalonBook — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;SalonBook&quot;,&quot;url&quot;:&quot;https://salon-book.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan salon visits&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>SalonBook</h1><p>SalonBook plans salon visits around availability and menus you provide: find open slots that fit a service length, quote services with add-ons, compare salons on your own price, rating and distance numbers, draft a booking request to send the salon, compute rebook dates and reminder times. Planning only - it never books anything and holds no salon inventory.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://salon-book.magicteams.ai/mcp</code></p><p>Find <strong>SalonBook</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>find_slots</code></td><td>Find open start times in availability windows that fit a service length, every 30 minutes.</td></tr><tr><td><code>quote_service</code></td><td>Quote a service with add-ons from a salon menu: line items, total price and total minutes.</td></tr><tr><td><code>compare_salons</code></td><td>Rank 2-6 salons from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.</td></tr><tr><td><code>build_booking_request</code></td><td>Draft a booking-request message to send a salon: service, date, time, name and party size. Draft only, never sent.</td></tr><tr><td><code>rebook_schedule</code></td><td>Compute the next N rebook dates every K weeks after a last visit.</td></tr><tr><td><code>appointment_reminders</code></td><td>Compute reminder datetimes before an appointment start from lead times in hours.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# SalonBook

> Plan salon visits

SalonBook plans salon visits around availability and menus you provide: find open slots that fit a service length, quote services with add-ons, compare salons on your own price, rating and distance numbers, draft a booking request to send the salon, compute rebook dates and reminder times. Planning only - it never books anything and holds no salon inventory.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://salon-book.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "SalonBook")
- Machine manifest: https://salon-book.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://salon-book.magicteams.ai/.well-known/ucp

## Tools

- find_slots: Find slots — Find open start times in availability windows that fit a service length, every 30 minutes.
- quote_service: Quote service — Quote a service with add-ons from a salon menu: line items, total price and total minutes.
- compare_salons: Compare salons — Rank 2-6 salons from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.
- build_booking_request: Build booking request — Draft a booking-request message to send a salon: service, date, time, name and party size. Draft only, never sent.
- rebook_schedule: Rebook schedule — Compute the next N rebook dates every K weeks after a last visit.
- appointment_reminders: Appointment reminders — Compute reminder datetimes before an appointment start from lead times in hours.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://salon-book.magicteams.ai/support
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

Sitemap: https://salon-book.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://salon-book.magicteams.ai/</loc></url>
  <url><loc>https://salon-book.magicteams.ai/privacy</loc></url>
  <url><loc>https://salon-book.magicteams.ai/terms</loc></url>
  <url><loc>https://salon-book.magicteams.ai/support</loc></url>
  <url><loc>https://salon-book.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"SalonBook","version":"1.0.0","description":"Plan salon visits","url":"https://salon-book.magicteams.ai","mcp_endpoint":"https://salon-book.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"find_slots","title":"Find slots","description":"Find open start times in availability windows that fit a service length, every 30 minutes."},{"name":"quote_service","title":"Quote service","description":"Quote a service with add-ons from a salon menu: line items, total price and total minutes."},{"name":"compare_salons","title":"Compare salons","description":"Rank 2-6 salons from your price, rating and distance numbers: 50% rating, 30% price, 20% distance."},{"name":"build_booking_request","title":"Build booking request","description":"Draft a booking-request message to send a salon: service, date, time, name and party size. Draft only, never sent."},{"name":"rebook_schedule","title":"Rebook schedule","description":"Compute the next N rebook dates every K weeks after a last visit."},{"name":"appointment_reminders","title":"Appointment reminders","description":"Compute reminder datetimes before an appointment start from lead times in hours."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/salon-book","smithery":"https://smithery.ai/servers/tradephani/salon-book"},"llms_txt":"https://salon-book.magicteams.ai/llms.txt","ucp_profile":"https://salon-book.magicteams.ai/.well-known/ucp","support":"https://salon-book.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "salon-book", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
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
