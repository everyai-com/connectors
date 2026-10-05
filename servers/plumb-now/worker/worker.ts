/** PlumbNow Worker - same engine, served directly. */
import {
  diagnoseIssue, findSlots, quoteJob, comparePlumbers, buildDispatchRequest, maintenancePlan,
} from "../../mcp-server/src/plumbnow.js";

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
  { name: "diagnose_issue", title: "Diagnose issue",
    description: "Diagnose a plumbing issue: likely causes, severity (emergency/same_day/routine), shutoff steps and whether to call a pro.",
    inputSchema: { type: "object", properties: {
      symptom: { type: "string", description: "leak, burst_pipe, clog, no_hot_water, low_pressure, running_toilet or sewer_smell" },
      details: { type: "string", description: "Extra details from the caller" } }, required: ["symptom"] },
    annot: RO,
    run: (a: A) => { req(a, "symptom", "str"); return diagnoseIssue(a as unknown as Parameters<typeof diagnoseIssue>[0]); } },
  { name: "find_slots", title: "Find slots",
    description: "Find open start times in availability windows that fit a job length, every 30 minutes.",
    inputSchema: { type: "object", properties: {
      availability: { type: "array", description: "Plumber availability windows", items: { type: "object" } },
      day: { type: "string", description: "Filter to a weekday" },
      duration_min: { type: "number", description: "Job length in minutes, 15-240, default 60" },
      after: { type: "string", description: "Only slots ending after HH:MM" },
      before: { type: "string", description: "Only slots starting before HH:MM" } }, required: ["availability"] },
    annot: RO,
    run: (a: A) => findSlots(a as unknown as Parameters<typeof findSlots>[0]) },
  { name: "quote_job", title: "Quote job",
    description: "Quote a plumbing job with add-ons from a pricebook: line items, total price and total minutes.",
    inputSchema: { type: "object", properties: {
      pricebook: { type: "array", description: "Plumber pricebook", items: { type: "object" } },
      job: { type: "string", description: "Job to quote" },
      add_ons: { type: "array", description: "Add-on job names", items: { type: "string" } } }, required: ["pricebook", "job"] },
    annot: RO,
    run: (a: A) => { req(a, "job", "str"); return quoteJob(a as unknown as Parameters<typeof quoteJob>[0]); } },
  { name: "compare_plumbers", title: "Compare plumbers",
    description: "Rank 2-6 plumbers from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.",
    inputSchema: { type: "object", properties: {
      plumbers: { type: "array", description: "Plumbers to compare", items: { type: "object" } } }, required: ["plumbers"] },
    annot: RO,
    run: (a: A) => comparePlumbers(a as unknown as Parameters<typeof comparePlumbers>[0]) },
  { name: "build_dispatch_request", title: "Build dispatch request",
    description: "Draft a dispatch-request message to send a plumber: job, date, time, name and units. Draft only, never sent.",
    inputSchema: { type: "object", properties: {
      job: { type: "string", description: "Job needed" },
      date: { type: "string", description: "Date YYYY-MM-DD" },
      time: { type: "string", description: "Time HH:MM 24h" },
      name: { type: "string", description: "Your name" },
      phone: { type: "string", description: "Callback number" },
      units: { type: "number", description: "Units, 1-10, default 1" } }, required: ["job", "date", "time", "name"] },
    annot: RO,
    run: (a: A) => { req(a, "job", "str"); req(a, "date", "str"); req(a, "time", "str"); req(a, "name", "str"); return buildDispatchRequest(a as unknown as Parameters<typeof buildDispatchRequest>[0]); } },
  { name: "maintenance_plan", title: "Maintenance plan",
    description: "Compute the next N plumbing checkup dates every K months after a last visit.",
    inputSchema: { type: "object", properties: {
      last_visit: { type: "string", description: "Last visit YYYY-MM-DD" },
      every_months: { type: "number", description: "Interval in months, 1-24, default 12" },
      count: { type: "number", description: "How many dates, 1-12, default 2" } }, required: ["last_visit"] },
    annot: RO,
    run: (a: A) => { req(a, "last_visit", "str"); return maintenancePlan(a as unknown as Parameters<typeof maintenancePlan>[0]); } },
];

const INSTRUCTIONS = "PlumbNow plans plumbing visits around symptoms and pricebooks you provide: diagnose issues with severity and shutoff steps, find open slots for a job length, quote jobs with add-ons, compare plumbers on your own price, rating and distance numbers, draft a dispatch request to send the plumber, and plan maintenance checkups. Planning only: it never books anything and holds no plumber inventory. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - PlumbNow</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("PlumbNow", "<p>Plan plumbing visits - served over MCP at /mcp. Issue diagnosis, slot finder, job quotes, plumber compare.</p>"),
  "/privacy": page("Privacy Policy", "<p>PlumbNow computes visit plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>PlumbNow provides planning estimates for informational purposes. It never books visits or processes payments. Emergencies (burst pipes, gas): call local emergency services first. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan plumbing visits"><title>PlumbNow — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;PlumbNow&quot;,&quot;url&quot;:&quot;https://plumb-now.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan plumbing visits&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>PlumbNow</h1><p>PlumbNow plans plumbing visits around symptoms and pricebooks you provide: diagnose issues with severity and shutoff steps, find open slots for a job length, quote jobs with add-ons, compare plumbers on your price, rating and distance numbers, draft a dispatch request to send the plumber, and plan maintenance checkups. Planning only - it never books anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://plumb-now.magicteams.ai/mcp</code></p><p>Find <strong>PlumbNow</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>diagnose_issue</code></td><td>Diagnose a plumbing issue: likely causes, severity (emergency/same_day/routine), shutoff steps and whether to call a pro.</td></tr><tr><td><code>find_slots</code></td><td>Find open start times in availability windows that fit a job length, every 30 minutes.</td></tr><tr><td><code>quote_job</code></td><td>Quote a plumbing job with add-ons from a pricebook: line items, total price and total minutes.</td></tr><tr><td><code>compare_plumbers</code></td><td>Rank 2-6 plumbers from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.</td></tr><tr><td><code>build_dispatch_request</code></td><td>Draft a dispatch-request message to send a plumber: job, date, time, name and units. Draft only, never sent.</td></tr><tr><td><code>maintenance_plan</code></td><td>Compute the next N plumbing checkup dates every K months after a last visit.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# PlumbNow

> Plan plumbing visits

PlumbNow plans plumbing visits around symptoms and pricebooks you provide: diagnose issues with severity and shutoff steps, find open slots for a job length, quote jobs with add-ons, compare plumbers on your price, rating and distance numbers, draft a dispatch request to send the plumber, and plan maintenance checkups. Planning only - it never books anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://plumb-now.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "PlumbNow")
- Machine manifest: https://plumb-now.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://plumb-now.magicteams.ai/.well-known/ucp

## Tools

- diagnose_issue: Diagnose issue — Diagnose a plumbing issue: likely causes, severity (emergency/same_day/routine), shutoff steps and whether to call a pro.
- find_slots: Find slots — Find open start times in availability windows that fit a job length, every 30 minutes.
- quote_job: Quote job — Quote a plumbing job with add-ons from a pricebook: line items, total price and total minutes.
- compare_plumbers: Compare plumbers — Rank 2-6 plumbers from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.
- build_dispatch_request: Build dispatch request — Draft a dispatch-request message to send a plumber: job, date, time, name and units. Draft only, never sent.
- maintenance_plan: Maintenance plan — Compute the next N plumbing checkup dates every K months after a last visit.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://plumb-now.magicteams.ai/support
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

Sitemap: https://plumb-now.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://plumb-now.magicteams.ai/</loc></url>
  <url><loc>https://plumb-now.magicteams.ai/privacy</loc></url>
  <url><loc>https://plumb-now.magicteams.ai/terms</loc></url>
  <url><loc>https://plumb-now.magicteams.ai/support</loc></url>
  <url><loc>https://plumb-now.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"PlumbNow","version":"1.0.0","description":"Plan plumbing visits","url":"https://plumb-now.magicteams.ai","mcp_endpoint":"https://plumb-now.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"diagnose_issue","title":"Diagnose issue","description":"Diagnose a plumbing issue: likely causes, severity (emergency/same_day/routine), shutoff steps and whether to call a pro."},{"name":"find_slots","title":"Find slots","description":"Find open start times in availability windows that fit a job length, every 30 minutes."},{"name":"quote_job","title":"Quote job","description":"Quote a plumbing job with add-ons from a pricebook: line items, total price and total minutes."},{"name":"compare_plumbers","title":"Compare plumbers","description":"Rank 2-6 plumbers from your price, rating and distance numbers: 50% rating, 30% price, 20% distance."},{"name":"build_dispatch_request","title":"Build dispatch request","description":"Draft a dispatch-request message to send a plumber: job, date, time, name and units. Draft only, never sent."},{"name":"maintenance_plan","title":"Maintenance plan","description":"Compute the next N plumbing checkup dates every K months after a last visit."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/plumb-now","smithery":"https://smithery.ai/servers/tradephani/plumb-now"},"llms_txt":"https://plumb-now.magicteams.ai/llms.txt","ucp_profile":"https://plumb-now.magicteams.ai/.well-known/ucp","support":"https://plumb-now.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "plumb-now", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
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
