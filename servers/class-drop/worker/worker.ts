/** ClassDrop Worker - same engine, served directly. */
import {
  findClasses, quoteWeek, membershipBreakEven, buildBookingRequest, classReminders, weekPlan,
} from "../../mcp-server/src/classdrop.js";

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
  { name: "find_classes", title: "Find classes",
    description: "Filter a weekly class schedule by specific criteria. Use when needing to find classes by time or type. Avoid when needing to build a booking request, use build_booking_request.",
    inputSchema: { type: "object", properties: {
      schedule: { type: "array", description: "Weekly schedule to search", items: { type: "object" } },
      day: { type: "string", description: "Filter to a weekday" },
      type: { type: "string", description: "Filter to cardio, strength, mobility or sport" },
      intensity_max: { type: "number", description: "Max intensity 1-5" },
      after: { type: "string", description: "Only classes at or after HH:MM" },
      before: { type: "string", description: "Only classes at or before HH:MM" } }, required: ["schedule"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "results": {
         "type": "array",
         "description": "List of classes that match the search criteria",
         "items": {
          "type": "object",
          "properties": {
           "class_name": {
            "type": "string",
            "description": "The name of the class"
           },
           "class_type": {
            "type": "string",
            "description": "The type of the class (cardio, strength, mobility, sport)"
           },
           "day": {
            "type": "string",
            "description": "The day of the week the class is scheduled"
           },
           "time": {
            "type": "string",
            "description": "The time the class is scheduled"
           },
           "intensity": {
            "type": "number",
            "description": "The intensity level of the class (1-5)"
           }
          },
          "required": [
           "class_name",
           "class_type",
           "day",
           "time",
           "intensity"
          ]
         }
        }
       },
       "required": [
        "results"
       ]
      },
    annot: RO,
    run: (a: A) => findClasses(a as unknown as Parameters<typeof findClasses>[0]) },
  { name: "quote_week", title: "Quote week",
    description: "Calculate the total cost of a week's classes at drop-in rate. Use when needing a quick cost estimate for a week of drop-in classes; NOT when needing to find available classes, use find_classes.",
    inputSchema: { type: "object", properties: {
      schedule: { type: "array", description: "This week's classes", items: { type: "object" } },
      drop_in_usd: { type: "number", description: "Drop-in price per class in USD" } }, required: ["schedule", "drop_in_usd"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "week_total_usd": {
         "type": "number",
         "description": "The total cost for the week in USD."
        },
        "class_count": {
         "type": "integer",
         "description": "The number of classes scheduled for the week."
        }
       },
       "required": [
        "week_total_usd",
        "class_count"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "drop_in_usd", "num"); return quoteWeek(a as unknown as Parameters<typeof quoteWeek>[0]); } },
  { name: "membership_break_even", title: "Membership break-even",
    description: "Calculate the break-even number of monthly classes for memberships vs. drop-ins. Use when evaluating membership pricing strategy, NOT when forecasting weekly class attendance (use quote_week).",
    inputSchema: { type: "object", properties: {
      drop_in_usd: { type: "number", description: "Drop-in price per class in USD" },
      membership_usd: { type: "number", description: "Monthly membership price in USD" },
      classes_per_month: { type: "number", description: "Your monthly volume for a direct comparison" } }, required: ["drop_in_usd", "membership_usd"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "break_even_classes": {
         "type": "number",
         "description": "The number of classes per month at which the membership becomes more cost-effective than drop-ins."
        },
        "comparison": {
         "type": "object",
         "description": "Comparison of costs based on the provided monthly volume.",
         "properties": {
          "membership_cost": {
           "type": "number",
           "description": "The total cost of the membership for the given number of classes per month."
          },
          "drop_in_cost": {
           "type": "number",
           "description": "The total cost of drop-ins for the given number of classes per month."
          },
          "savings": {
           "type": "number",
           "description": "The savings achieved by choosing the membership over drop-ins for the given volume."
          }
         },
         "required": [
          "membership_cost",
          "drop_in_cost",
          "savings"
         ]
        }
       },
       "required": [
        "break_even_classes"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "drop_in_usd", "num"); req(a, "membership_usd", "num"); return membershipBreakEven(a as unknown as Parameters<typeof membershipBreakEven>[0]); } },
  { name: "build_booking_request", title: "Build booking request",
    description: "Create a booking-request message for a studio class. Use when you need a draft message to send to a studio. Do NOT use when you need to find available classes, use find_classes.",
    inputSchema: { type: "object", properties: {
      class_name: { type: "string", description: "Class to book" },
      date: { type: "string", description: "Date YYYY-MM-DD" },
      time: { type: "string", description: "Time HH:MM 24h" },
      name: { type: "string", description: "Your name" },
      party_size: { type: "number", description: "Spots to reserve, 1-10, default 1" } }, required: ["class_name", "date", "time", "name"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "message": {
         "type": "string",
         "description": "The draft booking-request message."
        },
        "class_name": {
         "type": "string",
         "description": "The name of the class to book."
        },
        "date": {
         "type": "string",
         "description": "The date of the class in YYYY-MM-DD format."
        },
        "time": {
         "type": "string",
         "description": "The time of the class in HH:MM 24h format."
        },
        "name": {
         "type": "string",
         "description": "The name of the person making the booking request."
        },
        "party_size": {
         "type": "number",
         "description": "The number of spots to reserve, between 1 and 10."
        }
       },
       "required": [
        "message",
        "class_name",
        "date",
        "time",
        "name",
        "party_size"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "class_name", "str"); req(a, "date", "str"); req(a, "time", "str"); req(a, "name", "str"); return buildBookingRequest(a as unknown as Parameters<typeof buildBookingRequest>[0]); } },
  { name: "class_reminders", title: "Class reminders",
    description: "Schedule reminders before each class. Use when you need to notify students before classes. Do NOT use when you need to find available classes, use find_classes.",
    inputSchema: { type: "object", properties: {
      sessions: { type: "array", description: "Upcoming classes", items: { type: "object" } },
      lead_hours: { type: "array", description: "Lead times in hours, default [12, 1]", items: { type: "number" } } }, required: ["sessions"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "sessions": {
         "type": "array",
         "description": "List of upcoming classes with their scheduled reminder times",
         "items": {
          "type": "object",
          "properties": {
           "class_id": {
            "type": "string",
            "description": "Unique identifier for the class"
           },
           "class_name": {
            "type": "string",
            "description": "Name of the class"
           },
           "start_time": {
            "type": "string",
            "format": "date-time",
            "description": "Scheduled start time of the class"
           },
           "reminders": {
            "type": "array",
            "description": "List of reminder times before the class starts",
            "items": {
             "type": "string",
             "format": "date-time",
             "description": "Scheduled reminder time"
            }
           }
          },
          "required": [
           "class_id",
           "class_name",
           "start_time",
           "reminders"
          ]
         }
        }
       },
       "required": [
        "sessions"
       ]
      },
    annot: RO,
    run: (a: A) => classReminders(a as unknown as Parameters<typeof classReminders>[0]) },
  { name: "week_plan", title: "Week plan",
    description: "Generate a balanced week plan from a schedule. Use when you need a structured plan for a week. Do NOT use when you need to find available classes, use find_classes.",
    inputSchema: { type: "object", properties: {
      schedule: { type: "array", description: "Weekly schedule to plan from", items: { type: "object" } },
      goal: { type: "string", description: "balanced, cardio or strength; default balanced" },
      max_classes: { type: "number", description: "Max classes, 1-14, default 5" } }, required: ["schedule"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "plan": {
         "type": "array",
         "description": "List of planned classes for the week",
         "items": {
          "type": "object",
          "properties": {
           "day": {
            "type": "string",
            "description": "Day of the week"
           },
           "time": {
            "type": "string",
            "description": "Time of the class"
           },
           "class_type": {
            "type": "string",
            "description": "Type of class (balanced, cardio, strength)"
           },
           "class_name": {
            "type": "string",
            "description": "Name of the class"
           }
          },
          "required": [
           "day",
           "time",
           "class_type",
           "class_name"
          ]
         }
        },
        "total_classes": {
         "type": "number",
         "description": "Total number of classes planned"
        },
        "goal": {
         "type": "string",
         "description": "Goal of the plan (balanced, cardio, strength)"
        }
       },
       "required": [
        "plan",
        "total_classes",
        "goal"
       ]
      },
    annot: RO,
    run: (a: A) => weekPlan(a as unknown as Parameters<typeof weekPlan>[0]) },
];

const INSTRUCTIONS = "ClassDrop plans fitness classes around a weekly schedule you provide: find classes by day, type or intensity, quote a week of drop-ins, compute the membership break-even, draft a booking request to send the studio, compute reminder times and build a balanced week plan. Planning only: it never books anything and holds no studio inventory. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - ClassDrop</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("ClassDrop", "<p>Plan fitness class weeks - served over MCP at /mcp. Schedule search, cost quotes, booking drafts, reminders.</p>"),
  "/privacy": page("Privacy Policy", "<p>ClassDrop computes class plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>ClassDrop provides planning estimates for informational purposes. It never books classes or processes payments. Verify studio prices and availability before paying. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan fitness class weeks"><title>ClassDrop — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;ClassDrop&quot;,&quot;url&quot;:&quot;https://class-drop.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan fitness class weeks&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>ClassDrop</h1><p>ClassDrop plans fitness classes around your weekly schedule: find classes by day, type or intensity, quote a week of drop-ins, compute the membership break-even, draft a booking request to send the studio, compute reminder times and build a balanced week plan. Planning only - it never books anything and holds no studio inventory.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://class-drop.magicteams.ai/mcp</code></p><p>Find <strong>ClassDrop</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>find_classes</code></td><td>Search a weekly class schedule by day, class type, max intensity or time window.</td></tr><tr><td><code>quote_week</code></td><td>Quote a week of classes at a drop-in rate: class count and week total.</td></tr><tr><td><code>membership_break_even</code></td><td>Compute how many classes a month justify a membership over drop-ins, with an optional comparison at your volume.</td></tr><tr><td><code>build_booking_request</code></td><td>Draft a booking-request message to send a studio: class, date, time, name and party size. Draft only, never sent.</td></tr><tr><td><code>class_reminders</code></td><td>Compute reminder datetimes before each class start from lead times in hours.</td></tr><tr><td><code>week_plan</code></td><td>Build a balanced week plan from a schedule for a goal: balanced, cardio or strength, capped at N classes.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# ClassDrop

> Plan fitness class weeks

ClassDrop plans fitness classes around your weekly schedule: find classes by day, type or intensity, quote a week of drop-ins, compute the membership break-even, draft a booking request to send the studio, compute reminder times and build a balanced week plan. Planning only - it never books anything and holds no studio inventory.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://class-drop.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "ClassDrop")
- Machine manifest: https://class-drop.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://class-drop.magicteams.ai/.well-known/ucp

## Tools

- find_classes: Find classes — Search a weekly class schedule by day, class type, max intensity or time window.
- quote_week: Quote week — Quote a week of classes at a drop-in rate: class count and week total.
- membership_break_even: Membership break-even — Compute how many classes a month justify a membership over drop-ins, with an optional comparison at your volume.
- build_booking_request: Build booking request — Draft a booking-request message to send a studio: class, date, time, name and party size. Draft only, never sent.
- class_reminders: Class reminders — Compute reminder datetimes before each class start from lead times in hours.
- week_plan: Week plan — Build a balanced week plan from a schedule for a goal: balanced, cardio or strength, capped at N classes.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://class-drop.magicteams.ai/support
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

Sitemap: https://class-drop.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://class-drop.magicteams.ai/</loc></url>
  <url><loc>https://class-drop.magicteams.ai/privacy</loc></url>
  <url><loc>https://class-drop.magicteams.ai/terms</loc></url>
  <url><loc>https://class-drop.magicteams.ai/support</loc></url>
  <url><loc>https://class-drop.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"ClassDrop","version":"1.0.0","description":"Plan fitness class weeks","url":"https://class-drop.magicteams.ai","mcp_endpoint":"https://class-drop.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"find_classes","title":"Find classes","description":"Search a weekly class schedule by day, class type, max intensity or time window."},{"name":"quote_week","title":"Quote week","description":"Quote a week of classes at a drop-in rate: class count and week total."},{"name":"membership_break_even","title":"Membership break-even","description":"Compute how many classes a month justify a membership over drop-ins, with an optional comparison at your volume."},{"name":"build_booking_request","title":"Build booking request","description":"Draft a booking-request message to send a studio: class, date, time, name and party size. Draft only, never sent."},{"name":"class_reminders","title":"Class reminders","description":"Compute reminder datetimes before each class start from lead times in hours."},{"name":"week_plan","title":"Week plan","description":"Build a balanced week plan from a schedule for a goal: balanced, cardio or strength, capped at N classes."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/class-drop","smithery":"https://smithery.ai/servers/tradephani/class-drop"},"llms_txt":"https://class-drop.magicteams.ai/llms.txt","ucp_profile":"https://class-drop.magicteams.ai/.well-known/ucp","support":"https://class-drop.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "class-drop", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
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
