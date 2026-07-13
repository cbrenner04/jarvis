# The daemon runs a snapshot of the code from when it started

A shipped fix has no effect on `jarvis run workflow` until the operator restarts the
daemon. Nothing says so. The operator sees the bug they just fixed, still happening,
against a `main` that provably contains the fix.

## Problem

Observed 2026-07-13. `implement-routing-read-works-on-first-launch` (#1460) merged and
was on `main` in the primary checkout. Re-running the preset:

```sh
$ jarvis run workflow implement --base main --spec v2/spec/<spec>/index.md
invalid_params: ENOENT: no such file or directory, open
  '/Users/…/.jarvis/worktrees/jarvis/<spec>/v2/spec/<spec>/index.md'
```

The exact ENOENT the merged fix eliminates. The fix was fine — the **daemon** was
started hours earlier and was still executing the old module graph. After
`jarvis daemon stop && jarvis daemon start`, the identical command launched
successfully.

Cost of not knowing this: an operator concludes the fix didn't work, re-opens a closed
bug, or (worse, and nearly what happened here) writes a new seed claiming a merged fix
is broken.

The trap is sharpest in exactly the situation v2 is in — dogfooding the harness on
itself, where the code under test *is* the code the daemon is running. Every fix
landed this session was invisible to the daemon until it bounced.

## Scope

- The daemon should not silently serve stale code. Options, cheapest first:
  - detect that its loaded source is older than the project checkout's HEAD and warn
    (or refuse) on the next command;
  - report the commit/build it is running in `jarvis daemon status`, so a mismatch is
    visible without guessing;
  - reload on change.
- Whatever the mechanism, the operator must not have to *remember* to restart the
  daemon after a merge. Remembering is the current design.

## Decisions

- Surfacing the staleness beats auto-reloading it: a daemon that hot-swaps code under
  in-flight runs trades a visible confusion for an invisible one. Start by making the
  running version legible.
- `jarvis daemon status` currently prints `running` and nothing else. It is the natural
  home for "what am I actually running".

## Out of scope

- Hot reload of in-flight runs.
- v1 (`jarvis1`) — it spawns per invocation from the checkout, so it has no staleness.
  This is a daemon-architecture consequence, and it is new with v2.

## Documentation updates

- `v2/docs/operator-runbook.md` — until this ships, the stopgap is: **restart the
  daemon after merging any v2 change, before dogfooding it.** Remove that caveat when
  this lands.
- `v2/docs/daemon-host.md` — record the code-snapshot lifetime of a daemon process.
