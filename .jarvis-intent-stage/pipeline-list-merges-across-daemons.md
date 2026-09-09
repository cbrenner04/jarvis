---
name: pipeline-list-merges-across-daemons
---

# `jarvis pipeline list` merges snapshots from every answering daemon

## Problem

`runPipelineListCommand` issues one `pipeline_list` RPC through `withRunClient` against the invoking digest's socket. After a digest rotation it returns `connect ENOENT …daemon-<key>.sock` — or, once it auto-starts a daemon on the new key, an empty list that reads as "the pipelines are gone" while the owning daemon still drives them.

## Decisions

- `pipeline list` queries every socket from the shared resolution set and merges the snapshots, the way `run list` merges run rows; rules out a partial listing reading as "the pipeline is gone".
- Merged rows are deduped by pipeline id; rules out one pipeline appearing twice when two daemons report it.
- Filters (`--all`, `--since`, `--state`) and both render modes apply to the merged set, after dedupe; rules out per-daemon filtering producing inconsistent totals.
- A socket that fails to connect or errors is skipped and does not fail the command when another socket answers; rules out one stale socket blanking a live listing.
- Every socket failing is reported as a named operator error, not a bare `connect ENOENT <path>`; rules out an error that reads like corruption when the cause is a digest rotation.

## Acceptance criteria

- [ ] A test proves `pipeline list` returns rows from a daemon keyed by a digest other than the invoking one; it fails against the current single-socket RPC.
- [ ] A test proves a pipeline reported by two answering daemons renders once.
- [ ] A test proves `--all`, `--since`, and `--state` filter the merged set.
- [ ] A test proves a failing socket alongside an answering one still yields the answering daemon's rows and exit 0.
- [ ] A test proves that when no discovered socket answers, `pipeline list` exits non-zero with a named reason rather than a bare `connect ENOENT <socket path>`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `pipeline list` survives a digest rotation and merges across daemons.
- `v2/docs/v1-behaviors.md` — record the merged, deduped `pipeline list` behavior.

## Prerequisites

- Pipeline daemon resolution walks every live keyed socket under `JARVIS_HOME` plus the invoking digest's socket.
- Resolution skips sockets whose connection or RPC fails instead of failing the whole query.
- Resolution never auto-starts a daemon.
