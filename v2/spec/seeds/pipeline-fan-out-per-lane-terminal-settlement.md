---
name: pipeline-fan-out-per-lane-terminal-settlement
---

# Fan-out pipelines settle terminal publication per lane

## Problem

After a splitting intent, every downstream stage runs once per lane, but terminal publication is single-lane only: `resolveTerminalPublicationInput` returns `multi-branch terminal publication is not defined for fan-out pipelines`, which is committed as `terminalPublicationFailure`, so every fan-out pipeline derives `failed` even when every lane's implement succeeded (`fbeff16b`, `e6153e7b`, `dbe9f322`, `ef329302` in the operator's store). No lane's implement PR is flipped ready or merged by the pipeline; the operator does it by hand and reads a spurious `failed`.

## Decisions

- Terminal publication runs once per lane, against that lane's last succeeded workflow stage artifact (its implement PR), when the lane's stages are all satisfied — not once for the pipeline. Rules out the pipeline-level "undefined" refusal.
- Per-lane outcome is durable on the lane's final stage row (new `terminalPublication: {succeededAt} | {failure}` in the artifact JSON, additive); pipeline-level `terminalPublicationSucceededAt` is set when every lane succeeded, and `terminalPublicationFailure` names the failing lane(s). Rules out one shared success/failure field losing lane identity.
- Derived state: `succeeded` only when every lane's publication succeeded; a lane publication failure derives `failed` naming the lane; `pipeline wait` treats each lane's publication as part of that lane's settlement. Rules out `succeeded` with an unpublished lane.
- `pipeline list` stage rows expose the per-lane publication fields; single-lane pipelines keep today's shape byte-for-byte. Rules out a payload break for the common case.
- Superseded-PR closing (seed `pipeline-terminal-settlement-supersedes-mid-stage-prs`) applies per lane to that lane's plan PR; the shared intent PR closes only after every lane's publication succeeded. Rules out closing the intent PR while a sibling lane still needs it.
- Lane ordering/base chaining is out of scope (seed `pipeline-fan-out-lanes-serial-chained-bases`); this seed publishes each lane as it settles regardless of order.

## Acceptance criteria

- [ ] A two-lane pipeline whose implements both succeed publishes each lane's implement PR (`ready`) and derives `succeeded` with `terminalPublicationSucceededAt` set; pinned by a pipeline-execution test that fails against the current fan-out refusal.
- [ ] One lane's publication failure lands on that lane's row and the pipeline derives `failed` naming the lane, while the sibling lane's publication still succeeds; pinned by a test.
- [ ] Single-lane `pipeline_list` payload and derived-state behavior are unchanged; pinned by existing tests plus a byte-equality fixture.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — branch fan-out execution and terminal publication sections; remove the "not defined for fan-out" boundary.
- `v2/docs/first-workflow-walkthrough.md` — configured-pipeline section (fan-out settlement).
- `v2/docs/v1-behaviors.md` — record.
