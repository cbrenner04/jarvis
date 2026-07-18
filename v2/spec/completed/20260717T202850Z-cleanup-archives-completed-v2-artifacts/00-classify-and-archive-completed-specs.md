# 00 - Classify and archive completed specs

## Problem

Cleanup needs one fail-closed policy for deciding whether a v2 spec tree may move and whether its ready-intent may be pruned.

## Decisions

- Derive completeness from every linked subspec's non-human-only acceptance criteria; rules out daemon status and index routing checkboxes as archival authority.
- Treat a spec with no non-human-only criteria as incomplete; rules out vacuous archival of malformed or placeholder trees.
- Refuse archival when a matching PR is open, ownership belongs to a materialized worktree, or either check fails; rules out deleting active work on ambiguous evidence.
- Move the whole spec tree into the same home's `completed/` directory; rules out copying selected Markdown files or changing homes.
- Prune `ready-intents/<name>.md` only when it is byte-identical to the archived tree's `intent.md`; rules out name-only deletion of an unconsumed input.
- Apply the archive move and proven intent prune as one recoverable operation while leaving durable run rows unchanged; rules out partial cleanup or history repair.

## Acceptance criteria

- [x] Complete index-routed and single-file v2 specs are eligible from non-human-only acceptance criteria alone; unchecked index links and terminal run status do not change the result.
- [x] An unchecked non-human-only criterion, absent non-human-only criteria, an open matching PR, another materialized worktree owner, or failed ownership/PR inspection leaves the spec in place with a specific skip reason.
- [x] Successful archival moves the complete tree to its home's `completed/` directory, removes only a byte-identical matching ready-intent, and does not update or delete durable run rows.
- [x] A same-named ready-intent that differs from `intent.md` remains queued, and archive/prune failure does not leave a partial move or deletion.
- [x] `v2/src/commands/cleanup-artifacts.test.ts` adds baseline-failing coverage for completeness, refusal reasons, transactional archival, byte-identical pruning, differing-intent retention, and unchanged run rows.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — define the shared archival eligibility and transaction contract.
- `v2/docs/v1-behaviors.md` — record the v2 cleanup parity delta and governing sources.
