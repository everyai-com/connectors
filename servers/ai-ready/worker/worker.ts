/** AIReady Worker - same engine, served directly. */
import {
  checkAiReadiness,
  crawlerPolicyGuide,
  llmsTxtDraft,
  robotsTxtForAi,
  schemaJsonldSample,
} from "../../mcp-server/src/aiready.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const ANNOT = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  return v;
};

const TOOLS = [
  { name: "check_ai_readiness", title: "Check AI readiness",
    description: "Scan a domain for AI discoverability: which AI crawlers robots.txt blocks or allows (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot...), llms.txt presence, sitemap, schema.org data, meta and Content Signals. Fetches only /robots.txt, /llms.txt, /sitemap.xml and the homepage over HTTPS.",
    inputSchema: { type: "object", properties: { domain: { type: "string", description: "Domain or URL, e.g. example.com" } }, required: ["domain"] },
    run: async (a: A) => {
      req(a, "domain", "str");
      return checkAiReadiness(a as unknown as Parameters<typeof checkAiReadiness>[0]);
    } },
  { name: "crawler_policy_guide", title: "Crawler policy guide",
    description: "Reference table of AI crawlers (owner, purpose, whether they drive AI visibility or training) with rules of thumb for allowing or blocking each.",
    inputSchema: { type: "object", properties: {}, required: [] },
    run: () => crawlerPolicyGuide() },
  { name: "robots_txt_for_ai", title: "Generate robots.txt for AI",
    description: "Generate robots.txt rules for a chosen AI policy (max visibility, search-only, block training, block all AI), optionally with Content-Signal lines and a sitemap reference.",
    inputSchema: { type: "object", properties: {
      policy: { type: "string", enum: ["max_visibility", "search_only", "block_training", "block_all_ai"] },
      sitemap_url: { type: "string" },
      content_signals: { type: "boolean" },
    }, required: ["policy"] },
    run: (a: A) => {
      req(a, "policy", "str");
      return robotsTxtForAi(a as unknown as Parameters<typeof robotsTxtForAi>[0]);
    } },
  { name: "llms_txt_draft", title: "Draft llms.txt",
    description: "Draft a starter llms.txt from your business name, one-line description, key pages and contact so AI agents get a curated summary of your site.",
    inputSchema: { type: "object", properties: {
      business_name: { type: "string" },
      description: { type: "string" },
      key_pages: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" }, note: { type: "string" } }, required: ["title", "url"] } },
      contact_email: { type: "string" },
    }, required: ["business_name", "description"] },
    run: (a: A) => {
      req(a, "business_name", "str"); req(a, "description", "str");
      return llmsTxtDraft(a as unknown as Parameters<typeof llmsTxtDraft>[0]);
    } },
  { name: "schema_jsonld_sample", title: "Generate JSON-LD sample",
    description: "Generate a schema.org JSON-LD snippet (Organization, LocalBusiness, Product or FAQ) to paste into your page head for AI identification.",
    inputSchema: { type: "object", properties: {
      type: { type: "string", enum: ["organization", "local_business", "product", "faq"] },
      name: { type: "string" },
      url: { type: "string" },
      description: { type: "string" },
      telephone: { type: "string" },
      address: { type: "string" },
      price: { type: "string" },
      questions: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
    }, required: ["type", "name", "url"] },
    run: (a: A) => {
      req(a, "type", "str"); req(a, "name", "str"); req(a, "url", "str");
      return schemaJsonldSample(a as unknown as Parameters<typeof schemaJsonldSample>[0]);
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
const INSTRUCTIONS = "AIReady measures and improves AI discoverability: scans AI crawler access, llms.txt, sitemap, structured data and Content Signals, and generates the fixes (robots.txt rules, llms.txt, JSON-LD). Informational, not legal advice.";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("AIReady", `<h1>AIReady</h1><p>Scan and improve how discoverable your site is to AI assistants: AI crawler access in robots.txt, llms.txt, sitemap, schema.org data and Content Signals - served over MCP at <code>/mcp</code>. The scan fetches only your domain's /robots.txt, /llms.txt, /sitemap.xml and homepage. Informational self-help; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - AIReady", `<h1>Privacy Policy - AIReady</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Domains you submit, the public files fetched from them (robots.txt, llms.txt, sitemap.xml, homepage) and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To compute readiness results for you; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Fetch results are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - AIReady", `<h1>Terms of Service - AIReady</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>AIReady reads publicly available files (robots.txt, llms.txt, sitemap.xml, homepage) from domains you submit and provides informational recommendations. It does not guarantee improvements in AI visibility or crawling, and it is not legal advice.</p><h2>2. Acceptable use</h2><p>Only scan domains you own or are authorised to assess. No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on computed results.</p>`),
  "/support": page("Support - AIReady", `<h1>Support - AIReady</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the domain you scanned. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Get found by AI assistants"><title>AIReady — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;AIReady&quot;,&quot;url&quot;:&quot;https://ai-ready.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;Developer ToolsApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Get found by AI assistants&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>AIReady</h1><p>AIReady checks whether AI assistants can find, read and cite your website: which AI crawlers (OAI-SearchBot, ClaudeBot, PerplexityBot, GPTBot...) your robots.txt allows or blocks, whether you have an llms.txt and sitemap, whether your pages carry schema.org structured data, and your Content Signals. It then generates the fixes: robots.txt AI rules for your chosen policy, a starter llms.txt and JSON-LD snippets. The scan fetches only the domain's robots.txt, llms.txt, sitemap.xml and homepage.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://ai-ready.magicteams.ai/mcp</code></p><p>Find <strong>AIReady</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>check_ai_readiness</code></td><td>Scan a domain for AI discoverability: which AI crawlers robots.txt blocks or allows (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot...), llms.txt presence, sitemap, schema.org data, meta and Content Signals. Fetches only /robots.txt, /llms.txt, /sitemap.xml and the homepage over HTTPS.</td></tr><tr><td><code>crawler_policy_guide</code></td><td>Reference table of AI crawlers (owner, purpose, whether they drive AI visibility or training) with rules of thumb for allowing or blocking each.</td></tr><tr><td><code>robots_txt_for_ai</code></td><td>Generate robots.txt rules for a chosen AI policy (max visibility, search-only, block training, block all AI), optionally with Content-Signal lines and a sitemap reference.</td></tr><tr><td><code>llms_txt_draft</code></td><td>Draft a starter llms.txt from your business name, one-line description, key pages and contact so AI agents get a curated summary of your site.</td></tr><tr><td><code>schema_jsonld_sample</code></td><td>Generate a schema.org JSON-LD snippet (Organization, LocalBusiness, Product or FAQ) to paste into your page head for AI identification.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# AIReady

> Get found by AI assistants

AIReady checks whether AI assistants can find, read and cite your website: which AI crawlers (OAI-SearchBot, ClaudeBot, PerplexityBot, GPTBot...) your robots.txt allows or blocks, whether you have an llms.txt and sitemap, whether your pages carry schema.org structured data, and your Content Signals. It then generates the fixes: robots.txt AI rules for your chosen policy, a starter llms.txt and JSON-LD snippets. The scan fetches only the domain's robots.txt, llms.txt, sitemap.xml and homepage.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://ai-ready.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "AIReady")
- Machine manifest: https://ai-ready.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://ai-ready.magicteams.ai/.well-known/ucp

## Tools

- check_ai_readiness: Check AI readiness — Scan a domain for AI discoverability: which AI crawlers robots.txt blocks or allows (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot...), llms.txt presence, sitemap, schema.org data, meta and Content Signals. Fetches only /robots.txt, /llms.txt, /sitemap.xml and the homepage over HTTPS.
- crawler_policy_guide: Crawler policy guide — Reference table of AI crawlers (owner, purpose, whether they drive AI visibility or training) with rules of thumb for allowing or blocking each.
- robots_txt_for_ai: Generate robots.txt for AI — Generate robots.txt rules for a chosen AI policy (max visibility, search-only, block training, block all AI), optionally with Content-Signal lines and a sitemap reference.
- llms_txt_draft: Draft llms.txt — Draft a starter llms.txt from your business name, one-line description, key pages and contact so AI agents get a curated summary of your site.
- schema_jsonld_sample: Generate JSON-LD sample — Generate a schema.org JSON-LD snippet (Organization, LocalBusiness, Product or FAQ) to paste into your page head for AI identification.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://ai-ready.magicteams.ai/support
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

Sitemap: https://ai-ready.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://ai-ready.magicteams.ai/</loc></url>
  <url><loc>https://ai-ready.magicteams.ai/privacy</loc></url>
  <url><loc>https://ai-ready.magicteams.ai/terms</loc></url>
  <url><loc>https://ai-ready.magicteams.ai/support</loc></url>
  <url><loc>https://ai-ready.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"AIReady","version":"1.0.0","description":"Get found by AI assistants","url":"https://ai-ready.magicteams.ai","mcp_endpoint":"https://ai-ready.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"check_ai_readiness","title":"Check AI readiness","description":"Scan a domain for AI discoverability: which AI crawlers robots.txt blocks or allows (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot...), llms.txt presence, sitemap, schema.org data, meta and Content Signals. Fetches only /robots.txt, /llms.txt, /sitemap.xml and the homepage over HTTPS."},{"name":"crawler_policy_guide","title":"Crawler policy guide","description":"Reference table of AI crawlers (owner, purpose, whether they drive AI visibility or training) with rules of thumb for allowing or blocking each."},{"name":"robots_txt_for_ai","title":"Generate robots.txt for AI","description":"Generate robots.txt rules for a chosen AI policy (max visibility, search-only, block training, block all AI), optionally with Content-Signal lines and a sitemap reference."},{"name":"llms_txt_draft","title":"Draft llms.txt","description":"Draft a starter llms.txt from your business name, one-line description, key pages and contact so AI agents get a curated summary of your site."},{"name":"schema_jsonld_sample","title":"Generate JSON-LD sample","description":"Generate a schema.org JSON-LD snippet (Organization, LocalBusiness, Product or FAQ) to paste into your page head for AI identification."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/ai-ready","smithery":"https://smithery.ai/servers/tradephani/ai-ready"},"llms_txt":"https://ai-ready.magicteams.ai/llms.txt","ucp_profile":"https://ai-ready.magicteams.ai/.well-known/ucp","support":"https://ai-ready.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, tools: 5 });
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
      return json({ name: "AIReady MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "ai-ready", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "ai-ready", version: VERSION } },
      instructions: INSTRUCTIONS,
      ttlMs: 3600000,
      cacheScope: "public",
    } }, 200, cors(request));
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...ANNOT } })) } }, 200, cors(request));
    if (body.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === body.params?.name);
      if (!tool) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool '${body.params?.name}'` } }, 200, cors(request));
      try {
        const out = await Promise.resolve(tool.run(body.params?.arguments ?? {}));
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }] } }, 200, cors(request));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool failed";
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: msg.startsWith("ERROR") ? msg : `ERROR ${msg}` }], isError: true } }, 200, cors(request));
      }
    }
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: `unsupported method '${body.method}'` } }, 200, cors(request));
  } catch { return json({ error: "bad request" }, 400); }
}

export default { async fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } } satisfies ExportedHandler<Env>;
