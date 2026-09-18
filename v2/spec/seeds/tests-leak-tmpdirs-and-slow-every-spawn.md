---
name: tests-leak-tmpdirs-and-slow-every-spawn
---

# Tests leak `mkdtemp` dirs into the OS tmpdir, slowing every spawn on the machine

## Problem

Many tests create dirs with `mkdtemp`/`mkdtempSync(tmpdir())` and never remove them. Every `bun run test` adds more; nothing reaps them. Once the OS tmpdir holds ~1M entries, anything started from it (stand-in daemons, fake agents) starts in seconds instead of milliseconds, and timing-bound tests fail locally while CI (fresh tmpdir) stays green.

## Evidence

- 2026-09-18: operator `/var/folders/.../T` held ~1,011,000 entries, nearly all jarvis test dirs back to 2026-08-24 (`jarvis-stable-pipeline-decision-*`, `implement-workflow-steps-test-*`, `jarvis-test-fake-agents-*`, `jarvis-cli-test-*`, `review-mutation-*`, `intent-finalize-resume-*`). Dir inode 32 MB; bare `ls` 92 s.
- bun start of a script placed there: 6-13 s, vs 0.014 s in-repo.
- `v2/src/daemon/daemon-dead-socket-reclaim.sandbox-unrunnable.test.ts` writes its stand-in daemon under `mkdtempSync(tmpdir())` (~:60) with a 10_000 ms readiness timeout (:74-77); it failed deterministically on local `main` (`DaemonReadinessTimeoutError`, `daemon-lifecycle.ts:407`) while CI was green, and red-gated a lane's `test:integration:v2`.
- Plausible contributor to seed `daemon-changeover-rebind-test-flakes-under-load` (#4049/#4060).
- Operator did a one-time purge of entries older than 24h; the leak recurs.
- Grep (file-level heuristic: calls `mkdtemp` and has no recursive `rm`/cleanup anywhere) across `v2/`, `shared/`, `scripts/`, `test/`: 42 of 117 `mkdtemp` files, 200 call sites. Top: `shared/invocation/agents.test.ts` (30), `v2/src/execution/workflow-runner-review-standard.test.ts` (19), `v2/src/execution/workflow-runner-debate.test.ts` (13), `v2/src/execution/intent-workflow-steps.test.ts` (10), `v2/src/execution/workflow-runner-review.test.ts` (9). Files that clean up some dirs but not all are not counted.

## Decisions

- One shared test helper (e.g. `makeTestTempDir(prefix)`) creates the dir and registers its removal (`rmSync(dir, { recursive: true, force: true })`) in `afterEach`/`afterAll`. Rules out per-file hand-rolled cleanup, which is what leaked.
- A structural guard, alongside `scripts/guard-*.ts`, fails when a test file calls `mkdtemp`/`mkdtempSync` directly instead of the helper. Rules out relying on review to catch new leaks.
- Spawned stand-in scripts (fake agents, stand-in daemons) are written under the per-test dir, removed afterwards. Rules out shared long-lived script dirs under `tmpdir()`.
- Tests that must hold a dir across a subprocess boundary still use the helper; removal runs after the subprocess exits. No exemption list.
- Migrate all existing leakers in the same change; no reaper of old entries in the harness (operator purge is one-time).

## Acceptance criteria

- [ ] The guard fails on a planted test file that calls `mkdtempSync(tmpdir())` without the helper, naming file and line, and passes on the migrated tree.
- [ ] No test file under `v2/`, `shared/`, `scripts/`, `test/` calls `mkdtemp`/`mkdtempSync` outside the helper.
- [ ] Helper unit test: dir exists during the test and is gone after the registered cleanup runs, including when the test throws.
- [ ] OS tmpdir entry count is unchanged (±0 jarvis-prefixed entries) after a full `bun run test`.
- [ ] `v2/docs/test-writing.md` documents the helper and the guard.
- [ ] `bun run typecheck` and full `bun run test` pass.
