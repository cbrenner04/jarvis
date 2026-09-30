---
name: pipeline-decision-claim-misses-older-draining-generation
---

# Pipeline decision claim misses a draining generation's failed pipeline

## Problem

`claimPipelineForDecision` (`v2/src/daemon/daemon-stable-run-routing.ts` ~243–271) only claims from a live peer when `queryPeerPipelineOwner` (~211) gets `kind: "owner"`. The peer's `pipeline_owner` (`daemon-pipeline-handlers.ts` ~446) answers via `resolvePipelineOwnership` (`pipeline-observation.ts` ~76), which returns `durable_state` for any derived-terminal pipeline (`failed` ∈ `TERMINAL_PIPELINE_STATES`, `pipeline-execution.ts` ~69) before checking identity. So a `status = active` row whose derived state is `failed`, owned by a live draining generation, is never confirmed; `adoptOrphanedPipeline` fails (owner alive) and the `interrupted`/dead-owner branch doesn't apply → `pipeline_no_live_owner`. Discovery is not the gap: `enumerateSockets` finds the older private socket and the peer answers.

Evidence (2026-09-30 ~05:00Z): `jarvis pipeline resume cec5cbce-d7dc-42d4-8919-04c74eacd144 write-loop-checkpoints-exclude-materialized-node-modules` and `jarvis pipeline resume a0681d04-88cb-4879-b5e1-bcb1caedca41` refused `pipeline_no_live_owner`. Both rows `status active`, `owner_identity 42681:1790737777297`, implement stages `failed` (dispatch errors). PID 42681 alive, listening on `~/.jarvis/daemon-ac2a77dcd3554eb3.sock`; stable daemon 49394 (`72e9f205a`). Only remedy: wait for 42681 to exit.

## Decisions

- A peer answering `durable_state` whose `ownerIdentity` matches the row's recorded owner confirms ownership for the claim, same as `owner`; the CAS `claimPipelineContinuation` stays the guard.
- `not_owner`/`not_found`/unreachable still refuse.
- No new verb or flag; `pipeline_owner` wire shape unchanged.

## Acceptance criteria

- [ ] With a fake peer answering `durable_state` (`failed`) and matching `ownerIdentity`, `pipeline_resume` on the stable handlers claims the row (owner rewritten to current) and runs the local handler.
- [ ] Same with a mismatched `ownerIdentity` still refuses `pipeline_no_live_owner`.
- [ ] Peer answering `not_owner` or unreachable still refuses `pipeline_no_live_owner`.
- [ ] Existing `owner`-witness claim tests unchanged and passing.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Stable endpoint claims before running a decision verb — a terminal-state witness from the recorded owner confirms the claim.
- `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs — drop "wait for owning daemon" for failed pipelines held by a draining generation.
