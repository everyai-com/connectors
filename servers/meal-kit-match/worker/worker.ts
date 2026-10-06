/** MealKitMatch Worker - same engine, served directly. */
import {
  matchKits, planWeek, quoteWeek, compareKitTiers, suggestSwaps, deliverySchedule,
} from "../../mcp-server/src/mealkitmatch.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }

const VERSION = "1.0.0";
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type A = Record<string, unknown>;
const str = (v: unknown) => typeof v === "string";
const num = (v: unknown) => typeof v === "number";
const req = (a: A, k: string, t: "str" | "num") => {
  if (t === "str" && !str(a[k])) throw new Error(`ERROR ${k} must be a string.`);
  if (t === "num" && !num(a[k])) throw new Error(`ERROR ${k} must be a number.`);
};

const TOOLS = [
  { name: "match_kits", title: "Match kits",
    description: "Match meal kits to a diet/budget profile. Use when you need to select the best kit; NOT when planning a weekly meal schedule (use plan_week).",
    inputSchema: { type: "object", properties: {
      profile: { type: "object", description: "Your diet profile" },
      kits: { type: "array", description: "Kit catalog to match", items: { type: "object" } } }, required: ["profile", "kits"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "matches": {
         "type": "array",
         "description": "List of meal kits that match the diet/budget profile with scores",
         "items": {
          "type": "object",
          "properties": {
           "kit": {
            "type": "object",
            "description": "The meal kit that matches the profile"
           },
           "score": {
            "type": "number",
            "description": "The score of how well the kit matches the profile"
           }
          },
          "required": [
           "kit",
           "score"
          ]
         }
        },
        "rejections": {
         "type": "array",
         "description": "List of meal kits that do not match the diet/budget profile with reasons",
         "items": {
          "type": "object",
          "properties": {
           "kit": {
            "type": "object",
            "description": "The meal kit that does not match the profile"
           },
           "reason": {
            "type": "string",
            "description": "The reason why the kit does not match the profile"
           }
          },
          "required": [
           "kit",
           "reason"
          ]
         }
        },
        "pick": {
         "type": "object",
         "description": "The best meal kit that matches the diet/budget profile",
         "properties": {
          "kit": {
           "type": "object",
           "description": "The best meal kit"
          },
          "score": {
           "type": "number",
           "description": "The score of how well the kit matches the profile"
          }
         },
         "required": [
          "kit",
          "score"
         ]
        }
       },
       "required": [
        "matches",
        "rejections",
        "pick"
       ]
      },
    annot: RO,
    run: (a: A) => matchKits(a as unknown as Parameters<typeof matchKits>[0]) },
  { name: "plan_week", title: "Plan week",
    description: "Plan a week of kit meals across days. Use when you need to plan meals for a specific week. Do NOT use when you need to compare different kit tiers, use compare_kit_tiers.",
    inputSchema: { type: "object", properties: {
      kit_meals: { type: "array", description: "Kit meals to rotate", items: { type: "object" } },
      days: { type: "number", description: "Days to plan, 1-14, default 7" },
      servings_needed: { type: "number", description: "Servings needed per day, 1-12, default 2" } }, required: ["kit_meals"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "planned_week": {
         "type": "array",
         "description": "The planned meals for each day",
         "items": {
          "type": "object",
          "properties": {
           "day": {
            "type": "number",
            "description": "The day number in the week"
           },
           "meals": {
            "type": "array",
            "description": "The meals planned for this day",
            "items": {
             "type": "object",
             "properties": {
              "meal_name": {
               "type": "string",
               "description": "The name of the meal"
              },
              "servings": {
               "type": "number",
               "description": "The number of servings for this meal"
              }
             },
             "required": [
              "meal_name",
              "servings"
             ]
            }
           },
           "servings_short": {
            "type": "boolean",
            "description": "Flag indicating if the day is short on servings"
           }
          },
          "required": [
           "day",
           "meals",
           "servings_short"
          ]
         }
        }
       },
       "required": [
        "planned_week"
       ]
      },
    annot: RO,
    run: (a: A) => planWeek(a as unknown as Parameters<typeof planWeek>[0]) },
  { name: "quote_week", title: "Quote week",
    description: "Calculate weekly meal kit costs, including shipping and monthly estimate. Use when estimating weekly costs, not when planning meals (use plan_week).",
    inputSchema: { type: "object", properties: {
      price_per_serving: { type: "number", description: "Price per serving in USD" },
      meals_per_week: { type: "number", description: "Meals per week, 1-21" },
      servings: { type: "number", description: "Servings per meal, 1-12" },
      shipping: { type: "number", description: "Weekly shipping in USD, default 0" } }, required: ["price_per_serving", "meals_per_week", "servings"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "weekly_cost": {
         "type": "number",
         "description": "Total cost for the week in USD"
        },
        "food_total": {
         "type": "number",
         "description": "Total food cost for the week in USD"
        },
        "shipping_cost": {
         "type": "number",
         "description": "Shipping cost for the week in USD"
        },
        "monthly_estimate": {
         "type": "number",
         "description": "Estimated monthly cost in USD"
        },
        "cost_per_serving": {
         "type": "number",
         "description": "Cost per serving in USD"
        },
        "cost_per_meal": {
         "type": "number",
         "description": "Cost per meal in USD"
        }
       },
       "required": [
        "weekly_cost",
        "food_total",
        "shipping_cost",
        "monthly_estimate",
        "cost_per_serving",
        "cost_per_meal"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "price_per_serving", "num"); req(a, "meals_per_week", "num"); req(a, "servings", "num"); return quoteWeek(a as unknown as Parameters<typeof quoteWeek>[0]); } },
  { name: "compare_kit_tiers", title: "Compare kit tiers",
    description: "Rank kit plans by value when you need to prioritize multiple factors. Use match_kits to find kits first, not to re-rank existing plans.",
    inputSchema: { type: "object", properties: {
      plans: { type: "array", description: "Plans to compare", items: { type: "object" } } }, required: ["plans"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "rankedPlans": {
         "type": "array",
         "description": "The input plans, sorted by value score",
         "items": {
          "type": "object",
          "properties": {
           "plan": {
            "type": "object",
            "description": "The original plan object"
           },
           "valueScore": {
            "type": "number",
            "description": "The calculated value score (60% rating, 40% price)"
           }
          },
          "required": [
           "plan",
           "valueScore"
          ]
         }
        }
       },
       "required": [
        "rankedPlans"
       ]
      },
    annot: RO,
    run: (a: A) => compareKitTiers(a as unknown as Parameters<typeof compareKitTiers>[0]) },
  { name: "suggest_swaps", title: "Suggest swaps",
    description: "Suggest meal swaps for clashing avoids. Use when you need to replace meals based on dietary restrictions, NOT when planning a full week (use plan_week).",
    inputSchema: { type: "object", properties: {
      meals: { type: "array", description: "Meals to check", items: { type: "object" } },
      avoid: { type: "array", description: "Tags to avoid", items: { type: "string" } } }, required: ["meals", "avoid"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "swaps": {
         "type": "array",
         "description": "List of suggested swaps for each meal",
         "items": {
          "type": "object",
          "properties": {
           "originalMeal": {
            "type": "string",
            "description": "The original meal that needs to be swapped"
           },
           "swapMeal": {
            "type": "string",
            "description": "The suggested meal to swap in"
           },
           "reason": {
            "type": "string",
            "description": "The reason for the swap, typically a clashing avoid tag"
           }
          },
          "required": [
           "originalMeal",
           "swapMeal",
           "reason"
          ]
         }
        }
       },
       "required": [
        "swaps"
       ]
      },
    annot: RO,
    run: (a: A) => suggestSwaps(a as unknown as Parameters<typeof suggestSwaps>[0]) },
  { name: "delivery_schedule", title: "Delivery schedule",
    description: "Schedule N weekly deliveries starting from a given date. Use when planning future deliveries; NOT for daily or monthly schedules, use plan_week instead.",
    inputSchema: { type: "object", properties: {
      first_delivery: { type: "string", description: "First delivery YYYY-MM-DD" },
      every_weeks: { type: "number", description: "Cadence in weeks, 1-12, default 1" },
      count: { type: "number", description: "How many dates, 1-12, default 4" } }, required: ["first_delivery"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "delivery_dates": {
         "type": "array",
         "description": "List of delivery dates",
         "items": {
          "type": "string",
          "format": "date",
          "description": "A delivery date in YYYY-MM-DD format"
         }
        }
       },
       "required": [
        "delivery_dates"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "first_delivery", "str"); return deliverySchedule(a as unknown as Parameters<typeof deliverySchedule>[0]); } },
];

const INSTRUCTIONS = "MealKitMatch plans meal-kit choices around a diet profile and kit catalog you provide: match kits to diets, allergies and budget, plan a week of kit meals, quote weekly cost, compare kit tiers on your own price and rating numbers, suggest swaps around avoids, and schedule deliveries. Planning only: it never orders anything. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - MealKitMatch</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("MealKitMatch", "<p>Plan meal-kit choices - served over MCP at /mcp. Kit matching, week plans, cost quotes, swaps.</p>"),
  "/privacy": page("Privacy Policy", "<p>MealKitMatch computes meal plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>MealKitMatch provides planning estimates for informational purposes. It never orders kits or processes payments. Verify kit prices and allergen info before buying. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Match meal kits to diets"><title>MealKitMatch — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;MealKitMatch&quot;,&quot;url&quot;:&quot;https://meal-kit-match.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Match meal kits to diets&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>MealKitMatch</h1><p>MealKitMatch plans meal-kit choices around a diet profile and kit catalog you provide: match kits to diets, allergies and budget, plan a week of kit meals, quote weekly cost, compare kit tiers on your price and rating numbers, suggest swaps around avoids, and schedule deliveries. Planning only - it never orders anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://meal-kit-match.magicteams.ai/mcp</code></p><p>Find <strong>MealKitMatch</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>match_kits</code></td><td>Rank meal kits against a diet/budget profile: matches with scores, rejections with reasons, and a pick.</td></tr><tr><td><code>plan_week</code></td><td>Plan a week of kit meals across days, flagging days short on servings.</td></tr><tr><td><code>quote_week</code></td><td>Quote a week of meal kits: per-meal math, food total, shipping and monthly estimate.</td></tr><tr><td><code>compare_kit_tiers</code></td><td>Rank 2-6 kit plans from your price and rating numbers: 60% rating, 40% price.</td></tr><tr><td><code>suggest_swaps</code></td><td>Suggest swaps for meals clashing with avoids, naming a clean swap from the same list.</td></tr><tr><td><code>delivery_schedule</code></td><td>Compute the next N delivery dates on a weekly cadence from a first delivery.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# MealKitMatch

> Match meal kits to diets

MealKitMatch plans meal-kit choices around a diet profile and kit catalog you provide: match kits to diets, allergies and budget, plan a week of kit meals, quote weekly cost, compare kit tiers on your price and rating numbers, suggest swaps around avoids, and schedule deliveries. Planning only - it never orders anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://meal-kit-match.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "MealKitMatch")
- Machine manifest: https://meal-kit-match.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://meal-kit-match.magicteams.ai/.well-known/ucp

## Tools

- match_kits: Match kits — Rank meal kits against a diet/budget profile: matches with scores, rejections with reasons, and a pick.
- plan_week: Plan week — Plan a week of kit meals across days, flagging days short on servings.
- quote_week: Quote week — Quote a week of meal kits: per-meal math, food total, shipping and monthly estimate.
- compare_kit_tiers: Compare kit tiers — Rank 2-6 kit plans from your price and rating numbers: 60% rating, 40% price.
- suggest_swaps: Suggest swaps — Suggest swaps for meals clashing with avoids, naming a clean swap from the same list.
- delivery_schedule: Delivery schedule — Compute the next N delivery dates on a weekly cadence from a first delivery.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://meal-kit-match.magicteams.ai/support
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

Sitemap: https://meal-kit-match.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://meal-kit-match.magicteams.ai/</loc></url>
  <url><loc>https://meal-kit-match.magicteams.ai/privacy</loc></url>
  <url><loc>https://meal-kit-match.magicteams.ai/terms</loc></url>
  <url><loc>https://meal-kit-match.magicteams.ai/support</loc></url>
  <url><loc>https://meal-kit-match.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"MealKitMatch","version":"1.0.0","description":"Match meal kits to diets","url":"https://meal-kit-match.magicteams.ai","mcp_endpoint":"https://meal-kit-match.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"match_kits","title":"Match kits","description":"Rank meal kits against a diet/budget profile: matches with scores, rejections with reasons, and a pick."},{"name":"plan_week","title":"Plan week","description":"Plan a week of kit meals across days, flagging days short on servings."},{"name":"quote_week","title":"Quote week","description":"Quote a week of meal kits: per-meal math, food total, shipping and monthly estimate."},{"name":"compare_kit_tiers","title":"Compare kit tiers","description":"Rank 2-6 kit plans from your price and rating numbers: 60% rating, 40% price."},{"name":"suggest_swaps","title":"Suggest swaps","description":"Suggest swaps for meals clashing with avoids, naming a clean swap from the same list."},{"name":"delivery_schedule","title":"Delivery schedule","description":"Compute the next N delivery dates on a weekly cadence from a first delivery."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/meal-kit-match","smithery":"https://smithery.ai/servers/tradephani/meal-kit-match"},"llms_txt":"https://meal-kit-match.magicteams.ai/llms.txt","ucp_profile":"https://meal-kit-match.magicteams.ai/.well-known/ucp","support":"https://meal-kit-match.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "meal-kit-match", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202, headers: base });
    if (body.method === "tools/list")
      return json({ jsonrpc: "2.0", id: body.id, result: { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annot })) } }, 200, base);
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
