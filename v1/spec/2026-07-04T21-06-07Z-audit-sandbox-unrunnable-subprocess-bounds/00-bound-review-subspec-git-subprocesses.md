# Bound review and subspec git subprocesses

## Problem

`v1/src/modes/patch/review.ts` and `v1/src/modes/patch/subspec.ts` shell out to
real `git` with no timeout, the same unbounded pattern `shrink.ts` had before
its fix. `review.sandbox-unrunnable.test.ts` and `subspec.sandbox-unrunnable.test.ts`
exercise these paths with real subprocesses, so a wedged `git` call can hang
either suite (and the CI `Test` job) indefinitely.

## Decisions

- Extract the shrink-path bounded-git pattern (`GIT_SUBPROCESS_OPTS`: timeout + `SIGKILL`) into a shared helper reused by this and later subspecs — rules out redefining the same constant per file.
- `shrink.ts` adopts the shared helper in this subspec instead of keeping its private copy — rules out two divergent bounded-git constants living side by side.
- Bound every real `git` subprocess in `review.ts` and `subspec.ts` — rules out leaving a subset unbounded because it "looked" fast.
- Add one stall regression test per file (matching the shrink file's `writeIdleHangScript`-as-`git`-shim pattern) at the highest-risk call site (a commit/push in each) rather than one per call site — rules out one stall test per call site, which would just restate the same bound repeatedly.
- `subspec.sandbox-unrunnable.test.ts` adopts the `beginHangFixtureTracking`/`reapActiveHangFixtures` `beforeEach`/`afterEach` pair (it has none today) since its new stall test spawns a hang-script fixture — rules out a stall test that leaks its own git-shim child process.

## Task checklist

- [ ] Add a shared bounded-git-subprocess helper under `v1/src/modes/patch/` and switch `shrink.ts` to import it.
- [ ] Apply the helper's timeout+kill options to every `execFileSync("git", ...)` call in `review.ts`.
- [ ] Apply the helper's timeout+kill options to every `execFileSync("git", ...)` call in `subspec.ts`.
- [ ] Add hang-fixture tracking (`beforeEach`/`afterEach`) to `subspec.sandbox-unrunnable.test.ts`.
- [ ] Add one stalled-git regression test to `review.sandbox-unrunnable.test.ts` and one to `subspec.sandbox-unrunnable.test.ts`, each asserting a bounded failure and a reaped fixture.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [x] Every real `git` subprocess `review.ts` and `subspec.ts` spawn is bounded by the shared timeout+`SIGKILL` helper, so a wedged `git` call cannot hang either path past that bound.
- [x] A stalled real `git` subprocess on the `review.ts` path fails the invocation under test within the bound instead of hanging, and any hang-fixture child it started is reaped.
- [x] A stalled real `git` subprocess on the `subspec.ts` path fails the invocation under test within the bound instead of hanging, and any hang-fixture child it started is reaped.
- [x] `shrink.test.ts` and `shrink.sandbox-unrunnable.test.ts` stay green after `shrink.ts` switches to the shared helper (behavior unchanged by the extraction).
- [x] `v2/docs/v1-behaviors.md` records that `review.ts` and `subspec.ts` git subprocesses are now bounded the same way as `shrink.ts`.

## Documentation updates

- `v2/docs/v1-behaviors.md` — extend the existing shrink bounded-git-subprocess entry to cover `review.ts` and `subspec.ts`, naming the shared helper.
