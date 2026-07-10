# Attribution footer and PR body refresh

## Problem

The v2 completion publisher opens a draft PR whose body is a bare `Spec: <specPath>` line. Reviewers cannot see which agents authored the work. v2 has no attribution renderer; v1's lives in `v1/src/pr.ts`, which v2 must not import. This slice ports v1's commit-selection and footer-rendering into `v2/src` and refreshes the ensured PR body from them.

## Reconciling attribution with the v2 collapse model

v2 does **not** create per-subspec commits. A completed run collapses all work into one `jarvis: complete run` meta-commit whose first body line is `Spec: <specPath>` and which carries a `Jarvis-Agent` trailer (see [`write-behavior.md`](../../docs/write-behavior.md) commit phase). So on `baseRef..HEAD` exactly one commit qualifies under v1's `Spec: `-prefix selection.

This slice **accepts the collapse model** (R1 option B): attribution is rendered from the meta-commit's own `Jarvis-Agent` trailer(s), not from many per-attempt commits. This corrects the intent's headline decision "rules out binding attribution to the completion agent": under the collapse, the meta-commit's trailer *is* the honest attribution source. Today that commit carries exactly one trailer — the final successful binding — so the footer is a single bullet naming that agent.

The ported renderer already handles the general N-commit / N-trailer case (a commit's trailers are an array; the bullet joins them, the summary dedups first-seen). That generality is preserved verbatim so the footer becomes multi-agent for free if the meta-commit later carries one trailer per contributor.

`Deferred to first consumer: recording one Jarvis-Agent trailer per contributing binding on the meta-commit (so the footer names every agent, not only the final one) — pin when a caller needs multi-agent attribution.`

## Decisions

- Footer derives from `Jarvis-Agent` trailer(s) on `baseRef..HEAD` commits whose first body line begins with `Spec: ` — under v2's collapse this selects the single `jarvis: complete run` meta-commit; rules out binding attribution to the current process or state-store attempt rows.
- Attribution is the selected commit's own trailers (today the final successful binding), not the last agent the completion publisher happened to run — rules out reading `process`/CLI state instead of the commit.
- The ported renderer keeps v1's per-commit bullet + first-seen label dedup + `Written by … through Jarvis.` summary unchanged; a qualifying commit with no `Jarvis-Agent` trailer renders `unknown` in its bullet and is excluded from the summary — rules out re-deriving a v2-specific renderer that drops v1's multi-trailer generality.
- Zero qualifying commits ⇒ empty footer ⇒ body is the regenerated header (plus narrative if present) with **no** `---` separator (v1 `updatePrBody` parity) — rules out emitting a dangling separator over an empty footer.
- Refresh runs after the PR is ensured, editing the ensured PR's body — rules out setting body at creation time or opening a second PR.
- Refreshed body = regenerated `Spec:` header + `---` + footer, preserving only content between the plain narrative markers (`<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`) when present — rules out clobbering operator narrative and rules out promising arbitrary header/footer edits survive refresh.
- Only the plain-marker narrative is preserved; v1's hash-verified generated-narrative mechanism (`jarvis:narrative:generated-sha256:`) is deliberately **not** ported — rules out reading this as an accidental omission.
- Body refresh is a step of the retryable publication boundary: a transient `gh` failure surfaces as the existing retryable publication failure (`completion_commit_failed`, `nextAction: resume`), leaving the durable run `completed` — rules out failing the run hard or silently leaving a stale body.
- Reuse the existing v2 publisher transient-retry and injectable git/`gh` seams — rules out a second retry policy or live-network tests.

## Post-publish boundary ordering (shared with slice 01)

The two slices form one ordered post-completion sequence: **push+PR → body refresh (this slice) → ready gate → draft→ready flip (slice 01)**.

- Body refresh joins the existing publication boundary. Its failures reuse `completion_commit_failed` (retryable, `resume`); run stays `completed`.
- The gate+flip (slice 01) is a **separate** finalization boundary that runs only after publication (incl. refresh) succeeds; its failures use a distinct reason (see slice 01), run stays `completed`.
- Resume replays in order: publication boundary first (commit → push → PR → refresh, all idempotent — refresh edits the same PR), then the gate+flip boundary.

## Scope

- Port v1 commit selection (`readBranchCommits`) and footer rendering (`renderAttribution`: bullet list + `Written by … through Jarvis.` summary, incl. `unknown` and empty-footer handling) into `v2/src`.
- After the publisher ensures the draft PR, refresh its body with header + footer, preserving narrative-marker content, with v1 `updatePrBody`'s empty-footer/no-separator shape.
- Route refresh through the existing publication retry/seam machinery.
- Cover single-meta-commit selection, multi-trailer render (general case), `unknown` labeling, empty-footer body shape, marker preservation/absence, and retryable refresh failure with injected-seam tests.
- Update the durable PR lifecycle and v1 parity documentation.

## Acceptance criteria

- [ ] After a completed run's draft PR is ensured, its body is refreshed to include an attribution footer rendered from `Jarvis-Agent` trailer(s) on the `baseRef..HEAD` commit(s) whose first body line begins with `Spec: ` (v2's single `jarvis: complete run` meta-commit).
- [ ] The footer lists one bullet per qualifying commit in chronological order as `- <shortSha> <subject> — <label>`, where `<label>` is the commit's `Jarvis-Agent` trailer(s) joined by `, `, followed by a `Written by <labels> through Jarvis.` summary; summary labels are deduplicated first-seen in commit/trailer order; a qualifying commit with no `Jarvis-Agent` trailer renders `unknown` and is excluded from the summary.
- [ ] When no commit qualifies, the footer is empty and the refreshed body is the regenerated `Spec:` header (plus preserved narrative if present) with no `---` separator.
- [ ] Content between the `<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->` markers in the existing PR body is preserved across refresh; when the markers are absent, the body is the regenerated `Spec:` header plus, when the footer is non-empty, a `---` separator and the footer.
- [ ] Body refresh edits the ensured PR without opening a new one; a transient `gh` refresh failure returns the retryable `completion_commit_failed` publication failure that leaves the durable run `completed`, and resume re-refreshes the same PR without duplicating it.
- [ ] Attribution and refresh tests use injected git/`gh` seams and require no live remote or GitHub credentials.
- [ ] `v2/docs/write-behavior.md` documents attribution rendering (single-meta-commit selection under the collapse model, label dedup, `unknown` labeling, empty-footer shape), the post-PR body refresh, plain narrative-marker preservation (and the deliberately un-ported generated-narrative hash path), and that refresh failure reuses `completion_commit_failed`.
- [ ] `v2/docs/v1-behaviors.md` marks the ported attribution-footer and PR-body-refresh behaviors and notes v2's single-commit collapse vs v1's per-subspec commits.

## Documentation updates

- Extend `v2/docs/write-behavior.md` (durable v2 PR lifecycle home) with the attribution + body-refresh behavior and the post-publish ordering shared with slice 01.
- Mark ported behaviors in `v2/docs/v1-behaviors.md`.
