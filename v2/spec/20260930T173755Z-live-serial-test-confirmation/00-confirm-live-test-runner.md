# 00 — Live serial confirmation runner

## Problem

Serial failure confirmation must exercise the same live test roster as `bun run test` / `aggregateTestFiles()`, without bare `bun test` discovery that pulls in frozen `v1/test/**`, and without a `--parallel` pool.

## Decisions

- Roster parity comes from reusing `aggregateTestFiles()` (`scripts/run-tests.ts`) via an exported `confirmLiveTestFiles()` that flattens agent then integration in the same order `run-tests.ts` runs them — rules out a separate walk or bare `bun test` discovery that could include `v1/`.
- Every file runs as `bun test <relative-path>` with no `--parallel` on any spawn; v2 files may reuse `runV2TestFiles` only with explicit concurrency `1`, and shared/harness files must not use `run-shared-tests.ts`'s pooled `--parallel` agent path — rules out delegating confirmation to `bun test` or `run-shared-tests.ts` as-is.
- `package.json` exposes `test:confirm:live` → `bun run scripts/run-confirm-live-tests.ts` (or equivalent main module name) — rules out documenting a hand-rolled `bun test` incantation as the contract.
- Ready-gate serial retry in `scripts/ready.ts` is out of scope here — rules out expanding this subspec into harness ready-step changes (deferred to a separate intent if still needed).
- Tests assert at least one on-disk frozen path under `v1/test/**` (e.g. `v1/test/smoke.test.ts`, reachable on main via bare `bun test` discovery) is absent from `confirmLiveTestFiles()` — rules out parity-only guards that miss rediscovered `v1/` if roster wiring regresses.
- Spawn-argument tests cover every confirmation spawn site (v2 agent and integration, shared/harness per-file, root `scripts/*.test.ts` roster files) — rules out guarding only the `package.json` script entry or a single helper.

## Tasks

- [ ] Add `scripts/run-confirm-live-tests.ts` with `confirmLiveTestFiles()`, main entry that runs the roster serially, and fail-fast exit semantics aligned with `run-tests.ts` (agent phase then integration).
- [ ] Add `scripts/run-confirm-live-tests.test.ts` with roster parity, positive `v1/test/**` absence guard, and per-spawn-path `--parallel` absence guards for v2, shared/harness, and `scripts/` roster files.
- [ ] Add `test:confirm:live` to root `package.json`.

## Acceptance criteria

- [ ] `scripts/run-confirm-live-tests.test.ts` test `confirmLiveTestFiles matches aggregateTestFiles` fails against the pre-fix repo.
- [ ] `scripts/run-confirm-live-tests.test.ts` test `confirmLiveTestFiles excludes on-disk v1/test paths` asserts known frozen paths such as `v1/test/smoke.test.ts` are absent; fails against the pre-fix repo (reachable on main via frozen `v1/test/**` and bare `bun test` discovery).
- [ ] `scripts/run-confirm-live-tests.test.ts` tests that every confirmation spawn path omits `--parallel` (v2, shared/harness, `scripts/` roster files) fail against the pre-fix repo.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- None (runner contract is named in subspec 02).
