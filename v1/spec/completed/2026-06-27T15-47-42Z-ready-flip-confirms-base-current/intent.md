---
name: ready-flip-confirms-base-current
description: Flipping a PR to ready confirms the branch is not behind its base before marking ready
---

# Ready flip confirms base is current

Before the harness flips a draft PR to ready (patch and plan modes), confirm the
branch is not behind its base. A PR can pass the local ready gate yet be behind an
advanced base, so it merges into untested state or conflicts.

Observable behavior: when the branch is behind base at ready time, the harness
surfaces it (and leaves the PR draft / does not silently mark ready) rather than
flipping a stale branch to ready. When the branch is current with base, the ready
flip proceeds as today.

## Prerequisites
