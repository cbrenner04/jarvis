# Merge `pipeline list` snapshots across every answering daemon

## Problem

`runPipelineListCommand` (`v2/src/commands/pipeline.ts`) issues one `pipeline_list` RPC through `withRunClient` against the invoking digest's socket. After a digest rotation this surfaces as `connect ENOENT …daemon-<key>.sock` while the owning daemon on the old socket still drives the pipelines. `run list` already merges across `resolveDaemonListSocketPaths`; `pipeline list` should use the same socket set.

## Decisions

- `pipeline list` builds its socket set with `resolveDaemonListSocketPaths` (discovered keyed sockets plus the invoking socket, deduped and sorted) and queries each via a new helper, not `withRunClient`; rules out the current single-socket RPC reading a rotation as pipeline loss.
- The new helper (`queryPipelineListsFromSocketPaths`, alongside `resolvePipelineDaemonFromSocketPaths` in `v2/src/daemon/pipeline-daemon-resolution.ts`) issues `pipeline_list` per socket and follows that function's resolve-each/skip-failures/never-auto-start pattern; it does not reuse `queryDaemonListsFromSocketPaths`, which is hard-wired to the `list` RPC and `parseListRuns`.
- Merge reuses the shipped tie-break, not raw socket order: lift `mergePipelineSnapshots`/`pipelineSnapshotOutranks` out of `v2/src/tui/tui-monitor-lines.ts` into a shared non-`tui` module, generalized to key on `Record<string, readonly PipelineSnapshot[]>` so `commands/pipeline.ts` can import it without depending on `tui/`; the TUI keeps calling the lifted function. Winner per `pipelineId`: finished beats unfinished, then more ended stages; an exact tie leaves the incumbent in place, and because socket paths are iterated in sorted order the incumbent is always the earlier path — rules out a stale durable projection on one socket masking a live owner's row on another, which a plain lexicographically-first-socket rule would let through.
- A socket that connects but returns a malformed `pipeline_list` payload is tracked apart from connect/RPC failures. If every socket fails and at least one of those failures was a malformed payload, the command prints the existing `invalid daemon response\n` message instead of the no-live-owner recovery text; rules out telling an operator whose one live daemon returned a broken payload to `jarvis daemon start`, which cannot fix a protocol mismatch.
- Otherwise, zero sockets returning a valid snapshot exits 1 with `No live pipeline daemon responded; run jarvis daemon start, then retry.`, composed from the existing `PIPELINE_NO_LIVE_OWNER_RECOVERY` constant rather than a duplicated literal; rules out the bare `connect ENOENT <path>`.
- This diverges from `run list`'s zero-answering-socket behavior, which forwards `firstError`'s own message: `pipeline list` always emits the one fixed recovery text (or the malformed-payload message above) regardless of which socket failed how.
- `--all` stays a per-socket request parameter (`{ includeDismissed: true }` sent to every socket), not a post-merge filter. `--since` and `--state` filter the merged, deduped set, same as today, and remain incompatible with `--json` (unchanged existing check).
- `--json` prints one merged `{ "pipelines": [...] }` array across sockets, not one per socket, ordered the same as `selectPipelines` (`createdAt` desc, `pipelineId` asc) even though the `--json` path returns before calling `selectPipelines`.

## Task checklist

- [ ] Lift `mergePipelineSnapshots`/`pipelineSnapshotOutranks` out of `v2/src/tui/tui-monitor-lines.ts` into a shared module keyed on `PipelineSnapshot[]` per socket path; update the TUI import.
- [ ] Add `queryPipelineListsFromSocketPaths` next to `resolvePipelineDaemonFromSocketPaths`, distinguishing malformed-payload failures from connect/RPC failures.
- [ ] Replace the single-socket RPC in `runPipelineListCommand` with a multi-socket query over `resolveDaemonListSocketPaths` and the new helper; drop the `withRunClient` call for this command.
- [ ] Dedupe merged snapshots with the lifted tie-break function.
- [ ] Apply `--since`/`--state` and both render modes to the merged, deduped set; order the `--json` array `createdAt` desc, `pipelineId` asc.
- [ ] Emit the malformed-payload message or the no-live-owner recovery message (composed from `PIPELINE_NO_LIVE_OWNER_RECOVERY`) on total failure, exit 1.
- [ ] Update the `--json` help description in `v2/src/cli/command-help-flags.ts` (no longer "unmodified" single-RPC snapshot).
- [ ] Add the regression tests and update the docs.

## Acceptance criteria

- [x] `v2/src/commands/pipeline.test.ts`'s `lists a non-invoking daemon snapshot` regression proves a row from a non-invoking keyed socket is rendered; it fails against the current single-socket RPC.
- [x] `v2/src/commands/pipeline.test.ts`'s `prefers a finished snapshot over an unfinished one for the same pipeline id` regression proves the merge uses the lifted finished/more-ended-stages tie-break, not raw socket order; it fails against the pre-fix code and against a plain first-sorted-socket merge. Earlier-socket-path precedence is structural (sorted iteration plus an incumbent-preserving tie), not a comparison, so no criterion claims coverage of a branch that cannot be taken.
- [x] `v2/src/commands/pipeline.test.ts`'s `filters merged pipeline snapshots` regression proves `--since` and `--state` filter the merged, deduped set; it fails against the pre-fix code.
- [x] `v2/src/commands/pipeline.test.ts`'s `lists despite one failed socket` regression proves an answering daemon's rows still render and exit 0 when another socket fails to connect; it fails against the pre-fix code.
- [x] `v2/src/commands/pipeline.test.ts`'s `reports unavailable pipeline daemons` regression proves that when no socket connects, the command exits 1 with `No live pipeline daemon responded; run jarvis daemon start, then retry.`, not `connect ENOENT <socket path>`, and starts no daemon; it fails against the pre-fix code.
- [x] `v2/src/commands/pipeline.test.ts`'s `reports a malformed snapshot without suggesting daemon start` regression proves that when the only answering socket returns a malformed `pipeline_list` payload, the command prints `invalid daemon response`, not the no-live-owner recovery text; it fails against the pre-fix code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — `pipeline list` merges across every answering daemon, survives a digest rotation, and reports the daemon-unavailable recovery (or the malformed-payload message) instead of a socket path.
- `v2/docs/v1-behaviors.md` — record the merged, deduped `pipeline list` behavior, including the merged `--json` array (no longer an unmodified single-socket snapshot) and its ordering.
