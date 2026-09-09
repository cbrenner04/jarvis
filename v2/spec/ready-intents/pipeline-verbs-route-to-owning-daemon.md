---
name: pipeline-verbs-route-to-owning-daemon
---

# Single-pipeline verbs route to the daemon that owns the pipeline

## Problem

`wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, and `undismiss` all go through `withRunClient` against the invoking digest's socket. After a digest rotation they die with `connect ENOENT`, and the auto-start inside `connectWithAutoStart` then spawns a daemon on the new key that supersedes the daemon owning every live lane — so the operator loses control of work that is still running, and cannot decline the escape hatch.

## Decisions

- Each single-pipeline verb resolves an active pipeline through the shared `pipeline_owner` witness and issues its RPC only to that socket; rules out pipeline mutation dying on a key rotation while an owning daemon answers.
- Terminal and reconciled-interrupted pipelines use the resolver's deterministic durable-state endpoint, not an ownership witness. Duplicate active-owner witnesses refuse before the verb RPC with `pipeline_owner_conflict`; no control verb chooses a claimant.
- No active-owner witness returns `pipeline_no_live_owner: Pipeline <id> has no live owner; run jarvis daemon start, then retry.` An absent id returns `pipeline_not_found: Pipeline <id> was not found; run jarvis pipeline list --all to verify the id.` No answering socket returns `pipeline_daemon_unavailable: No live pipeline daemon responded; run jarvis daemon start, then retry.`
- These verbs never auto-start a daemon, including on no-owner and unavailable results; an operator alone may run the stated recovery. This rules out diagnosis causing the supersede it is diagnosing.
- Existing refusal, outcome-parsing, and exit-code handling per verb is unchanged; only daemon selection moves.
- `pipeline start` keeps auto-starting on the invoking digest — it has no pipeline id to route by; rules out an owner-lookup that can never succeed for a not-yet-created pipeline.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts`'s `approves through a non-invoking owner` regression proves `pipeline approve` reaches its `pipeline_owner` witness and applies the decision; it fails against the current `connect ENOENT` path.
- [ ] `v2/src/commands/pipeline.test.ts`'s `routes every single-pipeline verb through a non-invoking owner` regression proves `reject`, `resume`, `recover`, `dismiss`, `undismiss`, and `wait` each send their RPC only to the witnessed socket.
- [ ] `v2/src/commands/pipeline.test.ts`'s `uses a durable-state endpoint or refuses duplicate owners` regression proves terminal and reconciled-interrupted pipelines use the deterministic endpoint while duplicate owners refuse before any verb RPC.
- [ ] `v2/src/commands/pipeline.test.ts`'s `never auto-starts while routing pipeline verbs` regression proves every resolved, no-owner, and unavailable path performs no daemon auto-start; the resolved path fails against the current auto-start-then-supersede path.
- [ ] `v2/src/commands/pipeline.test.ts`'s `reports pipeline owner resolution failures` regression proves each named no-owner, absent-id, and unavailable result exits non-zero with its specified recovery rather than `connect ENOENT <socket path>`.
- [ ] Existing `v2/src/commands/pipeline.test.ts` refusal and exit-code tests stay green (routing change is behavior-preserving for the single-daemon case).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline verbs survive a digest rotation; retire the "batch merges when no lane is live" mitigation for the pipeline surface.
- `v2/docs/daemon-host.md` — owner-routed pipeline RPCs and the no-auto-start rule.
- `v2/docs/v1-behaviors.md` — record owner routing and the named no-owner error.

## Prerequisites

- Pipeline daemon resolution walks every live keyed socket under `JARVIS_HOME` plus the invoking digest's socket.
- Resolution uses a `pipeline_owner` witness rather than `pipeline_list`, handles terminal/reconciled endpoints and duplicate owner claims, and returns the specified no-owner, not-found, and unavailable outcomes.
- Resolution and these control verbs never auto-start a daemon.
- `pipeline list` merges snapshots across answering daemons, deduped by pipeline id.
