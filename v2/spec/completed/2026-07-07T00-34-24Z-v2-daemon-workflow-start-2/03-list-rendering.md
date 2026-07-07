# list rendering

Depends on [00 - Dispatch core](./00-dispatch-core.md). `listHandler`
(`v2/src/daemon/daemon.ts`) already renders per-step rows (`workflowRowSnapshot`,
`workflowStepSnapshot`) for runs carrying a `workflowSnapshot` — today only produced
by the `implement`/preset workflow path invoked outside `start`. Exercise this same
rendering against a run actually produced via `start`.

## Decisions

- No new rendering logic — reuse `workflowRowSnapshot`/`workflowStepSnapshot` as-is.
- This subspec is verification-only: confirm a `start`-produced workflow run's rows
  carry the same `workflow: { steps: [...] }` shape as an existing preset-produced
  workflow run.

## Acceptance criteria

- [x] `list` on a `start`-produced multi-step workflow run returns per-step rows
      (`stepId`, `role`, `status`, `attemptCount`) matching the shape
      `workflowRowSnapshot` already produces for preset-produced workflow runs.

## Documentation updates

- `v2/docs/daemon-host.md`: note that `list` renders per-step rows for
  `start`-produced workflow runs identically to preset-produced ones.
