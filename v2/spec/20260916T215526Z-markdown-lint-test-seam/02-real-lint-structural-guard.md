# 02 — Real-lint structural guard

Prevent regression: unit-slice tests must not reach the real markdownlint runner.

## Decisions

- Guard is a structural test over test-file sources (unit slice as the test runner scripts define it) flagging calls into the lint entry points without an injected runner, with an explicit allowlist — rules out a runtime spawn trap that only fires on executed paths.
- Deferred to first consumer: exact detection heuristic (import scan vs call-site scan) — pin when implementing against the post-00/01 tree.

## Acceptance criteria

- [x] A structural test fails when a file outside the integration slice reaches the real lint runner, proven by a fixture violation it rejects.
- [x] Test count per slice is unchanged or higher versus the merge base.
- [x] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — the guard and how to satisfy it.
