---
name: implement-respects-target-repo-doc-layout
---

# Implement never writes jarvis's own doc conventions into a target repo

## Problem

An `implement` run on a product repo (`homestead-client`, a Vite SPA with no `v2/` tree) created `v2/docs/v1-behaviors.md` — jarvis's own documentation path — committed it in a subspec commit, and carried it through review into the published PR. The content was correct and about the product; only the location was jarvis convention leaking through the prompt corpus into a repo that references it nowhere. Evidence: #3426.

## Decisions

- Doc-update instructions in the implement prompt corpus are conditioned on the target repo's layout (its own docs home, discovered or configured), never on jarvis's `v2/docs/` convention; rules out harness-repo paths hard-coded in rules that render for every project.
- A cheap guard at commit or review: a path that exists in jarvis's layout but matches nothing in the target repo's tree or spec is flagged; rules out the leak surviving review silently.
- Sweep the prompt corpus for other jarvis-specific paths rendered into external-project prompts while fixing this; rules out repeating the class file-by-file.

## Acceptance criteria

- [ ] A test proves the implement rules rendered for a project without jarvis's layout carry no `v2/docs/`-style jarvis paths; fails against the current corpus.
- [ ] An implement fixture on a non-jarvis-layout repo does not produce jarvis-convention doc paths, pinned by a test or the guard above.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — per-project doc-layout conditioning of write-step rules.
