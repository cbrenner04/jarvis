---
name: publication-failures-settle-failed
---

# Publication failures settle a run `completed`, contradicting half the docs and hiding the failure

## Problem

`completionCommitFailed` (`v2/src/execution/write-loop.ts` ~4261) always writes `status: "completed"` for `completion_commit_failed`; `ready_flip_failed` does the same. So a run that did not publish reads `completed` in `run list` / the TUI with a failure reason beside it. The docs disagree about the contract: `v2/docs/write-behavior.md:85` says publication failures "leave the durable run `completed`", while `write-behavior.md:585/598` and `v2/docs/daemon-host.md:297` document `completion_commit_failed` on a `failed` row. Every consumer that keys on status must special-case `terminalCause` — [#3907](https://github.com/cbrenner04/jarvis/pull/3907) had to add exactly that to incident derivation after a resumed lane's failure produced no notification.

## Evidence (2026-09-14)

Store: 4 `completed` rows with `terminal_cause = completion_commit_failed`, 7 with `ready_flip_failed`. Run `a2762fc9` (TUI monitor lane) read `completed` / `completion_commit_failed` after resume; its invocation roll-up then read `killed` with no cause and emitted no incident until #3907.

## Decisions

- Publication-tail failures settle the row `failed` with the same `terminalCause`, resumability, and `nextAction`; `completed` means published.
- `run resume` admission, `run list`/`wait` projection, stage settlement, and incident derivation key on `failed` + cause; remove #3907's `completed`-with-failure-cause special case once no row writes that shape.
- Migrate existing `completed` rows whose `terminal_cause` is not `complete`/null to `failed`.
- Reconcile `write-behavior.md:85` with `:585/598` and `daemon-host.md:297`.

## Acceptance criteria

- [ ] A test proves `completion_commit_failed` and `ready_flip_failed` settle the row `failed`; it fails against the pre-fix `completed` write.
- [ ] A test proves `run resume` still admits a `failed` `completion_commit_failed` row and completes it without a duplicate commit or PR.
- [ ] A migration test proves existing `completed` rows with a non-`complete` terminal cause become `failed`, and other rows are untouched.
- [ ] A test proves incident derivation emits `terminal:failed` for such a row without the `completed`-with-cause special case.

## Documentation updates

- `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md` — one contract: publication failures settle `failed`.
