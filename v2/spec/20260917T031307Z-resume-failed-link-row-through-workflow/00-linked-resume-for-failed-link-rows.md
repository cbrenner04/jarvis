# Linked resume for failed link rows

## Problem

`reconstructWriteResume` in `v2/src/daemon/daemon-run-lifecycle-handlers.ts` takes the linked path only when `run.status === "paused" && matchesLinkedSiblingStepId(...)` (`daemon-run-lifecycle-handlers.ts:407`). `reconstructPausedWriteResumeInput` (`v2/src/execution/workflow-runner-resume.ts:1562`), the linked builder itself, independently refuses any non-`paused` row at its own top (`workflow-runner-resume.ts:1565`). An admitted `failed` link row (e.g. `gate_invocation_refused`) therefore falls through both gates to the bare write-loop input, which finishes remaining subspecs and self-publishes, skipping linked finalization, `implement~shrink`, and `implement-review`; the invocation roll-up then reads `killed`. Evidence: `f2e8783a` → #3916, `854d55f2` → #3787, `d707f38b` → #3588.

## Decisions

- Linked-row routing keys on `matchesLinkedSiblingStepId`, not on run status — rules out a `failed`-only special case that misses the other non-paused resumable outcome already reachable through this same admission path: `iteration_timeout` when `event.resumable` is true (`v2/src/daemon/run-operator-error.ts:334`, `composeRunOperatorError` → `resolveRunResumeAdmission` → `deps.reconstructWriteResume`).
- Remove the `run.status !== "paused"` check inside `reconstructPausedWriteResumeInput` (`workflow-runner-resume.ts:1565`) in place; keep the exported name and call sites unchanged across `v2/src/execution/` and `v2/src/daemon/` — rules out a second, divergent linked-context builder or a call-site rename that touches unrelated code.
- The daemon-side gate at `daemon-run-lifecycle-handlers.ts:407` drops its `run.status === "paused"` conjunct, keeping only `matchesLinkedSiblingStepId(stepId, step.stepId)` — any admitted link row (paused or a resumable terminal status) takes the linked branch.
- A failed row's last durable attempt is not folded into iteration counting: `reconstructPausedWriteResumeInput`'s output carries no `initialIterationsConsumed` today (unlike `reconstructDirectWriteResume`, which explicitly strips it from `queuedInput`), so the resumed write loop starts its iteration count at zero — unchanged behavior, now reachable from a failed row too. The failed attempt does not block reconstruction; nothing in `reconstructPausedWriteResumeInput` or `resolvePinnedLinkedSubspec` inspects attempt history.
- Linked reconstruction failure returns `resume_unsupported` with a message that both names the missing context (the existing `reconstructed.message`) and states the recovery action; it never falls back to the non-linked write-loop input — rules out silent bare-loop publication.
- `findSurvivingMutationRepromptFromLog` stays gated on `run.status === "paused"` at its own call site (`daemon-run-lifecycle-handlers.ts:421`), independent of the status-neutral linked-reconstruction change above — a failed link row's resume never restores review-mutation reprompt context.
- Bare write-loop resume stays for rows with no workflow snapshot (`run start`); unchanged.
- The finalization-tail and intent-finalization admission checks (`resolveIntentFinalizationResumeContext`, `isFinalizationTailResumable`) run before `reconstructWriteResume` and resolve against review/completion-commit/exhausted-red/write-out-of-scope/write-non-terminating shapes, never a `<step>~link-N` write row — a failed link row always falls through to `reconstructWriteResume` unmolested; no reordering needed.
- Once `reconstructWriteResume` returns a linked `ok` input, handing it to `spawnWriteLoop` is sufficient for the remaining links, `implement~shrink`, `implement-review`, and tail publication to run — this is exactly what `resumePausedRun` (`daemon-run-lifecycle-handlers.ts:1067`) already does for paused rows today; no new orchestration is needed, only reaching that same input construction from the non-paused branch (`daemon-run-lifecycle-handlers.ts:1210`).

## Task checklist

- Remove the status check from `reconstructPausedWriteResumeInput` (`v2/src/execution/workflow-runner-resume.ts`).
- Remove the `paused` gate from the linked branch of `reconstructWriteResume` (`v2/src/daemon/daemon-run-lifecycle-handlers.ts:407`).
- Extend the refusal message built from a failed linked reconstruction to name a recovery action alongside the reason.
- Add regression tests (`v2/src/daemon/daemon-resume.test.ts`, `v2/src/execution/workflow-runner-resume-reconstruct-paused-write.test.ts`).
- Update docs.

## Acceptance criteria

- [ ] A daemon resume test proves `run resume` on a `failed` `gate_invocation_refused` `implement~link-0` row continues through linked finalization, `implement~shrink`, and `implement-review`, with publication exactly once at the workflow tail; it fails against the pre-fix bare write-loop resume.
- [ ] A test proves the resumed invocation's roll-up reads `completed` (not `killed`) and `deriveOperatorIncidents` derives a `run-ad-hoc-terminal` incident with `cause: "completed"` for it; it fails against the pre-fix code.
- [x] A test proves a `failed` `implement~link-1` row whose linked index no longer contains that pinned entry (reachable today via `resolvePinnedLinkedSubspec` returning `errorKind: "malformed_link"`, `workflow-runner-resume.ts:998` route in `v2/src/execution/workflow-runner.ts` already exercises the same failure) is refused with `resume_unsupported`, a message naming the missing context, and a distinct recovery clause, with `spawnWriteLoop` not called; it fails against the pre-fix code (a link row reaching this point is a `failed` row, which pre-fix never enters the linked builder and instead succeeds via the bare loop rather than refusing).
- [x] `daemon-resume.test.ts`'s `"paused implement~link-N without linked index materialization projects unsupported_resume_context and list/wait/resume agree"` and `"resumes paused implement~link-N into linked subspec routing and records iteration_started"` stay green.
- [x] `daemon-resume.test.ts`'s `"paused implement run resumes surviving mutation reprompt context"` stays green, and a new assertion confirms a non-paused (`failed`) linked-row resume does not restore surviving-mutation reprompt context.
- [x] `workflow-runner-resume-reconstruct-paused-write.test.ts` stays green.
- [ ] `v2/docs/operator-runbook.md` states `gate_invocation_refused` recovery via `run resume` continues through the linked workflow and names the refusal (reason plus recovery) for unreconstructable link rows.
- [x] `v2/docs/v1-behaviors.md` records the changed link-row resume behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `gate_invocation_refused` recovery and link-row resume semantics.
- `v2/docs/v1-behaviors.md` — link-row resume now routes through the workflow.

## Blocker

The Decisions section's last bullet is factually wrong, and AC #1/#2 (which depend on it) cannot be satisfied without new orchestration that the same Decisions bullet rules out.

Claim in Decisions: "handing it to `spawnWriteLoop` is sufficient for the remaining links, `implement~shrink`, `implement-review`, and tail publication to run — this is exactly what `resumePausedRun` already does for paused rows today; no new orchestration is needed."

This is false, and it was already false pre-fix for the paused case, not just for the new failed case this subspec adds. Evidence:

1. Static: `executeWriteLoop` (`v2/src/execution/write-loop.ts`) has zero references to `runLinkedImplementStep`/`executeWorkflow`/linked-index re-scanning (confirmed by grep). The link→link→shrink→review sequencing exists only in `runLinkedImplementStep`/`runWorkflowStep` (`v2/src/execution/workflow-runner.ts`), invoked only from fresh workflow admission (`daemon-workflow-admission-handlers.ts`), never from the `resume` RPC. `resume`'s `spawnWriteLoop` calls `writeLoopExecutor` (production: `executeProductionWriteLoop` → bare `executeWriteLoop`) exactly once, for exactly one row.
2. Static: `executeWriteLoop` publishes whenever `args.publishCompletion !== false` (`write-loop.ts:1159`, `:2027`). Neither `reconstructPausedWriteResumeInput` nor `reconstructWriteResume`'s linked branch ever sets `publishCompletion`/`isCompletionRow`, so it defaults to publish-on-complete for every resumed link row, terminal or not.
3. Static: `rollupWorkflowRunStatus` (`v2/src/persistence/workflow-run-status-rollup.ts:82-90`) explicitly does not trust a completed `~link-N` row by itself — `linkedRoutingFinished` requires a sibling `~shrink` row or a later authored step's row as evidence, else it rolls the whole invocation up to `killed`, regardless of the link row's own status.
4. Empirical: built a throwaway probe (real `executeWriteLoop`, real git worktree, 2-entry linked index, `reconstructPausedWriteResumeInput`'s actual output for `implement~link-0` on a `failed`/`gate_invocation_refused` row with one recorded attempt) and ran it. Result: the agent binding was invoked once, the row settled `complete`, `completionPublisher` was called once (immediately), and no `implement~link-1` row was ever created. Deleted after use; not part of this diff.

Net: resuming a non-terminal linked-implement row — paused or failed — always self-publishes after finishing only its own pinned subspec, skipping remaining links, `implement~shrink`, and `implement-review`, and the invocation rollup then reads `killed` per point 3. This is precisely the symptom the Problem section describes, and my fix (exactly as scoped by the Decisions) does not change it, because the Decisions explicitly forbid touching `publishCompletion`/`isCompletionRow` or dispatching subsequent steps ("no new orchestration is needed").

What I completed (unaffected by this gap, all green): status-neutral linked-row routing in `reconstructWriteResume`/`reconstructPausedWriteResumeInput`, the malformed-link refusal with a recovery clause appended to the message, a test confirming a non-paused failed linked-row resume does not restore surviving-mutation reprompt context, and the full pre-existing regression suite. `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` all pass except the pre-existing sandbox-EPERM unix-socket tests (`v2/src/ipc/server.test.ts`, `pipeline-verb-stable-routing.sandbox-unrunnable.test.ts`), unrelated to this diff.

What I did not do: implement the orchestration needed to actually satisfy AC #1/#2 (threading `publishCompletion: false` through non-terminal link resumes and re-dispatching the next link/shrink/review after each settles) — that is a materially larger change than "reach the same input construction from the non-paused branch," and the Decisions section explicitly rules it out. I also corrected the operator-runbook.md/v1-behaviors.md language I'd initially drafted to match the Decisions' (false) continuation claim, since it wasn't true; the docs currently in this diff describe only the routing/message fix.

Needs an operator decision: either (a) descope AC #1/#2 to match what routing-only reconstruction actually achieves, or (b) authorize the larger orchestration fix (which belongs in its own subspec, since it touches `write-loop.ts`'s publish gating and/or `workflow-runner.ts`'s dispatch, not just `reconstructWriteResume`).

blocked
