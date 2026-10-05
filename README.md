# Connectors — free MCP servers for AI assistants

16 production MCP servers (Streamable HTTP) by MagicTeams, listed in the
ChatGPT Apps, Claude Connectors, and Meta Muse directories. Free, computed
per request, nothing stored.

| Server | What it does | MCP endpoint |
|---|---|---|
| [`sahadeva`](servers/sahadeva) | Vedic astrology MCP: panchanga, kundli matching, muhurta, dashas. | `https://sahadeva.magicteams.ai/mcp` |
| [`festival-finder`](servers/festival-finder) | Computed Hindu festival dates: Diwali, Holi, Navratri, more. | `https://festival-finder.magicteams.ai/mcp` |
| [`invoice-gen`](servers/invoice-gen) | Freelancer invoices with totals, tax, due dates. Free. | `https://invoice-gen.magicteams.ai/mcp` |
| [`report-raja`](servers/report-raja) | Weekly client reports: accomplishments, hours, blockers. Free. | `https://report-raja.magicteams.ai/mcp` |
| [`sheet-shift`](servers/sheet-shift) | Convert and clean tables: CSV, JSON, dedupe, stats. Free. | `https://sheet-shift.magicteams.ai/mcp` |
| [`flight-fix`](servers/flight-fix) | EU261/UK261 flight compensation check, rights and claim letters. Free. | `https://flight-fix.magicteams.ai/mcp` |
| [`court-split`](servers/court-split) | Split court costs, settle up and plan fair rotations for pickup games. Free. | `https://court-split.magicteams.ai/mcp` |
| [`lease-break`](servers/lease-break) | Estimate early lease termination costs, compare options and draft notice letters. Free. | `https://lease-break.magicteams.ai/mcp` |
| [`ai-ready`](servers/ai-ready) | Scan and fix your site's AI discoverability: crawler access, llms.txt, JSON-LD. Free. | `https://ai-ready.magicteams.ai/mcp` |
| [`league-night`](servers/league-night) | Round-robin fixtures, standings and match-day plans for league organizers. Free. | `https://league-night.magicteams.ai/mcp` |
| [`fee-fighter`](servers/fee-fighter) | Audit junk fees, project annual costs and draft dispute letters. Free. | `https://fee-fighter.magicteams.ai/mcp` |
| [`room-split`](servers/room-split) | Split rent and utilities by room, settle up and generate roommate agreements. Free. | `https://room-split.magicteams.ai/mcp` |
| [`party-plan`](servers/party-plan) | Party budgets, headcount quantities, timelines and checklists. Free. | `https://party-plan.magicteams.ai/mcp` |
| [`service-schedule`](servers/service-schedule) | Car maintenance due dates, cost estimates and seasonal checklists. Free. | `https://service-schedule.magicteams.ai/mcp` |
| [`recipe-scale`](servers/recipe-scale) | Scale recipes, convert kitchen units and merge shopping lists. Free. | `https://recipe-scale.magicteams.ai/mcp` |
| [`tutor-now`](servers/tutor-now) | Vetted K-12 tutor matching, plan quotes and intro-session requests. Free. | `https://tutor-now.magicteams.ai/mcp` |

## Use from your AI assistant

- ChatGPT / Claude / Muse: search the server name in the app directory.
- Direct MCP: `POST https://<server>.magicteams.ai/mcp` (Streamable HTTP, JSON profile).
- Agent manifest: `https://<server>.magicteams.ai/.well-known/agent.json`

