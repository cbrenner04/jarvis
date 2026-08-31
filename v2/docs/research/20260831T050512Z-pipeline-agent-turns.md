# Agent turns per pipeline stage

Measured 2026-08-31 from operator telemetry. Question: how many agent turns does each pipeline actually consume, given that steps are not one-turn-each.

## Method

- Sources: `~/.jarvis/telemetry.jsonl` (`invocation_completed` rows) joined to `~/.jarvis/state/v2.sqlite` (`runs`, `pipelines`, `pipeline_stages`). Sibling runs of one workflow grouped by `workflow_snapshot.invocationId`; pipeline stages link via `workflow_invocation_id` (entry run id).
- Filters: `project = jarvis` only; workflows whose runs all reached `completed`; telemetry era only (capture began 2026-07-12).
- **Turn** = one logical agent call = telemetry row with `binding_index == 0`. Rows with `binding_index > 0` are quota-fallback retries of the same logical call and are excluded from turn counts.
- Dataset: 6,430 jarvis invocation rows; 845 (~15% over the logical-turn count) were quota-fallback retries.

## Structural facts (from `v2/src/execution/`)

- `PIPELINE_REGISTRY` (`pipeline-registry.ts`): `fast` = intent/none → plan/none → implement/light; `full-review` = intent/light → approve → plan/debate → approve → implement/debate. Approval stages are human, zero agent turns. `stageReviewPasses` pins pipeline review passes to 1.
- Write steps loop (`write-loop.ts`): up to `DEFAULT_MAX_ITERATIONS = 10` agent iterations; landing-contract, staged-markdown-lint, and surviving-mutation violations consume additional full iterations; token/blocker misses trigger micro-reprompt invocations within an iteration.
- Implement-only extras: hidden `~shrink` write-loop run after completion; coverage advisory (one invocation, only when uncovered changed lines exist); up to 3 mutation-repair invocations on a surviving mutant. The mutation verifier itself is deterministic, not an agent.
- Light review cycle (`review-cycle.ts`): critic, then actuator only on a non-empty verdict. Debate cycle (`review-debate.ts`): adversary → advocate → adjudicator, then actuator only on a non-empty verdict. Review roles share one `attempt_id` per cycle, so attempt counts undercount review turns.
- Fan-out: an intent split emitting ≥2 ready-intents multiplies the whole downstream (plan + implement + approvals) per branch.

## Measured turns per stage cell

| stage cell | n | min | p50 | mean | p90 | max |
|---|---|---|---|---|---|---|
| intent / none | 82 | 1 | 1 | 1.0 | 1 | 2 |
| intent / light | 178 | 2 | 3 | 3.0 | 3 | 6 |
| plan / none | 159 | 1 | 1 | 1.0 | 1 | 5 |
| plan / debate | 248 | 5 | 5 | 5.1 | 5 | 8 |
| implement / none | 120 | 1 | 3 | 2.9 | 5 | 7 |
| implement / debate | 149 | 5 | 7 | 7.3 | 9 | 14 |

Role means per completed workflow: implement writes 2.6 iterations (across `implement~link-N` positions), shrink 1.2; debate roles ~1.2 each with actuator 1.2 (the verdict is almost never empty); intent/plan drafts ~1.0–1.2; light review critic 1.1 + actuator 1.0.

**No jarvis data exists for implement/light** — every jarvis implement review ran debate; all 12 `fast` pipelines in the store are chess-mvp-yolo. Derived estimate: implement/none + the light-review delta observed on intent (+2.0) → ~4.9 mean, ~5 p50.

## Composed pipeline totals

| pipeline | min | p50 | mean | max (worst cells summed) |
|---|---|---|---|---|
| fast | ~4 | ~7 | ~6.9 | ~16 |
| full-review | 12 | 15 | 15.4 | 28 |

Sums of means are exact; summed p50/max are approximations (worst cases don't co-occur). Only 3 jarvis pipelines have completed end to end (all full-review), with raw subprocess rows 15 / 30 / 34 — consistent with the composed totals plus quota-fallback retries.

## Reproduction

Aggregation script from this session: group telemetry `invocation_completed` by `run_id`, join runs by `workflow_snapshot.invocationId`, filter `binding_index == 0`, split cells by step ids present (`review` vs `review-debate`/`implement-review`) and telemetry roles (critic vs adversary).
