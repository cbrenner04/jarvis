# Workflow attached entry-terminal wait contract

On `main`, `v2/src/commands/workflow.ts` already prints the admitted **entry** run ID and issues one
`waitForRunCompletion` on that ID; daemon entry `wait` already awaits workflow rollup
(`v2/docs/workflow-runner.md` § “Workflow run id status”). The gap is **unguarded contract and
stale docs**, not broken attach semantics: `workflow.test.ts` mocks a single `wait` frame so a
client that exited after the first constituent row would still pass, and `v2/docs/operator-runbook.md`
(Known gotchas, ~line 906) still claims attach “returns on its *first* constituent run.” This
subspec pins the attach contract with a multi-row regression and corrects that documentation.

Ships in the same spec/PR as [00](./00-workflow-detach-after-admission.md) per intent; does not
require `--detach` to implement or verify.

## Prerequisites

- Workflow launch prints the workflow entry run ID on stdout immediately after daemon admission
  (already on `main`).
- Daemon rollup on entry `wait`/`list` reports the workflow entry run's terminal outcome (already
  on `main`).

## Decisions

- Do not change attach CLI wait targeting or daemon rollup — work is regression coverage and doc
  truth only.
- Attach issues one daemon `wait` on the admitted **entry** run ID and blocks until that wait
  returns the workflow-entry rollup — rules out waiting on a constituent step run ID or exiting
  after the first constituent terminal boundary (documents existing behavior).
- Attach final stdout stays run ID line then one minified wait JSON line; exit code uses existing
  `exitCodeForWaitResult` on the entry wait payload.
- Multi-row attached regression uses a daemon fixture that can hold a **deterministic mid-state**
  (second constituent non-terminal, entry non-terminal) and a **deterministic, non-timing-based**
  observation that the CLI subprocess is still alive at that mid-state — rules out flaky sleeps or
  vacuous “has not exited” checks without staging.
- `v2/docs/workflow-runner.md` “first step's run id” wording is **out of scope**: accurate for the
  daemon-internal function and rollup is documented in the following section; optional “entry run id”
  alignment is not required for this change.

## Work

- Add a multi-row workflow daemon fixture with a deterministic mid-state gate and a subprocess
  liveness observation point.
- Extend `workflow.test.ts` with an attached regression driven through a real CLI subprocess (no
  mocked early client exit).
- Correct or remove the stale Known-gotchas bullet in `v2/docs/operator-runbook.md` (~line 906).

## Acceptance criteria

- [ ] `workflow.test.ts` regression `attached run workflow waits through a multi-step workflow until the entry run is terminal` uses the staged multi-row fixture and a real attached CLI subprocess; at the fixture's deterministic mid-state (second constituent non-terminal, entry non-terminal) observes the subprocess still alive via a deterministic hook (not timing); exits only once the entry run is terminal; **pins** entry-terminal client `wait` — baseline `main` already satisfies it; the test must fail when client `wait` is omitted or retargeted at a constituent run ID (mutation), not when run unchanged against pre-fix code.
- [ ] The same regression asserts final stdout minified JSON and exit code match the workflow entry terminal rollup, not an intermediate constituent row's wait payload.
- [ ] Omitting client `wait` when `--detach` is absent (or retargeting `wait` at a constituent run ID) fails `attached run workflow waits through a multi-step workflow until the entry run is terminal`.

## Documentation updates

- `v2/docs/write-behavior.md` — attached wait semantics (exit `0` on attach means the workflow
  finished, not merely the first step); complements detach/attach mode prose from [00](./00-workflow-detach-after-admission.md).
- `v2/docs/operator-runbook.md` — correct or remove the Known-gotchas bullet (~line 906) that attach
  returns on the first constituent run.
- `v2/docs/v1-behaviors.md` — attached workflow waits through entry-terminal rollup.
