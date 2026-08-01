Reviewing the implementation and checking doc alignment the advocate flagged.
# Verdict

## Required outcomes

1. **`v2/docs/workflow-runner.md` — pipeline handoff must match shipped behavior**  
   The paragraph at ~122–127 still describes chained implement `specPath` as pass-through from the prior artifact. That contradicts the three updated durable homes (`operator-runbook.md`, `v1-behaviors.md`, `daemon-host.md`) and misstates current behavior. Align it with plan directory → implement `<dir>/index.md` normalization at stage resolution (minimal wording or a cross-link to operator-runbook § Pipeline start). Per documentation standard: one durable home, but cross-linked surfaces must not assert the old contract.

2. **`v2/spec/implement-queue.md` — close the open phase gate for this bug**  
   The queue still records chained implement as failing at resolution (directory vs `index.md`) and treats the fix as blocking pipeline completion. With this subspec’s acceptance criteria satisfied, that gate is stale and will misroute follow-on work. Update it to reflect shipped handoff normalization and remove or correct the “fails every time” / manual `--spec <dir>/index.md` workaround language.

## Rationale

Checked acceptance criteria are met: normalization in `resolveImplementStage` before the builder fork, bare-directory fixtures, error shape, mutation checkpoints, and the three named doc homes. No code change is required to close the reported plan→implement handoff bug.

The two items above are documentation consistency defects, not scope expansion. They describe the same behavior change already landed in code and in the subspec’s doc ACs; leaving them wrong would tell operators and harness planners the pre-fix world still holds.

## Not required (this pass)

- Tightening pass-through from `endsWith(".md")` to `basename === "index.md"` — subspec narrowed failure modes to directory-without-`index.md`; plan artifacts are directories in production.
- Real preset-builder regression with a bare-directory fixture — fake-builder ACs plus normalization before both builder branches cover the contract; verdict-plan declined this.
- `stat.isFile()` on the index path, `cwd`/`baseRef` on the pass-through AC, comment relocation into `resolveImplementStage`, or syncing `intent.md`/task-checklist — hygiene or follow-up only; not gaps against checked ACs.