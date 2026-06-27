---
name: finalize-refuses-when-behind-base
description: Finalize refuses a worktree behind its base, reporting resolve-then-re-invoke instead of gating drifted code
---

# Finalize refuses when behind base

Integration-merge of an advanced base and conflict resolution are out of scope for
the first cut. When the worktree's branch is behind its base, finalize must not
commit, gate, or ready a drifted tree.

Instead it reports "behind base, resolve then re-invoke" and exits non-zero without
partial finalization. This keeps the finalize flow from readying code that was never
gated against current base.

## Prerequisites

- Finalize commits/gates/readies a complete-but-dirty worktree via triage --mark-ready
