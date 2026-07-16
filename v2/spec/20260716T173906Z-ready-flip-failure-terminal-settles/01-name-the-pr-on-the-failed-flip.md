# 01 - Name the PR on the failed flip

The flip failure is the one failure whose remediation is manual, but the operator error names no PR: `publishCompletionArtifacts` discards the publisher's `prNumber`, so `readyFlipError` and the terminal record identify only the branch.

## Decisions

- Carry the publisher's already-returned `prNumber` onto the flip failure result and its `loop_finished` row; rules out a fresh `gh` lookup at settlement, which fails for the same reasons the flip did.
- Scope PR evidence to the flip-failure path only; rules out recording PR evidence for every completed run — that is `completed-published-run-records-pr-evidence`, which depends on this spec.
- Omit the field when publication reported no PR number rather than substituting the branch; rules out a placeholder the operator cannot act on.

## Work

- Return the publication PR number from `publishCompletionArtifacts` and attach it to the flip failure in the write loop and workflow runner.
- Expose it on the terminal record and through `list` / `wait` / CLI output.
- Cover the plumbed PR reference and its omission.
- Rewrite the runbook's failed-flip recovery.

## Acceptance criteria

- [ ] A flip failure whose publication returned a PR number surfaces that PR on the run's terminal record and on `list` / `wait` alongside the preserved flip cause; the test fails against the pre-fix code.
- [ ] A flip failure whose publication returned no PR number omits the PR reference rather than emitting a placeholder, and still surfaces the flip cause.
- [ ] `v2/src/execution/write-loop.test.ts` and `v2/src/execution/workflow-runner.test.ts` completion-publication cases stay green — publication ordering and the `completion_commit_failed` / `ready_gate_failed` paths are unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/operator-runbook.md` § Recovery gives failed-flip recovery against the named PR and the recorded flip cause, without `jarvis run resume` or a daemon restart; `v2/docs/daemon-host.md` and `v2/docs/write-behavior.md` document the PR reference on the flip failure.

## Documentation updates

- `v2/docs/operator-runbook.md` — failed-flip recovery without resume or daemon restart.
- `v2/docs/daemon-host.md` — PR reference on `list` / `wait` flip errors.
- `v2/docs/write-behavior.md` — PR reference on the flip failure result.
