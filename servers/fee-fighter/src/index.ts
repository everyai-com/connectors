/**
 * FeeFighter MCP server - audit junk fees, annualize costs, benchmark
 * against typical US fee ranges and draft dispute letters.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { annualCost, auditFees, benchmarkFees, disputeLetter } from "./feefighter.js";

const PORT = Number(process.env.PORT ?? 3011);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Fee = z.object({
  name: z.string().describe("Fee description, e.g. 'Overdraft fee'"),
  amount: z.number().describe("Amount charged in USD"),
  frequency: z.enum(["monthly", "annual", "one-time"]).describe("How often the fee recurs"),
  category: z.string().optional().describe("Optional benchmark category key, e.g. bank_overdraft"),
});

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
    { name: "fee-fighter", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "FeeFighter audits junk fees from a list you provide: it annualizes and totals them, flags charges above typical US ranges, " +
        "duplicate names and disputable one-time fees, benchmarks categories against typical US fee ranges, and drafts dispute letters. " +
        "All maths and text only; nothing stored and nothing sent.",
    },
  );

  server.tool(
    "audit_fees",
    "Audit a list of fees: annualize each one, total the yearly cost and monthly average, and flag charges above typical US ranges, duplicate names and disputable one-time fees.",
    {
      fees: z.array(Fee).describe("Fees to audit, each with name, amount, frequency and optional category"),
    },
    { title: "Audit fees", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => auditFees(a)),
  );

  server.tool(
    "annual_cost",
    "Project the cumulative cost of a fee list over 1-30 years by straight multiplication (no compounding), with a per-fee breakdown. Defaults to 1 year.",
    {
      fees: z.array(Fee).describe("Fees to project"),
      years: z.number().optional().describe("Years to project (integer 1-30), default 1"),
    },
    { title: "Annual cost", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => annualCost(a)),
  );

  server.tool(
    "benchmark_fees",
    "Look up typical US consumer fee ranges by category (bank fees, subscriptions, airline charges, tickets and more). Omit category to return the whole reference table.",
    {
      category: z.string().optional().describe("Category key to look up, e.g. bank_overdraft; omit for the full table"),
    },
    { title: "Benchmark fees", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => benchmarkFees(a)),
  );

  server.tool(
    "dispute_letter",
    "Draft a firm, polite letter requesting a reversal or refund of a specific fee, including grounds, a 14-day written response request and escalation paths. Produces text only; nothing is sent.",
    {
      fee_name: z.string().describe("Name of the fee being disputed"),
      amount: z.number().describe("Fee amount in USD"),
      company: z.string().describe("Company or bank that charged the fee"),
      your_name: z.string().describe("Your name, used to sign the letter"),
      account_reference: z.string().optional().describe("Optional account or reference number"),
      date_charged: z.string().optional().describe("Optional date the fee was charged"),
      reason: z.string().optional().describe("Optional grounds for the dispute"),
      requested_action: z.string().optional().describe("What to ask for, e.g. 'reverse or refund' or 'waive'; default 'reverse or refund'"),
    },
    { title: "Dispute letter", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => disputeLetter(a)),
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
    res.end(JSON.stringify({ ok: true, tools: 4 }));
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

httpServer.listen(PORT, () => console.log(`FeeFighter MCP on :${PORT} (POST /mcp, GET /health)`));
