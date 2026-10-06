/** HvacRescue Worker - same engine, served directly. */
import {
  triageSymptom, findSlots, quoteJob, compareTechs, buildDispatchRequest, tuneupSchedule,
} from "../../mcp-server/src/hvacrescue.js";

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
  { name: "triage_symptom", title: "Triage symptom",
    description: "Assess an HVAC symptom: severity, safety steps, likely causes and whether to call a pro. Use when a customer reports an issue. Do NOT use when scheduling a tune-up; use tuneup_schedule.",
    inputSchema: { type: "object", properties: {
      symptom: { type: "string", description: "gas_smell, burning_smell, no_cool, no_heat, strange_noise, water_leak or high_bill" },
      details: { type: "string", description: "Extra details from the caller" } }, required: ["symptom"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "severity": {
         "type": "string",
         "enum": [
          "emergency",
          "same_day",
          "routine"
         ],
         "description": "The urgency level of the symptom"
        },
        "safety_steps": {
         "type": "array",
         "items": {
          "type": "string"
         },
         "description": "List of safety steps to take immediately"
        },
        "likely_causes": {
         "type": "array",
         "items": {
          "type": "string"
         },
         "description": "Possible reasons for the symptom"
        },
        "call_pro": {
         "type": "boolean",
         "description": "Whether a professional should be called"
        },
        "additional_info": {
         "type": "string",
         "description": "Any extra information or advice based on the symptom and details provided"
        }
       },
       "required": [
        "severity",
        "safety_steps",
        "likely_causes",
        "call_pro"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "symptom", "str"); return triageSymptom(a as unknown as Parameters<typeof triageSymptom>[0]); } },
  { name: "find_slots", title: "Find slots",
    description: "Find open start times in availability windows that fit a job length, every 30 minutes. Use when you need to schedule a job within specific time constraints. Do NOT use when you need to diagnose a customer issue; use triage_symptom instead.",
    inputSchema: { type: "object", properties: {
      availability: { type: "array", description: "Tech availability windows", items: { type: "object" } },
      day: { type: "string", description: "Filter to a weekday" },
      duration_min: { type: "number", description: "Job length in minutes, 15-240, default 60" },
      after: { type: "string", description: "Only slots ending after HH:MM" },
      before: { type: "string", description: "Only slots starting before HH:MM" } }, required: ["availability"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "results": {
         "type": "array",
         "description": "List of available time slots",
         "items": {
          "type": "object",
          "properties": {
           "start_time": {
            "type": "string",
            "description": "The start time of the slot in HH:MM format"
           },
           "end_time": {
            "type": "string",
            "description": "The end time of the slot in HH:MM format"
           },
           "duration_min": {
            "type": "number",
            "description": "The duration of the slot in minutes"
           }
          },
          "required": [
           "start_time",
           "end_time",
           "duration_min"
          ]
         }
        }
       },
       "required": [
        "results"
       ]
      },
    annot: RO,
    run: (a: A) => findSlots(a as unknown as Parameters<typeof findSlots>[0]) },
  { name: "quote_job", title: "Quote job",
    description: "Calculate the price and time for an HVAC job with add-ons from a pricebook. Use when estimating costs for a job. Do NOT use when scheduling a job; use find_slots instead.",
    inputSchema: { type: "object", properties: {
      pricebook: { type: "array", description: "Tech pricebook", items: { type: "object" } },
      job: { type: "string", description: "Job to quote" },
      add_ons: { type: "array", description: "Add-on job names", items: { type: "string" } } }, required: ["pricebook", "job"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "job": {
         "type": "string",
         "description": "The name of the job being quoted"
        },
        "total_price": {
         "type": "number",
         "description": "The total price for the job including add-ons"
        },
        "total_minutes": {
         "type": "integer",
         "description": "The total estimated time in minutes for the job including add-ons"
        },
        "line_items": {
         "type": "array",
         "description": "The breakdown of the job and add-ons with their respective prices and times",
         "items": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "description": "The name of the job or add-on"
           },
           "price": {
            "type": "number",
            "description": "The price for the job or add-on"
           },
           "minutes": {
            "type": "integer",
            "description": "The estimated time in minutes for the job or add-on"
           }
          },
          "required": [
           "name",
           "price",
           "minutes"
          ]
         }
        }
       },
       "required": [
        "job",
        "total_price",
        "total_minutes",
        "line_items"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "job", "str"); return quoteJob(a as unknown as Parameters<typeof quoteJob>[0]); } },
  { name: "compare_techs", title: "Compare techs",
    description: "Rank HVAC techs by price, rating, and distance. Use when you need to prioritize techs for dispatch. NOT for scheduling tune-ups; use tuneup_schedule.",
    inputSchema: { type: "object", properties: {
      techs: { type: "array", description: "Techs to compare", items: { type: "object" } } }, required: ["techs"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "rankedTechs": {
         "type": "array",
         "description": "List of techs ranked by the specified criteria",
         "items": {
          "type": "object",
          "properties": {
           "techId": {
            "type": "string",
            "description": "Unique identifier for the tech"
           },
           "rank": {
            "type": "integer",
            "description": "Rank of the tech based on the criteria"
           },
           "rating": {
            "type": "number",
            "description": "Rating of the tech"
           },
           "price": {
            "type": "number",
            "description": "Price quoted by the tech"
           },
           "distance": {
            "type": "number",
            "description": "Distance of the tech from the job location"
           }
          },
          "required": [
           "techId",
           "rank",
           "rating",
           "price",
           "distance"
          ]
         }
        }
       },
       "required": [
        "rankedTechs"
       ]
      },
    annot: RO,
    run: (a: A) => compareTechs(a as unknown as Parameters<typeof compareTechs>[0]) },
  { name: "build_dispatch_request", title: "Build dispatch request",
    description: "Create a dispatch request for an HVAC tech: use when you have all the details and want to draft a request. Do NOT use when you need to find available time slots, use find_slots.",
    inputSchema: { type: "object", properties: {
      job: { type: "string", description: "Job needed" },
      date: { type: "string", description: "Date YYYY-MM-DD" },
      time: { type: "string", description: "Time HH:MM 24h" },
      name: { type: "string", description: "Your name" },
      phone: { type: "string", description: "Callback number" },
      units: { type: "number", description: "Systems, 1-10, default 1" } }, required: ["job", "date", "time", "name"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "message": {
         "type": "string",
         "description": "The draft dispatch request message."
        },
        "recipient": {
         "type": "string",
         "description": "The intended recipient of the dispatch request."
        },
        "details": {
         "type": "object",
         "description": "The details of the dispatch request.",
         "properties": {
          "job": {
           "type": "string",
           "description": "The job needed."
          },
          "date": {
           "type": "string",
           "description": "The date of the job in YYYY-MM-DD format."
          },
          "time": {
           "type": "string",
           "description": "The time of the job in HH:MM 24h format."
          },
          "name": {
           "type": "string",
           "description": "The name of the requester."
          },
          "phone": {
           "type": "string",
           "description": "The callback number for the requester."
          },
          "units": {
           "type": "number",
           "description": "The number of systems, between 1 and 10."
          }
         },
         "required": [
          "job",
          "date",
          "time",
          "name"
         ]
        }
       },
       "required": [
        "message",
        "recipient",
        "details"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "job", "str"); req(a, "date", "str"); req(a, "time", "str"); req(a, "name", "str"); return buildDispatchRequest(a as unknown as Parameters<typeof buildDispatchRequest>[0]); } },
  { name: "tuneup_schedule", title: "Tuneup schedule",
    description: "Schedule N HVAC tuneups every K months after a last tuneup. Use when planning maintenance; NOT for emergency repairs, use triage_symptom.",
    inputSchema: { type: "object", properties: {
      last_tuneup: { type: "string", description: "Last tuneup YYYY-MM-DD" },
      every_months: { type: "number", description: "Interval in months, 1-24, default 6" },
      count: { type: "number", description: "How many dates, 1-12, default 4" } }, required: ["last_tuneup"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "results": {
         "type": "array",
         "description": "List of tuneup schedule entries.",
         "items": {
          "type": "object",
          "properties": {
           "tuneup_date": {
            "type": "string",
            "description": "The scheduled tuneup date in YYYY-MM-DD format."
           },
           "day_of_week": {
            "type": "string",
            "description": "The day of the week for the scheduled tuneup."
           },
           "month": {
            "type": "number",
            "description": "The month of the year for the scheduled tuneup."
           },
           "year": {
            "type": "number",
            "description": "The year for the scheduled tuneup."
           }
          },
          "required": [
           "tuneup_date",
           "day_of_week",
           "month",
           "year"
          ]
         }
        }
       },
       "required": [
        "results"
       ]
      },
    annot: RO,
    run: (a: A) => { req(a, "last_tuneup", "str"); return tuneupSchedule(a as unknown as Parameters<typeof tuneupSchedule>[0]); } },
];

const INSTRUCTIONS = "HvacRescue plans HVAC rescue visits around symptoms and pricebooks you provide: triage symptoms with severity and safety steps (gas and electrical first), find open slots for a job length, quote jobs with add-ons, compare techs on your own price, rating and distance numbers, draft a dispatch request to send the tech, and plan tuneups. Planning only: it never books anything and holds no tech inventory. Pure computation; nothing stored.";

const encoder = new TextEncoder();
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...extra } });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - HvacRescue</title><style>body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6}</style></head><body><h1>${title}</h1>${body}<p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p></body></html>`;

const LEGAL_PAGES: Record<string, string> = {
  "/": page("HvacRescue", "<p>Plan HVAC rescue visits - served over MCP at /mcp. Symptom triage, slot finder, job quotes, tech compare.</p>"),
  "/privacy": page("Privacy Policy", "<p>HvacRescue computes visit plans per request. No accounts, no storage, no tracking. Request contents are processed in memory and never persisted. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
  "/terms": page("Terms of Service", "<p>HvacRescue provides planning estimates for informational purposes. It never books visits or processes payments. Gas smell or CO alarm: leave and call emergency services first. Provided as-is. Contact: support@magicteams.ai. Operated by MagicTeams.</p>"),
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
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Plan HVAC rescue visits"><title>HvacRescue — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;HvacRescue&quot;,&quot;url&quot;:&quot;https://hvacrescue.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Plan HVAC rescue visits&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>HvacRescue</h1><p>HvacRescue plans HVAC rescue visits around symptoms and pricebooks you provide: triage symptoms with severity and safety steps (gas and electrical first), find open slots for a job length, quote jobs with add-ons, compare techs on your price, rating and distance numbers, draft a dispatch request to send the tech, and plan tuneups. Planning only - it never books anything.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://hvacrescue.magicteams.ai/mcp</code></p><p>Find <strong>HvacRescue</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>triage_symptom</code></td><td>Triage an HVAC symptom: severity (emergency/same_day/routine), safety steps, likely causes and whether to call a pro.</td></tr><tr><td><code>find_slots</code></td><td>Find open start times in availability windows that fit a job length, every 30 minutes.</td></tr><tr><td><code>quote_job</code></td><td>Quote an HVAC job with add-ons from a pricebook: line items, total price and total minutes.</td></tr><tr><td><code>compare_techs</code></td><td>Rank 2-6 HVAC techs from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.</td></tr><tr><td><code>build_dispatch_request</code></td><td>Draft a dispatch-request message to send an HVAC tech: job, date, time, name and systems. Draft only, never sent.</td></tr><tr><td><code>tuneup_schedule</code></td><td>Compute the next N HVAC tuneup dates every K months after a last tuneup.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# HvacRescue

> Plan HVAC rescue visits

HvacRescue plans HVAC rescue visits around symptoms and pricebooks you provide: triage symptoms with severity and safety steps (gas and electrical first), find open slots for a job length, quote jobs with add-ons, compare techs on your price, rating and distance numbers, draft a dispatch request to send the tech, and plan tuneups. Planning only - it never books anything.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://hvacrescue.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "HvacRescue")
- Machine manifest: https://hvacrescue.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://hvacrescue.magicteams.ai/.well-known/ucp

## Tools

- triage_symptom: Triage symptom — Triage an HVAC symptom: severity (emergency/same_day/routine), safety steps, likely causes and whether to call a pro.
- find_slots: Find slots — Find open start times in availability windows that fit a job length, every 30 minutes.
- quote_job: Quote job — Quote an HVAC job with add-ons from a pricebook: line items, total price and total minutes.
- compare_techs: Compare techs — Rank 2-6 HVAC techs from your price, rating and distance numbers: 50% rating, 30% price, 20% distance.
- build_dispatch_request: Build dispatch request — Draft a dispatch-request message to send an HVAC tech: job, date, time, name and systems. Draft only, never sent.
- tuneup_schedule: Tuneup schedule — Compute the next N HVAC tuneup dates every K months after a last tuneup.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://hvacrescue.magicteams.ai/support
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

Sitemap: https://hvacrescue.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://hvacrescue.magicteams.ai/</loc></url>
  <url><loc>https://hvacrescue.magicteams.ai/privacy</loc></url>
  <url><loc>https://hvacrescue.magicteams.ai/terms</loc></url>
  <url><loc>https://hvacrescue.magicteams.ai/support</loc></url>
  <url><loc>https://hvacrescue.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"HvacRescue","version":"1.0.0","description":"Plan HVAC rescue visits","url":"https://hvacrescue.magicteams.ai","mcp_endpoint":"https://hvacrescue.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"triage_symptom","title":"Triage symptom","description":"Triage an HVAC symptom: severity (emergency/same_day/routine), safety steps, likely causes and whether to call a pro."},{"name":"find_slots","title":"Find slots","description":"Find open start times in availability windows that fit a job length, every 30 minutes."},{"name":"quote_job","title":"Quote job","description":"Quote an HVAC job with add-ons from a pricebook: line items, total price and total minutes."},{"name":"compare_techs","title":"Compare techs","description":"Rank 2-6 HVAC techs from your price, rating and distance numbers: 50% rating, 30% price, 20% distance."},{"name":"build_dispatch_request","title":"Build dispatch request","description":"Draft a dispatch-request message to send an HVAC tech: job, date, time, name and systems. Draft only, never sent."},{"name":"tuneup_schedule","title":"Tuneup schedule","description":"Compute the next N HVAC tuneup dates every K months after a last tuneup."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/hvacrescue","smithery":"https://smithery.ai/servers/tradephani/hvacrescue"},"llms_txt":"https://hvacrescue.magicteams.ai/llms.txt","ucp_profile":"https://hvacrescue.magicteams.ai/.well-known/ucp","support":"https://hvacrescue.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "hvacrescue", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS } }, 200, base);
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
