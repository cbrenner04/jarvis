---
name: implement-pr-body-is-reviewer-facing
---

# Implement PR body is reviewer-facing

## Problem

The implement draft-PR body is harness output, not a reviewer description (issue #3934). Verified on `main` at `8e86c0bb0`:

1. **Absolute local path.** `normalizePublicationSpecPath` (`v2/src/execution/publication-spec-path.ts:9`) returns the absolute path whenever the spec is outside the worktree — always, for `specs: external` — and `pr-body-refresh.ts:47` / `completion-publisher.ts:283` print it as the `Spec:` line, leaking `~/.jarvis/specs/...`.
2. **No overview.** Nothing says what the PR delivers. `## Change summary` is per-area file/line counts (`spec-run-body-summary.ts:76`); the `jarvis:narrative` block is shrink-authored and reads as a review delta.
3. **Harness noise leads.** Footer `Written by <agent> through Jarvis` / `<agent> — Steps: …` (`pr-attribution.ts:167`, `:203`) and per-commit `— <agent>` suffixes (`pr-attribution.ts:158`, `spec-run-body-summary.ts:39`) sit in the main body.
4. **Commits listed twice.** `## Commits` headlines (`spec-run-body-summary.ts:57`) and again with SHAs in the footer (`pr-attribution.ts:158`).
5. **Stale title.** Title is set once at `gh pr create` (`completion-publisher.ts:280`, resolver `spec-creation-title.ts:30`); `refreshPrBody` never updates it, so a renamed plan keeps the old title.

## Decisions

- PR bodies never contain an absolute path: in-worktree specs keep the repo-relative `Spec:` line; external specs render `Spec: <spec dir name>`. Commit-body `Spec:` trailers (`completion-commit.ts:309`, read by `pr-attribution.ts`) are unchanged.
- The body opens with `## Overview`, built from the spec `index.md` opening paragraph (the text under its H1) plus each linked subspec's title. Change summary and narrative follow it.
- Attribution stays (documented behavior) but renders inside one `<details><summary>Jarvis attribution</summary>` block holding the agent/steps lines and the single SHA commit list.
- `## Commits` is removed; commits appear once, inside the `<details>` block. No `— <agent>` suffix outside it.
- Body refresh re-derives the title with the creation resolver and runs `gh pr edit --title` only when it differs; an explicit title still wins.
- Narrative marker preservation and precedence rules are unchanged.

## Acceptance criteria

- [ ] A test drives body build for a `specs: external` run and asserts the body contains no absolute path and no home-directory prefix; it fails against the current `Spec: /…` line.
- [ ] A test asserts the body's first `##` section is `## Overview` carrying the spec index opening paragraph.
- [ ] A test asserts each commit SHA appears exactly once in the body and `## Commits` is absent.
- [ ] A test asserts `Written by`, `— Steps:`, and per-commit agent labels appear only inside the `<details>` block.
- [ ] A test on the fake `gh` asserts refresh issues `pr edit --title <new>` when the resolved title changed and issues none when unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § PR body narrative markers — new section order.
- `v2/docs/write-behavior.md` § Commit trailers and PR attribution — collapsed attribution, single commit list, title refresh.
- `v2/docs/v1-behaviors.md` — note the PR body format change if it pins the old layout.
