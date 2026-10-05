/**
 * Sahadeva - Vedic astrology MCP server (Connector SaaS product #1).
 * Real computed engine: low-precision Sun/Moon ephemeris (Schlyter),
 * Lahiri ayanamsa, rashi/nakshatra/tithi/vara, lagna, Vimshottari dasha,
 * Rahu kalam table, deterministic interpretive horoscope + compatibility.
 * ALL TOOLS READ-ONLY -> ideal for Dots proactive research.
 * Accuracy: approx Sun +/-0.01 deg, Moon +/-1 deg (no parallax correction).
 * Every astro result is labeled approximate; verify critical muhurta.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { RAD, norm, sinD, NAKSHATRAS, RASHIS, VARAS, TITHI_NAMES, DASHA_SEQ, RAHU_KALAM, julianDay, sunLongitude, moonLongitude, ayanamsa, rashiOf, nakOf, tithiOf, ascendant, parseDate, todayStr, hashStr, HORO_LINES, HORO_COLORS, compatibility } from "./astro.js";


const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.API_KEY ?? "";
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? "";

// ------------------------------------------------------------------- MCP app
function buildServer(): McpServer {
  const server = new McpServer(
    { name: "sahadeva", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Sahadeva gives Vedic astrology: panchang, birth summary, Vimshottari dasha, " +
        "daily rashifal, Rahu kalam, compatibility. Positions are approximate " +
        "(low-precision ephemeris, Lahiri ayanamsa); say so and advise verifying " +
        "critical muhurta. No health or financial predictions beyond general guidance.",
    },
  );
    server.tool("get_panchang", "Vedic panchang for a date: vara, tithi, Moon nakshatra+pada, Moon and Sun rashis. Approximate positions.",
    { date: z.string().describe("YYYY-MM-DD (default today)").optional() },
    { title: "Panchang", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ date }) => {
      const ds = date ?? todayStr(); const [y, m, d] = parseDate(ds);
      const jd = julianDay(y, m, d, 12), aya = ayanamsa(jd);
      const sun = norm(sunLongitude(jd) - aya), moon = norm(moonLongitude(jd) - aya);
      const nk = nakOf(moon);
      const out = { date: ds, vara: VARAS[new Date(`${ds}T00:00:00Z`).getUTCDay()], tithi: tithiOf(sun, moon), moon_nakshatra: nk.name, moon_pada: nk.pada, moon_rashi: rashiOf(moon), sun_rashi: rashiOf(sun), approximate: true };
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    });

  server.tool("get_birth_summary", "Birth summary: lagna (ascendant), Moon rashi/nakshatra/pada, Sun rashi. Needs birth time + place; approximate.",
    { dob: z.string().describe("YYYY-MM-DD"), tob: z.string().describe("HH:MM 24h local"), tz_offset_hours: z.number().describe("e.g. 5.5 for IST"), latitude: z.number(), longitude_east: z.number() },
    { title: "Birth summary", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ dob, tob, tz_offset_hours, latitude, longitude_east }) => {
      const [y, m, d] = parseDate(dob);
      const tm = /^(\d{2}):(\d{2})$/.exec(tob);
      if (!tm) throw new Error(`tob must be HH:MM, got '${tob}'`);
      const jd = julianDay(y, m, d, Number(tm[1]) + Number(tm[2]) / 60 - tz_offset_hours);
      const aya = ayanamsa(jd);
      const sun = norm(sunLongitude(jd) - aya), moon = norm(moonLongitude(jd) - aya);
      const nk = nakOf(moon);
      const out = { lagna: rashiOf(ascendant(jd, latitude, longitude_east)), moon_rashi: rashiOf(moon), moon_nakshatra: nk.name, moon_nakshatra_index: nk.index, moon_pada: nk.pada, sun_rashi: rashiOf(sun), approximate: true };
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    });

  server.tool("get_vimshottari_dasha", "Current Vimshottari mahadasha + next two, from birth date and Moon nakshatra (use get_birth_summary first). Approximate balance from pada.",
    { dob: z.string().describe("YYYY-MM-DD"), nakshatra_index: z.number().describe("0=Ashwini..26=Revati"), pada: z.number().describe("1-4") },
    { title: "Vimshottari dasha", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ dob, nakshatra_index, pada }) => {
      if (nakshatra_index < 0 || nakshatra_index > 26 || pada < 1 || pada > 4) throw new Error("nakshatra_index 0-26, pada 1-4");
      const startIdx = nakshatra_index % 9;
      const balanceStart = (1 - (pada - 1) / 4) * DASHA_SEQ[startIdx][1];
      const birth = new Date(`${dob}T00:00:00Z`).getTime(); if (isNaN(birth)) throw new Error(`bad dob '${dob}'`);
      const now = Date.now(), YR = 365.25 * 864e5;
      const periods: Array<{ lord: string; years: number; start: string; end: string }> = [];
      let cursor = birth, i = startIdx, first = true;
      while (cursor < now + 60 * YR && periods.length < 14) {
        const [lord, yrs] = DASHA_SEQ[((i % 9) + 9) % 9];
        const span = first ? balanceStart : yrs;
        periods.push({ lord, years: +span.toFixed(2), start: new Date(cursor).toISOString().slice(0, 10), end: new Date(cursor + span * YR).toISOString().slice(0, 10) });
        cursor += span * YR; i++; first = false;
      }
      const ci = periods.findIndex((p) => now >= new Date(p.start).getTime() && now < new Date(p.end).getTime());
      const current = periods[ci < 0 ? 0 : ci];
      const upcoming = periods.slice((ci < 0 ? 0 : ci) + 1, (ci < 0 ? 0 : ci) + 3);
      return { content: [{ type: "text", text: JSON.stringify({ balance_at_birth_years: +balanceStart.toFixed(2), current_mahadasha: current.lord, current_period: current, upcoming, approximate: true }) }] };
    });

  server.tool("get_daily_horoscope", "Deterministic daily rashifal (interpretive guidance, entertainment) for a Moon/Sun sign and date.",
    { sign: z.string().describe("Vedic rashi, e.g. Mesha"), date: z.string().describe("YYYY-MM-DD (default today)").optional() },
    { title: "Daily horoscope", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ sign, date }) => {
      if (!RASHIS.includes(sign)) throw new Error(`unknown sign '${sign}'; valid: ${RASHIS.join(", ")}`);
      const ds = date ?? todayStr(); parseDate(ds);
      const h = hashStr(sign + ds);
      const out = { sign, date: ds, guidance: HORO_LINES[h % HORO_LINES.length], lucky_number: (h % 9) + 1, lucky_color: HORO_COLORS[h % HORO_COLORS.length], interpretive: true };
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    });

  server.tool("get_rahukalam", "Rahu kalam inauspicious window for a date (weekday table, approx 6:00 sunrise). Avoid starting new ventures then.",
    { date: z.string().describe("YYYY-MM-DD (default today)").optional() },
    { title: "Rahu kalam", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ date }) => {
      const ds = date ?? todayStr(); parseDate(ds);
      const wd = new Date(`${ds}T00:00:00Z`).getUTCDay();
      return { content: [{ type: "text", text: JSON.stringify({ date: ds, weekday: VARAS[wd], rahu_kalam_local: RAHU_KALAM[wd], note: "approximate; assumes ~6:00 sunrise", approximate: true }) }] };
    });

  server.tool("get_compatibility", "Simplified Moon-sign compatibility score /36 with a note (entertainment, not full guna matching).",
    { sign1: z.string(), sign2: z.string() },
    { title: "Compatibility", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ sign1, sign2 }) => {
      try {
        const c = compatibility(sign1, sign2);
        return { content: [{ type: "text", text: JSON.stringify({ sign1, sign2, ...c, simplified: true }) }] };
      } catch (e) { return { content: [{ type: "text", text: `ERROR ${e instanceof Error ? e.message : "bad signs"}` }], isError: true }; }
    });

  return server;
}

// ------------------------------------------------------------- HTTP layer
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
  if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, tools: 6 })); return; }
  if (url.pathname === "/.well-known/openai-apps-challenge") {
    if (!CHALLENGE) { res.writeHead(404); res.end("not configured"); return; }
    res.writeHead(200, { "content-type": "text/plain" }); res.end(CHALLENGE); return;
  }
  if (url.pathname === "/mcp") {
    if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized: provide Authorization: Bearer <API_KEY>" })); return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch { if (!res.headersSent) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "bad request" })); } }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "use POST /mcp (MCP), GET /health" }));
});
httpServer.listen(PORT, () => console.log(`sahadeva MCP on :${PORT}`));
