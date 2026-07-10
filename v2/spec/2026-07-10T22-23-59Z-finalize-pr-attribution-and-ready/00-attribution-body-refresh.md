# Attribution footer and PR body refresh

## Problem

The v2 completion publisher opens a draft PR whose body is a bare `Spec: <specPath>` line. Reviewers cannot see which agents authored its commits. v2 has no attribution renderer; v1's lives in `v1/src/pr.ts`, which v2 must not import. This slice ports the commit-selection and label-dedup semantics into v2 and refreshes the ensured PR body from them.

## Decisions

- Footer derives from `Jarvis-Agent` trailers on `baseRef..HEAD` commits whose first body line begins with `Spec: ` — rules out binding attribution to the completion agent, the current process, or state-store attempt rows.
- Labels dedup first-seen in commit order; a qualifying commit without a `Jarvis-Agent` trailer renders `unknown` in its bullet and is excluded from the summary — rules out alphabetizing, reordering, or dropping unlabeled commits from the bullet list.
- Refresh runs after the PR is ensured, editing the ensured PR's body — rules out setting body at creation time or opening a second PR.
- Refreshed body = regenerated `Spec:` header + footer, preserving only content between the stable narrative markers (`<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`) when present — rules out clobbering operator narrative and rules out promising arbitrary header/footer edits survive refresh.
- Body refresh is a step of the retryable publication boundary: a transient `gh` failure surfaces as retryable publication failure preserving the completed durable boundary — rules out failing the run hard or silently leaving a stale body.
- Reuse the existing v2 transient-retry and injectable git/`gh` seams from the publisher — rules out a second retry policy or live-network tests.

## Scope

- Port v1 commit selection (`readBranchCommits`) and footer rendering (`renderAttribution` bullet list + `Written by … through Jarvis.` summary) into `v2/src`.
- After the publisher ensures the draft PR, refresh its body with header + footer, preserving narrative-marker content.
- Route refresh through the existing publication retry/seam machinery.
- Cover commit selection, label dedup, `unknown` labeling, marker preservation/absence, and retryable refresh failure with injected-seam tests.
- Update the durable PR lifecycle and v1 parity documentation.

## Acceptance criteria

- [ ] After a completed run's draft PR is ensured, its body is refreshed to include an attribution footer rendered from `Jarvis-Agent` trailers on `baseRef..HEAD` commits whose first body line begins with `Spec: `.
- [ ] The footer lists one bullet per qualifying commit in chronological order as `- <shortSha> <subject> — <label>`, followed by a `Written by <labels> through Jarvis.` summary; labels are deduplicated first-seen in commit order; a qualifying commit with no `Jarvis-Agent` trailer renders `unknown` and is excluded from the summary.
- [ ] Content between the `<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->` markers in the existing PR body is preserved across refresh; when the markers are absent, the body is the regenerated `Spec:` header plus footer.
- [ ] Body refresh edits the ensured PR without opening a new one; a transient `gh` refresh failure returns a retryable publication failure that leaves the durable run `completed`, and resume re-refreshes without duplicating the PR.
- [ ] Attribution and refresh tests use injected git/`gh` seams and require no live remote or GitHub credentials.
- [ ] `v2/docs/write-behavior.md` documents attribution rendering (commit selection, label dedup, `unknown` labeling), the post-PR body refresh, narrative-marker preservation, and retryable refresh failure.
- [ ] `v2/docs/v1-behaviors.md` marks the ported attribution-footer and PR-body-refresh behaviors.

## Documentation updates

- Extend `v2/docs/write-behavior.md` (durable v2 PR lifecycle home) with the attribution + body-refresh behavior.
- Mark ported behaviors in `v2/docs/v1-behaviors.md`.
