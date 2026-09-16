---
name: pr-body-spec-line-and-overview
---

# PR body spec line and overview

## Prerequisites

## Problem

Implement draft-PR body leaks absolute local paths and says nothing about what the PR delivers (issue #3934). `normalizePublicationSpecPath` (`v2/src/execution/publication-spec-path.ts:9`) returns an absolute path for out-of-worktree specs (always for `specs: external`), printed as `Spec:` by `pr-body-refresh.ts:47` and `completion-publisher.ts:283`. `## Change summary` (`spec-run-body-summary.ts:76`) and the shrink-authored narrative are the only content.

## Decisions

- PR bodies never contain an absolute path: in-worktree specs keep the repo-relative `Spec:` line; external specs render `Spec: <spec dir name>`. Commit-body `Spec:` trailers (`completion-commit.ts:309`) are unchanged.
- Body opens with `## Overview`: spec `index.md` opening paragraph (text under its H1) plus each linked subspec's title. Change summary and narrative follow.
- Narrative marker preservation and precedence rules unchanged.

## Acceptance criteria

- [ ] A test drives body build for a `specs: external` run and asserts no absolute path and no home-directory prefix; it fails against the current `Spec: /…` line.
- [ ] A test asserts the body's first `##` section is `## Overview` carrying the spec index opening paragraph.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § PR body narrative markers — new section order.
- `v2/docs/v1-behaviors.md` — note the change if it pins the old layout.
