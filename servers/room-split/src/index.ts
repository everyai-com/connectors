/**
 * RoomSplit MCP server - rent splitting by room, utility bill splitting,
 * settle-up transfers and roommate agreement drafting for house shares.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { roommateAgreement, settleUp, splitRent, splitUtilities } from "./roomsplit.js";

const PORT = Number(process.env.PORT ?? 3012);
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
    { name: "room-split", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "RoomSplit handles the maths for house shares: split rent between rooms, split utility bills equally, by occupants or by usage, " +
        "settle up shared costs between housemates, and draft a plain-language roommate agreement. All maths only; nothing stored.",
    },
  );

  server.tool(
    "split_rent",
    "Split monthly rent across rooms - equally or by room size - showing each room's share and, for shared rooms, each occupant's share.",
    {
      total_rent: z.number().describe("Monthly rent for the whole house"),
      rooms: z.array(z.object({
        name: z.string().describe("Room label, e.g. 'Master bedroom'"),
        size: z.number().optional().describe("Room size (m2/ft2); required for every room when method is by_size"),
        occupants: z.array(z.string()).optional().describe("Names of the people sharing this room"),
      })).describe("Rooms in the house"),
      method: z.enum(["equal", "by_size"]).optional().describe("Split method; default by_size when every room has a size, else equal"),
    },
    { title: "Split rent", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => splitRent(a)),
  );

  server.tool(
    "split_utilities",
    "Split utility and household bills across housemates - equally, by occupants per room, or by usage - and total what each person owes.",
    {
      bills: z.array(z.object({
        name: z.string().describe("Bill label, e.g. 'Electricity'"),
        amount: z.number().describe("Bill amount"),
        split: z.enum(["equal", "by_occupants", "by_usage"]).describe("How to split this bill"),
      })).describe("Bills to split"),
      people: z.array(z.object({
        name: z.string().describe("Housemate name"),
        occupants: z.number().optional().describe("How many people this housemate pays for, default 1 (by_occupants bills)"),
        usage_weight: z.number().optional().describe("Relative usage (by_usage bills), e.g. 0.5 for a light user"),
      })).describe("People sharing the house"),
    },
    { title: "Split utilities", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => splitUtilities(a)),
  );

  server.tool(
    "settle_up",
    "Given shared household costs and what each housemate already paid, compute balances and the minimal set of payments to settle everyone.",
    {
      costs: z.array(z.object({
        name: z.string().describe("Cost label, e.g. 'Weekly shop'"),
        amount: z.number().describe("Cost amount"),
      })).describe("Shared costs to split equally"),
      payments: z.array(z.object({
        name: z.string().describe("Housemate name"),
        paid: z.number().describe("Amount this housemate has already paid (0 if nothing yet)"),
      })).describe("What each housemate paid"),
    },
    { title: "Settle up", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => settleUp(a)),
  );

  server.tool(
    "roommate_agreement",
    "Draft a plain-language shared-living agreement: parties, term, rent split, deposit handling, utilities policy, house rules, notice period and signature blocks.",
    {
      property_address: z.string().describe("Address of the shared home"),
      tenants: z.array(z.string()).describe("All tenants (at least 2)"),
      move_in_date: z.string().describe("Move-in date (YYYY-MM-DD)"),
      monthly_rent: z.number().describe("Total monthly rent"),
      deposit: z.number().describe("Deposit amount (0 if none)"),
      room_assignments: z.array(z.object({
        name: z.string().describe("Tenant name"),
        room: z.string().describe("Room label"),
      })).optional().describe("Who sleeps in which room"),
      utilities_policy: z.string().optional().describe("How utilities are shared; default 'split equally unless agreed otherwise'"),
      notice_period_months: z.number().optional().describe("Notice period in months, default 1"),
      house_rules: z.array(z.string()).optional().describe("Custom house rules; default covers quiet hours, guests, cleaning rota and shared supplies"),
    },
    { title: "Roommate agreement", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => roommateAgreement(a)),
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

httpServer.listen(PORT, () => console.log(`RoomSplit MCP on :${PORT} (POST /mcp, GET /health)`));
