---
name: publication-failures-settle-failed-writer
---

# Publication-tail failures settle the run row `failed`

`completion_commit_failed` and `ready_flip_failed` (`v2/src/execution/write-loop.ts`, `completion-commit.ts`, `workflow-runner*.ts`) write `status: "failed"` with the same `terminalCause`, resumability, and `nextAction`; `completed` means published. `run resume` admission keys on `failed` + cause and still completes such a row.

## Acceptance criteria

- [ ] A test proves `completion_commit_failed` and `ready_flip_failed` settle the row `failed`; it fails against the pre-fix `completed` write.
- [ ] A test proves `run resume` admits a `failed` `completion_commit_failed` row and completes it without a duplicate commit or PR.

## Documentation updates

- `v2/docs/write-behavior.md` (reconcile `:85` with `:585/598`), `v2/docs/daemon-host.md:297`, `v2/docs/v1-behaviors.md` (`:598` flip-failure-stays-`completed`, `:271` `completion_commit_failed` resumable default) — one contract: publication failures settle `failed`.

## Prerequisites
