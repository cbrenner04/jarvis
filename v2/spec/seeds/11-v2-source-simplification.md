---
name: v2-source-simplification
---

# Source simplification

Remove mechanism built for load that doesn't exist; dedupe cross-file drift hazards. Behavior-preserving except where flagged.

## Decisions

- **Wait fanout** (daemon.ts:241-252, 461-510): `Waiter`/`WaitFanout`/`detachWaiter`/`resolveWaiters`/`ensureWaitFanout` (~120 LOC) shares one log-follow across N concurrent waiters; realistic N is 1–2 (TUI + maybe one CLI wait). Replace with a per-waiter `follow` (~15 lines). `daemon-wait-run-completion` tests shrink accordingly.
- **Log follow wake** (log-stream.ts:84-349): `FsAppendWake` (fs.watch + directory fallback + dirty flag) already runs a 500ms poll because the watcher is admitted unreliable. Replace with poll-only follow; delete the watcher class and the `AppendWake`/factory seam. Poll interval is a named constant (250–500ms). Flagged behavior change: follow latency becomes the poll interval. **Also finishes the residual `daemon-wait-run-completion.test.ts` leak:** #1191 only `.unref()`-ed the inotify `FSWatcher` (reduced, not eliminated — still intermittently times out `Test (v2)` on Linux, e.g. #1204). Deleting the watcher removes the leak source; acceptance must confirm that file no longer intermittently times out (stress the file on Linux CI / repeated runs), and the runbook "The gate" note (currently marked residual) flips to resolved.
- **ipc/server.ts:79-88**: delete the transport-level built-in `health`/`status` responses — daemon handlers own these; the transport switch is dead in production.
- `defineWorkflowStep` (workflow-runner.ts) is an identity function → callers use `satisfies`.
- **Dedup:** step-status unions defined on both wire sides (daemon.ts:256-265 ≡ daemon-wire.ts:6-18) → one definition imported by the other; `applyOperatorSessionId` (daemon.ts) vs `withOperatorSessionId` (cli.ts) → one function with documented merge semantics (they differ silently today: overwrite vs defer); `~/.jarvis` path constants (`daemon.sock` default ×3 + display string, `v2.json` refs pending seed 06) → one `paths.ts`; three hand-rolled RPC frame loops (cli.ts `request()` including the 24h `LOG_FRAME_WAIT_MS` hack, tui-daemon-rpc-transport, daemon-lifecycle `probeSocket`) → reuse the rpc transport, relocated out of `tui/`; "Worktree already claimed for project=…, branch=…" message built 3× in daemon.ts → once.
- **write-loop-input:** `requireLaunchFields` accumulates per-field errors that cli.ts discards for generic usage text — pick one error channel, delete the other; remove the double-parse in the CLI value builder.
- Not here: `normalizeBindings` (seed 08), settle-delay dedup and memory-watermark reads (seed 06), daemon.ts file splits (seed 13), comments (seed 12).
- Docs: `v2-architecture.md` domain map if the transport relocation crosses domains.

## Out of scope

- New config surface, new abstractions, speculative extensibility.

## Ordering

11 — after 10; before 12 (they overlap in daemon.ts — simplify first, then slim comments).
