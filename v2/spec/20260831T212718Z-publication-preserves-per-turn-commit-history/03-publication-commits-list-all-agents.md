# Publication Commits block and footer list every per-turn agent

## Problem

`deriveSpecRunBodySummary` renders `## Commits` with subjects only. After per-turn history is restored, operators still cannot see which agent authored each commit in the spec-run body summary. Superseded #3234 attribution tests expect a single review-classified commit whose `Jarvis-Agent` was swapped to the write-stage agent; multi-commit history requires every qualifying commit to appear in the footer with its own agent.

## Surface

`v2/src/execution/spec-run-body-summary.ts`, `v2/src/execution/pr-attribution.ts`, `v2/src/execution/workflow-runner-publication.test.ts`, `v2/src/execution/completion-commit.test.ts`, and co-located tests.

## Decision ledger

- `## Commits` lines include each commit's `Jarvis-Agent` label alongside its subject; rules out subject-only bullets that hide per-turn authorship.
- v2 lists every qualifying `Spec:` commit ahead of base individually in `## Commits` and footer bullets; rules out v1 plan-mode consecutive meta-commit grouping in v2 publication output.
- Attribution footer `Written by` dedupes agent labels across all qualifying `Spec:` commits ahead of base; rules out crediting only the terminal review agent when earlier write commits used different agents.
- Replace superseded single-commit `publishedCommitAgent` carry-forward tests in `workflow-runner-publication.test.ts` and `completion-commit.test.ts` with multi-commit expectations; rules out keeping one review-classified commit whose agent was swapped to the write-stage agent.

## Task checklist

- Extend `deriveSpecRunBodySummary` / `renderTemplate` so each `## Commits` bullet shows subject and `Jarvis-Agent` for commits ahead of base.
- Verify `renderAttribution` footer bullets and `Written by` line include every distinct agent on qualifying commits once per-turn history is present; adjust only if a gap remains after subspec 00 lands.
- Rewrite `workflow-runner-publication.test.ts` tests `write-stage-attribution-footer`, `single-agent-attribution-footer`, and `no-content-ahead-of-base` (empty-marker rollback) for multi-commit per-turn history instead of one CAS-replaced review commit.
- Invert or replace `completion-commit.test.ts` regressions that assert `publishedCommitAgent` carry-forward on terminal publication commits (cross-reference subspec 00).
- Add a `workflow-runner-publication.test.ts` regression that renders the implement spec-run body summary and asserts `## Commits` lists each per-turn commit with its `Jarvis-Agent`.

## Acceptance criteria

- [ ] `workflow-runner-publication.test.ts` test `implement spec-run body summary Commits block lists each per-turn commit with its Jarvis-Agent` fails when only the review agent is credited or agents are omitted from Commits bullets and passes after the fix.
- [ ] `workflow-runner-publication.test.ts` test `credits every contributing agent in the attribution footer when write and review agents differ` fails against the current review-only footer on collapsed history and passes with per-turn commits.
- [ ] `pr-attribution.test.ts` stays green.
- [ ] `spec-run-body-summary.test.ts` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

Deferred to [04 - Document per-turn publication commit history](./04-publication-commit-history-docs.md).
