---
name: detached-pipeline-plan-stage-consumes-ready-intents
---

# Plan-stage ready-intent consumption works when the intent PR is unmerged

## Problem

The documented contract says the plan stage consumes its chained ready-intent on plan-tree landing so the plan PR removes the queue file from `main`. But `consumePublicationInputs` only fires when the file is reachable both on `main` (`realpathSync` under the project root) and in the plan worktree — and in the documented inter-stage handoff (stage artifacts hand off content; merging the intent PR between stages is not required) it is reachable in *neither*: the intent PR hasn't merged, and the plan worktree branched from pre-merge `main`. Both skips are deliberate best-effort, so nothing surfaces; once the intent PR merges, the consumed ready-intents are orphaned on `main` until a byte-match cleanup sweep after the implement lane lands. Evidence: #3041 (chess pipeline `af881ac0`: PRs #8/#9/#10 landed with no queue deletions; two consumed ready-intents removed by hand). Not pipeline-flavor-specific — any pipeline whose intent PR is unmerged when plan branches has the hole.

Related: [[intent-resume-consumes-its-seed]] (#3410) is the resume-path instance of the same never-consumed class, and the 2026-09-05 review of #3483's foundation found external seeds/ready-intents recorded `sourceRoot: project.root` while living under `~/.jarvis/specs/`, silently skipping every consumption — three surfaces, one contract: **a consumed input is deleted by the landing that consumed it, or the run says why not.**

## Decisions

- Consumption resolves the ready-intent through the same source the plan stage actually read it from (stage artifact, external home, or `main`), not a hardcoded project-root path; rules out the both-places-or-silent-skip mechanic.
- When consumption cannot fire, the run records a named, visible reason on the row; rules out best-effort skips invisible until an operator audits `main`.
- A consumption test drives the consumer against the detached-handoff shape (intent PR unmerged, plan worktree branched pre-merge); rules out tests that assert the recorded field without driving the consumer (the #3483 lesson).

## Acceptance criteria

- [ ] A test reproducing the detached handoff proves the plan landing deletes the consumed ready-intent from its actual source (or records a named skip reason); fails against the current silent no-op.
- [ ] External-home ready-intents consume through the same path, pinned by a test that drives the consumer.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — correct the consumption contract to match the mechanism.
