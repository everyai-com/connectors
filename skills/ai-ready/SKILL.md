---
name: ai-ready
description: Onboard the user to AIReady - scanning and fixing AI discoverability (crawlers, llms.txt, structured data).
---

# AIReady quick start

AIReady shows whether AI assistants can find, read and cite a website, then generates the
fixes. It never gives legal advice and only scans domains the user is entitled to assess.

Suggested flow:

1. Ask for the domain. Run `check_ai_readiness` - the scan fetches only the domain's
   /robots.txt, /llms.txt, /sitemap.xml and homepage.
2. Walk through the findings by priority: blocked visibility-critical bots first
   (OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot), then llms.txt, sitemap,
   structured data, meta, Content Signals.
3. Generate fixes: `robots_txt_for_ai` for the crawler policy they choose,
   `llms_txt_draft` for a starter llms.txt, `schema_jsonld_sample` for JSON-LD.
4. Use `crawler_policy_guide` when they ask "which bots should I allow?".
5. Close with the note that results are informational; crawler behaviour can change.
