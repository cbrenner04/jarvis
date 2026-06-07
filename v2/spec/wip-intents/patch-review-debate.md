---
name: patch-review-debate
---

# Intent: structure patch review as adversary → defense → judge

Restructure patch (implementation) review into a three-role debate instead of N
identical critique passes:

1. **Adversary** (read-only) — reviews the diff hard, writes a findings artifact.
2. **Defender** (read-only) — reads findings, writes a rebuttal artifact.
3. **Judge** (sole writer) — reads both, reconciles, applies fixes, commits.

## Shape

- Rides on the unified review runner (PR #193). Roles are passes via the
  existing `adapterForPass` seam; each role injects the prior role's artifact as
  prompt context. No new engine.
- Only the judge writes the tree — collapses the write boundary to one role.
- Commit each role for a durable debate trail (`review: adversary` /
  `review: defense` / `review: judge`); empty judge → no commit (existing
  no-change skip).
- Patch only to start; plan review keeps its current N-pass shape.

## Philosophy (locked)

Less is more — trust the agents.

- **No materiality gate, no convergence/stop-on-empty logic.** If there's
  nothing to find, the roles say so and the judge no-ops naturally. The harness
  does not adjudicate whether a finding is "real" — that's the judge's job,
  in-band. (See [[plan-refine-precision-amplifier]] — the fix for manufactured
  findings is prompt permission to find nothing, not control flow.)
- Cycle count is just the existing review pass setting. No special bounds beyond
  that.

## Open

- Same agent in three role-prompts vs. three different agents (genuine
  adversarialism vs. quota/fallback cost).
- Commit the debate artifacts vs. keep ephemeral like the blocker sentinel.

## Out of scope

- Plan review changes.
- Any convergence/materiality detection in the harness.
