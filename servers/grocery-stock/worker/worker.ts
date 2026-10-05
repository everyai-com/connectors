/** GroceryStock Worker - same engine, served directly. */
import {
  forecastRunout, buildRestockList, quoteBasket, compareStoreTiers, suggestSwaps, restockSchedule,
} from "../../mcp-server/src/grocerystock.js";

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
  { name: "forecast_runout", title: "Forecast runout",
    description: "Forecast when each staple runs out from on-hand amounts and weekly use: weeks left, runout date and ok/low/out status.",
    inputSchema: { type: "object", properties: {
      staples: { type: "array", description: "Staples with on-hand amounts and weekly use", items: { type: "object" } },
      as_of: { type: "string", description: "Reference date YYYY-MM-DD, default today" } }, required: ["staples"] },
    annot: RO,
    run: (a: A) => forecastRunout(a as unknown as Parameters<typeof forecastRunout>[0]) },
  { name: "build_restock_list", title: "Build restock list",
    description: "Build a restock shopping list covering N weeks ahead from on-hand amounts and weekly use.",
    inputSchema: { type: "object", properties: {
      staples: { type: "array", description: "Staples with on-hand amounts and weekly use", items: { type: "object" } },
      weeks_ahead: { type: "number", description: "Weeks to cover, 1-8, default 2" } }, required: ["staples"] },
    annot: RO,
    run: (a: A) => buildRestockList(a as unknown as Parameters<typeof buildRestockList>[0]) },
  { name: "quote_basket", title: "Quote basket",
    description: "Price a basket of staples with typical US prices: per-item lines and a total. Prices are typical, not store quotes.",
    inputSchema: { type: "object", properties: {
      items: { type: "array", description: "Items and quantities to price", items: { type: "object" } } }, required: ["items"] },
    annot: RO,
    run: (a: A) => quoteBasket(a as unknown as Parameters<typeof quoteBasket>[0]) },
  { name: "compare_store_tiers", title: "Compare store tiers",
    description: "Compare what the same basket costs at budget, standard and premium store tiers, and name the cheapest.",
    inputSchema: { type: "object", properties: {
      items: { type: "array", description: "Items and quantities to compare", items: { type: "object" } } }, required: ["items"] },
    annot: RO,
    run: (a: A) => compareStoreTiers(a as unknown as Parameters<typeof compareStoreTiers>[0]) },
  { name: "suggest_swaps", title: "Suggest swaps",
    description: "Fit a basket into a budget by swapping the priciest lines for cheaper staples, biggest savings first.",
    inputSchema: { type: "object", properties: {
      items: { type: "array", description: "Items and quantities in the basket", items: { type: "object" } },
      budget_usd: { type: "number", description: "Target budget in USD" } }, required: ["items", "budget_usd"] },
    annot: RO,
    run: (a: A) => { req(a, "budget_usd", "num"); return suggestSwaps(a as unknown as Parameters<typeof suggestSwaps>[0]); } },
  { name: "restock_schedule", title: "Restock schedule",
    description: "Compute the next N weekly restock dates for a weekday on or after a start date.",
    inputSchema: { type: "object", properties: {
      start_date: { type: "string", description: "Start date YYYY-MM-DD" },
      weekday: { type: "string", description: "Restock weekday, default sunday" },
      count: { type: "number", description: "How many dates, 1-12, default 4" } }, required: ["start_date"] },
    annot: RO,
    run: (a: A) => { req(a, "start_date", "str"); return restockSchedule(a as unknown as Parameters<typeof restockSchedule>[0]); } },
];

const INSTRUCTIONS = "GroceryStock plans weekly grocery restocks: forecast when staples run out (weeks left, runout date, ok/low/out), build a shopping list covering N weeks ahead, quote a basket with typical US prices, compare budget/standard/premium store tiers, suggest swaps to fit a budget, and compute restock dates. Planning only - it never orders anything. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - GroceryStock</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("GroceryStock", "<p>Plan weekly grocery restocks - served over MCP at /mcp. Runout forecasts, restock lists, basket quotes, budget swaps.</p>"),
  "/privacy": page("Privacy Policy", "<p>GroceryStock computes restock plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>GroceryStock provides planning estimates (typical prices, forecasts) for informational purposes. Verify store prices before spending. No ordering, no payments. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan weekly grocery restocks"><title>GroceryStock — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;GroceryStock&quot;,&quot;url&quot;:&quot;https://grocery-stock.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan weekly grocery restocks&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>GroceryStock</h1><p>GroceryStock turns your staples into a restock plan: forecast when each item runs out, build a shopping list covering N weeks, quote the basket with typical US prices, compare budget/standard/premium store tiers, swap pricy lines to fit a budget, and compute your Sunday restock dates. Planning only - it never orders anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://grocery-stock.magicteams.ai/mcp</code></p><p>Find <strong>GroceryStock</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>forecast_runout</code></td><td>Forecast when each staple runs out from on-hand amounts and weekly use: weeks left, runout date and ok/low/out status.</td></tr><tr><td><code>build_restock_list</code></td><td>Build a restock shopping list covering N weeks ahead from on-hand amounts and weekly use.</td></tr><tr><td><code>quote_basket</code></td><td>Price a basket of staples with typical US prices: per-item lines and a total. Prices are typical, not store quotes.</td></tr><tr><td><code>compare_store_tiers</code></td><td>Compare what the same basket costs at budget, standard and premium store tiers, and name the cheapest.</td></tr><tr><td><code>suggest_swaps</code></td><td>Fit a basket into a budget by swapping the priciest lines for cheaper staples, biggest savings first.</td></tr><tr><td><code>restock_schedule</code></td><td>Compute the next N weekly restock dates for a weekday on or after a start date.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# GroceryStock

> Plan weekly grocery restocks

GroceryStock turns your staples into a restock plan: forecast when each item runs out, build a shopping list covering N weeks, quote the basket with typical US prices, compare budget/standard/premium store tiers, swap pricy lines to fit a budget, and compute your Sunday restock dates. Planning only - it never orders anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://grocery-stock.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "GroceryStock")
- Machine manifest: https://grocery-stock.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://grocery-stock.magicteams.ai/.well-known/ucp

## Tools

- forecast_runout: Forecast runout — Forecast when each staple runs out from on-hand amounts and weekly use: weeks left, runout date and ok/low/out status.
- build_restock_list: Build restock list — Build a restock shopping list covering N weeks ahead from on-hand amounts and weekly use.
- quote_basket: Quote basket — Price a basket of staples with typical US prices: per-item lines and a total. Prices are typical, not store quotes.
- compare_store_tiers: Compare store tiers — Compare what the same basket costs at budget, standard and premium store tiers, and name the cheapest.
- suggest_swaps: Suggest swaps — Fit a basket into a budget by swapping the priciest lines for cheaper staples, biggest savings first.
- restock_schedule: Restock schedule — Compute the next N weekly restock dates for a weekday on or after a start date.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://grocery-stock.magicteams.ai/support
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

Sitemap: https://grocery-stock.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://grocery-stock.magicteams.ai/</loc></url>
  <url><loc>https://grocery-stock.magicteams.ai/privacy</loc></url>
  <url><loc>https://grocery-stock.magicteams.ai/terms</loc></url>
  <url><loc>https://grocery-stock.magicteams.ai/support</loc></url>
  <url><loc>https://grocery-stock.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"GroceryStock","version":"1.0.0","description":"Plan weekly grocery restocks","url":"https://grocery-stock.magicteams.ai","mcp_endpoint":"https://grocery-stock.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"forecast_runout","title":"Forecast runout","description":"Forecast when each staple runs out from on-hand amounts and weekly use: weeks left, runout date and ok/low/out status."},{"name":"build_restock_list","title":"Build restock list","description":"Build a restock shopping list covering N weeks ahead from on-hand amounts and weekly use."},{"name":"quote_basket","title":"Quote basket","description":"Price a basket of staples with typical US prices: per-item lines and a total. Prices are typical, not store quotes."},{"name":"compare_store_tiers","title":"Compare store tiers","description":"Compare what the same basket costs at budget, standard and premium store tiers, and name the cheapest."},{"name":"suggest_swaps","title":"Suggest swaps","description":"Fit a basket into a budget by swapping the priciest lines for cheaper staples, biggest savings first."},{"name":"restock_schedule","title":"Restock schedule","description":"Compute the next N weekly restock dates for a weekday on or after a start date."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/grocery-stock","smithery":"https://smithery.ai/servers/tradephani/grocery-stock"},"llms_txt":"https://grocery-stock.magicteams.ai/llms.txt","ucp_profile":"https://grocery-stock.magicteams.ai/.well-known/ucp","support":"https://grocery-stock.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "grocery-stock", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
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
