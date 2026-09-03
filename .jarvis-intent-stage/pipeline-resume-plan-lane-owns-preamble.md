---
name: pipeline-resume-plan-lane-owns-preamble
---

# Pipeline resume owns the failed plan-lane preamble

## Problem

Resuming a failed fan-out plan lane still expects a manual preamble — clean the branch, merge main, remove staged blockers — before `jarvis pipeline resume <pipeline-id> <branch-key>`. Steps 1–2 are cargo cult when stale reset retires the lane; step 3 is usually unnecessary when the blocker is the reserved harness contract-miss marker, not an operator `## Blocker`.

## Decision ledger

- `pipeline resume` performs the full failed-plan preamble itself — settle worktree state, bring the lane to base, clear reserved harness blocker sections, dispatch; rules out the operator hand-executing those steps before every resume.
- Resume prints one success line naming worktree disposition — retired-and-rematerialized from base versus reused existing tree; rules out invisible destructive-vs-preserving paths that teach preservation work on a tree about to be deleted.
- Operator-authored `## Blocker` still refuses before destructive retirement; rules out convenience that eats real operator decisions.
- Every refusal or blocker message that references the staged plan file prints its resolved absolute path; rules out `.jarvis-intent-stage/` versus `.jarvis-plan-stage/` folklore.
- Uncommitted change that is not recognisable harness draft dirt is preserved or named in the refusal; rules out silent discard of operator work outside the auto-clear contract.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` resumes a failed plan lane whose staged `intent.md` carries only the reserved `Artifact contract check failed:` section and proves dispatch without any manual edit; fails against a path that refuses or requires operator removal first.
- [ ] `pipeline-execution.test.ts` resumes a failed plan lane over a dirty worktree containing only harness draft dirt and proves dispatch without a manual commit; fails against the pre-fix dirty-reuse refusal.
- [ ] `pipeline-execution.test.ts` proves an operator-authored `## Blocker` still refuses and the refusal message contains the resolved absolute path of the staged `intent.md`; fails against a message that omits the path.
- [ ] `pipeline-execution.test.ts` proves successful failed-plan resume reports retired-and-rematerialized versus reused worktree disposition on stdout or stderr; fails against a success path that omits disposition.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: delete the manual preamble; state that resume owns it and which cases retire the lane versus reuse it.
- `v2/docs/pipeline-execution.md` — plan-lane resume contract: reserved versus operator blocker, worktree disposition in each path, absolute staged-file paths in messages.
- `v2/docs/v1-behaviors.md` — record plan-lane resume preamble ownership and disposition reporting.

## Primary implementation surface

v2/src/daemon/pipeline-execution.ts

## Prerequisites

- Failed plan-lane `pipeline resume` redraft already skips the dirty-worktree gate and rematerializes from base through shared stale-reset preflight when reset flags engage.
