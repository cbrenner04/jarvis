# Attributed binding attempts on terminal invocation-failure settlement

## Problem

`v2/src/execution/write-loop.ts` builds the terminal `invocationFailureDetail.bindingAttempts` as `{ bindingId, resultKind }` only, dropping the `agent`/`model` that `binding.metadata` already carries. `BindingAttemptSummary` already declares those optional fields and `v2/src/execution/review-role-invocation.ts` populates them on the role-timeout path, so the write loop is the one settlement seam that persists an unattributed attempt list. An operator reading a failed run's detail cannot tell which agent/model each rung used.

## Behavior

Terminal `invocation_failure` and `stall` settlement in the write loop persists, in chain order, one attempt entry per attempted rung carrying `bindingId`, `resultKind`, and — when the binding declares metadata — `agent` and `model`.

## Decisions

- Map `binding.metadata` inline in the write loop's existing `bindingAttempts` mapper; rules out extracting a shared summarizer with `review-role-invocation.ts`, whose role-timeout path overrides `resultKind` per attempt and would drag an unrelated seam into this change.
- Omit `agent`/`model` when `binding.metadata` is absent rather than writing `"unknown"`; rules out a placeholder string that a consumer cannot distinguish from a real agent named `unknown`.
- Attribute every attempted rung, not just the final one; rules out recording only the settling binding, which hides the fallback chain the operator needs to read.

## Task checklist

- [x] Extend the `bindingAttempts` mapper in `v2/src/execution/write-loop.ts` to spread `agent`/`model` from `attempt.binding.metadata`.
- [x] Add the failing-first regression test in `v2/src/execution/write-loop.test.ts`.
- [x] Update the docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` proves a terminal `invocation_failure` persists ordered `bindingId`, `agent`, `model`, and `resultKind` for every attempted rung; it fails against the pre-fix binding-id-only detail.
- [x] `v2/src/execution/write-loop.test.ts` proves an attempt whose binding declares no metadata persists `bindingId` and `resultKind` with no `agent`/`model` keys.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — terminal invocation-failure detail persists per-rung agent/model attribution.
- `v2/docs/v1-behaviors.md` — record the changed v2 failure-detail shape.
