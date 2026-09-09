# Route single-pipeline verbs through the owning daemon

## Problem

`runPipelineWaitCommand`, `runPipelineMutationCommand` (approve/reject/resume), `runPipelineRecoverCommand`, and `runPipelineDismissalCommand` in `v2/src/commands/pipeline.ts` all call `withRunClient(io, deps, …)`, which connects to `deps.socketPath` — the invoking executable digest's socket. After a digest rotation that socket belongs to a different (or no) daemon, so every control verb dies with `connect ENOENT <socket path>` even though the daemon that actually owns the pipeline is alive and answering on its own key. None of these verbs auto-start a daemon today — `withRunClient` only connects — so the failure is a stranded connection, not a supersede; the only escape hatch an operator has today is manually running `jarvis daemon start`, which risks starting a daemon that supersedes the one still owning live lanes. `resolvePipelineDaemon` already answers "which socket owns this pipeline" via bounded `pipeline_owner` probes across the discovered-plus-invoking socket set, and never starts a daemon itself; the verbs simply don't use it.

## Decisions

- A shared owner-routing wrapper in `v2/src/commands/pipeline.ts` resolves the pipeline id argument (via the cross-daemon resolver from the linked prerequisite subspec, for prefix support) and then the owner (via `resolvePipelineDaemon`), then runs the verb body against the resolved socket with `withRunClient(io, deps, fn, socketPath)`; rules out per-verb resolution copies drifting in their error handling.
- `durable_state` resolutions route the verb to the resolver's deterministic (lexicographically smallest) socket rather than refusing — for both terminal pipelines and reconciled-`interrupted` ones, so `resume`/`recover` can still execute a reconciled-interrupted pipeline; rules out refusing for want of a live `owner` witness, which a reconciled-interrupted pipeline never presents (it would strand every such pipeline permanently). The verb's own daemon-side refusal (e.g. `pipeline_terminal_succeeded`) stays the operator-facing outcome for terminal pipelines — rules out the CLI inventing a second, divergent terminal-refusal vocabulary.
- `pipeline_owner_conflict` refuses before the verb RPC with `pipeline_owner_conflict: Pipeline <id> is claimed by multiple daemons (<path1>, <path2>); this needs manual investigation before retrying.`, naming every claimant socket path; rules out a control verb silently picking one of two claimants.
- No active-owner witness and no durable-state answer refuses with `pipeline_no_live_owner: Pipeline <id> has no live owner; run jarvis daemon start, then retry.` An id that resolves to nothing (after the prerequisite subspec's resolution) refuses with `pipeline_not_found: Pipeline <id> was not found; run jarvis pipeline list --all to verify the id.` No socket answering at all refuses with `pipeline_daemon_unavailable: No live pipeline daemon responded; run jarvis daemon start, then retry.`
- This routing path (id resolution, owner resolution, and the verb RPC itself) never calls `deps.startDaemon`; rules out a diagnosis step "helpfully" starting a daemon on a no-owner or unavailable result and superseding the daemon that actually owns live lanes.
- Verb bodies (parsing, refusal rendering, exit codes) are unchanged; only client selection moves.
- `pipeline start` and `pipeline list` are untouched: `start` has no id to route by, `list` already merges across daemons.
- Deferred to first consumer: `pipeline wait`'s owner resolution now fans out before `deps.onSigint(() => client.close())` is registered, widening the pre-connect Ctrl-C window and adding resolution latency ahead of the wait itself — pin behavior once an operator hits it.

## Task checklist

- [ ] Add the owner-routing wrapper and its failure-message rendering to `v2/src/commands/pipeline.ts`.
- [ ] Rewire wait, approve/reject/resume, recover, and dismiss/undismiss to it.
- [ ] Add the regressions to `v2/src/commands/pipeline.test.ts`.
- [ ] Update the three docs.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts`'s `approves through a non-invoking owner` regression proves `pipeline approve` sends `pipeline_approve` to the socket whose `pipeline_owner` answer is `owner` and applies the decision; it fails against the pre-fix invoking-socket path, which reaches an absent socket.
- [ ] `v2/src/commands/pipeline.test.ts`'s `routes every single-pipeline verb through a non-invoking owner` regression proves `reject`, `resume`, `recover`, `dismiss`, `undismiss`, and `wait` each send their verb RPC only to the witnessed socket; it fails against the pre-fix code.
- [ ] `v2/src/commands/pipeline.test.ts`'s `uses a durable-state endpoint or refuses duplicate owners` regression proves a terminal pipeline and a reconciled-interrupted pipeline both route to the resolver's deterministic endpoint, and that two `owner` claimants refuse with the exact `pipeline_owner_conflict` message above, naming both socket paths, with no verb RPC sent; it fails against the pre-fix code.
- [ ] `v2/src/commands/pipeline.test.ts`'s `reports pipeline owner resolution failures` regression proves the no-owner path exits non-zero with `Pipeline <id> has no live owner; run jarvis daemon start, then retry.`, the not-found path with `Pipeline <id> was not found; run jarvis pipeline list --all to verify the id.`, and the unavailable path with `No live pipeline daemon responded; run jarvis daemon start, then retry.` instead of `connect ENOENT`; it fails against the pre-fix code.
- [ ] Existing `v2/src/commands/pipeline.test.ts` refusal, outcome-parsing, and exit-code tests stay green (routing is behavior-preserving when the invoking digest owns the pipeline).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — single-pipeline control verbs issue their RPC to the `pipeline_owner`-resolved socket (deterministic endpoint for terminal/reconciled-interrupted pipelines) and never auto-start a daemon.
- `v2/docs/operator-runbook.md` — pipeline control verbs survive a digest rotation; retire the "batch merges when no lane is live" mitigation for the pipeline surface.
- `v2/docs/v1-behaviors.md` — record owner-routed pipeline verbs and the named no-owner / not-found / unavailable / conflict errors.
