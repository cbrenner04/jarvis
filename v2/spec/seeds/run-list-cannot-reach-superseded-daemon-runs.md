---
name: run-list-cannot-reach-superseded-daemon-runs
---

# `run list` renders live runs on a superseded daemon as `not-live`, which reads exactly like the deadlock shape

## Problem

Every keyed daemon binds the **same** socket path (one `daemon-<key>.sock` file per key, replaced on each new start), so the CLI can only ever reach the newest daemon on that key. A superseded daemon keeps running the runs it owns — by design — but those runs live only in *its* memory. The reachable daemon does not know them, so:

- `jarvis run list` reports them `in-progress` + `not-live`.
- `jarvis run resume <id>` refuses `terminal_run: Cannot resume a in-progress run`.
- `jarvis run kill --force <id>` refuses `run_not_active`.
- Re-dispatch refuses `Cannot re-run incomplete spec: process <pid> holds worktree lock`.

That is byte-for-byte the shape the runbook documents as the `daemon stop` / `run kill` deadlock, whose recorded recovery is `kill -9 <daemon-pid>` then `jarvis daemon start`. Applying that recovery to this state **destroys live work** — including other projects' runs, since the daemon is shared across every registered project.

The `run list` row in the runbook's Observe table claims it "merges every live keyed daemon, deduped by run ID". That is true across *distinct* keys; it is not true across generations of the *same* key, which is the common case (a merge to local `main` rotates the source digest, and the next CLI invocation starts a new daemon on that key).

## Evidence

2026-09-01/02 operator session. Three concurrent implements (`extract-review-debate-landing-module`, `terse-plan-review-role-prompts`, and a `full-review` pipeline implement stage) all rendered `in-progress` + `not-live` with zero live rows in `jarvis run list`, immediately after local `main` advanced (5 merges) and a new daemon came up on the rotated digest.

All three were in fact still running. Direct evidence:

- Three live daemon processes: `bun .../v2/src/daemon-entrypoint.ts` at PIDs 25288 (1h), 38964 (40m), 84937 (6m).
- Exactly one socket file: `~/.jarvis/daemon-abed6b448b7ce800.sock` — the three daemons share a key.
- `lsof -a -p 41628 -d cwd` showed a 40-minute-old `cursor-agent` with cwd `~/.jarvis/worktrees/jarvis/20260901T090603Z-terse-plan-review-role-prompts`.
- The `worktree lock` refusal named PID 38964 — a **live** daemon, so the refusal was accurate.

The operator caught the misdiagnosis before any recovery was applied. Chess-project runs were live under one of the superseded daemons at the same time and would have been destroyed by the documented `kill -9` recovery.

## Decisions

- `jarvis run list` (and `wait` / `log` owner discovery) must reach runs owned by superseded daemons on the same key, or the CLI must distinguish "unreachable owner" from "not live" rather than collapsing both to `not-live`.
- Minimum viable: a row whose owning daemon cannot be reached renders a distinct state (e.g. `unreachable`) instead of `not-live`, so the deadlock recovery is never triggered against live work.
- A superseded daemon should remain reachable for read RPCs while it still owns non-terminal runs — either by keeping a generation-suffixed socket alongside the shared key, or by handing owned-run reads to the successor.

## Acceptance criteria

- [ ] A run owned by a superseded same-key daemon is not reported `not-live` by `jarvis run list` while its owner process is alive — pinned by a test with two daemon generations on one key.
- [ ] The operator-facing state for an unreachable-owner run is distinguishable from a genuinely settled-but-non-terminal row — pinned by a test asserting the distinct rendered state.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Daemon lifecycle, the Observe `run list` row, and the `daemon stop` / `run kill` deadlock gotcha: same-key supersession, and the liveness check to run before any `kill -9` recovery.
