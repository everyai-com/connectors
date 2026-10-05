/**
 * AIReady MCP server - AI discoverability toolkit: readiness scan (robots/llms/sitemap/
 * structured data), crawler policy reference, robots.txt + llms.txt + JSON-LD generators.
 * Four tools are pure computation; check_ai_readiness fetches only the given domain's
 * /robots.txt, /llms.txt, /sitemap.xml and homepage.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  checkAiReadiness,
  crawlerPolicyGuide,
  llmsTxtDraft,
  robotsTxtForAi,
  schemaJsonldSample,
} from "./aiready.js";

const PORT = Number(process.env.PORT ?? 3009);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

function wrap(fn: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "computation failed";
    return { content: [{ type: "text" as const, text: `ERROR ${msg}` }], isError: true };
  }
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "ai-ready", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "AIReady measures and improves how discoverable a website is to AI assistants: scans robots.txt/llms.txt/" +
        "sitemap/structured data for AI crawler access, and generates the fixes (robots.txt AI rules, llms.txt, JSON-LD). " +
        "The scan fetches only the supplied domain's /robots.txt, /llms.txt, /sitemap.xml and homepage. Informational, not legal advice.",
    },
  );

  server.tool(
    "check_ai_readiness",
    "Scan a domain for AI discoverability: which AI crawlers robots.txt blocks or allows (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot...), llms.txt presence, sitemap, schema.org data, meta and Content Signals. Fetches only /robots.txt, /llms.txt, /sitemap.xml and the homepage over HTTPS.",
    { domain: z.string().describe("Domain or URL, e.g. example.com or https://example.com") },
    { title: "Check AI readiness", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (a) => wrap(() => checkAiReadiness(a)),
  );

  server.tool(
    "crawler_policy_guide",
    "Reference table of AI crawlers (owner, purpose, whether they drive AI visibility or training) with rules of thumb for allowing or blocking each.",
    {},
    { title: "Crawler policy guide", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async () => wrap(() => crawlerPolicyGuide()),
  );

  server.tool(
    "robots_txt_for_ai",
    "Generate robots.txt rules for a chosen AI policy (max visibility, search-only, block training, block all AI), optionally with Content-Signal lines and a sitemap reference.",
    {
      policy: z.enum(["max_visibility", "search_only", "block_training", "block_all_ai"]),
      sitemap_url: z.string().optional().describe("e.g. https://example.com/sitemap.xml"),
      content_signals: z.boolean().optional().describe("Include Content-Signal lines (default true)"),
    },
    { title: "Generate robots.txt for AI", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => robotsTxtForAi(a)),
  );

  server.tool(
    "llms_txt_draft",
    "Draft a starter llms.txt from your business name, one-line description, key pages and contact so AI agents get a curated summary of your site.",
    {
      business_name: z.string(),
      description: z.string().describe("One sentence on what you offer"),
      key_pages: z.array(z.object({ title: z.string(), url: z.string(), note: z.string().optional() })).optional(),
      contact_email: z.string().optional(),
    },
    { title: "Draft llms.txt", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => llmsTxtDraft(a)),
  );

  server.tool(
    "schema_jsonld_sample",
    "Generate a schema.org JSON-LD snippet (Organization, LocalBusiness, Product or FAQ) to paste into your page head for AI identification.",
    {
      type: z.enum(["organization", "local_business", "product", "faq"]),
      name: z.string(),
      url: z.string(),
      description: z.string().optional(),
      telephone: z.string().optional(),
      address: z.string().optional().describe("Street address for local_business"),
      price: z.string().optional().describe("e.g. '49 USD' for product"),
      questions: z.array(z.object({ question: z.string(), answer: z.string() })).optional().describe("For faq"),
    },
    { title: "Generate JSON-LD sample", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => schemaJsonldSample(a)),
  );

  return server;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function authorized(req: IncomingMessage): boolean {
  if (!API_KEY) return true;
  return req.headers.authorization === `Bearer ${API_KEY}`;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tools: 5 }));
    return;
  }
  if (url.pathname === "/.well-known/openai-apps-challenge") {
    if (!CHALLENGE) { res.writeHead(404); res.end("not configured"); return; }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(CHALLENGE);
    return;
  }
  if (url.pathname === "/mcp") {
    if (!authorized(req)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized: provide Authorization: Bearer <API_KEY>" }));
      return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : "bad request" }));
      }
    }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "use POST /mcp (MCP), GET /health" }));
});

httpServer.listen(PORT, () => console.log(`AIReady MCP on :${PORT} (POST /mcp, GET /health)`));
