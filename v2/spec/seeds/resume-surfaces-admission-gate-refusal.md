---
name: resume-surfaces-admission-gate-refusal
---

# Resume must return its admission-gate refusal reason to the user (CLI + TUI)

## Problem

When `jarvis run resume <id>` (and likely other admission-gated commands) is refused by an admission gate — the incomplete-re-run descendant check, `stale reuse refused`, dirty-tree gate, landed-criteria drift, etc. — the refusal reason is written to `~/.jarvis/daemon-*.log` but is **not returned to the operator**. The CLI appears to "fail immediately" with no actionable reason, and the TUI shows nothing. The operator cannot tell why resume did nothing without hand-reading the daemon process log.

Observed 2026-08-31 (operator, chess-mvp-yolo-2 `20260831T212133Z-home-screen-navigation`): a `completion_commit_failed` run's resume failed immediately. The real reason — `Cannot re-run incomplete spec: worktree HEAD <sha> is not a descendant of base main (<sha>); stale reuse refused` — was only in `daemon-*.log`. The `run list` row kept advertising `resumable: true` / `nextAction: resume`, so the operator had no signal that resume was structurally refused, not merely retryable.

Scope: primarily `run resume`; audit `pipeline resume` / `pipeline recover` / workflow re-run admission for the same swallowed-refusal shape (operator: "ive only seen it on resume but could be others").

## Decisions

- A resume refused by an admission gate returns the daemon's refusal reason to the CLI caller: non-zero exit with the reason string on stderr (verbatim daemon `reason`/message), not a bare/empty immediate failure.
- The same refusal is visible in the TUI (needs-attention / run detail), not only in `daemon.log`.
- Distinguish a structural admission refusal (won't succeed on re-issue as-is — descendant check, stale-reuse, dirty tree) from a transient/retryable failure, so `run list` / `wait` do not keep advertising `nextAction: resume` for a refusal the operator must resolve first (name the blocking condition instead).
- Out of scope: changing the admission gates themselves; this is purely surfacing their refusals. Related but distinct: `pipeline-resume-echoes-pipeline-id-on-success` (echo id on success).

## Acceptance criteria

- [ ] A `run resume` refused by the incomplete-re-run descendant / `stale reuse refused` gate exits non-zero with the daemon's refusal reason on stderr (regression asserts the reason text reaches the CLI, failing against the current daemon-log-only path).
- [ ] The same refused-resume condition is projected on `jarvis run list` / `jarvis run wait` as a named blocking state (not a plain `resumable: true` / `nextAction: resume` that hides the structural refusal).
- [ ] The TUI surfaces the refusal reason for the affected run (region-local assertion), rather than showing no change.
- [ ] `pipeline resume` / `pipeline recover` refused by an analogous admission gate likewise return the reason to the CLI (audit + cover whichever share the swallowed-refusal shape).
- [ ] `bun run typecheck` and the touched test surfaces pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — resume refusals surface their admission-gate reason on the CLI and TUI; when resume "does nothing", read that reason rather than the daemon process log.
- `v2/docs/daemon-host.md` — resume admission-gate refusals are returned to the caller, not only logged.
