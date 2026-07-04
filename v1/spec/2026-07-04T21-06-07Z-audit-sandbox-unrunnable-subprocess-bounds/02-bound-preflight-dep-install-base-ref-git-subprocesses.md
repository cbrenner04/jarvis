# Bound preflight, dep-install, and base-ref-test-runner git subprocesses

## Problem

`v1/src/modes/patch/preflight.ts`, `dep-install.ts`, and
`base-ref-test-runner.ts` shell out to real `git` with no timeout, including
`git ls-remote` calls in `preflight.ts` that hit the network — the highest
hang-risk call sites in patch mode. `run.sandbox-unrunnable.test.ts` is
watchdog/`FakeAgent`-scoped and does not currently exercise these git call
sites with a stalled subprocess — there is no existing stall-regression
coverage here, only real hang risk if any of these calls wedges.

## Decisions

- Reuse the shared bounded-git-subprocess helper from subspec 00 — rules out a third bespoke timeout constant.
- Bound every real `git` subprocess in `preflight.ts`, `dep-install.ts`, and `base-ref-test-runner.ts`, including `git worktree add`/`remove` in `base-ref-test-runner.ts` — rules out treating worktree operations as exempt because they're less common.
- Add one new stall regression test for `readRemoteHeadBranch`'s `git ls-remote` in `preflight.ts` (the network-facing call, highest real-world stall risk) rather than one per call site, placed in whichever suite can actually reach that call site — rules out presupposing `run.sandbox-unrunnable.test.ts` as the landing spot without confirming it reaches `preflight.ts`.
- If placement requires hang-fixture tracking (`beginHangFixtureTracking`/`reapActiveHangFixtures`) in a suite that lacks it, add that pair there, mirroring subspec 00's treatment of `subspec.sandbox-unrunnable.test.ts` — rules out a stall test that leaks its own git-shim child process untracked.
- If wiring a real-subprocess stall test through an existing suite proves impractical for the `git ls-remote` call site, fall back to a smaller targeted unit-level test invoking `readRemoteHeadBranch` directly with a `git` shim on `PATH`, or bound-only with the reasoning recorded in the doc update — rules out blocking the subspec on an assumed suite fit that turns out false during implementation.
- Leave the `sh -c installCommand` shell-out in `dep-install.ts` out of scope — it runs an operator-configured install command, not a `git` subprocess, and the intent scopes this audit to git subprocesses and hang fixtures.

## Task checklist

- [ ] Apply the shared helper's timeout+kill options to every `execFileSync("git", ...)` call in `preflight.ts`, `dep-install.ts`, and `base-ref-test-runner.ts`.
- [ ] Add a stalled-`git ls-remote` regression test (via a `git` shim on `PATH`, mirroring `shrink.sandbox-unrunnable.test.ts`) in the suite that can reach `readRemoteHeadBranch` (adding hang-fixture tracking there first if missing), or fall back per the decisions above if no suite reaches it.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] Every real `git` subprocess `preflight.ts`, `dep-install.ts`, and `base-ref-test-runner.ts` spawn is bounded by the shared timeout+`SIGKILL` helper, so a wedged or unreachable-remote `git` call cannot hang any of these paths past that bound.
- [ ] A stalled `git ls-remote` in `preflight.ts` fails the invocation under test within the bound instead of hanging, and any hang-fixture child it started is reaped — either via a new stall test in the suite that reaches the call site, or via the documented bound-only fallback if no suite reaches it.
- [ ] Existing `run.sandbox-unrunnable.test.ts` cases stay green after the bound is applied (behavior unchanged for non-stalled calls).
- [ ] `v2/docs/v1-behaviors.md` records that `preflight.ts`, `dep-install.ts`, and `base-ref-test-runner.ts` git subprocesses are bounded, closing out the sandbox-unrunnable subprocess audit across patch mode.

## Documentation updates

- `v2/docs/v1-behaviors.md` — extend the bounded-git-subprocess entry to cover `preflight.ts`, `dep-install.ts`, and `base-ref-test-runner.ts`, and mark the patch-mode git-subprocess audit complete.
