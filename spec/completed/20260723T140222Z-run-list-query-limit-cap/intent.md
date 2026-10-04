---
name: run-list-query-limit-cap
---

# `run list` bounds filtered queries with `--limit` and a default cap

A filtered history query against a large store must not hang the daemon. Operators also need an
explicit row bound when they do not want the full match set.

## Decisions

- A filtered query is any `run list` with at least one of `--since`, `--project`, `--branch`, `--spec`, or `--status`; `--limit` alone keeps `retainListedRuns`; rules out treating bare `--limit` as a history query.
- Add `--limit` to `jarvis run list`; rules out ignoring an explicit limit on filtered queries.
- Filtered query with no `--limit` applies a documented default cap; rules out unbounded filtered scans against the full store.
- Filtered results are newest-first; `--limit` returns the N newest matching rows; rules out oldest-first or unspecified order.
- Invalid `--limit` (non-positive or non-integer) exits with a named error; rules out silent ignore.
- Default `jarvis run list` with no flags keeps today's `retainListedRuns` policy, not the filtered default cap; rules out one retention rule for all list paths.
- Deferred to first consumer: exact default cap value — pin in plan.

## Acceptance criteria

- [ ] `--limit` bounds filtered query results to the requested count.
- [ ] A filtered query without `--limit` applies the documented default cap rather than returning every match.
- [ ] `daemon-terminal-run-retention.test.ts` stays green.
- [ ] `run-list-query-limit-cap.test.ts` asserts `--limit` and the default cap on a filtered query; it fails against baseline.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `--limit` and filtered-query default cap, with examples.
- `v2/docs/write-behavior.md` — `run list --limit` and the filtered-query default cap.
- `v2/docs/v1-behaviors.md` — record limit and default-cap behavior.

## Prerequisites

- `jarvis run list --since` returns terminal runs outside the fifty-newest retention window.
