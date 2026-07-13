# A `blocked` run tells the operator to inspect a spec that says nothing

`jarvis run workflow implement` ended `blocked` / `agent_blocked`, with the operator
action `inspect_spec`. The spec contains no `## Blocker`. There is nothing to inspect,
and no way to know what the agent wanted.

## Problem

Observed 2026-07-13, first successful `implement` launch after the P0 fixes landed.

```
e93a8429…  jarvis  2026-07-12T23-14-44Z-review-step-emits-log-events  blocked  agent_blocked  inspect_spec
```

```json
{"kind":"boundary_committed","outcomeKind":"blocked","runStatus":"blocked"}
{"kind":"loop_finished","loopOutcomeKind":"blocked","iterationsConsumed":1,"resumable":false}
```

The agent had in fact **done the work**: subspec `00-review-step-log-events.md` has all
six acceptance criteria ticked, with real changes to `workflow-runner.ts`, its tests,
and `workflow-runner.md`. Subspec `01` was untouched. Then it emitted `blocked`.

No `## Blocker` section exists in any file of the spec tree. The patch-mode rules
require one ("Blocked or ambiguous? Append a `## Blocker` to the subspec and stop"),
and the operator error explicitly routes to it (`inspect_spec`). The contract is
one-sided: the harness acts on the token but never checks that the artifact the token
promises actually exists.

The operator is left with a non-resumable run, completed work sitting uncommitted, and
no statement of what blocked.

## Scope

- A `blocked` token whose spec carries no `## Blocker` is a contract violation, not a
  valid terminal state. Treat it like the artifact contract already treats a `done`
  with a missing artifact (`contract_miss`): reject it, and say so.
- Prefer re-prompting once for the blocker text over hard-failing — the same cheap
  recovery `write-loop-reprompts-once-for-missing-token` introduced for a missing
  terminal token. The work is already done; only the explanation is missing.
- `inspect_spec` must not be the operator action when there is nothing in the spec to
  inspect.

## Decisions

- Verify the token's artifact, don't trust the token. `done` already runs an
  `artifact.exists` contract; `blocked` has no equivalent and should.
- Suspect the agent meant `progress` here — subspec 00 was complete and 01 remained.
  Worth checking whether the implement prompt makes the `progress` vs `blocked`
  distinction clear on a multi-subspec index, but the harness-side fix (contract-check
  the blocker) stands regardless of why the agent chose the token.

## Out of scope

- The write loop's terminal-token parsing (unchanged).

## Documentation updates

- `v2/docs/write-behavior.md` — the `blocked` outcome's contract.
- `v2/docs/daemon-host.md` — `agent_blocked` / `inspect_spec` operator error.
