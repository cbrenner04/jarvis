# Render-coverage exempts prompt metadata bumps and pure deletions

Render-coverage applies a sentinel body-line mutation for changed registered prompts and fails closed when the mapped observer suite stays green under that mutation. `parseDiff` emits only `add` changed lines; pure-delete hunks leave zero body `add` lines while the prompt path remains in changed paths. Today's `mutateRenderedPrompt` then falls back to the first surviving body line, so correct deletion-only dedups strand at `missing-render-coverage` despite present, green observer tests. Frontmatter-only bumps have no body `add` to target for the same reason.

## Behavior

- **Region boundary (post-change source):** For a readable post-change prompt, frontmatter is lines before the first `\n---\n`; body is at or after that delimiter (same rule as `mutateRenderedPrompt`).
- **Deletion-only (diff-side):** Classify independently of post-change line lookup. A registered-prompt diff is deletion-only in the body when the raw diff shows body-region removals (`-` hunk lines at or below the post-change body start) and `parseDiff` yields zero body `add` lines for that path. Do not depend on `ChangedLine.type === "remove"` — `parseDiff` does not emit removals.
- **Combined rule:** Any body `add` (added or changed body line) ⇒ sentinel path. Otherwise — frontmatter-only, deletion-only body, or both — ⇒ observer-only path when map preconditions hold.
- **Observer-only path:** Short-circuit before `mutateRenderedPrompt`. Render-coverage passes only when the worktree map entry is present, non-empty, path-valid, and mapped observer tests run on the **unmutated** post-change prompt and return green.
- **Sentinel path:** Unchanged for body add/change — apply sentinel body-line mutation; fail closed as `missing-render-coverage` when observers stay green under mutation.
- **Out of scope for exemption:** Whole-file registered-prompt deletion (or untracked-only presence) stays fail-closed `missing-render-coverage`.

## Decision ledger

- Frontmatter/body boundary from post-change source at first `\n---\n`; rules out diff-side or pre-change boundary lookup for region classification.
- Deletion-only from raw-diff body removals plus zero body `add` lines from `parseDiff`; rules out `remove`-typed `ChangedLine` entries `parseDiff` does not emit.
- Pure-delete hunks with zero body `add` lines trigger today's sentinel fallback to the first surviving body line — the deletion-only dedup bug this spec fixes; rules out keeping that fallback on exempt paths.
- Observer-only exempt paths run mapped observers on unmutated post-change content and short-circuit before `mutateRenderedPrompt`; rules out inverted sentinel semantics or sentinel fallback on exempt paths.
- In-file body deletion only — exempt when observers green on surviving post-deletion content, including empty/minimal body after deleting all body lines; rules out exempting whole-file registered-prompt deletion.
- Any body add/change ⇒ sentinel; otherwise (frontmatter-only, deletion-only body, or both) ⇒ observer-only when map green; rules out misclassifying mixed hunks that add frontmatter and delete body lines only.
- Keep fail-closed `missing-render-coverage` for added/changed body lines whose mapped observer test passes under the sentinel mutation; rules out exempting real prompt-behavior edits.
- Preserve worktree map resolution, observer path confinement, render-verification bounds, and code-candidate killing-test behavior; rules out broadening this exemption into map lookup or non-prompt mutation changes.

## Tasks

- In `diff-derived-mutation-verifier.ts`, split region boundary (post-change) from deletion-only (diff-side + zero body adds), branch render-coverage before `mutateRenderedPrompt`: sentinel for body add/change, observer-only for frontmatter-only and in-file deletion-only diffs.
- Add `diff-derived-mutation-verifier.test.ts` regression for a registered-prompt diff that only bumps frontmatter `revision` — assert scoped observers run on unmutated content and pass; fails pre-fix with `missing-render-coverage`.
- Add `diff-derived-mutation-verifier.test.ts` regression using a worktree fixture (same family as `worktree render-observer map resolution`) with honest observer coverage on post-deletion content, reproducing pre-fix fallback-on-surviving-line failure; assert scoped observers run on unmutated post-deletion content and pass.
- Update durable docs listed under **Documentation updates**.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` proves a registered-prompt diff that only bumps frontmatter `revision` passes render-coverage by running mapped observer tests on unmutated content (no `missing-render-coverage`); it fails against the pre-fix verifier.
- [ ] `diff-derived-mutation-verifier.test.ts` proves an in-file body-deletion-only registered-prompt diff via a worktree fixture with honest post-deletion observer coverage passes render-coverage by running mapped observer tests on unmutated post-deletion content; it fails against the pre-fix verifier (fallback-on-surviving-line `missing-render-coverage`).
- [ ] `diff-derived-mutation-verifier.test.ts` case `returns missing-render-coverage when the mapped observer misses the sentinel mutation` stays green (reachable on main; body-line sentinel enforcement unchanged).
- [ ] `diff-derived-mutation-verifier.test.ts` case `fails deleted and untracked registered prompts without render coverage` stays green (reachable on main; whole-file deletion stays fail-closed).
- [ ] `v2/docs/write-behavior.md` § Diff-derived mutation verification records metadata-only and deletion-only render-coverage exemptions, observer-only unmutated verification, and preserves body add/change sentinel enforcement.
- [ ] `v2/docs/operator-runbook.md` § Diff-derived verification stall adds a `missing-render-coverage` recovery note for metadata-only and deletion-only prompt diffs with a link to the canonical contract.
- [ ] `v2/docs/v1-behaviors.md` records render-coverage metadata/deletion exemption behavior in the diff-derived verification bullet.
- [ ] `v2/docs/test-writing.md` § Prompt changes records metadata-only and deletion-only exemptions and points to `write-behavior.md` § Diff-derived mutation verification.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — metadata/deletion render-coverage exemptions in § Diff-derived mutation verification.
- `v2/docs/operator-runbook.md` — `missing-render-coverage` recovery note for metadata-only and deletion-only prompt diffs.
- `v2/docs/v1-behaviors.md` — render-coverage metadata/deletion exemption behavior.
- `v2/docs/test-writing.md` — § Prompt changes metadata/deletion exemptions with link to canonical contract.
