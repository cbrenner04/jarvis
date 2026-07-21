# Review roles are asked to find logic errors in code they are never shown

## Problem

Every implement review role is handed a change *summary*, not the change. `branchDiff`
(`shared/prompts/review-implement.ts:45`) runs `git diff --stat` and `git diff --name-only`,
joins them, and discards the content. That string becomes `BRANCH_DIFF` for
`prompts/patch/review-critic.md`, `review-adversary.md`, `review-advocate.md`,
`review-adjudicator.md`, and `review.md` — all of which state:

> The text between `<<<DIFF_BEGIN>>>` and `<<<DIFF_END>>>` is a branch change summary
> (`git diff --stat` plus changed paths) for this branch against the base branch — **not a unified
> diff**.

while the instructions ask the same role to report:

> - Potential bugs or subtle logic errors

The spec tree, by contrast, is supplied in full: `visit()` reads **every** `.md` file under the spec
directory verbatim. So the reviewer's only substantial input is prose, and it reviews prose.

That is exactly what the verdicts look like. PR #1880's debate review produced five required items —
stale runbook wording, undocumented digest rules, doc/doc disagreement, and thin advance-contract
tests. All correct, all documentation and test-thinness. Meanwhile the same PR shipped a daemon
whose executable-tree digest was `sha256("")` on every checkout, so no dispatch could ever succeed.
Finding that required reading `getExecutableTreeDigest` and its one call site — three lines of code
the reviewer was never given.

Roles may read files on their own initiative, and #1880's critic evidently did to some degree (its
verdict cites `{ currentRevision, currentExecutableDigest }` by name). But nothing in the contract
supplies the change under review, and the prompt's framing implies the summary *is* the input.

## Decisions

- Supply the actual unified diff of the branch against its merge base as the review input; the
  stat summary stays as orientation, not as a substitute.
- Bound the payload rather than truncating blindly: prioritize production source over tests,
  fixtures, and lockfiles, and pin the exact budget and ordering policy in the plan. An
  unbounded diff on a large branch must not blow the context window.
- When the diff is trimmed, say so explicitly in the prompt and name what was omitted, so the
  reviewer knows its view is partial instead of assuming completeness.
- Apply to every implement review role — critic, adversary, advocate, adjudicator — so debate roles
  argue over the same evidence.
- Correct the prompt language that currently tells the role its input is not a unified diff.
- Out of scope: plan and intent review, whose artifacts are markdown already supplied in full.

## Acceptance criteria

- [ ] Implement review roles receive the unified diff of the branch against its merge base, not
      only `--stat` and `--name-only`.
- [ ] Production source hunks are included ahead of test, fixture, and lockfile hunks when the
      payload is bounded.
- [ ] A trimmed payload states that it was trimmed and lists the omitted paths.
- [ ] All four debate roles and the light-review critic receive the same diff content.
- [ ] Prompt text no longer describes the input as "not a unified diff".
- [ ] A regression fails against the current summary-only `BRANCH_DIFF`.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — what the review roles receive.
- `v2/docs/v1-behaviors.md` — record the changed review input.
