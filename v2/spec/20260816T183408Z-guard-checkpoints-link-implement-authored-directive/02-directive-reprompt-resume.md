# Daemon resume restores the newest directive reprompt

## Problem

Daemon resume reconstructs only mutation-directive and keystone-directive context. It can lose a guard repair request or resurrect a stale sibling, and synthetic `implement` fixtures do not exercise linked-index routing.

## Behavior

Resume scans the durable tail once across mutation-directive, guard-checkpoint, and keystone-directive events, restores only the newest context, and injects it into the next routed implement iteration. It matches the authored linked step such as `implement~link-N` and rebuilds the active subspec artifact before dispatch.

## Decision ledger

- Extend one newest-event selector to all three kinds — rules out independent scans restoring stale contexts together.
- Reconstruct guard findings verbatim from the durable event — rules out resume-time source inference.
- Match routed linked-step IDs to their authored implement step and recover the active linked subspec artifact — rules out exact-`implement` fixtures that bypass real routing.
- Keep legacy logs without guard events and existing mutation/keystone payload shapes readable — rules out migration.

## Prerequisites

- `guard_checkpoint_reprompt` and its write-loop input context land in subspec 01 before daemon replay support.

## Tasks

- [ ] Extend directive-reprompt tail recovery and daemon write-input reconstruction for guard context and linked-index implement steps.
- [ ] Add routed resume coverage for a lone guard event and newest-event precedence in both directions across all three kinds.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `resumes routed implement with guard-checkpoint reprompt context from log` in `v2/src/daemon/daemon-resume.test.ts` uses an `implement~link-N` step, fails against the pre-fix two-kind selector, and passes when the next iteration receives every persisted guard finding unchanged.
- [ ] That routed fixture proves authored-step matching and active-subspec artifact reconstruction before the resumed implement dispatch, rather than relying on a synthetic exact-`implement` step.
- [ ] `daemon resume restores only the newest directive-reprompt context across all three kinds` in `v2/src/daemon/daemon-resume.test.ts` covers guard events both older and newer than mutation/keystone events and never restores more than one context.
- [ ] `paused mutation-directive implement resumes` and `paused keystone-directive implement resumes` in `v2/src/daemon/daemon-resume.test.ts` stay green without payload changes.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resumes routed implement with guard-checkpoint reprompt context from log`; Keystone checkpoint: removing guard-event replay turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume restores only the newest directive-reprompt context across all three kinds`; Mutation checkpoint: inverting newest-event selection resurrects a stale sibling context and turns this pin red.
- [ ] Every added or modified step-matching, artifact-reconstruction, or event-selection guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe pause/resume replay of the newest mutation, guard, or keystone directive context.

## Documentation updates

- `v2/docs/write-behavior.md` — three-kind newest-event replay.
- `v2/docs/v1-behaviors.md` — daemon resume reconstruction for guard context.
