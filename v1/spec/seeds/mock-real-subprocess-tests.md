---
name: mock-real-subprocess-tests
---

# Stop spawning real git/gh subprocesses in most tests; mock instead

## Problem

24 `*.sandbox-unrunnable.test.ts` files (v1 + v2) spawn real `git`/`gh`
subprocesses against real temp-dir repos. Session of 2026-07-04/05 spent
hours chasing CI-only failures in this suite: the same tests pass 100% of
the time in local isolation but fail on GitHub's Ubuntu runners with
git-commit calls hanging for the *full* configured subprocess timeout
(`GIT_SUBPROCESS_OPTS`), and the observed hang duration scales with that
timeout (20s/40s/60s across different runs) rather than showing organic
jitter — evidence of a deterministic hang (likely GPG-signing fallback or
PATH/env leakage between tests), not "GitHub is slow." Root cause was not
pinned down; chasing it further was not worth the time.

This is a design problem, not just a flake: `jarvis` is a scripting harness
around `git`/`gh` CLI calls. The overwhelming majority of that logic is
"build these argv, run them, parse this output, react to this exit code" —
entirely testable by mocking the subprocess boundary (`execFileSync`,
`spawnSync`, `gh` calls) and asserting on argv/stdout/stderr/exit-code
without ever touching a real filesystem git repo or the network. Any test
run that takes more than a couple of minutes is effectively useless for a
scripting tool like this.

## Scope (for plan → run)

**Spec:** `v1/spec/2026-07-05T05-26-04Z-mock-real-subprocess-tests/` (consolidated;
supersedes the 17 fan-out ready intents and the 3-subspec boundary-only plan).

- Introduce a mockable subprocess boundary (or reuse the sandbox's `execFileSync`/`spawnSync` call sites) so `git`/`gh` invocations can be intercepted in tests without a real subprocess.
- Convert the bulk of `*.sandbox-unrunnable.test.ts` coverage to mocked-subprocess tests (fast, deterministic, no real repos/temp dirs, no network).
- Keep a small, explicitly-justified set of real-subprocess integration tests only where the thing under test *is* real subprocess behavior (e.g., a genuine stall/timeout/kill path, or verifying jarvis correctly shells out with correct args end-to-end) — audit which of the 24 files' individual tests actually need this vs. which are just exercising ordinary git plumbing that could be mocked.
- Target: routine `bun run test:v1`/`test:v2` completes in low single-digit minutes with zero real subprocess spawns for the mockable majority.

## Out of scope

- Root-causing the specific CI-only hang observed this session (GPG-signing fallback / PATH leakage suspicion) — mocking removes the failure mode rather than diagnosing it.
- Changing what jarvis actually does at runtime — this is test-infrastructure only.

## Decisions (seed-level — refine in plan)

- Mocking is the default; real-subprocess tests require explicit justification per file/test, not a blanket carve-out for a whole file just because it currently lives in a `*.sandbox-unrunnable.test.ts`.
- This is a multi-subspec effort (24 files) — plan should probably batch by directory/mode rather than one giant subspec.

## Documentation updates

- `v1/docs/operator-runbook.md` — once landed, drop/narrow the various "known flaky real-subprocess test" gotchas accumulated this session (`ci-shrink-test-hang`, `triage-merge-classify-load-flake`, `v2-test-runner-unbounded-spawn`) that this work should make moot.
