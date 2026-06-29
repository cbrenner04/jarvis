# 00 - Per-test timeout for merge classify statuses test

## Problem

`v1/test/triage-command.test.ts` › `triage --mark-ready` › `--merge flag` › `--merge
classifies all spec check statuses correctly` loops twelve CI-status cases (five with
`pollTimeoutMs: 1000` wait paths). Operator report: ~5.25s standalone; flakes under full-suite
`bun test --parallel`, redding the ready gate on correct triage code.

## Decisions

- Add `{ timeout: 15000 }` on this test only — rules out leaving a poll-heavy multi-case loop without explicit headroom above its standalone runtime.
- Do not serialize the suite or mark the test `sandbox-unrunnable` — rules out runner workarounds that mask correct triage code.
- No `triage --merge` runtime or ready-gate policy changes — rules out coupling a test flake fix to merge behavior.
- No durable docs — test-only; rules out speculative timeout-convention churn before sibling audit pins one.
- Deferred to first consumer: timeout-headroom convention in test docs — pin if sibling audit establishes a repeatable convention.

## Task checklist

- Add `{ timeout: 15000 }` to `--merge classifies all spec check statuses correctly` in `v1/test/triage-command.test.ts`.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] `--merge classifies all spec check statuses correctly` in `v1/test/triage-command.test.ts` passes under full-suite `bun test --parallel`.
- [ ] The same test still classifies all twelve check statuses (green merge, pending wait, red refusal) with unchanged assertions.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

None (test-only).
