---
name: no-work-settlement-refuses-uncommitted-work
---

# A write step that resolves `no-work` over uncommitted tracked changes must not settle `completed`

The write-loop completion boundary maps a `no-work` terminal token to `runStatus: "completed"`
unconditionally. On run `eabc39a7` (2026-08-03) the step read a spec whose criteria an earlier run had
already ticked in the worktree, found nothing to do, and settled `no_file_changes` → `no-work` →
`completed` while four modified tracked paths sat uncommitted. Nothing was committed, pushed,
published, or gated; the work was salvaged by hand (PR #2575). `completed` in `run list` is the
runbook's promise of a completion commit, PR evidence, and a green gate — this path breaks it.

## Decisions

- A write step resolving `no-work` while its worktree holds uncommitted **tracked** changes settles a
  named non-`completed` status listing those paths — rules out reporting success over work that was
  never committed.
- The refusal keys on tracked modifications only — rules out untracked scratch output failing an
  otherwise honest `no-work` run.
- `no-work` over a clean tree keeps settling `completed` — rules out reclassifying every `no-work` as a
  failure.
- The settlement names the offending paths and carries an operator recovery line — rules out an opaque
  status the operator must re-derive from the log.

## Acceptance criteria

- [ ] A regression asserts a write step resolving `no-work` over a worktree with uncommitted tracked
      paths settles a non-`completed` status naming those paths; it fails against the current boundary.
- [ ] `run list` and `run wait` project that status and its recovery line; a regression pins both.
- [ ] A regression asserts `no-work` over a clean worktree still settles `completed`.
- [ ] Mutation checkpoint: inverting the dirty-`no-work` refusal turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row no longer admits the
  `no-work`-over-dirty case; state what `no-work` now settles.
- `v2/docs/v1-behaviors.md` — record the dirty-`no-work` refusal.

## Prerequisites

- The router selects the first linked subspec with an unticked non-human-only acceptance criterion, independent of its index checkbox.
- A run over a tree whose subspecs are all fully ticked settles `already_complete` rather than `no-work`/`completed`.
- The write loop maps a `no-work` terminal token to a run status and an operator error projected by `run list` and `run wait`.
- Per-iteration commit checkpointing runs on every settled main-loop iteration.
</content>
