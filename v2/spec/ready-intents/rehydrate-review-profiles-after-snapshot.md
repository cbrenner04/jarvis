---
name: rehydrate-review-profiles-after-snapshot
---

# Rehydrate review profiles after daemon snapshot round-trip

Daemon JSON transport strips review-profile render callbacks, so persisted workflows fail before invoking critic, actuator, or debate roles. Preserve serializable profile identity and restore executable renderers before review execution.

## Decisions

- Persist `profile.domain` and existing serializable policy, then resolve renderers through one domain-to-profile registry at execution; rules out serializing callbacks or retaining live profile objects across the daemon boundary.
- Use one rehydration path for intent, plan, and implement reviews in both light and debate modes; rules out domain- or mode-specific repairs.
- Prove the boundary with a JSON-round-tripped workflow step that renders critic, actuator, and every debate role; rules out tests that execute only the original in-memory step.

## Observable behavior

- Daemon-run intent, plan, and implement reviews execute their configured prompt renderers after workflow snapshot reload.
- Light review invokes critic and actuator rendering; debate review renders adversary, advocate, adjudicator, and actuator prompts.
- Existing review policy, prompt output, cycle behavior, and domain enforcement remain unchanged.

## Out of scope

- Cleanup of stale review-verdict owner markers after non-completion.

## Documentation updates

- Update `v2/docs/workflow-runner.md` to define profile identity serialization and registry rehydration at the daemon boundary.
- Update `v2/docs/v1-behaviors.md` to keep the v1 parity baseline aligned with daemon-run review execution.

## Prerequisites
