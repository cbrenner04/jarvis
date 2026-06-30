## Verdict: refinements required before merge

The spec’s core design (shared parser, no config persistence, patch implementation ladder vs review/shrink split, plan actuators vs review-panel split) is sound and matches the codebase. The gaps below are documentation drift, untestable ACs, and unstated boundaries that would mislead implementers or operators.

### Required refinements

1. **Sync intent with subspec `00` on omitted `:model`.** Intent still defers model resolution; `00` already pins inherit-from-fallback-`agentOrder` else require `:model`. Remove the stale deferral so intent and spec agree.

2. **Close operator-doc contradictions.** `v1/docs/plan-mode.md` (L158) describes one chain for review panel and actuators; after this change panel uses pre-override `modes.review.agentOrder ?? modes.plan.agentOrder` while verdict-actuator reads substituted `modes.plan.agentOrder`. Add `plan-mode.md` to `02` documentation updates with split-ladder semantics. `v1/docs/run-loop.md` (L53) omits per-run override — add a cross-link or sentence so it does not contradict `agents.md`. Extend `v2/docs/v1-behaviors.md` flag inventory (L37) to include `--agent` on `run` and `plan`.

3. **State explicit out-of-scope commands.** `jarvis1 intent` and `jarvis1 prompt` do not get `--agent` in this spec (a separate ready-intent covers intent later). Without an explicit boundary, operators will assume parity and keep editing config for intent-split experiments.

4. **Remove or defer `name-only` from `02`.** `runNameOnlyPhase` is not wired from plan `run.ts`; listing it in decisions/AC creates untestable obligations. Drop it or mark deferred until a caller exists.

5. **Narrow plan quota / `model_config` acceptance criteria.** “Plan quota and `model_config` cascades” reads as all plan phases including review-panel rotation via `resolveReviewAgentOrder`. AC must scope to phases on substituted `modes.plan.agentOrder` (draft, verdict-actuator, PR narrative, etc.) and separately state review-panel quota stays on the pre-override snapshot.

6. **Pin `jarvis1 plan --resume` + `--agent` semantics.** Resume is review-only; `--agent` would affect verdict-actuator (substituted order) but not the review panel unless snapshotted. State whether that partial override is intentional and silent or warrants operator notice — rules out ambiguous expectations on resume.

7. **Replace fabricated preservation AC in `01`.** `run.test.ts patch-order fixtures` does not exist; violates spec-guidance “cite the test” for behavior-preservation ACs. Anchor no-`--agent` preservation to a real test (e.g. existing `--tier` override test or `buildActiveAgents` coverage).

8. **Add test-backed ACs for override exclusions.** Review/shrink ignore and `--resume-review` ignore are decision-only in `01` with no verification anchor. Require new override-negative tests or cite existing review/shrink tests with explicit assertions.

9. **Pin shared parser placement.** `00` allows `shared/` but `validateAgentOrder` lives in `v1/src/config.ts` with v1 deps. State parser lives under `v1/src/` unless validation is extracted first — rules out a dead-end `shared/` import path.

10. **Require pre-override snapshot for plan review panel.** `runPlanReviewPhase` passes bare `config` to `runReview` today; substituted `modes.plan.agentOrder` would leak into panel resolution when `modes.review.agentOrder` is unset. `02` must obligate threading pre-override review order so panel ignores `--agent` (outcome: panel never reads post-override `modes.plan.agentOrder`).

11. **Distinguish CLI `--agent` from `RunCommandOptions.agents`.** Existing test seam `agents?: Partial<Record<AgentName, Agent>>` collides with CLI ladder naming. One decision naming the CLI override field separately preserves the test seam.

12. **Optional but low-cost clarifications worth adding:**
    - `00`: first-colon split example for models containing `:` (e.g. `opencode:provider:model`).
    - `01`: single-rung override + `--tier hard` / empty post-slice ladder behavior (align with existing tier validation).
    - `00`: AC or test note for `run:` / `plan:` error prefixes per decisions.

### Not required

- Subspec split (`00` → `01` → `02`) — sequencing and `02` weight are acceptable.
- `jarvis1 intent` parity in this spec — correctly deferred; separate ready-intent exists with prerequisite on plan override.
- `--help` usage AC — task checklists suffice; not blocking.
