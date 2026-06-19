---
name: plan-removes-consumed-ready-intent
---

# Plan removes the consumed ready-intent in the spec PR

A `commit: true` `jarvis1 plan` run consumes a ready-intent from
`<targetDir>/ready-intents/<name>.md` but leaves the source file behind, so the
ready-intent lingers after its spec ships. The consumed ready-intent should be
deleted on the plan branch and that deletion committed into the spec PR, so
merging the PR removes the ready-intent from `ready-intents/`.

Behavior:

- The source `ready-intents/<name>.md` is deleted on the plan branch and the
  deletion is staged into the plan commit that carries the spec tree.
- Deletion is deterministic: same ready-intent in, same removal out, no agent
  discretion over whether or which file is removed.
- The deletion lands in the spec PR so the merge clears `ready-intents/`; the
  byte-for-byte `intent.md` copy in the spec tree is unaffected.

Scope to `commit: true` (where the spec PR exists). Define behavior for
`commit: false` only insofar as it consumes a ready-intent — keep it consistent
or explicitly out of scope, but do not invent PR semantics where no PR exists.

## Prerequisites

- plan mode resolves and reads a ready-intent from <targetDir>/ready-intents/<name>.md
- plan mode copies the ready-intent into the spec tree as intent.md
- plan mode commits the spec tree onto the plan branch as the spec PR
