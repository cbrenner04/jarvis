---
name: run-list-dimension-filters
---

# `run list` filters by project, branch, spec, and status

Operators need to narrow history beyond time: find runs for one project, branch, spec path, or
terminal status without scanning the full `--since` result.

## Decisions

- Add `--project`, `--branch`, `--spec`, and `--status` to `jarvis run list`; rules out new persistence or indexes — filters use existing `project`, `branch`, `spec_path`, and `status` columns.
- `--project`, `--branch`, and `--spec` match exactly (case-sensitive); rules out prefix or substring match.
- `--status` accepts one terminal-status enum value; rules out repeat flags or comma lists.
- Invalid `--status` exits with a named error; rules out silent ignore.
- Filters compose conjunctively with each other and with `--since`; rules out OR semantics across flags.
- Filtered queries bypass `LIST_TERMINAL_RUN_LIMIT`; rules out re-applying `retainListedRuns` after the store filter.
- Default `jarvis run list` with no flags is unchanged; rules out requiring a filter flag for the live view.
- Output row format is unchanged; rules out a filter-specific layout.

## Acceptance criteria

- [ ] `--project`, `--branch`, `--spec`, and `--status` each filter correctly and compose with each other and with `--since`.
- [ ] `daemon-terminal-run-retention.test.ts` stays green.
- [ ] IDs returned by dimension-filtered queries work with `jarvis run log` and `jarvis tui log`.
- [ ] `run-list-dimension-filters.test.ts` asserts at least two dimension filters and composition; it fails against baseline.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — dimension filter examples.
- `v2/docs/write-behavior.md` — `run list` dimension flags.
- `v2/docs/v1-behaviors.md` — record dimension filter flags.

## Prerequisites

- `jarvis run list --since` returns terminal runs outside the fifty-newest retention window.
- Filtered queries without `--limit` apply the documented default cap (`run-list-query-limit-cap`).
