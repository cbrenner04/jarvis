# Run list query limit cap

Filtered `jarvis run list` queries can match far more durable rows than the live
fifty-terminal window. Unbounded scans hang the daemon during per-row assembly;
operators also need an explicit row bound.

## Decisions

- A filtered query is any `run list` with at least one of `--since`, `--project`, `--branch`, `--spec`, or `--status`; rules out treating bare `--limit` as a filtered query.
- Default filtered-query cap is **200** newest matching rows when `--limit` is omitted; rules out unbounded filtered scans and reusing the fifty-terminal live retention bound.
- Add `--limit <positive-integer>` to `jarvis run list`; parse at the CLI and pass on the `list` RPC; rules out daemon-side re-parsing of the raw flag string.
- Daemon applies the effective limit (explicit or default 200) after store filters and before per-row assembly; rules out returning the full match set to the CLI for truncation.
- Filtered results are newest-first: keep the first N rows after `created_at DESC, rowid DESC` store order; rules out oldest-first or unspecified order.
- Invalid `--limit` (non-positive, non-integer, or missing value) exits `1` with `invalid_limit` before any `list` RPC; rules out silent ignore.
- Default `jarvis run list` with no flags keeps `retainListedRuns`; bare `--limit` alone does not switch to the filtered default cap; rules out one retention rule for all list paths.
- Daemon treats a `list` request as filtered when any RPC filter field is set (`sinceMs`, and later `project`, `branch`, `specPath`, `status`); rules out inferring filtered from `limit` alone.

## Tasks

- Extend `parseListArgv` / `RUN_LIST_USAGE` for `--limit`; compose with existing `--since` parsing.
- Extend `list` RPC with optional `limit`; document in `daemon-host.md`.
- In `listHandler`, when filtered: apply store filters, slice to explicit `limit` or default 200, then assemble rows; skip `retainListedRuns`.
- Add `v2/src/commands/run-list-query-limit-cap.test.ts` (daemon direct path plus CLI path).
- Document `--limit` and the default cap in `operator-runbook.md`, `write-behavior.md`, and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `--limit` on a filtered query returns at most N newest matching rows.
- [ ] A filtered query without `--limit` returns at most 200 newest matching rows.
- [ ] `daemon-terminal-run-retention.test.ts` stays green.
- [ ] Bare `jarvis run list --limit <n>` keeps today's `retainListedRuns` policy (not the filtered default cap).
- [ ] Invalid `--limit` exits `1` with `invalid_limit` and does not issue a `list` RPC.
- [ ] `run-list-query-limit-cap.test.ts` asserts `--limit` and the default cap on a filtered query; it fails against baseline.
- [ ] Tests fail when the `invalid_limit` guard is inverted: a garbage `--limit` value must not return rows.
- [ ] Tests fail when bare `--limit` is wrongly treated as a filtered query: inverted guard must not apply the default cap to the default list path.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `--limit` and filtered-query default cap (200), with examples.
- `v2/docs/write-behavior.md` — `run list --limit` and the filtered-query default cap.
- `v2/docs/daemon-host.md` — optional `limit` on `list` RPC; filtered queries apply explicit or default cap before row assembly.
- `v2/docs/v1-behaviors.md` — record limit and default-cap behavior.
