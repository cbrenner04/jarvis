# Route dispatch by executable digest

## Problem

A fixed daemon socket makes a newly built CLI negotiate with incompatible daemon code. The revision guard then refuses work or replaces the only daemon, coupling unrelated live runs to upgrades.

## Decisions

- Derive the daemon socket key from `shared/executable-tree.ts`'s full digest; rules out Git revision or a second compatibility identity.
- Resolve the keyed daemon identity before any IPC connection; rules out probing a fixed socket and negotiating through `status`.
- Key daemon lifecycle metadata needed to run daemons concurrently with the same digest; rules out shared PID or process-log ownership across digest-keyed daemons.
- Auto-start only the matching daemon for mutating dispatch, then reuse it; rules out an operator pre-start requirement or replacement of another digest's daemon.
- Leave legacy `daemon.sock` and its daemon untouched; rules out migration probes, stops, replacement, or cleanup.
- Remove revision refusal, auto-bounce, and `--no-auto-bounce` from dispatch; rules out retaining compatibility fallback beside keyed routing.
- Keep CLI list, wait, observation, steering, lifecycle, and TUI IPC scoped to the invoking executable's daemon; rules out accidental cross-daemon requests.
- Deferred to first consumer: cross-daemon TUI aggregation — pin when a caller needs it.

## Implementation

- Resolve one digest-keyed daemon identity per CLI invocation and pass it through daemon lifecycle and IPC consumers.
- Make start, resume, and workflow dispatch start or reuse only the selected daemon without a revision-status handshake.
- Retire dispatch revision guarding, bounce retry, and flag parsing; align usage and tests with the removed surface.
- Cover keyed routing, concurrent differently keyed daemons, legacy-socket cutover, selected-daemon list/wait, and dispatch startup/reuse.
- Update the durable daemon, workflow, walkthrough, runbook, and v1-parity documentation in this change.

## Acceptance criteria

- [x] Every CLI IPC connection and daemon lifecycle operation selects `daemon-<executable-tree-digest>.sock`; a differently keyed or legacy `daemon.sock` receives no health, status, list, stop, or dispatch request.
- [x] Start, resume, and workflow dispatch start or reuse the selected daemon and proceed while a differently keyed daemon owns live runs.
- [x] `jarvis run list` and `jarvis run wait` return only rows and outcomes from the daemon selected for the invoking executable.
- [x] Revision-mismatch refusal, automatic bounce, and `--no-auto-bounce` are absent from dispatch and CLI usage.
- [x] A regression test in `v2/src/commands/daemon.test.ts` proves digest-keyed dispatch bypasses a live differently keyed daemon and fails against the pre-fix code.
- [x] The concurrent-start race is covered: when auto-start loses to another CLI starting the same keyed daemon, `DaemonAlreadyRunningError` is swallowed and dispatch proceeds against the winner, while any other start error propagates. Auto-starting daemons on demand is what this change introduces, so this race is now a normal path, not an edge case. **Cover the race at both layers.** The CLI layer (`v2/src/cli/stale-dispatch.ts`) decides whether to swallow `DaemonAlreadyRunningError`; the lifecycle layer (`v2/src/daemon/daemon-lifecycle.ts`) is where the PID-lease `openSync(pidPath, "wx")` *raises* it, and its `code !== "EEXIST"` guard must be pinned in both directions — `EEXIST` becomes `DaemonAlreadyRunningError`, every other `errno` propagates unchanged. Covering one layer does not cover the other. **Two prior attempts stalled here**: PR #1923 on `stale-dispatch.ts:28`, then PR #1935 on `daemon-lifecycle.ts:118` after the CLI layer was covered.
- [x] Every guard this change adds is pinned in both directions, so inverting any one of them fails a test. **Enumerate before finishing, do not spot-fix.** Three consecutive attempts each fixed the one guard named in this file and stalled on the next unnamed one: PR #1923 → `cli/stale-dispatch.ts:28`, PR #1935 → `daemon/daemon-lifecycle.ts:118`, PR #1939 → `daemon-entrypoint.ts:17` (`!pidPath`). Before completing, walk **every** changed file in `<runBase>...HEAD`, list each added or modified conditional, and confirm a test fails when it is inverted. `v2/src/daemon-entrypoint.ts` alone carries `--help`, `!socketPath`, `!pidPath || !existsSync(pidPath)`, the PID-match compare, and the `TEST_DAEMON_OWNER_PID` integer/positive checks — all of which need both-direction coverage or removal if unreachable.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md`, `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/v1-behaviors.md` document keyed selection, automatic matching-daemon dispatch, single-daemon list/wait scope, legacy-socket non-interaction, and retired bounce behavior in their durable homes.

## Documentation updates

- `v2/docs/daemon-host.md` — digest-keyed socket selection and removal of the compatibility handshake.
- `v2/docs/write-behavior.md` — keyed lifecycle, automatic dispatch, and selected-daemon list/wait semantics.
- `v2/docs/operator-runbook.md` — remove bounce-after-merge operations and obsolete mismatch recovery.
- `v2/docs/first-workflow-walkthrough.md` — replace fixed-socket and manual-start examples.
- `v2/docs/v1-behaviors.md` — record keyed routing and retired bounce behavior.
