# Drop `## Commits` from the body template

## Problem

`renderTemplate` in `v2/src/execution/spec-run-body-summary.ts` emits `## Commits` (subject + `— <agent>` per bullet) from every commit in `baseRef..HEAD`, duplicating the attribution footer's commit list — which only covers commits whose first body line starts with `Spec:` (`pr-attribution.ts`'s `getSubspecCommits`).

## Decisions

- The single surviving commit list is the footer's existing `Spec:`-prefixed qualifying set, not every `baseRef..HEAD` commit — widening the footer to all commits is rejected because `Written by`/Steps already key off that same qualifying set, and a second, broader set would need its own filter to stay in sync. A hand-finish or repair commit without a `Spec:` first body line therefore drops out of the body's commit list entirely (same loss already accepted for `Written by`/Steps).
- Remove the `## Commits` section and `commitBullet`; do not relocate commit subjects elsewhere in the template.
- Remove the `readBranchCommits` call and its `.catch(() => [])`, the `commits` parameter feeding `renderTemplate`, and the now-unused `CommitInfo`/`readBranchCommits` import — `deriveSpecRunBodySummary` no longer reads commits at all.
- Commits no longer affect the template body; empty-input `(no content)` fallback applies when overview, subspecs, and diffs are all empty.

## Acceptance criteria

- [x] A test in `v2/src/execution/spec-run-body-summary.test.ts` asserts the rendered summary, given the file's existing mocked-commit fixture (subjects `older subject`/`new subject` with `Jarvis-Agent` trailers), contains no `## Commits` heading and no `- older subject — Claude Opus 4.8` bullet; it fails against the pre-fix code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § PR body refresh — template order is `## Overview`, `## Subspecs`, optional `## Risk cues`, `## Change summary`; no `## Commits`; commits appear once, in the attribution footer.
- `v2/docs/v1-behaviors.md` — update the v2-ported entries claiming `## Commits` and the attribution footer both list "every qualifying commit": `## Commits` is gone, so the footer's `Spec:`-prefixed set is now the body's sole commit list.
