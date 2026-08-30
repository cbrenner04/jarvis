# idle_output_timeout settles resumable:false even when the boundary commit captured real progress

## Problem

`idle_output_timeout` always settles `resumable: false`. `terminalMapping` maps stall → `{ kind: "idle_output_timeout", runStatus: "failed" }` (`v2/src/execution/write-loop.ts:2221`), and `committedResult` grants resumability only to `iteration_timeout` (with completed subspecs); every other failed outcome, including idle timeout, is hard `resumable: false`. But the write loop **checkpoints the killed iteration's edits** before settling, so an idle-killed lane whose boundary commit captured real work is a dead-end the operator can only recover by re-running from scratch — restarting on the same silent agent. This is the asymmetry that makes a false idle-kill maximally costly (the killed iteration's committed work is real but non-resumable, and `retry: false` also does not advance the agent order).

## Evidence (2026-08-30, issue #3152)

Run `0364af43-86ec-4587-a5ac-2e705dc2beff`: the watchdog killed an actively-working cursor lane, jarvis committed the progress at the boundary (`b7574f03`, 9 files), then settled `loop_finished` with `resumable: false`. Also observed on the doc implement (`7421843a`, this session) — cursor committed a 224-line doc, then idle_output_timeout stranded it non-resumable.

## Decisions

- When the idle-timeout boundary commit captured a real iteration commit (an `iteration_commit` with changes, not `no_file_changes`), settle `idle_output_timeout` `resumable: true` so `jarvis run resume` continues from the checkpoint — mirroring the `iteration_timeout` + completed-subspec resumability path. Rules out leaving a committed-progress idle timeout as a dead-end.
- A pure-silence idle timeout with no committed progress stays `resumable: false`. Rules out reviving genuinely-empty stalls.
- Interim mitigation already applied: machine-wide `idleOutputTimeoutMs` raised to 900000 (15 min); this seed is the durability fix. Related: [[idle-watchdog-counts-worktree-filesystem-activity]].

## Acceptance criteria

- [ ] A test drives an idle_output_timeout whose boundary checkpoint committed real changes and asserts the settled row is `resumable: true` with `nextAction: resume`; it fails against the current hard `resumable: false`.
- [ ] A test proves a no-committed-progress idle timeout still settles `resumable: false`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `idle_output_timeout` recovery note records that a committed-progress idle timeout is now resumable via `jarvis run resume`.
