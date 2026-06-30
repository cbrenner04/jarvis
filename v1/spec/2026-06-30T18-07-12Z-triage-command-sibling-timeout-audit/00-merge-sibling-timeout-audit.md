# 00 - Audit and bump marginal `--merge flag` test timeouts

## Problem

Sibling subprocess- or poll-heavy cases under `describe("--merge flag")` in
`v1/test/triage-command.test.ts` may sit within ~1.5× of the effective per-test
bound (`setDefaultTimeout(30000)` in preloaded `test/setup-fake-agents.ts`) and
flake under full-suite parallel load. Prior work closed
`--merge classifies all spec check statuses correctly`; remaining eligible cases
are unaudited.

## Decisions

- Audit scope = `describe("--merge flag")` in `v1/test/triage-command.test.ts` only — rules out other describes and files.
- Exclude `--merge classifies all spec check statuses correctly` — rules out re-auditing the prior spec's target.
- Eligible case = explicit poll config (`pollIntervalMs` / `pollTimeoutMs`) or recovery-probe path (`runMergeFlakeRecovery`, `runRecoveryProbeWithExec`, multi-probe refusal helpers) — rules out auditing every `setupMergeWorktree` git fixture.
- Effective per-test bound = preload `setDefaultTimeout(30000)` — rules out Bun 5s or `bunfig.toml` alone.
- Marginal = standalone wall time ≥ effective bound ÷ 1.5 (~20000ms at 30s default) — rules out ad-hoc thresholds.
- Bump only marginal cases via per-test `{ timeout: N }` with N justified from measured loaded runtime and headroom above standalone — rules out global default raises and overrides below the 30s default.
- Cases well below marginal threshold stay unchanged — rules out blanket inflation.
- No suite serialization or `sandbox-unrunnable` — rules out runner workarounds.
- No `triage --merge` runtime or ready-gate policy changes — rules out coupling test flakes to product behavior.
- Close with an **Outcome** section: audited inventory, standalone vs loaded timings, bumps applied or explicit none — rules out checkbox-only closure.
- Deferred to first consumer: durable timeout-headroom convention — pin in `test/setup-fake-agents.ts` or `v1/docs/test-coverage.md` only if audit establishes a repeatable convention.

## Task checklist

- Seed inventory (confirm eligibility):
  - Poll: `--merge on plan worktree CI poll timeout uses plan PR refusal class`, `--merge with pending CI checks waits`, `--merge with poll timeout refuses to merge`.
  - Recovery/probe: `--merge recovers on test flake when HEAD-sha CI green and serial probe passes`, `--merge recovers with targeted file probe when serial probe stays red`, `--merge refuses recovery on FixCommandError even when HEAD-sha CI is green`, `--merge refuses recovery on generic Error with test-like message`, `--merge refuses recovery when HEAD-sha CI is not green`, `--merge refuses recovery on deadline exceeded or missing harness test markers`, `--merge refuses recovery when probe 1 red and extraction yields zero paths`, `--merge refuses recovery when probes stay red`, `--merge refuses recovery when probe exits with signal or timeout code`, `--merge refuses recovery when default probe runner hits execFileSync signal kill (no probe 2)`.
- For each eligible case: measure standalone runtime (isolated file run) and loaded runtime under `bun run test`; record vs effective bound.
- Apply per-test `{ timeout: N }` only to marginal cases; justify N from loaded measurement.
- Run `bun run typecheck` and `bun run test`.
- Write **Outcome** with inventory, timings, and bump table (or none-needed rationale).

## Acceptance criteria

- [ ] `bun run test` passes under the full-suite parallel gate.
- [ ] `bun run typecheck` passes.
- [ ] `v1/test/triage-command.test.ts` › `--merge classifies all spec check statuses correctly` stays green with unchanged assertions.
- [ ] Every eligible `--merge flag` case either has a per-test `{ timeout: N }` override recorded in **Outcome**, or **Outcome** documents standalone runtime below the marginal threshold with no override.
- [ ] Audited cases with applied overrides pass under `bun run test` with unchanged assertions.

## Documentation updates

None unless audit establishes a repeatable headroom convention — then add one terse note where test timeout conventions live (`test/setup-fake-agents.ts` comment block or `v1/docs/test-coverage.md`), not both.
