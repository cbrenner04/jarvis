---
name: intent-splits-by-surface
---

# Intent splits a seed by the surfaces its fix touches

## Problem

The intent split emits one ready-intent per *symptom*. When one symptom's fix spans several
surfaces, that single intent carries all of them into one plan and one implement run.

`ticked-criteria-plus-mutation-failure-is-unrecoverable` described one operator-visible failure and
split into one ready-intent, whose fix needed a state-store lineage query, a new daemon request, CLI
admission changes, and a bounded repair loop. The seeds that named distinct surfaces
(`pipeline-definition-schema-and-validation`, `pipeline-durable-stage-state-and-daemon-execution`)
split into two and three intents unprompted, and every one of those landed on its first implement.

## Evidence (2026-07-27)

| Seed → intents | Implement outcome |
| --- | --- |
| ticked-criteria… → 1 intent | two failed runs; second broke ~10 workflow-dispatch tests at once |
| pipeline definitions → 1a, 1b | both landed |
| pipeline durable stage state → 2a, 2b, 2c | 2a landed first try |

## Decisions

- The split enumerates the surfaces a seed's fix touches and emits one ready-intent per surface, in
  dependency order. Rules out one-intent-per-symptom, which is what produced the oversized intent.
- A surface is a module boundary the fix must change — persistence, daemon request handling, CLI
  admission, execution loop — not a file count. Rules out a numeric budget in the prompt; the
  distinction the agent can actually judge is "does this cross a boundary".
- An intent that cannot be split states why in one line, rather than splitting arbitrarily. Rules out
  forced fragmentation of genuinely single-surface work.
- The rule is stated once in the split prompt, with no examples or thresholds. Rules out growing the
  prompt with cases — prompt bloat is its own failure mode here.

## Acceptance criteria

- [ ] The split prompt instructs one ready-intent per touched surface in dependency order, in a
      single added rule with no examples or numbers; a prompt-registry test pins the rule's presence.
- [ ] A seed whose fix spans persistence + daemon + CLI splits into separate ready-intents, each
      naming its surface; a fixture drives the split step and fails against the pre-change prompt.
- [ ] A genuinely single-surface seed still emits one ready-intent and states why.
- [ ] Emitted ready-intents declare their dependency order, so a later `plan` on a dependent intent
      blocks rather than guessing.
- [ ] Total added prompt length stays within the existing split prompt's budget test.

## Documentation updates

- `v1/docs/spec-guidance.md` — intents are split by surface, not by symptom.
- `v2/docs/workflow-runner.md` — the split contract's surface rule.
