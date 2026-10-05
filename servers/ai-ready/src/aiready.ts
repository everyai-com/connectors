/**
 * AIReady engine - AI discoverability for websites.
 *
 * One scan tool (check_ai_readiness) fetches ONLY https://<domain>/, /robots.txt,
 * /llms.txt and /sitemap.xml of the domain the caller supplies, with SSRF guards,
 * timeouts and size caps. Everything else is pure generation/reference data.
 * Informational self-help; not legal advice.
 */

export const DISCLAIMER =
  "Informational self-help for AI discoverability (robots.txt, llms.txt, structured data, Content Signals). Crawler behaviour can change; verify decisions against each provider's current documentation.";

// ── AI crawler reference table ──────────────────────────────────────────────
export interface Crawler {
  bot: string;
  owner: string;
  purpose: string;
  ua: string;
  visibility_critical: boolean;
  advice: string;
}

export const CRAWLERS: Crawler[] = [
  { bot: "OAI-SearchBot", owner: "OpenAI", purpose: "ChatGPT search index", ua: "OAI-SearchBot", visibility_critical: true, advice: "Allow to appear in ChatGPT search results." },
  { bot: "ChatGPT-User", owner: "OpenAI", purpose: "User-triggered page visits", ua: "ChatGPT-User", visibility_critical: true, advice: "Allow so ChatGPT can open your page when a user asks." },
  { bot: "GPTBot", owner: "OpenAI", purpose: "Model training", ua: "GPTBot", visibility_critical: false, advice: "Block if you do not want content used for training." },
  { bot: "ClaudeBot", owner: "Anthropic", purpose: "Claude search + training", ua: "ClaudeBot", visibility_critical: true, advice: "Allow for Claude citations and discovery." },
  { bot: "Claude-User", owner: "Anthropic", purpose: "User-triggered page visits", ua: "Claude-User", visibility_critical: true, advice: "Allow so Claude can fetch your page for a user." },
  { bot: "anthropic-ai", owner: "Anthropic", purpose: "Legacy training crawler", ua: "anthropic-ai", visibility_critical: false, advice: "Historical token; keep consistent with ClaudeBot." },
  { bot: "PerplexityBot", owner: "Perplexity", purpose: "Search index", ua: "PerplexityBot", visibility_critical: true, advice: "Allow to be citable in Perplexity answers." },
  { bot: "Google-Extended", owner: "Google", purpose: "Gemini training signal (control token, not a crawler)", ua: "Google-Extended", visibility_critical: false, advice: "Controls Gemini training use of your content; search ranking is unaffected by it." },
  { bot: "Applebot-Extended", owner: "Apple", purpose: "Apple Intelligence training signal", ua: "Applebot-Extended", visibility_critical: false, advice: "Opt-out token for Apple AI training." },
  { bot: "CCBot", owner: "Common Crawl", purpose: "Open training corpus", ua: "CCBot", visibility_critical: false, advice: "Many open datasets build on Common Crawl." },
  { bot: "Meta-ExternalAgent", owner: "Meta", purpose: "Meta AI training", ua: "Meta-ExternalAgent", visibility_critical: false, advice: "Block if you do not want Meta AI training usage." },
  { bot: "Bytespider", owner: "ByteDance", purpose: "AI + search indexing", ua: "Bytespider", visibility_critical: false, advice: "Often blocked due to crawl volume; minor visibility impact in Western markets." },
  { bot: "Amazonbot", owner: "Amazon", purpose: "AI quality + search", ua: "Amazonbot", visibility_critical: false, advice: "Feeds Alexa/Amazon surfaces." },
];

export function crawlerPolicyGuide(): object {
  return {
    crawlers: CRAWLERS,
    by_purpose: {
      want_ai_visibility: CRAWLERS.filter((c) => c.visibility_critical).map((c) => c.bot),
      training_controls: CRAWLERS.filter((c) => c.purpose.toLowerCase().includes("training")).map((c) => c.bot),
    },
    rules_of_thumb: [
      "Search/answer bots (OAI-SearchBot, ClaudeBot, PerplexityBot, user-triggered bots) drive being cited - keep them allowed.",
      "Training controls (GPTBot, Google-Extended, CCBot, Meta-ExternalAgent) are a values/business choice, not required for visibility.",
      "Control tokens (Google-Extended, Applebot-Extended) do not affect classic search ranking.",
      "Cloudflare customers can also express policy in robots.txt with Content-Signal lines (search / ai-input / ai-train).",
    ],
    disclaimer: DISCLAIMER,
  };
}

// ── robots.txt parsing ──────────────────────────────────────────────────────
interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

interface RobotsRules {
  groups: RobotsGroup[];
  sitemaps: string[];
  content_signals: string[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const content_signals: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) {
      lastWasAgent = false;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) {
      current = { agents: ["*"], allow: [], disallow: [] };
      groups.push(current);
    }
    if (field === "allow") current.allow.push(value);
    else if (field === "disallow") current.disallow.push(value);
    else if (field === "sitemap") sitemaps.push(value);
    else if (field === "content-signal" || field === "content-signals") content_signals.push(value);
  }
  return { groups, sitemaps, content_signals };
}

function agentMatches(agentField: string, botUa: string): boolean {
  const a = agentField.trim().toLowerCase();
  const b = botUa.trim().toLowerCase();
  if (a === "*") return true;
  return b === a || b.startsWith(a) || a.startsWith(b);
}

/** Does this rule path block the root path "/"? */
function coversRoot(patterns: string[]): { covered: boolean; rule: string | null } {
  let best: { len: number; rule: string } | null = null;
  for (const p of patterns) {
    const clean = p.trim();
    // "" means allow everything (disallow: empty) - ignore for blocking; "/" or "/*" covers root.
    if (clean === "" ) continue;
    if (clean === "/" || clean === "/*") {
      const len = clean.length;
      if (!best || len >= best.len) best = { len, rule: clean };
    }
  }
  return best ? { covered: true, rule: best.rule } : { covered: false, rule: null };
}

export type BotAccess = "allowed" | "blocked" | "no-rule";

export function evaluateBotAccess(rules: RobotsRules, botUa: string): BotAccess {
  const specific = rules.groups.filter((g) => g.agents.some((a) => a !== "*" && agentMatches(a, botUa)));
  const wildcard = rules.groups.filter((g) => g.agents.includes("*"));
  const group = specific.length > 0 ? specific[specific.length - 1] : wildcard.length > 0 ? wildcard[wildcard.length - 1] : null;
  if (!group) return "no-rule";
  const deny = coversRoot(group.disallow);
  const allow = coversRoot(group.allow);
  if (!deny.covered) return "allowed";
  if (allow.covered && allow.rule && deny.rule && allow.rule.length >= deny.rule.length) return "allowed";
  return "blocked";
}

// ── llms.txt + homepage parsing ─────────────────────────────────────────────
export function parseLlmsTxt(text: string): object {
  const lines = text.split(/\r?\n/);
  const h1 = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? null;
  const sections = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
  const links = (text.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length;
  const has_summary = lines.some((l) => l.startsWith("> "));
  return { present: true, bytes: new TextEncoder().encode(text).length, title: h1, sections, link_count: links, has_summary };
}

export function parseHomepage(html: string): object {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim()
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]?.trim() ?? null;
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)?.[1] ?? null;
  const schemaTypes = new Set<string>();
  const ldMatches = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ldMatches) {
    const body = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    const types = body.match(/"@type"\s*:\s*"([^"]+)"/g) ?? [];
    for (const t of types) schemaTypes.add(t.replace(/.*"@type"\s*:\s*"/, "").replace(/"$/, ""));
  }
  return { title, description, canonical, schema_types: [...schemaTypes] };
}

// ── SSRF-guarded fetch helpers ──────────────────────────────────────────────
const MAX_BYTES = 200_000;

export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = host.split("/")[0].split("?")[0];
  if (host.includes("@")) throw new Error("domain must not include credentials.");
  if (host.includes(":")) throw new Error("domain must not include a port.");
  if (/[^\x00-\x7F]/.test(host)) throw new Error("use the ASCII/punycode form of the domain.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new Error("IP addresses are not supported - use a domain name.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    throw new Error("private hosts are not supported.");
  }
  if (!host.includes(".") || host.length > 253) throw new Error(`'${input}' does not look like a domain (example: example.com).`);
  return host;
}

interface FetchedPage {
  status: number;
  ok: boolean;
  text: string | null;
  bytes: number;
  truncated: boolean;
  error?: string;
}

async function fetchText(url: string): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "AIReadyBot/1.0 (+https://ai-ready.magicteams.ai)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: res.status, ok: false, text: null, bytes: 0, truncated: false };
    const full = await res.text();
    const truncated = full.length > MAX_BYTES;
    return { status: res.status, ok: true, text: truncated ? full.slice(0, MAX_BYTES) : full, bytes: truncated ? MAX_BYTES : new TextEncoder().encode(full).length, truncated };
  } catch (e) {
    return { status: 0, ok: false, text: null, bytes: 0, truncated: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── the scan ────────────────────────────────────────────────────────────────
export interface CheckResult {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  weight: number;
  detail: string;
}

export async function checkAiReadiness(input: { domain: string }): Promise<object> {
  const domain = normalizeDomain(input.domain);
  const base = `https://${domain}`;

  const [robotsRes, llmsRes, sitemapRes, homeRes] = await Promise.all([
    fetchText(`${base}/robots.txt`),
    fetchText(`${base}/llms.txt`),
    fetchText(`${base}/sitemap.xml`),
    fetchText(`${base}/`),
  ]);

  if (!homeRes.ok && homeRes.status === 0) {
    throw new Error(`could not reach https://${domain} (${homeRes.error ?? "network error"}). Check the domain spelling and that the site is up.`);
  }

  const robots = robotsRes.ok && robotsRes.text ? parseRobots(robotsRes.text) : null;
  const crawler_access = CRAWLERS.map((c) => ({
    bot: c.bot,
    owner: c.owner,
    purpose: c.purpose,
    visibility_critical: c.visibility_critical,
    access: robots ? evaluateBotAccess(robots, c.ua) : ("no-rule" as BotAccess),
    advice: c.advice,
  }));

  const criticalBlocked = crawler_access.filter((c) => c.visibility_critical && c.access === "blocked");
  const checks: CheckResult[] = [];

  checks.push({
    id: "search_bots_allowed",
    name: "AI search/answer bots allowed",
    status: criticalBlocked.length === 0 ? "pass" : "fail",
    weight: 25,
    detail: robots
      ? criticalBlocked.length === 0
        ? "All visibility-critical bots are allowed by robots.txt."
        : `Blocked by robots.txt: ${criticalBlocked.map((c) => c.bot).join(", ")}. These drive AI citations.`
      : "No robots.txt found - crawlers default to allowed (that is fine).",
  });

  const llms = llmsRes.ok && llmsRes.text ? (parseLlmsTxt(llmsRes.text) as { bytes: number; title: string | null; sections: string[] }) : null;
  checks.push({
    id: "llms_txt",
    name: "llms.txt present",
    status: llms && llms.title ? "pass" : llms ? "warn" : "fail",
    weight: 20,
    detail: llms
      ? llms.title
        ? `Found (${llms.bytes} bytes, ${llms.sections.length} sections).`
        : "Found but missing an '# Title' heading - add one so agents can summarize you."
      : "No llms.txt at the domain root. Add one so AI agents get a curated summary.",
  });

  const sitemapListed = robots?.sitemaps.some((s) => s.includes("sitemap")) ?? false;
  checks.push({
    id: "sitemap",
    name: "Sitemap available",
    status: sitemapRes.ok || sitemapListed ? "pass" : "warn",
    weight: 15,
    detail: sitemapRes.ok
      ? `sitemap.xml found (${sitemapRes.bytes} bytes).`
      : sitemapListed
        ? "No /sitemap.xml but robots.txt points at a sitemap - fine."
        : "No sitemap found - add /sitemap.xml and reference it in robots.txt.",
  });

  const home = homeRes.ok && homeRes.text ? (parseHomepage(homeRes.text) as { title: string | null; description: string | null; schema_types: string[] }) : null;
  const strongTypes = ["Organization", "LocalBusiness", "Product", "FAQPage", "Article", "WebSite"];
  const foundStrong = home?.schema_types.filter((t) => strongTypes.includes(t)) ?? [];
  checks.push({
    id: "structured_data",
    name: "Structured data (schema.org)",
    status: foundStrong.length > 0 ? "pass" : home?.schema_types.length ? "warn" : "fail",
    weight: 15,
    detail:
      foundStrong.length > 0
        ? `Found: ${foundStrong.join(", ")}.`
        : home?.schema_types.length
          ? `Only found: ${home.schema_types.join(", ")} - add Organization/LocalBusiness/Product JSON-LD.`
          : "No JSON-LD found on the homepage. Add schema.org data so assistants can identify you.",
  });

  checks.push({
    id: "meta",
    name: "Title + meta description",
    status: home?.title && home?.description ? "pass" : "warn",
    weight: 10,
    detail: home?.title && home?.description ? `Title: "${home.title.slice(0, 80)}".` : "Homepage is missing a title or meta description.",
  });

  checks.push({
    id: "content_signals",
    name: "Content Signals in robots.txt",
    status: robots && robots.content_signals.length > 0 ? "pass" : "warn",
    weight: 10,
    detail:
      robots && robots.content_signals.length > 0
        ? `Found: ${robots.content_signals.join(" | ")}`
        : "No Content-Signal lines (search/ai-input/ai-train). Optional, but they make your AI policy explicit.",
  });

  checks.push({
    id: "https",
    name: "HTTPS reachable",
    status: homeRes.ok ? "pass" : "fail",
    weight: 5,
    detail: homeRes.ok ? `Homepage responded ${homeRes.status}.` : `Homepage responded ${homeRes.status || homeRes.error}.`,
  });

  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const earned = checks.reduce((a, c) => a + (c.status === "pass" ? c.weight : c.status === "warn" ? c.weight / 2 : 0), 0);
  const score = Math.round((earned / totalWeight) * 100);
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

  const findings = checks
    .filter((c) => c.status !== "pass")
    .map((c) => ({ check: c.id, priority: c.status === "fail" ? "high" : "medium", detail: c.detail }));

  const preview = criticalBlocked.length > 0
    ? blockedBotsSnippet(criticalBlocked.map((c) => c.bot))
    : null;

  return {
    domain,
    score,
    grade,
    checks,
    crawler_access,
    findings,
    generated: {
      robots_snippet_to_unblock_search_bots: preview,
      llms_txt_hint: "Use llms_txt_draft to generate a starter llms.txt, then publish it at https://" + domain + "/llms.txt",
    },
    fetched: {
      robots: { status: robotsRes.status, bytes: robotsRes.bytes, truncated: robotsRes.truncated },
      llms: { status: llmsRes.status, bytes: llmsRes.bytes },
      sitemap: { status: sitemapRes.status, bytes: sitemapRes.bytes },
      homepage: { status: homeRes.status, bytes: homeRes.bytes },
    },
    disclaimer: DISCLAIMER,
  };
}

function blockedBotsSnippet(bots: string[]): string {
  return [
    "# AIReady: allow these bots so AI assistants can cite you",
    ...bots.map((b) => `User-agent: ${b}\nAllow: /`),
  ].join("\n\n");
}

// ── generators ──────────────────────────────────────────────────────────────
export type AiPolicy = "max_visibility" | "search_only" | "block_training" | "block_all_ai";

export function robotsTxtForAi(input: { policy: AiPolicy; sitemap_url?: string; content_signals?: boolean }): object {
  const { policy } = input;
  const searchBots = CRAWLERS.filter((c) => c.visibility_critical).map((c) => c.bot);
  const trainingBots = CRAWLERS.filter((c) => !c.visibility_critical).map((c) => c.bot);

  let lines: string[] = ["# Generated by AIReady - AI crawler policy", `# policy: ${policy}`];
  if (policy === "max_visibility") {
    lines.push("", "# Allow every known AI bot", ...CRAWLERS.map((c) => `User-agent: ${c.bot}\nAllow: /`));
  } else if (policy === "search_only" || policy === "block_training") {
    lines.push("", "# Allow AI search/answer bots (visibility)", ...searchBots.map((b) => `User-agent: ${b}\nAllow: /`));
    lines.push("", "# Block training crawlers", ...trainingBots.map((b) => `User-agent: ${b}\nDisallow: /`));
  } else {
    lines.push("", "# Block every known AI bot", ...CRAWLERS.map((c) => `User-agent: ${c.bot}\nDisallow: /`));
  }
  if (input.content_signals !== false) {
    const signal = policy === "max_visibility"
      ? "search=yes, ai-input=yes, ai-train=yes"
      : policy === "block_all_ai"
        ? "search=no, ai-input=no, ai-train=no"
        : "search=yes, ai-input=yes, ai-train=no";
    lines.push("", `Content-Signal: ${signal}`);
  }
  if (input.sitemap_url) lines.push("", `Sitemap: ${input.sitemap_url}`);

  return {
    policy,
    robots_txt: lines.join("\n") + "\n",
    notes: [
      "Paste these rules into your existing robots.txt (do not replace your normal crawl rules).",
      "Content-Signal lines are advisory (Cloudflare Content Signals format) - tell crawlers how your content may be used.",
      "User-triggered bots (ChatGPT-User, Claude-User) are treated as search bots here: blocking them stops assistants opening your page for a user.",
    ],
    disclaimer: DISCLAIMER,
  };
}

export function llmsTxtDraft(input: {
  business_name: string;
  description: string;
  key_pages?: Array<{ title: string; url: string; note?: string }>;
  contact_email?: string;
}): object {
  if (!input.business_name?.trim()) throw new Error("business_name is required.");
  if (!input.description?.trim()) throw new Error("description is required - one sentence about what you offer.");
  const lines = [`# ${input.business_name.trim()}`, "", `> ${input.description.trim()}`, ""];
  const pages = input.key_pages ?? [];
  if (pages.length > 0) {
    lines.push("## Key pages", "");
    for (const p of pages) {
      if (!p.title?.trim() || !p.url?.trim()) throw new Error("each key page needs a title and url.");
      lines.push(`- [${p.title}](${p.url})${p.note ? `: ${p.note}` : ""}`);
    }
    lines.push("");
  }
  if (input.contact_email) {
    lines.push("## Contact", "", `- Email: ${input.contact_email}`, "");
  }
  return {
    llms_txt: lines.join("\n"),
    publish_at: "/llms.txt (site root, text/plain)",
    tips: [
      "Lead with what you do and who you serve - agents summarize straight from the '>' line.",
      "List your most important, stable URLs; skip login walls and duplicates.",
      "Keep it under a few KB; update it when your key pages change.",
    ],
    disclaimer: DISCLAIMER,
  };
}

export type SchemaType = "organization" | "local_business" | "product" | "faq";

export function schemaJsonldSample(input: {
  type: SchemaType;
  name: string;
  url: string;
  description?: string;
  telephone?: string;
  address?: string;
  price?: string;
  questions?: Array<{ question: string; answer: string }>;
}): object {
  if (!input.name?.trim() || !input.url?.trim()) throw new Error("name and url are required.");
  let data: Record<string, unknown>;

  if (input.type === "organization") {
    data = { "@context": "https://schema.org", "@type": "Organization", name: input.name, url: input.url, ...(input.description ? { description: input.description } : {}) };
  } else if (input.type === "local_business") {
    data = {
      "@context": "https://schema.org", "@type": "LocalBusiness", name: input.name, url: input.url,
      ...(input.description ? { description: input.description } : {}),
      ...(input.telephone ? { telephone: input.telephone } : {}),
      ...(input.address ? { address: { "@type": "PostalAddress", streetAddress: input.address } } : {}),
    };
  } else if (input.type === "product") {
    data = { "@context": "https://schema.org", "@type": "Product", name: input.name, url: input.url, ...(input.description ? { description: input.description } : {}), ...(input.price ? { offers: { "@type": "Offer", price: input.price, priceCurrency: input.price.match(/[A-Z]{3}/)?.[0] ?? "USD", url: input.url } } : {}) };
  } else {
    const questions = input.questions ?? [];
    if (questions.length === 0) throw new Error("faq requires questions[{question, answer}].");
    data = {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: questions.map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
    };
  }
  return {
    jsonld: JSON.stringify(data, null, 2),
    placement: "Paste inside <script type=\"application/ld+json\"> ... </script> in the page <head>.",
    tips: [
      "One entity per page that actually represents it (Organization on home, Product on product pages).",
      "Keep name/url/description identical to the visible page content.",
      "Validate with a structured-data testing tool after publishing.",
    ],
    disclaimer: DISCLAIMER,
  };
}
