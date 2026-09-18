# 00 — Writer flip, incident predicate, and resume

Two publication-tail causes settle `status: "completed"` on a failure today: `completion_commit_failed` (`completionCommitFailed`, `v2/src/execution/write-loop.ts:4295-4298`) and `ready_flip_failed` (`readyFailed`'s `terminalStatus` ternary, `write-loop.ts:4409-4416`, and `settleWorkflowPublicationFailure`, `v2/src/execution/workflow-runner.ts:322-325`). Flip both to `status: "failed"`, keeping `terminalCause`, `terminalFailureDetail`, PR fields, and resumability as currently written. `completed` then means published.

The two writers for `completion_commit_failed` already disagree: `write-loop.ts`'s own tail writes `"completed"`; `workflow-runner.ts`'s `settleWorkflowPublicationFailure` already writes `"failed"` for this cause (comment at :322-324). Only `write-loop.ts`'s writer needs the flip for `completion_commit_failed`; both writers' `ready_flip_failed` branch needs the flip.

## Decisions

- Scope is exactly `completion_commit_failed` and `ready_flip_failed`. `ready_gate_failed`, `ready_gate_command_missing`, `ready_gate_out_of_scope`, `surviving_mutation_failed`, `non_terminating_mutation_failed`, and `runtime_smoke_failed` already settle (or keep settling) as they do today and are untouched — rules out sweeping the whole `readyFailed` ternary or every `settleWorkflowPublicationFailure` kind.
- Only `status` changes on the two writers above. `terminalCause`, `terminalFailureDetail`, PR number/url, and `completion_commit_failed`'s `resumable: true` stay as written — rules out re-deriving operator guidance or inventing a new `outcomeKind`/terminal-cause value; there is no DB column separate from `terminalCause` for these rows to disagree on.
- `ready_flip_failed` keeps `resumable: false` and gains no resume path. `readyFailureResumable` (`write-loop.ts:4354-4364`) and `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS` (`workflow-runner-resume.ts:1614-1620`) already exclude it, and no `resolveReadyFlipFailedResumeContext` exists — rules out adding `ready_flip_failed` resume admission alongside the status flip.
- `workflow-runner-resume.ts`'s two resume-tail boundary commits (intent-resume tail `:1448-1451`, review-mutation-resume tail `:2521-2524`) currently pair `runStatus: isFlip ? "completed" : "failed"` with `outcomeKind: isFlip ? "done" : "invocation_failure"`. Once `ready_flip_failed` settles `failed`, both sites must always write `runStatus: "failed"` and `outcomeKind: "invocation_failure"` — leaving `outcomeKind: "done"` on a `failed` row would claim success (`"done"`) on a failed settlement, the exact defect a same-status/wrong-outcomeKind pairing would produce.
- `findCompletedRowWithFailureCause` (`v2/src/daemon/operator-incidents.ts:378-383`) requires `status === "completed"` and is what preserves the *specific* `terminalCause` in the synthesized incident (`cause: failedPublication.terminalCause`, :397). Once these two causes settle `failed`, they fall through to `resolveWorkflowRunRollup`'s generic path (`invocationTerminal`, :402-417), which reports `cause: rollup.status` — the generic string `"failed"`, not the specific cause. Retarget the predicate to `status === "failed"` with `terminalCause` in `{"completion_commit_failed", "ready_flip_failed"}`, kept ahead of the generic rollup fallback, so incidents keep naming the specific cause — rules out leaving the predicate as-is (which would silently degrade cause detail once these rows stop matching `"completed"`) and rules out a blanket "any failed row with a cause" match (no other cause needs this override; the generic rollup already handles them).
- Cleanup/archive eligibility is unaffected: `isTerminalRunStatus` (`v2/src/persistence/state-store.ts:56-58`) treats `"completed"` and `"failed"` as equally terminal, and archival additionally requires the PR merged — no branch in `cleanup.ts` distinguishes the two statuses. No task or test needed here.

## Tasks

- [ ] Flip `write-loop.ts`'s `completionCommitFailed` to `status: "failed"`.
- [ ] Flip `write-loop.ts`'s `readyFailed` `terminalStatus` ternary so `ready_flip_failed` settles `"failed"`, leaving `runtime_smoke_failed` on `"completed"`.
- [ ] Flip `workflow-runner.ts`'s `settleWorkflowPublicationFailure` so its `ready_flip_failed` branch also settles `"failed"` (its `completion_commit_failed` branch is already `"failed"`).
- [ ] Update `workflow-runner-resume.ts`'s two resume-tail boundary commits (`:1448-1451`, `:2521-2524`) to always write `runStatus: "failed"` / `outcomeKind: "invocation_failure"` on a publication-tail failure, dropping the `isFlip` branch on those two fields.
- [ ] Retarget `findCompletedRowWithFailureCause` (rename if the new predicate no longer matches "completed") to `status === "failed"` + `terminalCause` in the publication-tail cause set, ahead of the generic rollup fallback in `invocationTerminal`; update its docstring.
- [ ] Update existing tests asserting `completed` status or `outcomeKind: "done"` for these two causes in write-loop, workflow-runner, workflow-runner-resume, and operator-incidents test files.

## Acceptance criteria

- [ ] A test proves `completion_commit_failed` and `ready_flip_failed` settle the row `failed` with the same `terminalCause` and resumability as written today; it fails against the pre-fix code, which settles `completed` for both.
- [ ] A test proves `run resume` admits a `failed` `completion_commit_failed` row and completes it without a duplicate commit or PR; it fails against the pre-fix code, whose writer produces a `completed` row that the resume status gate (`run.status !== "failed"`) rejects.
- [ ] A test proves a `failed` publication-tail row (`completion_commit_failed` or `ready_flip_failed`) yields exactly one operator incident carrying that specific `terminalCause`, not the generic `"failed"` rollup cause; it fails against the pre-fix predicate, which only matches `status === "completed"` and so either misses the row or reports the generic rollup cause once the row is `failed`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md:85` — "leave the durable run `completed`" for publication failures is stale for `completion_commit_failed`; reconcile with `:585-586` and `:598`, which already say `failed`.
- `v2/docs/write-behavior.md:585-586` and `:598` — `ready_flip_failed` no longer "stays `completed`" / carries `runStatus: completed`; update to `failed`, keeping `resumable: false`.
- `v2/docs/write-behavior.md` (Ready finalization paragraph) — "demotes the durable run to `failed` on gate or mutation failure (or keeps it `completed` on smoke or flip failure)" — drop "or flip"; smoke alone keeps `completed`.
- `v2/docs/workflow-runner.md:504` — "Smoke-failure and failed-flip failures ... preserve durable `completed` status" — split: smoke keeps `completed`, flip now settles `failed`.
- `v2/docs/daemon-host.md:297-310` — the operator-error table's `ready_flip_failed` row says "on a `completed` row"; update to `failed` (the `completion_commit_failed` row already says `failed`).
- `v2/docs/v1-behaviors.md:598` — flip failure "the run stays `completed`" → settles `failed`; keep `resumable: false`.
- `v2/docs/v1-behaviors.md:271` — confirm the resumability description still holds (resumability is unchanged by this spec) and note the row now settles `failed`.
- `operator-incidents.ts:378` docstring — no longer "settle the row `completed` yet need the operator"; describe the retargeted `status === "failed"` predicate.
