---
name: fan-out-lane-terminal-publication-settlement
---

# Fan-out pipelines run terminal publication once per settled lane

## Problem

`resolveTerminalPublicationInput` refuses fan-out pipelines, commits a spurious pipeline-level failure, and derives `failed` even when every lane's implement succeeded; merge terminal action and per-lane supersede never run.

## Decisions

- When a fan-out lane's authored stages are satisfied, terminal publication runs against that lane's last succeeded workflow artifact (its implement PR), independent of sibling lane order.
- Remove the pipeline-level multi-branch refusal; aggregate derived `succeeded`, settlement-pending `running`, and lane-attributed `failed` from per-lane publication outcomes on durable rows.
- `pipeline wait` treats each lane's publication as part of that lane's settlement boundary.
- With `supersede: close`, close each lane's preceding plan PR after that lane's terminal publication succeeds; close the shared intent PR only after every lane's publication succeeded.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts`: a two-lane fan-out whose implements both succeed runs terminal publication per lane, derives `succeeded` with `terminalPublicationSucceededAt` set, and does not commit `multi-branch terminal publication is not defined for fan-out pipelines`; fails against the current fan-out refusal.
- [ ] Same surface with `terminalAction: "merge"`: both lane implement PRs merge and the pipeline derives `succeeded`; fails against the current fan-out refusal.
- [ ] Same surface: one lane's publication failure is durable on that lane's row, the sibling lane still succeeds, and derived state is `failed` naming the failing lane; fails against pre-fix pipeline-only failure attribution.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — branch fan-out terminal publication per lane; remove the fan-out refusal boundary.
- `v2/docs/v1-behaviors.md` — record per-lane fan-out terminal publication and aggregation.

## Prerequisites

- Per-lane terminal publication outcome is durable on each fan-out lane's final workflow stage artifact as `terminalPublication` success or failure.
- Pipeline `terminalPublicationSucceededAt` is set only when every lane's publication succeeded; pipeline `terminalPublicationFailure` names the failing lane(s).
- Fan-out implement stages already flip their own implement PR ready at stage success without waiting on pipeline terminal publication.
