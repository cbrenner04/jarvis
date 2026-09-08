# 04 - Deduplicate skipped artifact reporting

Depends on [00](./00-terminal-only-claims-do-not-retain-worktrees.md) and [03](./03-spec-scoped-detached-ownership.md) skip-reason paths landing first.

## Problem

The same artifact can be skipped in both pre-retirement archival and stranded passes, emitting duplicate stdout skip lines for one canonical identity in a single cleanup invocation.

## Decision ledger

- Key skip aggregation by canonical artifact identity (resolved `source` path); rules out duplicate output from pre-retirement and stranded passes.
- Collapse `Skipped artifact:` and `Skipped stranded artifact:` into one `Skipped artifact:` line per identity per invocation; rules out two prefixes for one canonical identity.
- When multiple passes would skip the same identity, keep the reason naming the most specific blocking condition (ownership refusal beats generic eligibility; reasons listing concrete paths beat bare messages); rules out dropping refusal detail entirely.
- `--dry-run` and apply share the same deduplicated skip reporting; rules out preview-only duplicates while apply deduplicates.

## Work

- Introduce a per-invocation skip ledger keyed by canonical artifact identity across post-retirement archival, stranded inspection, and stranded apply paths.
- Collapse duplicate skip emissions into one final `Skipped artifact:` line per identity using the precedence rule above.
- Add regression coverage driving both passes over one identity.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `each skipped artifact is reported once` drives the pre-retirement and stranded passes over one identity and asserts one merged `Skipped artifact:` line; it fails against the pre-fix duplicate output.
- [ ] `v2/docs/operator-runbook.md` documents deduplicated skip reporting for artifact refusals.
- [ ] `v2/docs/v1-behaviors.md` records the deduplicated skip-output delta.

## Documentation updates

- `v2/docs/operator-runbook.md` — artifact skip deduplication within one cleanup invocation.
- `v2/docs/v1-behaviors.md` — one skip line per canonical artifact identity per invocation.
