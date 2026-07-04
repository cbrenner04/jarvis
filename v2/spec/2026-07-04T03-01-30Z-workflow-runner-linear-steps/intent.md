---
name: workflow-runner-linear-steps
---

# Run a linear array of steps with bounded per-step loops

v2/src gains a workflow runner: a linear-with-bounded-loops array of steps.
Each step binds a behavior (loop primitive, e.g. `write`), a prompt, and a
role (per `v2/docs/role-resolution.md`); the runner executes steps in order,
looping each step's own behavior (e.g. the existing write loop) until that
step's completion condition, then advances to the next step.

Durable state grows to carry step identity and cross-step attempt history:
new schema migration adding step IDs to the existing `runs`/`attempts` tables
(or a new `steps` table), so a run's per-step attempt history is queryable
after kill/resume.

Decisions:
- Steps name a role, not an agent or model directly (source/config seam).
- Step behaviors stay orchestration primitives (`write` now; `review-debate`/`human` land in Phase 6) — behaviors are not renamed to match roles.
- Resume re-enters at the last incomplete step's last loop boundary, consistent with the existing single-step kill-resume model.

## Prerequisites
