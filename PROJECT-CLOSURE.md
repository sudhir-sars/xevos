**Status: Archived — paused pending favorable conditions, 2026-06.**

# xevos — Project Closure

## Executive summary

xevos was an attempt to build an Autonomous Agent Organization (an "OrgOS"): a hierarchy of LLM agents — orchestrator → executive → department head → manager → worker, with a separate auditor actor — that would run a company's recurring functions (marketing, support, outreach) continuously and autonomously. It was local-first, with all state in a single SQLite file accessed through Drizzle and sqlite-vec for semantic recall, and it included a browser-automation package that drove logged-in X (Twitter) and LinkedIn accounts via a CDP engine, with a planned fallback to the platforms' official APIs.

We are shelving it now for three converging reasons, none of which is a bug we can fix in code: the core go-to-market behavior (automating logged-in social accounts) is legally untenable under both platforms' current Terms of Service; the compliant fallback (paid official APIs) is financially unsustainable at the volumes the org was designed for, and on LinkedIn is not available at any price for the use case we built; and the hierarchical design multiplies inference cost roughly 5–8x per task versus a single agent (a figure that disciplined caching and mixed-model routing can bring down, but not eliminate), which a continuously-running, pre-revenue org compounds. This is a strategic archive, not an abandonment — two of the three blockers are price- and policy-sensitive and could move in our favor. The revive criteria are stated explicitly at the end.

---

## Why we're closing

### 1. Platform automation is legally untenable

The original design drove logged-in X and LinkedIn accounts through a browser engine to post, reply, like, follow, and DM. Both platforms prohibit exactly this, and both have a documented record of winning on a **breach-of-contract** theory — which does not depend on the Computer Fraud and Abuse Act and is therefore not cured by "we only touch public data" arguments.

- **X (Twitter):** the Terms of Service bar crawling or scraping "in any form, for any purpose" without prior written consent, and limit access to published interfaces. As of the update effective **Jan 15, 2026**, the ToS retains a **liquidated-damages schedule of $15,000 per 1,000,000 posts** requested, viewed, or accessed in any 24-hour period, stated to be a reasonable estimate of damages and not a cap on other recovery — and the 2026 wording extends liability to anyone who **induces or knowingly facilitates** a violation. This clause attaches to ToS-violating access (scraping/automation outside the API), which is exactly the browser-automation path. As an illustration of scale: a browser-automation responder reading on the order of ~1M posts/day would, on the face of the schedule, accrue roughly $15,000/day in stipulated damages.
- **LinkedIn:** User Agreement §8.2 prohibits using "software, devices, scripts, robots... to scrape... or otherwise copy profiles and other data," and bars "bots or other automated methods to access the Services, add or download contacts, send or redirect messages." The official prohibited-software policy independently bans third-party crawlers, bots, and browser plug-ins that automate activity, with enforcement up to permanent account shutdown. (The verbatim §8.2 text could not be re-fetched directly — linkedin.com/legal returns 403 to automated fetch — so this wording is reconstructed from the official Help-Center prohibited-software page plus consistent secondary citations; the substance is high-confidence.)

**Precedents (verified):**

| Case | Outcome |
|---|---|
| **hiQ Labs v. LinkedIn** (consent judgment, Dec 6 2022) | hiQ held liable for **breach of LinkedIn's User Agreement** (plus CFAA and other claims tied to fake accounts); **$500,000 stipulated judgment**; **permanent injunction**; ordered to destroy scraped data/derived code. **hiQ is permanently closed.** Note: hiQ's earlier 9th-Circuit CFAA win on public data is widely mis-cited as "scraping LinkedIn is legal" — the case ultimately turned on **contract**, which is the operative risk here. |
| **LinkedIn v. Nubela / Proxycurl** (N.D. Cal. 3:25-cv-00828, filed Jan 24 2025) | Suit over fake accounts scraping millions of profiles; six claims incl. breach of contract + CFAA; settled mid-2025 with a **court-entered permanent injunction**. Proxycurl — a bootstrapped business with ~$10M reported revenue — **announced shutdown in July 2025**; the founder stated they could not afford to defend against LinkedIn. |

The lesson from both is one of asymmetry: a contract claim is comparatively cheap for the platform to bring and expensive to defend, and a permanent injunction plus data-destruction order has twice ended the defendant company regardless of the technical merits. For a pre-revenue project, that is a risk we are not positioned to carry on the browser-automation path.

### 2. Official APIs are financially unsustainable (and on LinkedIn, unavailable)

The compliant fallback was to swap the browser engine for the platforms' official APIs. The economics do not close.

**X API tiers (verified, 2026):**

| Tier | Price | Reads/mo | Writes/mo | New signups? |
|---|---|---|---|---|
| Pay-per-use (default since Feb 6 2026) | $0.005/read, $0.015/post ($0.20 w/ link) | hard cap **2,000,000** | — | **Open** (only option for new devs) |
| Basic (legacy) | $200/mo | ~15,000 | ~50,000 | **Closed** |
| Pro (legacy) | $5,000/mo | exactly **1,000,000** | ~300,000 | **Closed** |
| Enterprise | **~$42,000–$50,000+/mo**, custom | negotiated | negotiated | Approval, multi-week |

**Worked example — read + respond to ~1,000,000 mentions/month, continuously:**

- **Reading alone** = 1,000,000 post-reads. On pay-per-use (the *only* path a new org can buy): 1,000,000 × $0.005 = **$5,000/month just to read**, before a single reply.
- **Pro tier doesn't save you:** its read cap is *exactly* 1,000,000/month, so 1M mentions consumes 100% of the cap with zero headroom — and any real responder re-reads parent tweets, polls threads, and re-fetches conversations, easily pushing reads to 2–3M+. That breaks Pro's cap and the 2M pay-per-use cap. Pro is also **closed to new signups**, so a new org cannot buy it at $5,000 regardless; the $5,000 figure is a legacy-subscriber benchmark, not a purchasable option.
- **Responding** to ~30% of mentions = 300,000 posts × $0.015 = **$4,500** (text), or × $0.20 = **$60,000** if replies carry links. A realistic read+respond month is **~$9,500 (text) to ~$65,000 (link)**, with the link case depending entirely on whether autonomous replies embed URLs.
- **Hit the 2M read cap** — which realistic context re-reads do — and X forces you onto **Enterprise at ~$42,000+/month minimum**, custom contract, multi-week approval. (Enterprise pricing is NDA-bound; ~$42K–$50K+ is the publicly cited entry point, not a published rate card.)

The per-unit cost is the structural problem: at a fixed $0.005/read with **no volume discount** until tens-of-thousands-per-month Enterprise, a continuous org reading 5M/mo would pay ~$25,000/mo in reads alone. The compliant X path lands between **~$5,000/mo (bare reads) and ~$42,000+/mo (Enterprise)**, indefinitely, pre-revenue. (Third-party resellers advertise cheaper per-read pricing, but they typically operate via unofficial/scraped access and inherit the §1 ToS and liquidated-damages exposure — not a compliant path.)

**LinkedIn — there is no cheap compliant path at all.** Programmatic posting and mention management run only through the **Marketing Developer Platform / Community Management API**, which is **partner-gated**: a registered legal entity, a written use case, manual review, a Development Tier (reported to be raised in 2026 to roughly ~500 req/app, 100 req/member), then a Standard-Tier upgrade requiring a **screencast video demonstrating each use case** — a multi-week-to-multi-month review that many applicants fail. Critically, **DMs and connection requests — core to the xevos outreach design — are not available via the official API at volume at any tier or price.** And even the gated API's program terms **prohibit unsolicited/spam messaging and autonomous automation**, which is precisely the use case. So LinkedIn dead-ends twice: the feature set we built (DM/outreach) is unavailable through the API, and the only path that delivers it (browser automation) is the one with the litigation-and-shutdown record from §1. There is no published money-only path; access is granted or refused by review, not purchased. (LinkedIn's developer-docs pages return 403 to automated fetch, so the specific 2026 tier numbers above come from secondary summaries and should be re-checked against the live docs before being quoted as exact; the access model and prohibitions are corroborated across independent sources.)

### 3. Inference cost is structurally unsustainable at frontier quality and continuous scale

The hierarchy is the product, and it is also the cost problem. The codebase confirms four effective authority levels: a principal-facing **executive** (defined in `default-agent.ts` with `reportsTo: "principal"`) above the `head → manager → worker` chain (`roleSchema` in `agent.schema.ts` enumerates `head`, `manager`, `worker`; the principal is modeled via `principalIdSchema`). So a delegated task fans through ~4 LLM reasoning hops before any work is done. On top of that, the design adds an **auditor/review round-trip and a rework path** (a dedicated `audit.ts` service plus a `changes_requested` review verdict), making the realistic count **~5–7 LLM calls per non-trivial task**, not 4. Each later hop re-reads accumulated context — `memory.ts`'s `assembleContext` reloads rolling messages plus semantic vector (sqlite-vec KNN) recall before every `generateText` call — so **input tokens grow per hop**, a hidden multiplier on top of the call-count multiplier.

**Worked example — one non-trivial task, priced on a representative capable 2026 frontier model** (verified pricing benchmark: **$5/MTok input, $25/MTok output**; output is 5x input). The token counts below are illustrative estimates — xevos's happy-path tool dispatch is not fully wired today, so no production per-task telemetry exists — but the pricing and the structural shape are real.

*Single capable agent (baseline):* ~8K input + ~2K output → (8,000 × $5 + 2,000 × $25) / 1e6 ≈ **$0.09/task**.

*Hierarchical org* (exec → head → manager → worker → audit → rework, with context re-read each hop):

| Hop | Input tok | Output tok |
|---|---|---|
| 1 — executive | 6,000 | 1,000 |
| 2 — head | 9,000 | 1,000 |
| 3 — manager | 12,000 | 1,000 |
| 4 — worker (does the work) | 18,000 | 3,000 |
| 5 — audit | 20,000 | 1,500 |
| 6 — rework | 22,000 | 2,500 |
| **Total** | **87,000** | **10,000** |

(87,000 × $5 + 10,000 × $25) / 1e6 ≈ **$0.685/task** → **~7.6x the single-agent cost** (6x in calls, more in tokens from re-reading). This is a no-/low-caching upper-ish estimate; taking the conservative ~4–5x figure as the floor, the direction is unchanged.

**Continuous at scale** — 1 task/minute ≈ 43,800 tasks/month:

| | Per task | Per month |
|---|---|---|
| Single agent | $0.09 | ~$3,940 |
| Hierarchical org | $0.685 | **~$30,000** |

That ~$26K/month delta is coordination overhead — reasoning *about* the work rather than doing it — recurring monthly with no revenue to offset it. Nothing in the code caps spawn count or enforces a task budget (the `budget` field exists in `task.schema.ts` but is unenforced), so cost scales with org size × activity, 24/7.

**Honest qualifiers.** Today's actual bill is small: the prototype routes hops to cheap Gemini Flash models, not a frontier model. The infeasibility concern is about running the org at *frontier reliability* and continuous scale, which is what dependable autonomy requires. Three real mitigations exist and should be stated plainly: **prompt caching** (cached reads at 0.1x) and **batching** (0.5x) blunt the re-read penalty and can pull the multiplier toward the ~4–5x floor; and **mixed-model routing** (cheap models at low hops, as the current code already does) collapses the dollar figure. These reduce the problem; they don't dissolve it. The structural fact remains: the org pays on the order of six reasoning calls to produce one unit of work, and frontier-quality reasoning at every hop, run continuously, pre-revenue, does not close on today's pricing. Notably, frontier per-token prices trended *down* through 2025–2026 — which is exactly why this objection is time-sensitive rather than permanent, and why it appears in the revive criteria below.

---

## What we built / what survives

The substrate is solid and worth keeping warm:

- **Local-first persistence.** A single SQLite file (WAL mode) via Drizzle over better-sqlite3, with **sqlite-vec** for vector KNN semantic recall. No external database or service — the org's entire state is one file under `packages/core/storage/`. This is a genuinely low-friction foundation.
- **A clean hierarchy + messaging model.** Typed agent roles, a mailbox/event loop, delegation and escalation primitives, and a memory service that assembles context (semantic vector recall + rolling messages) per reasoning step.

The one genuinely novel asset worth carrying forward is the **auditor**. Rather than asking a reviewer model to re-judge an output on vibes, the auditor verifies an agent's claimed work **against that agent's raw tool-call action log** — what the agent actually did (the searches it ran, the results that came back), not what it says it did. The code is explicit that this log is the ground truth it reviews against. That "verify against the ground-truth action trace" pattern is provider-agnostic, useful well beyond this project (any multi-agent or tool-using system needs it), and is the piece most worth extracting and reusing.

---

## Conditions to revive

This is a pause with explicit triggers. We reopen xevos — or a pivot of it — when enough of the following move:

1. **Inference cost falls materially.** Frontier-quality reasoning at roughly **$1/MTok input and ~$5–7/MTok output or below** (a ~4–5x decline from the current $5/$25 benchmark), *or* caching/routing maturity that demonstrably holds the per-task multiplier near ~2x. The 2025–2026 price trend already points this way, so this reads as a *when*, not an *if*.
2. **A sane, affordable, compliant platform access path.** Either an official API priced for continuous high-volume read+respond (X pay-per-use without a punitive cap, or a real mid-tier), **and** a LinkedIn path that actually permits autonomous posting/outreach for non-partner entities. Absent compliant access, the legal blocker (§1) is dispositive regardless of cost.
3. **A longer reliable task horizon.** Agents that can carry a multi-step task to completion with materially fewer audit/rework round-trips — which both raises quality and removes hops, attacking the §3 multiplier at its root.
4. **A revenue path that absorbs the multiplier.** A customer or use case where the value of one completed autonomous task comfortably exceeds its coordination cost (on the order of ~$0.50–$0.70 today, or its cheaper successor) — i.e., the org pays for its own overhead. Pre-revenue, the multiplier has nothing to lean on; with revenue, it becomes a margin question rather than a survival one.

We will monitor the X/LinkedIn ToS posture, official-API pricing and access models, and frontier inference pricing on a rolling basis, and revisit when two or more of the above have moved.

---

## Closing

xevos worked as an engineering artifact: the hierarchy ran, the persistence layer was clean, and the auditor was a real idea. It did not work as a *business* on 2026's terms — the channels it was built to act on prohibit autonomous automation by contract, the compliant alternatives are priced or gated out of reach, and the coordination overhead of the hierarchy itself outruns a pre-revenue budget. None of those is a failure of execution; all three are facts about the current environment, and two of them are the kind of fact that changes. We are putting the project down deliberately, with the substrate intact, the auditor pattern extracted, and a short list of conditions that would justify picking it back up. If the numbers move, so will we.

---

## References

- https://www.blotato.com/blog/twitter-api-pricing
- https://postproxy.dev/blog/x-api-pricing-2026/
- https://www.xpoz.ai/blog/guides/understanding-twitter-api-pricing-tiers-and-alternatives/
- https://docs.x.com/x-api/getting-started/pricing
- https://cdn.cms-twdigitalassets.com/content/dam/legal-twitter/site-assets/terms-of-service-2025-05-08/en/x-terms-of-service-2025-05-08.pdf
- https://help.x.com/en/rules-and-policies/x-automation
- https://crypto.news/x-expands-content-to-ai-prompts-outputs-in-2026-terms-update/
- https://developer.linkedin.com/product-catalog/marketing/community-management-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
- https://www.linkedin.com/legal/user-agreement
- https://www.linkedin.com/help/linkedin/answer/a1341387
- https://www.linkedin.com/legal/l/marketing-api-terms
- https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/
- https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn
- https://nubela.co/blog/goodbye-proxycurl/
- https://news.linkedin.com/2025/linkedin-takes-legal-action-to-defend-member-privacy
- Frontier LLM API list pricing (representative capable model, ~$5/MTok input · ~$25/MTok output) — provider pricing pages, 2026-06
