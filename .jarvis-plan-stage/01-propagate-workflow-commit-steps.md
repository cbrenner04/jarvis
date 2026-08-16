# Propagate Workflow Commit Steps

## Problem

Workflow callers do not identify review and repair commits, so review passes, repair paths, and their recovery paths reuse the write commit label.

## Decisions

- Workflow callers supply step kind and review pass to the committer; it does not infer purpose from Git state or a subject.
- A review commit belongs to the latest review pass that left the tracked mutation included in that publication, and to that pass's mutating actuator agent. A later non-mutating approval, including one from another agent, creates no commit and cannot replace that ownership.
- Intent and plan review calls supply review metadata only when the pass commits changes; their write subjects remain unchanged.
- Mutation-repair and every ready-gate repair publication, including autofix and agent repair, carry their respective context through interruption, publication retry, and finalization resume.

## Tasks

- Pass review kind and pass number through review publication and recovery, including intent, plan, light review, and debate review paths.
- Pass mutation-repair and ready-gate context through repair, autofix, agent-repair, publication retry, and finalization-resume calls.
- Apply `review(<n>):`, `review-debate(<n>):`, `mutation-repair:`, and `ready-gate:` subjects with their matching `Jarvis-Step` trailers without relabeling write commits.
- Add focused workflow-runner and write-loop regressions and update `v2/docs/v1-behaviors.md` with the widened v2 Jarvis-authored trailer set.

## Acceptance criteria

- [ ] A tracked light-review actuator change on pass 1 commits as `review(1): <title>` with `Jarvis-Step: review 1` beside `Jarvis-Agent`, while the surrounding write commit retains the bare `<title>` subject and `Jarvis-Step: write`; the focused workflow-runner test fails against the pre-fix identical subjects. `v2/src/execution/workflow-runner.test.ts` — `labels a light review mutation commit by workflow pass`; Keystone checkpoint:
- [ ] A non-committing review pass and a write-only workflow leave no review label, and intent and plan supply review metadata only for a pass that commits changes. `v2/src/execution/workflow-runner.test.ts` — `labels only review passes that commit changes`; Mutation checkpoint:
- [ ] When an earlier mutating review pass is followed by approval without changes, the sole publication keeps the earlier pass number and its actuator's `Jarvis-Agent`; a different later actuator cannot take ownership. `v2/src/execution/workflow-runner.test.ts` — `attributes a delayed review publication to its last mutating pass`; Mutation checkpoint:
- [ ] Debate review commits use `review-debate(<n>): <title>` with `Jarvis-Step: review-debate <n>`, and the focused workflow-runner test fails against the pre-fix message. `v2/src/execution/workflow-runner.test.ts` — `labels debate review commits by workflow pass`; Mutation checkpoint:
- [ ] Mutation-repair commits use `mutation-repair: <title>` with `Jarvis-Step: mutation-repair`, and the focused workflow-runner test fails against the pre-fix message. `v2/src/execution/workflow-runner.test.ts` — `labels mutation-repair commits`; Mutation checkpoint:
- [ ] Ready-gate autofix and agent-repair commits use `ready-gate: <title>` with `Jarvis-Step: ready-gate`; autofix also retains `Jarvis-Ready-Gate: autofix`, and the focused write-loop test fails against the pre-fix messages. `v2/src/execution/write-loop.test.ts` — `labels ready-gate repair commits`; Mutation checkpoint:
- [ ] Interrupted pending commits and publication/finalization resumes retain review, mutation-repair, and ready-gate subjects and steps rather than falling back to write. `v2/src/execution/workflow-runner.test.ts` — `retains workflow step across publication and finalization resume`; Mutation checkpoint:
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` records the widened v2 Jarvis-authored trailer set and step-aware review and repair behavior.
