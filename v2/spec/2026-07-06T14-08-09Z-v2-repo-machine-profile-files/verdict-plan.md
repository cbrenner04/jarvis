## Verdict: Required Refinements

**1. Subspec 01 must explicitly retire `memory-watermark.ts`'s own settle-delay literal/default.**
The checklist currently implies this via the signature change to `loadMachineProfileMemory(profileName)`, but nothing states the old literal is removed, and no AC catches a surviving dead default. Add an explicit task item and a corresponding AC (or fold into an existing "no remaining references" grep-style AC) so a stray duplicate constant can't ship silently.

**2. Avoid add-then-move churn for `DEFAULT_SETTLE_DELAY_MS`.**
Subspec 00 should define the constant directly in `machine-profile-loader.ts` (its permanent home) and have `validateMachineConfigMemory` import it from there, rather than placing it in `machine-config-loader.ts` in 00 and relocating it in 01. This is a same-PR-set simplification with no design tradeoff.

**3. Add an AC verifying `home.json`'s claude/codex bindings are equivalent to today's `data/agent-model-config.json`, not just present.**
Today the spec only tests the "missing agent" hard-error path. Since `home.json` is hand-transcribed, a copy/value error in the roster would ship undetected. Require a test (fixture diff or equivalent-output assertion) proving `loadMachineProfileModels("home", agents)` matches the pre-migration `loadAgentModelConfig` output for the same agents.

**4. Add repo-wide grep-style completeness ACs before deleting/removing shared config surfaces:**
- No remaining references to `AGENT_MODEL_CONFIG_PATH` or `data/agent-model-config.json` anywhere in the repo after 01.
- No remaining code paths read `~/.jarvis/v2.json`'s `memory` key outside what's removed in 01.
`workflow-loader.ts`/`memory-watermark.ts` are named as *the* consumers while the underlying file is deleted outright and a config key is fully retired — the spec needs a way to catch a missed call site, not just an assertion that these two are the only ones.

**5. Verify the `data/prices.json` row names (`Composer 2.5`, `GPT-5.3 Codex`) before this spec is finalized.**
This is a factual claim about current repo state underpinning 01's seed-file decisions. Confirm both rows exist as named; if either doesn't, the decision needs to name a fallback (add the row, pick an existing equivalent, or flag a blocker) rather than assume it silently.

**6. State explicitly, as a one-line decision in 00, why `loadMachineProfileModels`/`validateAgentModelConfig` throw on file/JSON errors but return `LoadError` for content-validation failures.**
This dual-channel error shape is inherited unchanged from `loadAgentModelConfig`, not a new choice, but it's a real API wrinkle callers must remember — state it rather than leave it implicit.

**7. Add brief one-line acknowledgments (no new design scope) in 01 for two deferred concerns, so they aren't silently unaddressed:**
- Path/profile-name trust boundary: no validation beyond join-and-read; sanitization against attacker-controlled input is revisited when the profile-name resolver ([[v2-config-json-profile-and-agents]]) lands.
- Failure timing for a profile missing a required agent (e.g., `work.json` + `claude`) matches today's existing missing-agent-in-config failure point — no new failure-timing behavior introduced by this migration.

**8. Confirm the three named docs (`agent-model-config.md`, `v2-architecture.md`, `v1-behaviors.md`) are the complete doc-update set required by `v2/docs/documentation-standard.md`** for this behavior change before merge. This is a pre-merge verification step for whoever finalizes the spec, not a sign the current list is wrong.

**Rationale:** Findings #1, #3, #4, and #10-class gaps (folded into #4) are cases where the spec states a goal but doesn't verify it — this violates the requirement that acceptance criteria be concrete and observable, and that a subspec deleting/retiring shared infrastructure (`data/agent-model-config.json`, `~/.jarvis/v2.json`'s `memory` key) prove completeness rather than assert it by naming known call sites. #2 and #5 are cheap correctness/process fixes with no tradeoff. #6 and #7 are low-cost clarity additions that preempt a reader re-litigating settled or explicitly-deferred design points. #8 is a pre-merge process check, not a content gap.