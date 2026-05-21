---
name: plan-pr-ready-recovery
---
At the end of plan, the PR should be flipped from draft to ready. Its possible it is written this way but something went wrong a couple times. Either way, if the spec is complete, flip to ready. Maybe if you run plan again and its complete, it checks the branch and flips.

## Refine turn 1

### What already exists

The repo already documents and implements automatic draft-to-ready for successful committed plan runs. `src/commands/plan.ts` calls `safeMarkPlanPrReady(...)` at the end of the successful `commit: true` flow, and `src/modes/plan/pr.ts` already runs `bun run ready` followed by `gh pr ready <branch>`. The spec should not be framed as introducing auto-ready from scratch.

### The likely gap to define

The useful behavior to pin down is recovery and idempotence:

- If a plan branch/spec is already complete but the PR is still draft because an earlier ready attempt failed, was skipped, or did not stick, a later successful `jarvis plan --resume ...` run should detect that state and move the PR to ready.
- If the branch's open PR is already ready, the rerun should treat that as a no-op rather than surfacing a spurious warning from `gh pr ready`.
- If `bun run ready` fails on the rerun, keep the current gate: leave the PR in draft and surface the failure instead of forcing readiness.

### Scope boundaries

- Focus on committed plan mode only (`modes.plan.commit: true`), where Jarvis owns the branch/worktree and GitHub PR lifecycle.
- Keep the existing "ready only after successful plan completion" rule.
- Do not change patch-mode readiness behavior unless the draft phase finds shared code that must move for correctness.
- Do not change merge/run workflow or spec authoring conventions; this is about PR state recovery on an already-authored plan branch.

### Implementation notes for drafting

The current helper boundary is probably too weak for this behavior: `checkPrExists(...)` only answers "is there an open PR number" and does not distinguish draft vs ready. The spec will likely need an explicit "open PR state for branch" lookup in the plan readiness path so reruns can:

1. skip cleanly when there is no open PR,
2. mark ready only when the PR is still draft,
3. no-op when the PR is already ready.

Likely files in scope:

- `src/modes/plan/pr.ts`
- `src/commands/plan.ts`
- plan-mode readiness tests in `test/modes/plan/pr.test.ts` and/or `test/plan-command.test.ts`
- plan-mode docs that currently promise automatic ready-on-success

## Refine turn 2

### Trigger semantics to preserve

The current completion path calls `safeMarkPlanPrReady(...)` only after plan mode itself exits successfully through the committed flow. The recovery behavior should stay attached to that same success path rather than introducing a separate "scan for completed specs and repair them later" command. In other words, a successful committed `jarvis plan --resume ...` run is the recovery trigger; an incomplete run, blocker run, or failed run should not attempt a ready transition.

### Important no-op detail

The current helper is broader than the intent text suggests: once it sees any open PR for the branch, it reruns `bun run ready` and then calls `gh pr ready`. If the desired behavior is "already-ready PRs are a no-op," the spec should say that explicitly for the whole readiness helper, not just for the `gh pr ready` call. Otherwise a rerun against an already-ready PR could still execute the full ready gate and fail even though no draft-to-ready transition is needed.

### State model to draft against

The draft should define branch-scoped open-PR states clearly:

1. no open PR for the plan branch: skip silently, matching today's best-effort behavior,
2. open draft PR: run the existing ready gate, then flip to ready,
3. open ready PR: do nothing and do not warn.

Closed or merged PRs on the same branch should remain out of scope for this recovery logic; the existing `checkPrExists(...)` behavior already ignores non-open PRs, and the spec should avoid broadening that contract unless the draft finds a concrete bug that requires it.

### Test shape worth requiring

The implementation will need more than one unit test around the helper boundary. The spec should likely require coverage for:

- rerun on an open draft PR still executes `bun run ready` and the ready flip,
- rerun on an open ready PR skips both the gate and the flip,
- no open PR remains a silent no-op,
- ready-gate failure on an open draft PR still surfaces as a warning and leaves the PR draft.

### Documentation angle

The docs already promise automatic ready-on-success. The useful documentation change is not "plan mode now marks PRs ready," but "resume runs also recover missed draft-to-ready transitions when the plan is already complete, while leaving already-ready PRs untouched."

## Refine turn 3

### Helper contract should change at the state lookup, not by string-matching `gh` failures

The current `maybeMarkPlanPrReady(...)` implementation in `src/modes/plan/pr.ts` only asks `checkPrExists(...) -> number | null`, then unconditionally runs `bun run ready` and `gh pr ready`. The draft should require an explicit branch-scoped open-PR state lookup before any readiness work begins. Do not implement this as "call `gh pr ready` and suppress the already-ready error text"; that would still run the full ready gate on ready PRs and would keep behavior coupled to GitHub CLI wording.

### Keep the existing warning boundary on real recovery failures

`safeMarkPlanPrReady(...)` in `src/commands/plan.ts` already wraps the helper and emits `warning: could not mark PR ready for review: ...` on failure. The recovery spec should preserve that best-effort boundary for the "open draft PR + ready gate fails" case: the successful plan run still exits through the normal success path, but the warning remains visible and the PR stays draft. For the "open ready PR" and "no open PR" states, no warning should be emitted at all.

### Existing tests will need to be reshaped, not just extended

`test/modes/plan/pr.test.ts` currently encodes the old contract with cases like "calls markReady when PR exists." The draft should call for replacing that binary contract with stateful cases rather than layering more assertions onto `number | null`. A small enum/object return from the lookup seam is likely enough; the important part is that the tests can distinguish `none`, `draft`, and `ready` without relying on shell output.

### Narrow documentation wording to avoid overpromising

The docs should describe this as recovery during a later successful committed resume, not as a background repair mechanism or a general "completed specs always become ready eventually" guarantee. That keeps the user-facing contract aligned with the actual trigger: Jarvis only retries the draft-to-ready transition when a subsequent committed `jarvis plan --resume ...` run completes successfully.

