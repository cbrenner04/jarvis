# Implement-path text-less block reports as a harness defect

## Problem

On the workflow `implement` path, a `blocked` token with no `## Blocker` text is
recorded as a bare `blocked` (`agent_blocked` / `inspect_spec`) — the operator gets
a reason code with nothing to act on. The `missing_blocker` harness-defect detection
never fires there.

Root cause (confirmed): `blockerTextContract` in `v2/src/execution/write.ts` is attached
only when `promptId === DEFAULT_PROMPT_ID` (`"write.execute"`, the plain run/write path).
The implement path uses `promptId === "patch.prompt.body"`, so no contract is attached;
`resolveBlockedResult` (step-runner.ts) sees `contract === undefined` and returns plain
`blocked` without requiring or reprompting for blocker text. A second divergence: on an
index-routed implement run the agent appends `## Blocker` to the **active subspec**
(`expectedArtifactPath`), not `specPath` (the index), so the contract must key on the
subspec file the agent actually writes.

## Decisions

- Attach the blocker-text contract on the `patch.prompt.body` (implement) path, keyed on the file the agent is instructed to append `## Blocker` to (the active subspec = `expectedArtifactPath`), not `specPath`. Rules out reusing the run path's `specPath` keying, which points at the index on index-routed runs and would never see the appended blocker.
- A text-less block on the implement path resolves to the existing `missing_blocker` harness-defect outcome (after the blocker reprompt), not a bare `blocked`. Rules out inventing a new outcome kind — `missing_blocker` already exists as the distinct harness-defect classification (`v2/src/daemon/run-operator-error.ts`).
- Guard the contract on the target file existing (as the run path does with `existsSync`/`statSync`); an implement launch with no readable subspec attaches no contract. Rules out throwing on a missing file mid-loop.

## Task checklist

- [ ] Widen the blocker-text-contract attachment in `write.ts` to the implement path, keyed on the active-subspec artifact path.
- [ ] Confirm a text-less `blocked` on the implement path drives the reprompt and terminates as `missing_blocker`.
- [ ] Add the failing regression test.
- [ ] Update docs.

## Acceptance criteria

- [ ] A new regression test drives a `patch.prompt.body` (implement) write to a `blocked` token where the agent appends no `## Blocker` to the active subspec, and asserts the terminal outcome is `missing_blocker`, not `blocked`; it fails against the pre-fix code.
- [ ] On the implement path, a `blocked` token that does append a genuine `## Blocker` to the active subspec still resolves as `blocked` (the contract is satisfied), verified by a test.
- [ ] A `missing_blocker` implement outcome composes to operator reason `missing_blocker` (not `agent_blocked`), verified against `composeRunOperatorError`.
- [ ] `v2/src/execution/write-loop.test.ts` and `step-runner.test.ts` stay green (existing run-path blocker-contract behavior unchanged).

## Documentation updates

- `v2/docs/operator-runbook.md` — a text-less block on the implement path reports as the `missing_blocker` harness defect, not bare `agent_blocked`.
- `v2/docs/v1-behaviors.md` — record that the blocker-text contract applies to the implement path, so a text-less block is a harness defect on both write and implement paths.
