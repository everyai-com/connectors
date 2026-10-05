/** FestivalFinder Worker - same engine as node server, served directly. */
import { festivalsInYear, nextFestival, festivalDetails } from "../../mcp-server/src/festivals.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;

function str(a: Record<string, unknown>, k: string): string {
  const v = a[k];
  if (typeof v !== "string" || !v) throw new Error(`'${k}' must be a non-empty string`);
  return v;
}
function num(a: Record<string, unknown>, k: string): number {
  const v = a[k];
  if (typeof v !== "number") throw new Error(`'${k}' must be a number`);
  return v;
}

const ANNOT = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const TOOLS = [
  { name: "list_festivals", title: "List festivals",
    description: "All computed Hindu festivals + sankrantis for a year (2020-2040): name, date, rule. Approximate.",
    inputSchema: { type: "object", properties: { year: { type: "number" } }, required: ["year"], additionalProperties: false },
    run: (a: Record<string, unknown>) => festivalsInYear(num(a, "year")) },
  { name: "next_festival", title: "Next festival",
    description: "Next festival on or after a date (YYYY-MM-DD).",
    inputSchema: { type: "object", properties: { from_date: { type: "string" } }, required: ["from_date"], additionalProperties: false },
    run: (a: Record<string, unknown>) => nextFestival(str(a, "from_date")) },
  { name: "festival_details", title: "Festival details",
    description: "Date + rule explanation for one festival by name in a year.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, year: { type: "number" } }, required: ["name", "year"], additionalProperties: false },
    run: (a: Record<string, unknown>) => festivalDetails(str(a, "name"), num(a, "year")) },
  { name: "festivals_in_month", title: "Festivals in month",
    description: "Festivals in a calendar month (1-12) of a year.",
    inputSchema: { type: "object", properties: { year: { type: "number" }, month: { type: "number" } }, required: ["year", "month"], additionalProperties: false },
    run: (a: Record<string, unknown>) => {
      const year = num(a, "year"), month = num(a, "month");
      if (month < 1 || month > 12) throw new Error(`month must be 1-12, got '${month}'`);
      return festivalsInYear(year).filter((f) => Number(f.date.slice(5, 7)) === month);
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
// Public API: never gate on Origin; echo it for CORS (directory scanners call cross-origin).
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
// Directory-required pages (ChatGPT/Claude/Muse listings link here).
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("FestivalFinder", `<h1>FestivalFinder</h1><p>Computed Hindu festival dates (2020-2040) plus sankrantis, served over MCP at <code>/mcp</code>. Approximate within a day; verify muhurta-critical dates with a practitioner.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - FestivalFinder", `<h1>Privacy Policy - FestivalFinder</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-02</p><h2>1. Data we process</h2><p>Festival queries you provide (year, month, festival names) and technical logs (timestamps, tool names, error codes) for reliability and abuse prevention. No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute festival dates; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Queries are answered immediately and are not retained. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - FestivalFinder", `<h1>Terms of Service - FestivalFinder</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-02</p><h2>1. Service</h2><p>FestivalFinder provides computed Hindu festival dates for 2020-2040. Dates are approximate (within a day at tithi edges); verify muhurta-critical dates with a qualified practitioner.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed dates.</p>`),
  "/support": page("Support - FestivalFinder", `<h1>Support - FestivalFinder</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Festival dates, tithi rules"><title>FestivalFinder — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;FestivalFinder&quot;,&quot;url&quot;:&quot;https://festival-finder.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;EntertainmentApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Festival dates, tithi rules&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>FestivalFinder</h1><p>FestivalFinder computes Hindu festival dates for 2020-2040 from tithi rules: Diwali, Holi, Navratri, Maha Shivaratri, Ugadi, Ram Navami and more, plus monthly calendars and sankrantis. Every date ships with its lunar rule explanation. Dates are approximate within a day at tithi edges; verify muhurta-critical dates with a practitioner.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://festival-finder.magicteams.ai/mcp</code></p><p>Find <strong>FestivalFinder</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>list_festivals</code></td><td>All computed Hindu festivals + sankrantis for a year (2020-2040): name, date, rule. Approximate.</td></tr><tr><td><code>next_festival</code></td><td>Next festival on or after a date (YYYY-MM-DD).</td></tr><tr><td><code>festival_details</code></td><td>Date + rule explanation for one festival by name in a year.</td></tr><tr><td><code>festivals_in_month</code></td><td>Festivals in a calendar month (1-12) of a year.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# FestivalFinder

> Festival dates, tithi rules

FestivalFinder computes Hindu festival dates for 2020-2040 from tithi rules: Diwali, Holi, Navratri, Maha Shivaratri, Ugadi, Ram Navami and more, plus monthly calendars and sankrantis. Every date ships with its lunar rule explanation. Dates are approximate within a day at tithi edges; verify muhurta-critical dates with a practitioner.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://festival-finder.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "FestivalFinder")
- Machine manifest: https://festival-finder.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://festival-finder.magicteams.ai/.well-known/ucp

## Tools

- list_festivals: List festivals — All computed Hindu festivals + sankrantis for a year (2020-2040): name, date, rule. Approximate.
- next_festival: Next festival — Next festival on or after a date (YYYY-MM-DD).
- festival_details: Festival details — Date + rule explanation for one festival by name in a year.
- festivals_in_month: Festivals in month — Festivals in a calendar month (1-12) of a year.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://festival-finder.magicteams.ai/support
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

Sitemap: https://festival-finder.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://festival-finder.magicteams.ai/</loc></url>
  <url><loc>https://festival-finder.magicteams.ai/privacy</loc></url>
  <url><loc>https://festival-finder.magicteams.ai/terms</loc></url>
  <url><loc>https://festival-finder.magicteams.ai/support</loc></url>
  <url><loc>https://festival-finder.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"FestivalFinder","version":"1.0.0","description":"Festival dates, tithi rules","url":"https://festival-finder.magicteams.ai","mcp_endpoint":"https://festival-finder.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"list_festivals","title":"List festivals","description":"All computed Hindu festivals + sankrantis for a year (2020-2040): name, date, rule. Approximate."},{"name":"next_festival","title":"Next festival","description":"Next festival on or after a date (YYYY-MM-DD)."},{"name":"festival_details","title":"Festival details","description":"Date + rule explanation for one festival by name in a year."},{"name":"festivals_in_month","title":"Festivals in month","description":"Festivals in a calendar month (1-12) of a year."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/festival-finder","smithery":"https://smithery.ai/servers/tradephani/festival-finder"},"llms_txt":"https://festival-finder.magicteams.ai/llms.txt","ucp_profile":"https://festival-finder.magicteams.ai/.well-known/ucp","support":"https://festival-finder.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      // No SSE streams here: 405 is the spec-correct refusal (else SSE parsers break on JSON).
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("SSE streams not supported; use POST with application/json",
          { status: 405, headers: { Allow: "POST", ...cors(request) } });
      return json({ name: "FestivalFinder MCP", transport: "Streamable HTTP (JSON response profile)",
        tools: TOOLS.map((t) => t.name) }, 200, cors(request));
    }
    if (request.method === "DELETE" && (url.pathname === "/mcp" || url.pathname === "/mcp/"))
      return new Response("No sessions; use POST with application/json",
        { status: 405, headers: { Allow: "POST", ...cors(request) } });
    if ((url.pathname !== "/mcp" && url.pathname !== "/mcp/") || request.method !== "POST") return json({ error: "use POST /mcp, GET /health" }, 404);
    if (env.API_KEY && !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.API_KEY}`))
      return json({ error: "unauthorized" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "body too large" }, 413);
    const body = (await request.json()) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    const id = body.id ?? null;
    if (body.method === undefined || body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (body.method === "ping") return json({ jsonrpc: "2.0", id, result: {} }, 200, cors(request));
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
      protocolVersion: negotiateVersion((body.params as unknown as { protocolVersion?: unknown })?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "festival-finder", version: VERSION },
      instructions: "FestivalFinder computes Hindu festival dates 2020-2040. Approximate within a day; advise verifying muhurta-critical dates.",
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "festival-finder", version: VERSION } },
      instructions: "FestivalFinder computes Hindu festival dates 2020-2040. Approximate within a day; advise verifying muhurta-critical dates.",
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
