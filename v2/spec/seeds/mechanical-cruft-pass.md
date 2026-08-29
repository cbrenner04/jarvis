---
name: mechanical-cruft-pass
---

# Mechanical cruft pass: shared helpers, dead flags, path derivations, migrations

## Problem

The 2026-08-29 review found duplication and vestigial surface that is individually small but collectively the review-drag layer. Decomposition into intents is the intent stage's job; the inventory:

- Generic helpers reimplemented 2–5×: `isRecord` (5 sites), `isLoadError` (4), recursive markdown walker (5, two byte-identical), `throwIfAborted` (3), `sleep`/`errorMessage`/`resolveTargetDir`/others (2 each), plus 89 inline `error instanceof Error ? … : String(…)` coercions across 27 files.
- `uncovered-changed-lines.ts` ≈ `diff-derived-mutation-verifier.ts`: three helpers copied, and `defaultRunTests` treats `scope` as file patterns while `defaultRunScopedTests` treats the same-shaped arg as script names (a third copy at `mutation-checkpoint-verifier.ts:750`) — a silent-pass trap on the wrong list.
- Worktree layout `join(root, "worktrees", project, branch)` derived in 6 places; the SQLite path in 2; the `~shrink` suffix as a module-private constant plus two raw literals and a hardcoded `slice(0, -7)` (`daemon.ts:633-635`, `workflow-run-status-rollup.ts:32`).
- `forceDistinctCommit` is `true` at all 8 production call sites; `shouldReuseHeadWithoutNewCommit` and the `completion-commit.ts:304` reuse branch are production-unreachable.
- 28 sequential SQLite migrations (`state-store.ts:791-928`) against a single-machine DB; two "legacy row" compat branches (`daemon-wire.ts:46`, `state-store.ts:64`) predating the current schema.

## Decisions

- One shared home per helper (existing `shared/` or a v2 util module), call sites migrated, duplicates deleted; the two runTests scope semantics get distinct parameter types so the wrong list is a type error. Rules out leaving the silent-pass trap.
- Path derivations move to `paths.ts` (worktree layout, SQLite path); the shrink suffix becomes one exported constant with `endsWith`/`slice` helpers. Rules out re-deriving layout by hand.
- `forceDistinctCommit` and its dead branch are deleted; tests asserting the dead branch are removed with it as intentional coverage of removed behavior. Rules out a flag with one value.
- Migrations squash to a baseline schema; the compat branches' fate is decided against the operator's actual DB (single machine, one store). Rules out carrying 28 ALTERs forever.
- Behavior-preserving throughout; any site whose semantics would change gets its own seed instead. Rules out cleanup silently changing behavior.

## Acceptance criteria

- [ ] Each inventoried duplicate family has one implementation; grep-level absence of the old copies, pinned per family.
- [ ] The two scoped-test runners take distinct types; passing the wrong list fails typecheck, pinned.
- [ ] `forceDistinctCommit` is gone; completion-commit behavior in production paths is byte-identical, pinned by existing tests.
- [ ] The squashed store opens both a fresh DB and the operator's current DB, pinned by a migration test over a pre-squash fixture.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — shared-helper homes; `v2/docs/state-store.md` — baseline schema note.
