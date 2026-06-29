## Verdict — required refinements

### 1. Prerequisite must not claim live reachability on catalog-only evidence

**Issue:** `## Prerequisites` labels `opencode run --model opencode/deepseek-v4-pro` as owner-confirmed, but the cited evidence is catalog presence (`opencode models`) and a Zen pricing snapshot — not a successful live run or repo-committed operator evidence (the glm sibling cites `operator-runbook.md` and an operator report).

**Required outcome:** The prerequisite must accurately state what is verified at draft time (slug/catalog) versus what remains unverified (live CLI acceptance). It must not use “owner-confirmed” or equivalent live-run language unless backed by durable operator evidence in-repo, or the spec must record a `## Blocker` until that evidence exists.

**Rationale:** Spec guidance treats prerequisites as validation gates, not aspirational labels. The human-only AC correctly defers live verification to post-merge; the prerequisite must not pretend that work is already done.

---

### 2. Remove or correct the mislabeled deferred decision

**Issue:** The decisions ledger entry frames “automatic **free-tier** rotation between **DeepSeek V4 Pro**” — V4 Pro is a paid, opt-in model in this spec, not a free-tier default. The glm precedent defers rotation between free-tier models (GLM 5.2 ↔ DeepSeek V4 Flash Free). This entry reads as a template copy with the wrong model tier.

**Required outcome:** Either drop the deferred line (V4 Pro is not in default `agentOrder`; no quota-cascade consumer exists yet), or replace it with an accurate deferred entry that does not call V4 Pro free-tier (e.g., opencode quota-cascade between V4 Pro and other opencode models, pinned when a cascade intent needs it). Do not retain the current wording.

**Rationale:** Load-bearing decision ledgers must not encode false product facts. A wrong deferred entry misguides future quota-cascade specs and violates the ledger rule that each entry must name a plausible wrong alternative — here the wrong alternative is already baked in.

---

## No further refinements required

The following are sound as drafted and need no spec change before merge:

- Registration-only scope, owner price snapshot, dual enrichment test coverage, preservation AC citing `config.test.ts`, `resolveAgentPriceKey` AC as behavioral contract (generic opencode coverage exists), `Documentation updates: None` (no stale operator claims to correct), single atomic subspec structure.
