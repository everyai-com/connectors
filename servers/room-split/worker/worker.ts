/** RoomSplit Worker - same engine, served directly. */
import { roommateAgreement, settleUp, splitRent, splitUtilities } from "../../mcp-server/src/roomsplit.js";

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
  { name: "split_rent", title: "Split rent",
    description: "Split rent across rooms. Use when rent is fixed and needs dividing. Do NOT use when dividing variable costs like utilities; use split_utilities instead.",
    inputSchema: { type: "object", properties: {
      total_rent: { type: "number", description: "Monthly rent for the whole house" },
      rooms: { type: "array", items: { type: "object", properties: { name: { type: "string" }, size: { type: "number" }, occupants: { type: "array", items: { type: "string" } } }, required: ["name"] }, description: "Rooms in the house" },
      method: { type: "string", enum: ["equal", "by_size"], description: "Split method; default by_size when every room has a size, else equal" },
    }, required: ["total_rent", "rooms"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "total_rent": {
         "type": "number",
         "description": "The total monthly rent for the whole house."
        },
        "rooms": {
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "description": "The name of the room."
           },
           "size": {
            "type": "number",
            "description": "The size of the room."
           },
           "occupants": {
            "type": "array",
            "items": {
             "type": "object",
             "properties": {
              "name": {
               "type": "string",
               "description": "The name of the occupant."
              },
              "share": {
               "type": "number",
               "description": "The amount of rent this occupant owes."
              }
             },
             "required": [
              "name",
              "share"
             ]
            },
            "description": "The occupants of the room and their respective shares."
           },
           "share": {
            "type": "number",
            "description": "The amount of rent this room owes."
           }
          },
          "required": [
           "name",
           "share"
          ]
         },
         "description": "The rooms in the house and their respective shares."
        }
       },
       "required": [
        "total_rent",
        "rooms"
       ]
      },
    run: (a: A) => {
      req(a, "total_rent", "num"); req(a, "rooms", "arr");
      return splitRent(a as unknown as Parameters<typeof splitRent>[0]);
    } },
  { name: "split_utilities", title: "Split utilities",
    description: "Split utility bills among housemates. Use when bills are shared, not when splitting rent (use split_rent).",
    inputSchema: { type: "object", properties: {
      bills: { type: "array", items: { type: "object", properties: { name: { type: "string" }, amount: { type: "number" }, split: { type: "string", enum: ["equal", "by_occupants", "by_usage"] } }, required: ["name", "amount", "split"] }, description: "Bills to split" },
      people: { type: "array", items: { type: "object", properties: { name: { type: "string" }, occupants: { type: "number" }, usage_weight: { type: "number" } }, required: ["name"] }, description: "People sharing the house" },
    }, required: ["bills", "people"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "split_results": {
         "type": "array",
         "description": "List of split results for each person",
         "items": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "description": "Name of the person"
           },
           "total_owed": {
            "type": "number",
            "description": "Total amount owed by the person"
           },
           "bill_details": {
            "type": "array",
            "description": "Details of each bill and the person's share",
            "items": {
             "type": "object",
             "properties": {
              "bill_name": {
               "type": "string",
               "description": "Name of the bill"
              },
              "amount_owed": {
               "type": "number",
               "description": "Amount owed by the person for this bill"
              }
             },
             "required": [
              "bill_name",
              "amount_owed"
             ]
            }
           }
          },
          "required": [
           "name",
           "total_owed",
           "bill_details"
          ]
         }
        }
       },
       "required": [
        "split_results"
       ]
      },
    run: (a: A) => {
      req(a, "bills", "arr"); req(a, "people", "arr");
      return splitUtilities(a as unknown as Parameters<typeof splitUtilities>[0]);
    } },
  { name: "settle_up", title: "Settle up",
    description: "Calculate balances and minimal payments to settle shared household costs. Use when you need to resolve debts among housemates. Do NOT use when you need to create a roommate agreement; use roommate_agreement instead.",
    inputSchema: { type: "object", properties: {
      costs: { type: "array", items: { type: "object", properties: { name: { type: "string" }, amount: { type: "number" } }, required: ["name", "amount"] }, description: "Shared costs to split equally" },
      payments: { type: "array", items: { type: "object", properties: { name: { type: "string" }, paid: { type: "number" } }, required: ["name", "paid"] }, description: "What each housemate paid" },
    }, required: ["costs", "payments"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "balances": {
         "type": "array",
         "description": "List of balances for each housemate",
         "items": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "description": "The name of the housemate"
           },
           "balance": {
            "type": "number",
            "description": "The balance owed or due by the housemate"
           }
          },
          "required": [
           "name",
           "balance"
          ]
         }
        },
        "transactions": {
         "type": "array",
         "description": "List of transactions to settle the balances",
         "items": {
          "type": "object",
          "properties": {
           "from": {
            "type": "string",
            "description": "The name of the housemate paying"
           },
           "to": {
            "type": "string",
            "description": "The name of the housemate receiving the payment"
           },
           "amount": {
            "type": "number",
            "description": "The amount to be paid"
           }
          },
          "required": [
           "from",
           "to",
           "amount"
          ]
         }
        }
       },
       "required": [
        "balances",
        "transactions"
       ]
      },
    run: (a: A) => {
      req(a, "costs", "arr"); req(a, "payments", "arr");
      return settleUp(a as unknown as Parameters<typeof settleUp>[0]);
    } },
  { name: "roommate_agreement", title: "Roommate agreement",
    description: "Generate a shared-living agreement for tenants. Use when you need a comprehensive agreement. Do NOT use when you only need to split utilities.",
    inputSchema: { type: "object", properties: {
      property_address: { type: "string", description: "Address of the shared home" },
      tenants: { type: "array", items: { type: "string" }, description: "All tenants (at least 2)" },
      move_in_date: { type: "string", description: "Move-in date (YYYY-MM-DD)" },
      monthly_rent: { type: "number", description: "Total monthly rent" },
      deposit: { type: "number", description: "Deposit amount (0 if none)" },
      room_assignments: { type: "array", items: { type: "object", properties: { name: { type: "string" }, room: { type: "string" } }, required: ["name", "room"] }, description: "Who sleeps in which room" },
      utilities_policy: { type: "string", description: "How utilities are shared; default 'split equally unless agreed otherwise'" },
      notice_period_months: { type: "number", description: "Notice period in months, default 1" },
      house_rules: { type: "array", items: { type: "string" }, description: "Custom house rules; default covers quiet hours, guests, cleaning rota and shared supplies" },
    }, required: ["property_address", "tenants", "move_in_date", "monthly_rent", "deposit"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "agreement_text": {
         "type": "string",
         "description": "The full text of the roommate agreement in plain language."
        },
        "signature_blocks": {
         "type": "array",
         "items": {
          "type": "object",
          "properties": {
           "tenant_name": {
            "type": "string",
            "description": "The name of the tenant who needs to sign."
           },
           "signature_date": {
            "type": "string",
            "description": "The date on which the tenant should sign."
           }
          },
          "required": [
           "tenant_name",
           "signature_date"
          ]
         },
         "description": "The signature blocks for each tenant."
        }
       },
       "required": [
        "agreement_text",
        "signature_blocks"
       ]
      },
    run: (a: A) => {
      req(a, "property_address", "str"); req(a, "tenants", "arr"); req(a, "move_in_date", "str"); req(a, "monthly_rent", "num"); req(a, "deposit", "num");
      return roommateAgreement(a as unknown as Parameters<typeof roommateAgreement>[0]);
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
const INSTRUCTIONS = "RoomSplit handles the maths for house shares: split rent between rooms, split utility bills equally, by occupants or by usage, settle up shared costs between housemates, and draft a plain-language roommate agreement. All maths only; nothing stored.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("RoomSplit", `<h1>RoomSplit</h1><p>Split rent between rooms, split utility bills, settle up shared costs and draft a roommate agreement - served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - RoomSplit", `<h1>Privacy Policy - RoomSplit</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Housemate names and amounts you provide, and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute rent and utility splits, settle-up transfers and agreement drafts for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - RoomSplit", `<h1>Terms of Service - RoomSplit</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>RoomSplit performs arithmetic on the numbers you provide and drafts an informational shared-living template; it is not a payment service, does not move money or hold funds, and does not provide legal advice.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results.</p>`),
  "/support": page("Support - RoomSplit", `<h1>Support - RoomSplit</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Split rent and utilities"><title>RoomSplit — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;RoomSplit&quot;,&quot;url&quot;:&quot;https://room-split.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;FinanceApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Split rent and utilities&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>RoomSplit</h1><p>RoomSplit saves house shares the spreadsheet: split rent between rooms equally or by room size (and per occupant for shared rooms), split utility bills equally, by occupants or by usage, work out the fewest payments to settle shared costs, and draft a plain-language roommate agreement covering rent, deposit, utilities, house rules and notice. Pure arithmetic - no payments are processed.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://room-split.magicteams.ai/mcp</code></p><p>Find <strong>RoomSplit</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>split_rent</code></td><td>Split monthly rent across rooms - equally or by room size - showing each room's share and, for shared rooms, each occupant's share.</td></tr><tr><td><code>split_utilities</code></td><td>Split utility and household bills across housemates - equally, by occupants per room, or by usage - and total what each person owes.</td></tr><tr><td><code>settle_up</code></td><td>Given shared household costs and what each housemate already paid, compute balances and the minimal set of payments to settle everyone.</td></tr><tr><td><code>roommate_agreement</code></td><td>Draft a plain-language shared-living agreement: parties, term, rent split, deposit handling, utilities policy, house rules, notice period and signature blocks.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# RoomSplit

> Split rent and utilities

RoomSplit saves house shares the spreadsheet: split rent between rooms equally or by room size (and per occupant for shared rooms), split utility bills equally, by occupants or by usage, work out the fewest payments to settle shared costs, and draft a plain-language roommate agreement covering rent, deposit, utilities, house rules and notice. Pure arithmetic - no payments are processed.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://room-split.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "RoomSplit")
- Machine manifest: https://room-split.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://room-split.magicteams.ai/.well-known/ucp

## Tools

- split_rent: Split rent — Split monthly rent across rooms - equally or by room size - showing each room's share and, for shared rooms, each occupant's share.
- split_utilities: Split utilities — Split utility and household bills across housemates - equally, by occupants per room, or by usage - and total what each person owes.
- settle_up: Settle up — Given shared household costs and what each housemate already paid, compute balances and the minimal set of payments to settle everyone.
- roommate_agreement: Roommate agreement — Draft a plain-language shared-living agreement: parties, term, rent split, deposit handling, utilities policy, house rules, notice period and signature blocks.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://room-split.magicteams.ai/support
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

Sitemap: https://room-split.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://room-split.magicteams.ai/</loc></url>
  <url><loc>https://room-split.magicteams.ai/privacy</loc></url>
  <url><loc>https://room-split.magicteams.ai/terms</loc></url>
  <url><loc>https://room-split.magicteams.ai/support</loc></url>
  <url><loc>https://room-split.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"RoomSplit","version":"1.0.0","description":"Split rent and utilities","url":"https://room-split.magicteams.ai","mcp_endpoint":"https://room-split.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"split_rent","title":"Split rent","description":"Split monthly rent across rooms - equally or by room size - showing each room's share and, for shared rooms, each occupant's share."},{"name":"split_utilities","title":"Split utilities","description":"Split utility and household bills across housemates - equally, by occupants per room, or by usage - and total what each person owes."},{"name":"settle_up","title":"Settle up","description":"Given shared household costs and what each housemate already paid, compute balances and the minimal set of payments to settle everyone."},{"name":"roommate_agreement","title":"Roommate agreement","description":"Draft a plain-language shared-living agreement: parties, term, rent split, deposit handling, utilities policy, house rules, notice period and signature blocks."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/room-split","smithery":"https://smithery.ai/servers/tradephani/room-split"},"llms_txt":"https://room-split.magicteams.ai/llms.txt","ucp_profile":"https://room-split.magicteams.ai/.well-known/ucp","support":"https://room-split.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      return json({ name: "RoomSplit MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "room-split", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "room-split", version: VERSION } },
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
