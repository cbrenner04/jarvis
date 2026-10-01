---
name: fan-out-lane-terminal-publication-durable-outcomes
---

# Fan-out lanes persist terminal publication on the final stage row and aggregate at pipeline scope

## Problem

Terminal publication success and failure are pipeline-scoped only; fan-out pipelines cannot record which lane failed or attach publication outcome to a lane's implement row.

## Decisions

- Add additive `terminalPublication` on a lane's final succeeded workflow stage artifact: `{ succeededAt }` or `{ failure }` mirroring pipeline-level publication failure shape.
- Pipeline `terminalPublicationSucceededAt` is written only when every fan-out lane's publication succeeded; `terminalPublicationFailure` names the failing lane(s) without dropping lane identity.
- Single-lane pipelines keep pipeline-level terminal publication commits unchanged; per-lane artifact field is unused on the common path.

## Acceptance criteria

- [ ] `state-store.test.ts`: after per-lane terminal publication commits on a two-lane fixture, each lane's final stage artifact carries `terminalPublication` and the pipeline row reflects all-lane success or lane-named failure; fails against the pre-fix schema that only updates pipeline columns.
- [ ] Same surface: clearing or overwriting pipeline terminal success after a partial lane failure remains idempotent on first write per existing terminal-publication commit rules.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — per-lane `terminalPublication` on stage artifacts and pipeline-level aggregation for fan-out terminal publication.

## Prerequisites
