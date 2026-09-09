---
name: pipeline-list-merges-across-daemons
---

# `jarvis pipeline list` merges snapshots from every answering daemon

## Problem

`runPipelineListCommand` issues one `pipeline_list` RPC through `withRunClient` against the invoking digest's socket. After a digest rotation it returns `connect ENOENT …daemon-<key>.sock` — or, once it auto-starts a daemon on the new key, an empty list that reads as "the pipelines are gone" while the owning daemon still drives them.

## Decisions

- `pipeline list` queries every socket from the shared resolution set and merges the snapshots, the way `run list` merges run rows; rules out a partial listing reading as "the pipeline is gone".
- Merged rows are deduped by pipeline id. Socket paths are sorted before querying, and conflicting duplicate snapshots keep the lexicographically first socket's row; rules out both duplicate output and nondeterministic display during a race.
- Filters (`--all`, `--since`, `--state`) and both render modes apply to the merged set, after dedupe; rules out per-daemon filtering producing inconsistent totals.
- A socket that fails to connect or errors is skipped and does not fail the command when another socket answers; rules out one stale socket blanking a live listing.
- Every socket failing is reported as `No live pipeline daemon responded; run jarvis daemon start, then retry.`, not a bare `connect ENOENT <path>`; `pipeline list` never auto-starts one.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts`'s `lists a non-invoking daemon snapshot` regression proves a row from a non-invoking keyed socket is rendered; it fails against the current single-socket RPC.
- [ ] `v2/src/commands/pipeline.test.ts`'s `keeps the first sorted duplicate snapshot` regression proves a pipeline reported by two answering daemons renders once using the lexicographically first socket's snapshot.
- [ ] `v2/src/commands/pipeline.test.ts`'s `filters merged pipeline snapshots` regression proves `--all`, `--since`, and `--state` filter after dedupe.
- [ ] `v2/src/commands/pipeline.test.ts`'s `lists despite one failed socket` regression proves an answering daemon's rows still exit 0.
- [ ] `v2/src/commands/pipeline.test.ts`'s `reports unavailable pipeline daemons` regression proves no answering socket exits non-zero with `No live pipeline daemon responded; run jarvis daemon start, then retry.`, not `connect ENOENT <socket path>`, and does not auto-start.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `pipeline list` survives a digest rotation and merges across daemons.
- `v2/docs/v1-behaviors.md` — record the merged, deduped `pipeline list` behavior.

## Prerequisites

- Pipeline daemon resolution walks every live keyed socket under `JARVIS_HOME` plus the invoking digest's socket.
- Resolution skips sockets whose connection or RPC fails instead of failing the whole query.
- Resolution never auto-starts a daemon.
