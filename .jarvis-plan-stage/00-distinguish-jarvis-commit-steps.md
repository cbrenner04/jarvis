# Distinguish Jarvis Commit Steps

## Problem

Jarvis-authored write, review, mutation-repair, and ready-gate commits currently reuse the creation title, so commit history and PR attribution cannot distinguish their workflow purpose.

## Decisions

- Workflow-context callers pass the step kind and review pass to the committer; rules out inferring workflow purpose from Git state or subjects.
- Missing step metadata, including legacy pending-commit data, normalizes to `write`; rules out invalidating existing callers or resumable commit files.
- `Jarvis-Step` is the classification contract and subjects remain reviewer-facing labels; rules out attribution parsing subjects.
- Step counts are computed per `Jarvis-Agent`, recognize only the five normalized kinds, and use workflow order; rules out PR-wide aggregation, legacy inference, and history-dependent ordering.
- Existing attribution bullets and agent summary wording remain; rules out a footer redesign beyond adjacent step counts.

## Tasks

- Extend the completion-commit contract and pending-commit recovery to emit `Jarvis-Step`, preserve bare write titles, and apply the specified review, mutation-repair, and ready-gate subject prefixes.
- Pass review kind and pass number, mutation-repair, and ready-gate context through workflow publication, recovery, autofix, and agent-repair commit paths without relabeling write commits.
- Parse `Jarvis-Step` trailers with `Jarvis-Agent` trailers and add conditional ordered per-agent counts to the existing attribution summary.
- Add focused completion-commit, workflow-runner, ready-repair, and attribution regressions, including linked mutation checkpoints for every added or modified guard.
- Update the durable commit and attribution contracts in `v1/docs/worktrees-and-commits.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A tracked light-review actuator change on pass 1 commits as `review(1): <title>` with `Jarvis-Step: review 1` beside `Jarvis-Agent`, while the surrounding write commit retains the bare `<title>` subject and `Jarvis-Step: write`; the focused workflow-runner test fails against the pre-fix identical subjects. `v2/src/execution/workflow-runner.test.ts` — `labels a light review mutation commit by workflow pass`; Keystone checkpoint:
- [ ] Debate review commits use `review-debate(<n>): <title>` with `Jarvis-Step: review-debate <n>`, and review metadata is supplied for intent and plan only when their review pass commits changes; `v2/src/execution/workflow-runner.test.ts` test `labels debate review commits by workflow pass` fails against the pre-fix message.
- [ ] Mutation-repair commits use `mutation-repair: <title>` with `Jarvis-Step: mutation-repair`; ready-gate autofix and agent-repair commits use `ready-gate: <title>` with `Jarvis-Step: ready-gate`; autofix commits also retain `Jarvis-Ready-Gate: autofix`; `v2/src/execution/workflow-runner.test.ts` test `labels mutation-repair commits` and `v2/src/execution/write-loop.test.ts` test `labels ready-gate repair commits` fail against the pre-fix messages.
- [ ] Direct write/completion commits keep `<title>` and add `Jarvis-Step: write`; a pending commit stored without step metadata resumes with the same write classification. `v2/src/execution/completion-commit.test.ts` — `defaults absent and legacy pending step metadata to write`; Mutation checkpoint:
- [ ] Each agent's existing attribution summary gains `Steps: write <n>, review <n>, review-debate <n>, mutation-repair <n>, ready-gate <n>` only when that agent's recognized trailer-bearing commits span multiple normalized kinds; zero counts are omitted, review pass suffixes normalize, multi-agent commits count for each named agent, and unrecognized or missing step trailers do not count. The focused footer test fails against the pre-fix footer. `v2/src/execution/pr-attribution.test.ts` — `renders ordered mixed step counts per agent`; Mutation checkpoint:
- [ ] Every added or modified guard has an in-test `// @mutate` directive in the focused completion-commit, workflow-runner, write-loop, or attribution test, and its focused test fails when the guard is inverted; negative cases prove write-only workflows, non-committing review passes, unrecognized trailers, and single normalized kinds do not gain suppressed labels or counts. `v2/src/execution/workflow-runner.test.ts` — `labels only review passes that commit changes`; Mutation checkpoint:
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md` documents `Jarvis-Step` values, subject prefixes, normalization, and conditional per-agent footer counts.
- `v2/docs/write-behavior.md` documents step-aware completion, review, repair, resume, and ready-gate commit messages.
- `v2/docs/v1-behaviors.md` records the widened v2 Jarvis-authored trailer set and attribution behavior.
