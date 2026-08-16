# Daemon resume restores the newest directive reprompt

## Problem

Daemon resume reconstructs only mutation-directive and keystone-directive reprompt context. A paused run whose latest repair request is the new guard-checkpoint event would resume with no repair prompt, and independent scans could resurrect an older sibling context.

## Behavior

Resume scans the durable log tail once across mutation-directive, guard-checkpoint, and keystone-directive events, restores only the chronologically newest context, and injects that context into the next implement iteration. Existing event payloads remain readable and unchanged.

## Decision ledger

- Extend the single newest-event selector to all three directive-reprompt kinds — rules out independent per-kind scans that can restore stale contexts together.
- Reconstruct guard findings verbatim from the structured event rather than re-running checkpoint verification during admission — rules out resume-time source inference before the agent iteration starts.
- Treat legacy logs lacking guard events exactly as today — rules out a log migration or changes to existing mutation/keystone event shapes.

## Prerequisites

- `guard_checkpoint_reprompt` and its write-loop input context land in subspec 00 before daemon replay support.

## Tasks

- [ ] Extend directive-reprompt tail recovery and daemon write-input reconstruction for guard context.
- [ ] Add resume coverage for a lone guard event and newest-event precedence in both directions across all three kinds.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `resumes paused implement with guard-checkpoint reprompt context from log` in `v2/src/daemon/daemon-resume.test.ts` fails against the pre-fix two-kind selector and passes when the next iteration receives every logged guard finding unchanged.
- [ ] `daemon resume restores only the newest directive-reprompt context across all three kinds` in `v2/src/daemon/daemon-resume.test.ts` covers guard events both older and newer than mutation/keystone events and never restores more than one context.
- [ ] Existing paused mutation-directive and keystone-directive resume tests stay green without payload changes.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resumes paused implement with guard-checkpoint reprompt context from log`; Keystone checkpoint: removing guard-event replay turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `daemon resume restores only the newest directive-reprompt context across all three kinds`; Mutation checkpoint: inverting newest-event selection resurrects a stale sibling context and turns this pin red.
- [ ] Every added or modified event-selection guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe pause/resume replay of the newest mutation, guard, or keystone directive context.

## Documentation updates

- `v2/docs/write-behavior.md` — three-kind newest-event replay.
- `v2/docs/v1-behaviors.md` — daemon resume reconstruction for guard context.
