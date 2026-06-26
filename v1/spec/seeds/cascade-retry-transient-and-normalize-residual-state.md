---
name: cascade-retry-transient-and-normalize-residual-state
---

# Cascade: retry transient agent errors + normalize residual state on agent-error

## Problem

When the whole `modes.patch.agentOrder` is unavailable in one run — primary
`claude` quota/`no progress`, `cursor` quota, `opencode` 500
(`UnknownError: Unexpected server error`) — `run` exits `agent-error (exit 3)`.
Two real problems (the work *is* resumable, so this is **not** about
resumability):

1. **Transient agent errors aren't retried.** A single opencode 500 ends the
   run; a short retry/backoff would have ridden it out.
2. **Residual worktree state is inconsistent**, making the otherwise-supported
   resume bumpier than it should be:
   - iter 0: orphan worktree + branch at base, no commits — needs
     `git worktree remove --force` + `git branch -D` before a fresh run or it
     collides (#520's un-tick/strip cleanup is a no-op here).
   - iter ≥1: a `WIP: … (N/M criteria)` commit on a local branch, and/or a dirty
     worktree with uncommitted edits + agent litter (stray `test_output.txt`).

**Likely trigger — shared quota.** The primary `claude` patch agent draws the
**same Claude pool as the operator's orchestration loop**, so an active operator
session starves it first → immediate cascade onto cursor/opencode. Pausing the
operator session and resuming the same spec ran clean. Intake #585. Observed
this session too (operator-active runs cascaded off claude/haiku immediately).

## Direction

1. **Retry transient agent errors** (opencode `UnknownError`/500, network blips)
   with bounded backoff before declaring `agent-error` — distinct from quota
   (escalate) and no-progress (escalate). Reuse the existing transient-retry
   machinery (`withSyncTransientRetry`/agent error classification) where it fits.
2. **Normalize residual worktree/branch state on `agent-error`** so resume/triage
   is friction-free: always leave either a committed WIP branch or a clean no-op.
   Extend #520's re-run cleanup to also retire the iter-0 orphan worktree+branch
   and clear agent litter.
3. **(Optional) Surface shared-pool contention** — warn when the patch primary
   shares a model pool with an active operator/orchestration session.

## Out of scope

- Resumability itself (already works: re-run `jarvis1 run <index.md>`,
  `--resume-review`, `jarvis1 triage <name> --mark-ready`).
- Actuator model-quality floor (separate — `actuator-model-floor-and-subrole-tiering`).

## References

- Intake #585; siblings #519 (flaky gate), #520 (re-run hygiene), #547 (mid-run
  abort stranding partial work).
- Transient classification/retry: `v1/src/agents/` (`quota.ts`, `gh.ts`
  `withSyncTransientRetry`), patch cascade in `v1/src/modes/patch/`.
