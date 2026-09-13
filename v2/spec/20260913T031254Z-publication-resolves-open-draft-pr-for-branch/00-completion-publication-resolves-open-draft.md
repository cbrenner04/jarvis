# Completion publication resolves an open draft or opens a fresh one

## Problem

`findOrCreatePr` in `v2/src/execution/completion-publisher.ts` falls through open → merged → create, so a multi-subspec branch whose only matching PR is merged or closed reuses that dead PR's number as publication evidence. A later ready-flip call ([subspec 01](./01-ready-flip-targets-resolved-draft.md)) inherits that dead number and fails. This subspec scopes to publication's own PR resolution: what it reuses, creates, and refuses.

## Decisions

- Resolve by open PRs whose head and base match; ignore merged/closed history entirely — rules out the current open→merged→create fallback that reuses a dead PR as live evidence.
- No matching open PR found: create a fresh draft and confirm it by number — rules out surfacing "no PR" as a publication failure when a fresh draft is the recoverable default.
- Exactly one matching open PR found: reuse it unchanged (no retitle, no draft-state change) before the existing body-refresh sequence — matches `reuses existing open PR with matching base` (completion-publisher.test.ts:379).
- More than one matching open PR found: refuse with a named ambiguous-match error listing both numbers — rules out picking the most-recent one, which reintroduces the same drift this fix removes.
- A matching open PR that is not a draft: refuse before body refresh with a named error naming the PR number, branch, expected draft state, and recovery (mark it draft again, or close/merge it) — rules out reusing a ready PR as if it were still a draft.
- Base retargeting (`effectiveBaseRef`) stays upstream of and unchanged by this resolver; the resolver only ever matches against the already-retargeted base, so `ignores open PRs with different base` (completion-publisher.test.ts:442) is preserved by construction, not overridden.
- `gh pr create` failing with "No commits between" (a reused branch with no diff beyond its old closed/merged PR) surfaces as a named no-publishable-commits error instead of the raw GitHub string.
- The new no-open-draft, ambiguous-match, open-non-draft, and no-publishable-commits errors compose with the existing publication-retry boundary the same way today's failures do (transient-vs-permanent classification, `resumable` unchanged) — no new failure-kind or resume-policy surface.
- This resolver is exported for [subspec 01](./01-ready-flip-targets-resolved-draft.md)'s pipeline terminal publication to reuse for its own pre-flip re-check — rules out terminal publication reimplementing its own open/draft matching policy that could diverge from this one.
- Tests exercise these paths through the existing injected `git`/`gh` seams; no live GitHub calls.

## Task checklist

- [ ] Replace `findOrCreatePr`'s open→merged→create fallback with open-only resolution: zero matches creates, one match reuses, more than one refuses.
- [ ] Add the open-non-draft refusal, naming the PR number, branch, expected state, and recovery, before body refresh runs.
- [ ] Add the no-publishable-commits refusal for `gh pr create`'s "No commits between" failure.
- [ ] Export the open-draft resolver for reuse by pipeline terminal publication.
- [ ] Add regression coverage: historical-only branch, ambiguous multiple opens, open non-draft, no-publishable-commits.

## Acceptance criteria

- [ ] A regression test in `v2/src/execution/completion-publisher.test.ts` supplies only merged/closed same-branch/base PR history, observes a new draft being created and confirmed, and receives that new PR's evidence; it fails against the pre-fix merged-PR reuse proven today by `returns a merged PR without creating a second PR when the branch already has a merged PR` (completion-publisher.test.ts:950).
- [ ] A single matching open PR is reused without creating or retitling a PR, then continues through the existing body-refresh and finalization sequence, per `reuses existing open PR with matching base` (completion-publisher.test.ts:379).
- [ ] A regression test supplies two matching open PRs for the same branch/base and observes a pre-finalization failure naming both PR numbers instead of silently selecting one; it fails against the pre-fix path, which has no ambiguity check.
- [ ] A regression test supplies a matching open non-draft and observes a pre-finalization failure naming its PR number, branch, expected draft state, and recovery to mark it draft or close/merge it; it fails against the pre-fix path that reuses the ready PR.
- [ ] A regression test drives `gh pr create` to a "No commits between" failure and observes a named no-publishable-commits error instead of the raw GitHub string reaching the caller.
- [ ] `ignores open PRs with different base` (completion-publisher.test.ts:442) and the base-retarget tests stay green (retarget resolution unaffected).
- [ ] `v2/src/execution/completion-publisher.test.ts` push, title, and body-refresh tests stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — remove the merged-PR reuse idempotency description; document open-only resolution and fresh-draft creation on a historical-only branch.
- `v2/docs/v1-behaviors.md` — record completion publication's restored closed/merged exclusion as a change to existing behavior.
