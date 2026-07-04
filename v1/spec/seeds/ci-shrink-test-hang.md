---
name: ci-shrink-test-hang
---

# `shrink.sandbox-unrunnable.test.ts` hangs the CI `Test` step

## Problem

Observed 2026-07-04 on PR #989 (`workflow-config-source-validation`): the CI
`Test` step hung indefinitely (>1h, twice in a row) with the last emitted test
file being `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts`. Both hangs
were cancelled by hand; a third rerun of the identical commit passed in 1m39s.
`bun run test` (full suite, sandbox-off) passed locally in ~110s on the same
commit both before and after — the hang is CI-only and transient (~2/3
reproduction rate that session), not a deterministic failure.

This file spawns real git subprocesses via `execSync` (no timeout) — `git
init --bare`, `git commit`, `git push` to a local bare origin — and also pulls
in `IdleHangAgent`/`idle-hang-fixtures` helpers from
`review.sandbox-unrunnable.test.ts`, which deliberately spawn hanging child
processes to test the harness's own idle-watchdog logic. A real subprocess
that isn't reaped (or an `execSync` git call that blocks waiting on an editor,
GPG prompt, or similar under the CI runner's environment) would block the
single-threaded test file synchronously with no timeout, which explains a
whole-job hang rather than a single failing/timed-out test.

No root cause confirmed yet — this seed captures the symptom for triage.

## Scope (for plan → run)

- Reproduce reliably (or characterize the reproduction rate) in a CI-like
  environment.
- Identify which `execSync` call or hang-fixture subprocess is not bounded by
  a timeout / not reliably reaped, and add a bound (timeout + kill) so a stall
  fails the test instead of hanging the job.
- Audit sibling `*.sandbox-unrunnable.test.ts` files for the same
  unbounded-`execSync`-or-fixture-leak pattern.

## Out of scope

- Changing CI's overall job timeout as the fix (a bound at the test level is
  the real fix; a job timeout is just a backstop).
- Any change to the idle-hang fixture helpers' intended behavior for the
  tests they're designed to serve (patch idle-timeout escalation coverage).

## Decisions (seed-level — refine in plan)

- Fix belongs at the test/fixture level (bounded subprocess execution +
  guaranteed reap), not a workaround in the CI workflow YAML.
- If reproduction in a sandboxed/local environment isn't feasible, the plan
  should still land defensive timeouts on the suspect `execSync` calls and
  fixture cleanup, since an unbounded synchronous subprocess call is a latent
  hang regardless of whether this exact incident's trigger is pinned down.

## Documentation updates

- `v1/docs/operator-runbook.md` — note under Known gotchas once fixed (or if
  root-caused as pre-existing/general): "CI Test step can hang on
  `*.sandbox-unrunnable.test.ts` subprocess/fixture stalls; retry the CI run
  before assuming a real failure — see `ci-shrink-test-hang`."

## Prerequisites

None.
