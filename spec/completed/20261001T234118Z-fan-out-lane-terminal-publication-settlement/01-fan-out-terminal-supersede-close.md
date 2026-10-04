# Fan-out terminal supersede on close

## Problem

`settleSupersededPrecedingStagePrs` returns immediately when `findFanOutSplit` is set, so fan-out pipelines with `supersede: "close"` never close preceding plan PRs or the shared intent PR after terminal publication succeeds.

## Surface

`v2/src/daemon/pipeline-execution.ts` (`settleSupersededPrecedingStagePrs`, `supersedePrecedingStageCandidates` or fan-out-scoped successor). Tests: `pipeline-execution.test.ts` (`pipeline terminal publication settlement` — split from `does not supersede when policy is keep, terminal action is leave-draft, or fan-out refuses terminal success`).

Depends on [00-per-lane-terminal-publication-settlement](./00-per-lane-terminal-publication-settlement.md) (per-lane terminal publication success commits).

Out of scope: supersede on `leave-draft` / `supersede: "keep"`, non-fan-out supersede behavior (unchanged).

## Decisions

- After a fan-out lane's terminal publication succeeds with `supersede: "close"` and `terminalAction` `ready` or `merge`, close that lane's own preceding succeeded workflow PRs on the branch suffix (typically the lane's plan PR) using the same `supersedeGh` seam as single-lane settlement — rules out keeping the unconditional `findFanOutSplit` early return with no fan-out replacement.
- Close the shared default-lane intent PR only after every admitted fan-out lane's terminal publication has succeeded — rules out closing intent when the first lane publishes while a sibling lane still owes publication.
- Split the combined supersede regression so fan-out `supersede: "close"` expectations live in a dedicated test; the retained test covers only `supersede: "keep"` and `leave-draft` (no fan-out refusal or close assertions) — rules out deleting keep/leave-draft coverage when extracting fan-out close behavior and rules out pinning post-00 refusal in the retained test.

## Task checklist

- Implement fan-out-aware supersede candidate selection (per-lane suffix vs shared prefix intent) and invoke it from the per-lane terminal success path.
- Refactor `pipeline-execution.test.ts`: extract fan-out `supersede: "close"` assertions into a new dedicated test; trim `does not supersede when policy is keep, terminal action is leave-draft, or fan-out refuses terminal success` to keep and leave-draft only (rename optional).
- Align `v2/docs/pipeline-execution.md` terminal supersede section with fan-out per-lane and shared-intent timing.

## Acceptance criteria

- [x] `pipeline-execution.test.ts`: new dedicated fan-out `supersede: close` test closes each lane's preceding plan PR after that lane's terminal publication and closes the shared intent PR only after every lane's publication succeeded; fails against today's fan-out supersede no-op (`findFanOutSplit` early return ~1509).
- [x] `pipeline-execution.test.ts` — trimmed `does not supersede when policy is keep, terminal action is leave-draft, or fan-out refuses terminal success` (keep and leave-draft only) stays green.
- [x] `bun run typecheck` exits zero.
- [x] `bun run test:v2` exits zero.

## Documentation updates

- `v2/docs/pipeline-execution.md` — fan-out `supersede: "close"` closes per-lane preceding PRs after that lane's terminal publication and closes the shared intent PR only after all lane publications succeed.
- `v2/docs/v1-behaviors.md` — record fan-out supersede timing if not already covered by 00's doc pass.
