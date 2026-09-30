# Accept durable_state peer witness on stable decision claim

## Problem

`queryPeerPipelineOwner` / `anyPeerConfirmsOwner` in `v2/src/daemon/daemon-stable-run-routing.ts` treat only `{ kind: "owner", ownerIdentity }` as confirmation. A live draining generation holding an `active` row whose derived execution state is already terminal answers `pipeline_owner` with `{ kind: "durable_state", state, ownerIdentity }` per `resolvePipelineOwnership` (`v2/src/daemon/pipeline-observation.ts`), so stable `approve`/`reject`/`resume`/`recover` refuse `pipeline_no_live_owner` even though the recorded owner is reachable on a peer socket.

## Decisions

- A peer's `{ kind: "durable_state", state, ownerIdentity }` with `ownerIdentity` equal to the row's recorded owner confirms the claim the same way `{ kind: "owner", ownerIdentity }` does only when the claimer's already-loaded pipeline row satisfies the same qualification `resolvePipelineOwnership` uses (`isPipelineTerminal(derivePipelineState(...))` or durable `status === "interrupted"`) — rules out counting peer JSON when local row shape still implies live ownership.
- Implement witness gating by reusing `resolvePipelineOwnership` or a shared exported predicate at the claim site, not by classifying from the peer's `state` field alone — rules out drift on the `interrupted` branch and duplicate terminal logic.
- `claimPipelineContinuation` remains the only ownership write — rules out a new verb, flag, or changed `pipeline_owner` wire shape.
- `not_owner`, `not_found`, unreachable peers, and identity mismatch still refuse `pipeline_no_live_owner` unchanged — rules out loosening refusal when no matching witness exists.

## Tasks

- [ ] Gate `durable_state` peer confirmation on the loaded row qualification above; extend `anyPeerConfirmsOwner` / `queryPeerPipelineOwner` parsing so matching terminal or reconciled-`interrupted` `durable_state` answers count when the row qualifies.
- [ ] Add regressions beside `describe("stable pipeline decision-verb claim across older generations")` using injected fake peers via `connectOwnerClient` and row fixtures that match the problem (held `active` row with terminal derived execution, plus reconciled `interrupted`).
- [ ] Update documentation listed below.

## Acceptance criteria

- [ ] A test proves a `succeeded` and a `rejected` pipeline owned by a live draining peer answering `durable_state` with matching identity is claimed but the decision verb still refuses with that pipeline's own terminal reason (`pipeline_terminal_succeeded` / `pipeline_terminal_rejected`), not a dispatch.
- [ ] `daemon-stable-run-routing.test.ts` proves stable `pipeline_resume` claims (owner rewritten to current) and runs the local handler when the row is a held `active` pipeline whose derived execution is already terminal (same failed-stage / blocked-recoverable fixture patterns as elsewhere in the file) and a fake peer answers `{ kind: "durable_state", state: "failed", ownerIdentity }` matching the row owner; it fails against the pre-fix owner-only witness check.
- [ ] The same file proves stable decision claim accepts a matching `durable_state` witness when durable `status` is `interrupted` and `ownerIdentity` matches the row; it fails against the pre-fix owner-only witness check.
- [ ] The same file post-fix refuses claim when a peer returns qualifying-looking `durable_state` with matching `ownerIdentity` but the loaded row does not qualify (non-terminal derived state, not reconciled `interrupted`); reachable as over-acceptance on the new `durable_state` branch (pre-fix may already refuse via owner-only parsing).
- [ ] The same file post-fix refuses claim when a peer returns `durable_state` on the confirmation path but `ownerIdentity` does not match the row's recorded owner (wrong identity must not confirm on the `durable_state` branch).
- [ ] `describe("stable pipeline decision-verb claim across older generations")` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — stable-endpoint claim entry (`createStablePipelineDecisionHandlers`): terminal or reconciled-`interrupted` `durable_state` from the recorded owner also confirms the claim, not only `{ kind: "owner" }`.
- `v2/docs/daemon-host.md` § Stable endpoint claims before running a decision verb — matching terminal or reconciled-`interrupted` `durable_state` from the recorded owner authorizes `claimPipelineContinuation`.
- `v2/docs/pipeline-execution.md` § Single admitter for decision verbs — stable claim peer confirmation includes the same terminal or reconciled-`interrupted` `durable_state` witness; cross-link `daemon-host.md`.
- `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs — decision verbs need not wait for a draining generation to exit when the pipeline is already terminal-derived or reconciled `interrupted` but still held on an older live socket.
