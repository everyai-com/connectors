/**
 * MealKitMatch MCP server - meal-kit matching and week planning: match kits
 * to a diet/budget profile, plan weeks, quote costs, compare tiers, suggest
 * swaps, schedule deliveries. All tools are read-only computations.
 */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { compareKitTiers, deliverySchedule, matchKits, planWeek, quoteWeek, suggestSwaps } from "./mealkitmatch.js";

const PORT = Number(process.env.PORT ?? 3223);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const Kit = z.object({
  name: z.string().describe("Kit name"),
  diets: z.array(z.string()).describe("Diets supported, e.g. vegetarian, keto"),
  price_per_serving: z.number().describe("Price per serving in USD"),
  servings_options: z.array(z.number()).describe("Servings plans offered"),
  meals_per_week_options: z.array(z.number()).describe("Meals-per-week plans offered"),
  skill: z.string().describe("Cooking skill: easy, medium or hard"),
  rating: z.number().describe("Rating 1-5"),
  allergens: z.array(z.string()).describe("Allergens present"),
});

const Profile = z.object({
  diets: z.array(z.string()).describe("Required diets"),
  allergies: z.array(z.string()).optional().describe("Allergies to avoid"),
  max_price_per_serving: z.number().optional().describe("Budget per serving in USD"),
  servings: z.number().optional().describe("Servings needed"),
  meals_per_week: z.number().optional().describe("Meals per week needed"),
  skill: z.string().optional().describe("Cooking skill: easy, medium or hard"),
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
    { name: "meal-kit-match", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "MealKitMatch plans meal-kit choices around a diet profile and kit catalog you provide: " +
        "match kits to diets, allergies and budget, plan a week of kit meals, quote weekly cost, " +
        "compare kit tiers on your own price and rating numbers, suggest swaps around avoids, " +
        "and schedule deliveries. Planning only: it never orders anything. Pure computation; " +
        "nothing stored.",
    },
  );

  server.tool(
    "match_kits",
    "Rank meal kits against a diet/budget profile: matches with scores, rejections with reasons, and a pick.",
    {
      profile: Profile.describe("Your diet profile"),
      kits: z.array(Kit).describe("Kit catalog to match"),
    },
    { title: "Match kits", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => matchKits(a)),
  );

  server.tool(
    "plan_week",
    "Plan a week of kit meals across days, flagging days short on servings.",
    {
      kit_meals: z.array(z.object({
        name: z.string().describe("Meal name"),
        servings: z.number().describe("Servings the meal makes"),
      })).describe("Kit meals to rotate"),
      days: z.number().optional().describe("Days to plan, 1-14, default 7"),
      servings_needed: z.number().optional().describe("Servings needed per day, 1-12, default 2"),
    },
    { title: "Plan week", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => planWeek(a)),
  );

  server.tool(
    "quote_week",
    "Quote a week of meal kits: per-meal math, food total, shipping and monthly estimate.",
    {
      price_per_serving: z.number().describe("Price per serving in USD"),
      meals_per_week: z.number().describe("Meals per week, 1-21"),
      servings: z.number().describe("Servings per meal, 1-12"),
      shipping: z.number().optional().describe("Weekly shipping in USD, default 0"),
    },
    { title: "Quote week", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => quoteWeek(a)),
  );

  server.tool(
    "compare_kit_tiers",
    "Rank 2-6 kit plans from your price and rating numbers: 60% rating, 40% price.",
    {
      plans: z.array(z.object({
        name: z.string().describe("Plan name"),
        price_usd: z.number().describe("Weekly price in USD"),
        rating: z.number().describe("Rating 1-5"),
        meals: z.number().describe("Meals per week"),
      })).describe("Plans to compare"),
    },
    { title: "Compare kit tiers", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => compareKitTiers(a)),
  );

  server.tool(
    "suggest_swaps",
    "Suggest swaps for meals clashing with avoids, naming a clean swap from the same list.",
    {
      meals: z.array(z.object({
        name: z.string().describe("Meal name"),
        tags: z.array(z.string()).describe("Ingredient tags"),
      })).describe("Meals to check"),
      avoid: z.array(z.string()).describe("Tags to avoid"),
    },
    { title: "Suggest swaps", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => suggestSwaps(a)),
  );

  server.tool(
    "delivery_schedule",
    "Compute the next N delivery dates on a weekly cadence from a first delivery.",
    {
      first_delivery: z.string().describe("First delivery YYYY-MM-DD"),
      every_weeks: z.number().optional().describe("Cadence in weeks, 1-12, default 1"),
      count: z.number().optional().describe("How many dates, 1-12, default 4"),
    },
    { title: "Delivery schedule", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async (a) => wrap(() => deliverySchedule(a)),
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

httpServer.listen(PORT, () => console.log(`MealKitMatch MCP on :${PORT} (POST /mcp, GET /health)`));
