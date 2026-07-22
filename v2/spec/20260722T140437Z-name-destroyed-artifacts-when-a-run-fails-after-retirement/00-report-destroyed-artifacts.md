# 00 - Report retirement-destroyed artifacts on a failing dispatch

## Problem

`resetStaleWorkspace` (`v2/src/commands/cleanup.ts:659`) destroys artifacts one at a time — close the
matching draft PR, remove the worktree, delete the local branch, delete the remote branch — and each
step reports only an interleaved stdout line (`Closed PR #…`, `Removed worktree: …`, `Deleted local
branch: …`). PR closure and branch deletion are best-effort warnings, so a retirement can end partway
with some artifacts gone and others intact. It returns `{status}` only, so `runWorkflowCommand`
(`v2/src/commands/workflow.ts:194`) knows nothing about what died. When the invocation then exits
non-zero, the operator gets the failure message and must reconstruct the destroyed set from scrolled
stdout — or guess, when retirement aborted mid-sequence.

## Decisions

- `resetStaleWorkspace` returns a record of artifacts observed destroyed in this invocation (closed PR number, worktree path, local branch, remote branch), populated per step from the command that actually succeeded. Rules out inferring the set from `status`, which cannot express partial teardown.
- `runWorkflowCommand` holds that record and emits the summary to stderr on any non-zero exit reached after retirement — including a dispatch failure and a run that starts and later fails. Rules out limiting the summary to the retirement-refusal path.
- The summary is suppressed when the destroyed record is empty. Rules out an unconditional line, and makes "retirement started but destroyed nothing" indistinguishable from "retirement never started" — correctly, since nothing needs recovering.
- The summary reports destruction events, not current on-disk state; it never re-probes git or GitHub. Rules out reconciling against a worktree that a successful materialization has since recreated — the runbook carries that caveat instead.
- Shape: a header line, then one indented line per destroyed artifact naming its kind and identifier. Rules out a single packed line that the operator must parse.
- The record threads through the existing `removeWorktreeAndBranch` helper as a return value; `performWorktreeRemovals` and `runAbandonCommand` keep their current behavior and may ignore it. Rules out duplicating the teardown sequence for the reset path.

## Acceptance criteria

- [ ] A `run workflow implement` invocation that retires a stale workspace and then exits non-zero prints a stderr summary naming each artifact destroyed in that invocation — closed PR number, worktree path, local branch, remote branch.
- [ ] A retirement that destroys only some artifacts (e.g. worktree removed, branch deletion failed) summarizes only the destroyed ones; the surviving artifacts are absent from the summary.
- [ ] An invocation that fails before retirement destroys anything prints no such summary.
- [ ] A successful dispatch prints no such summary.
- [ ] New tests in `v2/src/commands/workflow.test.ts` cover the full-teardown, partial-teardown, pre-retirement-failure, and success cases; they fail against the pre-fix code.
- [ ] Inverting the added suppression guard (emitting the summary regardless of exit code or of an empty record) makes the success-case and pre-retirement-failure tests fail; those tests assert the summary text is absent, not merely unasserted.
- [ ] Existing `implement preflight stale workspace reset` tests in `v2/src/commands/workflow.test.ts` and the `resetStaleWorkspace` tests in `v2/src/commands/cleanup.test.ts` stay green (teardown sequence unchanged by the added reporting).
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § stale-workspace retirement (~line 206) — the destroyed-artifact summary, that it lists this invocation's destruction events rather than current state (a started run may have recreated the worktree and branch), and how to recover from a partial teardown.
- `v2/docs/v1-behaviors.md` — the `[v2 additive]` implement re-run reset entry (~line 76): a non-zero exit after retirement emits the stderr destroyed-artifact summary; success and pre-retirement failures do not.

## Notes

Two unmerged sibling specs touch this seam: `20260722T134237Z-retire-stale-workspace-only-after-dispatch-is-reachable` (moves retirement inside the dispatch callback) and `20260722T135507Z-delete-remote-artifacts-last-during-retirement` (reorders teardown and aborts on first failure). This subspec is order-agnostic — it records what each step destroyed, wherever the call sits and whatever the step order — but implement it after whichever of those lands first to avoid re-resolving the same lines.
