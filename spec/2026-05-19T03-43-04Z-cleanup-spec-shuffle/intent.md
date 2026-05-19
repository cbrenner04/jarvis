---
name: cleanup-spec-shuffle
---

`jarvis cleanup` already performs the spec shuffle by moving the matching
in-repo spec directory from `spec/` to `spec/completed/` after the merged
worktree and branch are removed.

The intended change is much simpler: track the exact spec directory cleanup
moved, then commit only that archive move. Do not redesign cleanup source
resolution, add timestamped plan-spec lookup, or change the cleanup gates.
