/**
 * FestivalFinder MCP server - COMPUTED Hindu festival dates + sankrantis.
 * 4 tools, all read-only. Approximate (+/-1 day at tithi edges).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { festivalsInYear, nextFestival, festivalDetails } from "./festivals.js";

const PORT = Number(process.env.PORT ?? 3002);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "festival-finder", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: "FestivalFinder computes Hindu festival dates (Diwali, Holi, Navratri, Shivaratri, sankrantis) for 2020-2040. Dates are computed from lunar tithi rules and approximate within a day; advise verifying muhurta-critical dates." },
  );
  server.tool("list_festivals", "Retrieve all Hindu festivals and sankrantis for a specific year. Use when you need a full yearly overview; avoid when you need only the next upcoming festival, use next_festival.",
    { year: z.number() },
    { title: "List festivals", ...RO },
    async ({ year }) => {
      try { return { content: [{ type: "text", text: JSON.stringify(festivalsInYear(year)) }] }; }
      catch (e) { return { content: [{ type: "text", text: `ERROR ${e instanceof Error ? e.message : "bad year"}` }], isError: true }; }
    });
  server.tool("next_festival", "Find the next festival on or after a specific date. Use when you need the next upcoming festival; NOT when you need a list of festivals, use list_festivals.",
    { from_date: z.string() },
    { title: "Next festival", ...RO },
    async ({ from_date }) => {
      try { return { content: [{ type: "text", text: JSON.stringify(nextFestival(from_date)) }] }; }
      catch (e) { return { content: [{ type: "text", text: `ERROR ${e instanceof Error ? e.message : "bad date"}` }], isError: true }; }
    });
  server.tool("festival_details", "Retrieve the date and rule explanation for one festival by name in a year. Use when you need specific details about a festival. Do NOT use when you need a list of festivals in a month, use festivals_in_month instead.",
    { name: z.string().describe("e.g. Diwali, Holi, Maha Shivaratri"), year: z.number() },
    { title: "Festival details", ...RO },
    async ({ name, year }) => {
      try { return { content: [{ type: "text", text: JSON.stringify(festivalDetails(name, year)) }] }; }
      catch (e) { return { content: [{ type: "text", text: `ERROR ${e instanceof Error ? e.message : "not found"}` }], isError: true }; }
    });
  server.tool("festivals_in_month", "Retrieve festivals for a specific month and year. Use when you need events for a particular month; avoid when you need a list of all festivals, use list_festivals.",
    { year: z.number(), month: z.number().describe("1=January..12=December") },
    { title: "Festivals in month", ...RO },
    async ({ year, month }) => {
      try {
        if (month < 1 || month > 12) throw new Error(`month must be 1-12, got '${month}'`);
        const all = festivalsInYear(year).filter((f) => Number(f.date.slice(5, 7)) === month);
        return { content: [{ type: "text", text: JSON.stringify(all) }] };
      } catch (e) { return { content: [{ type: "text", text: `ERROR ${e instanceof Error ? e.message : "bad input"}` }], isError: true }; }
    });
  return server;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { if (!data) return resolve(undefined); try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, tools: 4 })); return; }
  if (url.pathname === "/.well-known/openai-apps-challenge") {
    if (!CHALLENGE) { res.writeHead(404); res.end("not configured"); return; }
    res.writeHead(200, { "content-type": "text/plain" }); res.end(CHALLENGE); return;
  }
  if (url.pathname === "/mcp") {
    if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch { if (!res.headersSent) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "bad request" })); } }
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: "use POST /mcp, GET /health" }));
});
httpServer.listen(PORT, () => console.log(`festival-finder MCP on :${PORT}`));
