# Bound pr and completion-pipeline git subprocesses

## Problem

`v1/src/modes/patch/pr.ts` and `v1/src/modes/patch/completion-pipeline.ts` shell
out to real `git` (and `gh`) with no timeout. `pr.sandbox-unrunnable.test.ts`
and the completion-pipeline paths in `run.sandbox-unrunnable.test.ts` exercise
these with real subprocesses, so a wedged `git`/`gh` call can hang either
suite indefinitely — the same pattern fixed in `shrink.ts`.

## Decisions

- Reuse the shared bounded-git-subprocess helper from the prior subspec — rules out a second bespoke timeout constant.
- Bound every real `git` subprocess in `pr.ts` and `completion-pipeline.ts`, including the `git push --force-with-lease` in `completion-pipeline.ts` — rules out leaving the force-push path (the one most likely to wedge on a stalled remote) unbounded.
- Leave `gh` subprocess calls (`gh pr view`, `gh pr ready`) out of this subspec's bound — rules out expanding the "git subprocess" audit into a `gh`-specific timeout policy the intent didn't ask for; note this as a residual gap in docs rather than silently dropping it.
- Add one stall regression test covering the `git push --force-with-lease` path in `completion-pipeline.ts` — rules out a test per call site.
- `run.sandbox-unrunnable.test.ts` already tracks hang fixtures; reuse that `beforeEach`/`afterEach` pair for the new stall test — rules out a second tracking id in the same file.

## Task checklist

- [ ] Apply the shared helper's timeout+kill options to every `execFileSync("git", ...)` call in `pr.ts`.
- [ ] Apply the shared helper's timeout+kill options to every `execFileSync("git", ...)` call in `completion-pipeline.ts`.
- [ ] Add a stalled-`git push --force-with-lease` regression test to `run.sandbox-unrunnable.test.ts` (or `pr.sandbox-unrunnable.test.ts` if the push path is more directly reachable from there) asserting bounded failure and fixture reap.
- [ ] Update the durable docs listed below, including the `gh`-calls-unbounded residual note.

## Acceptance criteria

- [ ] Every real `git` subprocess `pr.ts` and `completion-pipeline.ts` spawn is bounded by the shared timeout+`SIGKILL` helper, so a wedged `git` call cannot hang either path past that bound.
- [ ] A stalled `git push --force-with-lease` in `completion-pipeline.ts` fails the invocation under test within the bound instead of hanging, and any hang-fixture child it started is reaped.
- [ ] `pr.test.ts`, `pr.sandbox-unrunnable.test.ts`, and existing `run.sandbox-unrunnable.test.ts` cases stay green after the bound is applied (behavior unchanged for non-stalled calls).
- [ ] `v2/docs/v1-behaviors.md` records that `pr.ts` and `completion-pipeline.ts` git subprocesses are bounded, and that `gh` subprocess calls in these files remain unbounded (residual, out of this audit's scope).

## Documentation updates

- `v2/docs/v1-behaviors.md` — extend the bounded-git-subprocess entry to cover `pr.ts` and `completion-pipeline.ts`, and note the `gh`-calls residual gap.
