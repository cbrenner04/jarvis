# CI is green while the ready gate is unpassable — they run different suites

`main` was red on the operator's machine for an unknown number of sessions while every PR's CI
showed green. Two independent defects, one shared cause: **PR CI and `bun run ready` do not run the
same tests, so CI cannot protect the gate that actually blocks every run.**

Observed 2026-07-16 on `main` at `2170d232`, hand-recovered in #1644. This is the mechanism behind
"gate trust is broken" in `.scratch/backlog-consolidation-plan.md` — the reason every implement run
needs a human finisher is not mysterious. The gate could not pass.

## Problem

**1. The aggregate suite's per-file timeout is smaller than the slowest file.** `bun run ready` runs
`bun run test` — the *aggregate* suite (`scripts/run-tests.ts`), which routes every agent-mode file
through `runV2TestFiles` and its `PER_FILE_TIMEOUT_MS`. That constant was 60s
(`scripts/run-v2-tests.ts:4`), introduced for v2 files in #1061 and extended over the aggregate —
and therefore over v1 files — by #1158. `v1/test/run.test.ts` is 9467 lines / 242 tests and takes
**119s in isolation**. Reproduced in exactly 60.0s:

```text
$ bun .scratch/probe.ts     # runV2TestFiles("agent", ["v1/test/run.test.ts"], undefined, "")
error: "agent" test run timed out or was killed on file "v1/test/run.test.ts"
exit: 1
real  1m0.023s
```

CI never runs the aggregate: `scripts/ci-test-scope.ts` scopes to `test:v1` / `test:v2` by changed
path, and `test:v1 agent` is `bun test --parallel <files>` with **no per-file timeout at all**. So
the exact suite the gate depends on is the one suite CI never executes.

PR #1644 raised the constant to 180s to restore a passable gate. That is a band-aid on the symptom:
the real questions are why the aggregate's budget is sized for v2 files while covering v1's, whether
a 119s / 242-test / 9467-line file should be split, and why a per-file timeout exists in the
aggregate but not in the scoped suites CI runs.

**2. A test that passes on Linux CI and fails deterministically on macOS.**
`v2/src/daemon/daemon-workflow-start.test.ts` ("JSON-round-tripped review profiles rehydrate
renderers for every domain and behavior", added by #1633) waits on **step 0's** run id and then
sleeps 25ms — but the review steps run under their own run ids, so the sleep is a race against them.
It is the same wrong assumption the operator runbook already documents as a gotcha ("A terminal run
id does not mean the workflow is done"), encoded into a test.

Green on Linux CI, red 3/3 on macOS. Bisected: green at `74be9092`, red at its own merge commit
`f153d9a2` (#1633). Raising the sleep to 3s makes it pass, which is the proof it is a race and not a
logic error. #1644 replaced the sleep with a bounded poll.

The general form is worse than the instance: **a timing sleep in a daemon test is a coin flip whose
odds depend on the machine**, and CI's odds are not the operator's. `tui-tests-bypass-the-render-path`
is the same family — a test that passes without observing the thing it names.

## Scope

- CI and `bun run ready` verify the same thing, or their divergence is deliberate, documented, and
  cannot silently strand `main` red on the machine where runs execute. A green CI on a PR should mean
  the gate will pass locally.
- No per-file timeout is smaller than the file it bounds. Whatever bounds a hung file must be
  derived from or asserted against the observed worst case, not a constant that drifts out from
  under the suite.
- Daemon/workflow tests wait on an observable condition, not a sleep. A test that would pass or fail
  based on machine speed is a defect regardless of its current colour.

## Decisions

- **The gate is the contract; CI must protect it.** Rules out "CI is green, ship it" — the whole
  incident is that sentence being false for an unknown number of sessions.
- **Prove the divergence, then close it.** Before changing the runners, assert the property: a run of
  the aggregate suite and the scoped CI suites cover the same files. A test asserting the two agree
  is worth more than either fix.
- **Fix the file, not just the budget.** 119s / 242 tests / 9467 lines in one file is the actual
  defect; #1644's 180s only buys room. Splitting `v1/test/run.test.ts` is in scope for this seed.
- **Ban the sleep-as-wait in daemon tests** — a bounded poll on the real condition (as #1644 used) or
  a proper wait on the workflow's terminal state. Consider a lint rule or a shared `waitFor` helper;
  `daemon-workflow-start.test.ts:320` was not the only sleep in that file (see lines 233, 244).

## Out of scope

- The v2 gate's own repair loop (`publication-and-gate-trust`).
- Making the biome rules easier to satisfy.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — that `bun run ready` runs the aggregate suite, not the
  scoped suites CI runs, and what that implies. The existing "CI ≠ `ready`" bullet covers `lint:md`
  only and is therefore incomplete in a way that cost this session.
- `v2/docs/test-writing.md` — no sleeps as waits; poll an observable condition.
- `v2/docs/operator-runbook.md` § Known gotchas — remove the "Every implement run has committed a red
  gate" bullet if this turns out to be its cause.
