/** CourtSplit Worker - same engine, served directly. */
import { rotationPlan, settleUp, splitCosts, splitSeries } from "../../mcp-server/src/courtsplit.js";

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
  { name: "split_costs", title: "Split costs",
    description: "Split one total cost across players (equally or by relative weights) and show who owes what plus the fewest settle-up payments.",
    inputSchema: { type: "object", properties: {
      total_cost: { type: "number", description: "Total court/venue cost" },
      participants: { type: "array", items: { type: "object", properties: { name: { type: "string" }, paid: { type: "number" } }, required: ["name"] }, description: "Players in the split" },
      shares: { type: "array", items: { type: "number" }, description: "Optional relative weights, one per participant" },
      currency: { type: "string", description: "Currency code for display, default USD" },
    }, required: ["total_cost", "participants"] },
    run: (a: A) => {
      req(a, "total_cost", "num"); req(a, "participants", "arr");
      return splitCosts(a as unknown as Parameters<typeof splitCosts>[0]);
    } },
  { name: "settle_up", title: "Settle up",
    description: "Given who paid what for a total cost, compute balances and the minimal set of payments to settle everyone.",
    inputSchema: { type: "object", properties: {
      total_cost: { type: "number" },
      participants: { type: "array", items: { type: "object", properties: { name: { type: "string" }, paid: { type: "number" } }, required: ["name"] } },
      shares: { type: "array", items: { type: "number" } },
      currency: { type: "string" },
    }, required: ["total_cost", "participants"] },
    run: (a: A) => {
      req(a, "total_cost", "num"); req(a, "participants", "arr");
      return settleUp(a as unknown as Parameters<typeof settleUp>[0]);
    } },
  { name: "split_series", title: "Split series",
    description: "Account for recurring sessions where different players attend different days: each session splits only among its attendees; returns who owes what and settle-up payments.",
    inputSchema: { type: "object", properties: {
      sessions: { type: "array", items: { type: "object", properties: { label: { type: "string" }, cost: { type: "number" }, attendees: { type: "array", items: { type: "string" } } }, required: ["cost", "attendees"] } },
      players: { type: "array", items: { type: "string" } },
      payments: { type: "array", items: { type: "object", properties: { name: { type: "string" }, paid: { type: "number" } }, required: ["name"] } },
      currency: { type: "string" },
    }, required: ["sessions"] },
    run: (a: A) => {
      req(a, "sessions", "arr");
      return splitSeries(a as unknown as Parameters<typeof splitSeries>[0]);
    } },
  { name: "rotation_plan", title: "Rotation plan",
    description: "Plan fair rotations for pickup games: who plays each round, who sits out, and games-played balance across the roster.",
    inputSchema: { type: "object", properties: {
      players: { type: "array", items: { type: "string" }, description: "Roster names" },
      capacity: { type: "number", description: "Players per court (2 singles, 4 doubles)" },
      courts: { type: "number" },
      rounds: { type: "number" },
    }, required: ["players", "capacity", "rounds"] },
    run: (a: A) => {
      req(a, "players", "arr"); req(a, "capacity", "num"); req(a, "rounds", "num");
      return rotationPlan(a as unknown as Parameters<typeof rotationPlan>[0]);
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
const INSTRUCTIONS = "CourtSplit splits court and venue costs fairly, minimizes settle-up payments, accounts for recurring sessions with rotating attendance, and plans fair play rotations. All maths only; nothing stored.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("CourtSplit", `<h1>CourtSplit</h1><p>Split court costs, settle up with the fewest payments, account for recurring sessions and plan fair rotations - served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - CourtSplit", `<h1>Privacy Policy - CourtSplit</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Player names and amounts you provide, and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute splits, settle-up transfers and rotation schedules for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - CourtSplit", `<h1>Terms of Service - CourtSplit</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>CourtSplit performs arithmetic on the numbers you provide and is not a payment service; it does not move money, hold funds, or guarantee that any group member pays.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results.</p>`),
  "/support": page("Support - CourtSplit", `<h1>Support - CourtSplit</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Split court costs, settle up"><title>CourtSplit — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;CourtSplit&quot;,&quot;url&quot;:&quot;https://court-split.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;FinanceApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Split court costs, settle up&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>CourtSplit</h1><p>CourtSplit saves group organizers the spreadsheet: split a court or venue booking across players (equally or by weights), work out the fewest payments to settle everyone, account for recurring sessions where different players attend different days, and plan fair rotations for pickup games including who sits out each round. Pure arithmetic - no payments are processed.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://court-split.magicteams.ai/mcp</code></p><p>Find <strong>CourtSplit</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>split_costs</code></td><td>Split one total cost across players (equally or by relative weights) and show who owes what plus the fewest settle-up payments.</td></tr><tr><td><code>settle_up</code></td><td>Given who paid what for a total cost, compute balances and the minimal set of payments to settle everyone.</td></tr><tr><td><code>split_series</code></td><td>Account for recurring sessions where different players attend different days: each session splits only among its attendees; returns who owes what and settle-up payments.</td></tr><tr><td><code>rotation_plan</code></td><td>Plan fair rotations for pickup games: who plays each round, who sits out, and games-played balance across the roster.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# CourtSplit

> Split court costs, settle up

CourtSplit saves group organizers the spreadsheet: split a court or venue booking across players (equally or by weights), work out the fewest payments to settle everyone, account for recurring sessions where different players attend different days, and plan fair rotations for pickup games including who sits out each round. Pure arithmetic - no payments are processed.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://court-split.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "CourtSplit")
- Machine manifest: https://court-split.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://court-split.magicteams.ai/.well-known/ucp

## Tools

- split_costs: Split costs — Split one total cost across players (equally or by relative weights) and show who owes what plus the fewest settle-up payments.
- settle_up: Settle up — Given who paid what for a total cost, compute balances and the minimal set of payments to settle everyone.
- split_series: Split series — Account for recurring sessions where different players attend different days: each session splits only among its attendees; returns who owes what and settle-up payments.
- rotation_plan: Rotation plan — Plan fair rotations for pickup games: who plays each round, who sits out, and games-played balance across the roster.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://court-split.magicteams.ai/support
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

Sitemap: https://court-split.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://court-split.magicteams.ai/</loc></url>
  <url><loc>https://court-split.magicteams.ai/privacy</loc></url>
  <url><loc>https://court-split.magicteams.ai/terms</loc></url>
  <url><loc>https://court-split.magicteams.ai/support</loc></url>
  <url><loc>https://court-split.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"CourtSplit","version":"1.0.0","description":"Split court costs, settle up","url":"https://court-split.magicteams.ai","mcp_endpoint":"https://court-split.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"split_costs","title":"Split costs","description":"Split one total cost across players (equally or by relative weights) and show who owes what plus the fewest settle-up payments."},{"name":"settle_up","title":"Settle up","description":"Given who paid what for a total cost, compute balances and the minimal set of payments to settle everyone."},{"name":"split_series","title":"Split series","description":"Account for recurring sessions where different players attend different days: each session splits only among its attendees; returns who owes what and settle-up payments."},{"name":"rotation_plan","title":"Rotation plan","description":"Plan fair rotations for pickup games: who plays each round, who sits out, and games-played balance across the roster."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/court-split","smithery":"https://smithery.ai/servers/tradephani/court-split"},"llms_txt":"https://court-split.magicteams.ai/llms.txt","ucp_profile":"https://court-split.magicteams.ai/.well-known/ucp","support":"https://court-split.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ name: "CourtSplit MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "court-split", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "court-split", version: VERSION } },
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
