/** SheetShift Worker - same engine, served directly. */
import { cleanTable, columnStats, convertTable, splitColumn } from "../../mcp-server/src/sheet.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; }
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const ANNOT = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  if (t === "arr" && !Array.isArray(v)) throw new Error(`'${k}' must be an array`);
  return v;
};
const optStr = (a: A, k: string, dflt?: string) => (typeof a[k] === "string" ? a[k] as string : dflt);
const optBool = (a: A, k: string) => (typeof a[k] === "boolean" ? a[k] as boolean : undefined);

const TOOLS = [
  { name: "convert_table", title: "Convert table",
    description: "Convert a table string between CSV, TSV, JSON and Markdown. Use when you need to change the table format. Do NOT use when you need to clean the table; use clean_table instead.",
    inputSchema: { type: "object", properties: { data: { description: "The data for this request.", type: "string" }, from_format: { description: "The from format for this request.", type: "string" }, to_format: { description: "The to format for this request.", type: "string" } }, required: ["data", "from_format", "to_format"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "converted_data": {
         "type": "string",
         "description": "The table data converted to the specified format."
        },
        "from_format": {
         "type": "string",
         "description": "The original format of the table data."
        },
        "to_format": {
         "type": "string",
         "description": "The format the table data was converted to."
        }
       },
       "required": [
        "converted_data",
        "from_format",
        "to_format"
       ]
      },
    run: (a: A) => convertTable(req(a, "data", "str") as string, req(a, "from_format", "str") as string, req(a, "to_format", "str") as string) },
  { name: "clean_table", title: "Clean table",
    description: "Clean a table string by trimming cells, dropping empty rows, and deduplicating rows. Use when preparing data for analysis; NOT for transforming data types. Use convert_table to change data types.",
    inputSchema: { type: "object", properties: { data: { description: "The data for this request.", type: "string" }, format: { description: "The format for this request.", type: "string" }, trim: { description: "Set true to enable trim; false otherwise.", type: "boolean" }, drop_empty_rows: { description: "Set true to enable drop empty rows; false otherwise.", type: "boolean" }, dedupe: { description: "Set true to enable dedupe; false otherwise.", type: "boolean" } }, required: ["data"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "cleaned_data": {
         "type": "string",
         "description": "The cleaned table string with trimmed cells, empty rows dropped, and duplicate rows removed."
        },
        "rows_dropped": {
         "type": "integer",
         "description": "The number of empty rows that were dropped from the table."
        },
        "rows_duplicated": {
         "type": "integer",
         "description": "The number of duplicate rows that were removed from the table."
        }
       },
       "required": [
        "cleaned_data"
       ]
      },
    run: (a: A) => cleanTable(req(a, "data", "str") as string, optStr(a, "format", "csv")!, { trim: optBool(a, "trim"), drop_empty_rows: optBool(a, "drop_empty_rows"), dedupe: optBool(a, "dedupe") }) },
  { name: "column_stats", title: "Column stats",
    description: "Calculate statistics over one column in a table. Use when needing summary statistics for a single column; NOT for multi-column analysis. Use 'convert_table' for transformations.",
    inputSchema: { type: "object", properties: { data: { description: "The data for this request.", type: "string" }, format: { description: "The format for this request.", type: "string" }, column: { description: "The column for this request.", type: "string" }, op: { description: "The op for this request.", type: "string" } }, required: ["data", "column", "op"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "sum": {
         "type": "number",
         "description": "The sum of the values in the specified column."
        },
        "avg": {
         "type": "number",
         "description": "The average of the values in the specified column."
        },
        "min": {
         "type": "number",
         "description": "The minimum value in the specified column."
        },
        "max": {
         "type": "number",
         "description": "The maximum value in the specified column."
        },
        "count": {
         "type": "integer",
         "description": "The number of values in the specified column."
        },
        "distinct": {
         "type": "integer",
         "description": "The number of distinct values in the specified column."
        }
       },
       "required": [
        "sum",
        "avg",
        "min",
        "max",
        "count",
        "distinct"
       ]
      },
    run: (a: A) => columnStats(req(a, "data", "str") as string, optStr(a, "format", "csv")!, req(a, "column", "str") as string, req(a, "op", "str") as string) },
  { name: "split_column", title: "Split column",
    description: "Split a column into multiple columns by a delimiter. Use when you need to divide a single column into multiple columns based on a specific delimiter. Do NOT use when you need to convert data types or clean data; use convert_table or clean_table instead.",
    inputSchema: { type: "object", properties: { data: { description: "The data for this request.", type: "string" }, format: { description: "The format for this request.", type: "string" }, column: { description: "The column for this request.", type: "string" }, delimiter: { description: "The delimiter for this request.", type: "string" }, new_names: { description: "List of new names values.", type: "array", items: { type: "string" } } }, required: ["data", "column", "delimiter"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "data": {
         "type": "string",
         "description": "The modified data string with the column split into new columns."
        },
        "new_columns": {
         "type": "array",
         "items": {
          "type": "string"
         },
         "description": "An array of new column names created from the split operation."
        },
        "status": {
         "type": "string",
         "description": "The status of the operation, indicating whether it was successful or if there were any errors."
        },
        "errors": {
         "type": "array",
         "items": {
          "type": "string"
         },
         "description": "An array of error messages, if any, encountered during the split operation."
        }
       },
       "required": [
        "data",
        "new_columns",
        "status"
       ]
      },
    run: (a: A) => splitColumn(req(a, "data", "str") as string, optStr(a, "format", "csv")!, req(a, "column", "str") as string, req(a, "delimiter", "str") as string, a.new_names as string[] | undefined) },
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
const INSTRUCTIONS = "SheetShift converts and cleans tables. Computed per request, nothing stored.";
// Directory-required pages (ChatGPT/Claude/Muse listings link here).
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("SheetShift", `<h1>SheetShift</h1><p>Table conversion and cleaning (CSV/TSV/JSON/Markdown, dedupe, column stats, splits), served over MCP at <code>/mcp</code>. Computed per request; nothing stored.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - SheetShift", `<h1>Privacy Policy - SheetShift</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-02</p><h2>1. Data we process</h2><p>Table inputs you provide and technical logs (timestamps, tool names, error codes) for reliability and abuse prevention. No accounts, no profiles.</p><h2>2. How we use it</h2><p>To convert and clean tables; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Inputs are processed per request and are not stored. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - SheetShift", `<h1>Terms of Service - SheetShift</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-02</p><h2>1. Service</h2><p>SheetShift converts and cleans table data from your inputs. It is a formatting tool; you are responsible for verifying converted output before use.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or unlawful use. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for decisions made based on converted data.</p>`),
  "/support": page("Support - SheetShift", `<h1>Support - SheetShift</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Convert and clean tables"><title>SheetShift — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;SheetShift&quot;,&quot;url&quot;:&quot;https://sheet-shift.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;ProductivityApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Convert and clean tables&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>SheetShift</h1><p>SheetShift converts pasted tables between CSV, TSV, JSON and Markdown, cleans messy sheets (trim, drop empties, dedupe), computes column stats (sum, average, min, max, count, distinct), and splits columns on delimiters. Everything is computed per request and nothing is stored.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://sheet-shift.magicteams.ai/mcp</code></p><p>Find <strong>SheetShift</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>convert_table</code></td><td>Convert a table string between CSV, TSV, JSON and Markdown.</td></tr><tr><td><code>clean_table</code></td><td>Trim cells, drop empty rows, dedupe rows in a table string.</td></tr><tr><td><code>column_stats</code></td><td>Sum/avg/min/max/count/distinct over one column (name or 0-based index).</td></tr><tr><td><code>split_column</code></td><td>Split one column on a delimiter into new columns.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# SheetShift

> Convert and clean tables

SheetShift converts pasted tables between CSV, TSV, JSON and Markdown, cleans messy sheets (trim, drop empties, dedupe), computes column stats (sum, average, min, max, count, distinct), and splits columns on delimiters. Everything is computed per request and nothing is stored.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://sheet-shift.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "SheetShift")
- Machine manifest: https://sheet-shift.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://sheet-shift.magicteams.ai/.well-known/ucp

## Tools

- convert_table: Convert table — Convert a table string between CSV, TSV, JSON and Markdown.
- clean_table: Clean table — Trim cells, drop empty rows, dedupe rows in a table string.
- column_stats: Column stats — Sum/avg/min/max/count/distinct over one column (name or 0-based index).
- split_column: Split column — Split one column on a delimiter into new columns.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://sheet-shift.magicteams.ai/support
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

Sitemap: https://sheet-shift.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://sheet-shift.magicteams.ai/</loc></url>
  <url><loc>https://sheet-shift.magicteams.ai/privacy</loc></url>
  <url><loc>https://sheet-shift.magicteams.ai/terms</loc></url>
  <url><loc>https://sheet-shift.magicteams.ai/support</loc></url>
  <url><loc>https://sheet-shift.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"SheetShift","version":"1.0.0","description":"Convert and clean tables","url":"https://sheet-shift.magicteams.ai","mcp_endpoint":"https://sheet-shift.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"convert_table","title":"Convert table","description":"Convert a table string between CSV, TSV, JSON and Markdown."},{"name":"clean_table","title":"Clean table","description":"Trim cells, drop empty rows, dedupe rows in a table string."},{"name":"column_stats","title":"Column stats","description":"Sum/avg/min/max/count/distinct over one column (name or 0-based index)."},{"name":"split_column","title":"Split column","description":"Split one column on a delimiter into new columns."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/sheet-shift","smithery":"https://smithery.ai/servers/tradephani/sheet-shift"},"llms_txt":"https://sheet-shift.magicteams.ai/llms.txt","ucp_profile":"https://sheet-shift.magicteams.ai/.well-known/ucp","support":"https://sheet-shift.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
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
      // No SSE streams here: 405 is the spec-correct refusal (else SSE parsers break on JSON).
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("SSE streams not supported; use POST with application/json",
          { status: 405, headers: { Allow: "POST", ...cors(request) } });
      return json({ name: "SheetShift MCP", transport: "Streamable HTTP (JSON response profile)",
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
      serverInfo: { name: "sheet-shift", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "sheet-shift", version: VERSION } },
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
