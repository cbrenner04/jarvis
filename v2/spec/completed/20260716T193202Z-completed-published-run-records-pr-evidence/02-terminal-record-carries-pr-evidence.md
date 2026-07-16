# 02 - Terminal record and run list carry the PR evidence

Publication confirms a PR (subspec 00) and completion now depends on it (subspec
01), but nothing durable records it. The `loop_finished` terminal record carries
`loopOutcomeKind`, `iterationsConsumed`, `resumable`, and a publication failure —
never the PR. `run list` rows likewise omit it, so falsifying "this run
published" costs a live `gh` query per row.

## Decisions

- Persist the confirmed number and URL on the `loop_finished` record; rules out a separate event, which would leave the terminal row incomplete for the readers that already stop at it (daemon list, operator error mapping, log follow).
- Record evidence on every terminal row whose publication confirmed a PR, not only `complete`; rules out losing the PR pointer exactly on the failure rows where an operator must go fix it by hand.
- Surface the evidence as `run list` row fields and appended `jarvis run list` columns; rules out changing existing column order, which would break operators parsing the row.

## Acceptance criteria

- [x] A completed published run's terminal `loop_finished` record carries the confirmed PR number and URL; a test asserts both and fails against the pre-fix code.
- [x] `run list` reports the PR number and URL for that run, with no live `gh` query.
- [x] A run that failed its ready flip after a confirmed PR carries the same evidence on its terminal record and list row.
- [x] A run that never published (git-disabled, or terminal before publication) reports no PR evidence, and `jarvis run list` renders `-` for both columns.
- [x] Existing `jarvis run list` columns keep their order and meaning; the PR columns are appended.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal PR evidence and the `run list` fields.
- `v2/docs/write-behavior.md` — the `jarvis run list` row/column contract.
