# 00 - Audit and bump marginal `--merge flag` test timeouts

## Problem

Sibling subprocess- or poll-heavy cases under `describe("--merge flag")` in
`v1/test/triage-command.test.ts` may sit within ~1.5× of the effective per-test
bound (`setDefaultTimeout(30000)` in preloaded `test/setup-fake-agents.ts`) and
flake under full-suite parallel load. Prior work closed
`--merge classifies all spec check statuses correctly`; remaining eligible cases
are unaudited.

## Prerequisites

- `v1/test/triage-command.test.ts` › `--merge classifies all spec check statuses correctly` passes under `bun run test` on the implementation branch before audit work — rules out assuming a durable classify Outcome exists.

## Decisions

- Audit scope = `describe("--merge flag")` in `v1/test/triage-command.test.ts` only — rules out other describes and files.
- Exclude `--merge classifies all spec check statuses correctly` — rules out re-auditing the prior spec's target.
- Eligible case = explicit poll config (`pollIntervalMs` / `pollTimeoutMs`) or recovery-probe execution path (`runMergeFlakeRecovery`, `runRecoveryProbeWithExec`, multi-probe refusal helpers) — rules out auditing every `setupMergeWorktree` git fixture or generic fixture subprocess cost.
- Ineligible: synchronous unit-style cases in the describe with no poll/recovery wall time; `--merge with passing gate runs no recovery probes` (recovery helper wired but zero probe execution) — rules out fixture-only or zero-probe paths.
- Effective per-test bound = preload `setDefaultTimeout(30000)` — rules out Bun 5s or `bunfig.toml` alone.
- Marginal trigger = standalone total `test()` wall time (including inner loops) ≥ effective bound ÷ 1.5 (~20000ms at 30s default) — rules out per-iteration timing and load-only marginality.
- Standalone measurement = filtered run of the exact `test()` name (not whole-file isolation) — rules out ambiguous “isolated file run”.
- When standalone ≥ marginal threshold: ≥2 standalone samples, or document single-sample caveat in **Outcome** — rules out unlabeled one-shot marginal calls.
- Loaded timing justifies `N` when an override is applied; not a second bump trigger independent of standalone marginality — rules out load-only bumps.
- Per-case closure (one of three): (a) below marginal threshold — no override; (b) marginal standalone — `{ timeout: N }` with `N ≥ 30000` justified from loaded runtime and headroom above standalone; (c) marginal standalone, loaded within 30s default — no override, **Outcome** records both timings and explicit “no override” rationale — rules out AC fork where marginal standalone cases fit neither “below threshold” nor “needs N > 30000”.
- Bump only via per-test `{ timeout: N }` — rules out global default raises, overrides below 30s, suite serialization, and `sandbox-unrunnable`.
- No `triage --merge` runtime or ready-gate policy changes — rules out coupling test flakes to product behavior.
- Seed inventory is illustrative; **Outcome** must cover every `describe("--merge flag")` case matching eligibility after confirm (including renames) — rules out partial closure.
- **Outcome** must mirror `triage-command.test.ts`: every bump row has a matching `{ timeout: N }` on that `test()`; zero-bump audit states explicitly that no overrides were added — rules out Outcome-only prose.
- If `bun run test` cannot complete at least one green loaded run during the audit, append `## Blocker` to this subspec — rules out speculative overrides without a green full-suite pass.
- Repeatable convention worth documenting = ≥2 bumped cases sharing the same standalone÷1.5 headroom rule — rules out one-off override becoming durable guidance.
- Deferred to first consumer: durable timeout-headroom convention — pin in `test/setup-fake-agents.ts` comment **or** `v1/docs/test-coverage.md` only if refinement above is met, not both.

## Task checklist

- Confirm prerequisite: `--merge classifies all spec check statuses correctly` green under `bun run test`.
- Seed inventory (confirm eligibility; illustrative):
  - Poll: `--merge on plan worktree CI poll timeout uses plan PR refusal class`, `--merge with pending CI checks waits`, `--merge with poll timeout refuses to merge`.
  - Recovery/probe: `--merge recovers on test flake when HEAD-sha CI green and serial probe passes`, `--merge recovers with targeted file probe when serial probe stays red`, `--merge refuses recovery on FixCommandError even when HEAD-sha CI is green`, `--merge refuses recovery on generic Error with test-like message`, `--merge refuses recovery when HEAD-sha CI is not green`, `--merge refuses recovery on deadline exceeded or missing harness test markers`, `--merge refuses recovery when probe 1 red and extraction yields zero paths`, `--merge refuses recovery when probes stay red`, `--merge refuses recovery when probe exits with signal or timeout code`, `--merge refuses recovery when default probe runner hits execFileSync signal kill (no probe 2)`.
- Enumerate every `describe("--merge flag")` case; confirm eligibility; add any seed misses to inventory.
- For each eligible case: measure standalone via filtered run of exact `test()` name (≥2 samples when marginal); measure loaded runtime under `bun run test`; record vs effective bound.
- Apply per-test `{ timeout: N }` only per closure path (b); justify `N` from loaded measurement when applied.
- Run `bun run typecheck` and `bun run test`.
- Append **Outcome** (inventory, timings, bump table or none-needed rationale; explicit no-override rows for paths (a) and (c)) **before** ticking acceptance criteria.

## Acceptance criteria

- [ ] `bun run test` passes under the full-suite parallel gate.
- [ ] `bun run typecheck` passes.
- [ ] `v1/test/triage-command.test.ts` › `--merge classifies all spec check statuses correctly` stays green with unchanged assertions.
- [ ] Every inventoried eligible case without a `{ timeout: N }` override passes under `bun run test` with unchanged assertions.
- [ ] Every inventoried eligible case with an applied override has a matching `{ timeout: N }` on that `test()` in `v1/test/triage-command.test.ts` and passes under `bun run test` with unchanged assertions.
- [ ] **Outcome** covers every eligible `describe("--merge flag")` case with timings and one closure path: override applied (file matches), below marginal threshold (no override), or marginal standalone with loaded within default (no override, rationale recorded); zero-bump audit states no overrides were added.

## Documentation updates

None unless ≥2 bumped cases share the same standalone÷1.5 headroom rule — then one terse note in `test/setup-fake-agents.ts` comment block **or** `v1/docs/test-coverage.md`, not both.
