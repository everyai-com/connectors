/** TutorNow Worker - pure reads run inline; intro-request state lives in a
 *  Durable Object so idempotency holds across Worker isolates (SQLite-backed).
 *  Reference semantics: requestIntro/getRequest/cancelRequest/tutorSlots in
 *  ../../mcp-server/src/tutornow.ts (node dev server keeps in-memory Maps). */
import { DurableObject } from "cloudflare:workers";
import {
  searchTutors, tutorProfile, quotePlan,
  findTutor, checkSubject, checkGrade, checkDate, DAY_HOURS, hash,
  type IntroRequest,
} from "../../mcp-server/src/tutornow.js";

interface Env { API_KEY?: string; OPENAI_APPS_CHALLENGE_TOKEN?: string; TUTOR_STORE: DurableObjectNamespace<TutorStore>; }

/** Single coordination atom for intro requests: one instance, strong
 *  consistency, atomic check-and-set per RPC (DOs are single-threaded). */
export class TutorStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, tutor_id TEXT NOT NULL, starts_at TEXT NOT NULL, student_name TEXT NOT NULL, subject TEXT NOT NULL, grade TEXT NOT NULL, contact TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE)"
      );
    });
  }

  private baseSlots(tutorId: string, date: string): string[] {
    const h = hash(`${tutorId}:${date}`);
    return DAY_HOURS.filter((_, i) => (h >> i) % 2 === 0 || i === 0)
      .map((hh) => `${date}T${String(hh).padStart(2, "0")}:00:00Z`);
  }

  private takenSlots(tutorId: string): Set<string> {
    const rows = this.ctx.storage.sql
      .exec<{ starts_at: string }>("SELECT starts_at FROM requests WHERE tutor_id = ? AND status = 'requested'", tutorId)
      .toArray();
    return new Set(rows.map((r) => r.starts_at));
  }

  async tutorSlots(o: { tutor_id: string; date: string }) {
    const t = findTutor(o.tutor_id);
    checkDate(o.date);
    const taken = this.takenSlots(t.id);
    return { tutor_id: t.id, date: o.date, slots: this.baseSlots(t.id, o.date).filter((s) => !taken.has(s)) };
  }

  async requestIntro(o: { tutor_id: string; starts_at: string; student_name: string; subject: string; grade: string; contact: string; idempotency_key: string }) {
    const dupe = this.ctx.storage.sql.exec<IntroRequest>("SELECT * FROM requests WHERE idempotency_key = ?", o.idempotency_key).toArray();
    if (dupe.length > 0) return { ...dupe[0], deduped: true };
    const t = findTutor(o.tutor_id);
    checkSubject(o.subject);
    if (!t.subjects.includes(o.subject)) throw new Error(`ERROR ${t.name} does not teach '${o.subject}'. Teaches: ${t.subjects.join(", ")}.`);
    checkGrade(o.grade);
    if (!t.grades.includes(o.grade)) throw new Error(`ERROR ${t.name} does not teach grade '${o.grade}'. Teaches: ${t.grades.join(", ")}.`);
    if (!o.student_name?.trim()) throw new Error("ERROR student_name must be a non-empty string.");
    if (!o.contact?.trim()) throw new Error("ERROR contact must be a non-empty string (email or phone).");
    const open = this.baseSlots(t.id, o.starts_at.slice(0, 10)).filter((s) => !this.takenSlots(t.id).has(s));
    if (!open.includes(o.starts_at)) throw new Error(`ERROR slot '${o.starts_at}' is not open. Open slots: ${open.join(", ") || "none"}.`);
    const r: IntroRequest = {
      id: `tr_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      tutor_id: t.id, starts_at: o.starts_at, student_name: o.student_name.trim(),
      subject: o.subject, grade: o.grade, contact: o.contact.trim(),
      status: "requested", idempotency_key: o.idempotency_key,
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO requests (id, tutor_id, starts_at, student_name, subject, grade, contact, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.id, r.tutor_id, r.starts_at, r.student_name, r.subject, r.grade, r.contact, r.status, r.idempotency_key);
    return { ...r, note: "Request held. The tutor confirms within 24 hours; nothing is charged for the intro." };
  }

  async getRequest(o: { request_id: string }) {
    const rows = this.ctx.storage.sql.exec<IntroRequest>("SELECT * FROM requests WHERE id = ?", o.request_id).toArray();
    if (rows.length === 0) throw new Error(`ERROR no request '${o.request_id}'.`);
    return rows[0];
  }

  async cancelRequest(o: { request_id: string }) {
    const r = await this.getRequest(o);
    this.ctx.storage.sql.exec("UPDATE requests SET status = 'cancelled' WHERE id = ?", o.request_id);
    return { ...r, status: "cancelled" as const };
  }
}

const store = (env: Env) => env.TUTOR_STORE.getByName("tutor-requests");
const VERSION = "1.0.0";
const MAX_BODY = 1024 * 1024;
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

type A = Record<string, unknown>;
const req = (a: A, k: string, t: string): never | unknown => {
  const v = a[k];
  if (t === "str" && (typeof v !== "string" || !v)) throw new Error(`'${k}' must be a non-empty string`);
  if (t === "num" && typeof v !== "number") throw new Error(`'${k}' must be a number`);
  return v;
};

type ToolDef = {
  name: string; title: string;
  annot: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  run: (a: A, env: Env) => unknown | Promise<unknown>;
};
const TOOLS: ToolDef[] = [
  { name: "search_tutors", title: "Search tutors", annot: RO,
    description: "Find vetted tutors by subject, with optional grade, max hourly rate and result limit. Use when you need to find tutors. Do NOT use when you need to see a tutor's availability, use tutor_slots.",
    inputSchema: { type: "object", properties: {
      subject: { type: "string", description: "e.g. math, physics, english" },
      grade: { type: "string", description: "K or 1-12" },
      max_rate: { type: "number", description: "Max USD per hour" },
      limit: { type: "number", description: "Max results 1-12, default 5" },
    }, required: ["subject"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "results": {
         "type": "array",
         "description": "List of search tutors entries.",
         "items": {
          "type": "object",
          "properties": {
           "tutor_id": {
            "type": "string",
            "description": "Unique identifier for the tutor"
           },
           "name": {
            "type": "string",
            "description": "Tutor's name"
           },
           "subject": {
            "type": "string",
            "description": "Subject the tutor teaches"
           },
           "grade": {
            "type": "string",
            "description": "Grade level the tutor teaches"
           },
           "hourly_rate": {
            "type": "number",
            "description": "Tutor's hourly rate in USD"
           },
           "rating": {
            "type": "number",
            "description": "Tutor's rating out of 5"
           }
          },
          "required": [
           "tutor_id",
           "name",
           "subject",
           "grade",
           "hourly_rate",
           "rating"
          ]
         }
        }
       },
       "required": [
        "results"
       ]
      },
    run: (a: A) => { req(a, "subject", "str"); return searchTutors(a as unknown as Parameters<typeof searchTutors>[0]); } },
  { name: "tutor_profile", title: "Tutor profile", annot: RO,
    description: "Retrieve full profile for one tutor by ID. Use when you need detailed tutor info for a specific tutor. Do NOT use when you need to find available tutors, use search_tutors instead.",
    inputSchema: { type: "object", properties: {
      tutor_id: { type: "string", description: "Tutor id from search_tutors" },
    }, required: ["tutor_id"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "tutor_id": {
         "type": "string",
         "description": "The unique identifier for the tutor."
        },
        "subjects": {
         "type": "array",
         "items": {
          "type": "string"
         },
         "description": "The list of subjects the tutor can teach."
        },
        "grades": {
         "type": "array",
         "items": {
          "type": "string"
         },
         "description": "The list of grades the tutor can teach."
        },
        "rate": {
         "type": "number",
         "description": "The hourly rate for the tutor."
        },
        "rating": {
         "type": "number",
         "description": "The average rating of the tutor."
        },
        "experience": {
         "type": "number",
         "description": "The number of years of teaching experience the tutor has."
        },
        "bio": {
         "type": "string",
         "description": "A brief biography of the tutor."
        }
       },
       "required": [
        "tutor_id",
        "subjects",
        "grades",
        "rate",
        "rating",
        "experience",
        "bio"
       ]
      },
    run: (a: A) => { req(a, "tutor_id", "str"); return tutorProfile(a as unknown as Parameters<typeof tutorProfile>[0]); } },
  { name: "tutor_slots", title: "Tutor slots", annot: RO,
    description: "Retrieve available intro-session start times for a tutor on a specific date. Use when you need to schedule an intro session. Do NOT use when you need to find a tutor, use search_tutors.",
    inputSchema: { type: "object", properties: {
      tutor_id: { description: "Unique ID of the tutor to check availability for.", type: "string" },
      date: { type: "string", description: "Date YYYY-MM-DD" },
    }, required: ["tutor_id", "date"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "tutor_id": {
         "type": "string",
         "description": "The unique identifier for the tutor."
        },
        "date": {
         "type": "string",
         "description": "The date for which the slots are retrieved, in YYYY-MM-DD format."
        },
        "slots": {
         "type": "array",
         "description": "List of available intro-session start times.",
         "items": {
          "type": "string",
          "format": "date-time",
          "description": "An available start time for an intro session, in ISO UTC format."
         }
        }
       },
       "required": [
        "tutor_id",
        "date",
        "slots"
       ]
      },
    run: (a: A, env: Env) => { req(a, "tutor_id", "str"); req(a, "date", "str"); return store(env).tutorSlots(a as unknown as { tutor_id: string; date: string }); } },
  { name: "quote_plan", title: "Quote plan", annot: RO,
    description: "Calculate the cost of a weekly tutoring plan. Use when estimating long-term tutoring expenses; avoid when needing tutor availability, use tutor_slots.",
    inputSchema: { type: "object", properties: {
      tutor_id: { description: "ID of the tutor to calculate the plan for", type: "string" },
      sessions_per_week: { type: "number", description: "Number of tutoring sessions per week" },
      weeks: { type: "number", description: "Number of weeks for the tutoring plan" },
    }, required: ["tutor_id", "sessions_per_week", "weeks"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "tutor_id": {
         "type": "string",
         "description": "The unique identifier for the tutor."
        },
        "total_sessions": {
         "type": "number",
         "description": "The total number of tutoring sessions in the plan."
        },
        "total_price_usd": {
         "type": "number",
         "description": "The total price in USD for the tutoring plan."
        },
        "discount_applied": {
         "type": "boolean",
         "description": "Indicates whether a discount was applied to the plan."
        },
        "discount_amount_usd": {
         "type": "number",
         "description": "The amount of discount applied in USD."
        }
       },
       "required": [
        "tutor_id",
        "total_sessions",
        "total_price_usd",
        "discount_applied",
        "discount_amount_usd"
       ]
      },
    run: (a: A) => { req(a, "tutor_id", "str"); req(a, "sessions_per_week", "num"); req(a, "weeks", "num"); return quotePlan(a as unknown as Parameters<typeof quotePlan>[0]); } },
  { name: "request_intro", title: "Request intro", annot: WR,
    description: "Schedule an intro session with a tutor in an open slot. Use this when you have a specific tutor and time slot in mind. Do NOT use this when you need to find available tutors, use search_tutors instead.",
    inputSchema: { type: "object", properties: {
      tutor_id: { description: "ID of the tutor to schedule with", type: "string" },
      starts_at: { type: "string", description: "ISO start from tutor_slots" },
      student_name: { description: "Name of the student requesting the session", type: "string" },
      subject: { description: "Subject of the tutoring session", type: "string" },
      grade: { type: "string", description: "K or 1-12" },
      contact: { type: "string", description: "Parent email or phone" },
      idempotency_key: { type: "string", description: "Client-generated unique key per request" },
    }, required: ["tutor_id", "starts_at", "student_name", "subject", "grade", "contact", "idempotency_key"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "request_id": {
         "type": "string",
         "description": "Unique identifier for the intro request."
        },
        "tutor_id": {
         "type": "string",
         "description": "ID of the tutor for the intro session."
        },
        "starts_at": {
         "type": "string",
         "description": "ISO start time of the intro session."
        },
        "student_name": {
         "type": "string",
         "description": "Name of the student for the intro session."
        },
        "subject": {
         "type": "string",
         "description": "Subject of the intro session."
        },
        "grade": {
         "type": "string",
         "description": "Grade level of the student (K or 1-12)."
        },
        "contact": {
         "type": "string",
         "description": "Parent's email or phone number for contact."
        },
        "idempotency_key": {
         "type": "string",
         "description": "Client-generated unique key for idempotency."
        },
        "status": {
         "type": "string",
         "description": "Current status of the intro request (e.g., pending, confirmed, canceled)."
        },
        "confirmed_at": {
         "type": "string",
         "description": "ISO timestamp when the tutor confirmed the intro session."
        },
        "canceled_at": {
         "type": "string",
         "description": "ISO timestamp when the intro session was canceled."
        }
       },
       "required": [
        "request_id",
        "tutor_id",
        "starts_at",
        "student_name",
        "subject",
        "grade",
        "contact",
        "idempotency_key",
        "status"
       ]
      },
    run: (a: A, env: Env) => {
      for (const k of ["tutor_id", "starts_at", "student_name", "subject", "grade", "contact", "idempotency_key"]) req(a, k, "str");
      return store(env).requestIntro(a as unknown as { tutor_id: string; starts_at: string; student_name: string; subject: string; grade: string; contact: string; idempotency_key: string });
    } },
  { name: "get_request", title: "Get request", annot: RO,
    description: "Retrieve an intro request's status by id. Use when you need to check the status of a specific request. Do NOT use when you need to find available tutors; use search_tutors instead.",
    inputSchema: { type: "object", properties: {
      request_id: { description: "The unique identifier of the request to check status", type: "string" },
    }, required: ["request_id"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "request_id": {
         "type": "string",
         "description": "The unique identifier for the request."
        },
        "status": {
         "type": "string",
         "description": "The current status of the request, e.g., 'pending', 'approved', 'rejected', 'completed'."
        },
        "tutor_id": {
         "type": "string",
         "description": "The unique identifier for the tutor assigned to the request."
        },
        "student_id": {
         "type": "string",
         "description": "The unique identifier for the student who made the request."
        },
        "requested_at": {
         "type": "string",
         "format": "date-time",
         "description": "The date and time when the request was made."
        },
        "updated_at": {
         "type": "string",
         "format": "date-time",
         "description": "The date and time when the request status was last updated."
        },
        "details": {
         "type": "string",
         "description": "Additional details or notes about the request."
        }
       },
       "required": [
        "request_id",
        "status",
        "tutor_id",
        "student_id",
        "requested_at",
        "updated_at"
       ]
      },
    run: (a: A, env: Env) => { req(a, "request_id", "str"); return store(env).getRequest(a as unknown as { request_id: string }); } },
  { name: "cancel_request", title: "Cancel request", annot: DE,
    description: "Cancel an intro request by ID. Use when a user changes their mind. Do NOT use to reschedule, use tutor_slots instead.",
    inputSchema: { type: "object", properties: {
      request_id: { description: "ID of the request to cancel, alphanumeric string", type: "string" },
    }, required: ["request_id"] },
      outputSchema: {
       "type": "object",
       "properties": {
        "status": {
         "type": "string",
         "description": "The status of the cancellation request, e.g., 'success' or 'failure'."
        },
        "message": {
         "type": "string",
         "description": "A human-readable message indicating the result of the cancellation."
        },
        "request_id": {
         "type": "string",
         "description": "The ID of the canceled intro request."
        }
       },
       "required": [
        "status",
        "message",
        "request_id"
       ]
      },
    run: (a: A, env: Env) => { req(a, "request_id", "str"); return store(env).cancelRequest(a as unknown as { request_id: string }); } },
];

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
const cors = (request: Request) => {
  const origin = request.headers.get("origin");
  return { "Access-Control-Allow-Origin": origin || "*", Vary: "Origin" };
};
const KNOWN_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
function negotiateVersion(client: unknown): string {
  if (typeof client !== "string") return "2025-11-25";
  const eligible = KNOWN_VERSIONS.filter((v) => v <= client);
  return eligible.length > 0 ? eligible[eligible.length - 1] : KNOWN_VERSIONS[0];
}
const INSTRUCTIONS = "TutorNow matches K-12 students with vetted tutors. Search by subject and grade, check open slots, quote a weekly plan, or request an intro session (tutor confirms; nothing charged for the intro).";
const STYLE = "body{font-family:system-ui;max-width:720px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}";
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
const LEGAL_PAGES: Record<string, string> = {
  "/": page("TutorNow", `<h1>TutorNow</h1><p>Find vetted K-12 tutors by subject and grade, quote weekly plans, and request intro sessions - served over MCP at <code>/mcp</code>. Intro requests are held for tutor confirmation; nothing is charged for the intro.</p><p><a href="/privacy">Privacy</a> - <a href="/terms">Terms</a> - <a href="/support">Support</a></p>`),
  "/privacy": page("Privacy Policy - TutorNow", `<h1>Privacy Policy - TutorNow</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Data we process</h2><p>Student and parent details you provide (names, subjects, grades, contact info, requested times) and technical logs (timestamps, tool names, error codes). No accounts, no profiles.</p><h2>2. How we use it</h2><p>To match tutors, hold intro requests and compute plan quotes; to enforce rate limits; to debug errors; to prevent abuse.</p><h2>3. Storage and retention</h2><p>Intro requests are held until cancelled or confirmed. Technical logs are retained up to 90 days, then deleted.</p><h2>4. Sharing</h2><p>We do not sell personal data. Request details go to the chosen tutor for confirmation. Data is shared only with infrastructure providers (hosting, content delivery) under contract as needed to operate the service.</p><h2>5. Your rights</h2><p>Request access, correction or deletion at support@magicteams.ai. We respond within 30 days.</p>`),
  "/terms": page("Terms of Service - TutorNow", `<h1>Terms of Service - TutorNow</h1><p><strong>Operator:</strong> MagicTeams - support@magicteams.ai<br><strong>Last updated:</strong> 2026-10-04</p><h2>1. Service</h2><p>TutorNow matches students with tutors and holds intro-session requests for tutor confirmation within 24 hours. The intro itself carries no charge; paid plans are quoted before any commitment.</p><h2>2. Acceptable use</h2><p>No abuse, scraping, rate-limit evasion, or false requests. We may suspend abusive access.</p><h2>3. Payments</h2><p>Currently free. If paid features launch, pricing, currency and refund terms will be published before charges apply.</p><h2>4. Liability</h2><p>Service provided as-is. To the extent permitted by law, the operator is not liable for session outcomes or scheduling decisions.</p>`),
  "/support": page("Support - TutorNow", `<h1>Support - TutorNow</h1><p>Email <strong>support@magicteams.ai</strong> with your question, the tool name, and the inputs you used. We aim to respond within 2 business days.</p>`),
};

// ==== AGENT SURFACES (generated by scripts/agent-surfaces.mjs — do not hand-edit) ====
const AGENT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Vetted K-12 tutors, fast"><title>TutorNow — MCP tools for AI assistants</title><style>body{font-family:system-ui;max-width:760px;margin:2em auto;padding:0 1em;line-height:1.6;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left;font-size:.92em}code{background:#f4f4f4;padding:.1em .3em;border-radius:3px}</style><script type="application/ld+json">{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:&quot;SoftwareApplication&quot;,&quot;name&quot;:&quot;TutorNow&quot;,&quot;url&quot;:&quot;https://tutor-now.magicteams.ai&quot;,&quot;applicationCategory&quot;:&quot;EducationApplication&quot;,&quot;operatingSystem&quot;:&quot;Any (MCP client)&quot;,&quot;description&quot;:&quot;Vetted K-12 tutors, fast&quot;,&quot;offers&quot;:{&quot;@type&quot;:&quot;Offer&quot;,&quot;price&quot;:&quot;0&quot;,&quot;priceCurrency&quot;:&quot;USD&quot;},&quot;provider&quot;:{&quot;@type&quot;:&quot;Organization&quot;,&quot;name&quot;:&quot;MagicTeams&quot;,&quot;email&quot;:&quot;support@magicteams.ai&quot;}}</script></head><body><h1>TutorNow</h1><p>TutorNow matches K-12 students with vetted tutors across math, science, English and more. Search by subject and grade, compare rates and ratings, check a tutor's open slots, quote a weekly plan with long-plan discounts, and request an intro session. Tutors confirm within 24 hours; the intro carries no charge.</p><h2>Use from your AI assistant</h2><p>MCP endpoint (Streamable HTTP): <code>POST https://tutor-now.magicteams.ai/mcp</code></p><p>Find <strong>TutorNow</strong> in the ChatGPT Apps, Claude Connectors, and Meta Muse directories — or connect the MCP URL directly.</p><h2>Tools</h2><table><tr><th>Tool</th><th>What it does</th></tr><tr><td><code>search_tutors</code></td><td>Find vetted tutors by subject, with optional grade, max hourly rate and result limit. Returns matches sorted by rating.</td></tr><tr><td><code>tutor_profile</code></td><td>Full profile for one tutor: subjects, grades, rate, rating, experience and bio.</td></tr><tr><td><code>tutor_slots</code></td><td>Open intro-session start times (ISO UTC) for a tutor on a date (YYYY-MM-DD). Call before requesting.</td></tr><tr><td><code>quote_plan</code></td><td>Quote a weekly tutoring plan: total sessions and USD price with long-plan discounts. No booking made.</td></tr><tr><td><code>request_intro</code></td><td>Request an intro session in an open slot. Idempotent on idempotency_key: repeats return the same request, never double-books. The tutor confirms within 24 hours; nothing is charged for the intro.</td></tr><tr><td><code>get_request</code></td><td>Get an intro request's status by id.</td></tr><tr><td><code>cancel_request</code></td><td>Cancel an intro request. The slot opens again. Cannot be undone - confirm with the user first.</td></tr></table><p>Free. Computed per request; nothing stored.</p><h2>For agents</h2><p><a href="/llms.txt">llms.txt</a> · <a href="/.well-known/agent.json">agent.json</a> · <a href="/.well-known/ucp">UCP profile</a> · <a href="/sitemap.xml">sitemap</a></p><p><a href="/privacy">Privacy</a> — <a href="/terms">Terms</a> — <a href="/support">Support</a></p></body></html>`;
const AGENT_LLMS = `# TutorNow

> Vetted K-12 tutors, fast

TutorNow matches K-12 students with vetted tutors across math, science, English and more. Search by subject and grade, compare rates and ratings, check a tutor's open slots, quote a weekly plan with long-plan discounts, and request an intro session. Tutors confirm within 24 hours; the intro carries no charge.

## Use from an AI assistant

- MCP endpoint (Streamable HTTP, JSON profile): POST https://tutor-now.magicteams.ai/mcp
- Directories: ChatGPT Apps, Claude Connectors, Meta Muse (search "TutorNow")
- Machine manifest: https://tutor-now.magicteams.ai/.well-known/agent.json
- UCP discovery profile: https://tutor-now.magicteams.ai/.well-known/ucp

## Tools

- search_tutors: Search tutors — Find vetted tutors by subject, with optional grade, max hourly rate and result limit. Returns matches sorted by rating.
- tutor_profile: Tutor profile — Full profile for one tutor: subjects, grades, rate, rating, experience and bio.
- tutor_slots: Tutor slots — Open intro-session start times (ISO UTC) for a tutor on a date (YYYY-MM-DD). Call before requesting.
- quote_plan: Quote plan — Quote a weekly tutoring plan: total sessions and USD price with long-plan discounts. No booking made.
- request_intro: Request intro — Request an intro session in an open slot. Idempotent on idempotency_key: repeats return the same request, never double-books. The tutor confirms within 24 hours; nothing is charged for the intro.
- get_request: Get request — Get an intro request's status by id.
- cancel_request: Cancel request — Cancel an intro request. The slot opens again. Cannot be undone - confirm with the user first.

All tools are free, compute per request, and store nothing.

## Operator

MagicTeams — support@magicteams.ai — https://tutor-now.magicteams.ai/support
`;
const AGENT_ROBOTS = `# Generated by agent-surfaces.mjs (policy: max_visibility, per AIReady)
User-agent: *
Allow: /

# Allow every known AI bot
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: CCBot
Allow: /
User-agent: Meta-ExternalAgent
Allow: /
User-agent: Bytespider
Allow: /
User-agent: Amazonbot
Allow: /

Content-Signal: search=yes, ai-input=yes, ai-train=yes

Sitemap: https://tutor-now.magicteams.ai/sitemap.xml
`;
const AGENT_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://tutor-now.magicteams.ai/</loc></url>
  <url><loc>https://tutor-now.magicteams.ai/privacy</loc></url>
  <url><loc>https://tutor-now.magicteams.ai/terms</loc></url>
  <url><loc>https://tutor-now.magicteams.ai/support</loc></url>
  <url><loc>https://tutor-now.magicteams.ai/llms.txt</loc></url>
</urlset>
`;
const AGENT_UCP = {"ucp":{"version":"2026-08-25","services":{},"payment_handlers":{}}};
const AGENT_MANIFEST = {"name":"TutorNow","version":"1.0.0","description":"Vetted K-12 tutors, fast","url":"https://tutor-now.magicteams.ai","mcp_endpoint":"https://tutor-now.magicteams.ai/mcp","protocol":"mcp-streamable-http","authentication":"none","pricing":"free","tools":[{"name":"search_tutors","title":"Search tutors","description":"Find vetted tutors by subject, with optional grade, max hourly rate and result limit. Returns matches sorted by rating."},{"name":"tutor_profile","title":"Tutor profile","description":"Full profile for one tutor: subjects, grades, rate, rating, experience and bio."},{"name":"tutor_slots","title":"Tutor slots","description":"Open intro-session start times (ISO UTC) for a tutor on a date (YYYY-MM-DD). Call before requesting."},{"name":"quote_plan","title":"Quote plan","description":"Quote a weekly tutoring plan: total sessions and USD price with long-plan discounts. No booking made."},{"name":"request_intro","title":"Request intro","description":"Request an intro session in an open slot. Idempotent on idempotency_key: repeats return the same request, never double-books. The tutor confirms within 24 hours; nothing is charged for the intro."},{"name":"get_request","title":"Get request","description":"Get an intro request's status by id."},{"name":"cancel_request","title":"Cancel request","description":"Cancel an intro request. The slot opens again. Cannot be undone - confirm with the user first."}],"directories":{"chatgpt":"https://platform.openai.com/plugins","claude":"https://claude.ai/directory/manage","muse":"https://muse.ai/platform","registry":"https://registry.modelcontextprotocol.io/servers/io.github.everyai-com/tutor-now","smithery":"https://smithery.ai/servers/tradephani/tutor-now"},"llms_txt":"https://tutor-now.magicteams.ai/llms.txt","ucp_profile":"https://tutor-now.magicteams.ai/.well-known/ucp","support":"https://tutor-now.magicteams.ai/support","operator":"MagicTeams <support@magicteams.ai>"};
function agentSurface(url: URL): Response | null {
  if (url.pathname === "/") return new Response(AGENT_HOME, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/llms.txt") return new Response(AGENT_LLMS, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (url.pathname === "/robots.txt") return new Response(AGENT_ROBOTS, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (url.pathname === "/sitemap.xml") return new Response(AGENT_SITEMAP, { headers: { "content-type": "application/xml; charset=utf-8" } });
  if (url.pathname === "/.well-known/ucp") return json(AGENT_UCP);
  if (url.pathname === "/.well-known/agent.json") return json(AGENT_MANIFEST);
  return null;
}
// ==== END AGENT SURFACES ====

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, tools: 7 });
    if (request.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
      if (!env.OPENAI_APPS_CHALLENGE_TOKEN) return new Response("not configured", { status: 404 });
      return new Response(env.OPENAI_APPS_CHALLENGE_TOKEN, { headers: { "content-type": "text/plain" } });
    }
    { const surface = agentSurface(url); if (surface) return surface; }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/privacy" || url.pathname === "/terms" || url.pathname === "/support"))
      return new Response(LEGAL_PAGES[url.pathname as "/" | "/privacy" | "/terms" | "/support"], { headers: { "content-type": "text/html; charset=utf-8" } });
    if (request.method === "OPTIONS" && (url.pathname === "/mcp" || url.pathname === "/mcp/"))
      return new Response(null, { status: 204, headers: { ...cors(request),
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
        "Access-Control-Max-Age": "86400" } });
    if (request.method === "GET" && (url.pathname === "/mcp" || url.pathname === "/mcp/")) {
      if ((request.headers.get("accept") || "").includes("text/event-stream"))
        return new Response("SSE streams not supported; use POST with application/json",
          { status: 405, headers: { Allow: "POST", ...cors(request) } });
      return json({ name: "TutorNow MCP", transport: "Streamable HTTP (JSON response profile)",
        tools: TOOLS.map((t) => t.name) }, 200, cors(request));
    }
    if (request.method === "DELETE" && (url.pathname === "/mcp" || url.pathname === "/mcp/"))
      return new Response("No sessions; use POST with application/json",
        { status: 405, headers: { Allow: "POST", ...cors(request) } });
    if ((url.pathname !== "/mcp" && url.pathname !== "/mcp/") || request.method !== "POST") return json({ error: "use POST /mcp, GET /health" }, 404);
    if (env.API_KEY && !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.API_KEY}`))
      return json({ error: "unauthorized" }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "body too large" }, 413);
    const body = (await request.json()) as { id?: unknown; method?: string; params?: { name?: string; arguments?: A } };
    const id = body.id ?? null;
    if (body.method === undefined || body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (body.method === "ping") return json({ jsonrpc: "2.0", id, result: {} }, 200, cors(request));
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
      protocolVersion: negotiateVersion((body.params as unknown as { protocolVersion?: unknown })?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "tutor-now", version: VERSION },
      instructions: INSTRUCTIONS,
    } }, 200, cors(request));
    if (body.method === "server/discover") return json({ jsonrpc: "2.0", id, result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28", ...KNOWN_VERSIONS.slice().reverse()],
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "tutor-now", version: VERSION } },
      instructions: INSTRUCTIONS,
      ttlMs: 3600000,
      cacheScope: "public",
    } }, 200, cors(request));
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: { ...t.annot } })) } }, 200, cors(request));
    if (body.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === body.params?.name);
      if (!tool) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool '${body.params?.name}'` } }, 200, cors(request));
      try {
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await tool.run(body.params?.arguments ?? {}, env)) }] } }, 200, cors(request));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool failed";
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: msg.startsWith("ERROR") ? msg : `ERROR ${msg}` }], isError: true } }, 200, cors(request));
      }
    }
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: `unsupported method '${body.method}'` } }, 200, cors(request));
  } catch { return json({ error: "bad request" }, 400); }
}

export default { async fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } } satisfies ExportedHandler<Env>;
