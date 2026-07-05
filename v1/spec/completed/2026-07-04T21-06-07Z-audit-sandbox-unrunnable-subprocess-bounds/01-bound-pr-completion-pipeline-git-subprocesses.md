# Bound pr and completion-pipeline git subprocesses

## Problem

`v1/src/modes/patch/pr.ts` and `v1/src/modes/patch/completion-pipeline.ts` shell
out to real `git` (and `gh`) with no timeout. Neither `pr.sandbox-unrunnable.test.ts`
nor `run.sandbox-unrunnable.test.ts` — which is watchdog/`FakeAgent`-scoped and
has no references to these modules or to `force-with-lease` — currently
exercises these git call sites with a stalled subprocess. There is no existing
stall-regression coverage here, the same gap `shrink.ts` had before its fix.

## Decisions

- Reuse the shared bounded-git-subprocess helper from the prior subspec — rules out a second bespoke timeout constant.
- Bound every real `git` subprocess in `pr.ts` and `completion-pipeline.ts`, including the `git push --force-with-lease` in `completion-pipeline.ts` — rules out leaving the force-push path (the one most likely to wedge on a stalled remote) unbounded.
- Leave `gh` subprocess calls (`gh pr view`, `gh pr ready`) out of this subspec's bound — rules out expanding the "git subprocess" audit into a `gh`-specific timeout policy the intent didn't ask for; note this as a residual gap in docs rather than silently dropping it.
- Add one new stall regression test covering the `git push --force-with-lease` path in `completion-pipeline.ts`, placed in whichever suite can actually reach that call site (likely `pr.sandbox-unrunnable.test.ts`, not the unrelated `run.sandbox-unrunnable.test.ts`) — rules out a test per call site and rules out presupposing a file the call site isn't reachable from.
- If placement lands in `pr.sandbox-unrunnable.test.ts`, add the `beginHangFixtureTracking`/`reapActiveHangFixtures` `beforeEach`/`afterEach` pair there (it has only `mkdtempSync`/`rmSync` today), mirroring subspec 00's treatment of `subspec.sandbox-unrunnable.test.ts` — rules out a stall test that leaks its own git-shim child process untracked.
- If wiring a real-subprocess stall test through an existing suite proves impractical for the force-with-lease call site, fall back to a smaller targeted unit-level test invoking the function directly with a `git` shim on `PATH`, or bound-only with the reasoning recorded in the doc update — rules out blocking the subspec on an assumed suite fit that turns out false during implementation.

## Task checklist

- [x] Apply the shared helper's timeout+kill options to every `execFileSync("git", ...)` call in `pr.ts`.
- [x] Apply the shared helper's timeout+kill options to every `execFileSync("git", ...)` call in `completion-pipeline.ts`.
- [x] Add a stalled-`git push --force-with-lease` regression test in the suite that can reach the call site (adding hang-fixture tracking there first if missing), or fall back per the decisions above if no suite reaches it.
- [x] Update the durable docs listed below, including the `gh`-calls-unbounded residual note and, if applicable, the bound-only fallback rationale.

## Acceptance criteria

- [x] Every real `git` subprocess `pr.ts` and `completion-pipeline.ts` spawn is bounded by the shared timeout+`SIGKILL` helper, so a wedged `git` call cannot hang either path past that bound.
- [x] A stalled `git push --force-with-lease` fails the invocation under test within the bound instead of hanging, and any hang-fixture child it started is reaped — either via a new stall test in the suite that reaches the call site, or via the documented bound-only fallback if no suite reaches it.
- [x] `pr.test.ts`, `pr.sandbox-unrunnable.test.ts`, and existing `run.sandbox-unrunnable.test.ts` cases stay green after the bound is applied (behavior unchanged for non-stalled calls).
- [x] `v2/docs/v1-behaviors.md` records that `pr.ts` and `completion-pipeline.ts` git subprocesses are bounded, and that `gh` subprocess calls in these files remain unbounded (residual, out of this audit's scope).

## Documentation updates

- `v2/docs/v1-behaviors.md` — extend the bounded-git-subprocess entry to cover `pr.ts` and `completion-pipeline.ts`, and note the `gh`-calls residual gap.
