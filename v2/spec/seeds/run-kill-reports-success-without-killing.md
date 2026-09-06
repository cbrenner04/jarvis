---
name: run-kill-reports-success-without-killing
---

# `run kill` and `run kill --force` both report `killed` while the row stays live and the hung child keeps running

## Problem

A run whose gate/verifier child hangs cannot be killed, and the CLI does not say so. Both `jarvis run kill <id>` and `jarvis run kill --force <id>` print `killed`, exit `0`, and change nothing: the durable row stays `in-progress` / `live` and the spawned `bun test` child keeps burning CPU.

This is the "the row lied" class applied to the one verb an operator reaches for when a lane is stuck. `killed` is an unconditional acknowledgement of the RPC, not a report of what happened. The runbook already warns that the acknowledgement "only records the kill; full durability is guaranteed only once the write loop itself settles" — but there is no path by which this loop ever settles, because settlement waits on quiescence and quiescence waits on the child that is hung. The kill and the thing blocking it are in a cycle.

`--force` is documented as the escalation for exactly this and is equally inert here. The runbook's stated force contract ("the force path only takes the safe abort branch for a live `write-loop`/`workflow` active kind") is satisfied on paper — the row *is* a live workflow — yet nothing is aborted.

The consequence is that the documented recovery for a stalled run does not exist. The operator's only remaining option is a raw `kill` from their own shell, which the auto-mode classifier blocks for the operator agent, so recovery requires a human at a terminal.

## Evidence (2026-09-06, exact)

Lane `20260906T034511Z-daemon-structural-invariant-test-anchors`, run `04fba343`:

- `iteration_started` at 16:25:48, still the last log event 90 minutes later — twice the 45-minute iteration ceiling, with no watchdog firing.
- No agent process for that worktree at all (`lsof -a -p <pid> -d cwd` across every `cursor-agent`/`codex`/`claude`).
- One child: `bun test v2/src/daemon/daemon-run-control-handler-guard.test.ts`, **parented to the daemon (22064)**, 100% CPU for 1h14m, later observed at 181%.

```text
$ jarvis run kill 04fba343…            → killed        (exit 0)
  +53s: row = in-progress / live       child = 128% CPU, still alive
$ jarvis run kill --force 04fba343…    → killed        (exit 0)
  +20s: row = in-progress / live       child = 137% CPU, still alive
```

The branch held three good commits and a dirty in-progress subspec throughout, so this is not a dead lane — it is a recoverable lane the operator cannot reach.

## Decisions

- `run kill` reports what it achieved, not that the RPC was received: a kill that does not settle the row within the quiescence bound exits non-zero and names the row's still-live state and the blocking child; rules out `killed` on stdout for a run that is still running.
- Run termination signals the spawned gate/verifier process group before waiting on quiescence, not after; rules out a settlement path that waits on the very child its own termination is supposed to reap.
- `--force` settles the durable row even when quiescence never completes, and says plainly that a child may survive it, naming the pid; rules out a force path whose only observable effect is the same success string as the non-force path.
- The refusal or partial outcome names the child pid and its parent, since the recovery differs for a daemon-parented child versus a `launchd`-parented orphan; rules out an operator having to derive parentage by hand to choose a recovery.
- Rules out treating this as a duplicate of the `daemon stop` / `run kill` deadlock bullet: that shape needs a row that is non-terminal *and* not-live, whereas this row is genuinely live and genuinely owned by the reachable daemon.

## Acceptance criteria

- [ ] A test proves `run kill` on a run whose child does not exit within the quiescence bound exits non-zero and does not print `killed`; it fails against the current unconditional acknowledgement.
- [ ] A test proves run termination signals the recorded gate/verifier process group before awaiting quiescence; it fails against the current ordering.
- [ ] A test proves `run kill --force` settles the durable row to `killed` even when quiescence never completes; it fails against the current inert force path.
- [ ] A test proves the non-settling outcome names the surviving child pid and its parent; it fails against the current message-free path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Stopping a live workflow implement run and § Clearing a stale non-active run: what `kill` guarantees, and the hung-child case where it cannot.
- `v2/docs/daemon-host.md` — kill RPC outcome contract: acknowledgement versus settlement.
- `v2/docs/v1-behaviors.md` — record honest kill reporting and pre-quiescence process-group termination.
