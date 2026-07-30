# Record a reached approval boundary

## Problem

- The ordered loop returns at an approval stage while its row remains `pending`, making a reached gate
  indistinguishable from an undispatched later stage after the daemon process is gone.

## Decisions

- When ordered progression reaches an approval after all predecessors succeed, atomically change that stage from
  `pending` to `awaiting` before stopping; rules out leaving the durable boundary implicit in process memory.
- Preserve every later row as `pending` and dispatch nothing past the gate; rules out optimistic continuation.
- If the reached stage is no longer `pending`, leave it unchanged; rules out overwriting a concurrent or restored
  approval decision.

## Task checklist

- Record the reached approval boundary from the ordered pipeline loop through the state-store transition.
- Update focused pipeline-execution regressions.
- Update daemon progression and v2 behavior docs.

## Acceptance criteria

- [ ] Reaching an approval stage after succeeded predecessors persists `awaiting` under its stable stage ID before
      the ordered loop returns, while every later stage remains `pending` and undispatched.
- [ ] An approval row no longer `pending` is not overwritten by the loop.
- [ ] A new or updated `v2/src/daemon/pipeline-execution.test.ts` regression for the reached approval boundary
      fails against the pre-fix loop.
- [ ] Inverting the pending-stage transition guard or approval-stop guard makes the targeted
      `v2/src/daemon/pipeline-execution.test.ts` regression fail; negative cases prove decided stages are not
      rewritten and later dispatch is absent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document the durable reached-gate behavior and link
      persistence details to `v2/docs/state-store.md`.

## Documentation updates

- `v2/docs/daemon-host.md` — ordered progression writes `awaiting` before stopping at approval.
- `v2/docs/v1-behaviors.md` — additive v2 durable reached-approval behavior.
