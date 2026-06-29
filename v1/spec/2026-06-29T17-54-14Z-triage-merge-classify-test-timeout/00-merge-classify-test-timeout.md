# 00 - Deflake merge classify statuses test

## Problem

`v1/test/triage-command.test.ts` › `triage --mark-ready` › `--merge flag` › `--merge
classifies all spec check statuses correctly` loops twelve CI-status cases (five with
`pollTimeoutMs: 1000` wait paths). Effective per-test bound is **30000ms** via
`setDefaultTimeout(30000)` in preloaded `test/setup-fake-agents.ts` — not Bun's nominal
5000ms or `bunfig.toml` alone. Operator report (~5.25s standalone, flakes under
`bun test --parallel`) may reflect pre-preload or isolated-run context; repro must confirm
whether flakes persist at the 30s bound under full-suite parallel load.

## Decisions

- Effective per-test bound = preload `setDefaultTimeout(30000)` — rules out treating Bun 5000ms or `bunfig.toml` alone as the cap.
- Repro before fix: full-suite `bun test --parallel`, record failure signature (Bun timeout vs assertion) and standalone vs loaded timing — rules out prescribing fix without cause alignment.
- Fix fork after repro:
  - 30s default already suffices → verify and close; no per-test override.
  - Parallel starvation pushes runtime past 30s → explicit override **above 30000ms** or wall-time reduction.
  - Another mechanism → fix matched to recorded failure mode.
- Per-test `{ timeout: N }` only when repro proves need relative to 30s; justify N from measured loaded runtime — rules out `{ timeout: 15000 }`, which tightens under the 30s default.
- Do not serialize the suite or mark the test `sandbox-unrunnable` — rules out runner workarounds that mask correct triage code.
- No `triage --merge` runtime or ready-gate policy changes — rules out coupling a test flake fix to merge behavior.
- No durable docs — test-only; rules out speculative timeout-convention churn before sibling audit pins one.
- Deferred to first consumer: timeout-headroom convention in test docs — pin if sibling audit establishes a repeatable convention.

## Task checklist

- Reproduce under `bun run test` (equivalent to `bun test --parallel`): record failure signature and standalone vs loaded timing on current `main`.
- Apply fix per Decisions fork from repro evidence.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] `v1/test/triage-command.test.ts` › `--merge classifies all spec check statuses correctly` passes under `bun run test`.
- [ ] `v1/test/triage-command.test.ts` › `--merge classifies all spec check statuses correctly` stays green with unchanged assertions (green merge, red refusal, pending `pollCount >= 1`).
- [ ] `bun run typecheck` passes.

## Documentation updates

None (test-only).
