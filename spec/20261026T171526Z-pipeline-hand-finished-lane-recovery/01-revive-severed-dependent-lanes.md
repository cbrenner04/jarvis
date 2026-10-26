# 01 - Revive severed dependent lanes when the predecessor recovers

## Problem

`settleSeveredChainLanes` (`src/daemon/pipeline-execution.ts`) writes every `pending`/`awaiting` row of a dependent lane `skipped` with `skipProvenance: "terminal"` once its chain predecessor is dead, and nothing reverses it: when the predecessor later recovers (`pipeline resume`, or adoption from 00), its dependents stay skipped and the pipeline cannot finish. Reachable on main: pipeline `a7628b6e` lanes `logic-package-and-tooling`, `ios-app-shell`, `app-icon` were severed when `repository-bootstrap` failed `implement.already_complete`.

## Decisions

- A severed row is identified by `status: "skipped"`, `skipProvenance: "terminal"`, and `failureDetail.expectation === "chained predecessor lane completes"` (the record `settleSeveredChainLanes` writes today); rules out a new column or provenance value, so rows severed before this change revive too.
- Revival runs wherever severance runs (lane walk end, `runPipeline` suffix start, after an applied decision), before severance: for each dependent lane in chain order whose `fanOutLaneGate` is no longer `severed`, every severed row returns to `pending` with `endedAt`, `failureDetail`, and `skipProvenance` cleared. Chain order makes it transitive: a revived lane is no longer dead, so its own severed successor revives in the same pass.
- A revived lane holds behind its predecessor exactly as an un-severed dependent does (serial chain rules unchanged); rules out dispatching it before the predecessor's suffix is satisfied.
- Never revived: provisional skips, fan-out `default` skips, `skipRemainingStages` rows after a lane's own failure, rows skipped after a rejected gate, and rows whose predecessor is still dead (a `rejected` predecessor stays dead).
- No new operator verb: the predecessor's `jarvis pipeline resume <id> <lane>` is the only command needed; the pipeline then continues the revived lanes.

## Task checklist

- [x] Add the revival pass beside `settleSeveredChainLanes` and call it at each severance site.
- [x] Ensure a pipeline whose revived lanes have open rows is continued by the same `pipeline resume`.
- [x] Tests in `src/daemon/pipeline-execution.test.ts` under `fan-out serial chained lanes`.

## Acceptance criteria

- [x] A regression test with chain A → B → C fails A's implement stage (B and C severed), then recovers A through `pipeline resume`; B's and C's severed rows return to `pending` and B dispatches after A's suffix is satisfied. It fails against the pre-fix code (B and C stay `skipped`).
- [x] A test recovers A by 00's lane-PR adoption and asserts the same revival.
- [x] A test seeds severed rows exactly as current `settleSeveredChainLanes` writes them (legacy shape) and asserts they revive once the predecessor is no longer dead.
- [x] A test asserts a dependent of a `rejected` predecessor stays `skipped`, and a lane skipped by its own failure or its own rejected gate is never revived.
- [x] `pipeline-execution.test.ts` `fan-out serial chained lanes` severance tests stay green (severance on a dead predecessor unchanged).
- [x] `bun run typecheck` passes.
- [ ] `bun run test:agent` passes.

## Documentation updates

- `docs/pipeline-execution.md` § fan-out lanes: severance is reversed when the predecessor recovers; drop "Terminal, so a later predecessor resume does not revive it."
- `docs/operator-runbook.md`: hand-finished lane recovery revives severed dependents via the predecessor's `pipeline resume`.
- `docs/v1-behaviors.md`: `[harness behavior change]` entry for severed-lane revival.
