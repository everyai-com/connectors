/** TutorNow MCP server - find vetted tutors, quote plans, request intro sessions. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { searchTutors, tutorProfile, tutorSlots, quotePlan, requestIntro, getRequest, cancelRequest } from "./tutornow.js";

const PORT = Number(process.env.PORT ?? 3215);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const err = (e: unknown) => {
  const m = e instanceof Error ? e.message : "tool failed";
  return { content: [{ type: "text" as const, text: m.startsWith("ERROR") ? m : `ERROR ${m}` }], isError: true };
};

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "tutor-now", version: "1.0.0" },
    { capabilities: { tools: {} },
      instructions: "TutorNow matches K-12 students with vetted tutors. Search by subject and grade, check a tutor's open slots, quote a weekly plan, or request an intro session (tutor confirms; nothing charged for the intro)." },
  );
  server.tool("search_tutors", "Find vetted tutors by subject, with optional grade, max hourly rate and result limit. Returns matches sorted by rating.",
    { subject: z.string().describe("e.g. math, physics, english"), grade: z.string().optional().describe("K or 1-12"), max_rate: z.number().optional().describe("Max USD per hour"), limit: z.number().optional().describe("Max results 1-12, default 5") },
    { title: "Search tutors", ...RO },
    async (a) => { try { return ok(searchTutors(a)); } catch (e) { return err(e); } });
  server.tool("tutor_profile", "Full profile for one tutor: subjects, grades, rate, rating, experience and bio.",
    { tutor_id: z.string().describe("Tutor id from search_tutors") },
    { title: "Tutor profile", ...RO },
    async (a) => { try { return ok(tutorProfile(a)); } catch (e) { return err(e); } });
  server.tool("tutor_slots", "Open intro-session start times (ISO UTC) for a tutor on a date (YYYY-MM-DD). Call before requesting.",
    { tutor_id: z.string(), date: z.string().describe("Date YYYY-MM-DD") },
    { title: "Tutor slots", ...RO },
    async (a) => { try { return ok(tutorSlots(a)); } catch (e) { return err(e); } });
  server.tool("quote_plan", "Quote a weekly tutoring plan: total sessions and USD price with long-plan discounts. No booking made.",
    { tutor_id: z.string(), sessions_per_week: z.number().describe("1-5"), weeks: z.number().describe("1-24") },
    { title: "Quote plan", ...RO },
    async (a) => { try { return ok(quotePlan(a)); } catch (e) { return err(e); } });
  server.tool("request_intro", "Request an intro session in an open slot. Idempotent: same idempotency_key returns the same request, never double-books. The tutor confirms within 24 hours; nothing is charged for the intro.",
    { tutor_id: z.string(), starts_at: z.string().describe("ISO start from tutor_slots"), student_name: z.string().min(1), subject: z.string(), grade: z.string().describe("K or 1-12"), contact: z.string().min(1).describe("Parent email or phone"), idempotency_key: z.string().describe("Client-generated unique key per request") },
    { title: "Request intro", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (a) => { try { return ok(requestIntro(a)); } catch (e) { return err(e); } });
  server.tool("get_request", "Get an intro request's status by id.",
    { request_id: z.string() },
    { title: "Get request", ...RO },
    async (a) => { try { return ok(getRequest(a)); } catch (e) { return err(e); } });
  server.tool("cancel_request", "Cancel an intro request. The slot opens again. Cannot be undone - confirm with the user first.",
    { request_id: z.string() },
    { title: "Cancel request", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async (a) => { try { return ok(cancelRequest(a)); } catch (e) { return err(e); } });
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
function authorized(req: IncomingMessage): boolean {
  if (!API_KEY) return true;
  return req.headers.authorization === `Bearer ${API_KEY}`;
}
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tools: 7 }));
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
httpServer.listen(PORT, () => console.log(`TutorNow MCP on :${PORT} (POST /mcp, GET /health)`));
