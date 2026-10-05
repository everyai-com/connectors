/** RecipeScale Worker - same engine, served directly. */
import { convertUnits, costPerServing, mergeShoppingList, scaleRecipe } from "../../mcp-server/src/recipescale.js";

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
  { name: "scale_recipe", title: "Scale recipe",
    description: "Scale every ingredient of a recipe from one serving count to another, with friendly kitchen measures and items without a quantity passed through.",
    inputSchema: { type: "object", properties: {
      ingredients: { type: "array", items: { type: "object", properties: {
        item: { type: "string", description: "Ingredient name, e.g. 'flour'" },
        quantity: { type: "number", description: "Amount; omit it for items like 'salt to taste'" },
        unit: { type: "string", description: "Unit such as cup, tbsp, g or a count label like 'clove'" },
        note: { type: "string", description: "Preparation note kept as-is, e.g. 'to taste'" },
      }, required: ["item"] }, description: "Ingredients with optional quantity and unit" },
      from_servings: { type: "number", description: "Servings the recipe is written for" },
      to_servings: { type: "number", description: "Servings you want" },
    }, required: ["ingredients", "from_servings", "to_servings"] },
    run: (a: A) => {
      req(a, "ingredients", "arr"); req(a, "from_servings", "num"); req(a, "to_servings", "num");
      return scaleRecipe(a as unknown as Parameters<typeof scaleRecipe>[0]);
    } },
  { name: "convert_units", title: "Convert units",
    description: "Convert a cooking amount between units: same-dimension conversions are exact; cups to grams and similar need a known ingredient density.",
    inputSchema: { type: "object", properties: {
      value: { type: "number", description: "Amount to convert" },
      from: { type: "string", description: "Unit to convert from, e.g. cup" },
      to: { type: "string", description: "Unit to convert to, e.g. g" },
      ingredient: { type: "string", description: "Ingredient name, needed for volume <-> weight, e.g. flour" },
    }, required: ["value", "from", "to"] },
    run: (a: A) => {
      req(a, "value", "num"); req(a, "from", "str"); req(a, "to", "str");
      return convertUnits(a as unknown as Parameters<typeof convertUnits>[0]);
    } },
  { name: "merge_shopping_list", title: "Merge shopping list",
    description: "Merge several shopping lists into one: quantities of the same item are summed in a common unit and shown in the friendliest kitchen unit; items without a quantity are collected as notes.",
    inputSchema: { type: "object", properties: {
      lists: { type: "array", items: { type: "object", properties: {
        name: { type: "string", description: "e.g. 'Saturday dinner'" },
        items: { type: "array", items: { type: "object", properties: {
          item: { type: "string", description: "Item to buy" },
          quantity: { type: "number", description: "Amount; omit it for non-numeric items" },
          unit: { type: "string", description: "Unit such as cup, tbsp or g" },
        }, required: ["item"] }, description: "Items on this list" },
      }, required: ["items"] }, description: "Shopping lists to merge" },
    }, required: ["lists"] },
    run: (a: A) => {
      req(a, "lists", "arr");
      return mergeShoppingList(a as unknown as Parameters<typeof mergeShoppingList>[0]);
    } },
  { name: "cost_per_serving", title: "Cost per serving",
    description: "Total the cost of the ingredients in a recipe and divide it by the servings to get cost per serving, also shown for 10 servings.",
    inputSchema: { type: "object", properties: {
      ingredients: { type: "array", items: { type: "object", properties: {
        item: { type: "string", description: "Ingredient name" },
        cost: { type: "number", description: "Cost of the amount used in the recipe" },
      }, required: ["item", "cost"] }, description: "Priced ingredients" },
      servings: { type: "number", description: "How many servings the recipe makes" },
      currency: { type: "string", description: "Currency code for display, default USD" },
    }, required: ["ingredients", "servings"] },
    run: (a: A) => {
      req(a, "ingredients", "arr"); req(a, "servings", "num");
      return costPerServing(a as unknown as Parameters<typeof costPerServing>[0]);
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
const INSTRUCTIONS = "RecipeScale does kitchen math: scale a recipe to a different serving count, convert cooking units (including cups to grams via ingredient densities), merge several shopping lists into one and compute cost per serving. Pure arithmetic; nothing stored.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("RecipeScale", `<h1>RecipeScale</h1><p>Scale recipes to any serving count, convert kitchen units, merge shopping lists and work out cost per serving - served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - RecipeScale", `<h1>Privacy Policy - RecipeScale</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Ingredient names, quantities, prices and list names you provide, and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute scaled recipes, unit conversions, merged lists and cost per serving for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - RecipeScale", `<h1>Terms of Service - RecipeScale</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>RecipeScale performs arithmetic on the amounts and prices you provide; it is a helper for kitchen planning, not a shop, and it does not order, buy or deliver anything. Ingredient densities are approximate and depend on how an ingredient is packed.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed conversions or costs.</p>`),
  "/support": page("Support - RecipeScale", `<h1>Support - RecipeScale</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Scale recipes, convert units"><title>RecipeScale — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;RecipeScale&quot;,&quot;url&quot;:&quot;https://recipe-scale.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;OtherApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Scale recipes, convert units&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>RecipeScale</h1><p>RecipeScale does the kitchen math: scale a recipe written for one serving count to another (2 cups of flour for 4 becomes 3 cups for 6), convert cooking units including cups to grams through ingredient densities, merge several shopping lists into one with friendly measures, and work out cost per serving from ingredient prices. Pure arithmetic - nothing is stored and nothing is ordered.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://recipe-scale.magicteams.ai/mcp</code></p><p>Find <strong>RecipeScale</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>scale_recipe</code></td><td>Scale every ingredient of a recipe from one serving count to another, with friendly kitchen measures and items without a quantity passed through.</td></tr><tr><td><code>convert_units</code></td><td>Convert a cooking amount between units: same-dimension conversions are exact; cups to grams and similar need a known ingredient density.</td></tr><tr><td><code>merge_shopping_list</code></td><td>Merge several shopping lists into one: quantities of the same item are summed in a common unit and shown in the friendliest kitchen unit; items without a quantity are collected as notes.</td></tr><tr><td><code>cost_per_serving</code></td><td>Total the cost of the ingredients in a recipe and divide it by the servings to get cost per serving, also shown for 10 servings.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# RecipeScale

> Scale recipes, convert units

RecipeScale does the kitchen math: scale a recipe written for one serving count to another (2 cups of flour for 4 becomes 3 cups for 6), convert cooking units including cups to grams through ingredient densities, merge several shopping lists into one with friendly measures, and work out cost per serving from ingredient prices. Pure arithmetic - nothing is stored and nothing is ordered.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://recipe-scale.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "RecipeScale")
- Machine manifest: https://recipe-scale.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://recipe-scale.magicteams.ai/.well-known/ucp

## Tools

- scale_recipe: Scale recipe — Scale every ingredient of a recipe from one serving count to another, with friendly kitchen measures and items without a quantity passed through.
- convert_units: Convert units — Convert a cooking amount between units: same-dimension conversions are exact; cups to grams and similar need a known ingredient density.
- merge_shopping_list: Merge shopping list — Merge several shopping lists into one: quantities of the same item are summed in a common unit and shown in the friendliest kitchen unit; items without a quantity are collected as notes.
- cost_per_serving: Cost per serving — Total the cost of the ingredients in a recipe and divide it by the servings to get cost per serving, also shown for 10 servings.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://recipe-scale.magicteams.ai/support
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

Sitemap: https://recipe-scale.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://recipe-scale.magicteams.ai/</loc></url>
  <url><loc>https://recipe-scale.magicteams.ai/privacy</loc></url>
  <url><loc>https://recipe-scale.magicteams.ai/terms</loc></url>
  <url><loc>https://recipe-scale.magicteams.ai/support</loc></url>
  <url><loc>https://recipe-scale.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"RecipeScale","version":"1.0.0","description":"Scale recipes, convert units","url":"https://recipe-scale.magicteams.ai","mcp_endpoint":"https://recipe-scale.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"scale_recipe","title":"Scale recipe","description":"Scale every ingredient of a recipe from one serving count to another, with friendly kitchen measures and items without a quantity passed through."},{"name":"convert_units","title":"Convert units","description":"Convert a cooking amount between units: same-dimension conversions are exact; cups to grams and similar need a known ingredient density."},{"name":"merge_shopping_list","title":"Merge shopping list","description":"Merge several shopping lists into one: quantities of the same item are summed in a common unit and shown in the friendliest kitchen unit; items without a quantity are collected as notes."},{"name":"cost_per_serving","title":"Cost per serving","description":"Total the cost of the ingredients in a recipe and divide it by the servings to get cost per serving, also shown for 10 servings."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/recipe-scale","smithery":"https://smithery.ai/servers/tradephani/recipe-scale"},"llms_txt":"https://recipe-scale.magicteams.ai/llms.txt","ucp_profile":"https://recipe-scale.magicteams.ai/.well-known/ucp","support":"https://recipe-scale.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ name: "RecipeScale MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "recipe-scale", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "recipe-scale", version: VERSION } },
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
