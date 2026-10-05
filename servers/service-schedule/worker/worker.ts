/** ServiceSchedule Worker - same engine, served directly. */
import { dueServices, seasonalChecklist, serviceCostEstimate, serviceTimeline } from "../../mcp-server/src/serviceschedule.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const ANNOT = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  if (t === "num" && typeof v !== "number") throw new Error(`'${k}' must be a number`);
  if (t === "arr" && !Array.isArray(v)) throw new Error(`'${k}' must be an array`);
  return v;
};

const TOOLS = [
  { name: "due_services", title: "Due services",
    description: "Compute which scheduled maintenance services (oil, tires, brakes, filters, fluids, plugs, transmission, battery) are due, soon or ok from the current odometer and optional per-service history. Returns km and month distances to each due point.",
    inputSchema: { type: "object", properties: {
      odometer: { type: "number", description: "Current odometer reading" },
      unit: { type: "string", enum: ["km", "mi"], description: "Unit of the odometer values, default km" },
      months_since_last_oil: { type: "number", description: "Months since the last oil change; time baseline for items without their own history" },
      km_per_month: { type: "number", description: "Average km driven per month (100-10000)" },
      last_service: { type: "array", items: { type: "object", properties: {
        id: { type: "string", description: "Service id from the maintenance table, e.g. oil_change" },
        odometer: { type: "number", description: "Odometer when this service was last done (same unit as above)" },
        months_ago: { type: "number", description: "Months since this service was last done" },
      }, required: ["id"] }, description: "Optional per-service history" },
    }, required: ["odometer"] },
    run: (a: A) => {
      req(a, "odometer", "num");
      return dueServices(a as unknown as Parameters<typeof dueServices>[0]);
    } },
  { name: "service_cost_estimate", title: "Service cost estimate",
    description: "Estimate typical US parts-and-labor price ranges for a chosen list of maintenance services at a chosen shop tier (economy, mid or luxury). Returns per-service ranges and a total range.",
    inputSchema: { type: "object", properties: {
      services: { type: "array", items: { type: "string" }, description: "Service ids to price, e.g. oil_change" },
      tier: { type: "string", enum: ["economy", "mid", "luxury"], description: "Shop tier, default mid" },
    }, required: ["services"] },
    run: (a: A) => {
      req(a, "services", "arr");
      return serviceCostEstimate(a as unknown as Parameters<typeof serviceCostEstimate>[0]);
    } },
  { name: "service_timeline", title: "Service timeline",
    description: "Project the next 12 months of driving from a monthly km rate and list which maintenance services fall due in each month, with the projected odometer at that month.",
    inputSchema: { type: "object", properties: {
      odometer: { type: "number", description: "Current odometer reading" },
      unit: { type: "string", enum: ["km", "mi"], description: "Unit of the odometer values, default km" },
      km_per_month: { type: "number", description: "Average km driven per month (100-10000)" },
      months_since_last_oil: { type: "number", description: "Months since the last oil change; time baseline when no other history is given" },
    }, required: ["odometer", "km_per_month"] },
    run: (a: A) => {
      req(a, "odometer", "num"); req(a, "km_per_month", "num");
      return serviceTimeline(a as unknown as Parameters<typeof serviceTimeline>[0]);
    } },
  { name: "seasonal_checklist", title: "Seasonal checklist",
    description: "Seasonal car checklist for spring, summer, fall or winter, adjusted for a hot, cold or mixed climate. Groups practical preventive checks by area (battery, tires, fluids, visibility, safety kit).",
    inputSchema: { type: "object", properties: {
      season: { type: "string", enum: ["spring", "summer", "fall", "winter"], description: "Season to plan for" },
      climate: { type: "string", enum: ["hot", "cold", "mixed"], description: "Local climate, default mixed" },
    }, required: ["season"] },
    run: (a: A) => {
      req(a, "season", "str");
      return seasonalChecklist(a as unknown as Parameters<typeof seasonalChecklist>[0]);
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
const INSTRUCTIONS = "ServiceSchedule plans car maintenance: which services are due, typical US cost ranges by shop tier, a month-by-month schedule and seasonal checklists. All maths only; nothing stored.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("ServiceSchedule", `<h1>ServiceSchedule</h1><p>Plan car maintenance: what is due, typical US cost ranges, a month-by-month schedule and seasonal checklists - served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - ServiceSchedule", `<h1>Privacy Policy - ServiceSchedule</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Odometer readings, service history and vehicle notes you provide, and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute maintenance schedules, cost estimates and checklists for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - ServiceSchedule", `<h1>Terms of Service - ServiceSchedule</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>ServiceSchedule performs arithmetic on the numbers you provide. Intervals and price ranges are typical guidance, not a diagnosis or a quote; your owner's manual and a qualified mechanic govern.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results.</p>`),
  "/support": page("Support - ServiceSchedule", `<h1>Support - ServiceSchedule</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Car maintenance due and costs"><title>ServiceSchedule — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;ServiceSchedule&quot;,&quot;url&quot;:&quot;https://service-schedule.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;OtherApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Car maintenance due and costs&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>ServiceSchedule</h1><p>ServiceSchedule turns an odometer reading into a maintenance plan: which services are due, soon or ok (oil, tires, brakes, filters, fluids, plugs, transmission, battery), typical US price ranges at economy, mid or luxury shop tiers, a month-by-month schedule for the next 12 months, and seasonal checklists adjusted for hot, cold or mixed climates. Pure arithmetic on the numbers you provide - it does not book or inspect anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://service-schedule.magicteams.ai/mcp</code></p><p>Find <strong>ServiceSchedule</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>due_services</code></td><td>Compute which scheduled maintenance services (oil, tires, brakes, filters, fluids, plugs, transmission, battery) are due, soon or ok from the current odometer and optional per-service history. Returns km and month distances to each due point.</td></tr><tr><td><code>service_cost_estimate</code></td><td>Estimate typical US parts-and-labor price ranges for a chosen list of maintenance services at a chosen shop tier (economy, mid or luxury). Returns per-service ranges and a total range.</td></tr><tr><td><code>service_timeline</code></td><td>Project the next 12 months of driving from a monthly km rate and list which maintenance services fall due in each month, with the projected odometer at that month.</td></tr><tr><td><code>seasonal_checklist</code></td><td>Seasonal car checklist for spring, summer, fall or winter, adjusted for a hot, cold or mixed climate. Groups practical preventive checks by area (battery, tires, fluids, visibility, safety kit).</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# ServiceSchedule

> Car maintenance due and costs

ServiceSchedule turns an odometer reading into a maintenance plan: which services are due, soon or ok (oil, tires, brakes, filters, fluids, plugs, transmission, battery), typical US price ranges at economy, mid or luxury shop tiers, a month-by-month schedule for the next 12 months, and seasonal checklists adjusted for hot, cold or mixed climates. Pure arithmetic on the numbers you provide - it does not book or inspect anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://service-schedule.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "ServiceSchedule")
- Machine manifest: https://service-schedule.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://service-schedule.magicteams.ai/.well-known/ucp

## Tools

- due_services: Due services — Compute which scheduled maintenance services (oil, tires, brakes, filters, fluids, plugs, transmission, battery) are due, soon or ok from the current odometer and optional per-service history. Returns km and month distances to each due point.
- service_cost_estimate: Service cost estimate — Estimate typical US parts-and-labor price ranges for a chosen list of maintenance services at a chosen shop tier (economy, mid or luxury). Returns per-service ranges and a total range.
- service_timeline: Service timeline — Project the next 12 months of driving from a monthly km rate and list which maintenance services fall due in each month, with the projected odometer at that month.
- seasonal_checklist: Seasonal checklist — Seasonal car checklist for spring, summer, fall or winter, adjusted for a hot, cold or mixed climate. Groups practical preventive checks by area (battery, tires, fluids, visibility, safety kit).

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://service-schedule.magicteams.ai/support
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

Sitemap: https://service-schedule.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://service-schedule.magicteams.ai/</loc></url>
  <url><loc>https://service-schedule.magicteams.ai/privacy</loc></url>
  <url><loc>https://service-schedule.magicteams.ai/terms</loc></url>
  <url><loc>https://service-schedule.magicteams.ai/support</loc></url>
  <url><loc>https://service-schedule.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"ServiceSchedule","version":"1.0.0","description":"Car maintenance due and costs","url":"https://service-schedule.magicteams.ai","mcp_endpoint":"https://service-schedule.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"due_services","title":"Due services","description":"Compute which scheduled maintenance services (oil, tires, brakes, filters, fluids, plugs, transmission, battery) are due, soon or ok from the current odometer and optional per-service history. Returns km and month distances to each due point."},{"name":"service_cost_estimate","title":"Service cost estimate","description":"Estimate typical US parts-and-labor price ranges for a chosen list of maintenance services at a chosen shop tier (economy, mid or luxury). Returns per-service ranges and a total range."},{"name":"service_timeline","title":"Service timeline","description":"Project the next 12 months of driving from a monthly km rate and list which maintenance services fall due in each month, with the projected odometer at that month."},{"name":"seasonal_checklist","title":"Seasonal checklist","description":"Seasonal car checklist for spring, summer, fall or winter, adjusted for a hot, cold or mixed climate. Groups practical preventive checks by area (battery, tires, fluids, visibility, safety kit)."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/service-schedule","smithery":"https://smithery.ai/servers/tradephani/service-schedule"},"llms_txt":"https://service-schedule.magicteams.ai/llms.txt","ucp_profile":"https://service-schedule.magicteams.ai/.well-known/ucp","support":"https://service-schedule.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
    if (request.method === "OPTIONS" && url.pathname === "/mcp")
      return new Response(null, { status: 204, headers: { ...cors(request),
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
        "Access-Control-Max-Age": "86400" } });
    if (request.method === "GET" && url.pathname === "/mcp") {
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("SSE streams not supported; use POST with application/json",
          { status: 405, headers: { Allow: "POST", ...cors(request) } });
      return json({ name: "ServiceSchedule MCP", transport: "Streamable HTTP (JSON response profile)",
        tools: TOOLS.map((t) => t.name) }, 200, cors(request));
    }
    if (request.method === "DELETE" && url.pathname === "/mcp")
      return new Response("No sessions; use POST with application/json",
        { status: 405, headers: { Allow: "POST", ...cors(request) } });
    if (url.pathname !== "/mcp" || request.method !== "POST") return json({ error: "use POST /mcp, GET /health" }, 404);
    if (env.API_KEY && !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.API_KEY}`))
      return json({ error: "unauthorized" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "body too large" }, 413);
    const body = (await request.json()) as { id?: unknown; method?: string; params?: { name?: string; arguments?: A } };
    const id = body.id ?? null;
    if (body.method === undefined || body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
      protocolVersion: negotiateVersion((body.params as unknown as { protocolVersion?: unknown })?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "service-schedule", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "service-schedule", version: VERSION } },
      instructions: INSTRUCTIONS,
      ttlMs: 3600000,
      cacheScope: "public",
    } }, 200, cors(request));
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...ANNOT } })) } }, 200, cors(request));
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
