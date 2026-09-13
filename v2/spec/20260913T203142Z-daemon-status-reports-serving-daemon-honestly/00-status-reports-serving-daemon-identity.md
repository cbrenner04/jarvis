# Status reports serving daemon identity

## Problem

`getDaemonStatus` (`v2/src/daemon/daemon-lifecycle.ts`) returns `stale` when the daemon's loaded executable digest differs from the invoking CLI's, and `v2/src/commands/daemon.ts` renders `loaded=<HEAD> current=<HEAD>`, which differ after spec/docs-only merges. Operators read that as staleness and bounce needlessly. A reachable daemon whose `status` RPC throws, fails to parse, or omits `loadedRevision`/`loadedExecutableDigest` is also reported `stopped` today, same misreport for a live daemon.

## Decisions

- A reachable daemon whose `status` RPC parses returns `running` with its own `loadedRevision`; remove `stale` from `DaemonStatusResult` rather than keeping it for another caller — autonomous self-handoff owns convergence.
- A reachable daemon whose `status` RPC throws, fails to parse, or omits `loadedRevision`/`loadedExecutableDigest` also returns `running`, with `loadedRevision: "unknown"` — the socket already answered, so falling through to `stopped` would misreport a serving daemon, the exact bug this spec fixes.
- `getDaemonStatus` stops computing the CLI's current HEAD and digest; drop the `getCurrentRevision`/`getExecutableDigest` options rather than leaving them unused.
- Output is `running loaded=<revision>` with no `current=` field — a second identifier invites the mismatch misread.
- `loaded=<revision>` names the git revision, not the executable digest — the digest is an opaque hash operators can't recognize or cross-reference, while the revision is the identifier commits, PRs, and the runbook already use.
- `init-readiness`'s `checkDaemon`/`defaultCheckDaemon` (`v2/src/commands/init-readiness.ts`) narrow their state to `"running" | "stopped"` and drop the `warn("daemon loaded revision is stale")` branch — leaving `stale` in that type after `getDaemonStatus` can no longer produce it strands a dead warn path.

## Task checklist

- Remove digest/HEAD comparison and `stale` from `getDaemonStatus`; fold the RPC-throws/unparseable/missing-field cases into `{ state: "running", loadedRevision: "unknown" }` instead of `stopped`.
- Drop the `getCurrentRevision`/`getExecutableDigest` options and `GetCurrentRevisionFn` type.
- Render `running loaded=<revision>` in `v2/src/commands/daemon.ts` (drop `current=`).
- Narrow `ReadinessProbes.checkDaemon`/`defaultCheckDaemon` to `"running" | "stopped"`; remove `evaluateReadiness`'s daemon-check `warn` branch.
- Update fixtures that set `currentRevision`: `v2/src/commands/daemon.test.ts` (~lines 156, 174) and `v2/src/commands/workflow.test.ts` (~line 1210).
- Update docs.

## Acceptance criteria

- [ ] A test added to `describe("getDaemonStatus")` in `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts`, injecting `socketProber` (probe resolves `true`) and `connectIpcClient` (a `status` RPC reply whose `loadedExecutableDigest` differs from any digest the test computes for the tree), asserts `{ state: "running", loadedRevision: <value> }` with no digest comparison and no `currentRevision` field; it fails against the pre-fix digest comparison returning `stale`.
- [ ] A test added to the same `describe("getDaemonStatus")` block drives a succeeding socket probe paired with a `status` RPC that throws, or replies unparseable/missing `loadedRevision`, and asserts `{ state: "running", loadedRevision: "unknown" }`; it fails against the pre-fix `stopped` result for these cases.
- [ ] A test in `v2/src/commands/daemon.test.ts` asserts `daemon status` for a serving daemon prints exactly `running loaded=<revision>\n` with exit 0 and no `current=` substring; it fails against the pre-fix `loaded=… current=…` rendering.
- [ ] A test drives `evaluateReadiness`'s `daemon` check with a `checkDaemon` result outside `{running, stopped}` (cast around the narrowed `ReadinessProbes` type) and asserts the check settles `missing`, never `warn`; it fails against the pre-fix `warn("daemon loaded revision is stale")` branch.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — status table and output section: `running loaded=<revision>` (exit 0) or `stopped` (exit 1); no stale state or current revision.
- `v2/docs/operator-runbook.md` — rewrite the self-handoff paragraph's sentence citing `state: "stale"` (`loaded=<old digest> current=<new digest>`) to say status reports `running loaded=<revision>` throughout the self-handoff window regardless of digest; keep the rest of that paragraph.
- `v2/docs/v1-behaviors.md` — rewrite the `[v2-only]` `daemon status` entry to the new `running loaded=<revision>` / `stopped` behavior.
- `v2/docs/install-and-config.md` — update the `daemon` readiness-check row (currently `warn` when its loaded revision is stale) to reflect `ok`/`missing` only.
