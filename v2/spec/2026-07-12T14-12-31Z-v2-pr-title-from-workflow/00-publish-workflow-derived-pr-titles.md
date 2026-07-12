# Publish workflow-derived PR titles

## Problem

New v2 PRs all use `jarvis: complete run`, hiding whether the branch contains an intent, a spec, or other write work.

## Decisions

- Pass a creation title from the completing workflow through completion publication — rules out `completion-publisher.ts` selecting a fixed title.
- Intent publication uses `intent: <seed name>` — rules out deriving identity from staged output filenames, which the agent may split or rename.
- Spec/write and plan publication use the resolved `index.md` H1 text — rules out timestamped directory names or completion-commit subjects.
- Use `jarvis: complete run` only when the workflow cannot resolve its subject — rules out making fallback the normal title or failing publication for missing metadata.
- Reused open PRs keep their existing title — rules out retitling already-created review surfaces.

## Scope

- Add title input to completion publication and use it only when creating a draft PR.
- Derive and carry the title through intent, write/spec, and plan completion paths, including completed-run publication retry.
- Cover workflow-specific titles, fallback, and open-PR reuse with focused automated tests.
- Update the operator and parity documentation that currently names the fixed title.

## Acceptance criteria

- [ ] A newly created intent-run draft PR is titled `intent: <seed name>`.
- [ ] A newly created spec/write or plan-run draft PR is titled with its resolved `index.md` H1.
- [ ] A newly created draft PR falls back to `jarvis: complete run` only when its workflow subject cannot be resolved.
- [ ] Reusing an existing open draft PR leaves its title unchanged.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` as the completion-publication behavior home.
- Update `v2/docs/first-workflow-walkthrough.md` so its draft-PR example no longer claims a fixed title.
- Update `v2/docs/v1-behaviors.md` with the current v2 completion-title behavior and source citations.
