# Session report — 2026-08-30 overnight (mutation-gate unblock)

Jarvis-on-Jarvis operator session. Agent order `codex, cursor, claude` (codex quota'd throughout; cursor was the actuator). Structural-recovery brief work plus a mid-session harness fix.

## Landed (merged to main)

| PR | What |
| --- | --- |
| [#3163](https://github.com/cbrenner04/jarvis/pull/3163) | Unbreak main — `plan.prompt.draft` r15 snapshot pin (broken tests on main at session start) |
| [#3165](https://github.com/cbrenner04/jarvis/pull/3165) | Hand-landed 4 contract-miss-blocked plans: `dispatch-pipeline-stages-through-shared-preparation` (front-door P1), `durable-run-backed-stage-settlement` (settlement P1), `cleanup-uses-lossless-git-status`, `harness-publication-push-uses-explicit-refspec` |
| [#3167](https://github.com/cbrenner04/jarvis/pull/3167) | `execution-terminal-run-settlement-invariant` subspec 01 (hand-salvaged; review caught a real honesty inversion) |
| [#3168](https://github.com/cbrenner04/jarvis/pull/3168) | Verifier split-test-file seed + ledger refresh |
| [#3170](https://github.com/cbrenner04/jarvis/pull/3170) | `dispatch-pipeline-stages-through-shared-preparation` implement (front-door P1); review verdict SHIP |
| [#3172](https://github.com/cbrenner04/jarvis/pull/3172) | **Mutation-gate unblock** (operator hand-fix): restore killing-test authoring rule + sibling-test resolver fallback |

`durable-run-backed-stage-settlement` implement: re-ran off the fixed main and **published draft [#3173](https://github.com/cbrenner04/jarvis/pull/3173)** — but banked, not merged (see handoff below). The re-run validated Fix A: the agent authored a co-located test this time (it did not pre-fix). It then stranded on mutation-coverage-completeness in a relocated error-mapping function, which is exactly the class the four-seed mutation-gate plan fixes.

## Handoff: landing #3173 (`durable-run-backed`, settlement P1)

**State.** Draft PR [#3173](https://github.com/cbrenner04/jarvis/pull/3173) on branch `20260830T062002Z-durable-run-backed-stage-settlement`. Run row `860be89d` settled `surviving_mutation_failed` (`resumable: true`). The **code is correct** — independent review verdict SHIP (faithful settlement mapping, idempotent, live-entry guarded, PR evidence preserved; one non-blocking note: the follow-on wiring intent must preserve the live-entry guard at the call site since the store op hardcodes `isLive:false`). A killing test for the `model_config` message-inclusion guard (`pipeline-stage-settlement.ts:53`) is already committed on the branch. It strands on remaining un-killed operator-flip candidates in `durableOperatorErrorFromEntryRun` (next known: the `invocationFailureDetail != null` guard at line 43; enumerate the rest with the verifier).

**When to land — pick one:**
- **Preferred:** after [[mutation-gate-resolves-importer-killing-tests]] lands — the relocated mapping's real coverage lives in an importing test (`run-operator-error.test.ts` / daemon tests), so importer-aware resolution likely clears the survivors automatically; then `jarvis run resume 860be89d` re-verifies and publishes. Or after [[implement-verifies-mutations-in-loop]] lands, re-run fresh (the agent fixes coverage in-loop).
- **Now, if the gate fixes are far off:** hand-finish. It is a bounded set of co-located killing tests, not a rabbit hole (the review already blesses the code).

**How (hand-finish path).** In the branch worktree: enumerate survivors with the diff-derived verifier (`verifyDiffDerivedMutations({worktreePath, runBase:"main"})`); add one co-located killing test per survivor to `pipeline-stage-settlement.test.ts` (exercise `stageFailureDetailFromEntryRun` with the relevant `terminalCause`/`failureKind` fixtures — see the `model_config` test already there); verify each kills its mutation (toggle the guard, confirm the test fails, restore — never `git checkout`); run `bun run check` + `typecheck` + `test:v2`; push; `gh pr ready 3173`; admin-merge after CI. Review is already done (SHIP) — no second review needed unless the diff changes beyond tests.

## Key findings

1. **The mutation gate is the dominant implement-throughput blocker, and the retirement made it worse.** `retire-mutation-checkpoint-dsl` stripped the killing-test authoring rule out of implement + `write.mutation-repair` prompts (`IMPLEMENT_WRITE_STEP_RULES = filterPlanDraftStepRules(DEFAULT_WRITE_STEP_RULES)`) while keeping the diff-derived verifier fully strict and blocking with no off-switch — decoupling authoring from enforcement. Compounded by a resolver that only checked the exact-stem `<file>.test.ts` (no sibling fallback), so split-test files (`workflow-runner.ts`, the pipeline files) stranded on `missing-killing-test` regardless of real coverage. #3172 fixes both halves. A third, distinct gap remains: **no escape hatch for provably-equivalent mutations** (loop bounds, redundant guards) — seeded.
2. **The plan-draft contract gate blocked 5/5 plans** on shape/strictness only (multi-surface-AC prose ×2, nested `v2/` layout ×2, one missing index link) — every draft was sound. Hand-landed all 4 sound ones (#3165); deferred `canonical` (00/01 near-duplicate). Evidence for the held `plan-draft-contract-miss-reprompts-before-blocking` / `plan-draft-shape-accepts-nested-stage-layout` seeds.
3. **Independent diff review earns its keep.** On #3167 every mechanical gate (typecheck, check, tests, mutation, runtime-smoke) passed while the code carried a settlement honesty inversion (`runtime_smoke_failed → "completed"`); only the independent review caught it. Never merge an implement on green gates alone.
4. **Parallelization works under the current idle budget.** Two concurrent implements (`dispatch` + the mv pipeline) ran ~40 min with zero idle-output false-kills. The "serial only" guidance was calibrated to the old tighter idle budget (now 15 min). Concurrent implements are viable; the throughput ceiling is the gate strands + hand-finishes, not machine contention.
5. **Pipeline dogfood works end-to-end** — the full-review pipeline ran intent→plan→implement→review cleanly on a focused seed, drafts were `@mutate`-clean (confirming stale ready-intents, not current prompts, are the contamination source), and the review correctly caught a real coverage gap. It wedges its stage settlement on a review failure (the settlement chain fixes this) and its stranded stage carries a stale base.

## Deferred / not landed

- **mv (`mutation-verifier-masks-type-generic-brackets`):** correct + behavior-tested but strands on an equivalent mutation the gate can't accept. Pipeline PRs #3164/#3166/#3169 closed unlanded; seed + spec remain on main for a future run once the masking loop is mutation-testable.
- **`canonical-pipeline-execution-state-and-stage-claims`:** plan drafted but 00/01 subspecs near-duplicate; needs a re-plan.

## Seeds created / mutation-gate plan

`diff-derived-verifier-resolves-split-test-files` — implemented + removed in #3172. The rest form the four-seed mutation-gate plan (mutation-DSL author's 2026-08-30 re-review), promoted to the brief's **P0 — gates first** tier; sequence: escape hatch first (pressure valve), then in-loop verification (the linchpin — binds authoring and enforcement at the same lifecycle point), with scanner-based derivation and importer-aware resolution making it cheaper/accurate:

1. `mutation-gate-equivalent-mutation-escape-hatch` — exact-site `// mutation-equivalent: <reason>` directive; the only pressure valve (no global off-switch).
2. `implement-verifies-mutations-in-loop` — run the verifier at `done` and reprompt the live agent, so misses are fixed in-loop instead of stranding post-publication. Highest-leverage: removes the operator from the strand-and-hand-finish loop.
3. `mutation-verifier-scanner-based-candidates` — re-scopes the removed `mutation-verifier-masks-type-generic-brackets` masking-loop seed (a proven dead end — its own comparison-heavy loop stranded 3× on an equivalent mutant) to TypeScript-scanner token classification.
4. `mutation-gate-resolves-importer-killing-tests` — killing tests = co-located ∪ direct-importer, so the gate enforces coverage, not co-location.

Out of scope for all four (author's boundary): no mutation DSL back in plan prompts, no spec-level DSL, no global gate off-switch.

## Friction (one-offs, not seeded)

- `bun run test:v2` scopes to changed files locally (2 files ran for a 5-file-touching change) — full slice runs on CI; relied on CI for full coverage on hand-finishes.
- Every implement that reached publication this session needed a hand-finish at the mutation gate (co-location) until #3172 landed — the tax #3172 targets.

## Cost

Operator (Claude Code) `/cost`: **$91.25** — 1h50m API / 8h53m wall, 299 requests (99% input from cache). Nearly all of it `claude-opus-4-8` (473.7k output, 131m cache read). This is operator/driver spend only; agent-side actuator spend (cursor/codex/claude running the workflows) is separate and queryable per-run from `~/.jarvis/telemetry.jsonl` (`cost_usd`).
