---
name: serve-canonical-failures-from-daemon
---

# Serve canonical failures from the daemon

## Prerequisites

- Durable run rows and terminal pipeline-stage `failureDetail` round-trip one shared operator failure record with expectation, observation, optional near miss, reissue retryability, and path origin.
- Intent, plan, and implement settlement producers populate that record with checkable evidence, authored-document near misses, honest reissue semantics, and resolved path origins.

## Module-boundary surface

- Daemon: run observation, pipeline-stage settlement, wire projection, and resume admission.

## Problem

Daemon run observation recomposes errors from row/log fragments, pipeline failure paths can still write free-form messages, and recovery projections can disagree with the condition actually settled.

## Behavior

- Daemon run and pipeline observations expose the durable shared failure record unchanged, and resume admission plus `resumable` and `nextAction` project from its retryability.

## Decision ledger

- Use the durable record as the single failure source for run list/wait and terminal pipeline-stage observation; rules out daemon-side reconstruction drifting from settlement evidence.
- Settle every terminal workflow-stage failure with the linked run's record, including unexpected and resolution failures; rules out `{ message }` as an alternative operator contract.
- Derive resume admission, `resumable`, and `nextAction` from record retryability through one daemon policy; rules out a row advertising an action the matching RPC refuses or repeats unchanged.
- Keep nonterminal coordination markers outside the operator failure contract; rules out presenting deferred-settlement bookkeeping as a terminal diagnosis.

## Acceptance criteria

- [ ] Daemon list/wait tests prove the same durable record is returned byte-for-byte for one run without reading terminal logs to reconstruct it; they fail against the pre-fix composer-owned evidence.
- [ ] Pipeline settlement tests prove terminal intent, plan, and implement stages expose the linked run record unchanged in `failureDetail`, and unexpected/resolution failures use the same contract; they fail against pre-fix free-form detail.
- [ ] Daemon resume tests prove retryable records admit resume with `resumable: true` and `nextAction: resume`, while fixed-point records refuse it and never advertise resume; they fail against the pre-fix independent projections.
- [ ] Wire parser tests reject malformed structured failure records on run and pipeline snapshots without dropping valid fields.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — durable failure source, run list/wait wire contract, and retryability-derived resume admission.
- `v2/docs/pipeline-execution.md` — terminal stage failure-detail projection and exclusion of nonterminal coordination markers.
- `v2/docs/v1-behaviors.md` — record the changed v2 daemon failure and resume projections.
