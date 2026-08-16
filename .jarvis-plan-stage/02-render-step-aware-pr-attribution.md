# Render Step-Aware PR Attribution

## Problem

The attribution footer has chronological commit bullets and one combined author summary, but cannot show which workflow steps each agent performed.

## Decisions

- Only commits already eligible for attribution because their first non-trailer body line starts with `Spec: ` contribute labels or step counts.
- Recognized trimmed `Jarvis-Step` values match exactly `write`, `review [1-9][0-9]*`, `review-debate [1-9][0-9]*`, `mutation-repair`, or `ready-gate`. Review values normalize to `review` and `review-debate`; all other values are ignored.
- One unique recognized step value classifies a commit. Repeated identical values count once; conflicting recognized values, including distinct review pass values, make the commit unclassified for counts. A lone unrecognized or missing step never counts.
- Repeated identical non-empty `Jarvis-Agent` trailers count once per commit; each distinct non-empty agent on a classified commit receives that step once.
- Preserve chronological bullets and the exact combined `Written by <labels> through Jarvis.` line. Immediately below it, render one first-appearance-ordered `<Label> — Steps: ...` line for each agent whose eligible classified commits span more than one normalized kind; omit agents with zero or one kind and omit zero count kinds. The fixed order is write, review, review-debate, mutation-repair, ready-gate.

## Tasks

- Read `Jarvis-Step` trailers with `Jarvis-Agent` trailers and classify eligible subspec commits using the explicit grammar and duplicate rules.
- Add conditional per-agent ordered counts below the existing combined attribution summary without changing commit bullets or summary wording.
- Add focused attribution regressions and document step trailers, parsing, normalization, and footer placement in `v1/docs/worktrees-and-commits.md`.

## Acceptance criteria

- [ ] An eligible multi-agent history retains chronological commit bullets and `Written by <labels> through Jarvis.`, then renders one `<Label> — Steps: write <n>, review <n>, review-debate <n>, mutation-repair <n>, ready-gate <n>` line per qualifying agent in first-appearance order, omitting zero counts. `v2/src/execution/pr-attribution.test.ts` test `renders ordered mixed step counts per agent` fails against the pre-fix footer. `v2/src/execution/pr-attribution.test.ts` — `renders ordered mixed step counts per agent`; Keystone checkpoint:
- [ ] Review pass suffixes normalize before counting, repeated identical agent or step trailers do not inflate a count, and each distinct named agent on a classified commit receives that commit's one normalized step. `v2/src/execution/pr-attribution.test.ts` — `normalizes review steps and deduplicates trailers per commit`; Mutation checkpoint:
- [ ] Missing or unrecognized step trailers, conflicting recognized step trailers, and an agent whose eligible commits have only one normalized kind produce no `Steps:` line and do not satisfy the mixed-kind threshold. `v2/src/execution/pr-attribution.test.ts` — `suppresses invalid and single-kind step counts`; Mutation checkpoint:
- [ ] A commit outside the existing `Spec: ` attribution filter never contributes step counts even when it has valid `Jarvis-Agent` and `Jarvis-Step` trailers. `v2/src/execution/pr-attribution.test.ts` — `excludes non-subspec commits from step counts`; Mutation checkpoint:
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md` documents `Jarvis-Step` values, subject prefixes, normalization, duplicate handling, eligibility, and conditional per-agent footer counts.
