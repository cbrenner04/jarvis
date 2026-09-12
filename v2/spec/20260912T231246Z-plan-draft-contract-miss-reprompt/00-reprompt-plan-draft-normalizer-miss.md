# Reprompt one plan-draft normalizer miss

## Problem

A plan-draft normalizer rejection immediately settles `blocked` / `contract_miss`, even when the staged tree needs one mechanical repair. The write loop already owns bounded repair arms, but plan-draft contract misses bypass them and force an operator redraft.

## Decisions

- Retry only `plan.prompt.draft` normalizer misses, not `plan.draft.shape`, prerequisite-blocker, intent-split, or unrelated-step contracts; this rules out repairing contracts whose input tree is absent, malformed, or outside plan drafting.
- Consume the repair invocation as one ordinary `maxIterations` unit; `maxIterations: 1` settles the first eligible miss without repair, and a repair plus its triggering draft reports two consumed iterations; this rules out a repair allowance outside the loop budget.
- Permit one repair per durable run, including after a repair returns `progress`; this rules out a fresh repair allowance after ordinary drafting resumes.
- Append `draft_contract_reprompt` with the exact contract id and detail as delimited data before its `progress` boundary and before invoking the repair; this rules out crash loss, duplicate repair admission, or diagnostic instruction execution.
- Reconstruct both pending repair context and spent allowance from durable log/boundary state for workflow and direct pause/resume and crash re-entry; this rules out losing a committed repair or granting another after a completed repair.
- Treat an interrupted repair attempt as pending until its iteration settles, then replay that same repair context on resume; this rules out silently skipping a repair or treating an interrupted invocation as a second allowance.
- Let repair `progress`, `blocked`, invalid-token, invocation-failure, and timeout results use their existing write-loop settlements; only a completed repair re-evaluates plan-draft contracts, so no outcome starts an unbounded ordinary draft sequence.
- Treat the contract id and detail as delimited diagnostic data and permit only staged-tree repair; this rules out a full redraft or interpreting diagnostics as instructions.
- When `Plan index does not link <file>` suggests a stale rename, name deletion as the likely repair and forbid adding a link merely to satisfy the checker; this rules out claiming the diagnostic alone proves deletion is correct.
- Add a true unlinked-file fixture because the named baseline helper fails first on an unknown index link; this rules out a stale-file-guidance test that misses the normalizer diagnostic.
- After the allowance is spent, preserve terminal non-resumable `blocked` / `contract_miss` and the second miss's `contract_miss_detail`; this rules out masking a drafter that still cannot satisfy the contract.

## Tasks

- Add eligible one-shot normalizer-miss scheduling, budget accounting, event-before-boundary logging, spent-state tracking, staged-tree-only repair, and ordinary contract re-evaluation.
- Reconstruct pending/spent repair state for workflow and direct resume, including paused, aborted, and interrupted-after-checkpoint execution.
- Render the repair through a registered prompt, preserve harness-blocker clearing, and register the event and render observer.
- Add focused regressions for successful repair, stale-file guidance, data-only diagnostics, repeated failure, budget edges, repair outcomes, recovery, and excluded contracts.
- Align the durable write contract, operator meaning, and v1 behavior catalog.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` proves an eligible plan-draft normalizer miss invokes the same binding chain once more with byte-for-byte contract id/detail, appends `draft_contract_reprompt` before that invocation, and completes through re-evaluation after the staged fix; the test fails against pre-fix immediate settlement.
- [ ] `v2/src/execution/write-loop.test.ts` drives a real `Plan index does not link 01-unlinked.md` staged fixture and proves the prompt calls deletion likely only for a stale rename and rejects adding a link merely to satisfy the checker; the test fails against pre-fix immediate settlement.
- [ ] `v2/src/execution/write-loop.test.ts` uses instruction-like contract id/detail bytes and proves the rendered prompt delimits both as data while the recorded `draft_contract_reprompt` preserves those exact bytes before invocation; the test fails against pre-fix immediate settlement.
- [ ] `v2/src/execution/write-loop.test.ts` proves `maxIterations: 1` settles the first eligible miss without repair and that a triggering draft plus repair consumes two iterations; both tests fail against pre-fix immediate settlement.
- [ ] `v2/src/execution/write-loop.test.ts` proves repair `progress`, `blocked`, invalid-token, invocation-failure, and timeout retain their existing settlements and cannot invoke a third drafter beyond `maxIterations`; completed repair contract pass completes normally and a second miss settles non-resumable `blocked` / `contract_miss` with the second miss's `contract_miss_detail` shape and one recorded repair event.
- [ ] `v2/src/execution/write-loop.test.ts` and `v2/src/daemon/daemon-resume.test.ts` prove paused, aborted, and interrupted-after-checkpoint repairs reconstruct pending context and spent allowance without loss or duplication for workflow and direct rows; a settled repair remains spent after resume.
- [ ] `v2/src/execution/write-loop.test.ts` proves plan-shape, blocker, intent-split, and unrelated-prompt contract misses settle without `draft_contract_reprompt`; each excluded path is reachable on main.
- [ ] `prompts/write/draft-contract-reprompt.md` is registered as `write.draft-contract-reprompt`, treats the contract id and detail as data, and permits only staged-tree repair.
- [ ] `shared/prompts/render-observer-tests.ts` maps the new registered prompt to the regression that observes its rendered repair instructions.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes because the new root `prompts/` artifact makes the CI scope full.

## Documentation updates

- `v2/docs/write-behavior.md` — document eligibility, one shared-iteration repair, event/boundary ordering, data delimiters, recovery/spent-state semantics, outcome handling, stale-file uncertainty, and repeated-miss settlement.
- `v2/docs/operator-runbook.md` — state that a plan-draft normalizer `contract_miss` means automatic repair also failed, excluded classes still settle immediately, and an interrupted repair resumes once.
- `v2/docs/v1-behaviors.md` — record the v2 plan-draft normalizer-miss reprompt as a behavior change from immediate settlement.
