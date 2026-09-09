---
name: pipeline-verbs-route-to-owning-daemon
---

# Single-pipeline verbs route to the daemon that owns the pipeline

## Problem

`wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, and `undismiss` all go through `withRunClient` against the invoking digest's socket. After a digest rotation they die with `connect ENOENT`, and the auto-start inside `connectWithAutoStart` then spawns a daemon on the new key that supersedes the daemon owning every live lane — so the operator loses control of work that is still running, and cannot decline the escape hatch.

## Decisions

- Each single-pipeline verb resolves the owning daemon for its pipeline id through the shared resolution seam and issues its RPC there; rules out pipeline mutation dying on a key rotation while an owning daemon answers.
- A verb that finds an owning daemon does not auto-start a daemon on the invoking digest; rules out diagnosis causing the supersede it is diagnosing.
- When no discovered socket owns the pipeline id, the verb exits non-zero with a named reason naming the pipeline and the recovery; rules out both a silent no-op and an `ENOENT` that names a socket path instead of the problem.
- Existing refusal, outcome-parsing, and exit-code handling per verb is unchanged; only daemon selection moves.
- `pipeline start` keeps auto-starting on the invoking digest — it has no pipeline id to route by; rules out an owner-lookup that can never succeed for a not-yet-created pipeline.

## Acceptance criteria

- [ ] A test proves `pipeline approve` routes to the owning daemon on a non-invoking digest key and applies the decision; it fails against the current `connect ENOENT`.
- [ ] A test proves `reject`, `resume`, `recover`, `dismiss`, `undismiss`, and `wait` each route to the owning daemon on a non-invoking digest key.
- [ ] A test proves a verb reaching an owning daemon on another digest key does not auto-start a daemon on the invoking key; it fails against the current auto-start-then-supersede path.
- [ ] A test proves that when no discovered socket answers for a pipeline id, the CLI exits non-zero with a named reason naming the pipeline, not a bare `connect ENOENT <socket path>`.
- [ ] Existing `pipeline.test.ts` refusal and exit-code tests stay green (routing change is behavior-preserving for the single-daemon case).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline verbs survive a digest rotation; retire the "batch merges when no lane is live" mitigation for the pipeline surface.
- `v2/docs/daemon-host.md` — owner-routed pipeline RPCs and the no-auto-start rule.
- `v2/docs/v1-behaviors.md` — record owner routing and the named no-owner error.

## Prerequisites

- Pipeline daemon resolution walks every live keyed socket under `JARVIS_HOME` plus the invoking digest's socket.
- Resolution reports which discovered socket owns a given pipeline id, and a structured not-found result naming the pipeline id when none does.
- Resolution never auto-starts a daemon.
- `pipeline list` merges snapshots across answering daemons, deduped by pipeline id.
