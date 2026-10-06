/** LeaseBreak Worker - same engine, served directly. */
import { compareOptions, estimateBreakCost, negotiationChecklist, noticeLetter } from "../../mcp-server/src/leasebreak.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const ANNOT = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  if (t === "num" && typeof v !== "number") throw new Error(`'${k}' must be a number`);
  return v;
};

const BREAK_PROPS = {
  monthly_rent: { type: "number", description: "Monthly rent" },
  months_remaining: { type: "number", description: "Months left on the lease (including the current one)" },
  deposit: { description: "Initial deposit amount as a number", type: "number" },
  break_fee_months: { type: "number", description: "Early-termination fee in months' rent" },
  notice_months: { description: "Number of months' notice required to terminate the lease", type: "number" },
  reletting_fee: { description: "Fee for reletting the property as a number", type: "number" },
  expected_relet_months: { description: "Expected months to relett the property as a number", type: "number" },
  landlord_mitigates: { description: "True if landlord mitigates damages, false otherwise", type: "boolean" },
  currency: { description: "Currency code in ISO 4217 format", type: "string" },
};

const TOOLS = [
  { name: "estimate_break_cost", title: "Estimate break cost",
    description: "Calculate break cost for a lease. Use when you need a detailed breakdown of early termination costs. Do NOT use when comparing different lease options; use compare_options instead.",
    inputSchema: { type: "object", properties: BREAK_PROPS, required: ["monthly_rent", "months_remaining"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "total_cost": {
         "type": "number",
         "description": "The total cost of breaking the lease."
        },
        "notice_period_rent": {
         "type": "number",
         "description": "The cost of rent during the notice period."
        },
        "break_fee": {
         "type": "number",
         "description": "The early-termination fee."
        },
        "reletting_fee": {
         "type": "number",
         "description": "The fee charged by the landlord or agent for re-letting the property."
        },
        "rent_until_relet": {
         "type": "number",
         "description": "The estimated rent cost until the property is re-let."
        },
        "deposit_credit": {
         "type": "number",
         "description": "The amount of deposit that will be returned."
        },
        "currency": {
         "type": "string",
         "description": "The currency in which the costs are calculated."
        },
        "cost_breakdown": {
         "type": "array",
         "description": "A detailed breakdown of the costs.",
         "items": {
          "type": "object",
          "properties": {
           "description": {
            "type": "string",
            "description": "A description of the cost item."
           },
           "amount": {
            "type": "number",
            "description": "The amount of the cost item."
           }
          },
          "required": [
           "description",
           "amount"
          ]
         }
        }
       },
       "required": [
        "total_cost",
        "notice_period_rent",
        "break_fee",
        "reletting_fee",
        "rent_until_relet",
        "deposit_credit",
        "currency",
        "cost_breakdown"
       ]
      },
    run: (a: A) => {
      req(a, "monthly_rent", "num"); req(a, "months_remaining", "num");
      return estimateBreakCost(a as unknown as Parameters<typeof estimateBreakCost>[0]);
    } },
  { name: "compare_options", title: "Compare options",
    description: "Calculate the net cost of breaking, subletting, or staying in a lease. Use when evaluating lease exit strategies. NOT for calculating break fees alone; use estimate_break_cost instead.",
    inputSchema: { type: "object", properties: {
      ...BREAK_PROPS,
      sublet_discount_pct: { description: "Percentage discount on rent when subletting, as a number 0-100", type: "number" },
      sublet_vacancy_months: { description: "Number of months the property may be vacant while subletting", type: "number" },
    }, required: ["monthly_rent", "months_remaining"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "break_lease": {
         "type": "object",
         "description": "Details about breaking the lease",
         "properties": {
          "total_cost": {
           "type": "number",
           "description": "Total cost of breaking the lease"
          },
          "break_fee": {
           "type": "number",
           "description": "Early-termination fee"
          },
          "notice_cost": {
           "type": "number",
           "description": "Cost associated with giving notice"
          },
          "reletting_fee": {
           "type": "number",
           "description": "Fee for finding a new tenant"
          },
          "remaining_rent": {
           "type": "number",
           "description": "Rent for the remaining months"
          },
          "risks": {
           "type": "array",
           "description": "Potential risks associated with breaking the lease",
           "items": {
            "type": "string"
           }
          }
         },
         "required": [
          "total_cost",
          "break_fee",
          "notice_cost",
          "reletting_fee",
          "remaining_rent",
          "risks"
         ]
        },
        "sublet": {
         "type": "object",
         "description": "Details about subletting the lease",
         "properties": {
          "total_cost": {
           "type": "number",
           "description": "Total cost of subletting"
          },
          "sublet_income": {
           "type": "number",
           "description": "Income from subletting"
          },
          "sublet_discount": {
           "type": "number",
           "description": "Discount applied to the sublet rent"
          },
          "vacancy_cost": {
           "type": "number",
           "description": "Cost associated with vacancy months"
          },
          "risks": {
           "type": "array",
           "description": "Potential risks associated with subletting",
           "items": {
            "type": "string"
           }
          }
         },
         "required": [
          "total_cost",
          "sublet_income",
          "sublet_discount",
          "vacancy_cost",
          "risks"
         ]
        },
        "stay_to_term": {
         "type": "object",
         "description": "Details about staying to the end of the lease term",
         "properties": {
          "total_cost": {
           "type": "number",
           "description": "Total cost of staying to the end of the lease term"
          },
          "remaining_rent": {
           "type": "number",
           "description": "Rent for the remaining months"
          },
          "risks": {
           "type": "array",
           "description": "Potential risks associated with staying to the end of the lease term",
           "items": {
            "type": "string"
           }
          }
         },
         "required": [
          "total_cost",
          "remaining_rent",
          "risks"
         ]
        }
       },
       "required": [
        "break_lease",
        "sublet",
        "stay_to_term"
       ]
      },
    run: (a: A) => {
      req(a, "monthly_rent", "num"); req(a, "months_remaining", "num");
      return compareOptions(a as unknown as Parameters<typeof compareOptions>[0]);
    } },
  { name: "notice_letter", title: "Notice letter",
    description: "Generate a formal early-termination notice letter for your lease. Use this when you need to formally notify your landlord of your intention to move out early. Do NOT use this when you need to estimate the financial impact of breaking your lease, use estimate_break_cost instead.",
    inputSchema: { type: "object", properties: {
      tenant_name: { description: "The name of the tenant", type: "string" },
      property_address: { description: "The address of the rental property", type: "string" },
      lease_date: { description: "The start date of the lease YYYY-MM-DD", type: "string" },
      notice_months: { description: "The number of months' notice required by the lease", type: "number" },
      intended_move_out_date: { type: "string", description: "YYYY-MM-DD" },
      break_fee_months: { description: "The number of months' rent as a break fee", type: "number" },
      monthly_rent: { description: "The monthly rent amount in USD", type: "number" },
      deposit: { description: "The security deposit amount in USD", type: "number" },
      landlord_name: { description: "The name of the landlord", type: "string" },
      reason: { description: "The reason for early termination", type: "string" },
    }, required: ["tenant_name", "property_address", "notice_months", "intended_move_out_date"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "letter": {
         "type": "string",
         "description": "The generated formal early-termination notice letter as a plain text string."
        },
        "tenant_name": {
         "type": "string",
         "description": "The name of the tenant who is terminating the lease."
        },
        "property_address": {
         "type": "string",
         "description": "The address of the property being vacated."
        },
        "lease_date": {
         "type": "string",
         "description": "The start date of the lease agreement."
        },
        "notice_months": {
         "type": "number",
         "description": "The number of months' notice being given for early termination."
        },
        "intended_move_out_date": {
         "type": "string",
         "description": "The intended move-out date in YYYY-MM-DD format."
        },
        "break_fee_months": {
         "type": "number",
         "description": "The number of months of rent that will be charged as a break fee."
        },
        "monthly_rent": {
         "type": "number",
         "description": "The monthly rent amount for the property."
        },
        "deposit": {
         "type": "number",
         "description": "The security deposit amount for the property."
        },
        "landlord_name": {
         "type": "string",
         "description": "The name of the landlord or property manager."
        },
        "reason": {
         "type": "string",
         "description": "The reason for early termination, if provided."
        }
       },
       "required": [
        "letter",
        "tenant_name",
        "property_address",
        "intended_move_out_date"
       ]
      },
    run: (a: A) => {
      req(a, "tenant_name", "str"); req(a, "property_address", "str"); req(a, "notice_months", "num"); req(a, "intended_move_out_date", "str");
      return noticeLetter(a as unknown as Parameters<typeof noticeLetter>[0]);
    } },
  { name: "negotiation_checklist", title: "Negotiation checklist",
    description: "Generate a negotiation plan for early lease termination, based on your specific situation. Use when you're ready to negotiate, NOT when estimating costs (use estimate_break_cost).",
    inputSchema: { type: "object", properties: {
      break_fee_months: { description: "Number of months' rent you must pay as a break fee", type: "number" },
      months_remaining: { description: "Number of months left on your lease", type: "number" },
      landlord_mitigates: { description: "True if landlord will try to mitigate damages, false otherwise", type: "boolean" },
      relet_demand: { description: "Local demand for reletting the property, e.g. high, medium, low", type: "string", enum: ["high", "medium", "low"] },
    }, required: [] },
      outputSchema: {
       "type": "object",
       "properties": {
        "steps": {
         "type": "array",
         "description": "Ordered list of negotiation steps.",
         "items": {
          "type": "object",
          "properties": {
           "step": {
            "type": "string",
            "description": "The specific action to take."
           },
           "details": {
            "type": "string",
            "description": "Additional information or considerations for the step."
           },
           "order": {
            "type": "number",
            "description": "The order in which the step should be taken."
           }
          },
          "required": [
           "step",
           "details",
           "order"
          ]
         }
        },
        "recommendations": {
         "type": "object",
         "description": "Additional recommendations based on the input parameters.",
         "properties": {
          "break_fee": {
           "type": "string",
           "description": "Recommendation on how to approach the break fee."
          },
          "relet_demand": {
           "type": "string",
           "description": "Recommendation based on the current relet demand."
          },
          "landlord_mitigation": {
           "type": "string",
           "description": "Recommendation based on whether the landlord can mitigate their losses."
          }
         },
         "required": [
          "break_fee",
          "relet_demand",
          "landlord_mitigation"
         ]
        }
       },
       "required": [
        "steps",
        "recommendations"
       ]
      },
    run: (a: A) => negotiationChecklist(a as unknown as Parameters<typeof negotiationChecklist>[0]) },
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
const INSTRUCTIONS = "LeaseBreak estimates early lease termination costs, compares breaking vs subletting vs staying, drafts notice letters and prepares negotiation checklists. Uses only the numbers you provide; informational, not legal advice.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("LeaseBreak", `<h1>LeaseBreak</h1><p>Early lease termination cost estimates, break-vs-sublet-vs-stay comparisons, notice letters and negotiation checklists - served over MCP at <code>/mcp</code>. Informational self-help, not legal advice. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - LeaseBreak", `<h1>Privacy Policy - LeaseBreak</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Lease and address details you provide and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute cost estimates and draft letters for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - LeaseBreak", `<h1>Terms of Service - LeaseBreak</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>LeaseBreak provides informational calculations and draft letters from the terms you provide. It is not a law firm and does not provide legal advice; verify your rights under local law before acting.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results.</p>`),
  "/support": page("Support - LeaseBreak", `<h1>Support - LeaseBreak</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Cost of breaking a lease"><title>LeaseBreak — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;LeaseBreak&quot;,&quot;url&quot;:&quot;https://lease-break.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;FinanceApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Cost of breaking a lease&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>LeaseBreak</h1><p>LeaseBreak turns an early move-out into numbers: what notice-period rent, break fees, re-letting costs and deposit returns add up to, whether subletting or staying is cheaper, a ready notice letter for the landlord, and a negotiation checklist tailored to your lease. Uses only the terms you provide - no legal advice, no payments.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://lease-break.magicteams.ai/mcp</code></p><p>Find <strong>LeaseBreak</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>estimate_break_cost</code></td><td>Itemised estimate of what ending a lease early costs: notice-period rent, break fee, re-letting fee, rent-until-relet and deposit credit.</td></tr><tr><td><code>compare_options</code></td><td>Compare breaking the lease vs subletting vs staying to term: net cost of each path with assumptions and risks.</td></tr><tr><td><code>notice_letter</code></td><td>Draft a formal early-termination notice letter with your lease details, intended move-out date and fee acknowledgment.</td></tr><tr><td><code>negotiation_checklist</code></td><td>A negotiation plan for leaving early: what to ask the landlord, in what order, tailored to your fee, remaining months and local demand.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# LeaseBreak

> Cost of breaking a lease

LeaseBreak turns an early move-out into numbers: what notice-period rent, break fees, re-letting costs and deposit returns add up to, whether subletting or staying is cheaper, a ready notice letter for the landlord, and a negotiation checklist tailored to your lease. Uses only the terms you provide - no legal advice, no payments.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://lease-break.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "LeaseBreak")
- Machine manifest: https://lease-break.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://lease-break.magicteams.ai/.well-known/ucp

## Tools

- estimate_break_cost: Estimate break cost — Itemised estimate of what ending a lease early costs: notice-period rent, break fee, re-letting fee, rent-until-relet and deposit credit.
- compare_options: Compare options — Compare breaking the lease vs subletting vs staying to term: net cost of each path with assumptions and risks.
- notice_letter: Notice letter — Draft a formal early-termination notice letter with your lease details, intended move-out date and fee acknowledgment.
- negotiation_checklist: Negotiation checklist — A negotiation plan for leaving early: what to ask the landlord, in what order, tailored to your fee, remaining months and local demand.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://lease-break.magicteams.ai/support
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

Sitemap: https://lease-break.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://lease-break.magicteams.ai/</loc></url>
  <url><loc>https://lease-break.magicteams.ai/privacy</loc></url>
  <url><loc>https://lease-break.magicteams.ai/terms</loc></url>
  <url><loc>https://lease-break.magicteams.ai/support</loc></url>
  <url><loc>https://lease-break.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"LeaseBreak","version":"1.0.0","description":"Cost of breaking a lease","url":"https://lease-break.magicteams.ai","mcp_endpoint":"https://lease-break.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"estimate_break_cost","title":"Estimate break cost","description":"Itemised estimate of what ending a lease early costs: notice-period rent, break fee, re-letting fee, rent-until-relet and deposit credit."},{"name":"compare_options","title":"Compare options","description":"Compare breaking the lease vs subletting vs staying to term: net cost of each path with assumptions and risks."},{"name":"notice_letter","title":"Notice letter","description":"Draft a formal early-termination notice letter with your lease details, intended move-out date and fee acknowledgment."},{"name":"negotiation_checklist","title":"Negotiation checklist","description":"A negotiation plan for leaving early: what to ask the landlord, in what order, tailored to your fee, remaining months and local demand."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/lease-break","smithery":"https://smithery.ai/servers/tradephani/lease-break"},"llms_txt":"https://lease-break.magicteams.ai/llms.txt","ucp_profile":"https://lease-break.magicteams.ai/.well-known/ucp","support":"https://lease-break.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ name: "LeaseBreak MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "lease-break", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "lease-break", version: VERSION } },
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
