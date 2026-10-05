/** InvoiceGen MCP server - invoice generation. 4 tools, all read-only compute. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CURRENCIES, calculateTotals, createInvoice, formatInvoicePlain, type InvoiceInput } from "./invoice.js";

const PORT = Number(process.env.PORT ?? 3003);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const LineItem = z.object({ description: z.string(), quantity: z.number(), unit_price: z.number() });

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "invoice-gen", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: "InvoiceGen creates freelancer invoices: totals, numbered invoices, plain-text rendering. Computed per request, nothing stored. No tax advice." },
  );
  const wrap = (fn: () => unknown) => async () => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(fn()) }] }; }
    catch (e) { return { content: [{ type: "text" as const, text: `ERROR ${e instanceof Error ? e.message : "bad input"}` }], isError: true }; }
  };
  server.tool("create_invoice", "Generate a complete invoice (number, dates, totals) from business, client and line items. Nothing stored.",
    { business_name: z.string(), client_name: z.string(), items: z.array(LineItem),
      currency: z.string().describe("USD,EUR,INR,GBP,AED,SGD,AUD,CAD (default USD)").optional(),
      tax_rate_pct: z.number().optional(), discount_pct: z.number().optional(),
      invoice_number: z.string().optional(), notes: z.string().optional(), due_in_days: z.number().optional() },
    { title: "Create invoice", ...RO },
    async (a) => wrap(() => createInvoice(a as InvoiceInput))());
  server.tool("calculate_totals", "Subtotal, discount, tax and total for line items.",
    { items: z.array(LineItem), tax_rate_pct: z.number().optional(), discount_pct: z.number().optional() },
    { title: "Calculate totals", ...RO },
    async (a) => wrap(() => calculateTotals(a.items, a.tax_rate_pct ?? 0, a.discount_pct ?? 0))());
  server.tool("supported_currencies", "List supported invoice currencies with symbols.",
    {}, { title: "Supported currencies", ...RO },
    async () => wrap(() => ({ currencies: CURRENCIES }))());
  server.tool("render_invoice_text", "Rebuild + render an invoice as plain text (same inputs as create_invoice).",
    { business_name: z.string(), client_name: z.string(), items: z.array(LineItem),
      currency: z.string().optional(), tax_rate_pct: z.number().optional(), discount_pct: z.number().optional(),
      invoice_number: z.string().optional(), notes: z.string().optional(), due_in_days: z.number().optional() },
    { title: "Render invoice text", ...RO },
    async (a) => wrap(() => ({ text: formatInvoicePlain(createInvoice(a as InvoiceInput)) }))());
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
      res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
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
httpServer.listen(PORT, () => console.log(`invoice-gen MCP on :${PORT}`));
