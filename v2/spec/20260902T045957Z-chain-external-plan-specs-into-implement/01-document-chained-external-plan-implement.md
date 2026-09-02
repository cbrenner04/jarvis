# Document chained external plan implement

## Problem

Operator and architecture docs describe standalone external-plan implement admission and git-disabled chained-stage workspace matching, but not chained implement dispatch from `~/.jarvis/specs/<safeId>/plans/<name>/` through the shared admission and execution contract.

## Decisions

- Record chained external-plan implement dispatch in `daemon-host.md`; cross-link standalone admission and execution detail in `workflow-runner.md` instead of duplicating predicates; rules out a second admission spec in operator runbook prose.
- State in `operator-runbook.md` that git-disabled plan pipelines continue through v2 implement using the external plan home; rules out implying plan is terminal for `plan.commit: false` projects.
- Add a `[v2 additive]` `v1-behaviors.md` entry for chained external-plan implement; rules out changing v1 pipeline behavior.

## Tasks

- Update `v2/docs/daemon-host.md` § Pipeline stage resolution: git-disabled plan artifact normalization to external `index.md`, implement-stage dispatch through shared external identity, admission-root code routing, and cross-links to `workflow-runner.md` external-plan admission/execution.
- Update `v2/docs/workflow-runner.md`: standalone and chained implement share the external-spec contract; daemon owns chained normalization — no duplicate resolution steps here.
- Update `v2/docs/operator-runbook.md`: git-disabled plan pipeline stages chain into v2 implement against the external plan home.
- Update `v2/docs/v1-behaviors.md`: record v2 chained external-plan implement behavior without altering v1.

## Acceptance criteria

- [ ] `v2/docs/daemon-host.md` documents git-disabled chained plan-artifact normalization, implement-stage external dispatch, and cross-links to the shared admission/execution contract.
- [ ] `v2/docs/workflow-runner.md` records that standalone and chained implement share the external-spec contract without duplicating daemon resolution detail.
- [ ] `v2/docs/operator-runbook.md` states that a git-disabled plan pipeline continues through v2 implement using the external plan home.
- [ ] `v2/docs/v1-behaviors.md` records the resulting v2 chained external-plan implement behavior without changing v1.
