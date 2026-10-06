/** PartyPlan Worker - same engine, served directly. */
import { headcountPlan, partyBudget, partyChecklist, partyTimeline } from "../../mcp-server/src/partyplan.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const ANNOT = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  if (t === "num" && typeof v !== "number") throw new Error(`'${k}' must be a number`);
  if (t === "arr" && !Array.isArray(v)) throw new Error(`'${k}' must be an array`);
  return v;
};

const TOOLS = [
  { name: "party_budget", title: "Party budget",
    description: "Calculate a party budget split across categories and per-guest spend. Use when planning what to spend before booking; use headcount_plan to estimate guest count.",
    inputSchema: { type: "object", properties: {
      budget: { type: "number", description: "Total party budget in USD" },
      guests: { type: "number", description: "Number of guests (1-500)" },
      style: { type: "string", enum: ["budget", "standard", "premium"], description: "Spending style, default standard" },
    }, required: ["budget", "guests"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "venue": { description: "Venue costs, including rental and any additional fees, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for the venue in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for venue selection"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "food_and_drink": { description: "Total cost for food and drinks, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for food and drink in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for food and drink selection"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "cake": { description: "Cost of the cake, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for the cake in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for cake selection"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "decorations": { description: "Total cost for decorations, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for decorations in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for decorations selection"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "entertainment": { description: "Cost for entertainment, such as DJ or band, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for entertainment in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for entertainment selection"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "favors": { description: "Total cost for party favors, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for favors in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for favors selection"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "contingency": { description: "Amount set aside for unexpected expenses, in ISO currency code",
         "type": "object",
         "properties": {
          "amount": {
           "type": "number",
           "description": "Amount allocated for contingency in USD"
          },
          "tip": {
           "type": "string",
           "description": "Tip for contingency planning"
          }
         },
         "required": [
          "amount",
          "tip"
         ]
        },
        "per_guest_spend": {
         "type": "number",
         "description": "Estimated spend per guest in USD"
        }
       },
       "required": [
        "venue",
        "food_and_drink",
        "cake",
        "decorations",
        "entertainment",
        "favors",
        "contingency",
        "per_guest_spend"
       ]
      },
    run: (a: A) => {
      req(a, "budget", "num"); req(a, "guests", "num");
      return partyBudget(a as unknown as Parameters<typeof partyBudget>[0]);
    } },
  { name: "headcount_plan", title: "Headcount plan",
    description: "Calculate expected attendance and shopping quantities from an invite list. Use when RSVPs start arriving; use party_budget to estimate costs.",
    inputSchema: { type: "object", properties: {
      invited: { type: "number", description: "People invited (1-1000)" },
      expected_decline_pct: { type: "number", description: "Expected share who decline, 0-100 (default 15)" },
      children_pct: { type: "number", description: "Share of attendees who are children, 0-100 (default 0)" },
    }, required: ["invited"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "expected_attendance": {
         "type": "integer",
         "description": "Estimated number of adults attending"
        },
        "expected_children": {
         "type": "integer",
         "description": "Estimated number of children attending"
        },
        "mains_portions": {
         "type": "integer",
         "description": "Number of main course portions needed"
        },
        "drinks": {
         "type": "integer",
         "description": "Number of drinks needed"
        },
        "cake_slices": {
         "type": "integer",
         "description": "Number of cake slices needed"
        },
        "favors": {
         "type": "integer",
         "description": "Number of favors needed"
        },
        "plates": {
         "type": "integer",
         "description": "Number of plates needed"
        }
       },
       "required": [
        "expected_attendance",
        "expected_children",
        "mains_portions",
        "drinks",
        "cake_slices",
        "favors",
        "plates"
       ]
      },
    run: (a: A) => {
      req(a, "invited", "num");
      return headcountPlan(a as unknown as Parameters<typeof headcountPlan>[0]);
    } },
  { name: "party_timeline", title: "Party timeline",
    description: "Generate a party timeline for a specific event date. Use when planning a party with multiple tasks. Do NOT use when budgeting for the party, use party_budget instead.",
    inputSchema: { type: "object", properties: {
      event_date: { type: "string", description: "Party date in YYYY-MM-DD format" },
      event_type: { type: "string", description: "Optional event label, e.g. 'birthday', 'bbq' or 'kids party'" },
      guests: { type: "number", description: "Optional guest count for cake sizing" },
    }, required: ["event_date"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "event_date": {
         "type": "string",
         "description": "The date of the party in YYYY-MM-DD format."
        },
        "event_type": {
         "type": "string",
         "description": "The type of event, e.g., 'birthday', 'bbq', or 'kids party'."
        },
        "guests": {
         "type": "number",
         "description": "The number of guests attending the party."
        },
        "timeline": {
         "type": "array",
         "description": "A list of milestones and tasks leading up to the party.",
         "items": {
          "type": "object",
          "properties": {
           "days_until": {
            "type": "number",
            "description": "The number of days until the party for this milestone."
           },
           "tasks": {
            "type": "object",
            "description": "A list of tasks to complete for this milestone.",
            "properties": {
             "venue": {
              "type": "array",
              "description": "Tasks related to the venue.",
              "items": {
               "type": "string"
              }
             },
             "invitations": {
              "type": "array",
              "description": "Tasks related to invitations.",
              "items": {
               "type": "string"
              }
             },
             "menu": {
              "type": "array",
              "description": "Tasks related to the menu.",
              "items": {
               "type": "string"
              }
             },
             "cake": {
              "type": "array",
              "description": "Tasks related to the cake.",
              "items": {
               "type": "string"
              }
             },
             "decorations": {
              "type": "array",
              "description": "Tasks related to decorations.",
              "items": {
               "type": "string"
              }
             },
             "confirmations": {
              "type": "array",
              "description": "Tasks related to confirmations.",
              "items": {
               "type": "string"
              }
             },
             "setup": {
              "type": "array",
              "description": "Tasks related to setup.",
              "items": {
               "type": "string"
              }
             },
             "run_sheet": {
              "type": "array",
              "description": "Tasks for the day-of run sheet.",
              "items": {
               "type": "string"
              }
             }
            }
           }
          }
         }
        }
       }
      },
    run: (a: A) => {
      req(a, "event_date", "str");
      return partyTimeline(a as unknown as Parameters<typeof partyTimeline>[0]);
    } },
  { name: "party_checklist", title: "Party checklist",
    description: "Generate a party checklist by category for a home or venue. Use when planning a party, NOT when planning a party budget.",
    inputSchema: { type: "object", properties: {
      venue: { type: "string", enum: ["home", "venue"], description: "Where the party happens" },
      extras: { type: "array", items: { type: "string" }, description: "Optional keywords such as 'pool', 'bbq', 'costume', 'outdoor'" },
    }, required: ["venue"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "food_and_drink": {
         "type": "array",
         "description": "List of food and drink items to prepare or purchase.",
         "items": {
          "type": "string"
         }
        },
        "decorations": {
         "type": "array",
         "description": "List of decoration items to prepare or purchase.",
         "items": {
          "type": "string"
         }
        },
        "music_and_activities": {
         "type": "array",
         "description": "List of music and activities to plan.",
         "items": {
          "type": "string"
         }
        },
        "practical_items": {
         "type": "array",
         "description": "List of practical items to prepare or purchase.",
         "items": {
          "type": "string"
         }
        },
        "safety_notes": {
         "type": "array",
         "description": "List of safety notes to consider.",
         "items": {
          "type": "string"
         }
        }
       },
       "required": [
        "food_and_drink",
        "decorations",
        "music_and_activities",
        "practical_items",
        "safety_notes"
       ]
      },
    run: (a: A) => {
      req(a, "venue", "str");
      return partyChecklist(a as unknown as Parameters<typeof partyChecklist>[0]);
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
const INSTRUCTIONS = "PartyPlan allocates a party budget across categories, turns an invite list into expected attendance and shopping quantities, builds a dated countdown timeline, and prepares a venue-aware checklist for home or venue parties. All maths only; nothing stored.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("PartyPlan", `<h1>PartyPlan</h1><p>Plan a party in four calls: allocate a budget, size the shopping from the invite list, work a dated countdown timeline and run a home-or-venue checklist - served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - PartyPlan", `<h1>Privacy Policy - PartyPlan</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Party details you provide (budget, guest counts, dates, checklist keywords) and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute budgets, quantities, timelines and checklists for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - PartyPlan", `<h1>Terms of Service - PartyPlan</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>PartyPlan performs arithmetic and drafting on the details you provide and is not a booking, catering or payment service; it does not reserve venues, order cakes or move money.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results or for third-party vendors you engage.</p>`),
  "/support": page("Support - PartyPlan", `<h1>Support - PartyPlan</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Party budgets and timelines"><title>PartyPlan — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;PartyPlan&quot;,&quot;url&quot;:&quot;https://party-plan.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;EntertainmentApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Party budgets and timelines&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>PartyPlan</h1><p>PartyPlan is the party planner's spreadsheet replacement: split a budget across venue, food and drink, cake, decorations, entertainment, favors and contingency (budget, standard or premium style); convert an invite list into expected attendance plus mains, drinks, cake slices, favors and plates with sensible buffers; generate a dated countdown timeline from T-42 days to the day itself; and build a checklist tailored to a home or venue party, including pool, bbq, costume, outdoor, kids, alcohol and potluck extras with safety notes. Pure arithmetic and drafting - no bookings and no payments.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://party-plan.magicteams.ai/mcp</code></p><p>Find <strong>PartyPlan</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>party_budget</code></td><td>Allocate a party budget across venue, food and drink, cake, decorations, entertainment, favors and contingency, with per-guest spend and category tips. Use when planning what to spend before booking; style picks the split (budget, standard or premium).</td></tr><tr><td><code>headcount_plan</code></td><td>Turn an invite list into expected attendance and shopping quantities: mains portions, drinks, cake slices, favors and plates with standard buffers. Use once RSVPs start arriving; attendance assumes adults only unless children_pct is given.</td></tr><tr><td><code>party_timeline</code></td><td>Build a countdown plan for a party date: dated milestones at T-42, T-28, T-21, T-14, T-7, T-3, T-1 days and the day itself, each with tasks covering venue, invitations, menu, cake, decorations, confirmations, setup and the day-of run sheet.</td></tr><tr><td><code>party_checklist</code></td><td>Build a checklist grouped by food and drink, decorations, music and activities, practical items and safety, tailored to a home or venue party. Optional extras keywords (pool, bbq, costume, outdoor, kids, alcohol, potluck) add specific items and safety notes.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# PartyPlan

> Party budgets and timelines

PartyPlan is the party planner's spreadsheet replacement: split a budget across venue, food and drink, cake, decorations, entertainment, favors and contingency (budget, standard or premium style); convert an invite list into expected attendance plus mains, drinks, cake slices, favors and plates with sensible buffers; generate a dated countdown timeline from T-42 days to the day itself; and build a checklist tailored to a home or venue party, including pool, bbq, costume, outdoor, kids, alcohol and potluck extras with safety notes. Pure arithmetic and drafting - no bookings and no payments.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://party-plan.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "PartyPlan")
- Machine manifest: https://party-plan.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://party-plan.magicteams.ai/.well-known/ucp

## Tools

- party_budget: Party budget — Allocate a party budget across venue, food and drink, cake, decorations, entertainment, favors and contingency, with per-guest spend and category tips. Use when planning what to spend before booking; style picks the split (budget, standard or premium).
- headcount_plan: Headcount plan — Turn an invite list into expected attendance and shopping quantities: mains portions, drinks, cake slices, favors and plates with standard buffers. Use once RSVPs start arriving; attendance assumes adults only unless children_pct is given.
- party_timeline: Party timeline — Build a countdown plan for a party date: dated milestones at T-42, T-28, T-21, T-14, T-7, T-3, T-1 days and the day itself, each with tasks covering venue, invitations, menu, cake, decorations, confirmations, setup and the day-of run sheet.
- party_checklist: Party checklist — Build a checklist grouped by food and drink, decorations, music and activities, practical items and safety, tailored to a home or venue party. Optional extras keywords (pool, bbq, costume, outdoor, kids, alcohol, potluck) add specific items and safety notes.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://party-plan.magicteams.ai/support
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

Sitemap: https://party-plan.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://party-plan.magicteams.ai/</loc></url>
  <url><loc>https://party-plan.magicteams.ai/privacy</loc></url>
  <url><loc>https://party-plan.magicteams.ai/terms</loc></url>
  <url><loc>https://party-plan.magicteams.ai/support</loc></url>
  <url><loc>https://party-plan.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"PartyPlan","version":"1.0.0","description":"Party budgets and timelines","url":"https://party-plan.magicteams.ai","mcp_endpoint":"https://party-plan.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"party_budget","title":"Party budget","description":"Allocate a party budget across venue, food and drink, cake, decorations, entertainment, favors and contingency, with per-guest spend and category tips. Use when planning what to spend before booking; style picks the split (budget, standard or premium)."},{"name":"headcount_plan","title":"Headcount plan","description":"Turn an invite list into expected attendance and shopping quantities: mains portions, drinks, cake slices, favors and plates with standard buffers. Use once RSVPs start arriving; attendance assumes adults only unless children_pct is given."},{"name":"party_timeline","title":"Party timeline","description":"Build a countdown plan for a party date: dated milestones at T-42, T-28, T-21, T-14, T-7, T-3, T-1 days and the day itself, each with tasks covering venue, invitations, menu, cake, decorations, confirmations, setup and the day-of run sheet."},{"name":"party_checklist","title":"Party checklist","description":"Build a checklist grouped by food and drink, decorations, music and activities, practical items and safety, tailored to a home or venue party. Optional extras keywords (pool, bbq, costume, outdoor, kids, alcohol, potluck) add specific items and safety notes."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/party-plan","smithery":"https://smithery.ai/servers/tradephani/party-plan"},"llms_txt":"https://party-plan.magicteams.ai/llms.txt","ucp_profile":"https://party-plan.magicteams.ai/.well-known/ucp","support":"https://party-plan.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ name: "PartyPlan MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "party-plan", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "party-plan", version: VERSION } },
      instructions: INSTRUCTIONS,
      ttlMs: 3600000,
      cacheScope: "public",
    } }, 200, cors(request));
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: { ...ANNOT } })) } }, 200, cors(request));
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
