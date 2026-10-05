/**
 * LeaseBreak MCP server - early lease termination cost estimates, option
 * comparison, notice letters and a negotiation checklist. Read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { compareOptions, estimateBreakCost, negotiationChecklist, noticeLetter } from "./leasebreak.js";

const PORT = Number(process.env.PORT ?? 3008);
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

const BreakFields = {
  monthly_rent: z.number().describe("Monthly rent"),
  months_remaining: z.number().describe("Months left on the lease (including the current one)"),
  deposit: z.number().optional().describe("Security deposit held"),
  break_fee_months: z.number().optional().describe("Early-termination fee stated in the lease, in months' rent"),
  notice_months: z.number().optional().describe("Notice period required (months)"),
  reletting_fee: z.number().optional().describe("Any fixed re-letting/cleaning fee stated in the lease"),
  expected_relet_months: z.number().optional().describe("How fast the unit will likely re-let (months)"),
  landlord_mitigates: z.boolean().optional().describe("Must the landlord try to re-let? default true"),
  currency: z.string().optional().describe("Currency code for display, default USD"),
};

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "lease-break", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "LeaseBreak estimates the cost of ending a lease early, compares breaking vs subletting vs staying, " +
        "drafts a notice letter and prepares a negotiation checklist. Uses only the numbers you provide; informational, not legal advice.",
    },
  );

  server.tool(
    "estimate_break_cost",
    "Itemised estimate of what ending a lease early costs: notice-period rent, break fee, re-letting fee, rent-until-relet and deposit credit.",
    BreakFields,
    { title: "Estimate break cost", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => estimateBreakCost(a)),
  );

  server.tool(
    "compare_options",
    "Compare breaking the lease vs subletting vs staying to term: net cost of each path with assumptions and risks.",
    {
      ...BreakFields,
      sublet_discount_pct: z.number().optional().describe("Discount a subtenant expects, e.g. 15 for 15%"),
      sublet_vacancy_months: z.number().optional().describe("Months before a subtenant starts"),
    },
    { title: "Compare options", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => compareOptions(a)),
  );

  server.tool(
    "notice_letter",
    "Draft a formal early-termination notice letter with your lease details, intended move-out date and fee acknowledgment.",
    {
      tenant_name: z.string(),
      property_address: z.string(),
      lease_date: z.string().optional().describe("Lease date YYYY-MM-DD if known"),
      notice_months: z.number().describe("Notice period per your lease"),
      intended_move_out_date: z.string().describe("YYYY-MM-DD"),
      break_fee_months: z.number().optional(),
      monthly_rent: z.number().optional(),
      deposit: z.number().optional(),
      landlord_name: z.string().optional(),
      reason: z.string().optional().describe("Short reason, e.g. 'job relocation'"),
    },
    { title: "Notice letter", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => noticeLetter(a)),
  );

  server.tool(
    "negotiation_checklist",
    "A negotiation plan for leaving early: what to ask the landlord, in what order, tailored to your fee, remaining months and local demand.",
    {
      break_fee_months: z.number().optional(),
      months_remaining: z.number().optional(),
      landlord_mitigates: z.boolean().optional(),
      relet_demand: z.enum(["high", "medium", "low"]).optional().describe("How easy your unit re-lets"),
    },
    { title: "Negotiation checklist", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => negotiationChecklist(a)),
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

httpServer.listen(PORT, () => console.log(`LeaseBreak MCP on :${PORT} (POST /mcp, GET /health)`));
