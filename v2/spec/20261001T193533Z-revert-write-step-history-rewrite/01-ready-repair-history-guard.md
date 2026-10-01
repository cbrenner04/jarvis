# Ready-repair history rewrite regression and operator docs

## Problem

Ready-gate repair invokes `write.ready-repair` through the same `awaitIteration` path; without an end-to-end regression, a rebasing repair stub can still reach publication and hit `ForeignRemoteTipError` despite the unit guard.

## Decision ledger

- Add `v2/src/execution/write-loop-ready-repair.test.ts` as a normal `test:v2` file (not `*.sandbox-unrunnable.test.ts`) — rules out hiding the scenario behind sandbox-only integration or an oversized `write-loop.test.ts` edit.
- Regression fixture seeds a prior lane publish (`leaseFromSha` / tip the lane already pushed) so the same rebasing stub would yield `ForeignRemoteTipError` or equivalent lease refusal on pre-fix; post-fix expects `agent_history_rewrite_reverted`, publish from pre-iteration lineage, and no lease refusal — rules out asserting only “no error” on a remote with no prior publish.

## Task checklist

- Add `write-loop-ready-repair.test.ts` exercising `publishWithReadyRepair` (or the smallest harness entry that runs a ready-repair iteration) with a rebasing agent stub and publication seams sufficient to assert push/lease behavior.
- Update operator and architecture docs per intent.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-ready-repair.test.ts`: with a prior lane publish in the fixture, a ready-repair agent stub that rebases onto a moved base would fail publication lease checks on pre-fix; after the guard, publish succeeds from the pre-iteration lineage (no `ForeignRemoteTipError`) and logs `agent_history_rewrite_reverted`; fails against the pre-fix code.

## Documentation updates

- `v2/docs/workflow-runner.md` § Ready gate repair — iterations that rewrite lane history revert to pre-iteration `HEAD` before fence/autofix/commit.
- `v2/docs/operator-runbook.md` — extend **Foreign tip on a publication push** with agent history rewrite as a cause prevented by revert and the `agent_history_rewrite_reverted` log event.
- `v2/docs/v1-behaviors.md` — catalog the write-step history-rewrite guard (record pre-iteration `HEAD`, non-ancestor detection on settled post-agent path, `reset --keep`, event name; excludes `write.mutation-repair`).
