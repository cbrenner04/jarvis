---
name: blocked-outcome-carries-blocker-text
---

# A blocked outcome carries blocker text or is reported as a harness defect

Run `e93a8429-2726-400b-9643-0fb753340f99` reported `blocked` / `agent_blocked` /
`inspect_spec` with no `## Blocker` anywhere — not in the spec on `main`, not in the
worktree copy. The log holds only `iteration_started` → `boundary_committed(blocked)` →
`loop_finished(blocked)`. `inspect_spec` is a reason code, not an explanation, so the
operator has nothing to act on.

The blocked outcome must carry the agent's blocker text. A block with no blocker text is a
harness defect and must be reported as one, not recorded as a bare `blocked`.

## Decisions

- A blocked outcome persists the agent's `## Blocker` text onto the run, reachable without the worktree. Rules out "the text is in the spec, go read it" — the spec copy may not survive or may never have been written.
- A block with no blocker text is surfaced as a distinct harness-defect outcome, not a plain `blocked`. Rules out silently recording `blocked` with an empty reason.
- The workflow `implement` path is in scope: `write-loop`'s existing `missing_blocker` handling did not fire here, so confirm where that path diverges rather than assuming the seed `blocked-outcome-with-no-blocker-text` fix (deleted in #1481) already covers it.

## Out of scope

- Worktree and branch retention on the blocked path — separate behavior.

## Prerequisites

## Documentation updates

- `v2/docs/operator-runbook.md` — what a blocked run reports and where the blocker text appears.
- `v2/docs/v1-behaviors.md` — record the blocked-outcome reporting behavior.
