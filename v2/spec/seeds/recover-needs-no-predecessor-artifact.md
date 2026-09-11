---
name: recover-needs-no-predecessor-artifact
---

# `pipeline recover` refuses when the predecessor stage artifact is unavailable

## Problem

`jarvis pipeline recover` exists for one situation: a plan stage failed, its staged tree is on disk and correct, and the operator wants it validated and landed without redrafting. On 2026-09-11 that exact situation refused before any attempt ran:

```text
$ jarvis pipeline recover 9b1c81aa-… default
stage_resolution_failed: pipeline-stage-resolve: stage "plan" has no preceding workflow artifact
```

The lane was textbook recoverable. `.jarvis-plan-stage/` held `index.md`, two numbered subspecs, `intent.md`, a `verdict-plan.md` from a completed review, and an actuator revision to `00-…` timestamped four minutes after the verdict. No operator `## Blocker`. The write step's own run log was four events ending `loop_finished` / `complete`; the workflow died at *landing*, after every agent role had been paid for. The only path left was `pipeline resume`, which redrafts and discards that entire review cycle.

`recoverPlanStage` routes through the general stage resolver, and `resolvePriorArtifactContext` (`v2/src/daemon/pipeline-stage-resolve.ts:135-141`) refuses when the preceding stage's artifact is absent. That dependency is real for *dispatch* — a plan stage being dispatched needs its intent stage's ready-intent to draft from. Recovery has no such need: it validates and lands bytes that already exist in the failed stage's own recorded worktree, and never invokes the plan write step or any review role. Requiring the predecessor artifact imports a dispatch precondition into a path that does not dispatch.

This is the second distinct resolution refusal to block recover on `full-review`. The first — recover reading position `n-1`, always an approval gate — was fixed and the class recorded as no-longer-reproducing. The class is not closed: recover still reaches its stage through a resolver built for dispatch.

## Second reproduction (2026-09-11, later) — with a controlled sibling

Pipeline `e2e82daa` (`cleanup-archives-hand-landed-specs`, single lane, `default`) refused with the identical message:

```text
$ jarvis pipeline recover e2e82daa default
stage_resolution_failed: pipeline-stage-resolve: stage "plan" has no preceding workflow artifact
```

Its intent stage had plainly succeeded. What makes this reproduction stronger than the first is the control: two sibling lanes on other pipelines failed with the **same** `contract_miss` shape and took the **same** one-file correction, and `recover` admitted both (`{"kind":"admitted",…}` on `a02ed556 pipeline-list-rpc-terminal-retention` and `c6773daf bulk-terminal-run-dismissal-store`). So the refusal is not about the correction, the staged tree, or the contract that failed — it is the dispatch-shaped predecessor-artifact precondition in the resolver, exactly as this seed states.

Cost: the corrected tree had to be hand-landed as [#3784](https://github.com/cbrenner04/jarvis/pull/3784) and its implement dispatched standalone, while the two recoverable siblings continued inside their pipelines unattended.

## Decisions

- Recovery resolves its target from the failed stage's own durable row — its `workflowInvocationId`, that run's `worktreePath`, and its staged tree — not from the predecessor artifact chain.
- Preconditions recovery genuinely has are unchanged and still refuse before any attempt: the stage must be a `failed` `plan` stage, linked to a workflow invocation, unclaimed, and its staged tree must exist.
- `pipeline resume` is untouched. Resume redispatches the stage's write step and does need predecessor inputs; only recovery's path is narrowed.
- Rules out widening the general resolver's tolerance: dispatch must keep refusing on a missing predecessor artifact, or a plan stage would be dispatched with nothing to draft from.

## Acceptance criteria

- [ ] A test proves `recover` admits a `failed` `plan` stage whose staged tree is present and whose predecessor stage artifact is absent; it fails against the current `stage_resolution_failed` refusal.
- [ ] A test proves the same absent predecessor artifact still refuses *dispatch* of a plan stage, with the existing `pipeline-stage-resolve:` message; it passes before and after.
- [ ] A test proves recovery still refuses a stage that is not a `failed` `plan` stage, is not linked to a workflow invocation, or is already claimed — each with its existing reason.
- [ ] A test proves recovery of an admitted stage lands the staged tree exactly as it sits on disk, invoking no plan write step and no review or actuator role.
- [ ] `v2/docs/pipeline-execution.md` records that recovery resolves from the failed stage's own row rather than the predecessor chain, and why dispatch still requires the predecessor.
- [ ] `v2/docs/operator-runbook.md` — § Pipeline recover: remove the implication that a resolvable predecessor is a precondition.
- [ ] `v2/docs/v1-behaviors.md` records the narrowed recovery resolution.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — recovery target resolution versus dispatch resolution.
- `v2/docs/operator-runbook.md` — § Pipeline recover preconditions.
- `v2/docs/v1-behaviors.md` — the narrowed resolution path.
