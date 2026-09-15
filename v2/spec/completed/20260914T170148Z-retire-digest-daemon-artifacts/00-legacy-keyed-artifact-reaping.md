# Legacy keyed daemon artifact reaping

## Problem

`reapDeadDaemonSockets` (`v2/src/commands/daemon.ts`) seeds units only from `daemon-<16hex>.sock` files and classifies them by connecting (liveness probe + `health` RPC); `removeDeadDaemonArtifacts` (`v2/src/commands/cleanup.ts`) revalidates via the same socket seed. Socketless keyed PID/log pairs are never discovered. Today only the private successor socket is digest-keyed (`daemonPathsByDigest(...).socketPath` in `v2/src/cli.ts`); PID and log paths always resolve to the stable defaults. So every draining generation's legacy residue is a keyed socket with no companion PID file — the common case, not an edge case — and cleanup both treats that socket as a live service endpoint to classify it and has no reaping path for it at all.

## Decisions

- Discover legacy units from the union of keys across `daemon-<16hex>.sock|.pid|.log` filenames; rules out socket-seeded enumeration that strands socketless pairs.
- Classify a legacy unit with a parseable PID file by its recorded PID via `isProcessAlive` (`v2/src/daemon/daemon-lifecycle.ts`): dead process → reapable, live → preserved and reported (fail-closed on PID reuse — a draining generation's private endpoint stays intact).
- Classify a legacy unit that has a keyed socket but no PID file by a non-RPC liveness probe (`probeSocketLiveness`, `v2/src/ipc/server.ts`): `stale` (connection refused) → reapable, `live` or `absent` → preserved and reported; never issue a `health` RPC or `connectIpcClient` against a keyed socket, which would use it as a live service endpoint. Rules out the prior deferral — the PID-less keyed socket is the artifact this repo actually accumulates today, so it needs a real proof of death, not a punt.
- A legacy unit with neither a parseable PID file nor a socket file (bare keyed log) has no independent proof of death; preserve and report it as ambiguous.
- Stop writing keyed PID and log files: only the private successor socket stays digest-keyed, PID and log always resolve to the stable paths; rules out the keyed-pair accumulation continuing going forward.
- Stable `daemon.sock`/`daemon.pid`/`daemon.log` never match the keyed pattern and are never candidates; cleanup never kills a process.
- Apply revalidates each previewed unit with the same classifier (PID check or non-RPC socket probe, both injectable for tests) immediately before removal, and removes only files that were previewed and are still classified dead; rules out apply re-enumerating from sockets only and drops a unit that turned live or a keyed file created after preview.
- Cleanup output/preview labels these as legacy daemon artifacts, preserved entries keyed by unit with reason.
- `enumerateOtherDaemonSockets` (`v2/src/daemon/daemon-peer-socket.ts`, used by `v2/src/daemon/daemon.ts` for draining-peer discovery) and keyed private-endpoint binding in `v2/src/cli.ts`/daemon stay unchanged — out of scope; this subspec only touches cleanup's legacy-classifier path.

## Acceptance criteria

- [x] A cleanup test proves a socketless legacy keyed PID/log pair whose recorded process is dead is discovered and removed; it fails against the pre-fix socket-seeded enumeration.
- [x] A cleanup test proves a legacy keyed socket with no PID file is removed when a non-RPC liveness probe reports connection-refused, and preserved with a reason when the probe reports live or inconclusive; it fails against the pre-fix code, which never reaps a PID-less keyed socket.
- [x] A cleanup test proves a legacy unit with a live recorded PID, or with neither a parseable PID file nor a socket file, is preserved and reported with a reason.
- [x] A cleanup test proves the stable socket, PID, and log files are never offered for removal while a stable daemon listener is serving.
- [x] A cleanup test proves dry-run previews the same legacy units (including socketless ones and PID-less keyed sockets) that apply revalidates and removes, using an injectable liveness check; a unit whose PID or socket becomes live between preview and apply is preserved, and a keyed file created after preview is not removed by apply.
- [x] A cleanup test proves nothing writes a keyed `daemon-<16hex>.pid` or `daemon-<16hex>.log` file; only the private successor socket stays digest-keyed.
- [x] A structural test on the legacy-classifier module/function proves it never issues a `health` RPC or `connectIpcClient` call against a keyed socket and never uses a digest key to locate daemon service, while permitting the non-RPC liveness probe; it fails against the pre-fix `classifySocket`. `enumerateOtherDaemonSockets` and private-endpoint binding are out of scope for this guard.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — cleanup section: stable lifecycle files preserved; legacy keyed artifacts discovered from sock/pid/log union, classified by PID or (PID-less keyed sockets) non-RPC liveness probe, fail-closed, dry-run/apply revalidation; preserved-unit report shape (unit, reason).
- `v2/docs/operator-runbook.md` — replace digest artifact reaping guidance (fail-closed section, wedged-start `daemon-*.sock` advice) with stable-file preservation and legacy cleanup.
- `v2/docs/daemon-host.md` — lifecycle artifact ownership: stable files belong to the serving generation; keyed private endpoint belongs to a draining generation until it exits, then is legacy residue; no keyed PID/log are created.
- `v2/docs/v1-behaviors.md` — record retirement of per-digest artifact units and PID/socket-classified legacy residue cleanup.
