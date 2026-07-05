# 01 - Decision-gated resume: approve/abort

Extend the `resume` RPC with an explicit `decision` for `awaiting-human` runs.
This subspec covers `approve` (advance) and `abort` (kill); `revise` is rejected
here and lands in subspec 02.

## Prerequisites

- [00 - Human step convergence](./00-human-step-convergence.md) is merged: `awaiting-human`
  status and human-step dispatch exist.

## Decisions

- `resume` RPC gains an optional `decision: "approve" | "revise" | "abort"` param;
  required (rejected `invalid_params` if missing) when the target run's status is
  `awaiting-human`, ignored on other statuses — a plain `resume` on a human gate
  must not be treated as an implicit approve.
- `approve` sets the human step's run status to `completed` via
  `store.setRunStatus`; no write loop is spawned — approving performs no agent work.
- `abort` on an `awaiting-human` run reuses the existing `kill` handler's
  primitives (`abortController.abort()`, `store.setRunStatus(runId, "killed")`) —
  no parallel kill code path.
- `revise` on an `awaiting-human` run is rejected in this subspec with a
  `revise_unsupported`-class error, pending subspec 02.
- A `decision` param supplied on a non-`awaiting-human` `resume` call is rejected
  — decision only applies to human gates.
- `approve` on the workflow's last step marks that step's run `completed` and
  returns; convergence of the overall workflow to `completed` happens on the
  next `executeWorkflow` call, same as advancing past any other step — `resume`
  does not itself invoke `executeWorkflow`, ruling out a special inline-complete
  path for the last step.

## Acceptance criteria

- [x] `resume` on an `awaiting-human` run without a `decision` param is rejected
      `invalid_params`.
- [x] `resume` with `decision: "approve"` marks the human step's run `completed`;
      a following `executeWorkflow` call for the same workflow advances past that
      step.
- [x] `resume` with `decision: "abort"` on an `awaiting-human` run sets its status
      to `killed`, matching the existing `kill` RPC's observable result.
- [x] `resume` with `decision: "revise"` on an `awaiting-human` run is rejected.
- [x] `resume` with a `decision` param on a non-`awaiting-human` run is rejected.

## Documentation updates

- `v2/docs/daemon-host.md`: document the `resume` RPC's `decision` param, its
  approve/abort semantics, and the awaiting-human-only requirement.
