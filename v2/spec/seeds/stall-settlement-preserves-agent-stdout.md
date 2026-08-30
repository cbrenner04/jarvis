# Stall settlement discards agent stdout, so a stalled cursor lane logs as never-produced-output

## Problem

When the idle-output watchdog fires, the stall result is `{ kind: "stall", stderr: errBuf }` (`shared/invocation/agents.ts:289`, `:293`) — the accumulated `outBuf` (stdout) is dropped. `logBindingInbound` (`shared/invocation/execute.ts`) appends only `result.stderr` for non-ok results. Cursor is spawned with `--output-format stream-json --stream-partial-output` and writes everything to **stdout**, so a stalled cursor lane's session log shows **zero inbound bytes** after the binding line — reading as "the agent never produced any output," the exact opposite of what happened (it streamed minutes of work). This misdirects every stall diagnosis (see the false "claude/cursor is slow" folklore).

## Evidence (2026-08-30, issue #3151)

Run `0364af43-86ec-4587-a5ac-2e705dc2beff` (implement, `spec/20260830T034133Z-engine-backed-turn-loop`, cursor after codex quota fail-over): cursor streamed ~4 min of edit events, then the watchdog fired; the session log shows a silent lane.

## Decisions

- The stall result carries the accumulated stdout (combined `${errBuf}${outBuf}` diagnostics, matching how the zero/non-zero settle branches already build `stderr`), so `logBindingInbound` records the real streamed output. Rules out logging only stderr for a stdout-only agent.
- No change to when the watchdog fires or to the `kind: "stall"` classification — this is a diagnostics-fidelity fix, not a timing change. Rules out coupling it to the watchdog-budget work.

## Acceptance criteria

- [ ] A test drives an invocation that streams stdout then idles into a stall, and asserts the settled stall result's diagnostics/log payload contains the streamed stdout (not just stderr); it fails against the current `{ stderr: errBuf }`-only stall result.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2` pass (shared surface).

## Documentation updates

- `v2/docs/operator-runbook.md` — the `role_stalled`/`idle_output_timeout` sections note that the session log now carries the stalled agent's streamed stdout, so an empty inbound log is real silence, not a discarded buffer.
