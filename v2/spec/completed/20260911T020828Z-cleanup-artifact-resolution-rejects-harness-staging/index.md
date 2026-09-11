---
name: cleanup-artifact-resolution-rejects-harness-staging
---

# Keep retired-worktree archival inside the spec home

Cleanup must resolve a real durable spec before offering post-retirement archival, ignoring harness-owned staging identities and rechecking the resolved source before previewing it.

- [ ] [00-tighten-retired-artifact-resolution.md](./00-tighten-retired-artifact-resolution.md) — reject harness staging and unproven sources, and guard dry-run preview against a vanished source
