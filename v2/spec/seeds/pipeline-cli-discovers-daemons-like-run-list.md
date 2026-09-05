---
name: pipeline-cli-discovers-daemons-like-run-list
---

# Every `jarvis pipeline` verb goes blind after a merge rotates the source digest

## Problem

`jarvis run list` merges every live keyed daemon socket discovered under `JARVIS_HOME` plus the invoking digest's socket. Every `jarvis pipeline` verb instead issues one RPC to the **invoking digest's socket only**. The `jarvis` launcher keys its daemon by a digest of the source tree, so any merge that touches source rotates that key — and pipeline control dies on the spot while the daemon that owns the work is alive and serving.

Observed 2026-09-06 with four implements and four pipelines in flight. After merging #3498/#3499 (both touching `v2/src`/`shared`), every pipeline verb returned `connect ENOENT /Users/…/.jarvis/daemon-493e86ffaea4445c.sock`:

```text
jarvis pipeline list     → connect ENOENT …daemon-493e86ffaea4445c.sock
jarvis pipeline approve  → connect ENOENT …daemon-493e86ffaea4445c.sock
jarvis pipeline wait     → connect ENOENT …daemon-493e86ffaea4445c.sock
jarvis run list          → works, live rows and all
```

The daemon (PID 35334, socket `daemon-b91eb247df428929.sock`) was healthy the whole time and its four implements kept committing.

**The escape hatch is a trap.** Starting a daemon on the new digest restores pipeline control, but the new daemon broadcasts `supersede` to every other keyed socket, and a superseded daemon stops admitting `start` and `resume`. The four in-flight implements would then fail at their next step admission (`daemon_superseded`) — review, shrink, and publication steps all dispatch that way. So the only safe recovery is to stop merging and wait for every run to settle, which is precisely the serialization the pipeline dogfooding cadence exists to avoid.

The runbook's "prefer batching merges for when no lane is live" is the current mitigation. That is an operator tax paid for a CLI asymmetry: `run list` already solved this.

## Decisions

- Pipeline verbs resolve their daemon by the same discovery `run list` uses (every live keyed socket under `JARVIS_HOME` plus the invoking digest), not the invoking digest alone; rules out pipeline control dying on a key rotation while an owning daemon answers.
- `list` merges pipeline snapshots across answering daemons, deduped by pipeline id, the way `run list` dedupes by run id; rules out a partial listing reading as "the pipeline is gone".
- Verbs that mutate one pipeline (`approve`, `reject`, `resume`, `recover`, `dismiss`) route to the daemon that answers for that pipeline id, and refuse with a named reason when none does; rules out both a silent no-op and an `ENOENT` that names a socket path instead of the problem.
- A connection failure on every discovered socket is reported as a named operator error naming the pipeline and the recovery, not a bare `connect ENOENT <path>`; rules out an error that reads like corruption when the cause is a digest rotation.

## Acceptance criteria

- [ ] A test proves `pipeline list` returns rows from a daemon on a different digest key than the invoking one; it fails against the current single-socket RPC.
- [ ] A test proves `pipeline approve` routes to the owning daemon on a non-invoking digest key and applies the decision; it fails against the current `connect ENOENT`.
- [ ] A test proves that when no discovered socket answers for a pipeline id, the CLI exits non-zero with a named reason naming the pipeline, not a bare `connect ENOENT <socket path>`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline verbs survive a digest rotation; retire the "batch merges when no lane is live" mitigation for the pipeline surface.
- `v2/docs/daemon-host.md` — socket discovery set shared by run and pipeline CLI paths.
