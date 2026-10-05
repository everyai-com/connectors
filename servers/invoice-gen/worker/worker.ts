/** InvoiceGen Worker - same engine, served directly. */
import { CURRENCIES, calculateTotals, createInvoice, formatInvoicePlain } from "../../mcp-server/src/invoice.js";

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
const opt = (a: A, k: string) => a[k] as never;

const TOOLS = [
  { name: "create_invoice", title: "Create invoice",
    description: "Generate a complete invoice (number, dates, totals) from business, client and line items. Nothing stored.",
    inputSchema: { type: "object", properties: {
      business_name: { type: "string" }, client_name: { type: "string" },
      items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "number" } }, required: ["description", "quantity", "unit_price"] } },
      currency: { type: "string" }, tax_rate_pct: { type: "number" }, discount_pct: { type: "number" },
      invoice_number: { type: "string" }, notes: { type: "string" }, due_in_days: { type: "number" },
    }, required: ["business_name", "client_name", "items"] },
    run: (a: A) => createInvoice({ business_name: req(a, "business_name", "str") as string, client_name: req(a, "client_name", "str") as string, items: req(a, "items", "arr") as never, currency: opt(a, "currency"), tax_rate_pct: opt(a, "tax_rate_pct"), discount_pct: opt(a, "discount_pct"), invoice_number: opt(a, "invoice_number"), notes: opt(a, "notes"), due_in_days: opt(a, "due_in_days") }) },
  { name: "calculate_totals", title: "Calculate totals",
    description: "Subtotal, discount, tax and total for line items.",
    inputSchema: { type: "object", properties: { items: { type: "array" }, tax_rate_pct: { type: "number" }, discount_pct: { type: "number" } }, required: ["items"] },
    run: (a: A) => calculateTotals(req(a, "items", "arr") as never, (a.tax_rate_pct as number) ?? 0, (a.discount_pct as number) ?? 0) },
  { name: "supported_currencies", title: "Supported currencies",
    description: "List supported invoice currencies with symbols.",
    inputSchema: { type: "object", properties: {} },
    run: () => ({ currencies: CURRENCIES }) },
  { name: "render_invoice_text", title: "Render invoice text",
    description: "Rebuild + render an invoice as plain text (same inputs as create_invoice).",
    inputSchema: { type: "object", properties: {
      business_name: { type: "string" }, client_name: { type: "string" }, items: { type: "array" },
      currency: { type: "string" }, tax_rate_pct: { type: "number" }, discount_pct: { type: "number" },
      invoice_number: { type: "string" }, notes: { type: "string" }, due_in_days: { type: "number" },
    }, required: ["business_name", "client_name", "items"] },
    run: (a: A) => ({ text: formatInvoicePlain(createInvoice({ business_name: req(a, "business_name", "str") as string, client_name: req(a, "client_name", "str") as string, items: req(a, "items", "arr") as never, currency: opt(a, "currency"), tax_rate_pct: opt(a, "tax_rate_pct"), discount_pct: opt(a, "discount_pct"), invoice_number: opt(a, "invoice_number"), notes: opt(a, "notes"), due_in_days: opt(a, "due_in_days") })) }) },
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
  "/": page("InvoiceGen", `<h1>InvoiceGen</h1><p>Freelancer invoice computation (totals, GST-style tax, discounts, plain-text rendering), served over MCP at <code>/mcp</code>. Computed per request; nothing stored. Not tax advice.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - InvoiceGen", `<h1>Privacy Policy - InvoiceGen</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-02</p><h2>1. Data we process</h2><p>Invoice inputs you provide (business and client names, line items, rates) and technical logs (timestamps, tool names, error codes) for reliability and abuse prevention. No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute invoice totals and render text; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - InvoiceGen", `<h1>Terms of Service - InvoiceGen</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-02</p><h2>1. Service</h2><p>InvoiceGen computes invoice totals and renders plain-text invoices. It is a calculation tool, not tax or accounting advice; verify figures with a qualified accountant.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for billing errors or decisions made based on computed figures.</p>`),
  "/support": page("Support - InvoiceGen", `<h1>Support - InvoiceGen</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Invoices for freelancers, fast"><title>InvoiceGen — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;InvoiceGen&quot;,&quot;url&quot;:&quot;https://invoice-gen.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;Business &amp; OperationsApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Invoices for freelancers, fast&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>InvoiceGen</h1><p>InvoiceGen builds freelancer invoices from a plain-language description: numbered invoices with dates, line items, discounts, GST-style tax, and due dates, plus totals math, multi-currency support, and plain-text rendering. Everything is computed per request and nothing is stored. A calculation tool, not tax or accounting advice.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://invoice-gen.magicteams.ai/mcp</code></p><p>Find <strong>InvoiceGen</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>create_invoice</code></td><td>Generate a complete invoice (number, dates, totals) from business, client and line items. Nothing stored.</td></tr><tr><td><code>calculate_totals</code></td><td>Subtotal, discount, tax and total for line items.</td></tr><tr><td><code>supported_currencies</code></td><td>List supported invoice currencies with symbols.</td></tr><tr><td><code>render_invoice_text</code></td><td>Rebuild + render an invoice as plain text (same inputs as create_invoice).</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# InvoiceGen

> Invoices for freelancers, fast

InvoiceGen builds freelancer invoices from a plain-language description: numbered invoices with dates, line items, discounts, GST-style tax, and due dates, plus totals math, multi-currency support, and plain-text rendering. Everything is computed per request and nothing is stored. A calculation tool, not tax or accounting advice.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://invoice-gen.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "InvoiceGen")
- Machine manifest: https://invoice-gen.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://invoice-gen.magicteams.ai/.well-known/ucp

## Tools

- create_invoice: Create invoice — Generate a complete invoice (number, dates, totals) from business, client and line items. Nothing stored.
- calculate_totals: Calculate totals — Subtotal, discount, tax and total for line items.
- supported_currencies: Supported currencies — List supported invoice currencies with symbols.
- render_invoice_text: Render invoice text — Rebuild + render an invoice as plain text (same inputs as create_invoice).

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://invoice-gen.magicteams.ai/support
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

Sitemap: https://invoice-gen.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://invoice-gen.magicteams.ai/</loc></url>
  <url><loc>https://invoice-gen.magicteams.ai/privacy</loc></url>
  <url><loc>https://invoice-gen.magicteams.ai/terms</loc></url>
  <url><loc>https://invoice-gen.magicteams.ai/support</loc></url>
  <url><loc>https://invoice-gen.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"InvoiceGen","version":"1.0.0","description":"Invoices for freelancers, fast","url":"https://invoice-gen.magicteams.ai","mcp_endpoint":"https://invoice-gen.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"create_invoice","title":"Create invoice","description":"Generate a complete invoice (number, dates, totals) from business, client and line items. Nothing stored."},{"name":"calculate_totals","title":"Calculate totals","description":"Subtotal, discount, tax and total for line items."},{"name":"supported_currencies","title":"Supported currencies","description":"List supported invoice currencies with symbols."},{"name":"render_invoice_text","title":"Render invoice text","description":"Rebuild + render an invoice as plain text (same inputs as create_invoice)."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/invoice-gen","smithery":"https://smithery.ai/servers/tradephani/invoice-gen"},"llms_txt":"https://invoice-gen.magicteams.ai/llms.txt","ucp_profile":"https://invoice-gen.magicteams.ai/.well-known/ucp","support":"https://invoice-gen.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      // No SSE streams here: 405 is the spec-correct refusal (else SSE parsers break on JSON).
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("SSE streams not supported; use POST with application/json",
          { status: 405, headers: { Allow: "POST", ...cors(request) } });
      return json({ name: "InvoiceGen MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "invoice-gen", version: VERSION },
      instructions: "InvoiceGen creates freelancer invoices. Computed per request, nothing stored. No tax advice.",
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "invoice-gen", version: VERSION } },
      instructions: "InvoiceGen creates freelancer invoices. Computed per request, nothing stored. No tax advice.",
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
