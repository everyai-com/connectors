/**
 * RecipeScale MCP server - kitchen math: scale recipes, convert cooking units,
 * merge shopping lists and work out cost per serving.
 * All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { convertUnits, costPerServing, mergeShoppingList, scaleRecipe } from "./recipescale.js";

const PORT = Number(process.env.PORT ?? 3015);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Ingredient = z.object({
  item: z.string().describe("Ingredient name, e.g. 'flour'"),
  quantity: z.number().optional().describe("Amount; omit it for items like 'salt to taste'"),
  unit: z.string().optional().describe("Unit such as cup, tbsp, g or a count label like 'clove'"),
  note: z.string().optional().describe("Preparation note kept as-is, e.g. 'to taste'"),
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
    { name: "recipe-scale", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "RecipeScale does kitchen math: scale a recipe to a different serving count, convert cooking units " +
        "(including cups to grams via ingredient densities), merge several shopping lists into one and compute " +
        "cost per serving. Pure arithmetic; nothing stored.",
    },
  );

  server.tool(
    "scale_recipe",
    "Scale every ingredient of a recipe from one serving count to another, with friendly kitchen measures and items without a quantity passed through.",
    {
      ingredients: z.array(Ingredient).describe("Ingredients with optional quantity and unit"),
      from_servings: z.number().describe("Servings the recipe is written for"),
      to_servings: z.number().describe("Servings you want"),
    },
    { title: "Scale recipe", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => scaleRecipe(a)),
  );

  server.tool(
    "convert_units",
    "Convert a cooking amount between units: same-dimension conversions are exact; cups to grams and similar need a known ingredient density.",
    {
      value: z.number().describe("Amount to convert"),
      from: z.string().describe("Unit to convert from, e.g. cup"),
      to: z.string().describe("Unit to convert to, e.g. g"),
      ingredient: z.string().optional().describe("Ingredient name, needed for volume <-> weight, e.g. flour"),
    },
    { title: "Convert units", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => convertUnits(a)),
  );

  server.tool(
    "merge_shopping_list",
    "Merge several shopping lists into one: quantities of the same item are summed in a common unit and shown in the friendliest kitchen unit; items without a quantity are collected as notes.",
    {
      lists: z.array(z.object({
        name: z.string().optional().describe("e.g. 'Saturday dinner'"),
        items: z.array(z.object({
          item: z.string().describe("Item to buy"),
          quantity: z.number().optional().describe("Amount; omit it for non-numeric items"),
          unit: z.string().optional().describe("Unit such as cup, tbsp or g"),
        })).describe("Items on this list"),
      })).describe("Shopping lists to merge"),
    },
    { title: "Merge shopping list", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => mergeShoppingList(a)),
  );

  server.tool(
    "cost_per_serving",
    "Total the cost of the ingredients in a recipe and divide it by the servings to get cost per serving, also shown for 10 servings.",
    {
      ingredients: z.array(z.object({
        item: z.string().describe("Ingredient name"),
        cost: z.number().describe("Cost of the amount used in the recipe"),
      })).describe("Priced ingredients"),
      servings: z.number().describe("How many servings the recipe makes"),
      currency: z.string().optional().describe("Currency code for display, default USD"),
    },
    { title: "Cost per serving", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => costPerServing(a)),
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

httpServer.listen(PORT, () => console.log(`RecipeScale MCP on :${PORT} (POST /mcp, GET /health)`));
