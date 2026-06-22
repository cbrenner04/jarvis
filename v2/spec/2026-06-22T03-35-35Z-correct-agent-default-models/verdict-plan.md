## Verdict

All three findings are upheld. The core two-string change (codex → `gpt-5.4`, cursor → `Composer 2.5`) is sound and well-scoped; the following refinements are required before the spec is ready.

### 1. Correct the cursor-alias characterization (blocker — false AC + false rationale)

The spec conflates two separate cursor maps. Cursor has a **CLI-invocation slug map** (`"Composer 2" → composer-2.5`, what the CLI actually *runs*) and a **separate identity price-key map** (a `Composer 2` string prices via the `Composer 2` row in `prices.json`, never via `composer-2.5`; this is pinned by an existing test asserting `resolveAgentPriceKey("cursor", "Composer 2") === "Composer 2"`).

- **AC #3 is false as written** and is harmful: an implementer trying to make "resolves a `Composer 2` string to the `composer-2.5` price key" literally true would have to break the identity price map. It must be reframed around the CLI-slug map — the contract worth preserving is that a legacy `Composer 2` config still *runs* `composer-2.5`, not that it prices through a `composer-2.5` key.
- **Decision 3's rationale is false**: legacy `Composer 2` pricing survives via the unchanged `Composer 2` price row, not via the alias. State the real reason to keep the CLI-slug entry: a pinned `Composer 2` config keeps running the better model.
- This error was inherited verbatim from the intent's parenthetical ("maps the *price key* `Composer 2 → composer-2.5`"). Correct it at both layers (decision + AC). Spec guidance requires preservation ACs to cite the real pinning behavior, not paraphrase a contract that doesn't exist.

### 2. State an explicit test-classification rule (the checklist's "any other default-config assertions" is unactionable)

The default-model strings appear across many `v1/test` files, and the current checklist gives no rule to separate must-change assertions from intentional override fixtures. Relying on `bun run test` failures to surface the work is unreliable: override fixtures stay green, and a stale *default* assertion inside a non-default block may not fail either.

- Promote the existing aside ("test inputs that deliberately exercise overrides need not change") into an explicit classification criterion: **change assertions derived from `DEFAULT_AGENT_ORDER`/bootstrap defaults; leave fixtures that pin arbitrary model strings to exercise overrides.**
- Full per-file enumeration of all sites is not required (it would rot). Naming the confirmed must-change sites as examples plus the rule is sufficient.
- One case needs an explicit decision: a rendered-output assertion that prints `codex (gpt-5.3-codex)` (run-summary test) — classify whether its input is default-derived (and thus must change) or an override fixture.

### 3. Name all four stale doc spots

Each doc file has two stale locations, and "lines pinning the default models" risks catching one and missing the other. Enumerate all four: the two JSON examples in `v1/docs/agents.md`, and both the table row and the prose line in `v2/docs/v1-behaviors.md`. Per project rules, the v1-behaviors update is mandatory since this changes existing v1 behavior.

### Not at issue (no action)

codex `gpt-5.4` is reachable and priced; AC #1's plan/prompt coverage is trivially satisfied since all modes clone `DEFAULT_AGENT_ORDER`; the `Composer 2` and Cursor `GPT-5.3 Codex` price rows correctly stay untouched; no codex `gpt-5.3-codex` price entry is added.