/**
 * GroceryStock MCP server - weekly grocery restock planning: runout
 * forecasts, restock lists, basket quotes, store-tier comparison, budget
 * swaps and restock schedules. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildRestockList, compareStoreTiers, forecastRunout, quoteBasket, restockSchedule, suggestSwaps } from "./grocerystock.js";

const PORT = Number(process.env.PORT ?? 3216);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Staple = z.object({
  item: z.string().describe("Staple name, e.g. 'milk'"),
  on_hand: z.number().describe("Amount currently on hand"),
  unit: z.string().optional().describe("Unit you count in, e.g. 'gallons'"),
  use_per_week: z.number().describe("Amount used per week in the same unit"),
});

const BasketItem = z.object({
  item: z.string().describe("Staple name, e.g. 'eggs'"),
  quantity: z.number().describe("How many units to price"),
});

function wrap(fn: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "computation failed";
    return { content: [{ type: "text" as const, text: msg.startsWith("ERROR") ? msg : `ERROR ${msg}` }], isError: true };
  }
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "grocery-stock", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "GroceryStock plans weekly grocery restocks: forecast when staples run out, build a " +
        "restock list for N weeks ahead, quote a basket with typical US prices, compare store " +
        "price tiers, suggest swaps to fit a budget, and compute restock dates. Planning only: " +
        "it never orders anything. Pure computation; nothing stored.",
    },
  );

  server.tool(
    "forecast_runout",
    "Forecast when each staple runs out from on-hand amounts and weekly use: weeks left, runout date and ok/low/out status.",
    {
      staples: z.array(Staple).describe("Staples with on-hand amounts and weekly use"),
      as_of: z.string().optional().describe("Reference date YYYY-MM-DD, default today"),
    },
    { title: "Forecast runout", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => forecastRunout(a)),
  );

  server.tool(
    "build_restock_list",
    "Build a restock shopping list covering N weeks ahead from on-hand amounts and weekly use.",
    {
      staples: z.array(Staple).describe("Staples with on-hand amounts and weekly use"),
      weeks_ahead: z.number().optional().describe("Weeks to cover, 1-8, default 2"),
    },
    { title: "Build restock list", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => buildRestockList(a)),
  );

  server.tool(
    "quote_basket",
    "Price a basket of staples with typical US prices: per-item lines and a total. Prices are typical, not store quotes.",
    {
      items: z.array(BasketItem).describe("Items and quantities to price"),
    },
    { title: "Quote basket", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteBasket(a)),
  );

  server.tool(
    "compare_store_tiers",
    "Compare what the same basket costs at budget, standard and premium store tiers, and name the cheapest.",
    {
      items: z.array(BasketItem).describe("Items and quantities to compare"),
    },
    { title: "Compare store tiers", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => compareStoreTiers(a)),
  );

  server.tool(
    "suggest_swaps",
    "Fit a basket into a budget by swapping the priciest lines for cheaper staples, biggest savings first.",
    {
      items: z.array(BasketItem).describe("Items and quantities in the basket"),
      budget_usd: z.number().describe("Target budget in USD"),
    },
    { title: "Suggest swaps", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => suggestSwaps(a)),
  );

  server.tool(
    "restock_schedule",
    "Compute the next N weekly restock dates for a weekday on or after a start date.",
    {
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      weekday: z.string().optional().describe("Restock weekday, default sunday"),
      count: z.number().optional().describe("How many dates, 1-12, default 4"),
    },
    { title: "Restock schedule", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => restockSchedule(a)),
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
    res.end(JSON.stringify({ ok: true, tools: 6 }));
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

httpServer.listen(PORT, () => console.log(`GroceryStock MCP on :${PORT} (POST /mcp, GET /health)`));
