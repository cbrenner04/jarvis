# Document daemon-host chained resolution

## Problem

`daemon-host.md` documents git-disabled chained plan-artifact normalization and external implement dispatch, but not external ready-intent downstream-input resolution for chained stages or stage-scoped failure incidents on non-terminal fan-out pipelines. § Pipeline stage resolution still claims a listed path missing from the prior worktree fails without falling back, contradicting branch rematerialization and the `specs/…/ready-intents/` example.

## Prerequisites

- `00-external-ready-intent-chained-resolution` and `01-fan-out-lane-failure-incidents` (document landed behavior only).

## Decision ledger

- Record external ready-intent downstream-input resolution in `daemon-host.md` § Pipeline stage resolution; cross-link `workflow-runner.md` admission detail instead of duplicating predicates; rules out a second external-home layout spec in architecture docs.
- Revise the stale no-fallback sentence so absent-worktree resolution documents admission-root, git-branch rematerialization, and external-home filesystem acceptance in order; rules out prose that contradicts landed behavior.
- Record non-terminal fan-out lane failure incidents beside existing `stage-settlement-wedged` and terminal-pipeline incident derivation; rules out implying failed lanes are silent until the whole pipeline terminates.

## Tasks

- Update `v2/docs/daemon-host.md` § Pipeline stage resolution: replace the "A listed path missing from the prior worktree fails without falling back" sentence with the ordered absent-worktree fallbacks (admission root, git-branch rematerialization, external `ready-intents/` home when inverted `effectivePublishGit` is false), using the same `jarvisHome()/specs/` containment gate as chained external-plan implement.
- Update `v2/docs/daemon-host.md` operator-incident derivation: stage-scoped `stage-failed` incidents for `failed` fan-out lanes while the pipeline remains non-terminal, carrying `branchKey`.

## Acceptance criteria

- [ ] `v2/docs/daemon-host.md` documents external ready-intent downstream-input resolution for chained stages and stage-scoped failure incidents with `branchKey` on non-terminal fan-out pipelines, consistent with `00`–`01`.

## Documentation updates

- None beyond the acceptance criterion above.
